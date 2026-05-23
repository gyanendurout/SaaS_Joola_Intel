"""Detect restock events from inventory_events and update product_variants.

Marks products as back_in_stock and creates alerts for the dashboard.
"""

from __future__ import annotations

from typing import Any

from ..core import supabase_client as sb
from ..core.logger import get_logger

log = get_logger("sales.restock")


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)

    # Find restock events not yet processed
    events = sb.get_filtered(
        "inventory_events",
        "id,brand_id,variant_id,event_time,delta_qty,previous_qty,current_qty",
        "event_type=eq.restock&limit=500",
    )

    if not events:
        log.info("No restock events found")
        return 0

    if dry_run:
        log.info("[DRY-RUN] would process %d restock events", len(events))
        return 0

    updated = 0
    for event in events:
        variant_id = event.get("variant_id")
        if not variant_id:
            continue
        ok = sb.patch("product_variants", variant_id, {
            "availability_status": "in_stock",
            "last_seen_at": event.get("event_time"),
        })
        if ok:
            updated += 1

    log.info("✓ %d variants marked as restocked", updated)
    return updated
