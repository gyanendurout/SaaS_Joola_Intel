"""Scrape inventory signals from product pages.

Four extraction methods (in priority order):
1. JSON-LD structured data
2. Shopify /products/{handle}.json
3. Cart signal (add-to-cart qty restriction)
4. HTML text pattern matching ("Only N left")

Writes snapshots to product_snapshots table.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from ..core import supabase_client as sb
from ..core.logger import get_logger
from ..core.network import http_request

log = get_logger("sales.inventory")

_QTY_PATTERN = re.compile(
    r"only\s+(\d+)\s+left|(\d+)\s+(in\s+stock|available|remaining)",
    re.IGNORECASE,
)

_PRICE_PATTERN = re.compile(r"\$\s*([\d,]+\.?\d*)")


def _extract_json_ld(html: str) -> dict | None:
    """Extract Product JSON-LD from page HTML."""
    pattern = re.compile(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        re.DOTALL | re.IGNORECASE,
    )
    for match in pattern.finditer(html):
        try:
            data = json.loads(match.group(1))
            items = data if isinstance(data, list) else [data]
            for item in items:
                if item.get("@type") in ("Product", "IndividualProduct"):
                    return item
        except Exception:
            continue
    return None


def _extract_shopify_json(product_url: str) -> dict | None:
    """Fetch Shopify product JSON directly."""
    if ".myshopify.com" not in product_url and "/products/" not in product_url:
        return None
    json_url = product_url.rstrip("/") + ".json"
    try:
        resp = http_request("GET", json_url, timeout=15)
        if resp.status_code == 200:
            return resp.json().get("product")
    except Exception:
        pass
    return None


def _parse_qty_from_html(html: str) -> tuple[int | None, str | None]:
    m = _QTY_PATTERN.search(html)
    if m:
        qty_str = m.group(1) or m.group(2)
        try:
            return int(qty_str), m.group(0)
        except Exception:
            pass
    return None, None


def _scrape_page(url: str) -> dict:
    """Fetch a product page and extract inventory signals."""
    result: dict = {
        "url": url,
        "price": None,
        "availability_status": "unknown",
        "visible_inventory_qty": None,
        "inventory_signal_type": None,
        "stock_message": None,
        "raw_payload": None,
        "confidence": "low",
    }
    try:
        resp = http_request("GET", url, timeout=20, headers={
            "User-Agent": "Mozilla/5.0 (compatible; JOOLA-Intel-Bot/2.0)"
        })
        if resp.status_code != 200:
            return result
        html = resp.text

        # Method 1: JSON-LD
        json_ld = _extract_json_ld(html)
        if json_ld:
            offers = json_ld.get("offers") or {}
            if isinstance(offers, list):
                offers = offers[0] if offers else {}
            avail = (offers.get("availability") or "").lower()
            result["price"] = _safe_float(offers.get("price"))
            result["availability_status"] = "in_stock" if "instock" in avail else "out_of_stock"
            result["inventory_signal_type"] = "json_ld"
            result["raw_payload"] = json_ld
            result["confidence"] = "high"
            return result

        # Method 2: Shopify JSON
        shopify = _extract_shopify_json(url)
        if shopify:
            variants = shopify.get("variants") or []
            in_stock = any(v.get("available") for v in variants)
            result["availability_status"] = "in_stock" if in_stock else "out_of_stock"
            result["inventory_signal_type"] = "shopify_json"
            result["confidence"] = "high"
            if variants:
                result["price"] = _safe_float(variants[0].get("price"))
            return result

        # Method 3: HTML text
        qty, stock_msg = _parse_qty_from_html(html)
        if qty is not None:
            result["visible_inventory_qty"] = qty
            result["stock_message"] = stock_msg
            result["inventory_signal_type"] = "html_text"
            result["availability_status"] = "limited" if qty < 10 else "in_stock"
            result["confidence"] = "medium"

        # Price fallback
        prices = _PRICE_PATTERN.findall(html)
        if prices and not result["price"]:
            result["price"] = _safe_float(prices[0].replace(",", ""))

    except Exception as e:
        log.debug("Scrape error for %s: %s", url, e)

    return result


def _safe_float(val: Any) -> float | None:
    try:
        return float(str(val).replace(",", "")) if val else None
    except Exception:
        return None


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    if brand_filter:
        brand_map = {k: v for k, v in brand_map.items() if k in brand_filter}

    # Get all tracked variants with product URLs
    variants = sb.get_filtered(
        "product_variants",
        "id,brand_id,product_id",
        "availability_status=not.eq.discontinued&limit=500",
    )
    # products_catalog has display_name + sku but NO product_url; join via products
    # table for URL lookup keyed by (brand_id, lower(name) ~ lower(display_name)).
    catalog = sb.get("products_catalog", "id,brand_id,display_name,sku")
    products = {r["id"]: r for r in catalog}
    url_by_pid: dict[str, str] = {}
    try:
        products_table = sb.get("products", "brand_id,name,url")
        # Map (brand_id, lowercase_name) → url
        url_lookup = {
            (p["brand_id"], (p.get("name") or "").lower()): p.get("url")
            for p in products_table if p.get("url")
        }
        for pc in catalog:
            url = url_lookup.get((pc["brand_id"], (pc.get("display_name") or "").lower()))
            if url:
                url_by_pid[pc["id"]] = url
    except Exception as e:
        log.warning("Could not load products table for URLs: %s", str(e)[:200])
    brand_ids = set(brand_map.values())
    variants = [v for v in variants if v.get("brand_id") in brand_ids]

    if dry_run:
        log.info("[DRY-RUN] would scrape inventory for %d variants", len(variants))
        return 0

    now = datetime.now(timezone.utc).isoformat()
    rows: list[dict] = []
    for variant in variants:
        product_id = variant.get("product_id") or ""
        product = products.get(product_id)
        url = url_by_pid.get(product_id)
        if not url:
            continue

        signal = _scrape_page(url)
        rows.append({
            "brand_id":              variant["brand_id"],
            "product_id":            variant.get("product_id"),
            "variant_id":            variant["id"],
            "snapshot_time":         now,
            "product_url":           url,
            "price":                 signal["price"],
            "availability_status":   signal["availability_status"],
            "visible_inventory_qty": signal["visible_inventory_qty"],
            "inventory_signal_type": signal["inventory_signal_type"],
            "stock_message":         signal["stock_message"],
            "inventory_confidence":  signal["confidence"],
            "raw_payload":           signal["raw_payload"],
        })

    n = sb.upsert("product_snapshots", rows, "variant_id,snapshot_time") if rows else 0
    log.info("✓ %d product_snapshots recorded", n)
    return n
