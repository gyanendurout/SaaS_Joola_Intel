"""Product reviews scraper — captures customer review TEXT from brand
product detail pages (Bazaarvoice / Judge.me / Okendo / Yotpo / SPR widgets).

This is the prose counterpart to `scrape_catalog.py`: catalog gives us
aggregate star rating + review count per product, but the review widgets
themselves expose hundreds–thousands of individual customer reviews via
public, undocumented-but-stable JSON APIs. We fetch those reviews here so
the existing AI enricher (sentiment + topics + brand/player/product NER +
crisis flagging) can chew on them like any other comment table.

Pipeline shape mirrors `tiktok/scrape_comments.py`:
  products (URL list)
    → per-product review-widget detection
    → per-widget JSON fetch (HTTP, no Apify)
    → upsert into `product_reviews` (enriched_at IS NULL)
    → ai_enricher (registered in TABLES list, migration 016 column shape)
    → mention_facts (registered as 'product_review' channel)

Widget priority (per page, first hit wins):
  1. Bazaarvoice  — Selkirk, Onix, Wilson, Franklin (suspected)
  2. Judge.me     — JOOLA, Paddletek, CRBN, Gamma (suspected)
  3. Okendo       — some Shopify brands
  4. Yotpo        — fallback
  5. SPR (Shopify Product Reviews) — fallback (HTML, no JSON — stub for v2)

Per-brand widget credentials (passkeys, shop_domains, product IDs) are
PUBLIC values exposed in browser inspector / widget snippets. They cannot
be inferred at runtime without a real browser, so each brand has a
WIDGET_CONFIG entry that the operator fills in manually. Entries marked
`needs_inspector: True` are TODO — the scraper will skip them until set.

Rate limiting: 1 req/sec per brand domain (`time.sleep(1.0)` between calls
for a given host) — politeness, not strictly required but courteous.

Pagination: v1 fetches page 1 only (typically 50–100 reviews per product,
sufficient for sentiment trend signals). v2 enhancement: walk `Offset`
(Bazaarvoice) / `page` (Judge.me) until empty.

Defaults:
  ctx.max_products            = 20   (small-batch first run)
  ctx.max_reviews_per_product = 50   (widget Limit param)

Failure modes handled defensively:
  - Widget not detected   → log + skip product (no crash)
  - HTTP non-200          → log + skip product (treated as widget absent)
  - JSON shape drift      → individual review skipped if required field missing
  - Rate limit (429)      → sleep 5s, skip product (don't burn the whole run)
  - Brand config missing  → log + skip whole brand on first product
"""

from __future__ import annotations

import json
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from ...core import supabase_client as sb
from ...core.logger import get_logger
from ...core.network import http_request

log = get_logger("products.reviews")

_DEFAULT_MAX_PRODUCTS = 20
_DEFAULT_MAX_REVIEWS_PER_PRODUCT = 50
_PER_DOMAIN_DELAY_SEC = 1.0
_REQUEST_TIMEOUT_SEC = 20
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 JoolaIntelBot/1.0"
)


# ────────────────────────────────────────────────────────────────────────────
# Per-brand widget configuration
#
# Each entry tells the scraper WHICH review widget the brand uses and the
# minimum credentials needed to hit it. These values are PUBLIC (visible
# in browser inspector / widget script tags) but must be extracted manually
# once per brand. Entries with `needs_inspector: True` are TODO — those
# brands are skipped until the operator pastes the real value.
#
# How to extract a Bazaarvoice passkey:
#   1. Open brand product page (e.g. https://www.selkirk.com/products/<x>)
#   2. View source / DevTools → search for "passkey"
#   3. Find URL like `bv.api.bazaarvoice.com/...passkey=ca...`
#   4. Copy the value after `passkey=` (typically starts with `ca` or `bv`)
#
# How to extract a Judge.me shop_domain:
#   1. Open brand product page → DevTools → Network tab
#   2. Filter for "judge.me"
#   3. Find a request like `judge.me/api/v1/reviews?shop_domain=...`
#   4. Copy the value after `shop_domain=`
#
# How to extract a Bazaarvoice ProductId:
#   1. On the product page, search source for `data-bv-productId` or
#      `"productId":"..."` near the review widget
#   2. ProductId is usually the brand's internal SKU or a numeric id
#
# Until the operator extracts these, the scraper logs the brand once and
# skips. Nothing breaks; nothing gets written.
# ────────────────────────────────────────────────────────────────────────────
WIDGET_CONFIG: dict[str, dict[str, Any]] = {
    "selkirk": {
        "widget":          "bazaarvoice",
        "passkey":         None,            # TODO: extract from live page
        "needs_inspector": True,
        "notes":           "Bazaarvoice confirmed on selkirk.com PDPs (Project Boomstik shows 2,383 reviews)",
    },
    "onix": {
        "widget":          "bazaarvoice",
        "passkey":         None,            # TODO
        "needs_inspector": True,
        "notes":           "Bazaarvoice confirmed on onixpickleball.com PDPs",
    },
    "wilson": {
        "widget":          "bazaarvoice",
        "passkey":         None,            # TODO
        "needs_inspector": True,
        "notes":           "Bazaarvoice suspected (Wilson uses BV on the .com)",
    },
    "franklin": {
        "widget":          "bazaarvoice",
        "passkey":         None,            # TODO
        "needs_inspector": True,
        "notes":           "BV suspected on franklinsports.com — verify in inspector",
    },
    "joola": {
        "widget":          "judgeme",
        "shop_domain":     None,            # TODO: e.g. "joola-usa.myshopify.com"
        "needs_inspector": True,
        "notes":           "Judge.me suspected on joola.com (Shopify theme)",
    },
    "paddletek": {
        "widget":          "judgeme",
        "shop_domain":     None,            # TODO
        "needs_inspector": True,
        "notes":           "Judge.me suspected on paddletek.com (Shopify theme)",
    },
    "crbn": {
        "widget":          "judgeme",
        "shop_domain":     None,            # TODO
        "needs_inspector": True,
        "notes":           "Judge.me suspected on crbnpickleball.com",
    },
    "gamma": {
        "widget":          "judgeme",
        "shop_domain":     None,            # TODO
        "needs_inspector": True,
        "notes":           "Judge.me suspected on gammasports.com",
    },
    "six-zero": {
        "widget":          "okendo",
        "subscriber_id":   None,            # TODO: Okendo subscriberId
        "needs_inspector": True,
        "notes":           "Okendo suspected on sixzeropickleball.com",
    },
    "engage": {
        "widget":          "judgeme",
        "shop_domain":     None,            # TODO
        "needs_inspector": True,
        "notes":           "Likely Judge.me — confirm in inspector",
    },
    "head": {
        "widget":          "bazaarvoice",
        "passkey":         None,            # TODO
        "needs_inspector": True,
        "notes":           "HEAD uses BV on tennis line — verify pickleball PDPs",
    },
}


# ────────────────────────────────────────────────────────────────────────────
# HTTP helpers (per-host throttling)
# ────────────────────────────────────────────────────────────────────────────
_last_hit: dict[str, float] = defaultdict(float)


def _throttle(host: str) -> None:
    """Sleep just enough that we don't hit `host` more than once per second."""
    elapsed = time.time() - _last_hit[host]
    if elapsed < _PER_DOMAIN_DELAY_SEC:
        time.sleep(_PER_DOMAIN_DELAY_SEC - elapsed)
    _last_hit[host] = time.time()


def _host_of(url: str) -> str:
    try:
        return urlparse(url).netloc or "unknown"
    except Exception:
        return "unknown"


def _http_get_json(url: str, host: str) -> dict | None:
    """GET → JSON, defensively. Returns None on any non-200 / parse failure."""
    _throttle(host)
    try:
        resp = http_request(
            "GET", url,
            headers={"User-Agent": _USER_AGENT, "Accept": "application/json"},
            timeout=_REQUEST_TIMEOUT_SEC,
        )
    except Exception as e:
        log.warning("  ✗ HTTP fetch failed for %s: %s", url, str(e)[:200])
        return None

    if resp.status_code == 429:
        log.warning("  ⚠ Rate-limited (429) on %s — backing off 5s", host)
        time.sleep(5)
        return None
    if resp.status_code != 200:
        log.info("  · non-200 (%d) from %s — treating as no widget", resp.status_code, url)
        return None
    try:
        return resp.json()
    except (json.JSONDecodeError, ValueError):
        log.info("  · non-JSON response from %s — treating as no widget", url)
        return None


# ────────────────────────────────────────────────────────────────────────────
# Widget-specific fetchers
#
# Each returns a list of normalized review dicts:
#   {source_review_id, reviewer_name, review_title, review_text,
#    rating, helpful_count, posted_at}
# ────────────────────────────────────────────────────────────────────────────
def _fetch_bazaarvoice(passkey: str, product_id: str,
                       host: str, limit: int) -> list[dict]:
    """Bazaarvoice public reviews endpoint.

    Docs: https://developer.bazaarvoice.com/conversations-api/reference/v5.5/reviews/review-display
    """
    url = (
        f"https://api.bazaarvoice.com/data/reviews.json"
        f"?apiversion=5.5&passkey={passkey}&Filter=ProductId:{product_id}"
        f"&Limit={limit}&Sort=SubmissionTime:desc"
    )
    data = _http_get_json(url, host)
    if not data or "Results" not in data:
        return []
    out: list[dict] = []
    for r in data["Results"]:
        rid = r.get("Id")
        if not rid:
            continue
        out.append({
            "source_review_id": f"bv_{rid}",
            "reviewer_name":    r.get("UserNickname"),
            "review_title":     r.get("Title"),
            "review_text":      r.get("ReviewText") or "",
            "rating":           r.get("Rating"),
            "helpful_count":    r.get("TotalPositiveFeedbackCount") or 0,
            "posted_at":        r.get("SubmissionTime"),
        })
    return out


def _fetch_judgeme(shop_domain: str, product_external_id: str,
                   host: str, limit: int) -> list[dict]:
    """Judge.me widget public reviews endpoint.

    Docs (community): https://judge.me/api/v1/reviews
    """
    url = (
        f"https://judge.me/api/v1/reviews"
        f"?shop_domain={shop_domain}&product_external_id={product_external_id}"
        f"&per_page={limit}&page=1"
    )
    data = _http_get_json(url, host)
    if not data:
        return []
    # Judge.me typically wraps reviews under `reviews` array
    reviews = data.get("reviews") if isinstance(data, dict) else data
    if not isinstance(reviews, list):
        return []
    out: list[dict] = []
    for r in reviews:
        rid = r.get("id") or r.get("review_id")
        if not rid:
            continue
        out.append({
            "source_review_id": f"jm_{rid}",
            "reviewer_name":    r.get("reviewer", {}).get("name") if isinstance(r.get("reviewer"), dict) else r.get("reviewer_name"),
            "review_title":     r.get("title"),
            "review_text":      r.get("body") or r.get("content") or "",
            "rating":           r.get("rating"),
            "helpful_count":    r.get("curated") or 0,
            "posted_at":        r.get("created_at"),
        })
    return out


def _fetch_okendo(subscriber_id: str, product_id: str,
                  host: str, limit: int) -> list[dict]:
    """Okendo public reviews endpoint (best-effort — schema varies).

    The widget loads reviews via `https://api.okendo.io/v1/<subscriberId>/...`
    — exact shape needs inspector confirmation per brand.
    """
    url = (
        f"https://api.okendo.io/v1/reviews/{subscriber_id}"
        f"?productId={product_id}&limit={limit}"
    )
    data = _http_get_json(url, host)
    if not data:
        return []
    reviews = data.get("reviews") if isinstance(data, dict) else data
    if not isinstance(reviews, list):
        return []
    out: list[dict] = []
    for r in reviews:
        rid = r.get("reviewId") or r.get("id")
        if not rid:
            continue
        out.append({
            "source_review_id": f"ok_{rid}",
            "reviewer_name":    r.get("reviewerName") or r.get("author"),
            "review_title":     r.get("title"),
            "review_text":      r.get("body") or r.get("text") or "",
            "rating":           r.get("rating"),
            "helpful_count":    r.get("helpfulCount") or 0,
            "posted_at":        r.get("dateCreated") or r.get("createdAt"),
        })
    return out


# ────────────────────────────────────────────────────────────────────────────
# Per-product dispatcher
# ────────────────────────────────────────────────────────────────────────────
def _scrape_reviews_for_product(
    brand_slug: str, brand_id: str, product: dict,
    catalog_id: str | None, limit: int,
) -> list[dict]:
    """Return normalized + DB-shape review rows for one product, or []."""
    cfg = WIDGET_CONFIG.get(brand_slug)
    if not cfg:
        log.info("  · %s: no WIDGET_CONFIG entry — skip", brand_slug)
        return []
    if cfg.get("needs_inspector"):
        log.info("  · %s: widget=%s but credentials need inspector — skip",
                 brand_slug, cfg.get("widget"))
        return []

    url = product.get("url") or ""
    host = _host_of(url)
    widget = cfg["widget"]

    # The product's per-widget id is derivable from the URL slug OR explicit.
    # For now, use the product NAME slugified as a best-effort product_id
    # for BV/Okendo. Judge.me uses the Shopify product_external_id which
    # also typically equals the URL handle.
    product_handle = (product.get("name") or "").lower().replace(" ", "-").strip()

    reviews: list[dict] = []
    try:
        if widget == "bazaarvoice":
            reviews = _fetch_bazaarvoice(
                cfg["passkey"], product_handle, host, limit,
            )
        elif widget == "judgeme":
            reviews = _fetch_judgeme(
                cfg["shop_domain"], product_handle, host, limit,
            )
        elif widget == "okendo":
            reviews = _fetch_okendo(
                cfg["subscriber_id"], product_handle, host, limit,
            )
        else:
            log.info("  · %s: widget=%s not implemented (SPR/Yotpo are v2)",
                     brand_slug, widget)
            return []
    except Exception as e:
        log.warning("  ✗ %s/%s widget fetch crashed: %s",
                    brand_slug, product.get("name"), str(e)[:200])
        return []

    if not reviews:
        return []

    now_iso = datetime.now(timezone.utc).isoformat()
    rows: list[dict] = []
    for r in reviews:
        text = (r.get("review_text") or "").strip()
        title = (r.get("review_title") or "").strip()
        if not text and not title:
            continue
        rows.append({
            "brand_id":         brand_id,
            "product_id":       catalog_id,            # may be None if no catalog match
            "source_review_id": r["source_review_id"],
            "review_widget":    widget,
            "reviewer_name":    r.get("reviewer_name"),
            "review_title":     title or None,
            "review_text":      text,
            "rating":           r.get("rating"),
            "helpful_count":    int(r.get("helpful_count") or 0),
            "posted_at":        r.get("posted_at"),
            "scraped_at":       now_iso,
        })

    log.info("  ✓ %s/%s: %d reviews via %s",
             brand_slug, product.get("name"), len(rows), widget)
    return rows


# ────────────────────────────────────────────────────────────────────────────
# Catalog mapping (products.name → products_catalog.id), same pattern as
# scrape_inventory.py so mention_facts can join cleanly.
# ────────────────────────────────────────────────────────────────────────────
def _build_catalog_resolver() -> Any:
    catalog = sb.get("products_catalog", "id,brand_id,display_name,aliases")
    by_brand_name: dict[tuple[str, str], str] = {}
    for c in catalog:
        if not c.get("brand_id") or not c.get("id"):
            continue
        if c.get("display_name"):
            by_brand_name[(c["brand_id"], c["display_name"].lower())] = c["id"]
        for alias in (c.get("aliases") or []):
            if alias:
                by_brand_name[(c["brand_id"], alias.lower())] = c["id"]

    def resolve(product: dict) -> str | None:
        name = (product.get("name") or "").lower()
        m = by_brand_name.get((product["brand_id"], name))
        if m:
            return m
        for (bid, key), cid in by_brand_name.items():
            if bid == product["brand_id"] and key and key in name:
                return cid
        return None

    return resolve


# ────────────────────────────────────────────────────────────────────────────
# Entry point
# ────────────────────────────────────────────────────────────────────────────
def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")
    max_products: int = int(ctx.get("max_products") or _DEFAULT_MAX_PRODUCTS)
    max_reviews: int = int(ctx.get("max_reviews_per_product")
                           or _DEFAULT_MAX_REVIEWS_PER_PRODUCT)

    brand_rows = sb.get("brands", "id,slug")
    slug_by_id = {r["id"]: r["slug"] for r in brand_rows}
    id_by_slug = {r["slug"]: r["id"] for r in brand_rows}

    allowed_brand_ids: set[str] | None = None
    if brand_filter:
        allowed_brand_ids = {id_by_slug[s] for s in brand_filter if s in id_by_slug}

    products = sb.get("products", "id,brand_id,name,url")
    products = [p for p in products if p.get("url")]
    if allowed_brand_ids is not None:
        products = [p for p in products if p.get("brand_id") in allowed_brand_ids]

    # Cap total products this run (sample for early validation)
    if len(products) > max_products:
        log.info("Capping at max_products=%d (of %d candidates)",
                 max_products, len(products))
        products = products[:max_products]

    if not products:
        log.info("No products with URLs to scrape reviews for")
        return 0

    if dry_run:
        log.info("[DRY-RUN] would scrape reviews for %d products (max %d reviews each)",
                 len(products), max_reviews)
        return 0

    resolve_catalog = _build_catalog_resolver()

    all_rows: list[dict] = []
    brand_warned: set[str] = set()
    for p in products:
        brand_slug = slug_by_id.get(p["brand_id"])
        if not brand_slug:
            continue
        # Skip whole brand if config explicitly missing/incomplete (only warn once)
        cfg = WIDGET_CONFIG.get(brand_slug)
        if (not cfg or cfg.get("needs_inspector")) and brand_slug not in brand_warned:
            log.info("  · brand=%s skipped (widget config TODO — see WIDGET_CONFIG)",
                     brand_slug)
            brand_warned.add(brand_slug)
            continue

        catalog_id = resolve_catalog(p)
        rows = _scrape_reviews_for_product(
            brand_slug, p["brand_id"], p, catalog_id, max_reviews,
        )
        all_rows.extend(rows)

    if not all_rows:
        log.info("No reviews scraped (no brand has widget credentials configured)")
        return 0

    # Upsert on source_review_id (unique constraint from migration 016) so
    # re-scrapes are idempotent and existing enrichment is preserved.
    n = sb.upsert("product_reviews", all_rows, on_conflict="source_review_id")
    log.info("✓ %d product_reviews upserted", n)
    return int(n)
