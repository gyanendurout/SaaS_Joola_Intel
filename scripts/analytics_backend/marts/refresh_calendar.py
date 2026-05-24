"""Refresh `dim_brand_calendar` materialized view.

Spec: docs/superpowers/specs/2026-05-24-analytics-mvp-design.md §6.1
Schema: migrations/013_analytics_foundation.sql §5.2

The calendar is a dense (brand × day) spine from 2025-01-01 → current_date
in each brand's local timezone. Refreshing it extends the trailing edge to
today.

Behaviour:
- Tries `REFRESH MATERIALIZED VIEW CONCURRENTLY` first (cheap subsequent runs).
- Falls back to plain `REFRESH MATERIALIZED VIEW` if CONCURRENTLY is rejected
  (e.g. the very first refresh after creation has no prior snapshot).
- Returns the row count of `dim_brand_calendar` after refresh.
- Honors ctx['dry_run']  → logs "would refresh" and returns 0.
- Honors ctx['brands']   → irrelevant for calendar refresh; logged only.
"""
from __future__ import annotations

from typing import Any

from scripts.analytics_backend.core.exec_sql import exec_sql
from scripts.scraping.core import supabase_client as sb
from scripts.scraping.core.logger import get_logger

log = get_logger("marts.refresh_calendar")

_MV_NAME = "dim_brand_calendar"


def _count_rows() -> int:
    """SELECT count(*) FROM dim_brand_calendar via PostgREST."""
    try:
        rows = sb.get(_MV_NAME, select="brand_id")
        return len(rows)
    except Exception as exc:  # pragma: no cover
        log.error("Failed to count %s rows: %s", _MV_NAME, exc)
        return 0


def run(ctx: dict[str, Any]) -> int:
    """Refresh dim_brand_calendar and return its post-refresh row count."""
    dry_run = bool(ctx.get("dry_run"))
    brands = ctx.get("brands")
    if brands:
        log.info("Brand filter %s ignored — calendar refresh is global.", brands)

    if dry_run:
        log.info("[dry-run] would REFRESH MATERIALIZED VIEW %s", _MV_NAME)
        return 0

    log.info("Refreshing %s (concurrent first, plain fallback)…", _MV_NAME)
    concurrent_sql = f"REFRESH MATERIALIZED VIEW CONCURRENTLY {_MV_NAME};"
    result = exec_sql(concurrent_sql)

    if not result.get("executed"):
        plain_sql = f"REFRESH MATERIALIZED VIEW {_MV_NAME};"
        log.info("CONCURRENTLY refresh unavailable; trying plain refresh.")
        fallback = exec_sql(plain_sql)
        if not fallback.get("executed"):
            log.warning(
                "Could not auto-refresh %s — proceeding to count what's currently materialized.",
                _MV_NAME,
            )

    n = _count_rows()
    log.info("%s now has %d rows.", _MV_NAME, n)
    return n
