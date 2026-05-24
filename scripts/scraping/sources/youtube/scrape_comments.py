"""YouTube comments scraper — fetches comments on recent brand videos."""

from __future__ import annotations

import re
from typing import Any

from ...core import apify_client as apify
from ...core import supabase_client as sb
from ...core.logger import get_logger


def _yt_vid_id(url: str) -> str | None:
    """Extract YouTube video ID from any URL format."""
    m = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", url or "")
    return m.group(1) if m else None

log = get_logger("yt.comments")


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    if brand_filter:
        brand_map = {k: v for k, v in brand_map.items() if k in brand_filter}
    brand_ids = set(brand_map.values())

    # Get recent videos to scrape comments for
    videos = sb.get_filtered(
        "yt_videos",
        "id,youtube_video_id,video_url,brand_id,channel_id,comment_count",
        "comment_count=gt.0&order=published_at.desc&limit=100",
    )
    videos = [v for v in videos if v.get("brand_id") in brand_ids]

    video_urls = [v["video_url"] for v in videos if v.get("video_url")]
    if not video_urls:
        log.info("No YT videos found to scrape comments for")
        return 0

    if dry_run:
        log.info("[DRY-RUN] would scrape comments for %d videos", len(video_urls))
        return 0

    url_to_video: dict[str, dict] = {v["video_url"]: v for v in videos}
    # fallback: match by extracted YouTube video ID (handles youtu.be vs youtube.com/watch?v= mismatches)
    ytid_to_video: dict[str, dict] = {
        _yt_vid_id(v["video_url"]): v
        for v in videos
        if _yt_vid_id(v["video_url"])
    }

    items = apify.run_and_fetch("streamers/youtube-comments-scraper", {
        "startUrls": [{"url": u} for u in video_urls[:50]],
        "maxComments": 200,
    })

    seen: dict[str, dict] = {}
    for item in items:
        video_url = item.get("videoUrl") or item.get("url") or item.get("inputUrl") or ""
        vid = url_to_video.get(video_url) or ytid_to_video.get(_yt_vid_id(video_url))
        brand_id = vid["brand_id"] if vid else None
        vid_uuid  = vid["id"]       if vid else None  # yt_videos.id (uuid)

        yt_comment_id = item.get("commentId") or item.get("id") or item.get("comment_id")
        if not yt_comment_id:
            continue

        seen[yt_comment_id] = {
            "youtube_comment_id": yt_comment_id,
            "video_id":           vid_uuid,
            "brand_id":           brand_id,
            "commenter_username": item.get("authorDisplayName") or item.get("author"),
            "comment_text":       (item.get("textOriginal") or item.get("text") or "")[:2000],
            "comment_likes":      item.get("likeCount", 0),
            "posted_at":          item.get("publishedAt") or item.get("timestamp"),
        }

    rows = list(seen.values())

    n = sb.upsert("yt_comments", rows, "youtube_comment_id")
    log.info("✓ %d YT comments upserted", n)
    return n
