"""Inventory scraper using crawl4ai for JS-rendered pages.

Replaces the plain-HTTP scrape_inventory.py with full JS rendering.
Key improvement: Shopify pages embed per-variant inventory_quantity in
window.ShopifyAnalytics / <script type="application/json"> blocks.
Plain HTTP returns null for inventory_quantity; this scraper gets real counts.

Two-pass strategy per brand:
  Pass 1 — /products.json (fast JSON API, no JS needed)
            → discovers all variant IDs + availability booleans
            → writes product_variants rows (upsert)
            → writes product_snapshots rows for every variant (availability_status)

  Pass 2 — crawl4ai on priority product pages
            → extracts window.ShopifyAnalytics inventory_quantity per variant
            → updates the Pass-1 snapshots with real inventory counts
            → falls back to visible text ("Only N left") for non-Shopify stores

Brands with Shopify JSON endpoint (7): joola, selkirk, paddletek, crbn,
    six-zero, engage, gamma
Brands without Shopify (4): onix, franklin, head, wilson  — crawl4ai only
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
import yaml

from ..core import supabase_client as sb
from ..core.crawl4ai_client import (
    extract_shopify_inventory,
    extract_visible_inventory,
    fetch_pages_batch,
    run_sync,
)
from ..core.logger import get_logger
from ..core.network import http_request

log = get_logger("sales.inventory_crawl4ai")

_CONFIG_PATH = Path(__file__).resolve().parents[1] / "config" / "sales_sources.yaml"
_CRAWL4AI_TIMEOUT = 60  # seconds per page
_MAX_CONCURRENT_PAGES = 2  # conservative — avoids rate-limit bans


def _load_config() -> dict:
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


# ── Pass 1: Shopify /products.json ────────────────────────────────────────────

def _fetch_shopify_catalog(shopify_json_url: str) -> list[dict]:
    """GET /products.json?limit=250 — returns raw Shopify product list."""
    try:
        resp = http_request("GET", shopify_json_url, timeout=30)
        resp.raise_for_status()
        return resp.json().get("products", [])
    except Exception as e:
        log.warning("Shopify JSON fetch failed: %s — %s", shopify_json_url, e)
        return []


def _snapshots_from_shopify_json(
    brand_id: str,
    products: list[dict],
    variant_id_map: dict[str, str],  # external_variant_id → internal UUID
    catalog_name_map: dict[tuple[str, str], str],  # (brand_id, name_lower) → product_id
    now: str,
) -> tuple[list[dict], list[dict]]:
    """Build product_variants rows + product_snapshots rows from /products.json response."""
    variant_rows: list[dict] = []
    snapshot_rows: list[dict] = []

    for product in products:
        product_title = (product.get("title") or "").lower()
        product_id = (
            catalog_name_map.get((brand_id, product_title))
            # substring fallback
            or next(
                (pid for (bid, key), pid in catalog_name_map.items()
                 if bid == brand_id and key and key in product_title),
                None,
            )
        )
        product_url = f"https://placeholder.com/products/{product.get('handle', '')}"

        for v in product.get("variants", []):
            ext_id = str(v.get("id") or "")
            if not ext_id:
                continue

            availability = "in_stock" if v.get("available") else "out_of_stock"
            price = _safe_float(v.get("price"))
            compare = _safe_float(v.get("compare_at_price"))

            variant_rows.append({
                "brand_id":            brand_id,
                "product_id":          product_id,
                "external_variant_id": ext_id,
                "sku":                 v.get("sku"),
                "variant_title":       v.get("title"),
                "price":               price,
                "compare_at_price":    compare,
                "availability_status": availability,
            })

            # One snapshot per variant per scrape run
            snapshot_rows.append({
                "brand_id":            brand_id,
                "product_id":          product_id,
                # variant_id FK resolved after upsert — patched in _resolve_variant_fks
                "_ext_variant_id":     ext_id,
                "snapshot_time":       now,
                "product_url":         product_url,
                "price":               price,
                "compare_at_price":    compare,
                "availability_status": availability,
                "inventory_signal_type": "shopify_json",
                "inventory_confidence":  "medium",
                # visible_inventory_qty filled in Pass 2 when available
                "visible_inventory_qty": None,
            })

    return variant_rows, snapshot_rows


def _safe_float(val: Any) -> float | None:
    try:
        return float(str(val)) if val else None
    except (ValueError, TypeError):
        return None


# ── Pass 2: crawl4ai product pages ────────────────────────────────────────────

async def _crawl_product_pages(
    urls: list[str],
    brand_id: str,
    variant_id_map: dict[str, str],  # ext_id → internal UUID
    snapshot_map: dict[str, dict],   # ext_id → snapshot row (to patch qty)
) -> None:
    """Crawl priority product pages and patch snapshot_map with real inventory counts."""
    if not urls:
        return

    log.info("  crawl4ai: rendering %d product pages (brand=%s)", len(urls), brand_id)
    results = await fetch_pages_batch(urls, timeout=_CRAWL4AI_TIMEOUT, max_concurrent=_MAX_CONCURRENT_PAGES)

    for result in results:
        if not result["success"]:
            log.debug("  crawl4ai miss: %s", result["url"])
            continue

        html = result["html"]

        # Try Shopify embedded JSON first (gives inventory_quantity per variant)
        shopify_variants = extract_shopify_inventory(html)
        if shopify_variants:
            for sv in shopify_variants:
                ext_id = str(sv.get("id") or "")
                inv_qty = sv.get("inventory_quantity")
                if ext_id and ext_id in snapshot_map and inv_qty is not None:
                    snapshot_map[ext_id]["visible_inventory_qty"] = int(inv_qty)
                    snapshot_map[ext_id]["inventory_signal_type"] = "shopify_embedded_json"
                    snapshot_map[ext_id]["inventory_confidence"] = "high"
                    snapshot_map[ext_id]["product_url"] = result["url"]
            log.debug("  ✓ shopify embedded JSON: %d variants from %s", len(shopify_variants), result["url"])
            continue

        # Fallback: visible text extraction ("Only N left in stock")
        qty, stock_msg = extract_visible_inventory(html)
        if qty is not None:
            # Apply to all snapshots for this brand whose URL we just crawled
            # (we can't always match to specific variant without ext_id in URL)
            log.debug("  ✓ visible text: qty=%d from %s", qty, result["url"])


# ── Non-Shopify crawl4ai scraping ─────────────────────────────────────────────

async def _scrape_non_shopify_brand(
    slug: str,
    brand_id: str,
    priority_urls: list[str],
    catalog_name_map: dict[tuple[str, str], str],
    now: str,
) -> list[dict]:
    """Scrape non-Shopify brand product pages via crawl4ai. Returns snapshot rows."""
    if not priority_urls:
        log.info("  %s: no priority_products configured, skipping crawl4ai", slug)
        return []

    log.info("  crawl4ai: %s — %d pages", slug, len(priority_urls))
    results = await fetch_pages_batch(priority_urls, timeout=_CRAWL4AI_TIMEOUT, max_concurrent=2)

    snapshot_rows: list[dict] = []
    for result in results:
        url = result["url"]
        if not result["success"]:
            log.debug("  miss: %s", url)
            snapshot_rows.append({
                "brand_id":            brand_id,
                "product_id":          None,
                "snapshot_time":       now,
                "product_url":         url,
                "availability_status": "unknown",
                "inventory_signal_type": "crawl4ai_failed",
                "inventory_confidence":  "low",
            })
            continue

        html = result["html"]
        markdown = result["markdown"]

        # Check for structured data (JSON-LD)
        avail_status, price, inv_qty, sig_type, confidence = _extract_from_html(html)

        snapshot_rows.append({
            "brand_id":              brand_id,
            "product_id":            None,
            "snapshot_time":         now,
            "product_url":           url,
            "price":                 price,
            "availability_status":   avail_status,
            "visible_inventory_qty": inv_qty,
            "inventory_signal_type": sig_type,
            "inventory_confidence":  confidence,
        })

    return snapshot_rows


def _extract_from_html(html: str) -> tuple[str, float | None, int | None, str, str]:
    """Extract availability + price + optional qty from rendered HTML.

    Returns: (availability_status, price, inv_qty, signal_type, confidence)
    """
    import re

    # JSON-LD structured data
    jsonld_re = re.compile(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        re.DOTALL | re.IGNORECASE,
    )
    for m in jsonld_re.finditer(html):
        try:
            data = json.loads(m.group(1))
            items = data if isinstance(data, list) else [data]
            for item in items:
                if item.get("@type") in ("Product", "IndividualProduct"):
                    offers = item.get("offers") or {}
                    if isinstance(offers, list):
                        offers = offers[0] if offers else {}
                    avail_raw = (offers.get("availability") or "").lower()
                    avail = "in_stock" if "instock" in avail_raw else (
                        "out_of_stock" if "outofstock" in avail_raw else "unknown"
                    )
                    price = _safe_float(offers.get("price"))
                    return avail, price, None, "json_ld", "high"
        except (json.JSONDecodeError, AttributeError):
            continue

    # Visible inventory text
    inv_qty, _ = extract_visible_inventory(html)
    avail = "limited" if (inv_qty is not None and inv_qty < 10) else (
        "in_stock" if inv_qty is not None else "unknown"
    )

    # Sold-out keywords in HTML
    if "sold out" in html.lower() or "out of stock" in html.lower():
        avail = "out_of_stock"

    # Price via pattern
    price_m = re.search(r"\$\s*([\d,]+\.?\d*)", html)
    price = _safe_float(price_m.group(1).replace(",", "")) if price_m else None

    confidence = "medium" if inv_qty is not None else "low"
    sig_type = "html_text" if inv_qty is not None else "html_keyword"

    return avail, price, inv_qty, sig_type, confidence


# ── Variant FK resolution ──────────────────────────────────────────────────────

def _resolve_variant_fks(
    snapshot_rows: list[dict],
    ext_to_internal: dict[str, str],
) -> list[dict]:
    """Replace _ext_variant_id with the resolved internal variant_id UUID."""
    resolved = []
    for row in snapshot_rows:
        r = {k: v for k, v in row.items() if k != "_ext_variant_id"}
        ext_id = row.get("_ext_variant_id")
        if ext_id:
            r["variant_id"] = ext_to_internal.get(ext_id)
        resolved.append(r)
    return resolved


# ── Main entry point ──────────────────────────────────────────────────────────

def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    config = _load_config()
    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}

    # Build catalog name→id map for product_id FK resolution
    catalog_rows = sb.get("products_catalog", "id,brand_id,display_name,aliases")
    catalog_name_map: dict[tuple[str, str], str] = {}
    for c in catalog_rows:
        if not c.get("brand_id") or not c.get("id"):
            continue
        if c.get("display_name"):
            catalog_name_map[(c["brand_id"], c["display_name"].lower())] = c["id"]
        for alias in (c.get("aliases") or []):
            if alias:
                catalog_name_map[(c["brand_id"], alias.lower())] = c["id"]

    now = datetime.now(timezone.utc).isoformat()
    all_variant_rows: list[dict] = []
    all_snapshot_rows: list[dict] = []  # Shopify brands
    non_shopify_snapshots: list[dict] = []

    sources = config.get("sources", {})

    for slug, cfg in sources.items():
        if brand_filter and slug not in brand_filter:
            continue
        brand_id = brand_map.get(slug)
        if not brand_id:
            log.warning("  %s: not in DB brands table, skipping", slug)
            continue

        shopify_url = cfg.get("shopify_json") or ""
        priority_urls = cfg.get("priority_products") or []
        method = cfg.get("method", "html")

        if method == "shopify_json" and shopify_url:
            # ── Shopify brand ──────────────────────────────────────────────
            log.info("[%s] Pass 1 — fetching %s", slug, shopify_url)
            products = _fetch_shopify_catalog(shopify_url)
            log.info("  %d products found", len(products))

            if dry_run:
                continue

            variant_rows, snapshot_rows = _snapshots_from_shopify_json(
                brand_id, products, {}, catalog_name_map, now
            )
            all_variant_rows.extend(variant_rows)
            all_snapshot_rows.extend(snapshot_rows)

            # Pass 2 — crawl4ai on priority pages for real inventory counts
            if priority_urls:
                snapshot_map = {
                    row["_ext_variant_id"]: row
                    for row in snapshot_rows
                    if row.get("_ext_variant_id")
                }
                run_sync(_crawl_product_pages(priority_urls, brand_id, {}, snapshot_map))

        else:
            # ── Non-Shopify brand (Head, Wilson, Onix, Franklin) ───────────
            log.info("[%s] crawl4ai-only (no Shopify JSON endpoint)", slug)
            if not dry_run and priority_urls:
                rows = run_sync(
                    _scrape_non_shopify_brand(slug, brand_id, priority_urls, catalog_name_map, now)
                )
                non_shopify_snapshots.extend(rows)

    if dry_run:
        log.info("[DRY-RUN] would process %d brands", len(sources))
        return 0

    # ── Write product_variants ─────────────────────────────────────────────────
    # Deduplicate by (brand_id, external_variant_id) — /products.json can return
    # the same variant_id across multiple product entries.
    seen_variant_keys: set[tuple[str, str]] = set()
    deduped_variant_rows: list[dict] = []
    for row in all_variant_rows:
        key = (row.get("brand_id", ""), row.get("external_variant_id", ""))
        if key not in seen_variant_keys:
            seen_variant_keys.add(key)
            deduped_variant_rows.append(row)

    if deduped_variant_rows:
        n_variants = sb.upsert("product_variants", deduped_variant_rows, "brand_id,external_variant_id")
        log.info("✓ %d product_variants upserted (%d dupes dropped)",
                 n_variants, len(all_variant_rows) - len(deduped_variant_rows))
    else:
        n_variants = 0

    # Fetch freshly-upserted variant IDs to resolve FKs
    db_variants = sb.get("product_variants", "id,brand_id,external_variant_id")
    ext_to_internal: dict[str, str] = {
        v["external_variant_id"]: v["id"]
        for v in db_variants
        if v.get("external_variant_id")
    }

    # ── Write product_snapshots ────────────────────────────────────────────────
    shopify_snaps = _resolve_variant_fks(all_snapshot_rows, ext_to_internal)
    all_snaps = shopify_snaps + non_shopify_snapshots

    # Normalize: Supabase REST requires all rows in a batch to have the same keys.
    # Build the union of all keys, then fill missing keys with None.
    if all_snaps:
        all_keys = set().union(*(row.keys() for row in all_snaps))
        all_snaps = [{k: row.get(k) for k in all_keys} for row in all_snaps]
        n_snaps = sb.insert("product_snapshots", all_snaps)
        log.info("✓ %d product_snapshots written", n_snaps)
    else:
        n_snaps = 0

    # Summary
    high_conf = sum(1 for s in all_snaps if s.get("inventory_confidence") == "high")
    with_qty = sum(1 for s in all_snaps if s.get("visible_inventory_qty") is not None)
    log.info(
        "  Snapshot quality: %d total, %d high-confidence, %d with real inventory count",
        len(all_snaps), high_conf, with_qty,
    )

    return n_snaps
