"""Single home for Apify ad-item -> marketing_ads column mapping.

This module exists because the mapping silently drifted once already.
apify/facebook-ads-scraper nests the creative under `snapshot` in camelCase
(snapshot.body.text, snapshot.ctaText, snapshot.linkUrl); the scraper read
top-level snake_case (ad_creative_body, cta_text, link_url). Every lookup
returned None, was written as empty, and nothing raised -- the weekly run
reported success while storing 698 blank ads for three months.

Keeping the mapping here means the scraper and the backfill cannot disagree
about what a field is called. If an actor changes its schema again, only this
file needs editing, and test_ad_payload.py fails loudly instead of the run
going quietly empty.
"""
from __future__ import annotations

import json
import re
from typing import Any

# Meta serves dynamic catalogue ads whose body is a token filled in at delivery
# time ("{{product.brand}}"). Nobody wrote that sentence, so it must not be
# counted as messaging -- it is recorded as a template ad with empty copy.
TEMPLATE_ONLY = re.compile(r"^\s*\{\{.*?\}\}\s*$", re.S)


def as_dict(value: Any) -> dict:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return {}
    return value if isinstance(value, dict) else {}


def is_template_body(text: str | None) -> bool:
    return bool(text) and bool(TEMPLATE_ONLY.match(text or ""))


def meta_fields(item: Any) -> dict:
    """Map one apify/facebook-ads-scraper item onto marketing_ads columns.

    Only keys carrying a value are returned, so a partial payload never
    overwrites a good column with None.
    """
    raw = as_dict(item)
    snap = as_dict(raw.get("snapshot"))
    cards = snap.get("cards") or []
    card = as_dict(cards[0]) if cards else {}

    body = as_dict(snap.get("body")).get("text") or card.get("body") or ""
    template = is_template_body(body)
    if template:
        body = ""

    images = snap.get("images") or []
    first_image = images[0] if images and isinstance(images[0], str) else None

    platforms = raw.get("publisherPlatform") or []
    out: dict[str, Any] = {
        "body": (body or "")[:2000] or None,
        "cta": snap.get("ctaText") or card.get("ctaText"),
        "ad_title": snap.get("title") or card.get("title"),
        "landing_url": snap.get("linkUrl") or card.get("linkUrl"),
        "creative_url": (
            card.get("originalImageUrl")
            or card.get("resizedImageUrl")
            or card.get("videoPreviewImageUrl")
            or first_image
        ),
        "started_at": raw.get("startDateFormatted"),
        "last_shown": raw.get("endDateFormatted"),
        "publisher_platforms": [str(p) for p in platforms] or None,
        "is_template_ad": template or None,
    }
    if raw.get("isActive") is not None:
        out["is_active"] = bool(raw["isActive"])
    return {k: v for k, v in out.items() if v not in (None, "", [])}


def google_fields(item: Any) -> dict:
    """Map one solidcode/ads-transparency-scraper item onto marketing_ads columns.

    This actor returns no ad copy and no destination URL, so body/cta/landing_url
    are absent by design rather than by mistake -- do not add speculative keys
    here to 'fix' that. It does return firstShown/lastShown/approxDaysShown,
    which are what make ad recency answerable.
    """
    raw = as_dict(item)
    out: dict[str, Any] = {
        "page_name": raw.get("advertiserName") or raw.get("advertiser"),
        "creative_url": (
            raw.get("imageUrl") or raw.get("videoUrl")
            or raw.get("creativeUrl") or raw.get("preview_image_url")
        ),
        "started_at": raw.get("firstShown") or raw.get("startedAt") or raw.get("first_shown"),
        "last_shown": raw.get("lastShown") or raw.get("last_shown"),
        "approx_days_shown": raw.get("approxDaysShown"),
        "ad_format": raw.get("adFormat"),
        # adUrl is a Google transparency-archive permalink, NOT the advertiser's
        # landing page. It must never be written to landing_url: "where does the
        # click land" would then answer with a Google URL for every Google ad.
        "archive_url": raw.get("adUrl"),
    }
    return {k: v for k, v in out.items() if v not in (None, "", [])}


def ad_id_of(item: Any, platform: str) -> str | None:
    raw = as_dict(item)
    if platform == "meta":
        v = raw.get("adArchiveID") or raw.get("adArchiveId") or raw.get("adId") or raw.get("id")
    else:
        v = (raw.get("creativeId") or raw.get("creative_id")
             or raw.get("adId") or raw.get("ad_id") or raw.get("id"))
    return str(v) if v else None


def writable_columns(sb, table: str = "marketing_ads") -> set[str]:
    """Columns that actually exist on the table right now.

    migrations/026 adds ad_title, publisher_platforms, last_shown,
    approx_days_shown, ad_format, archive_url and is_template_ad. That migration
    is applied by hand in the Supabase SQL editor, so a scrape may run before it
    lands. Posting an unknown column makes PostgREST reject the whole batch
    (PGRST204) and would lose a week of ads over a column that is merely nice to
    have -- so unknown keys are dropped rather than allowed to fail the run.
    """
    try:
        sample = sb.get(table, "*", {"limit": "1"})
    except Exception:
        return set()
    return set(sample[0].keys()) if sample else set()


def restrict(row: dict, available: set[str]) -> dict:
    """Drop keys the table cannot accept. An empty `available` means no filter."""
    if not available:
        return row
    return {k: v for k, v in row.items() if k in available}
