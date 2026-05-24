"""Local Playwright product-catalog scraper.

For brands that Apify's apify/playwright-scraper can't crack (custom Shopify themes,
non-standard URL patterns, hash-suffixed class names, AJAX-only product grids), we
run Playwright directly on the host machine with per-brand DOM extraction rules.

This module is intentionally separate from `scrape_catalog.py` (the Apify-based
catalog scraper). The weekly pipeline runs Apify first for brands it handles well
(Selkirk/Paddletek/CRBN/Gamma) and falls back to this module for the rest.

Brands handled here (currently 5; engage + wilson are still blocked):
  - joola      .card.card-product
  - six-zero   .grid__item              (AUD prices — site is .com.au but US-facing)
  - onix       .ProductItem
  - franklin   .product-item / [data-product-id]
  - head       [class*="productCard-root"] (HEAD uses hashed class names)

Run standalone:
    python -m scripts.pipeline.v2.sources.products.scrape_catalog_local

Run via pipeline:
    Called automatically by run.py through products_scrape_catalog_local step.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Callable

from ...core import supabase_client as sb
from ...core.logger import get_logger

log = get_logger("products.catalog_local")


# ---------------------------------------------------------------------------
# Per-brand extraction scripts — each returns a list of {name, price, ...} dicts.
# We keep these as JS strings so they can run inside page.evaluate() unchanged.
# ---------------------------------------------------------------------------

JS_JOOLA = r"""() => {
    const cards = document.querySelectorAll('.card.card-product');
    const out = []; const seen = new Set();
    cards.forEach(card => {
        const titleEl = card.querySelector(
            '.card-title, h2, h3, h4, [class*="title"]:not([class*="subtitle"])'
        );
        const linkEl = card.querySelector('a[href*="/products/"]');
        const imgEl = card.querySelector('img');
        const name = (titleEl?.innerText?.trim()) ||
                     (linkEl?.getAttribute('title')) ||
                     (imgEl?.getAttribute('alt') || '').replace(/^\d+mm-/, '').trim();
        if (!name || seen.has(name) || name.length < 3) return;
        seen.add(name);
        const priceEl = card.querySelector(
            '.price, .money, [class*="price"]:not([class*="compare"])'
        );
        const compareEl = card.querySelector(
            '.compare-at-price, .price--compare, s.price, [class*="compare"]'
        );
        out.push({
            name,
            price: priceEl?.innerText?.trim() || null,
            comparePrice: compareEl?.innerText?.trim() || null,
            link: linkEl?.href || null,
            thumbnail: imgEl?.src || imgEl?.getAttribute('data-src') || null,
            inStock: card.querySelector('.sold-out, .soldout, .badge--sold-out') === null,
        });
    });
    return out;
}"""

JS_SIX_ZERO = r"""() => {
    const cards = document.querySelectorAll('.grid__item');
    const out = []; const seen = new Set();
    cards.forEach(card => {
        const name = card.querySelector('.grid-product__title')?.innerText?.trim() ||
                     card.querySelector('h3 a, h3')?.innerText?.trim();
        const price = card.querySelector('.grid-product__price')?.innerText?.trim();
        const link = card.querySelector('a[href*="/products/"]')?.href;
        const img = card.querySelector('img');
        if (!name || seen.has(name) || name.length < 3) return;
        seen.add(name);
        out.push({
            name, price, link,
            thumbnail: img?.src || img?.getAttribute('data-src') || null,
            inStock: card.querySelector('.sold-out, .soldout') === null,
        });
    });
    return out;
}"""

JS_ONIX = r"""() => {
    const cards = document.querySelectorAll('.ProductItem');
    const out = []; const seen = new Set();
    cards.forEach(card => {
        const name = card.querySelector(
            '.ProductItem__Title, h2 a, h2, h3 a, h3'
        )?.innerText?.trim();
        const price = card.querySelector(
            '.ProductItem__Price, .product-price, .price'
        )?.innerText?.trim();
        const link = card.querySelector('a[href*="/products/"], a')?.href;
        const img = card.querySelector('img');
        if (!name || seen.has(name) || name.length < 3) return;
        seen.add(name);
        out.push({
            name, price, link,
            thumbnail: img?.src || img?.getAttribute('data-src') || null,
            inStock: card.querySelector('.sold-out, .soldout') === null,
        });
    });
    return out;
}"""

JS_FRANKLIN = r"""() => {
    const cards = document.querySelectorAll('.product-item, [data-product-id]');
    const out = []; const seen = new Set();
    cards.forEach(card => {
        const name = card.querySelector(
            '.product-title, .product-item-name, h3, h2, .name'
        )?.innerText?.trim();
        const price = card.querySelector(
            '.price, .product-price, .money, [class*="price"]'
        )?.innerText?.trim();
        const link = card.querySelector('a[href*="/"]')?.href;
        const img = card.querySelector('img');
        if (!name || seen.has(name) || name.length < 3) return;
        seen.add(name);
        out.push({
            name, price, link,
            thumbnail: img?.src || img?.getAttribute('data-src') || null,
            inStock: true,
        });
    });
    return out;
}"""

JS_HEAD = r"""() => {
    const cards = document.querySelectorAll('[class*="productCard-root"]');
    const out = []; const seen = new Set();
    const BADGE_RE = /^(coming soon|new|sale|best seller|out of stock|free|final|in stock|\$|\d+%)/i;
    cards.forEach(card => {
        const allText = (card.innerText || '');
        // Name: explicit selector first, fallback to first non-badge line
        let name = card.querySelector(
            '[class*="productCard-itemName"], [class*="itemName"]'
        )?.innerText?.trim();
        if (!name) {
            for (const line of allText.split('\n').map(l => l.trim()).filter(l => l)) {
                if (!BADGE_RE.test(line) && line.length > 5) { name = line; break; }
            }
        }
        const priceMatch = allText.match(/\$\d+\.\d{2}/);
        const link = card.querySelector('a[href*="/product/"]')?.href;
        const img = card.querySelector('img');
        if (!name || seen.has(name) || name.length < 3) return;
        seen.add(name);
        out.push({
            name,
            price: priceMatch ? priceMatch[0] : null,
            link,
            thumbnail: img?.src || img?.getAttribute('data-src') || null,
            inStock: !allText.toLowerCase().includes('out of stock'),
        });
    });
    return out;
}"""


# ---------------------------------------------------------------------------
# Brand configuration.
# `currency` defaults to USD; only override where the site quotes another currency.
# ---------------------------------------------------------------------------
BRAND_SCRAPERS: list[dict[str, Any]] = [
    {"slug": "joola",    "url": "https://joola.com/collections/pickleball-paddles",
     "wait_for": ".card.card-product", "js": JS_JOOLA, "currency": "USD"},
    {"slug": "six-zero", "url": "https://www.sixzeropickleball.com/collections/paddles",
     "wait_for": ".grid__item",        "js": JS_SIX_ZERO, "currency": "AUD"},
    {"slug": "onix",     "url": "https://www.onixpickleball.com/collections/paddles",
     "wait_for": ".ProductItem",       "js": JS_ONIX, "currency": "USD"},
    {"slug": "franklin", "url": "https://www.franklinsports.com/pickleball/paddles",
     "wait_for": ".product-item",      "js": JS_FRANKLIN, "currency": "USD"},
    {"slug": "head",     "url": "https://www.head.com/en_US/shop-pickleball/paddle",
     "wait_for": '[class*="productCard-root"]', "js": JS_HEAD, "currency": "USD"},
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _parse_price(raw: str | None) -> float | None:
    if not raw:
        return None
    m = re.search(r"\d+[\d,]*\.?\d*", raw.replace(",", ""))
    return float(m.group()) if m else None


def _scrape_brand(p_ctx, cfg: dict[str, Any]) -> list[dict[str, Any]]:
    """Scrape one brand using its Playwright context. Returns raw items dicts."""
    log.info("  → local scrape: %s (%s)", cfg["slug"], cfg["url"])
    page = p_ctx.new_page()
    try:
        page.goto(cfg["url"], wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector(cfg["wait_for"], state="attached", timeout=15000)
        page.wait_for_timeout(3000)
        # Scroll to trigger lazy loading
        for _ in range(6):
            page.evaluate("window.scrollBy(0, 800)")
            page.wait_for_timeout(400)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1500)
        items: list[dict[str, Any]] = page.evaluate(cfg["js"])
        log.info("  ✓ %s: %d products via local Playwright", cfg["slug"], len(items))
        return items
    except Exception as e:
        log.warning("  ✗ %s local scrape failed: %s", cfg["slug"], e)
        return []
    finally:
        page.close()


# ---------------------------------------------------------------------------
# Pipeline entry point — invoked from run.py
# ---------------------------------------------------------------------------
def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    targets = [c for c in BRAND_SCRAPERS
               if not brand_filter or c["slug"] in brand_filter]

    if dry_run:
        log.info("[DRY-RUN] would run local Playwright for %d brands: %s",
                 len(targets), [c["slug"] for c in targets])
        return 0

    # Lazy import — only fail if this step actually runs and playwright isn't installed
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log.error("playwright not installed — run: pip install playwright && python -m playwright install chromium")
        return 0

    brand_map: dict[str, str] = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    now_iso = datetime.now(timezone.utc).isoformat()
    all_rows: list[dict[str, Any]] = []

    log.info("Local Playwright catalog scrape for %d brands", len(targets))
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        p_ctx = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1440, "height": 900},
        )
        for cfg in targets:
            brand_id = brand_map.get(cfg["slug"])
            if not brand_id:
                log.warning("  ⚠ skipping %s: brand not in DB", cfg["slug"])
                continue

            items = _scrape_brand(p_ctx, cfg)
            for it in items:
                name = (it.get("name") or "").strip()
                if len(name) < 3:
                    continue
                # Filter obvious badge text accidentally captured as names
                if name.lower() in {"best seller", "new", "sale", "coming soon", "in stock"}:
                    continue
                regular = _parse_price(it.get("comparePrice")) or _parse_price(it.get("price"))
                sale    = None
                if it.get("comparePrice") and it.get("price"):
                    regular_p = _parse_price(it["comparePrice"])
                    sale_p    = _parse_price(it["price"])
                    if regular_p and sale_p and regular_p > sale_p:
                        regular, sale = regular_p, sale_p
                actual = sale or regular
                discount_pct = None
                if regular and sale and regular > sale:
                    discount_pct = round((regular - sale) / regular * 100, 1)
                # Only store price_usd when the source currency is USD
                price_usd = actual if cfg.get("currency", "USD") == "USD" else None
                all_rows.append({
                    "brand_id":        brand_id,
                    "name":            name[:300],
                    "url":             it.get("link") or cfg["url"],
                    "category":        "paddle",
                    "price_usd":       price_usd,
                    "sale_price_usd":  sale if cfg.get("currency", "USD") == "USD" else None,
                    "currency":        cfg.get("currency", "USD"),
                    "country_code":    "AU" if cfg.get("currency") == "AUD" else "US",
                    "avg_rating":      None,
                    "review_count":    None,
                    "in_stock":        bool(it.get("inStock", True)),
                    "discount_pct":    discount_pct,
                    "last_scraped_at": now_iso,
                })
        browser.close()

    if not all_rows:
        log.info("No products scraped via local Playwright")
        return 0

    n = sb.upsert("products", all_rows, "name,brand_id")
    log.info("✓ %d total products upserted via local Playwright", n)
    return n


if __name__ == "__main__":
    # Standalone smoke test
    import os, sys
    try:
        from dotenv import load_dotenv
        load_dotenv("scripts/.env")
    except ImportError:
        pass
    sys.exit(0 if run({}) >= 0 else 1)
