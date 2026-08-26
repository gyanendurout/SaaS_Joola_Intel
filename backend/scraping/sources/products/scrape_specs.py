"""Paddle specification crawler.

Collects manufacturer-published specs (core thickness, dimensions, weight,
shape, materials) from the 7 in-scope brand sites and writes them to
`paddle_specs` (migration 024). Feeds the technology comparison on Product
Intel — see docs/PRODUCT_INTEL_REDESIGN.md.

Run:
  python -m backend.scraping.run --module product-specs
  python -m backend.scraping.run --module product-specs --brands joola
  python -m backend.scraping.run --module product-specs --dry-run

WHY THIS IS PLAIN HTTP AND NOT PLAYWRIGHT
The 2026-08-26 recon found six of the seven brands run Shopify with an open
`/products.json`, and every one of them server-renders its spec block. Nothing
here needs a browser, which makes this the cheapest scraper in the repo: no
Apify credits, no headless Chromium, no crawl4ai. Franklin is the exception —
Adobe Commerce behind a Cloudflare Managed Challenge — and it is handled with
throttling and a session rather than a browser.

POLITENESS IS EXPLICIT HERE
`core/rate_limits.RateLimiter` has existed in this repo unused since it was
written; nothing imports it, and no module does robots.txt handling. A new
crawler therefore inherits NO polite behaviour by default. This module wires the
limiter up per brand: 1 req/s for the Shopify stores, 0.25 req/s for Franklin,
whose robots.txt also disallows `/*?` — so only clean paths are requested.

FAILURE POSTURE
A brand that fails is logged and skipped; the others still land. A field that
will not parse is left NULL. What is NOT tolerated is a silent zero-row write —
`sb.upsert` raises via `_assert_wrote_something`, which is what turns "the site
changed and we quietly stopped collecting specs" into a visible failure.
"""

from __future__ import annotations

import json
import re
import urllib.parse
from datetime import datetime, timezone
from typing import Any, Callable

from ...core import supabase_client as sb
from ...core.logger import get_logger
from ...core.network import http_request
from ...core.rate_limits import RateLimiter
from . import spec_parse_utils, spec_parsers

log = get_logger("products.specs")

# A browser UA. Several of these storefronts return a trimmed page or a
# challenge to an obviously-automated agent.
_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

_TIMEOUT = 30

# Only paddles.
#
# `product_type` is not usable for this. JOOLA tags 377 of its 391 products as
# "Inventory Item" and only 6 as "Pickleball Paddle", so filtering on it would
# discard almost the entire catalog. The title is the reliable signal.
#
# Matching is WORD-BOUNDED, and that matters more than it looks. An earlier
# substring version of this list contained "ball", which matched inside
# "pickleball" and silently rejected all 105 JOOLA paddles while still admitting
# a luggage tag. Substring matching on short exclusion words is a trap here.
_PADDLE_HINTS = ("paddle", "paddles")

# JOOLA is primarily a TABLE TENNIS brand and sells ping-pong paddle sets under
# titles that also contain "paddle"; several brands sell paddle-adjacent
# accessories the same way.
_NOT_PADDLE = (
    # accessories
    "cover", "covers", "case", "bag", "bags", "tote", "backpack", "sling",
    "grip", "grips", "overgrip", "tape", "towel", "hat", "cap", "shirt",
    "tee", "sleeve", "sleeves", "sock", "socks", "ball", "balls", "net",
    "eraser", "cleaner", "luggage", "tag", "tags", "stand", "rack",
    # commerce artefacts
    "gift card", "bundle", "sample", "set", "kit", "pack",
    # other sports
    "ping pong", "table tennis", "tennis", "padel",
)

_WORD = re.compile(r"[a-z0-9]+")


def _tokens(text: str) -> set[str]:
    return set(_WORD.findall(text.lower()))


class BrandSpec:
    """Per-brand crawl configuration."""

    def __init__(
        self,
        slug: str,
        domain: str,
        parser: Callable[[dict | None, str | None], list[dict]],
        *,
        platform: str = "shopify",
        collection: str = "",
        rate_per_sec: float = 1.0,
        needs_html: bool = True,
    ) -> None:
        self.slug = slug
        self.domain = domain
        self.parser = parser
        self.platform = platform
        self.collection = collection
        self.needs_html = needs_html
        # RateLimiter(max_calls, period) — 1 call per (1/rate) seconds.
        self.limiter = RateLimiter(max_calls=1, period=1.0 / rate_per_sec)


BRAND_SPECS: list[BrandSpec] = [
    BrandSpec("joola",     "joola.com",                 spec_parsers.parse_joola),
    BrandSpec("selkirk",   "selkirk.com",               spec_parsers.parse_selkirk),
    BrandSpec("crbn",      "crbnpickleball.com",        spec_parsers.parse_crbn),
    BrandSpec("paddletek", "paddletek.com",             spec_parsers.parse_paddletek),
    # Engage publishes its Specifications block inside body_html, so the
    # products.json payload alone is enough — no second request per product.
    BrandSpec("engage",    "engagepickleball.com",      spec_parsers.parse_engage,
              needs_html=False),
    BrandSpec("six-zero",  "www.sixzeropickleball.com", spec_parsers.parse_sixzero),
    # Franklin: Adobe Commerce, no /products.json, Cloudflare Managed Challenge.
    # Throttled hard and enumerated from the collection page because no sitemap
    # exists. robots.txt disallows `/*?`, so query strings are never requested.
    BrandSpec("franklin",  "franklinsports.com",        spec_parsers.parse_franklin,
              platform="magento", collection="/sports/pickleball/paddles",
              rate_per_sec=0.25),
]


def _is_paddle(title: str, product_type: str) -> bool:
    """True when the title names an actual pickleball paddle.

    Word-bounded on both sides. Multi-word exclusions ("ping pong") are checked
    as adjacent-token phrases so they still match without reintroducing
    substring matching.
    """
    words = _tokens(f"{product_type} {title}")
    if not (words & set(_PADDLE_HINTS)):
        return False
    haystack = " " + " ".join(_WORD.findall(f"{product_type} {title}".lower())) + " "
    for bad in _NOT_PADDLE:
        if " " in bad:
            if f" {bad} " in haystack:
                return False
        elif bad in words:
            return False
    return True


def _get(url: str, cfg: BrandSpec, session_cookies: dict | None = None) -> str | None:
    """One polite GET. Returns body text, or None on any failure."""
    cfg.limiter.wait()
    try:
        resp = http_request(
            "GET", url,
            headers={"User-Agent": _UA, "Accept-Language": "en-US,en;q=0.9"},
            timeout=_TIMEOUT,
            cookies=session_cookies or {},
        )
    except Exception as exc:                      # noqa: BLE001 - never fatal
        log.warning("    ✗ %s: %s", url, exc)
        return None
    if resp.status_code != 200:
        log.warning("    ✗ %s -> HTTP %d", url, resp.status_code)
        return None
    return resp.text


def _shopify_products(cfg: BrandSpec) -> list[dict]:
    """Enumerate paddles from /products.json, following pages until empty."""
    out: list[dict] = []
    for page in range(1, 11):                     # 250/page; 10 pages is ample
        body = _get(f"https://{cfg.domain}/products.json?limit=250&page={page}", cfg)
        if not body:
            break
        try:
            products = json.loads(body).get("products", [])
        except json.JSONDecodeError:
            log.warning("    ✗ %s page %d: not JSON", cfg.slug, page)
            break
        if not products:
            break
        out.extend(
            p for p in products
            if _is_paddle(p.get("title", ""), p.get("product_type", ""))
        )
    return out


def _scrape_brand(cfg: BrandSpec, brand_id: str) -> list[dict]:
    rows: list[dict] = []

    if cfg.platform == "shopify":
        products = _shopify_products(cfg)
        log.info("  → %s: %d paddles found", cfg.slug, len(products))
        for product in products:
            handle = product.get("handle")
            if not handle:
                continue
            url = f"https://{cfg.domain}/products/{handle}"
            html = _get(url, cfg) if cfg.needs_html else None
            if cfg.needs_html and html is None:
                continue
            try:
                parsed = cfg.parser(product, html)
            except Exception as exc:              # noqa: BLE001
                # A parser bug on one product must not lose the brand.
                log.warning("    ✗ %s/%s parser raised: %s", cfg.slug, handle, exc)
                continue
            for row in parsed:
                row.setdefault("source_handle", handle)
                row.setdefault("source_url", url)
                row["brand_id"] = brand_id
                rows.append(row)

    else:  # magento / franklin
        listing = _get(f"https://{cfg.domain}{cfg.collection}", cfg)
        if not listing:
            log.warning("  ✗ %s: collection page unavailable", cfg.slug)
            return []
        try:
            urls = spec_parsers.franklin_product_urls(listing, cfg.domain)
        except Exception as exc:                  # noqa: BLE001
            log.warning("  ✗ %s: could not enumerate products: %s", cfg.slug, exc)
            return []
        log.info("  → %s: %d paddles found", cfg.slug, len(urls))
        for url in urls:
            html = _get(url, cfg)
            if html is None:
                continue
            try:
                parsed = cfg.parser(None, html)
            except Exception as exc:              # noqa: BLE001
                log.warning("    ✗ %s parser raised: %s", url, exc)
                continue
            for row in parsed:
                row.setdefault("source_url", url)
                row.setdefault("source_handle", url.rstrip("/").rsplit("/", 1)[-1])
                row["brand_id"] = brand_id
                rows.append(row)

    return rows


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    _load_endorsers(brand_map)
    targets = [c for c in BRAND_SPECS if c.slug in brand_map]
    if brand_filter:
        targets = [c for c in targets if c.slug in set(brand_filter)]

    if not targets:
        log.info("No matching brands to scrape")
        return 0

    if dry_run:
        log.info(
            "[DRY-RUN] would crawl specs for %d brands: %s",
            len(targets), ", ".join(c.slug for c in targets),
        )
        return 0

    # Stamped onto every row written, then used as the prune cutoff below.
    #
    # This CANNOT be left to the column's `default now()`: a default fires on
    # INSERT only, so an upsert that updates an existing row would leave
    # scraped_at frozen at the day the row was first seen. That makes the column
    # a synonym for first_seen_at and silently answers "when did we last confirm
    # this spec?" with a date that never moves.
    run_ts = datetime.now(timezone.utc).isoformat()

    all_rows: list[dict] = []
    crawled: list[str] = []
    for cfg in targets:
        try:
            rows = _scrape_brand(cfg, brand_map[cfg.slug])
        except Exception as exc:                  # noqa: BLE001
            log.warning("  ✗ %s failed: %s", cfg.slug, exc)
            continue
        log.info("  ✓ %s: %d spec rows", cfg.slug, len(rows))
        for row in rows:
            row["scraped_at"] = run_ts
        if rows:
            crawled.append(cfg.slug)
        all_rows.extend(rows)

    if not all_rows:
        # Deliberately not an exception: with --brands pointing at a brand that
        # legitimately has no paddles, zero is a correct answer. A zero-row
        # write with rows in hand IS an error, and sb.upsert raises for that.
        log.warning("No spec rows extracted — check brand parsers")
        return 0

    n = sb.upsert("paddle_specs", all_rows, "brand_id,source_handle,variant_key")
    log.info("✓ %d paddle_specs rows upserted", n)
    _prune_stale(crawled, brand_map, run_ts)
    return n


def _load_endorsers(brand_map: dict[str, str]) -> None:
    """Populate spec_parse_utils.ENDORSERS from the athlete roster in the DB.

    Signature editions are listed both with and without the athlete's name, and
    an unstripped prefix splits one paddle into two families. The roster is read
    from `influencers.name` rather than hardcoded, per CLAUDE.md invariant 5 —
    and the frontend reads the same table, so the two sides agree on the key.

    Non-fatal: no roster simply means no stripping, which is the pre-existing
    behaviour rather than a wrong one.
    """
    by_id = {v: k for k, v in brand_map.items()}
    try:
        rows = sb.get("influencers", "brand_id,name")
    except Exception as exc:                      # noqa: BLE001
        log.warning("  ⚠ endorser roster unavailable (%s) — signature editions "
                    "may split into separate families", exc)
        return
    roster: dict[str, list[str]] = {}
    for row in rows:
        slug = by_id.get(row.get("brand_id"))
        name = (row.get("name") or "").strip()
        if slug and name:
            roster.setdefault(slug, []).append(name)
    spec_parse_utils.ENDORSERS = {
        slug: tuple(sorted(set(names))) for slug, names in roster.items()}
    log.info("  · endorser roster: %s",
             ", ".join(f"{s}={len(n)}" for s, n in sorted(roster.items())) or "empty")


def _prune_stale(crawled: list[str], brand_map: dict[str, str], run_ts: str) -> None:
    """Drop rows this crawl did not re-confirm, for the brands it did reach.

    Necessary because `variant_key` is part of the conflict target: it is derived
    from shape and thickness, so any parser improvement CHANGES the key and the
    upsert inserts a new row beside the old one instead of updating it. The first
    real crawl demonstrated this exactly — a thickness fix turned 81 rows into
    147, of which 67 were superseded duplicates that would have been served to
    the comparison as if current.

    Only brands that produced rows are pruned. A brand whose site was down
    returns nothing and must keep the specs we already hold; deleting on an empty
    crawl would turn one bad afternoon into permanent data loss.
    """
    for slug in crawled:
        brand_id = brand_map.get(slug)
        if not brand_id:
            continue
        # quote() is not optional. An ISO timestamp ends in `+00:00`, and `+` in
        # a query string decodes to a space — PostgREST then sees
        # "2026-08-26T06:27:22 00:00" and rejects the whole request as a
        # malformed timestamp.
        cutoff = urllib.parse.quote(run_ts, safe="")
        try:
            removed = sb.delete_where(
                "paddle_specs", f"brand_id=eq.{brand_id}&scraped_at=lt.{cutoff}")
        except Exception as exc:                  # noqa: BLE001 - never fatal
            log.warning("  ✗ %s: prune failed, stale rows remain: %s", slug, exc)
            continue
        if removed:
            log.info("  ⌫ %s: %d superseded spec rows removed", slug, removed)
