"""crawl4ai wrapper for headless JS-rendered page scraping.

Use this for pages that require JavaScript execution:
- Shopify product pages (embedded inventory JSON in window.ShopifyAnalytics)
- Non-Shopify brand pages (Head, Wilson, Onix, Franklin)
- Individual product review pages (BazaarVoice, Judge.me, Okendo widgets)

Not needed for Shopify /products.json endpoint (plain JSON API, no JS).
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from .logger import get_logger

log = get_logger("core.crawl4ai")

_DEFAULT_TIMEOUT = 60  # seconds per page
# "domcontentloaded" is faster and avoids anti-bot timeouts caused by long-running
# ad/analytics beacons that prevent "networkidle" from ever resolving.
# Review widgets and embedded product JSON are available after DOMContentLoaded.
_DEFAULT_WAIT_UNTIL = "domcontentloaded"


def _get_crawler():
    """Lazy import so the rest of the backend works even without crawl4ai installed."""
    try:
        from crawl4ai import AsyncWebCrawler, CrawlerRunConfig, BrowserConfig
        return AsyncWebCrawler, CrawlerRunConfig, BrowserConfig
    except ImportError:
        raise RuntimeError(
            "crawl4ai is not installed. Run: pip install crawl4ai && "
            "python -m patchright install chromium"
        )


async def fetch_page(url: str, timeout: int = _DEFAULT_TIMEOUT) -> dict[str, Any]:
    """Fetch a single URL with a headless browser, return structured result.

    Returns:
        {
            "success": bool,
            "url": str,
            "html": str,          # raw full HTML (pre-JS and post-JS combined)
            "markdown": str,      # cleaned readable text
            "status_code": int,
        }
    """
    AsyncWebCrawler, CrawlerRunConfig, BrowserConfig = _get_crawler()

    browser_cfg = BrowserConfig(headless=True, verbose=False)
    run_cfg = CrawlerRunConfig(
        wait_until=_DEFAULT_WAIT_UNTIL,
        page_timeout=timeout * 1000,  # crawl4ai uses milliseconds
        scan_full_page=True,
    )

    try:
        async with AsyncWebCrawler(config=browser_cfg) as crawler:
            result = await crawler.arun(url=url, config=run_cfg)
            return {
                "success": result.success,
                "url": url,
                "html": result.html or "",
                "markdown": result.markdown or "",
                "status_code": getattr(result, "status_code", 200) or 200,
            }
    except Exception as e:
        log.warning("crawl4ai fetch failed for %s: %s", url, e)
        return {"success": False, "url": url, "html": "", "markdown": "", "status_code": 0}


async def fetch_pages_batch(
    urls: list[str],
    timeout: int = _DEFAULT_TIMEOUT,
    max_concurrent: int = 3,
) -> list[dict[str, Any]]:
    """Fetch multiple URLs with bounded concurrency.

    max_concurrent=3 is conservative — Shopify CDNs rate-limit aggressively.
    """
    sem = asyncio.Semaphore(max_concurrent)

    async def _fetch_one(url: str) -> dict[str, Any]:
        async with sem:
            return await fetch_page(url, timeout=timeout)

    tasks = [_fetch_one(u) for u in urls]
    return await asyncio.gather(*tasks)


def run_sync(coro) -> Any:
    """Run an async coroutine from synchronous code."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(asyncio.run, coro)
                return future.result()
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


# ── Shopify-specific extraction helpers ───────────────────────────────────────

_SHOPIFY_ANALYTICS_RE = re.compile(
    r"window\.ShopifyAnalytics\s*=\s*(\{.*?\});?\s*\n",
    re.DOTALL,
)
_PRODUCT_JSON_SCRIPT_RE = re.compile(
    r'<script[^>]+(?:type=["\']application/json["\'][^>]*id=["\'][^"\']*product[^"\']*["\']'
    r'|id=["\'][^"\']*product[^"\']*["\'][^>]*type=["\']application/json["\'])[^>]*>'
    r'(.*?)</script>',
    re.DOTALL | re.IGNORECASE,
)
_ST_SCRIPT_RE = re.compile(
    r"window\.__st\s*=\s*(\{.*?\});",
    re.DOTALL,
)
# Shopify themes often embed full product JSON for JS use
_PRODUCT_JSON_VAR_RE = re.compile(
    r'var\s+product\s*=\s*(\{["\']id["\'].*?\});',
    re.DOTALL,
)


def extract_shopify_inventory(html: str) -> list[dict[str, Any]]:
    """Try to extract per-variant inventory_quantity from rendered Shopify page HTML.

    Returns list of variant dicts:
        [{"id": 123, "sku": "...", "available": True, "inventory_quantity": 47, ...}, ...]

    Returns [] when no embedded inventory data is found — caller falls back to
    the /products.json API (available boolean only).
    """
    # Strategy 1: window.ShopifyAnalytics.meta.product
    m = _SHOPIFY_ANALYTICS_RE.search(html)
    if m:
        try:
            data = json.loads(m.group(1))
            variants = (
                data.get("meta", {}).get("product", {}).get("variants")
                or data.get("product", {}).get("variants")
            )
            if variants:
                return variants
        except (json.JSONDecodeError, AttributeError):
            pass

    # Strategy 2: <script type="application/json" id="product-json"> or similar
    for m in _PRODUCT_JSON_SCRIPT_RE.finditer(html):
        try:
            data = json.loads(m.group(1))
            variants = data.get("variants") if isinstance(data, dict) else None
            if variants:
                return variants
        except (json.JSONDecodeError, AttributeError):
            pass

    # Strategy 3: window.__st (Shopify tracking pixel data)
    m = _ST_SCRIPT_RE.search(html)
    if m:
        try:
            data = json.loads(m.group(1))
            variants = data.get("variants") or data.get("product", {}).get("variants")
            if variants:
                return variants
        except (json.JSONDecodeError, AttributeError):
            pass

    # Strategy 4: var product = {...} inline assignment
    m = _PRODUCT_JSON_VAR_RE.search(html)
    if m:
        try:
            data = json.loads(m.group(1))
            variants = data.get("variants")
            if variants:
                return variants
        except (json.JSONDecodeError, AttributeError):
            pass

    return []


def extract_visible_inventory(html: str) -> tuple[int | None, str | None]:
    """Extract visible text-based inventory count from page HTML.

    e.g. "Only 3 left in stock", "5 items remaining"
    Returns (qty, matched_text) or (None, None).
    """
    pattern = re.compile(
        r"only\s+(\d+)\s+(?:left|remain(?:ing)?)|"
        r"(\d+)\s+(?:in\s+stock|available|remaining|left)\b",
        re.IGNORECASE,
    )
    m = pattern.search(html)
    if m:
        qty_str = m.group(1) or m.group(2)
        try:
            return int(qty_str), m.group(0)
        except (ValueError, TypeError):
            pass
    return None, None
