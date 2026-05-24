"""Google Ads Transparency Centre scraper.

Uses solidcode/ads-transparency-scraper (one searchQuery per run, looped per brand).
Matches live Supabase schema:
  marketing_ads(brand_id, platform, ad_id, page_name, body, cta,
                creative_url, landing_url, started_at, is_active, raw)
Conflict key: platform,ad_id
"""

from __future__ import annotations

from typing import Any

from ...core import apify_client as apify
from ...core import supabase_client as sb
from ...core.errors import ActorRunError
from ...core.logger import get_logger

log = get_logger("ads.google")


def _domain_from_url(url: str) -> str:
    if not url or "://" not in url:
        return ""
    return url.split("://", 1)[1].split("/", 1)[0].lstrip("www.")


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_rows = sb.get("brands", "id,slug,website_url")
    if brand_filter:
        brand_rows = [r for r in brand_rows if r["slug"] in brand_filter]

    targets = []
    for r in brand_rows:
        dom = _domain_from_url(r.get("website_url") or "")
        if dom:
            targets.append({"slug": r["slug"], "brand_id": r["id"], "domain": dom})

    if dry_run:
        log.info("[DRY-RUN] would scrape Google Ads for %d brands", len(targets))
        return 0

    rows: list[dict] = []
    for t in targets:
        try:
            items = apify.run_and_fetch("solidcode/ads-transparency-scraper", {
                "searchQuery": t["domain"],
                "maxResults":  100,
                "region":      "US",
            })
        except ActorRunError as e:
            log.warning("Google Ads scrape failed for %s (%s): %s", t["slug"], t["domain"], e)
            continue
        except Exception as e:
            log.warning("Google Ads error for %s: %s", t["slug"], e)
            continue

        for item in items:
            ad_id = (
                item.get("adId") or item.get("ad_id")
                or item.get("creativeId") or item.get("creative_id")
                or item.get("id")
            )
            if not ad_id:
                continue
            rows.append({
                "brand_id":     t["brand_id"],
                "platform":     "google",
                "ad_id":        str(ad_id),
                "page_name":    item.get("advertiserName") or item.get("advertiser") or t["domain"],
                "body":         (item.get("adText") or item.get("description") or item.get("text") or "")[:2000],
                "cta":          item.get("cta"),
                "creative_url": item.get("imageUrl") or item.get("videoUrl") or item.get("creativeUrl") or item.get("preview_image_url"),
                "landing_url":  item.get("destinationUrl") or item.get("landingUrl") or item.get("landing_url"),
                "started_at":   item.get("firstShown") or item.get("startedAt") or item.get("first_shown"),
                "is_active":    item.get("isActive", True),
                "raw":          item,
            })
        log.info("✓ %s: %d ads collected", t["slug"], len(items))

    n = sb.upsert("marketing_ads", rows, "platform,ad_id")
    log.info("✓ %d Google ads upserted (total)", n)
    return n
