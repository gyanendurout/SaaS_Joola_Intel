"""Backfill image_url on products_catalog rows that were missed by the
primary backfill due to weak name matching.

Strategy:
  For each products_catalog row with image_url IS NULL,
    1. List all products rows for the same brand_id that have image_url.
    2. Score each candidate by token overlap between normalized catalog
       display_name/aliases and the product's normalized name.
    3. If best score >= 2 tokens, copy that image_url.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def load_env() -> None:
    for c in (REPO_ROOT / ".env", REPO_ROOT / "scripts" / ".env"):
        if not c.exists():
            continue
        for line in c.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


load_env()

import requests  # type: ignore

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}",
     "Content-Type": "application/json", "Prefer": "return=minimal"}

STOP = {"pickleball", "paddle", "pickle", "ball", "the", "of", "and", "for", "with",
        "v1", "v2", "v3", "16mm", "14mm", "16", "14", "raw", "carbon", "graphite", "composite"}


def tokens(s: str) -> set[str]:
    if not s:
        return set()
    parts = re.split(r"[^a-z0-9]+", s.lower())
    return {p for p in parts if p and p not in STOP and len(p) >= 2}


def sb_get(table: str, select: str, params: dict | None = None) -> list[dict]:
    out, page = [], 0
    while True:
        h = {**H, "Range": f"{page*1000}-{(page+1)*1000-1}"}
        q = {"select": select, **(params or {})}
        r = requests.get(f"{URL}/rest/v1/{table}", headers=h, params=q, timeout=30)
        chunk = r.json()
        out.extend(chunk)
        if len(chunk) < 1000:
            break
        page += 1
    return out


def sb_patch(table: str, id_val: str, body: dict) -> bool:
    r = requests.patch(f"{URL}/rest/v1/{table}", headers=H,
                       params={"id": f"eq.{id_val}"}, json=body, timeout=20)
    return r.status_code in (200, 204)


def main() -> int:
    cat = sb_get("products_catalog", "id,brand_id,display_name,aliases,image_url")
    prods = sb_get("products", "id,brand_id,name,image_url")
    prods = [p for p in prods if p.get("image_url")]
    missing = [c for c in cat if not c.get("image_url")]
    print(f"catalog missing image_url: {len(missing)} of {len(cat)}")
    print(f"product candidates with image_url: {len(prods)}")

    # Index products by brand
    by_brand: dict[str, list[dict]] = {}
    for p in prods:
        by_brand.setdefault(p["brand_id"], []).append(p)

    hits = 0
    for c in missing:
        cands = by_brand.get(c["brand_id"], [])
        if not cands:
            continue
        cat_tokens = tokens(c["display_name"])
        for a in (c.get("aliases") or []):
            cat_tokens |= tokens(a)
        if not cat_tokens:
            continue

        best = None
        best_score = 0
        for p in cands:
            pt = tokens(p["name"])
            score = len(cat_tokens & pt)
            if score > best_score:
                best_score = score
                best = p
        if best and best_score >= 2:
            if sb_patch("products_catalog", c["id"], {"image_url": best["image_url"]}):
                hits += 1
                print(f"  match (tokens={best_score}) | {c['display_name'][:45]:45s} <- {best['name'][:50]}")
    print(f"\n[done] consolidated={hits}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
