"""One-time maintenance: fix JOOLA YouTube comments with wrong brand_id.

Delegates to the backfill_brand_id module in sources/youtube/.
"""

from __future__ import annotations

from typing import Any

from ..core.logger import get_logger
from ..sources.youtube.backfill_brand_id import run as _backfill

log = get_logger("maintenance.yt_backfill")


def run(ctx: dict[str, Any]) -> int:
    log.info("Running YouTube brand_id backfill for JOOLA comments")
    n = _backfill(ctx)
    log.info("✓ Backfill complete: %d rows fixed", n)
    return n
