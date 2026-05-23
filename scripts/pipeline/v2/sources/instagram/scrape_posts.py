"""Instagram brand posts — standalone post scraper (supplements profile scraper)."""

from __future__ import annotations

from typing import Any

from ...core import supabase_client as sb
from ...core.logger import get_logger

log = get_logger("ig.posts")


def run(ctx: dict[str, Any]) -> int:
    """Posts are already fetched as part of scrape_profiles.run().

    This module exists as a hook for future standalone post scraping
    (e.g. scraping posts by hashtag). For now it returns 0 gracefully.
    """
    log.info("ig.posts: posts captured in scrape_profiles step — no additional action needed")
    return 0
