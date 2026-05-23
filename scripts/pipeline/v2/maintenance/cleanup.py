"""Cleanup utilities — removes stale data and manages storage."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from ..core import supabase_client as sb
from ..core.logger import get_logger

log = get_logger("maintenance.cleanup")

RETENTION_DAYS = 180  # keep 6 months of snapshots


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)

    cutoff = (date.today() - timedelta(days=RETENTION_DAYS)).isoformat()
    log.info("Cleanup: removing records older than %s (%d days)", cutoff, RETENTION_DAYS)

    if dry_run:
        log.info("[DRY-RUN] would delete product_snapshots older than %s", cutoff)
        return 0

    # Clean old product snapshots (these accumulate fast)
    try:
        from ..core.network import http_request
        from ..core.settings import require_supabase
        url, key = require_supabase()
        hdrs = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        del_url = f"{url}/rest/v1/product_snapshots?snapshot_time=lt.{cutoff}"
        resp = http_request("DELETE", del_url, headers=hdrs, timeout=30)
        log.info("product_snapshots cleanup: status=%d", resp.status_code)
    except Exception as e:
        log.error("Cleanup error: %s", e)
        return 0

    log.info("✓ Cleanup complete")
    return 1
