"""Sales estimation engine.

Formula: Estimated Units Sold = Previous Inventory + Restock - Current Inventory

Processes consecutive product_snapshots pairs to derive inventory deltas,
then writes estimates to sales_estimates and events to inventory_events.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from ..core import supabase_client as sb
from ..core.logger import get_logger

log = get_logger("sales.estimate")

MIN_CONFIDENCE = 0.4


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    if brand_filter:
        brand_map = {k: v for k, v in brand_map.items() if k in brand_filter}
    brand_ids = set(brand_map.values())

    # Get recent snapshots with inventory quantities
    snapshots = sb.get_filtered(
        "product_snapshots",
        "id,brand_id,variant_id,snapshot_time,price,visible_inventory_qty,inventory_confidence",
        "visible_inventory_qty=not.is.null&order=variant_id.asc,snapshot_time.asc&limit=2000",
    )
    snapshots = [s for s in snapshots if s.get("brand_id") in brand_ids]

    # Group by variant
    by_variant: dict[str, list[dict]] = {}
    for snap in snapshots:
        vid = snap.get("variant_id") or ""
        by_variant.setdefault(vid, []).append(snap)

    estimates: list[dict] = []
    events: list[dict] = []
    today = date.today().isoformat()

    for variant_id, snaps in by_variant.items():
        if len(snaps) < 2:
            continue
        snaps.sort(key=lambda s: s.get("snapshot_time") or "")

        for i in range(1, len(snaps)):
            prev = snaps[i - 1]
            curr = snaps[i]

            prev_qty = prev.get("visible_inventory_qty")
            curr_qty = curr.get("visible_inventory_qty")

            if prev_qty is None or curr_qty is None:
                continue

            delta = curr_qty - prev_qty  # positive = restock, negative = sale

            confidence = min(
                float(prev.get("inventory_confidence") == "high") * 0.5 +
                float(curr.get("inventory_confidence") == "high") * 0.5,
                1.0,
            ) or 0.3

            if confidence < MIN_CONFIDENCE:
                continue

            price = curr.get("price") or prev.get("price") or 0
            brand_id = curr.get("brand_id")
            estimate_date = (curr.get("snapshot_time") or today)[:10]

            if delta < 0:  # inventory dropped → sales
                units_sold = abs(delta)
                event_type = "sale"
                estimates.append({
                    "brand_id":           brand_id,
                    "variant_id":         variant_id,
                    "estimate_date":      estimate_date,
                    "estimated_units_sold": units_sold,
                    "estimated_revenue":   round(units_sold * price, 2),
                    "price_used":          price,
                    "confidence_score":    confidence,
                    "inventory_start":     prev_qty,
                    "inventory_end":       curr_qty,
                    "restock_qty":         0,
                    "estimation_method":   "inventory_delta",
                })
            elif delta > 0:  # inventory increased → restock
                event_type = "restock"
            else:
                continue

            events.append({
                "brand_id":       brand_id,
                "variant_id":     variant_id,
                "event_time":     curr.get("snapshot_time"),
                "event_type":     event_type,
                "previous_qty":   prev_qty,
                "current_qty":    curr_qty,
                "delta_qty":      delta,
                "confidence_score": confidence,
                "reason_code":    "inventory_drop" if delta < 0 else "qty_increase",
            })

    if dry_run:
        log.info("[DRY-RUN] would write %d estimates, %d events", len(estimates), len(events))
        return len(estimates)

    e = sb.upsert("sales_estimates", estimates, "brand_id,variant_id,estimate_date") if estimates else 0
    ev = sb.upsert("inventory_events", events, "variant_id,event_time") if events else 0
    log.info("✓ %d sales_estimates, %d inventory_events written", e, ev)
    return e
