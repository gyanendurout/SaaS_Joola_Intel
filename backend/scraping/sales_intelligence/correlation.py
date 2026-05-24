"""Promotion-sales correlation engine.

Correlates promotions with sales velocity changes to estimate promo lift.
Writes results to promotion_sales_impact table.

The live promotions table has no is_active flag — instead, a promotion is
considered "completed" when detected_at is older than (today - BASELINE_DAYS).
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from ..core import supabase_client as sb
from ..core.logger import get_logger

log = get_logger("sales.correlation")

BASELINE_DAYS = 7
PROMO_MIN_DAYS = 3
LOOKBACK_DAYS = 60


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    if brand_filter:
        brand_map = {k: v for k, v in brand_map.items() if k in brand_filter}
    brand_ids = set(brand_map.values())

    # Promotions detected at least BASELINE_DAYS ago (so we have a comparable window)
    cutoff = (date.today() - timedelta(days=BASELINE_DAYS)).isoformat()
    floor  = (date.today() - timedelta(days=LOOKBACK_DAYS)).isoformat()
    promotions = sb.get_filtered(
        "promotions",
        "id,brand_id,detected_at,promo_type,discount_pct",
        f"detected_at=gte.{floor}&detected_at=lte.{cutoff}&limit=200",
    )
    promotions = [p for p in promotions if p.get("brand_id") in brand_ids]

    if not promotions:
        log.info("No completed promotions to correlate")
        return 0

    if dry_run:
        log.info("[DRY-RUN] would compute correlation for %d promotions", len(promotions))
        return 0

    impacts: list[dict] = []
    for promo in promotions:
        brand_id = promo["brand_id"]
        promo_start_str = (promo.get("detected_at") or "")[:10]
        if not promo_start_str:
            continue

        baseline_start = (date.fromisoformat(promo_start_str) - timedelta(days=BASELINE_DAYS)).isoformat()
        baseline_facts = sb.get_filtered(
            "sales_facts_daily",
            "estimated_units_sold,date",
            f"brand_id=eq.{brand_id}&date=gte.{baseline_start}&date=lt.{promo_start_str}&limit=100",
        )
        baseline_units = sum(f.get("estimated_units_sold") or 0 for f in baseline_facts)
        baseline_days  = len(baseline_facts) or 1
        baseline_velocity = baseline_units / baseline_days

        promo_facts = sb.get_filtered(
            "sales_facts_daily",
            "estimated_units_sold,date",
            f"brand_id=eq.{brand_id}&date=gte.{promo_start_str}&promotion_flag=eq.true&limit=100",
        )
        if len(promo_facts) < PROMO_MIN_DAYS:
            continue

        promo_units = sum(f.get("estimated_units_sold") or 0 for f in promo_facts)
        promo_velocity = promo_units / len(promo_facts)

        if baseline_velocity == 0:
            continue

        lift_pct = (promo_velocity - baseline_velocity) / baseline_velocity * 100
        impacts.append({
            "brand_id":                brand_id,
            "promotion_id":            promo["id"],
            "campaign_start":          promo_start_str,
            "baseline_sales_velocity": round(baseline_velocity, 4),
            "promo_sales_velocity":    round(promo_velocity, 4),
            "estimated_lift_percent":  round(lift_pct, 2),
            "estimated_lift_units":    round(promo_units - baseline_velocity * len(promo_facts), 2),
            "confidence_score":        0.4,
        })

    n = sb.upsert("promotion_sales_impact", impacts, "brand_id,promotion_id") if impacts else 0
    log.info("✓ %d promotion_sales_impact records written", n)
    return n
