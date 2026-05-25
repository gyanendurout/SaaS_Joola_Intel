"""YouTube channel profiles and video scraper.

Task A fix: sets is_short=True for videos with duration <= 60s or /shorts/ URL.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from ...core import apify_client as apify
from ...core import supabase_client as sb
from ...core.logger import get_logger

log = get_logger("yt.channels")


def _duration_to_seconds(s: str | None) -> int | None:
    if not s:
        return None
    try:
        parts = [int(p) for p in s.split(":")]
        if len(parts) == 3:
            return parts[0] * 3600 + parts[1] * 60 + parts[2]
        if len(parts) == 2:
            return parts[0] * 60 + parts[1]
        return parts[0]
    except Exception:
        return None


def _is_short(item: dict) -> bool:
    url = (item.get("url") or "").lower()
    if "/shorts/" in url:
        return True
    dur = _duration_to_seconds(item.get("duration"))
    return dur is not None and dur <= 60


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    yt_rows = sb.get("yt_channels", "id,channel_url,brand_id")
    yt_map = {r["channel_url"].rstrip("/"): {"channel_id": r["id"], "brand_id": r["brand_id"]}
              for r in yt_rows}

    if brand_filter:
        brand_ids = {r["id"] for r in sb.get("brands", "id,slug") if r["slug"] in brand_filter}
        yt_map = {k: v for k, v in yt_map.items() if v["brand_id"] in brand_ids}

    if dry_run:
        log.info("[DRY-RUN] would scrape %d YT channels", len(yt_map))
        return 0

    today = date.today()
    iso_year, iso_week, _ = today.isocalendar()

    items = apify.run_and_fetch("streamers/youtube-scraper", {
        "startUrls": [{"url": u} for u in yt_map.keys()],
        "maxResults": 100,
        "maxResultsShorts": 50,
    })
    log.info("Apify returned %d items for %d input URLs", len(items), len(yt_map))
    if items:
        sample = items[0]
        log.info("First item keys: %s", sorted(sample.keys())[:30])
        log.info("First item inputUrl=%r channelUrl=%r channelName=%r channelHandle=%r",
                 sample.get("inputUrl"), sample.get("channelUrl"),
                 sample.get("channelName"), sample.get("channelHandle"))

    # Build name-based fallback lookup (URL tail like "selkirksport" → row).
    # Also build a "compact" form (alphanumerics only, lowercase) so that an
    # Apify channelName like "Selkirk Sport" reduces to "selkirksport" and
    # still matches the URL tail.
    import re as _re
    def _compact(s: str) -> str:
        return _re.sub(r"[^a-z0-9]", "", (s or "").lower())

    name_to_info: dict[str, tuple[str, dict]] = {}
    compact_to_info: dict[str, tuple[str, dict]] = {}
    for stored_url, info in yt_map.items():
        tail = stored_url.rstrip("/").rsplit("/", 1)[-1].lstrip("@").lower()
        if tail:
            name_to_info[tail] = (stored_url, info)
            compact_to_info[_compact(tail)] = (stored_url, info)

    channel_snapshots: dict[str, dict] = {}
    videos: list[dict] = []
    unmatched: set[str] = set()

    for item in items:
        input_url   = (item.get("inputUrl") or item.get("inputChannelUrl") or "").rstrip("/")
        ch_url      = (item.get("channelUrl") or "").rstrip("/")
        ch_name     = (item.get("channelName") or "").lstrip("@").lower()
        ch_handle   = (item.get("channelHandle") or "").lstrip("@").lower()
        ch_username = (item.get("channelUsername") or "").lstrip("@").lower()

        info = yt_map.get(input_url) or yt_map.get(ch_url)
        matched_url = input_url if yt_map.get(input_url) else (ch_url if yt_map.get(ch_url) else None)

        if not info:
            for stored_url, stored_info in yt_map.items():
                lo = stored_url.lower()
                if (ch_url and lo in ch_url.lower()) or (input_url and lo in input_url.lower()):
                    info = stored_info
                    matched_url = stored_url
                    break

        # channelUsername is the @handle without the @ (e.g. "SelkirkSport").
        # This is the most reliable identifier the Apify actor exposes.
        if not info and ch_username and ch_username in name_to_info:
            matched_url, info = name_to_info[ch_username]
        if not info and ch_username:
            compact_user = _compact(ch_username)
            if compact_user and compact_user in compact_to_info:
                matched_url, info = compact_to_info[compact_user]

        if not info and ch_handle and ch_handle in name_to_info:
            matched_url, info = name_to_info[ch_handle]

        if not info and ch_name and ch_name in name_to_info:
            matched_url, info = name_to_info[ch_name]

        # Final lenient pass: collapse channelName to alphanumerics and try
        # compact match (handles "Selkirk Sport - We Are Pickleball" → no
        # match, but channelUsername path above should already have caught it).
        if not info:
            compact_name = _compact(ch_name) or _compact(ch_handle)
            if compact_name and compact_name in compact_to_info:
                matched_url, info = compact_to_info[compact_name]

        if not info:
            key = ch_url or input_url or ch_name
            if key not in unmatched:
                log.warning("No yt_channels record for: %r (channelName=%r channelUsername=%r channelHandle=%r)",
                            key, item.get("channelName"), item.get("channelUsername"), item.get("channelHandle"))
                unmatched.add(key)
            continue

        brand_id   = info["brand_id"]
        channel_id = info["channel_id"]
        ch_key     = matched_url or ch_url

        if ch_key not in channel_snapshots:
            channel_snapshots[ch_key] = {
                "channel_id":   channel_id,
                "brand_id":     brand_id,
                "subscribers":  item.get("numberOfSubscribers"),
                "total_videos": item.get("channelTotalVideos"),
                "total_views":  item.get("channelTotalViews"),
                "week_number":  iso_week,
                "year":         iso_year,
            }

        vid_id = item.get("id") or item.get("videoId")
        if not vid_id:
            continue

        dur_s = _duration_to_seconds(item.get("duration"))
        videos.append({
            "channel_id":        channel_id,
            "brand_id":          brand_id,
            "youtube_video_id":  vid_id,
            "video_url":         item.get("url"),
            "title":             item.get("title"),
            "description":       (item.get("description") or "")[:1000],
            "view_count":        item.get("viewCount", 0),
            "like_count":        item.get("likes", 0),
            "comment_count":     item.get("commentsCount", 0),
            "duration_seconds":  dur_s,
            "thumbnail_url":     item.get("thumbnailUrl"),
            "published_at":      item.get("date"),
            "is_short":          _is_short(item),
            "is_sponsored":      False,
            "is_live_recording": False,
        })

    p = sb.delete_insert_weekly(
        "yt_channel_weekly", list(channel_snapshots.values()), "week_number", iso_week, iso_year
    )
    q = sb.upsert("yt_videos", videos, "youtube_video_id")
    log.info("✓ %d channel snapshots, %d videos upserted", p, q)
    return p + q
