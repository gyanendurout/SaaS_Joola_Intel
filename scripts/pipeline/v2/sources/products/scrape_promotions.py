"""Homepage promotion scraper — detects banner/promo text on brand homepages.

Matches the live Supabase schema:
  promotions(brand_id, banner_text, source_url, promo_type, discount_pct, detected_at)
Conflict key: brand_id,banner_text
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any

from ...core import apify_client as apify
from ...core import supabase_client as sb
from ...core.logger import get_logger

log = get_logger("products.promotions")

HOMEPAGE_URLS: list[dict[str, str]] = [
    {"slug": "joola",     "url": "https://www.joola.com"},
    {"slug": "selkirk",   "url": "https://www.selkirk.com"},
    {"slug": "paddletek", "url": "https://www.paddletek.com"},
    {"slug": "crbn",      "url": "https://www.crbnpickleball.com"},
    {"slug": "six-zero",  "url": "https://www.sixzeropickleball.com"},
    {"slug": "engage",    "url": "https://www.engagepickleball.com"},
    {"slug": "onix",      "url": "https://www.onixpickleball.com"},
    {"slug": "franklin",  "url": "https://www.franklinsports.com"},
    {"slug": "head",      "url": "https://www.head.com/en/sports/padel/pickleball"},
    {"slug": "wilson",    "url": "https://www.wilson.com/en-us/pickleball"},
    {"slug": "gamma",     "url": "https://www.gammasports.com"},
]

PROMO_SELECTORS = (
    ".announcement-bar, .promo-bar, .banner-bar, "
    "[class*=announcement], [class*=promo-banner], "
    ".top-bar, .sale-banner, header .banner"
)

_PCT_RE = re.compile(r"(\d+)\s*%")


def _classify_promo(text: str) -> tuple[str, int | None]:
    """Return (promo_type, discount_pct) from banner text."""
    t = (text or "").lower()
    pct = None
    m = _PCT_RE.search(t)
    if m:
        try:
            pct = int(m.group(1))
        except ValueError:
            pct = None
    if any(k in t for k in ("free shipping", "free delivery")):
        return ("free_shipping", pct)
    if any(k in t for k in ("bundle", "set deal", "combo")):
        return ("bundle", pct)
    if pct is not None:
        return ("discount", pct)
    if any(k in t for k in ("sale", "off", "deal", "promo", "code")):
        return ("discount", pct)
    if any(k in t for k in ("new", "launch", "introducing")):
        return ("launch", pct)
    return ("other", pct)


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    urls = [h for h in HOMEPAGE_URLS if not brand_filter or h["slug"] in brand_filter]

    if dry_run:
        log.info("[DRY-RUN] would scrape homepage promos for %d brands", len(urls))
        return 0

    items = apify.run_and_fetch("apify/playwright-scraper", {
        "startUrls": [{"url": h["url"]} for h in urls],
        "pageFunction": f"""
async ({{ page, request }}) => {{
  await page.waitForLoadState('networkidle', {{ timeout: 15000 }}).catch(() => {{}});
  const banners = await page.$$eval('{PROMO_SELECTORS}', els =>
    els.map(el => el.textContent?.trim()).filter(Boolean)
  );
  return {{ url: request.url, banners }};
}}
""",
    })

    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for item in items:
        page_url = item.get("url") or ""
        slug = next((h["slug"] for h in urls if h["url"] in page_url), None)
        brand_id = brand_map.get(slug) if slug else None
        if not brand_id:
            continue
        banners: list[str] = item.get("banners") or []

        for banner_text in banners:
            text = (banner_text or "").strip()
            if not text or len(text) < 5:
                continue
            text = text[:500]
            key = (brand_id, text)
            if key in seen:
                continue
            seen.add(key)
            promo_type, discount_pct = _classify_promo(text)
            rows.append({
                "brand_id":     brand_id,
                "banner_text":  text,
                "source_url":   page_url,
                "promo_type":   promo_type,
                "discount_pct": discount_pct,
                "detected_at":  date.today().isoformat(),
            })

    n = sb.upsert("promotions", rows, "brand_id,banner_text") if rows else 0
    log.info("✓ %d promotions upserted", n)
    return n
