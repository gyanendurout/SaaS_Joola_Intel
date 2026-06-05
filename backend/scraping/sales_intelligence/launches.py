"""New product launch detection.

Detects when a variant appears in product_snapshots for the first time
and has not been seen in product_variants before.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from ..core import supabase_client as sb
from ..core.logger import get_logger

log = get_logger("sales.launches")


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    if brand_filter:
        brand_map = {k: v for k, v in brand_map.items() if k in brand_filter}
    brand_ids = set(brand_map.values())

    # Variants first seen in the last 7 days
    from datetime import date, timedelta
    cutoff = (date.today() - timedelta(days=7)).isoformat()

    new_variants = sb.get_filtered(
        "product_variants",
        "id,brand_id,variant_title,price,first_seen_at",
        f"first_seen_at=gt.{cutoff}&limit=200",
    )
    new_variants = [v for v in new_variants if v.get("brand_id") in brand_ids]

    if not new_variants:
        log.info("No new product launches detected in the last 7 days")
        return 0

    if dry_run:
        for v in new_variants:
            log.info("[DRY-RUN] new launch detected: %s (first_seen=%s)", v.get("variant_title"), v.get("first_seen_at"))
        return len(new_variants)

    # Record reappearance events for genuinely new variants
    now = datetime.now(timezone.utc).isoformat()
    events: list[dict] = []
    for v in new_variants:
        events.append({
            "brand_id":       v["brand_id"],
            "variant_id":     v["id"],
            "event_time":     now,
            "event_type":     "reappearance",
            "confidence_score": 0.6,
            "reason_code":    "new_variant_detected",
        })

    n = sb.insert("inventory_events", events) if events else 0
    log.info("✓ %d new product launch events recorded", n)
    return n
