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

from ...core.logger import get_logger

log = get_logger("ads.payload")

# Meta serves dynamic catalogue ads whose body is a token filled in at delivery
# time ("{{product.brand}}"). Nobody wrote that sentence, so it must not be
# counted as messaging -- it is recorded as a template ad with empty copy.
TEMPLATE_ONLY = re.compile(r"^\s*\{\{.*?\}\}\s*$", re.S)

# The exact columns each builder returns, ALWAYS, for every item.
#
# These are tuples and not "whatever happened to have a value" because a bulk
# POST whose objects differ in key set is rejected wholesale by PostgREST with
# 400 PGRST102 "All object keys must match". Returning only the populated keys
# made one ad with no CTA enough to lose the entire batch: on 2026-09-12 that
# cost 822 freshly scraped creatives (168 Meta + 654 Google, 0 written) after
# the Apify credits had already been spent.
#
# A key whose value is unknown is present and None -- an explicit SQL NULL --
# not absent. The two booleans are the exceptions: they carry their real value
# so they match the column DEFAULT instead of going tri-state. See below.
META_COLUMNS: tuple[str, ...] = (
    "body", "cta", "ad_title", "landing_url", "creative_url",
    "started_at", "last_shown", "publisher_platforms",
    "is_template_ad", "is_active",
)

# Google's actor returns no ad copy and no advertiser landing page, so `body`,
# `cta` and `landing_url` are absent from EVERY Google row by design. That is
# uniform, and therefore fine -- what PostgREST objects to is rows differing
# from each other, not a builder omitting a column it never has.
GOOGLE_COLUMNS: tuple[str, ...] = (
    "page_name", "creative_url", "started_at", "last_shown",
    "approx_days_shown", "ad_format", "archive_url",
)


def fixed_shape(columns: tuple[str, ...], values: dict) -> dict:
    """Project `values` onto exactly `columns`, in order.

    Empty string and empty list collapse to None so "the actor returned
    nothing" is stored as NULL rather than as '' -- but the KEY is always
    present, which is what keeps a batch postable.
    """
    out: dict[str, Any] = {}
    for col in columns:
        v = values.get(col)
        out[col] = None if v == "" or v == [] else v
    return out


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

    Returns every key in META_COLUMNS for every item, value or no value. It used
    to return only the keys that carried a value, which made the batch ragged
    and unpostable -- see META_COLUMNS.
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
    return fixed_shape(META_COLUMNS, {
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
        # Real boolean, never None: the column is `DEFAULT false`, and a NULL
        # here would break `WHERE is_template_ad = false` for every ordinary ad.
        "is_template_ad": bool(template),
        # The column is `DEFAULT true` and the actor is invoked with
        # activeStatus="active", so an item that does not mention isActive is
        # an active ad. Writing None instead would make every such ad read as
        # "unknown" and break the "what is running now" queries outright.
        "is_active": bool(raw["isActive"]) if raw.get("isActive") is not None else True,
    })


def google_fields(item: Any) -> dict:
    """Map one solidcode/ads-transparency-scraper item onto marketing_ads columns.

    This actor returns no ad copy and no destination URL, so body/cta/landing_url
    are absent by design rather than by mistake -- do not add speculative keys
    here to 'fix' that. It does return firstShown/lastShown/approxDaysShown,
    which are what make ad recency answerable.

    Returns every key in GOOGLE_COLUMNS for every item, value or no value, so
    the batch stays postable -- see META_COLUMNS for why.
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
    return fixed_shape(GOOGLE_COLUMNS, out)


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

    Probe via get_filtered(), NOT get(). `supabase_client.get()` renders every
    param as `k=eq.v`, which is right for column equality and wrong for
    PostgREST's reserved params: `{"limit": "1"}` became `?limit=eq.1`, a 400 that
    the old bare `except Exception` swallowed into an empty set. `restrict()`
    treats empty as "no filter", so from the day it was written until 2026-09-12
    this guard was a no-op that reported success. get_filtered() passes its filter
    string through untouched.
    """
    try:
        sample = sb.get_filtered(table, "*", "limit=1")
    except Exception as e:
        # Fail OPEN deliberately — a failed probe must not cost a week of ads —
        # but never fail silent: restrict() is about to pass every key through,
        # so an unapplied migration will now surface as PGRST204 on the batch.
        log.warning(
            "could not read %s columns (%s: %s). restrict() will act as a NO-OP "
            "for this run, so an unknown column will fail the batch instead of "
            "being dropped.", table, type(e).__name__, e,
        )
        return set()
    if not sample:
        log.warning(
            "%s is empty, so no column list could be read. restrict() will act "
            "as a NO-OP for this run.", table,
        )
        return set()
    return set(sample[0].keys())


def restrict(row: dict, available: set[str]) -> dict:
    """Drop keys the table cannot accept. An empty `available` means no filter."""
    if not available:
        return row
    return {k: v for k, v in row.items() if k in available}
