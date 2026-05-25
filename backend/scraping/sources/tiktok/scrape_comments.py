"""TikTok comments scraper.

Pulls comment threads for the most recent TikTok videos already in `tiktok_videos`.
Requires `tiktok_comments` table (migration 014).

Apify actor: `clockworks/tiktok-comments-scraper`
  Input: { "postURLs": ["https://www.tiktok.com/@handle/video/<id>", ...] }
  Output items: { id, text, createTime, diggCount, replyCommentTotal,
                  uniqueId (commenter), replyToCommentId, videoWebUrl }

Each Apify run sized by ctx['max_videos'] (default 50) — start small to confirm
the actor + schema land cleanly, then scale.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from ...core import apify_client as apify
from ...core import supabase_client as sb
from ...core.logger import get_logger

log = get_logger("tiktok.comments")

_DEFAULT_MAX_VIDEOS = 50
_DEFAULT_COMMENTS_PER_VIDEO = 50


def _to_iso(raw_ts: Any) -> str | None:
    """createTime is typically a unix epoch int (seconds). Coerce to ISO."""
    if isinstance(raw_ts, (int, float)):
        try:
            return datetime.fromtimestamp(int(raw_ts), tz=timezone.utc).isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(raw_ts, str) and raw_ts:
        return raw_ts
    return None


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")
    max_videos: int = int(ctx.get("max_videos") or _DEFAULT_MAX_VIDEOS)
    comments_per_video: int = int(ctx.get("comments_per_video") or _DEFAULT_COMMENTS_PER_VIDEO)

    # Brand-id → slug lookup so we can apply --brands filter on TikTok videos.
    brand_rows = sb.get("brands", "id,slug")
    slug_by_id = {r["id"]: r["slug"] for r in brand_rows}
    allowed_ids: set[str] | None = None
    if brand_filter:
        allowed_ids = {bid for bid, slug in slug_by_id.items() if slug in brand_filter}

    # Pull the most recent N videos with URLs. Order by posted_at if available,
    # falling back to created_at on the row.
    videos = sb.get(
        "tiktok_videos",
        "id,brand_id,tiktok_video_id,video_url,posted_at,handle",
    )
    if allowed_ids is not None:
        videos = [v for v in videos if v.get("brand_id") in allowed_ids]

    # Most recent first
    videos.sort(key=lambda v: v.get("posted_at") or "", reverse=True)
    videos = videos[:max_videos]

    if not videos:
        log.info("No tiktok_videos to scrape comments for (max_videos=%d)", max_videos)
        return 0

    video_url_to_meta: dict[str, dict[str, Any]] = {}
    post_urls: list[str] = []
    for v in videos:
        url = v.get("video_url")
        if not url:
            continue
        video_url_to_meta[url] = {
            "video_pk": v["id"],
            "brand_id": v.get("brand_id"),
            "handle": v.get("handle"),
        }
        post_urls.append(url)

    if dry_run:
        log.info("[DRY-RUN] would scrape comments for %d videos", len(post_urls))
        return 0

    log.info("Scraping comments for %d videos (%d comments each)",
             len(post_urls), comments_per_video)

    try:
        items = apify.run_and_fetch("clockworks/tiktok-comments-scraper", {
            "postURLs": post_urls,
            "commentsPerPost": comments_per_video,
        })
    except Exception as exc:
        log.error("Apify clockworks/tiktok-comments-scraper failed: %s", exc)
        return 0

    rows: list[dict[str, Any]] = []
    for item in items:
        # The actor returns comments enriched with a `videoWebUrl` field pointing
        # back to the source video. Use it to thread brand_id + video FK.
        src_url = item.get("videoWebUrl") or item.get("postUrl") or ""
        meta = video_url_to_meta.get(src_url, {})
        comment_id = item.get("id") or item.get("commentId") or item.get("cid")
        if not comment_id:
            continue
        rows.append({
            "tiktok_comment_id":   str(comment_id),
            "video_id":            meta.get("video_pk"),
            "brand_id":            meta.get("brand_id"),
            "commenter_username":  item.get("uniqueId") or item.get("username") or item.get("nickName"),
            "comment_text":        item.get("text") or item.get("comment") or "",
            "comment_likes":       item.get("diggCount") or item.get("likes") or 0,
            "reply_to_comment_id": item.get("replyToCommentId"),
            "posted_at":           _to_iso(item.get("createTime") or item.get("createdAt")),
        })

    if not rows:
        log.info("No comment rows extracted from Apify output (got %d items)", len(items))
        return 0

    # Upsert on tiktok_comment_id — the unique key from migration 014.
    n = sb.upsert("tiktok_comments", rows, on_conflict="tiktok_comment_id")
    log.info("Upserted %d tiktok_comments rows", n)
    return int(n)
