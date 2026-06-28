"""Sales estimation engine.

Two estimation paths:

Path A — Inventory quantity delta (high confidence):
    Requires visible_inventory_qty in consecutive snapshots.
    Formula: units_sold = prev_qty - curr_qty (when negative delta)
    Source: crawl4ai Shopify embedded JSON (inventory_quantity per variant)

Path B — Availability flip (low confidence):
    Tracks availability_status changes: in_stock → out_of_stock.
    No unit count known; records as estimation_method="availability_flip"
    with confidence_score=0.25 so downstream can filter or weight accordingly.
    Source: Shopify /products.json available boolean (all 7 Shopify brands)

Path A takes precedence: if a variant has qty data, Path B is skipped for it.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from ..core import supabase_client as sb
from ..core.logger import get_logger

log = get_logger("sales.estimate")

MIN_CONFIDENCE = 0.4
FLIP_CONFIDENCE = 0.25  # availability flip — no unit count, low confidence


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    if brand_filter:
        brand_map = {k: v for k, v in brand_map.items() if k in brand_filter}
    brand_ids = set(brand_map.values())

    # Fetch ALL recent snapshots (last 500 per variant) — both qty and flip paths need them
    snapshots = sb.get_filtered(
        "product_snapshots",
        "id,brand_id,variant_id,snapshot_time,price,"
        "visible_inventory_qty,inventory_confidence,availability_status",
        "order=variant_id.asc,snapshot_time.asc&limit=5000",
    )
    snapshots = [s for s in snapshots if s.get("brand_id") in brand_ids]

    # Group by variant_id (null variant_id rows go into "" bucket — brand-level signals)
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

        has_qty_data = any(s.get("visible_inventory_qty") is not None for s in snaps)

        # Tracks the most recent snapshot where we had a real inventory count.
        # Used to estimate units sold when an availability flip happens with no
        # qty data in the immediate pair — e.g. crawl4ai captured qty=50 last
        # week but this week returned None; we still know at least 50 were sold.
        last_known_qty: int | None = None

        for i in range(1, len(snaps)):
            prev = snaps[i - 1]
            curr = snaps[i]
            brand_id = curr.get("brand_id")
            estimate_date = (curr.get("snapshot_time") or today)[:10]
            price = curr.get("price") or prev.get("price") or 0

            prev_qty = prev.get("visible_inventory_qty")
            curr_qty = curr.get("visible_inventory_qty")

            # Update running tracker before using prev_qty
            if prev_qty is not None:
                last_known_qty = prev_qty

            # ── Path A: inventory quantity delta ──────────────────────────
            if prev_qty is not None and curr_qty is not None:
                delta = curr_qty - prev_qty
                confidence = min(
                    float(prev.get("inventory_confidence") == "high") * 0.5 +
                    float(curr.get("inventory_confidence") == "high") * 0.5,
                    1.0,
                ) or 0.3

                if confidence < MIN_CONFIDENCE:
                    continue

                if delta < 0:
                    units_sold = abs(delta)
                    estimates.append({
                        "brand_id":             brand_id,
                        "variant_id":           variant_id or None,
                        "estimate_date":        estimate_date,
                        "estimated_units_sold": units_sold,
                        "estimated_revenue":    round(units_sold * price, 2),
                        "price_used":           price,
                        "confidence_score":     confidence,
                        "inventory_start":      prev_qty,
                        "inventory_end":        curr_qty,
                        "restock_qty":          0,
                        "estimation_method":    "inventory_delta",
                    })
                    events.append({
                        "brand_id":       brand_id,
                        "variant_id":     variant_id or None,
                        "event_time":     curr.get("snapshot_time"),
                        "event_type":     "sale",
                        "previous_qty":   prev_qty,
                        "current_qty":    curr_qty,
                        "delta_qty":      delta,
                        "confidence_score": confidence,
                        "reason_code":    "inventory_drop",
                    })
                elif delta > 0:
                    events.append({
                        "brand_id":       brand_id,
                        "variant_id":     variant_id or None,
                        "event_time":     curr.get("snapshot_time"),
                        "event_type":     "restock",
                        "previous_qty":   prev_qty,
                        "current_qty":    curr_qty,
                        "delta_qty":      delta,
                        "confidence_score": confidence,
                        "reason_code":    "qty_increase",
                    })
                continue  # Path A handled this pair — skip Path B

            # ── Path B: availability status flip (no qty data) ────────────
            if has_qty_data:
                continue  # variant has qty elsewhere — don't mix signals

            prev_avail = prev.get("availability_status") or "unknown"
            curr_avail = curr.get("availability_status") or "unknown"

            if prev_avail == "in_stock" and curr_avail == "out_of_stock":
                # Sold out — prefer last known qty as units estimate over hardcoded 1.
                # If crawl4ai got a real count in an earlier snapshot for this variant,
                # that qty is our best guess for how many units cleared before the sellout.
                estimated_units = last_known_qty if last_known_qty is not None else 1
                # Slightly higher confidence when we have an inventory reference point.
                flip_conf = 0.35 if last_known_qty is not None else FLIP_CONFIDENCE
                estimates.append({
                    "brand_id":             brand_id,
                    "variant_id":           variant_id or None,
                    "estimate_date":        estimate_date,
                    "estimated_units_sold": estimated_units,
                    "estimated_revenue":    round(estimated_units * price, 2),
                    "price_used":           price,
                    "confidence_score":     flip_conf,
                    "inventory_start":      last_known_qty,
                    "inventory_end":        0,
                    "restock_qty":          0,
                    "estimation_method":    "availability_flip",
                })
                events.append({
                    "brand_id":       brand_id,
                    "variant_id":     variant_id or None,
                    "event_time":     curr.get("snapshot_time"),
                    "event_type":     "sale",
                    "previous_qty":   last_known_qty,
                    "current_qty":    0,
                    "delta_qty":      -estimated_units if last_known_qty is not None else None,
                    "confidence_score": flip_conf,
                    "reason_code":    "availability_flip",
                })
            elif prev_avail == "out_of_stock" and curr_avail == "in_stock":
                events.append({
                    "brand_id":       brand_id,
                    "variant_id":     variant_id or None,
                    "event_time":     curr.get("snapshot_time"),
                    "event_type":     "restock",
                    "previous_qty":   None,
                    "current_qty":    None,
                    "delta_qty":      None,
                    "confidence_score": FLIP_CONFIDENCE,
                    "reason_code":    "availability_flip_restock",
                })

    if dry_run:
        log.info(
            "[DRY-RUN] would write %d estimates (%d via qty-delta, %d via flip), %d events",
            len(estimates),
            sum(1 for e in estimates if e.get("estimation_method") == "inventory_delta"),
            sum(1 for e in estimates if e.get("estimation_method") == "availability_flip"),
            len(events),
        )
        return len(estimates)

    e = sb.upsert("sales_estimates", estimates, "brand_id,variant_id,estimate_date") if estimates else 0
    # inventory_events is an append-only event log — no unique constraint, use insert
    ev = sb.insert("inventory_events", events) if events else 0
    log.info(
        "✓ %d sales_estimates (%d qty-delta, %d flip), %d inventory_events written",
        e,
        sum(1 for est in estimates if est.get("estimation_method") == "inventory_delta"),
        sum(1 for est in estimates if est.get("estimation_method") == "availability_flip"),
        ev,
    )
    return e
