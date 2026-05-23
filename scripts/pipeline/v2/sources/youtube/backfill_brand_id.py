"""Fix JOOLA YouTube comments that have wrong brand_id (assigned to Engage).

Root cause: The yt_channels mapping lookup failed for JOOLA's channel URL,
so comments scraped during early runs were assigned to the fallback brand (Engage).
This one-time fix reassigns them to JOOLA's correct brand_id.

yt_comments has NO channel_id column — it has video_id. We join through
yt_videos to find the channel each comment belongs to.

Run via: python -m scripts.pipeline.v2.run --module maintenance --source backfill_youtube_comments
"""

from __future__ import annotations

from typing import Any

from ...core import supabase_client as sb
from ...core.logger import get_logger
from ...core.settings import JOOLA_BRAND_ID

log = get_logger("yt.backfill_brand_id")

ENGAGE_SLUG = "engage"


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)

    brands = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    engage_id = brands.get(ENGAGE_SLUG)
    if not engage_id:
        log.error("Cannot find brand_id for slug 'engage'")
        return 0

    # Find JOOLA's YT channel IDs
    joola_channels = sb.get_filtered(
        "yt_channels", "id,channel_url",
        f"brand_id=eq.{JOOLA_BRAND_ID}",
    )
    joola_channel_ids = [c["id"] for c in joola_channels]
    log.info("JOOLA channel IDs: %s", joola_channel_ids)

    if not joola_channel_ids:
        log.warning("No yt_channels found for JOOLA brand_id=%s", JOOLA_BRAND_ID)
        return 0

    # Pull JOOLA's videos so we can map video_id → comment ownership
    joola_videos = sb.get_filtered(
        "yt_videos", "id,channel_id",
        f"channel_id=in.({','.join(joola_channel_ids)})&limit=5000",
    )
    joola_video_ids = {v["id"] for v in joola_videos}
    if not joola_video_ids:
        log.info("No yt_videos found under JOOLA's channels")
        return 0

    # Find YT comments mis-attributed to Engage that actually belong to JOOLA videos
    wrong_comments = sb.get_filtered(
        "yt_comments", "id,brand_id,video_id",
        f"brand_id=eq.{engage_id}&limit=5000",
    )
    to_fix = [c for c in wrong_comments if c.get("video_id") in joola_video_ids]
    log.info("Found %d yt_comments to reassign from engage → joola", len(to_fix))

    if dry_run:
        log.info("[DRY-RUN] would reassign %d yt_comment rows", len(to_fix))
        return len(to_fix)

    fixed = 0
    for c in to_fix:
        if sb.patch("yt_comments", c["id"], {"brand_id": JOOLA_BRAND_ID}):
            fixed += 1

    log.info("✓ Fixed %d/%d yt_comments brand_id", fixed, len(to_fix))
    return fixed
