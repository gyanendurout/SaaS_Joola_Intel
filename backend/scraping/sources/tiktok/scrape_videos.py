"""TikTok brand videos scraper.

Handles are read from the `tiktok_accounts` DB table — the single source of truth.
Seeded via migration 003. Add/remove brands by updating tiktok_accounts in Supabase,
not by editing this file.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from ...core import apify_client as apify
from ...core import supabase_client as sb
from ...core.logger import get_logger

log = get_logger("tiktok.videos")


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    tiktok_accounts = sb.get("tiktok_accounts", "id,handle,brand_id")

    # Build from DB — covers all brands seeded in tiktok_accounts
    handle_map: dict[str, dict] = {
        r["handle"].lower(): {"account_id": r["id"], "brand_id": r["brand_id"]}
        for r in tiktok_accounts
    }

    # Apply brand filter using brand_ids
    if brand_filter:
        allowed_ids = {brand_map[s] for s in brand_filter if s in brand_map}
        handle_map = {h: info for h, info in handle_map.items()
                      if info["brand_id"] in allowed_ids}

    handles = list(handle_map.keys())

    if dry_run:
        log.info("[DRY-RUN] would scrape TikTok for %d handles: %s", len(handles), handles)
        return 0

    today = date.today()
    iso_year, iso_week, _ = today.isocalendar()

    if not handles:
        log.info("No TikTok handles in DB (tiktok_accounts)")
        return 0

    items = apify.run_and_fetch("clockworks/tiktok-scraper", {
        "profiles": handles,
        "resultsPerPage": 50,
    })

    profiles: list[dict] = []
    videos: list[dict] = []
    seen: set[str] = set()

    for item in items:
        handle = (item.get("authorMeta", {}).get("name") or
                  item.get("author") or "").lower().lstrip("@")
        info = handle_map.get(handle)
        brand_id   = info["brand_id"]   if info else None
        account_id = info["account_id"] if info else None

        if handle and handle not in seen:
            seen.add(handle)
            author = item.get("authorMeta") or {}
            profiles.append({
                "account_id":   account_id,
                "brand_id":     brand_id,
                "handle":       handle,
                "followers":    author.get("fans") or author.get("followersCount"),
                "following":    author.get("following"),
                "total_hearts": author.get("heart") or author.get("heartCount") or author.get("likesCount"),
                "video_count":  author.get("video") or author.get("videoCount"),
                "week_number":  iso_week,
                "year":         iso_year,
            })

        video_id = item.get("id") or item.get("videoId")
        if not video_id:
            continue

        # createTime is a unix epoch int (seconds); convert to ISO for timestamptz.
        # createdAt may already be an ISO string — pass through unchanged.
        raw_ts = item.get("createTime") or item.get("createdAt")
        posted_at: str | None = None
        if isinstance(raw_ts, (int, float)):
            try:
                posted_at = datetime.fromtimestamp(int(raw_ts), tz=timezone.utc).isoformat()
            except (OverflowError, OSError, ValueError):
                posted_at = None
        elif isinstance(raw_ts, str) and raw_ts:
            posted_at = raw_ts

        videos.append({
            "account_id":   account_id,
            "brand_id":     brand_id,
            "handle":       handle,
            "tiktok_video_id": video_id,
            "video_url":    item.get("webVideoUrl") or f"https://www.tiktok.com/@{handle}/video/{video_id}",
            "text":         (item.get("text") or item.get("description") or "")[:2000],
            "view_count":   item.get("playCount") or (item.get("stats") or {}).get("playCount", 0),
            "like_count":   item.get("diggCount") or item.get("likeCount", 0),
            "share_count":  item.get("shareCount", 0),
            "comment_count": item.get("commentCount", 0),
            "duration_seconds": (item.get("videoMeta") or {}).get("duration"),
            "thumbnail_url": item.get("covers", [None])[0] if item.get("covers") else None,
            "posted_at":    posted_at,
        })

    p = sb.delete_insert_weekly("tiktok_profiles_weekly", profiles, "week_number", iso_week, iso_year)
    q = sb.upsert("tiktok_videos", videos, "tiktok_video_id")
    log.info("✓ %d TikTok profiles, %d videos upserted", p, q)
    return p + q
