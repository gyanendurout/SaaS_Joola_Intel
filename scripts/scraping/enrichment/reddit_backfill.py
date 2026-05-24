"""Task E: Reddit sentiment backfill.

Fills in sentiment_label for reddit_mentions rows where it is still NULL
(enriched_at IS NULL rows), prioritising older data that missed the first
enrichment run.
"""

from __future__ import annotations

from typing import Any

from ..core.logger import get_logger
from .ai_enricher import enrich_table

log = get_logger("enrichment.reddit_backfill")


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    if dry_run:
        log.info("[DRY-RUN] would backfill reddit_mentions sentiment")
        return 0

    n = enrich_table(
        "reddit_mentions", "id", "id,post_title,content_text",
        lambda r: (r.get("post_title") or "") + "\n" + (r.get("content_text") or ""),
    )
    log.info("Reddit sentiment backfill: %d rows enriched", n)
    return n
