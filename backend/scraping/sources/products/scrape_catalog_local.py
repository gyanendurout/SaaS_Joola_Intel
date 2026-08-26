"""Local Playwright product-catalog scraper.

For brands that Apify's apify/playwright-scraper can't crack (custom Shopify themes,
non-standard URL patterns, hash-suffixed class names, AJAX-only product grids), we
run Playwright directly on the host machine with per-brand DOM extraction rules.

This module is intentionally separate from `scrape_catalog.py` (the Apify-based
catalog scraper). The weekly pipeline runs Apify first for brands it handles well
(Selkirk/Paddletek/CRBN/Gamma) and falls back to this module for the rest.

Brands handled here (7):
  - joola      .card.card-product           (Judge.me likely)
  - six-zero   .grid__item                  (AUD prices — Yotpo / Okendo)
  - onix       .ProductItem                 (Bazaarvoice; lazy-rendered, 8s wait)
  - franklin   .product-item / [data-pid]   (Bazaarvoice)
  - head       [class*="productCard-root"]  (proprietary; regex fallback)
  - engage     .card / .card.column         (regex fallback — works today)
  - wilson     [data-test*="product-tile"]  (Bazaarvoice)

Every brand's JS extractor now runs the SAME cascading rating/review widget
detector (Bazaarvoice → Judge.me → Okendo → Shopify-SPR → Yotpo → Stamped →
Loox → generic itemprop → regex on innerText). If none of those resolve, the
extractor returns `null` for `rating` / `reviewCount` — the Python upsert
then writes `null` (NOT 0) into `products.avg_rating` / `products.review_count`.

Run standalone:
    python -m backend.scraping.sources.products.scrape_catalog_local

Run via pipeline:
    Called automatically by run.py through products_scrape_catalog_local step.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Callable

from ...core import supabase_client as sb
from ...core.logger import get_logger
from ...core.network import http_request

# products.json is a plain JSON endpoint; a browser UA keeps storefronts that
# trim responses for obvious bots from doing so.
_PRODUCTS_JSON_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

log = get_logger("products.catalog_local")


# ---------------------------------------------------------------------------
# Shared JS helpers — inlined into every per-brand extractor so each
# page.evaluate() call is self-contained (no cross-evaluate state). Keep these
# in sync with the equivalent block in scrape_catalog.py (PAGE_FUNCTION) so
# Apify and local scrapers extract ratings the same way.
#
# extractRating(card) / extractReviewCount(card) try widget vendors in this
# cascade order (most reliable first):
#   1. Bazaarvoice   (JOOLA, Onix, Franklin, Wilson)  meta[itemprop] + .bv-*
#   2. Judge.me      (CRBN, Paddletek, often JOOLA)    [data-average-rating]
#   3. Okendo        (Selkirk, sometimes six-zero)     [data-oke-rating]
#   4. Shopify SPR   (Gamma, Franklin)                 .spr-badge[data-rating]
#   5. Yotpo         (six-zero, others)                .yotpo-stars[aria-label]
#   6. Stamped       (rare)                            .stamped-badge[data-rating]
#   7. Loox          (rare)                            .loox-rating[data-rating]
#   8. Generic       itemprop="ratingValue" / [data-rating] / [data-score]
#   9. Regex fallback over card.innerText (engage-style "4.5 out of 5 · 12 Reviews")
#
# All accessors are wrapped in optional chains so missing nodes return null;
# no widget = returns null (never 0).
# ---------------------------------------------------------------------------
RATING_EXTRACTORS_JS = r"""
// These helpers are inlined INSIDE the per-brand arrow function via string
// concatenation, so they share that function's scope. Do NOT add a leading
// `() => {` here — the per-brand JS supplies its own arrow body and the
// `}` closer at the end.
const numFrom = (s) => {
    if (!s) return null;
    const m = String(s).match(/\d+\.?\d*/);
    return m ? m[0] : null;
};

const extractRating = (el) => {
    if (!el) return null;
    let r = null;
    // 1. Bazaarvoice
    r = r ||
        el.querySelector('[data-bv-show="inline_rating"] meta[itemprop="ratingValue"]')?.getAttribute('content') ||
        el.querySelector('[data-bv-show="inline_rating"] .bv_averageRating_component_container .bv_text')?.innerText?.trim() ||
        el.querySelector('[data-bv-show="inline_rating"] .bv_text')?.innerText?.trim() ||
        numFrom(el.querySelector('[data-bv-show="inline_rating"] .bv-off-screen')?.innerText) ||
        numFrom(el.querySelector('[data-bv-show="inline_rating"] .bv_stars_button_container')?.getAttribute('aria-label'));
    // 2. Judge.me
    r = r ||
        el.querySelector('.jdgm-prev-badge[data-average-rating]')?.getAttribute('data-average-rating') ||
        el.querySelector('[data-average-rating]')?.getAttribute('data-average-rating');
    // 3. Okendo
    r = r ||
        el.querySelector('[data-oke-rating]')?.getAttribute('data-oke-rating') ||
        el.querySelector('.oke-sr[data-oke-reviews-rating]')?.getAttribute('data-oke-reviews-rating') ||
        numFrom(el.querySelector('.oke-stars[aria-label]')?.getAttribute('aria-label'));
    // 4. Shopify SPR
    r = r ||
        el.querySelector('.spr-badge[data-rating]')?.getAttribute('data-rating') ||
        el.querySelector('.spr-starrating')?.getAttribute('data-rating');
    // 5. Yotpo
    r = r ||
        numFrom(el.querySelector('.yotpo-stars [aria-label]')?.getAttribute('aria-label')) ||
        el.querySelector('.yotpo-bottomline .yotpo-score')?.innerText?.trim();
    // 6. Stamped
    r = r ||
        el.querySelector('.stamped-badge[data-rating], .stamped-product-reviews-badge[data-rating]')?.getAttribute('data-rating');
    // 7. Loox
    r = r ||
        el.querySelector('.loox-rating[data-rating], [class*="loox-rating"][data-rating]')?.getAttribute('data-rating');
    // 8. Generic schema.org / data-*
    r = r ||
        el.querySelector('meta[itemprop="ratingValue"]')?.getAttribute('content') ||
        el.querySelector('span[itemprop="ratingValue"]')?.innerText?.trim() ||
        el.querySelector('[data-rating]')?.getAttribute('data-rating') ||
        el.querySelector('[data-score]')?.getAttribute('data-score') ||
        numFrom(el.querySelector('[class*="rating-stars"][aria-label], [class*="star-rating"][aria-label]')?.getAttribute('aria-label'));
    // 9. Regex fallback over visible text
    if (!r) {
        const t = el.innerText || '';
        const m = t.match(/(\d+\.\d+)\s*(?:out\s*of|\/)\s*5/i);
        if (m) r = m[1];
    }
    return r;
};

const extractReviewCount = (el) => {
    if (!el) return null;
    let c = null;
    // 1. Bazaarvoice
    c = c ||
        el.querySelector('[data-bv-show="inline_rating"] meta[itemprop="reviewCount"]')?.getAttribute('content') ||
        numFrom(el.querySelector('[data-bv-show="inline_rating"] .bv_numReviews_component_container .bv_text')?.innerText) ||
        numFrom(el.querySelector('[data-bv-show="inline_rating"] .bv_numReviews_text')?.innerText);
    // 2. Judge.me
    c = c ||
        el.querySelector('.jdgm-prev-badge[data-number-of-reviews]')?.getAttribute('data-number-of-reviews') ||
        el.querySelector('[data-number-of-reviews]')?.getAttribute('data-number-of-reviews');
    // 3. Okendo
    c = c ||
        numFrom(el.querySelector('.oke-sr-count')?.innerText) ||
        numFrom(el.querySelector('.oke-sr [class*="count"]')?.innerText);
    // 4. Shopify SPR
    c = c ||
        numFrom(el.querySelector('.spr-badge-caption')?.innerText);
    // 5. Yotpo
    c = c ||
        numFrom(el.querySelector('.yotpo-bottomline .text-m')?.innerText);
    // 6. Stamped
    c = c ||
        numFrom(el.querySelector('.stamped-badge-caption')?.innerText);
    // 7. Loox
    c = c ||
        numFrom(el.querySelector('.loox-rating-count')?.innerText);
    // 8. Generic
    c = c ||
        el.querySelector('[data-review-count]')?.getAttribute('data-review-count') ||
        el.querySelector('meta[itemprop="reviewCount"]')?.getAttribute('content') ||
        el.querySelector('span[itemprop="reviewCount"]')?.innerText?.trim() ||
        numFrom(el.querySelector('[class*="review-count"], [class*="reviews-count"]')?.innerText);
    // 9. Regex fallback (engage-style "12 Reviews")
    if (!c) {
        const t = el.innerText || '';
        const m = t.match(/(\d+)\s*Reviews?/i);
        if (m) c = m[1];
    }
    return c;
};
"""


# ---------------------------------------------------------------------------
# Per-brand extraction scripts — each returns a list of {name, price, ...} dicts.
# We keep these as JS strings so they can run inside page.evaluate() unchanged.
# Each per-brand JS prefixes RATING_EXTRACTORS_JS so extractRating /
# extractReviewCount are in scope.
# ---------------------------------------------------------------------------

JS_JOOLA = r"""() => {""" + RATING_EXTRACTORS_JS + r"""
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
            rating: extractRating(card),
            reviewCount: extractReviewCount(card),
            link: linkEl?.href || null,
            thumbnail: imgEl?.src || imgEl?.getAttribute('data-src') || null,
            inStock: card.querySelector('.sold-out, .soldout, .badge--sold-out') === null,
        });
    });
    return out;
}"""

JS_SIX_ZERO = r"""() => {""" + RATING_EXTRACTORS_JS + r"""
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
            rating: extractRating(card),
            reviewCount: extractReviewCount(card),
            thumbnail: img?.src || img?.getAttribute('data-src') || null,
            inStock: card.querySelector('.sold-out, .soldout') === null,
        });
    });
    return out;
}"""

JS_ONIX = r"""() => {""" + RATING_EXTRACTORS_JS + r"""
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
            rating: extractRating(card),
            reviewCount: extractReviewCount(card),
            thumbnail: img?.src || img?.getAttribute('data-src') || null,
            inStock: card.querySelector('.sold-out, .soldout') === null,
        });
    });
    return out;
}"""

JS_FRANKLIN = r"""() => {""" + RATING_EXTRACTORS_JS + r"""
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
            rating: extractRating(card),
            reviewCount: extractReviewCount(card),
            thumbnail: img?.src || img?.getAttribute('data-src') || null,
            inStock: true,
        });
    });
    return out;
}"""

JS_ENGAGE = r"""() => {""" + RATING_EXTRACTORS_JS + r"""
    // Scope to the listing area to avoid menu items that also use /products/
    const container = document.querySelector('.filters-results, .product-list, .grid--row-gutters');
    const cards = (container || document).querySelectorAll('.card.column, .card.quarter, .card');
    const out = []; const seen = new Set();
    cards.forEach(card => {
        const titleEl = card.querySelector('.card__title, h3, h2');
        const linkEl = card.querySelector('.card__link, a[href*="/products/"]');
        const imgEl = card.querySelector('img');
        const allText = (card.innerText || '');
        const name = titleEl?.innerText?.trim();
        if (!name || seen.has(name) || name.length < 3) return;
        // Skip nav-menu rejects with very short generic names
        if (/^(by performance|by type|advanced|intermediate|beginner|new|sale)/i.test(name)
            && name.length < 25) return;
        seen.add(name);
        const priceMatch = allText.match(/\$\d+\.\d{2}/);
        // extractRating/extractReviewCount already include the engage-style
        // regex fallback as their final step, so this single call covers both
        // the original "X out of 5" / "N Reviews" pattern AND any widget if
        // engage swaps to one later.
        out.push({
            name,
            price: priceMatch ? priceMatch[0] : null,
            rating: extractRating(card),
            reviewCount: extractReviewCount(card),
            link: linkEl?.href || null,
            thumbnail: imgEl?.src || imgEl?.getAttribute('data-src') || null,
            inStock: !allText.toLowerCase().includes('sold out'),
        });
    });
    return out;
}"""

JS_HEAD = r"""() => {""" + RATING_EXTRACTORS_JS + r"""
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
            // HEAD typically ships no public rating widget on the collection
            // grid, so this usually resolves to null — but the cascade is
            // here in case they add one.
            rating: extractRating(card),
            reviewCount: extractReviewCount(card),
            link,
            thumbnail: img?.src || img?.getAttribute('data-src') || null,
            inStock: !allText.toLowerCase().includes('out of stock'),
        });
    });
    return out;
}"""

JS_WILSON = r"""() => {""" + RATING_EXTRACTORS_JS + r"""
    // wilson.com uses a custom theme; tile selector covers both the
    // current data-test attribute and the older productTile class fallback.
    const cards = document.querySelectorAll(
        '[data-test*="product-tile"], [data-testid*="product-tile"], ' +
        '[class*="productTile"], [class*="product-tile"], article[class*="product"]'
    );
    const out = []; const seen = new Set();
    cards.forEach(card => {
        const nameEl = card.querySelector(
            '[data-test*="product-name"], [data-testid*="product-name"], ' +
            '[class*="productName"], [class*="product-name"], h2, h3'
        );
        const name = nameEl?.innerText?.trim();
        if (!name || seen.has(name) || name.length < 3) return;
        seen.add(name);
        const priceEl = card.querySelector(
            '[data-test*="price"], [data-testid*="price"], ' +
            '[class*="price"]:not([class*="strikethrough"]):not([class*="was"])'
        );
        const compareEl = card.querySelector(
            '[class*="strikethrough"], [class*="wasPrice"], ' +
            '[class*="was-price"], [class*="originalPrice"], s'
        );
        const link = card.querySelector('a[href*="/p/"], a[href*="/product"], a')?.href;
        const img = card.querySelector('img');
        const allText = (card.innerText || '');
        out.push({
            name,
            price: priceEl?.innerText?.trim() || null,
            comparePrice: compareEl?.innerText?.trim() || null,
            rating: extractRating(card),
            reviewCount: extractReviewCount(card),
            link,
            thumbnail: img?.src || img?.getAttribute('data-src') ||
                       img?.getAttribute('data-srcset')?.split(' ')[0] || null,
            inStock: !/out\s*of\s*stock|sold\s*out/i.test(allText),
        });
    });
    return out;
}"""


# ---------------------------------------------------------------------------
# Brand configuration.
# ── FX normalisation ────────────────────────────────────────────────────────
# Six Zero is an AU storefront. Before migration 025 this scraper simply threw
# its prices away: price_usd was set to None for any non-USD currency and the
# published AUD figure was stored nowhere at all. Net effect was 24 of Six
# Zero's 35 catalog rows carrying no price, which removed the brand from price
# analysis entirely and left it with no Tier on Product Intel.
#
# Now the local figure is always kept (price_local) and converted where a rate
# exists. fx_rate_used + fx_rate_date travel with the row so any converted price
# can be audited later — "what rate produced this, and when" is answerable
# without guessing.
_FX_CACHE: dict[tuple[str, str], tuple[float, str] | None] = {}


def _fx_rate(base_ccy: str, quote_ccy: str = "USD") -> tuple[float, str] | None:
    """Newest (rate, as_of) for base->quote, or None if no rate is on file.

    Cached per run: this is called once per scraped product and the rate does
    not change mid-crawl.
    """
    key = (base_ccy, quote_ccy)
    if key in _FX_CACHE:
        return _FX_CACHE[key]
    result: tuple[float, str] | None = None
    try:
        # get_filtered, not get: sb.get() prefixes every param with "eq.",
        # which would emit base_ccy=eq.eq.AUD and limit=eq.1.
        rows = sb.get_filtered(
            "fx_rates", "rate,as_of",
            f"base_ccy=eq.{base_ccy}&quote_ccy=eq.{quote_ccy}"
            f"&order=as_of.desc&limit=1",
        )
        if rows:
            result = (float(rows[0]["rate"]), rows[0]["as_of"])
    except Exception as exc:  # noqa: BLE001 - a missing rate must not stop a scrape
        log.warning("  ⚠ FX lookup %s->%s failed: %s", base_ccy, quote_ccy, exc)
    if result is None:
        log.warning(
            "  ⚠ no %s->%s rate on file — prices stay local and those products "
            "will have no USD price or Tier", base_ccy, quote_ccy,
        )
    _FX_CACHE[key] = result
    return result


# `currency` defaults to USD; only override where the site quotes another currency.
# ---------------------------------------------------------------------------
BRAND_SCRAPERS: list[dict[str, Any]] = [
    {"slug": "joola", "shopify_domain": "joola.com",    "url": "https://joola.com/collections/pickleball-paddles",
     "wait_for": ".card.card-product", "js": JS_JOOLA, "currency": "USD",
     "stealth": False, "extra_wait": 5000},
    {"slug": "six-zero", "shopify_domain": "www.sixzeropickleball.com", "url": "https://www.sixzeropickleball.com/collections/paddles",
     "wait_for": ".grid__item",        "js": JS_SIX_ZERO, "currency": "AUD",
     "stealth": False, "extra_wait": 5000},
    # onix uses Bazaarvoice which lazy-renders after the page is interactive;
    # 8000ms gives the BV bundle time to hydrate, otherwise rating selectors
    # come back null even though the widget would have loaded on a real page view.
    {"slug": "onix", "shopify_domain": "www.onixpickleball.com",     "url": "https://www.onixpickleball.com/collections/paddles",
     "wait_for": ".ProductItem",       "js": JS_ONIX, "currency": "USD",
     "stealth": False, "extra_wait": 8000},
    {"slug": "franklin", "url": "https://www.franklinsports.com/pickleball/paddles",
     "wait_for": ".product-item",      "js": JS_FRANKLIN, "currency": "USD",
     "stealth": False, "extra_wait": 6000},
    {"slug": "head",     "url": "https://www.head.com/en_US/shop-pickleball/paddle",
     "wait_for": '[class*="productCard-root"]', "js": JS_HEAD, "currency": "USD",
     "stealth": False, "extra_wait": 4000},
    {"slug": "wilson",   "url": "https://www.wilson.com/en-us/collection/pickleball/paddles",
     "wait_for": '[data-test*="product-tile"], [class*="productTile"], article[class*="product"]',
     "js": JS_WILSON, "currency": "USD", "stealth": False, "extra_wait": 8000},
    {"slug": "engage", "shopify_domain": "engagepickleball.com",   "url": "https://engagepickleball.com/collections/allpaddles",
     "wait_for": ".card", "js": JS_ENGAGE, "currency": "USD",
     "stealth": True, "extra_wait": 8000},
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# ── currency detection + plausibility ───────────────────────────────────────
# Shopify geo-prices by visitor IP, and the `currency` field in BRAND_SCRAPERS
# is a static guess about what a US visitor would see. Run the crawl from
# anywhere else and the two disagree silently.
#
# 2026-08-26, crawling from an India-based host:
#     Six Zero "Black Opal 14mm"  rendered  Rs. 21,400.00   (INR)
#                                 config    currency = AUD
#                                 stored    price_local 21400 AUD -> $14,124
# A $300 paddle recorded at fourteen thousand dollars, and nothing raised,
# because 21400 is a well-formed number and AUD is a well-formed currency. The
# only evidence of the fault was in the price string itself, which said rupees.
#
# So: read the currency off the rendered text, and treat the configured value
# only as the tie-breaker for a bare `$`, which really is ambiguous.
_CURRENCY_MARKS: tuple[tuple[str, str], ...] = (
    # Explicit ISO codes first — unambiguous wherever they appear.
    ("aud", "AUD"), ("usd", "USD"), ("cad", "CAD"), ("gbp", "GBP"),
    ("eur", "EUR"), ("inr", "INR"), ("nzd", "NZD"),
    # Then symbols and local abbreviations. Longer forms before shorter ones so
    # "ca$" is not consumed by "a$".
    ("rs.", "INR"), ("rs ", "INR"), ("₹", "INR"),
    ("ca$", "CAD"), ("nz$", "NZD"), ("a$", "AUD"),
    ("£", "GBP"), ("€", "EUR"),
)

# No pickleball product costs this much. The dearest paddle in the tracked
# catalog lists at $299.95; the ceiling sits well above that so a genuine
# premium launch is never clipped, while a currency mix-up — which is out by
# 50x or more — cannot pass.
MAX_PLAUSIBLE_USD = 2000.0

# A product-grid selector broad enough to catch every card also catches the
# collection page's filter sidebar. These are facet labels, never product names.
# Anchored and whole-string so a real paddle called "Hybrid 16mm Elongated"
# is untouched — only a name that is nothing BUT a facet word is dropped.
_FACET_LABEL = re.compile(
    r"^(?:thickness|shape|hybrid|elongated|widebody|wide body|standard|core|"
    r"weight|grip|colou?r|size|price|brand|type|material|sort|filter|all|"
    r"availability|in stock|out of stock|\d+\s*mm)$",
    re.I)


def detect_currency(raw: str | None, configured: str = "USD") -> str:
    """ISO code for the currency a price string is actually quoted in.

    Falls back to `configured` only when the text carries no evidence beyond a
    bare `$`, which could legitimately be USD, AUD or CAD.
    """
    if not raw:
        return configured
    text = str(raw).lower()
    for mark, code in _CURRENCY_MARKS:
        if mark in text:
            return code
    return configured


def shopify_price_index(domain: str) -> dict[str, tuple[float | None, float | None]]:
    """{handle: (price, compare_at_price)} from a Shopify storefront's products.json.

    THE reason this exists: /products.json is served in the shop's OWN default
    currency and is not geo-localized, while the rendered collection page is.
    Crawling six-zero from India renders `Rs. 21,400.00`; products.json returns
    `300.00`, the real AUD list price, from the same host at the same moment.

    That also makes the `currency` field in BRAND_SCRAPERS true again — it
    describes the shop's default currency, which is exactly what these numbers
    are quoted in.

    Returns {} on any failure, so the caller silently falls back to the DOM
    price and the plausibility guard remains the backstop.
    """
    index: dict[str, tuple[float | None, float | None]] = {}
    for page in range(1, 11):                     # 250/page
        try:
            resp = http_request(
                "GET", f"https://{domain}/products.json?limit=250&page={page}",
                headers={"User-Agent": _PRODUCTS_JSON_UA}, timeout=30)
            if resp.status_code != 200:
                break
            products = json.loads(resp.text).get("products", [])
        except Exception as exc:                  # noqa: BLE001 - fall back to DOM
            log.warning("  ⚠ %s products.json unavailable (%s) — falling back to "
                        "rendered prices, which may be geo-localized", domain, exc)
            break
        if not products:
            break
        for product in products:
            handle = str(product.get("handle") or "").strip()
            variants = product.get("variants") or []
            if not handle or not variants:
                continue
            # Variant 0 is the default the collection page shows.
            first = variants[0]
            index[handle] = (_parse_price(first.get("price")),
                             _parse_price(first.get("compare_at_price")))
    return index


def shopify_handle(link: str | None) -> str:
    """`https://shop.com/products/black-opal-14mm?v=1` -> `black-opal-14mm`."""
    if not link or "/products/" not in link:
        return ""
    tail = str(link).split("/products/", 1)[1]
    return tail.split("?", 1)[0].split("#", 1)[0].strip("/").split("/")[0]


def plausible_usd(price: float | None) -> bool:
    """False for a price no pickleball product could carry.

    A hard reject, deliberately, rather than a rescaling guess: dividing by 100
    "because it looks like cents" would have turned the INR figure into a
    convincing $214 and buried the real fault permanently.
    """
    if price is None:
        return False
    return 0 < price <= MAX_PLAUSIBLE_USD


def _parse_price(raw: str | None) -> float | None:
    if not raw:
        return None
    m = re.search(r"\d+[\d,]*\.?\d*", raw.replace(",", ""))
    return float(m.group()) if m else None


def _scrape_brand(browser, cfg: dict[str, Any]) -> list[dict[str, Any]]:
    """Scrape one brand. Each brand gets a fresh context so per-brand stealth
    + headers don't leak between brands."""
    log.info("  → local scrape: %s (%s)", cfg["slug"], cfg["url"])
    ctx = browser.new_context(
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        viewport={"width": 1440, "height": 900},
        locale="en-US",
        timezone_id="America/New_York",
        extra_http_headers={"Accept-Language": "en-US,en;q=0.9"},
    )
    # Apply stealth only for brands that need to defeat anti-bot detection
    if cfg.get("stealth"):
        try:
            from playwright_stealth import Stealth
            Stealth().apply_stealth_sync(ctx)
        except ImportError:
            log.warning("  ⚠ %s wants stealth but playwright-stealth not installed", cfg["slug"])
    page = ctx.new_page()
    try:
        page.goto(cfg["url"], wait_until="domcontentloaded", timeout=60000)
        # Per-brand extra_wait honours lazy-loaded review widgets (Bazaarvoice
        # on onix/wilson/franklin) and stealth-needing sites (engage). Falls
        # back to 8000ms for stealth brands, 3000ms otherwise.
        wait_ms = cfg.get("extra_wait", 8000 if cfg.get("stealth") else 3000)
        page.wait_for_timeout(wait_ms)
        try:
            page.wait_for_selector(cfg["wait_for"], state="attached", timeout=15000)
        except Exception:
            pass  # Some pages already have content; wait_for_timeout above covers it
        # Scroll to trigger lazy loading (review widgets often defer to scroll)
        for _ in range(6):
            page.evaluate("window.scrollBy(0, 800)")
            page.wait_for_timeout(400)
        page.evaluate("window.scrollTo(0, 0)")
        # Extra settle for review widgets that hydrate post-scroll
        page.wait_for_timeout(2500 if wait_ms >= 8000 else 1500)
        items: list[dict[str, Any]] = page.evaluate(cfg["js"])
        with_rating = sum(1 for it in items if it.get("rating"))
        with_reviews = sum(1 for it in items if it.get("reviewCount"))
        log.info("  ✓ %s: %d products via local Playwright (%d with rating, %d with reviews)",
                 cfg["slug"], len(items), with_rating, with_reviews)
        return items
    except Exception as e:
        log.warning("  ✗ %s local scrape failed: %s", cfg["slug"], e)
        return []
    finally:
        page.close()
        ctx.close()


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
    # slug -> currency actually served, when it differs from the configured one.
    # Reported once at the end rather than per product, so a geo-priced crawl is
    # a single loud line instead of 35 easily-scrolled-past warnings.
    geo_mismatch: dict[str, str] = {}

    log.info("Local Playwright catalog scrape for %d brands", len(targets))
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        for cfg in targets:
            brand_id = brand_map.get(cfg["slug"])
            if not brand_id:
                log.warning("  ⚠ skipping %s: brand not in DB", cfg["slug"])
                continue

            items = _scrape_brand(browser, cfg)
            # Authoritative, non-geo-localized prices where the brand runs
            # Shopify. Empty dict for everyone else, and on any fetch failure —
            # the DOM price then applies as before.
            price_index = (shopify_price_index(cfg["shopify_domain"])
                           if cfg.get("shopify_domain") else {})
            if price_index:
                log.info("    · %s: %d prices from products.json",
                         cfg["slug"], len(price_index))
            for it in items:
                name = (it.get("name") or "").strip()
                if len(name) < 3:
                    continue
                # Filter obvious badge text accidentally captured as names
                if name.lower() in {"best seller", "new", "sale", "coming soon", "in stock"}:
                    continue
                # ...and the collection page's own filter sidebar. Six Zero's
                # `.grid__item` selector also matches its facet list, so the DB
                # ended up with priced "products" called `Thickness`, `HYBRID`
                # and `14MM`. They look like real rows to every consumer
                # downstream, and they carry a price, so they would have shown
                # up in the price comparison as products.
                if _FACET_LABEL.match(name):
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
                configured = cfg.get("currency", "USD")

                # Prefer products.json: it is quoted in the shop's own default
                # currency and does not move with the crawler's IP address.
                from_json = price_index.get(shopify_handle(it.get("link")))
                if from_json and from_json[0] is not None:
                    json_price, json_compare = from_json
                    regular = json_compare or json_price
                    sale = json_price if (json_compare and json_compare > json_price) else None
                    actual = sale or regular
                    discount_pct = (round((regular - sale) / regular * 100, 1)
                                    if regular and sale and regular > sale else None)
                    ccy = configured
                else:
                    # Fell back to the rendered price. Read the currency off the
                    # text rather than trusting config, because a geo-priced
                    # storefront serves whatever the crawler's IP implies.
                    ccy = detect_currency(it.get("price") or it.get("comparePrice"),
                                          configured)
                    if ccy != configured:
                        geo_mismatch[cfg["slug"]] = ccy
                price_local = actual
                fx_rate: float | None = None
                fx_date: str | None = None
                if ccy == "USD":
                    price_usd = actual
                else:
                    rate = _fx_rate(ccy, "USD")
                    if rate and actual is not None:
                        fx_rate, fx_date = rate
                        price_usd = round(actual * fx_rate, 2)
                    else:
                        price_usd = None
                # Last line of defence. A price that cannot belong to a
                # pickleball product is dropped rather than stored: a NULL price
                # reads as "unknown" everywhere downstream, whereas $14,124
                # reads as a fact and would rank Six Zero as the premium brand
                # in the price comparison.
                if price_usd is not None and not plausible_usd(price_usd):
                    log.warning(
                        "  ⚠ %s: implausible price $%.2f for %r (%s %s) — "
                        "storing NULL. Currency detection or FX rate is wrong.",
                        cfg["slug"], price_usd, name[:50], price_local, ccy,
                    )
                    price_usd = None
                    sale = None
                    discount_pct = None
                # Rating/reviews — now populated for every brand via the
                # extractRating / extractReviewCount cascade. Parse defensively
                # using the same regex shape as scrape_catalog.py so the two
                # writers agree on what counts as a valid rating.
                rating_raw = it.get("rating")
                review_raw = it.get("reviewCount")
                avg_rating: float | None = None
                if rating_raw not in (None, ""):
                    m = re.search(r"\d+\.?\d*", str(rating_raw))
                    if m:
                        try:
                            v = float(m.group())
                            if 0 < v <= 5:
                                avg_rating = v
                        except (TypeError, ValueError):
                            avg_rating = None
                review_count: int | None = None
                if review_raw not in (None, ""):
                    m = re.search(r"\d+", str(review_raw))
                    if m:
                        try:
                            review_count = int(m.group())
                        except (TypeError, ValueError):
                            review_count = None
                all_rows.append({
                    "brand_id":        brand_id,
                    "name":            name[:300],
                    "url":             it.get("link") or cfg["url"],
                    "category":        "paddle",
                    "price_usd":       price_usd,
                    "sale_price_usd":  sale if ccy == "USD" else None,
                    "currency":        ccy,
                    "country_code":    "AU" if ccy == "AUD" else "US",
                    # migration 025. If those columns are not yet applied the
                    # Supabase client strips them and reports a SCHEMA GAP
                    # rather than losing the row.
                    "price_local":          price_local,
                    "price_local_currency": ccy,
                    "fx_rate_used":         fx_rate,
                    "fx_rate_date":         fx_date,
                    "avg_rating":      avg_rating,
                    "review_count":    review_count,
                    "in_stock":        bool(it.get("inStock", True)),
                    "discount_pct":    discount_pct,
                    "last_scraped_at": now_iso,
                })
        browser.close()

    if not all_rows:
        log.info("No products scraped via local Playwright")
        return 0

    n = sb.upsert("products", all_rows, "name,brand_id")
    for slug, served in sorted(geo_mismatch.items()):
        configured = next(
            (c.get("currency", "USD") for c in BRAND_SCRAPERS if c["slug"] == slug), "?")
        log.warning(
            "  ⚠ %s: storefront served %s, config says %s. Shopify geo-prices by "
            "visitor IP — run this crawl from a US egress, or the prices are that "
            "market's, not the brand's home market.", slug, served, configured)
    log.info("✓ %d total products upserted via local Playwright", n)
    return n


if __name__ == "__main__":
    # Standalone smoke test
    import os, sys
    try:
        from dotenv import load_dotenv
        load_dotenv(".env")
    except ImportError:
        pass
    sys.exit(0 if run({}) >= 0 else 1)
