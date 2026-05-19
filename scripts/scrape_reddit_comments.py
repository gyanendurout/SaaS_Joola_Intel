"""
Scrapes Reddit comment threads for the top-N reddit_mentions per brand.
Targets the actor `trudax/reddit-scraper-lite` which already supports
fetching comments via the `startUrls` field (passing the post URL).

Run AFTER migration 009 is applied.

Run: python scripts/scrape_reddit_comments.py
"""

import os, sys
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import requests, re
from datetime import datetime

try:
    from dotenv import load_dotenv
    load_dotenv("scripts/.env")
except ImportError:
    pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apify_to_supabase import (
    run_actor, wait_for_run, fetch_results,
    SUPABASE_URL, SUPABASE_KEY, SB_HEADERS,
    sb_get, sb_upsert, http_request,
)

# How many top posts per brand to fetch comments for
TOP_POSTS_PER_BRAND = 20

# Per-post comment cap
COMMENTS_PER_POST = 50


def extract_t1_id(item_id: str | None, url: str = "") -> str:
    """Reddit comment IDs look like 't1_abc123'. Apify returns various forms."""
    if not item_id:
        m = re.search(r"/comment/([a-z0-9]+)/?", url or "", re.I)
        if not m:
            m = re.search(r"\?context=\d+&utm_source.*?\bid=([a-z0-9]+)", url or "", re.I)
        return f"t1_{m.group(1)}" if m else ""
    sid = str(item_id)
    return sid if sid.startswith("t1_") else f"t1_{sid}"


def main():
    print("=" * 55, flush=True)
    print("JOOLA Intel — Reddit Comments Scraper", flush=True)
    print(f"Started: {datetime.utcnow().isoformat()}", flush=True)
    print("=" * 55, flush=True)

    # Pull top mentions per brand from DB
    posts = sb_get("reddit_mentions",
                   "id,brand_id,post_url,subreddit,upvotes,reddit_post_id")
    print(f"  Loaded {len(posts)} reddit_mentions rows from DB", flush=True)

    # Group by brand and take top N by upvotes
    from collections import defaultdict
    by_brand = defaultdict(list)
    for p in posts:
        by_brand[p["brand_id"]].append(p)

    selected = []
    for brand_id, lst in by_brand.items():
        lst.sort(key=lambda x: x.get("upvotes") or 0, reverse=True)
        selected.extend(lst[:TOP_POSTS_PER_BRAND])

    # Deduplicate by URL (one post may appear under multiple brands)
    seen_urls = set()
    deduped = []
    for p in selected:
        u = (p.get("post_url") or "").split("?")[0].rstrip("/")
        if not u or u in seen_urls:
            continue
        seen_urls.add(u)
        deduped.append(p)

    print(f"  Targeting {len(deduped)} unique posts for comment scrape", flush=True)
    if not deduped:
        print("  ⚠ No posts to scrape — exiting")
        return

    # Map URL → post (for matching results back to brand_id + parent_post_id)
    url_to_post = {(p["post_url"] or "").split("?")[0].rstrip("/"): p
                   for p in deduped if p.get("post_url")}

    # Run actor — trudax/reddit-scraper-lite accepts startUrls for post URLs
    print(f"\n  Firing Apify actor (max {COMMENTS_PER_POST} comments/post)…",
          flush=True)
    run_id = run_actor("trudax/reddit-scraper-lite", {
        "startUrls":      [{"url": u} for u in url_to_post.keys()],
        "maxItems":       COMMENTS_PER_POST * len(url_to_post),
        "maxComments":    COMMENTS_PER_POST,
        "scrollTimeout":  40,
        "skipComments":   False,
        "skipUserPosts":  True,
        "skipCommunity":  True,
    })
    if not wait_for_run(run_id, poll_sec=20):
        print("  ✗ Reddit comment scrape FAILED")
        return

    items = fetch_results(run_id)
    print(f"  ✓ Apify returned {len(items)} items", flush=True)

    # Build comment rows
    rows = []
    by_type = defaultdict(int)
    for item in items:
        by_type[item.get("dataType") or item.get("type") or "?"] += 1

        # Skip non-comment items (the actor returns posts + comments mixed)
        item_type = (item.get("dataType") or item.get("type") or "").lower()
        if item_type not in ("comment", "comments"):
            # Try detecting by other fields
            if not (item.get("commentId") or item.get("parentId")
                    or "/comment/" in (item.get("url") or "")):
                continue

        # Find the parent post via parent_url / post_url / parsing comment URL
        parent_url = (item.get("postUrl") or item.get("parentUrl") or "")
        parent_url = parent_url.split("?")[0].rstrip("/")
        if not parent_url:
            # parse from comment URL
            curl = item.get("url") or ""
            m = re.search(r"(.+)/comment/", curl)
            if m:
                parent_url = m.group(1).rstrip("/")

        parent = url_to_post.get(parent_url)
        if not parent:
            for u, p in url_to_post.items():
                if u in parent_url or parent_url in u:
                    parent = p
                    break
        if not parent:
            continue

        comment_id = extract_t1_id(item.get("id") or item.get("commentId"),
                                    item.get("url") or "")
        if not comment_id:
            continue

        text = item.get("body") or item.get("text") or item.get("comment", "")
        if not text:
            continue

        rows.append({
            "parent_post_id":    parent["id"],
            "reddit_comment_id": comment_id,
            "brand_id":          parent["brand_id"],
            "subreddit":         item.get("subreddit") or parent.get("subreddit") or "",
            "author":            item.get("author") or item.get("username") or "",
            "comment_text":      text[:2000],
            "upvotes":           item.get("score") or item.get("upvotes") or 0,
            "depth":             item.get("depth") or 0,
            "posted_at":         item.get("createdAt") or item.get("created"),
        })

    print(f"\n  Item type breakdown from Apify: {dict(by_type)}", flush=True)
    print(f"  Comments before dedup: {len(rows)}", flush=True)

    # Dedupe by reddit_comment_id (same comment may appear under multiple posts)
    seen_ids: set[str] = set()
    deduped_rows: list[dict] = []
    for r in rows:
        cid = r["reddit_comment_id"]
        if cid in seen_ids:
            continue
        seen_ids.add(cid)
        deduped_rows.append(r)
    print(f"  Comments after dedup : {len(deduped_rows)}", flush=True)

    n = sb_upsert("reddit_comments", deduped_rows, "reddit_comment_id")
    print(f"\n  ✓ {n} reddit_comments upserted", flush=True)


if __name__ == "__main__":
    main()
