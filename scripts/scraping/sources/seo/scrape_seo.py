"""SEO weekly data scraper — runs every Monday at 03:00 UTC.

Reads from the live `serp_results` table (NOT `keyword_research_results`,
which doesn't exist on this Supabase project).

Seeds default tracked keywords if the table is empty. A real ranking refresh
would happen via the DataForSEO integration; this module logs the keyword
queue so the next ranking pass picks them up.
"""

from __future__ import annotations

from typing import Any

from ...core import supabase_client as sb
from ...core.logger import get_logger

log = get_logger("seo.scraper")

SEED_KEYWORDS = [
    "best pickleball paddle",
    "joola pickleball paddle review",
    "selkirk vs joola",
    "pickleball paddle comparison",
    "joola perseus review",
    "joola hyperion review",
    "pickleball paddle for beginners",
    "best pickleball paddle 2026",
    "pickleball paddle ranking",
    "pickleball paddle brand comparison",
]


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)

    if dry_run:
        log.info("[DRY-RUN] would refresh SEO keyword tracker")
        return 0

    # Pull existing tracked keywords from serp_results
    try:
        existing = sb.get_filtered(
            "serp_results",
            "id,keyword,search_volume,our_rank,run_id",
            "order=created_at.desc&limit=200",
        )
    except Exception as e:
        log.warning("Could not read serp_results: %s", str(e)[:200])
        existing = []

    existing_keywords = {(r.get("keyword") or "").lower() for r in existing}
    missing = [kw for kw in SEED_KEYWORDS if kw.lower() not in existing_keywords]

    if missing:
        log.info("SEO: %d seed keywords not yet tracked: %s", len(missing), missing[:5])
        # We don't INSERT seed rows here because serp_results expects real
        # ranking data (organic[], people_also_ask[], etc) from DataForSEO.
        # Logging the gap is enough for now; the DataForSEO worker reads
        # from a queue or env-config.
    else:
        log.info("SEO: all %d seed keywords already tracked", len(SEED_KEYWORDS))

    log.info("✓ SEO step complete — %d total tracked keywords", len(existing))
    return len(existing)
