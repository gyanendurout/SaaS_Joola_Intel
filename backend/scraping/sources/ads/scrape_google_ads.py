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
from . import ad_payload
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

    available = ad_payload.writable_columns(sb)
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
            ad_id = ad_payload.ad_id_of(item, "google")
            if not ad_id:
                continue
            # This actor returns no ad copy and no advertiser landing page --
            # see ad_payload.google_fields. Do not re-add speculative keys for
            # them; their absence is the actor's, not a mapping slip.
            fields = ad_payload.google_fields(item)
            rows.append(ad_payload.restrict({
                "brand_id":  t["brand_id"],
                "platform":  "google",
                "ad_id":     str(ad_id),
                "page_name": fields.pop("page_name", None) or t["domain"],
                "raw":       item,
                **fields,
            }, available))
        log.info("✓ %s: %d ads collected", t["slug"], len(items))

    n = sb.upsert("marketing_ads", rows, "platform,ad_id")
    log.info("✓ %d Google ads upserted (total)", n)
    return n
