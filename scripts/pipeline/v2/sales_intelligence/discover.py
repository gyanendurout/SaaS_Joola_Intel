"""Discover product URLs and variants from brand Shopify stores.

For brands with shopify_json endpoints, fetches /products.json to enumerate
all variants and writes them to product_variants.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import requests
import yaml

from ..core import supabase_client as sb
from ..core.logger import get_logger
from ..core.network import http_request

log = get_logger("sales.discover")

_CONFIG_PATH = Path(__file__).resolve().parents[1] / "config" / "sales_sources.yaml"


def _load_config() -> dict:
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def _fetch_shopify_products(shopify_json_url: str) -> list[dict]:
    try:
        resp = http_request("GET", shopify_json_url, timeout=30)
        resp.raise_for_status()
        return resp.json().get("products", [])
    except Exception as e:
        log.warning("Shopify fetch failed for %s: %s", shopify_json_url, e)
        return []


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    config = _load_config()
    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    product_map = {
        (r.get("display_name") or "").lower(): r["id"]
        for r in sb.get("products_catalog", "id,display_name")
        if r.get("display_name")
    }

    total = 0
    for slug, cfg in config.get("sources", {}).items():
        if brand_filter and slug not in brand_filter:
            continue
        brand_id = brand_map.get(slug)
        if not brand_id:
            continue

        shopify_url = cfg.get("shopify_json") or ""
        if not shopify_url or cfg.get("method") != "shopify_json":
            log.info("%s: skipping discover (method=%s)", slug, cfg.get("method"))
            continue

        if dry_run:
            log.info("[DRY-RUN] would discover variants from %s", shopify_url)
            continue

        products = _fetch_shopify_products(shopify_url)
        rows: list[dict] = []
        for product in products:
            product_name = (product.get("title") or "").lower()
            product_id = product_map.get(product_name)
            for variant in product.get("variants", []):
                rows.append({
                    "brand_id":            brand_id,
                    "product_id":          product_id,
                    "external_variant_id": str(variant.get("id") or ""),
                    "sku":                 variant.get("sku"),
                    "variant_title":       variant.get("title"),
                    "price":               float(variant.get("price") or 0) or None,
                    "compare_at_price":    float(variant.get("compare_at_price") or 0) or None,
                    "availability_status": "in_stock" if variant.get("available") else "out_of_stock",
                })

        n = sb.upsert("product_variants", rows, "brand_id,external_variant_id")
        log.info("%s: %d variants discovered", slug, n)
        total += n

    return total
