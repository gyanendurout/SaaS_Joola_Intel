"""Refresh `joola_timeseries_daily` then `joola_timeseries_weekly`.

Spec:    docs/superpowers/specs/2026-05-24-analytics-mvp-design.md §6.3
Schema:  migrations/013_analytics_foundation.sql §5.4

Run order matters — weekly is a rollup of daily, so daily must be fresh
first. Both views have unique indexes, so CONCURRENTLY refresh is valid
after the first plain refresh has populated them.

Behaviour:
- Tries CONCURRENTLY first; falls back to plain refresh.
- Returns sum of post-refresh row counts of both MVs.
- Honors ctx['dry_run']  → logs intent only.
- Honors ctx['brands']   → irrelevant for MV refresh; logged only.
"""
from __future__ import annotations

from typing import Any

from analytics_backend.core.exec_sql import exec_sql
from backend.scraping.core import supabase_client as sb
from backend.scraping.core.logger import get_logger

log = get_logger("marts.refresh_timeseries")

_DAILY_MV = "joola_timeseries_daily"
_WEEKLY_MV = "joola_timeseries_weekly"


def _refresh_mv(name: str) -> None:
    """Attempt CONCURRENTLY refresh; fall back to plain if rejected."""
    log.info("Refreshing %s …", name)
    concurrent_sql = f"REFRESH MATERIALIZED VIEW CONCURRENTLY {name};"
    result = exec_sql(concurrent_sql)
    if result.get("executed"):
        return
    plain_sql = f"REFRESH MATERIALIZED VIEW {name};"
    log.info("CONCURRENTLY refresh of %s unavailable; trying plain.", name)
    fallback = exec_sql(plain_sql)
    if not fallback.get("executed"):
        log.warning(
            "Could not auto-refresh %s — downstream counts may be stale.",
            name,
        )


def _count_rows(name: str) -> int:
    """SELECT count(*) FROM <name> via PostgREST."""
    try:
        # Cheap single-column projection keeps payload minimal.
        rows = sb.get(name, select="brand_id")
        return len(rows)
    except Exception as exc:  # pragma: no cover
        log.error("Failed to count %s rows: %s", name, exc)
        return 0


def run(ctx: dict[str, Any]) -> int:
    """Refresh both timeseries MVs and return total row count."""
    dry_run = bool(ctx.get("dry_run"))
    brands = ctx.get("brands")
    if brands:
        log.info("Brand filter %s ignored — timeseries refresh is global.", brands)

    if dry_run:
        log.info("[dry-run] would refresh %s then %s", _DAILY_MV, _WEEKLY_MV)
        return 0

    # Daily must precede weekly (weekly is a SELECT FROM daily).
    _refresh_mv(_DAILY_MV)
    _refresh_mv(_WEEKLY_MV)

    daily_n = _count_rows(_DAILY_MV)
    weekly_n = _count_rows(_WEEKLY_MV)
    total = daily_n + weekly_n
    log.info("%s=%d rows, %s=%d rows (total=%d).",
             _DAILY_MV, daily_n, _WEEKLY_MV, weekly_n, total)
    return total
