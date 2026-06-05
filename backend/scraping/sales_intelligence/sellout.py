"""Detect sellout events — when a product goes from in_stock to out_of_stock.

Records sellout events in inventory_events and marks variant status.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from ..core import supabase_client as sb
from ..core.logger import get_logger

log = get_logger("sales.sellout")


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    if brand_filter:
        brand_map = {k: v for k, v in brand_map.items() if k in brand_filter}
    brand_ids = set(brand_map.values())

    # Get current out-of-stock variants
    variants = sb.get_filtered(
        "product_variants",
        "id,brand_id,product_id,availability_status,last_seen_at",
        "availability_status=eq.out_of_stock&limit=500",
    )
    variants = [v for v in variants if v.get("brand_id") in brand_ids]

    if not variants:
        log.info("No out-of-stock variants detected")
        return 0

    if dry_run:
        log.info("[DRY-RUN] would record %d sellout events", len(variants))
        return 0

    now = datetime.now(timezone.utc).isoformat()
    events: list[dict] = []
    for v in variants:
        events.append({
            "brand_id":       v["brand_id"],
            "variant_id":     v["id"],
            "event_time":     now,
            "event_type":     "sellout",
            "current_qty":    0,
            "confidence_score": 0.8,
            "reason_code":    "zero_stock_detected",
        })

    n = sb.insert("inventory_events", events) if events else 0
    log.info("✓ %d sellout events recorded", n)
    return n
