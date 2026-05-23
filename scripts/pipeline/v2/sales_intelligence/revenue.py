"""Revenue calculation — aggregates sales_estimates into sales_facts_daily."""

from __future__ import annotations

from datetime import date
from typing import Any

from ..core import supabase_client as sb
from ..core.logger import get_logger

log = get_logger("sales.revenue")


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    if brand_filter:
        brand_map = {k: v for k, v in brand_map.items() if k in brand_filter}
    brand_ids = set(brand_map.values())

    today = date.today().isoformat()

    # Pull today's estimates
    estimates = sb.get_filtered(
        "sales_estimates",
        "brand_id,product_id,variant_id,estimate_date,estimated_units_sold,"
        "estimated_revenue,price_used,confidence_score",
        f"estimate_date=eq.{today}&limit=2000",
    )
    estimates = [e for e in estimates if e.get("brand_id") in brand_ids]

    if not estimates:
        log.info("No sales_estimates for today (%s)", today)
        return 0

    if dry_run:
        log.info("[DRY-RUN] would aggregate %d estimates into sales_facts_daily", len(estimates))
        return 0

    # Check promotion flags
    promotions = sb.get_filtered(
        "promotions",
        "brand_id,is_active",
        "is_active=eq.true",
    )
    promo_brands: set[str] = {p["brand_id"] for p in promotions if p.get("brand_id")}

    rows: list[dict] = []
    for est in estimates:
        brand_id = est["brand_id"]
        rows.append({
            "brand_id":            brand_id,
            "date":                est["estimate_date"],
            "product_id":          est.get("product_id"),
            "variant_id":          est.get("variant_id"),
            "estimated_units_sold": est.get("estimated_units_sold", 0),
            "estimated_revenue":   est.get("estimated_revenue", 0),
            "avg_price":           est.get("price_used"),
            "confidence_score":    est.get("confidence_score", 0.5),
            "promotion_flag":      brand_id in promo_brands,
        })

    n = sb.upsert("sales_facts_daily", rows, "brand_id,date,variant_id")
    log.info("✓ %d sales_facts_daily rows upserted", n)
    return n
