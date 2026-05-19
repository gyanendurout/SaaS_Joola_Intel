"""
Re-process Apify run je77gBBGV9SnIVqGK which already succeeded (1603 comments)
but the upsert failed due to within-batch duplicates. Re-fetch results (free)
and upsert with dedup.
"""

import os, sys, re
try: sys.stdout.reconfigure(encoding="utf-8")
except: pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apify_to_supabase import fetch_results, sb_get, sb_upsert

RUN_ID = "je77gBBGV9SnIVqGK"


def extract_t1_id(item_id, url=""):
    if not item_id:
        m = re.search(r"/comment/([a-z0-9]+)/?", url or "", re.I)
        return f"t1_{m.group(1)}" if m else ""
    sid = str(item_id)
    return sid if sid.startswith("t1_") else f"t1_{sid}"


if __name__ == "__main__":
    print(f"Re-fetching items from Apify run {RUN_ID}…", flush=True)
    items = fetch_results(RUN_ID)
    print(f"  {len(items)} items", flush=True)

    # Build URL → parent_post map
    posts = sb_get("reddit_mentions", "id,brand_id,post_url,subreddit")
    url_to_post = {(p["post_url"] or "").split("?")[0].rstrip("/"): p
                   for p in posts if p.get("post_url")}

    rows = []
    seen_ids = set()
    for item in items:
        item_type = (item.get("dataType") or item.get("type") or "").lower()
        if item_type not in ("comment", "comments"):
            if not (item.get("commentId") or item.get("parentId")
                    or "/comment/" in (item.get("url") or "")):
                continue

        parent_url = (item.get("postUrl") or item.get("parentUrl") or "").split("?")[0].rstrip("/")
        if not parent_url:
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
        if not comment_id or comment_id in seen_ids:
            continue
        seen_ids.add(comment_id)

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

    print(f"  Unique comments to upsert: {len(rows)}", flush=True)
    n = sb_upsert("reddit_comments", rows, "reddit_comment_id")
    print(f"  ✓ {n} reddit_comments upserted", flush=True)
