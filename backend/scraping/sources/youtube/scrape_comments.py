"""YouTube comments scraper — fetches comments on recent brand videos.

Why this was returning 0 rows (TODO.md, confirmed 2026-08-18):

  1. **Field-name mismatch — the actual cause.** `streamers/youtube-comments-scraper`
     returns `cid` / `comment` / `voteCount` / `publishedTimeText` / `videoId` /
     `pageUrl`. This module read `commentId` / `textOriginal` / `likeCount` /
     `publishedAt` / `videoUrl`. Because the comment id resolved to None, every
     single item hit the `continue` and the step upserted 0 rows while the actor
     run itself succeeded. The 1,000 rows already in `yt_comments` all carry
     `posted_at = NULL` and `comment_likes = 0` for the same reason.

  2. **URL shape.** `yt_videos.video_url` is not reliably a watch URL — 401 of
     819 rows are `/shorts/<id>` and a couple are channel placeholders
     (`youtube.com/@onixpickleball` with a synthetic id like `onix_pb_001`).
     The actor wants watch URLs, and `_yt_vid_id()` could not parse `/shorts/`
     either, so mapping a comment back to its video failed as well. Inputs are
     now built canonically from `youtube_video_id`, which is a valid 11-char id
     on 818 of 819 rows.

TODO.md guessed the actor needed individual video URLs rather than a channel
URL. It was already passing individual URLs; that hypothesis was wrong.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

from ...core import apify_client as apify
from ...core import supabase_client as sb
from ...core.logger import get_logger

log = get_logger("yt.comments")

MAX_VIDEOS_PER_RUN = 50
MAX_COMMENTS_PER_VIDEO = 200

_YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")

# Covers watch?v=, youtu.be/, /shorts/, /embed/ and /live/. The old pattern only
# handled the first two, which missed every Short.
_YT_ID_IN_URL = re.compile(
    r"(?:v=|youtu\.be/|/shorts/|/embed/|/live/)([A-Za-z0-9_-]{11})"
)

_RELATIVE = re.compile(r"(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago")
_UNIT_SECONDS = {
    "second": 1, "minute": 60, "hour": 3600, "day": 86400,
    "week": 604800, "month": 2592000, "year": 31536000,
}


def _yt_vid_id(url: str) -> str | None:
    """Extract a YouTube video ID from any URL format."""
    m = _YT_ID_IN_URL.search(url or "")
    return m.group(1) if m else None


def _watch_url(video_id: str) -> str:
    return "https://www.youtube.com/watch?v=" + video_id


def _relative_to_iso(text: str | None, now: datetime) -> str | None:
    """"12 hours ago" -> an ISO timestamp.

    The actor only exposes a relative string (`publishedTimeText`), never an
    absolute date, so this is necessarily approximate — month is 30 days, year
    is 365. Approximate-but-present beats the NULL that every existing row has:
    week-over-week trend queries can at least bucket these.
    """
    if not text:
        return None
    m = _RELATIVE.search(text.lower())
    if not m:
        return None
    secs = int(m.group(1)) * _UNIT_SECONDS[m.group(2)]
    return (now - timedelta(seconds=secs)).isoformat()


def _pick(item: dict[str, Any], *keys: str) -> Any:
    """First present, non-empty value among `keys`.

    Kept deliberately tolerant: the current actor output is authoritative but
    Apify actors rename fields between versions, and a silent None here is what
    caused the original bug.
    """
    for k in keys:
        v = item.get(k)
        if v not in (None, ""):
            return v
    return None


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    if brand_filter:
        brand_map = {k: v for k, v in brand_map.items() if k in brand_filter}
    brand_ids = set(brand_map.values())

    videos = sb.get_filtered(
        "yt_videos",
        "id,youtube_video_id,video_url,brand_id,channel_id,comment_count",
        "comment_count=gt.0&order=published_at.desc&limit=200",
    )
    videos = [v for v in videos if v.get("brand_id") in brand_ids]

    # Canonical watch URL per video, keyed by the 11-char YouTube id. Prefer
    # youtube_video_id; fall back to parsing video_url. Rows with neither are
    # placeholder seeds (e.g. youtube_video_id='onix_pb_001') and are skipped —
    # feeding a channel URL to a comments actor returns nothing useful.
    by_ytid: dict[str, dict] = {}
    skipped = 0
    for v in videos:
        ytid = (v.get("youtube_video_id") or "").strip()
        if not _YT_ID.match(ytid):
            ytid = _yt_vid_id(v.get("video_url") or "") or ""
        if not _YT_ID.match(ytid):
            skipped += 1
            continue
        by_ytid.setdefault(ytid, v)

    if skipped:
        log.info("skipped %d video rows with no usable YouTube id "
                 "(placeholder/channel rows)", skipped)

    targets = list(by_ytid.items())[:MAX_VIDEOS_PER_RUN]
    if not targets:
        log.info("No YT videos found to scrape comments for")
        return 0

    if dry_run:
        log.info("[DRY-RUN] would scrape comments for %d videos", len(targets))
        return 0

    items = apify.run_and_fetch("streamers/youtube-comments-scraper", {
        "startUrls": [{"url": _watch_url(ytid)} for ytid, _ in targets],
        "maxComments": MAX_COMMENTS_PER_VIDEO,
    })

    now = datetime.now(timezone.utc)
    seen: dict[str, dict] = {}
    unmatched_videos = 0

    for item in items:
        # `cid` is the real field; the rest are version-tolerance fallbacks.
        yt_comment_id = _pick(item, "cid", "commentId", "id", "comment_id")
        if not yt_comment_id:
            continue

        # Map back to the yt_videos row by video id — far more robust than
        # string-matching a URL that comes in several shapes.
        ytid = _pick(item, "videoId", "video_id") or _yt_vid_id(
            _pick(item, "pageUrl", "videoUrl", "url", "inputUrl") or "")
        vid = by_ytid.get(ytid) if ytid else None
        if not vid:
            unmatched_videos += 1

        likes = _pick(item, "voteCount", "likeCount", "votes") or 0
        try:
            likes = int(likes)
        except (TypeError, ValueError):
            likes = 0

        posted_at = _relative_to_iso(
            _pick(item, "publishedTimeText", "publishedAt", "timestamp"), now)

        seen[yt_comment_id] = {
            "youtube_comment_id":  yt_comment_id,
            "video_id":            vid["id"] if vid else None,
            "brand_id":            vid["brand_id"] if vid else None,
            "commenter_username":  _pick(item, "author", "authorDisplayName"),
            "comment_text":        str(_pick(item, "comment", "textOriginal",
                                             "text") or "")[:2000],
            "comment_likes":       likes,
            "reply_to_comment_id": _pick(item, "replyToCid", "parentCommentId"),
            "posted_at":           posted_at,
        }

    rows = list(seen.values())
    if unmatched_videos:
        log.warning("%d comments could not be matched to a yt_videos row "
                    "(brand_id/video_id left null)", unmatched_videos)

    n = sb.upsert("yt_comments", rows, "youtube_comment_id") if rows else 0
    log.info("%d YT comments upserted (%d actor items, %d unique)",
             n, len(items), len(rows))

    # The original bug looked exactly like this: actor run succeeded, every item
    # silently discarded, step reported done. Fail loudly instead.
    if items and not rows:
        raise RuntimeError(
            "yt_comments: actor returned " + str(len(items)) + " items but none "
            "produced a row — the comment-id field was almost certainly renamed. "
            "Inspect the Apify dataset and update _pick() in this module."
        )
    return n
