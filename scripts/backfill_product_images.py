"""Backfill image_url on products + products_catalog using crawl4ai.

For every row in `products` that has a URL but no image_url, render the
page via crawl4ai (headless Chromium — bypasses Cloudflare and runs JS),
then extract the hero image from (in priority order):
  1. og:image / og:image:secure_url meta tag
  2. twitter:image meta tag
  3. JSON-LD Product.image field
  4. Shopify /products/{handle}.json featured_image (plain HTTP fallback)
  5. First non-logo product-card <img> on the page

Then UPDATE products.image_url. If the product's name matches a
products_catalog row (display_name or aliases, case-insensitive substring),
also UPDATE that catalog row's image_url.

Idempotent: rows with image_url already set are skipped unless --force.

Usage:
  python scripts/backfill_product_images.py                  # all brands
  python scripts/backfill_product_images.py joola selkirk    # specific brands
  python scripts/backfill_product_images.py --force          # re-scrape
  python scripts/backfill_product_images.py --limit 20       # cap rows
  python scripts/backfill_product_images.py --concurrency 3  # parallel pages
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

REPO_ROOT = Path(__file__).resolve().parents[1]


def load_env() -> None:
    for candidate in (REPO_ROOT / ".env", REPO_ROOT / "scripts" / ".env"):
        if not candidate.exists():
            continue
        try:
            from dotenv import load_dotenv
            load_dotenv(candidate)
            continue
        except ImportError:
            pass
        for line in candidate.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


load_env()

# Make backend.scraping importable so we can reuse crawl4ai_client
sys.path.insert(0, str(REPO_ROOT))

try:
    import requests  # type: ignore
except ImportError:
    print("ERROR: requests not installed. Run: pip install requests")
    sys.exit(1)

try:
    from backend.scraping.core.crawl4ai_client import fetch_pages_batch, run_sync
except Exception as e:
    print(f"ERROR: cannot import crawl4ai_client: {e}")
    print("Run: pip install crawl4ai && python -m patchright install chromium")
    sys.exit(1)


SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be in .env")
    sys.exit(1)

SB_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

UA_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    ),
}


_OG_RE = re.compile(
    r'<meta[^>]+property=["\']og:image(?::secure_url)?["\'][^>]+content=["\']([^"\']+)["\']',
    re.IGNORECASE,
)
_OG_RE_REV = re.compile(
    r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image(?::secure_url)?["\']',
    re.IGNORECASE,
)
_TW_RE = re.compile(
    r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']',
    re.IGNORECASE,
)
_TW_RE_REV = re.compile(
    r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']twitter:image["\']',
    re.IGNORECASE,
)
_LDJSON_RE = re.compile(
    r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.DOTALL | re.IGNORECASE,
)
_IMG_RE = re.compile(r'<img[^>]+src=["\']([^"\']+)["\']', re.IGNORECASE)


def _normalize_url(src: str, base: str) -> str:
    if src.startswith("//"):
        return "https:" + src
    if src.startswith("http"):
        return src
    return urljoin(base, src)


def _extract_from_ldjson(html: str) -> str | None:
    for match in _LDJSON_RE.finditer(html):
        try:
            data = json.loads(match.group(1).strip())
        except Exception:
            continue
        items = data if isinstance(data, list) else [data]
        for item in items:
            if not isinstance(item, dict):
                continue
            if item.get("@type") not in ("Product", "IndividualProduct"):
                continue
            img = item.get("image")
            if isinstance(img, list) and img:
                img = img[0]
            if isinstance(img, dict):
                img = img.get("url")
            if isinstance(img, str) and img.startswith("http"):
                return img
    return None


def _extract_shopify(url: str) -> str | None:
    """Plain HTTP fetch of /products/{handle}.json — works without crawl4ai."""
    if "/products/" not in url:
        return None
    json_url = re.sub(r"\?.*$", "", url.rstrip("/")) + ".json"
    try:
        r = requests.get(json_url, headers=UA_HEADERS, timeout=12)
    except Exception:
        return None
    if r.status_code != 200:
        return None
    try:
        product = r.json().get("product") or {}
    except Exception:
        return None
    feat = product.get("image") or {}
    src = feat.get("src") if isinstance(feat, dict) else None
    if isinstance(src, str) and src.startswith("http"):
        return src
    images = product.get("images") or []
    if images and isinstance(images, list):
        first = images[0]
        if isinstance(first, dict) and isinstance(first.get("src"), str):
            return first["src"]
    return None


def extract_image_from_html(html: str, base_url: str) -> tuple[str | None, str]:
    """Return (image_url, source_tag)."""
    for rgx in (_OG_RE, _OG_RE_REV):
        m = rgx.search(html)
        if m and m.group(1).startswith("http"):
            return m.group(1), "og"

    for rgx in (_TW_RE, _TW_RE_REV):
        m = rgx.search(html)
        if m and m.group(1).startswith("http"):
            return m.group(1), "twitter"

    ld = _extract_from_ldjson(html)
    if ld:
        return ld, "ld_json"

    # Last resort: first <img> with a product-like file extension
    for m in _IMG_RE.finditer(html):
        src = m.group(1)
        if not src or "data:" in src:
            continue
        low = src.lower()
        if any(skip in low for skip in ("logo", "icon", "avatar", "favicon", "sprite")):
            continue
        if any(ext in low for ext in (".jpg", ".jpeg", ".png", ".webp", ".avif")):
            return _normalize_url(src, base_url), "img"

    return None, "none"


def sb_get(table: str, *, select: str, params: dict[str, str] | None = None) -> list[dict]:
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    q = {"select": select}
    if params:
        q.update(params)
    out: list[dict] = []
    page = 0
    while True:
        headers = {**SB_HEADERS, "Range": f"{page*1000}-{(page+1)*1000-1}"}
        r = requests.get(url, headers=headers, params=q, timeout=30)
        if r.status_code not in (200, 206):
            raise RuntimeError(f"GET {table}: {r.status_code} {r.text[:200]}")
        chunk = r.json()
        out.extend(chunk)
        if len(chunk) < 1000:
            break
        page += 1
    return out


def sb_patch(table: str, id_col: str, id_val: str, body: dict[str, Any]) -> bool:
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    params = {id_col: f"eq.{id_val}"}
    r = requests.patch(url, headers=SB_HEADERS, params=params, json=body, timeout=20)
    if r.status_code not in (200, 204):
        print(f"  PATCH fail {table} {id_val}: {r.status_code} {r.text[:200]}")
        return False
    return True


def _normalize(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()


def main(argv: list[str]) -> int:
    pos = [a for a in argv[1:] if not a.startswith("--")]
    flags = [a for a in argv[1:] if a.startswith("--")]
    force = "--force" in flags
    limit = None
    concurrency = 3
    for f in flags:
        if f.startswith("--limit="):
            limit = int(f.split("=", 1)[1])
        elif f.startswith("--concurrency="):
            concurrency = int(f.split("=", 1)[1])
    # support "--limit 20" two-token form
    for i, a in enumerate(argv[1:]):
        if a == "--limit" and i + 1 < len(argv) - 1:
            try:
                limit = int(argv[i + 2])
            except Exception:
                pass
        elif a == "--concurrency" and i + 1 < len(argv) - 1:
            try:
                concurrency = int(argv[i + 2])
            except Exception:
                pass

    print(f"Connecting to {SUPABASE_URL}")
    brands = sb_get("brands", select="id,slug,name")
    if pos:
        wanted = {a for a in pos if not a.isdigit()}
        if wanted:
            brands = [b for b in brands if b["slug"] in wanted]
    if not brands:
        print("ERROR: no brands matched")
        return 1
    print(f"Brands in scope: {[b['slug'] for b in brands]}")

    catalog = sb_get("products_catalog", select="id,brand_id,display_name,aliases,image_url")
    catalog_by_brand_name: dict[tuple[str, str], dict] = {}
    for c in catalog:
        bid = c.get("brand_id")
        if not bid:
            continue
        if c.get("display_name"):
            catalog_by_brand_name[(bid, _normalize(c["display_name"]))] = c
        for a in (c.get("aliases") or []):
            if a:
                catalog_by_brand_name[(bid, _normalize(a))] = c

    brand_ids = {b["id"] for b in brands}
    products = sb_get("products", select="id,brand_id,name,url,image_url")
    products = [
        p for p in products
        if p.get("brand_id") in brand_ids and p.get("url")
    ]
    if not force:
        products = [p for p in products if not p.get("image_url")]
    if limit:
        products = products[:limit]
    print(f"Products to scrape: {len(products)} (concurrency={concurrency})")
    if not products:
        print("Nothing to do.")
        return 0

    # ── Phase 1: cheap Shopify .json pass (no headless browser needed) ──
    print("\n[Phase 1] Shopify .json fast path")
    shopify_hits = 0
    pending: list[dict] = []
    for p in products:
        img = _extract_shopify(p["url"])
        if img:
            sb_patch("products", "id", p["id"], {"image_url": img})
            shopify_hits += 1
            cat = catalog_by_brand_name.get((p["brand_id"], _normalize(p["name"])))
            if not cat:
                for (bid, key), c in catalog_by_brand_name.items():
                    if bid == p["brand_id"] and key and key in _normalize(p["name"]):
                        cat = c
                        break
            if cat and not cat.get("image_url"):
                if sb_patch("products_catalog", "id", cat["id"], {"image_url": img}):
                    cat["image_url"] = img
            print(f"  shopify | {p['name'][:60]}")
        else:
            pending.append(p)
    print(f"[Phase 1] hits={shopify_hits}, remaining={len(pending)}")

    if not pending:
        print(f"\n[done] ok={shopify_hits} miss=0")
        return 0

    # ── Phase 2: crawl4ai for non-Shopify or stale-URL brands ──
    print(f"\n[Phase 2] crawl4ai on {len(pending)} pages (concurrency={concurrency})")
    urls = [p["url"] for p in pending]

    results = run_sync(fetch_pages_batch(urls, timeout=45, max_concurrent=concurrency))
    crawl_hits = 0
    miss = 0
    for p, r in zip(pending, results):
        if not r.get("success") or not r.get("html"):
            miss += 1
            print(f"  miss     | {p['name'][:60]}  ({r.get('status_code', '?')})")
            continue
        img, src = extract_image_from_html(r["html"], p["url"])
        if not img:
            miss += 1
            print(f"  none     | {p['name'][:60]}")
            continue
        sb_patch("products", "id", p["id"], {"image_url": img})
        crawl_hits += 1
        cat = catalog_by_brand_name.get((p["brand_id"], _normalize(p["name"])))
        if not cat:
            for (bid, key), c in catalog_by_brand_name.items():
                if bid == p["brand_id"] and key and key in _normalize(p["name"]):
                    cat = c
                    break
        if cat and not cat.get("image_url"):
            if sb_patch("products_catalog", "id", cat["id"], {"image_url": img}):
                cat["image_url"] = img
        print(f"  {src:8s} | {p['name'][:60]}")

    ok = shopify_hits + crawl_hits
    print(f"\n[done] ok={ok} (shopify={shopify_hits} crawl4ai={crawl_hits}) miss={miss}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
