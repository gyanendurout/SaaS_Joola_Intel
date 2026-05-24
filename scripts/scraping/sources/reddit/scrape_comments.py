"""Reddit comments scraper — fetches comment trees for recent brand mentions."""

from __future__ import annotations

from typing import Any

from ...core import apify_client as apify
from ...core import supabase_client as sb
from ...core.logger import get_logger

log = get_logger("reddit.comments")



def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    if brand_filter:
        brand_map = {k: v for k, v in brand_map.items() if k in brand_filter}
    brand_ids = set(brand_map.values())

    mentions = sb.get_filtered(
        "reddit_mentions",
        "id,post_url,brand_id,subreddit",
        "order=posted_at.desc&limit=50",
    )
    mentions = [m for m in mentions if m.get("brand_id") in brand_ids]

    post_urls = [m["post_url"] for m in mentions if m.get("post_url")]
    if not post_urls:
        log.info("No Reddit mentions found to fetch comments for")
        return 0

    if dry_run:
        log.info("[DRY-RUN] would scrape comments for %d posts", len(post_urls))
        return 0

    url_to_mention: dict[str, dict] = {m["post_url"]: m for m in mentions}

    items = apify.run_and_fetch("trudax/reddit-scraper-lite", {
        "startUrls": [{"url": u} for u in post_urls[:30]],
        "maxItems": 200,
        "includeComments": True,
    })

    seen: dict[str, dict] = {}
    for item in items:
        parent_url = item.get("postUrl") or item.get("inputUrl") or ""
        mention = url_to_mention.get(parent_url)
        brand_id     = mention["brand_id"]      if mention else None
        mention_uuid = mention["id"]            if mention else None  # FK → reddit_mentions.id
        subreddit    = mention.get("subreddit") if mention else None

        reddit_comment_id = item.get("id") or item.get("commentId")
        if not reddit_comment_id:
            continue

        seen[reddit_comment_id] = {
            "reddit_comment_id": reddit_comment_id,
            "parent_post_id":    mention_uuid,
            "brand_id":          brand_id,
            "subreddit":         subreddit,
            "author":            item.get("author"),
            "comment_text":      (item.get("body") or item.get("text") or "")[:3000],
            "upvotes":           item.get("score", 0),
            "posted_at":         item.get("createdAt") or item.get("created_utc"),
            "depth":             item.get("depth", 0),
        }

    rows = list(seen.values())
    n = sb.upsert("reddit_comments", rows, "reddit_comment_id")
    log.info("✓ %d Reddit comments upserted", n)
    return n
