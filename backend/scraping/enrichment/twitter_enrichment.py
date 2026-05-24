"""Task D: X/Twitter AI enrichment.

Enriches x_posts rows that have enriched_at IS NULL.
"""

from __future__ import annotations

from typing import Any

from ..core.logger import get_logger
from .ai_enricher import enrich_table

log = get_logger("enrichment.twitter")


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    if dry_run:
        log.info("[DRY-RUN] would enrich x_posts")
        return 0

    n = enrich_table(
        "x_posts", "id", "id,text",
        lambda r: r.get("text") or "",
    )
    log.info("X/Twitter enrichment: %d rows enriched", n)
    return n
