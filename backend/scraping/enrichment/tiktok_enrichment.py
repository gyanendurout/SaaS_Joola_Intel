"""Task C: TikTok AI enrichment.

Enriches tiktok_videos rows that have enriched_at IS NULL with:
sentiment_label, topics, is_crisis, is_opportunity, brands_mentioned, products_mentioned.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ..core import supabase_client as sb
from ..core.logger import get_logger
from ..core.openai_client import call_openai
from ..core.settings import ENRICH_BATCH, ENRICH_WORKERS
from .ai_enricher import enrich_table

log = get_logger("enrichment.tiktok")


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    if dry_run:
        log.info("[DRY-RUN] would enrich tiktok_videos")
        return 0

    n = enrich_table(
        "tiktok_videos", "id", "id,text",
        lambda r: r.get("text") or "",
    )
    log.info("TikTok enrichment: %d rows enriched", n)
    return n
