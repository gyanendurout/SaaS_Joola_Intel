"""YouTube video scraper — standalone module (videos already fetched in scrape_channels)."""

from __future__ import annotations

from typing import Any

from ...core.logger import get_logger

log = get_logger("yt.videos")


def run(ctx: dict[str, Any]) -> int:
    """Videos are captured in scrape_channels.run(). No additional action needed."""
    log.info("yt.videos: videos captured in scrape_channels step")
    return 0
