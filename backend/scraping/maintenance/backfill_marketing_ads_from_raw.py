"""Recover marketing_ads fields that were dropped by a scraper key mismatch.

Both ad scrapers store the untouched Apify item in marketing_ads.raw, so the
data the mapping missed is still on disk and no re-scrape is needed.

What went wrong: apify/facebook-ads-scraper returns the creative under a
nested `snapshot` object in camelCase (snapshot.body.text, snapshot.ctaText,
snapshot.linkUrl), while scrape_meta_ads.py reads top-level snake_case
(ad_creative_body, cta_text, link_url). Every lookup returned None and was
written as empty. Nothing raised, so the run reported success.

Google is only partly recoverable: solidcode/ads-transparency-scraper never
returns ad copy or a destination URL, so body/landing_url stay empty there.
It does return firstShown/lastShown, which the mapping already reads for
started_at.

Reads raw, writes only the derived columns. Re-runnable. Dry-run by default.

    python -m backend.scraping.maintenance.backfill_marketing_ads_from_raw
    python -m backend.scraping.maintenance.backfill_marketing_ads_from_raw --apply
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import pathlib
import urllib.parse
import urllib.request

from backend.scraping.sources.ads.ad_payload import meta_fields, restrict

log = logging.getLogger(__name__)

PAGE = 500


def _env() -> tuple[str, str]:
    out: dict[str, str] = {}
    p = pathlib.Path(__file__).resolve().parents[3] / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    url = os.environ.get("SUPABASE_URL") or out.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or out.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise SystemExit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")
    return url.rstrip("/"), key


def _req(url: str, key: str, path: str, method: str = "GET", body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    if data:
        headers["Content-Type"] = "application/json"
        headers["Prefer"] = "return=minimal"
    r = urllib.request.Request(f"{url}/rest/v1/{path}", data=data, headers=headers, method=method)
    with urllib.request.urlopen(r, timeout=90) as f:
        raw = f.read().decode()
        return json.loads(raw) if raw.strip() else None


def derive(raw_value) -> dict:
    """Map one raw Apify item onto marketing_ads columns.

    Delegates to ad_payload.meta_fields so the backfill and the live scraper can
    never disagree about what a field is called -- that disagreement is the bug
    this script exists to repair.
    """
    return meta_fields(raw_value)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    ap.add_argument("--platform", default="meta")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    url, key = _env()
    rows, off = [], 0
    while True:
        q = urllib.parse.urlencode({
            "select": "id,body,cta,creative_url,landing_url,started_at,is_active,raw",
            "platform": f"eq.{args.platform}", "order": "id.asc", "limit": PAGE, "offset": off,
        })
        batch = _req(url, key, f"marketing_ads?{q}") or []
        rows += batch
        if len(batch) < PAGE:
            break
        off += PAGE

    # migrations/026 adds ad_title, publisher_platforms, last_shown,
    # approx_days_shown, ad_format, archive_url and is_template_ad. It is applied
    # by hand in the Supabase SQL editor, so this script must stay runnable
    # before it lands: PATCHing an unknown column is rejected outright
    # (PGRST204) and would abort a repair that is otherwise fine.
    available = set(rows[0].keys()) if rows else set()
    pending = sorted({
        k for r in rows for k in derive(r.get("raw")) if k not in available
    })
    if pending:
        log.info("skipping (migrations/026 not applied yet): %s", ", ".join(pending))

    filled: dict[str, int] = {}
    changed = 0
    for r in rows:
        d = restrict(derive(r.get("raw")), available)
        # Fill-only for content columns: never overwrite something already good.
        patch = {k: v for k, v in d.items() if k != "is_active" and not r.get(k)}
        # is_active is a correction, not a fill. Every row currently reads true
        # because the old mapping missed the flag and fell back to a default, so
        # skipping non-empty values here would preserve exactly the bug.
        if "is_active" in d and bool(r.get("is_active")) != d["is_active"]:
            patch["is_active"] = d["is_active"]
        if not patch:
            continue
        changed += 1
        for k in patch:
            filled[k] = filled.get(k, 0) + 1
        if args.apply:
            _req(url, key, f"marketing_ads?id=eq.{urllib.parse.quote(str(r['id']), safe='')}",
                 method="PATCH", body=patch)

    verb = "filled" if args.apply else "would fill"
    log.info("%s ads scanned (platform=%s); %d rows %s", len(rows), args.platform, changed, verb)
    for k, v in filled.items():
        log.info("   %-13s %s %d", k, verb, v)
    if not args.apply:
        log.info("\nDry run. Re-run with --apply to write.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
