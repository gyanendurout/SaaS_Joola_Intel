"""Product catalog scraper — runs per-brand to avoid Apify timeouts.

Scrapes each brand's paddle collection page and captures rich card-level data:
name, regular + sale price, star rating, review count, thumbnail, in-stock.

Most Shopify themes (used by JOOLA, Selkirk, Paddletek, CRBN, Six Zero, Engage,
Onix, Gamma) expose product ratings and review counts directly on collection
cards via Yotpo / Judge.me / Stamped widgets. This avoids the request explosion
caused by following every product detail page.

Writes to `products` table. Conflict key: name,brand_id.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

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

PAGE_FUNCTION = r"""
async function pageFunction(context) {
    const { page, request } = context;

    // Wait for page JS to settle and lazy-loaded review widgets to render.
    // page.waitForTimeout is available in the playwright-scraper Playwright build.
    // Avoid page.evaluate(async () => {...}) — async evaluate is not reliably
    // supported across all actor Playwright versions.
    await page.waitForTimeout(5000);

    const items = await page.evaluate(() => {
        const results = [];
        const seen = new Set();

        const numFrom = (s) => {
            if (!s) return null;
            const m = String(s).match(/\d+\.?\d*/);
            return m ? m[0] : null;
        };
        const firstText = (el, selectors) => {
            for (const sel of selectors) {
                const found = el.querySelector(sel);
                const t = found?.innerText?.trim();
                if (t) return t;
            }
            return null;
        };

        // ── Card discovery: link-based, theme-agnostic ─────────────────
        // Instead of guessing CSS class names (which differ across every Shopify
        // theme), we find all product links first and walk up the DOM to the
        // card container. This works for JOOLA, Selkirk, CRBN, or any other theme.
        const all = new Set();
        const productLinks = Array.from(
            document.querySelectorAll('a[href*="/products/"], a[href*="/product/"]')
        );

        // Named-class fallback for themes that don't use /products/ URL pattern
        const cardSels = [
            '.product-card', '.product-item', '[data-product-id]', '[data-product]',
            '.grid__item', '.card-wrapper', '.card-product', '.ProductItem',
            '.collection-product', '.product-grid-item', 'li[class*="product"]',
            'div[class*="product-card"]', 'article[class*="product"]',
        ];
        cardSels.forEach(s => {
            try { document.querySelectorAll(s).forEach(el => all.add(el)); }
            catch (e) {}
        });

        // Walk up from each product link to find its card container
        for (const link of productLinks) {
            let el = link.parentElement;
            for (let depth = 0; depth < 6 && el; depth++) {
                const tag = el.tagName.toLowerCase();
                const hasImg = el.querySelector('img') !== null;
                const linkCount = el.querySelectorAll('a').length;
                // A card: has an image, has few links (not a nav/list wrapper),
                // and is a block-level container
                if (hasImg && linkCount <= 5 &&
                    (tag === 'li' || tag === 'article' ||
                     tag === 'div' || tag === 'section')) {
                    all.add(el);
                    break;
                }
                el = el.parentElement;
            }
        }

        for (const el of all) {
            // Name — try many selectors in priority order
            const name = firstText(el, [
                '.card__heading a', '.card__heading',
                '.product-card__title', '.product__title',
                '.product-item__title', '.product-title',
                '.ProductItem__Title', '.card-title',
                'h2 a', 'h3 a', 'h2', 'h3',
                '[class*="title"] a', '[class*="title"]',
                '[class*="name"] a', '[class*="name"]',
            ]) || el.querySelector('a[href*="/products/"]')?.innerText?.trim();
            if (!name || seen.has(name) || name.length < 3) continue;
            seen.add(name);

            // ── Prices ──────────────────────────────────────────────────
            const regularEl = el.querySelector(
                '.price-item--regular, .price__regular, .price-regular, ' +
                's.price, .compare-at-price, [data-compare-price]'
            );
            const saleEl = el.querySelector(
                '.price-item--sale, .price__sale, .sale-price, ' +
                '.price-item--last, .price--on-sale .price-item'
            );
            const anyPriceEl = el.querySelector(
                '.price, .money, .product-price, [data-price], ' +
                '[class*="price"]:not([class*="compare"]):not([class*="was"])'
            );

            // ── Ratings — platform-specific extraction ────────────────────
            // 1. Bazaarvoice (JOOLA, Onix): meta[itemprop="ratingValue"] content attr
            // 2. Judge.me (CRBN, Paddletek): .jdgm-prev-badge[data-average-rating]
            // 3. Okendo (Selkirk): [data-oke-rating] or aria-label on stars
            // 4. Shopify SPR (Gamma, Franklin): .spr-badge[data-rating]
            // 5. Yotpo / Stamped / Loox: various data attrs + aria-labels
            let rating = null;

            // Bazaarvoice — check meta tag content first (most reliable)
            rating = rating ||
                el.querySelector('[data-bv-show="inline_rating"] meta[itemprop="ratingValue"]')?.getAttribute('content') ||
                firstText(el, [
                    '[data-bv-show="inline_rating"] .bv_averageRating_component_container .bv_text',
                    '[data-bv-show="inline_rating"] .bv_text',
                ]) ||
                numFrom(el.querySelector('[data-bv-show="inline_rating"] .bv-off-screen, [data-bv-show="inline_rating"] .bv_stars_button_container')?.getAttribute('aria-label')) ||
                numFrom(el.querySelector('[data-bv-show="inline_rating"] .bv-off-screen')?.innerText);

            // Judge.me
            rating = rating ||
                el.querySelector('.jdgm-prev-badge[data-average-rating]')?.getAttribute('data-average-rating') ||
                el.querySelector('[data-average-rating]')?.getAttribute('data-average-rating');

            // Okendo
            rating = rating ||
                el.querySelector('[data-oke-rating]')?.getAttribute('data-oke-rating') ||
                el.querySelector('.oke-sr[data-oke-reviews-rating]')?.getAttribute('data-oke-reviews-rating') ||
                numFrom(el.querySelector('.oke-stars[aria-label]')?.getAttribute('aria-label'));

            // Shopify SPR
            rating = rating ||
                el.querySelector('.spr-badge[data-rating]')?.getAttribute('data-rating') ||
                el.querySelector('.spr-starrating')?.getAttribute('data-rating');

            // Yotpo
            rating = rating ||
                numFrom(el.querySelector('.yotpo-stars [aria-label], .yotpo-stars .yotpo-icon-star')?.getAttribute('aria-label')) ||
                el.querySelector('.yotpo-bottomline .yotpo-score')?.innerText?.trim();

            // Stamped
            rating = rating ||
                el.querySelector('.stamped-badge[data-rating], .stamped-product-reviews-badge[data-rating]')?.getAttribute('data-rating');

            // Loox
            rating = rating ||
                el.querySelector('.loox-rating[data-rating], [class*="loox-rating"][data-rating]')?.getAttribute('data-rating');

            // Generic fallbacks
            rating = rating ||
                el.querySelector('meta[itemprop="ratingValue"]')?.getAttribute('content') ||
                el.querySelector('span[itemprop="ratingValue"]')?.innerText?.trim() ||
                el.querySelector('[data-rating]')?.getAttribute('data-rating') ||
                el.querySelector('[data-score]')?.getAttribute('data-score') ||
                numFrom(el.querySelector('[class*="rating-stars"][aria-label], [class*="star-rating"][aria-label]')?.getAttribute('aria-label'));

            // ── Review count — platform-specific extraction ───────────────
            let reviewCount = null;

            // Bazaarvoice
            reviewCount = reviewCount ||
                el.querySelector('[data-bv-show="inline_rating"] meta[itemprop="reviewCount"]')?.getAttribute('content') ||
                numFrom(firstText(el, [
                    '[data-bv-show="inline_rating"] .bv_numReviews_component_container .bv_text',
                    '[data-bv-show="inline_rating"] .bv_numReviews_text',
                ]));

            // Judge.me
            reviewCount = reviewCount ||
                el.querySelector('.jdgm-prev-badge[data-number-of-reviews]')?.getAttribute('data-number-of-reviews') ||
                el.querySelector('[data-number-of-reviews]')?.getAttribute('data-number-of-reviews');

            // Okendo
            reviewCount = reviewCount ||
                numFrom(firstText(el, [
                    '.oke-sr-count',
                    '.oke-sr [class*="count"]',
                    '[data-oke-reviews-product-id] .oke-sr-count',
                ]));

            // Shopify SPR
            reviewCount = reviewCount ||
                numFrom(el.querySelector('.spr-badge-caption')?.innerText);

            // Yotpo
            reviewCount = reviewCount ||
                numFrom(el.querySelector('.yotpo-bottomline .text-m')?.innerText);

            // Stamped
            reviewCount = reviewCount ||
                numFrom(el.querySelector('.stamped-badge-caption')?.innerText);

            // Loox
            reviewCount = reviewCount ||
                numFrom(el.querySelector('.loox-rating-count')?.innerText);

            // Generic fallbacks
            reviewCount = reviewCount ||
                el.querySelector('[data-review-count]')?.getAttribute('data-review-count') ||
                el.querySelector('meta[itemprop="reviewCount"]')?.getAttribute('content') ||
                el.querySelector('span[itemprop="reviewCount"]')?.innerText?.trim() ||
                numFrom(el.querySelector('[class*="review-count"], [class*="reviews-count"]')?.innerText);

            const link = el.querySelector('a[href*="/products/"], a[href*="/product/"], a')?.href;
            const imgEl = el.querySelector('img');
            const thumbnail = imgEl?.src || imgEl?.getAttribute('data-src') ||
                              imgEl?.getAttribute('data-lazy-src') || null;

            const soldOut = el.querySelector('.sold-out, .soldout, [class*="soldout"], .badge--sold-out');

            results.push({
                name,
                price:        anyPriceEl?.innerText?.trim() || null,
                regularPrice: regularEl?.innerText?.trim() || null,
                salePrice:    saleEl?.innerText?.trim() || null,
                rating,
                reviewCount,
                link,
                thumbnail,
                inStock:      !soldOut,
            });
        }
        return results;
    });
    return items;
}
"""


def _parse_price(raw: str | None) -> float | None:
    if not raw:
        return None
    clean = re.sub(r"[^\d.,]", "", raw).replace(",", "")
    m = re.search(r"\d+\.?\d*", clean)
    return float(m.group()) if m else None


def _parse_rating(raw: Any) -> float | None:
    if raw is None or raw == "":
        return None
    m = re.search(r"\d+\.?\d*", str(raw))
    if not m:
        return None
    try:
        v = float(m.group())
        return v if 0 < v <= 5 else None
    except (ValueError, TypeError):
        return None


def _parse_review_count(raw: Any) -> int | None:
    if raw is None or raw == "":
        return None
    m = re.search(r"\d+", str(raw))
    return int(m.group()) if m else None


def _scrape_one_brand(slug: str, brand_id: str, url: str) -> list[dict]:
    """Run Apify scraper for ONE brand collection page. Returns row dicts."""
    log.info("  → scraping %s (%s)", slug, url)
    try:
        items = apify.run_and_fetch(
            "apify/playwright-scraper",
            {
                "startUrls":           [{"url": url}],
                "pageFunction":        PAGE_FUNCTION,
                "maxRequestsPerCrawl": 5,   # just the collection page + pagination
                "maxConcurrency":      2,
            },
            timeout_secs=420,   # hard 7-min cap per brand (BV/Okendo JS needs time)
            memory_mb=2048,
        )
    except Exception as e:
        log.warning("  ✗ %s failed: %s", slug, e)
        return []

    now_iso = datetime.now(timezone.utc).isoformat()
    seen: dict[str, dict] = {}

    for item in items:
        name = (item.get("name") or "").strip()
        if not name or len(name) < 3:
            continue

        regular = _parse_price(item.get("regularPrice"))
        sale = _parse_price(item.get("salePrice"))
        any_price = _parse_price(item.get("price"))

        # Determine actual selling price
        actual = sale or any_price or regular
        compare = regular if (regular and sale and regular > sale) else None

        discount_pct = None
        if compare and actual and compare > actual:
            discount_pct = round((compare - actual) / compare * 100, 1)

        key = name.lower()
        seen[key] = {
            "brand_id":        brand_id,
            "name":            name[:300],
            "url":             item.get("link") or url,
            "category":        "paddle",
            "price_usd":       actual,
            "sale_price_usd":  sale,
            "currency":        "USD",
            "country_code":    "US",
            "avg_rating":      _parse_rating(item.get("rating")),
            "review_count":    _parse_review_count(item.get("reviewCount")),
            "in_stock":        bool(item.get("inStock", True)),
            "discount_pct":    discount_pct,
            "last_scraped_at": now_iso,
        }

    rows = list(seen.values())
    with_rating = sum(1 for r in rows if r["avg_rating"] is not None)
    with_reviews = sum(1 for r in rows if r["review_count"] is not None)
    log.info("  ✓ %s: %d products (%d with rating, %d with reviews)",
             slug, len(rows), with_rating, with_reviews)
    return rows


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    catalog = [c for c in CATALOG_URLS if not brand_filter or c["slug"] in brand_filter]

    if dry_run:
        log.info("[DRY-RUN] would scrape product catalogs for %d brands", len(catalog))
        return 0

    log.info("Scraping product catalogs for %d brands (sequential, 5-min cap each)", len(catalog))

    all_rows: list[dict] = []
    for c in catalog:
        brand_id = brand_map.get(c["slug"])
        if not brand_id:
            log.warning("  ⚠ skipping %s: brand not in DB", c["slug"])
            continue
        all_rows.extend(_scrape_one_brand(c["slug"], brand_id, c["url"]))

    if not all_rows:
        log.info("No products scraped")
        return 0

    n = sb.upsert("products", all_rows, "name,brand_id")
    log.info("✓ %d total products upserted", n)
    return n
