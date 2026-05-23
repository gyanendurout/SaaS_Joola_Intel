"""Reddit comments scraper — fetches comment trees for recent brand mentions."""

from __future__ import annotations

from typing import Any

from ...core import apify_client as apify
from ...core import supabase_client as sb
from ...core.logger import get_logger

log = get_logger("reddit.comments")


def _reddit_post_id(post_url: str) -> str | None:
    """Extract Reddit's own post ID (e.g. 'abc123') from the URL."""
    try:
        parts = post_url.split("/comments/")
        return parts[1].split("/")[0] if len(parts) > 1 else None
    except Exception:
        return None


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    if brand_filter:
        brand_map = {k: v for k, v in brand_map.items() if k in brand_filter}
    brand_ids = set(brand_map.values())

    # reddit_mentions has no post_id column — select id,post_url only
    mentions = sb.get_filtered(
        "reddit_mentions",
        "id,post_url,brand_id,num_comments",
        "num_comments=gt.0&order=posted_at.desc&limit=50",
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

    rows: list[dict] = []
    for item in items:
        parent_url = item.get("postUrl") or item.get("inputUrl") or ""
        mention = url_to_mention.get(parent_url)
        brand_id = mention["brand_id"] if mention else None
        # Extract Reddit's own alphanumeric post ID from the URL
        post_id = _reddit_post_id(parent_url) if parent_url else None

        comment_id = item.get("id") or item.get("commentId")
        if not comment_id:
            continue

        rows.append({
            "post_id":      post_id,
            "brand_id":     brand_id,
            "comment_id":   comment_id,
            "author":       item.get("author"),
            "comment_text": (item.get("body") or item.get("text") or "")[:3000],
            "upvotes":      item.get("score", 0),
            "posted_at":    item.get("createdAt") or item.get("created_utc"),
            "parent_id":    item.get("parentId"),
            "depth":        item.get("depth", 0),
        })

    n = sb.upsert("reddit_comments", rows, "comment_id")
    log.info("✓ %d Reddit comments upserted", n)
    return n
