"""Instagram comments scraper — fetches comments on recent brand posts.

Matches the live Supabase schema:
  ig_comments(instagram_comment_id, post_id, brand_id,
              commenter_username, comment_text, comment_likes, posted_at)
Conflict key: instagram_comment_id
"""

from __future__ import annotations

from typing import Any

from ...core import apify_client as apify
from ...core import supabase_client as sb
from ...core.logger import get_logger

log = get_logger("ig.comments")


def _norm_ig(url: str) -> str:
    return (url or "").split("?")[0].rstrip("/")


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    if brand_filter:
        brand_map = {k: v for k, v in brand_map.items() if k in brand_filter}

    # Pull recent posts that have at least one comment
    posts = sb.get_filtered(
        "ig_posts",
        "id,instagram_post_id,post_url,brand_id,comment_count",
        "comment_count=gt.0&order=posted_at.desc&limit=200",
    )

    # Top posts per brand by comment_count (cap to keep scraper cheap)
    from collections import defaultdict
    by_brand: dict[str, list[dict]] = defaultdict(list)
    for p in posts:
        by_brand[p["brand_id"]].append(p)
    selected: list[dict] = []
    for brand_id, lst in by_brand.items():
        lst.sort(key=lambda x: x.get("comment_count") or 0, reverse=True)
        selected.extend(lst[:20])

    url_to_post = {_norm_ig(p["post_url"]): p for p in selected if p.get("post_url")}
    post_urls = list(url_to_post.keys())

    if not post_urls:
        log.info("No IG posts to scrape comments for")
        return 0

    if dry_run:
        log.info("[DRY-RUN] would scrape comments for %d posts", len(post_urls))
        return 0

    items = apify.run_and_fetch("apify/instagram-comment-scraper", {
        "directUrls": post_urls,
        "resultsLimit": 30,
        "includeNestedComments": False,
    })

    rows: list[dict] = []
    for item in items:
        post_url = _norm_ig(item.get("postUrl") or item.get("ownerPostUrl") or "")
        post = url_to_post.get(post_url)
        if not post:
            for u, p in url_to_post.items():
                if u in post_url or post_url in u:
                    post = p
                    break
        if not post:
            continue
        rows.append({
            "instagram_comment_id": item.get("id"),
            "post_id":              post["id"],
            "brand_id":             post["brand_id"],
            "commenter_username":   item.get("ownerUsername") or item.get("username"),
            "comment_text":         (item.get("text") or "")[:2000],
            "comment_likes":        item.get("likesCount", 0),
            "posted_at":            item.get("timestamp"),
        })

    n = sb.upsert("ig_comments", rows, "instagram_comment_id")
    log.info("✓ %d IG comments upserted", n)
    return n
