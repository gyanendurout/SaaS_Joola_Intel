"""Meta Ad Library scraper — brand paid social ads.

Matches the live Supabase schema:
  marketing_ads(brand_id, platform, ad_id, page_name, body, cta,
                creative_url, landing_url, started_at, is_active, raw)
Conflict key: platform,ad_id
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from ...core import apify_client as apify
from ...core import supabase_client as sb
from ...core.logger import get_logger

log = get_logger("ads.meta")

FACEBOOK_PAGES = [
    {"slug": "joola",     "page_name": "JOOLA Pickleball"},
    {"slug": "selkirk",   "page_name": "Selkirk Sport"},
    {"slug": "paddletek", "page_name": "Paddletek"},
    {"slug": "crbn",      "page_name": "CRBN Pickleball"},
    {"slug": "six-zero",  "page_name": "Six Zero Pickleball"},
    {"slug": "engage",    "page_name": "Engage Pickleball"},
    {"slug": "onix",      "page_name": "Onix Pickleball"},
    {"slug": "franklin",  "page_name": "Franklin Sports"},
    {"slug": "head",      "page_name": "HEAD Pickleball"},
    {"slug": "wilson",    "page_name": "Wilson Pickleball"},
    {"slug": "gamma",     "page_name": "Gamma Pickleball"},
]


def _ad_library_url(query: str) -> str:
    return (
        "https://www.facebook.com/ads/library/"
        "?active_status=all&ad_type=all&country=US"
        f"&q={quote(query)}&search_type=keyword_unordered&media_type=all"
    )


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    pages = FACEBOOK_PAGES if not brand_filter else [p for p in FACEBOOK_PAGES if p["slug"] in brand_filter]

    if dry_run:
        log.info("[DRY-RUN] would scrape Meta ads for %d brands", len(pages))
        return 0

    urls = [_ad_library_url(p["page_name"]) for p in pages]
    items = apify.run_and_fetch("apify/facebook-ads-scraper", {
        "startUrls":    [{"url": u} for u in urls],
        "resultsLimit": 50,
        "activeStatus": "active",
    })

    name_to_slug = {p["page_name"].lower(): p["slug"] for p in pages}

    rows: list[dict] = []
    for item in items:
        page_name = (item.get("page_name") or item.get("pageName") or "").strip()
        slug = name_to_slug.get(page_name.lower())
        if not slug:
            for n, s in name_to_slug.items():
                if n in page_name.lower() or page_name.lower() in n:
                    slug = s
                    break
        brand_id = brand_map.get(slug) if slug else None
        if not brand_id:
            continue

        ad_id = item.get("ad_archive_id") or item.get("adArchiveId") or item.get("id")
        if not ad_id:
            continue

        rows.append({
            "brand_id":     brand_id,
            "platform":     "meta",
            "ad_id":        str(ad_id),
            "page_name":    page_name,
            "body":         (item.get("ad_creative_body") or item.get("body") or "")[:2000],
            "cta":          item.get("cta_text") or item.get("cta"),
            "creative_url": item.get("creative_url") or item.get("image_url") or item.get("video_url"),
            "landing_url":  item.get("link_url") or item.get("landing_url"),
            "started_at":   item.get("ad_delivery_start_time") or item.get("started_at"),
            "is_active":    item.get("is_active", True),
            "raw":          item,
        })

    n = sb.upsert("marketing_ads", rows, "platform,ad_id")
    log.info("✓ %d Meta ads upserted", n)
    return n
