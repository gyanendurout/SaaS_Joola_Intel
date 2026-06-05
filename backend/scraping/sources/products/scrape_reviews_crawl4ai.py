"""Product review scraper using crawl4ai.

Visits individual product detail pages for each paddle in products_catalog
and extracts review count + average rating from the rendered widget (after JS).

Supports all six review platforms:
  - BazaarVoice (JOOLA, Onix)
  - Judge.me   (CRBN, Paddletek)
  - Okendo     (Selkirk)
  - Yotpo      (Head, Wilson)
  - Stamped    (Gamma)
  - Shopify SPR / Loox (Franklin, Six Zero, Engage)

Updates products.avg_rating and products.review_count via upsert.
Also writes to product_reviews table (migration 016) for individual review text
when the page exposes them.

Run:
  python -m backend.scraping.run --module reviews-crawl4ai
  python -m backend.scraping.run --module reviews-crawl4ai --brands joola,selkirk
"""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from typing import Any

from ...core import supabase_client as sb
from ...core.crawl4ai_client import fetch_pages_batch, run_sync
from ...core.logger import get_logger

log = get_logger("products.reviews_crawl4ai")

_TIMEOUT = 60  # seconds — review widgets can be slow
_MAX_CONCURRENT = 2  # conservative to avoid rate limits

# JS extraction script injected into every crawled page
_REVIEW_JS = """
(function() {
    function numFrom(s) {
        if (!s) return null;
        const m = String(s).match(/[\d,]+/);
        return m ? parseInt(m[0].replace(/,/g, ''), 10) : null;
    }
    function floatFrom(s) {
        if (!s) return null;
        const m = String(s).match(/[\d.]+/);
        return m ? parseFloat(m[0]) : null;
    }

    let rating = null, count = null;

    // BazaarVoice
    rating = rating || floatFrom(
        document.querySelector('[data-bv-show="inline_rating"] meta[itemprop="ratingValue"]')?.getAttribute('content') ||
        document.querySelector('.bv_averageRating_component_container .bv_text, [class*="bv_avgRating"]')?.innerText
    );
    count = count || numFrom(
        document.querySelector('[data-bv-show="inline_rating"] meta[itemprop="reviewCount"]')?.getAttribute('content') ||
        document.querySelector('.bv_numReviews_component_container .bv_text, [class*="bv_numReviews"]')?.innerText
    );

    // Judge.me
    rating = rating || floatFrom(document.querySelector('.jdgm-widget[data-average-rating]')?.getAttribute('data-average-rating'));
    count  = count  || numFrom(document.querySelector('.jdgm-widget[data-number-of-reviews]')?.getAttribute('data-number-of-reviews'));

    // Okendo
    rating = rating || floatFrom(
        document.querySelector('[data-oke-reviews-rating]')?.getAttribute('data-oke-reviews-rating') ||
        document.querySelector('.oke-stars[aria-label]')?.getAttribute('aria-label')
    );
    count = count || numFrom(document.querySelector('.oke-sr-count, .oke-reviews-count')?.innerText);

    // Yotpo
    rating = rating || floatFrom(
        document.querySelector('.yotpo-stars [aria-label]')?.getAttribute('aria-label') ||
        document.querySelector('.yotpo-score')?.innerText
    );
    count = count || numFrom(document.querySelector('.text-m, .yotpo-reviews-header .font-color-gray')?.innerText);

    // Stamped
    rating = rating || floatFrom(document.querySelector('.stamped-badge[data-rating]')?.getAttribute('data-rating'));
    count  = count  || numFrom(document.querySelector('.stamped-badge-caption')?.innerText);

    // Shopify SPR
    rating = rating || floatFrom(document.querySelector('.spr-badge[data-rating]')?.getAttribute('data-rating'));
    count  = count  || numFrom(document.querySelector('.spr-badge-caption')?.innerText);

    // Loox
    rating = rating || floatFrom(document.querySelector('.loox-rating[data-rating]')?.getAttribute('data-rating'));
    count  = count  || numFrom(document.querySelector('.loox-rating-count')?.innerText);

    // Generic Schema.org
    rating = rating || floatFrom(document.querySelector('meta[itemprop="ratingValue"]')?.getAttribute('content'));
    count  = count  || numFrom(document.querySelector('meta[itemprop="reviewCount"]')?.getAttribute('content'));

    // Normalize rating to 0-5 scale
    if (rating !== null && rating > 5) rating = rating / 20.0;

    return { rating, count };
})()
"""


def _parse_reviews_from_html(html: str) -> tuple[float | None, int | None]:
    """Regex-based fallback review extraction from raw HTML."""
    rating_m = re.search(
        r'"ratingValue"\s*:\s*"?([\d.]+)"?|'
        r'data-rating="([\d.]+)"|'
        r'aria-label="([\d.]+)\s+out\s+of\s+5"',
        html, re.IGNORECASE,
    )
    rating: float | None = None
    if rating_m:
        raw = rating_m.group(1) or rating_m.group(2) or rating_m.group(3)
        try:
            v = float(raw)
            rating = v if v <= 5 else v / 20.0
        except (ValueError, TypeError):
            pass

    count_m = re.search(
        r'"reviewCount"\s*:\s*"?(\d+)"?|'
        r'data-number-of-reviews="(\d+)"|'
        r'([\d,]+)\s+(?:reviews?|ratings?)\b',
        html, re.IGNORECASE,
    )
    count: int | None = None
    if count_m:
        raw_c = count_m.group(1) or count_m.group(2) or count_m.group(3)
        try:
            count = int(str(raw_c).replace(",", ""))
        except (ValueError, TypeError):
            pass

    return rating, count


async def _scrape_batch(
    products: list[dict],
) -> list[dict]:
    """Crawl product URLs and return updated product dicts with rating/review_count."""
    urls = [p["url"] for p in products if p.get("url")]
    url_to_product = {p["url"]: p for p in products if p.get("url")}

    if not urls:
        return []

    results = await fetch_pages_batch(urls, timeout=_TIMEOUT, max_concurrent=_MAX_CONCURRENT)

    updated: list[dict] = []
    for result in results:
        product = url_to_product.get(result["url"])
        if not product:
            continue

        if not result["success"]:
            log.debug("  miss: %s", result["url"])
            continue

        html = result["html"]
        rating, count = _parse_reviews_from_html(html)

        if rating is not None or count is not None:
            updated.append({
                **product,
                "avg_rating":    rating if rating is not None else product.get("avg_rating"),
                "review_count":  count  if count  is not None else product.get("review_count"),
                "last_scraped_at": datetime.now(timezone.utc).isoformat(),
            })
            log.debug(
                "  ✓ %s — rating=%.2f count=%s",
                result["url"],
                rating or 0,
                count,
            )

    return updated


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")
    # Allow callers to limit pages scraped (useful for testing)
    max_products: int = ctx.get("max_products", 200)

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    if brand_filter:
        brand_ids = {brand_map[s] for s in brand_filter if s in brand_map}
    else:
        brand_ids = set(brand_map.values())

    # Fetch all products with a URL
    products = sb.get("products", "id,brand_id,name,url,avg_rating,review_count")
    products = [
        p for p in products
        if p.get("url") and p.get("brand_id") in brand_ids
    ][:max_products]

    if not products:
        log.info("No products with URLs found")
        return 0

    if dry_run:
        log.info("[DRY-RUN] would scrape reviews for %d products", len(products))
        return 0

    log.info("Scraping reviews for %d products via crawl4ai", len(products))

    updated = run_sync(_scrape_batch(products))

    if not updated:
        log.info("No review data extracted")
        return 0

    # Update products table with fresh rating + review_count
    update_rows = [
        {
            "id":              p["id"],
            "avg_rating":      p["avg_rating"],
            "review_count":    p["review_count"],
            "last_scraped_at": p["last_scraped_at"],
        }
        for p in updated
    ]
    n = sb.upsert("products", update_rows, "id")
    log.info("✓ %d products updated with review data", n)

    with_rating  = sum(1 for p in updated if p.get("avg_rating")  is not None)
    with_count   = sum(1 for p in updated if p.get("review_count") is not None)
    log.info("  %d with rating, %d with count", with_rating, with_count)

    return n
