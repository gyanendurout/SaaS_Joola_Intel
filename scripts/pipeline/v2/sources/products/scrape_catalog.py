"""Product catalog scraper — fetches product pages via Playwright.

Matches the live Supabase schema:
  products(brand_id, name, url, price_usd, currency, country_code,
           avg_rating, in_stock)
Conflict key: name,brand_id
"""

from __future__ import annotations

import re
from typing import Any

from ...core import apify_client as apify
from ...core import supabase_client as sb
from ...core.logger import get_logger

log = get_logger("products.catalog")

CATALOG_URLS: list[dict[str, str]] = [
    {"slug": "joola",     "url": "https://joola.com/collections/pickleball-paddles"},
    {"slug": "selkirk",   "url": "https://www.selkirk.com/collections/paddles"},
    {"slug": "paddletek", "url": "https://www.paddletek.com/collections/paddles"},
    {"slug": "crbn",      "url": "https://www.crbnpickleball.com/collections/paddles"},
    {"slug": "six-zero",  "url": "https://www.sixzeropickleball.com/collections/paddles"},
    {"slug": "engage",    "url": "https://engagepickleball.com/collections/paddles"},
    {"slug": "onix",      "url": "https://www.onixpickleball.com/collections/paddles"},
    {"slug": "franklin",  "url": "https://www.franklinsports.com/pickleball/paddles"},
    {"slug": "head",      "url": "https://www.head.com/en_US/pickleball/paddles/"},
    {"slug": "wilson",    "url": "https://www.wilson.com/en-us/collection/pickleball/paddles"},
    {"slug": "gamma",     "url": "https://gammasports.com/pickleball/paddles/"},
]


PAGE_FUNCTION = """
async function pageFunction(context) {
    const { page, request } = context;
    await page.waitForTimeout(3000);
    const items = await page.evaluate(() => {
        const results = [];
        const seen = new Set();
        const cardSels = [
            '.product-card', '.product-item', '.product', '.product-tile',
            '[data-product-id]', '[data-product]', '.grid__item',
            '.collection-product', '.products-list-item', '.product-grid-item',
            'li[class*="product"]', 'div[class*="product-card"]',
            'article[class*="product"]'
        ];
        const all = [];
        cardSels.forEach(s => document.querySelectorAll(s).forEach(el => all.push(el)));
        all.forEach(el => {
            const name = el.querySelector(
                '.product-card__title, .product__title, .product-item-name, ' +
                '.product-title, h3, h2, .title, [class*="title"], [class*="name"]'
            )?.innerText?.trim();
            if (!name || seen.has(name)) return;
            seen.add(name);
            const price = el.querySelector(
                '.price, .product-price, .money, [class*="price"], [data-price]'
            )?.innerText?.trim();
            const link = el.querySelector('a')?.href;
            const ratingEl = el.querySelector('[class*="rating"], [class*="stars"], .star-rating, [data-rating]');
            const rating = ratingEl?.getAttribute('data-rating') || ratingEl?.innerText?.trim();
            results.push({ name, price, link, rating });
        });
        return results;
    });
    return items.map(it => Object.assign({}, it, { sourceUrl: request.url }));
}
"""


def _parse_price(raw: str | None) -> float | None:
    if not raw:
        return None
    m = re.search(r"[\d,]+\.?\d*", raw.replace(",", ""))
    return float(m.group()) if m else None


def _parse_rating(raw: Any) -> float | None:
    if raw is None or raw == "":
        return None
    m = re.search(r"\d+\.?\d*", str(raw))
    if not m:
        return None
    try:
        v = float(m.group())
        return v if 0 <= v <= 5 else None
    except (ValueError, TypeError):
        return None


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    catalog = [c for c in CATALOG_URLS if not brand_filter or c["slug"] in brand_filter]

    if dry_run:
        log.info("[DRY-RUN] would scrape product catalogs for %d brands", len(catalog))
        return 0

    items = apify.run_and_fetch("apify/playwright-scraper", {
        "startUrls":            [{"url": c["url"]} for c in catalog],
        "pageFunction":         PAGE_FUNCTION,
        "maxRequestsPerCrawl":  20,
    })

    url_to_slug = {c["url"]: c["slug"] for c in catalog}

    rows: list[dict] = []
    for item in items:
        source_url = (item.get("sourceUrl") or item.get("requestUrl")
                      or item.get("#referrer") or item.get("url") or "")
        link_url = item.get("link") or ""
        slug = None
        for u, s in url_to_slug.items():
            if u in source_url or (link_url and u.split("/")[2] in link_url):
                slug = s
                break
        brand_id = brand_map.get(slug) if slug else None
        if not brand_id:
            continue

        name = (item.get("name") or item.get("title") or "").strip()
        if not name:
            continue

        rows.append({
            "brand_id":     brand_id,
            "name":         name[:300],
            "url":          item.get("link") or item.get("url"),
            "price_usd":    _parse_price(item.get("price")),
            "currency":     "USD",
            "country_code": "US",
            "avg_rating":   _parse_rating(item.get("rating")),
            "in_stock":     True,
        })

    n = sb.upsert("products", rows, "name,brand_id") if rows else 0
    log.info("✓ %d product catalog entries upserted", n)
    return n
