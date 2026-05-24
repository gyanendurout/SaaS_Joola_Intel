"""Reddit brand mentions scraper — r/pickleball + keyword search.

Matches the live Supabase schema:
  reddit_mentions(brand_id, reddit_post_id, subreddit, country_code,
                  post_title, post_url, content_type, content_text,
                  author, upvotes, posted_at)
Conflict key: reddit_post_id,brand_id
"""

from __future__ import annotations

import re
from typing import Any

from ...core import apify_client as apify
from ...core import supabase_client as sb
from ...core.logger import get_logger

log = get_logger("reddit.mentions")

BRAND_KEYWORDS: dict[str, str] = {
    "joola": "joola", "joola pickleball": "joola", "ben johns": "joola",
    "scorpeus": "joola", "hyperion": "joola", "solaire": "joola",
    "selkirk": "selkirk", "selkirk sport": "selkirk", "vanguard": "selkirk",
    "luxx": "selkirk", "halo": "selkirk",
    "paddletek": "paddletek", "bantam": "paddletek",
    "crbn": "crbn",
    "six zero": "six-zero", "sixzero": "six-zero", "double black diamond": "six-zero",
    "engage": "engage", "pursuit": "engage",
    "onix": "onix", "z5": "onix",
    "franklin": "franklin",
    "head pickleball": "head", "radical": "head",
    "wilson pickleball": "wilson",
    "gamma": "gamma", "obsidian": "gamma",
}

SEARCH_QUERIES = [
    "joola pickleball", "selkirk pickleball", "paddletek",
    "crbn pickleball", "six zero pickleball", "engage pickleball",
    "onix pickleball", "franklin pickleball paddle",
    "head pickleball paddle", "wilson pickleball paddle", "gamma pickleball",
]


def _match_brands(text: str) -> list[str]:
    text_lower = (text or "").lower()
    return list({slug for kw, slug in BRAND_KEYWORDS.items() if kw in text_lower})


def _extract_reddit_post_id(url: str, item_id: str | None) -> str:
    if item_id:
        sid = str(item_id)
        return sid if sid.startswith("t3_") else f"t3_{sid}"
    m = re.search(r"/comments/([a-z0-9]+)/", url or "")
    return f"t3_{m.group(1)}" if m else ""


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}

    if dry_run:
        log.info("[DRY-RUN] would scrape Reddit mentions from r/pickleball + %d search queries", len(SEARCH_QUERIES))
        return 0

    items_a = apify.run_and_fetch("trudax/reddit-scraper-lite", {
        "startUrls": [{"url": "https://www.reddit.com/r/pickleball/"}],
        "sort": "new",
        "time": "month",
        "maxItems": 500,
    })
    items_b = apify.run_and_fetch("trudax/reddit-scraper-lite", {
        "searches": SEARCH_QUERIES,
        "sort": "relevance",
        "time": "month",
        "maxItems": 500,
    })

    seen: set[tuple[str, str]] = set()
    rows: list[dict] = []

    for item in (items_a + items_b):
        title    = item.get("title") or ""
        body     = item.get("text") or item.get("body") or ""
        post_url = item.get("url") or item.get("postUrl", "")
        reddit_post_id = _extract_reddit_post_id(post_url, item.get("id"))

        matched = _match_brands(f"{title} {body}")
        if brand_filter:
            matched = [s for s in matched if s in brand_filter]

        for slug in matched:
            brand_id = brand_map.get(slug)
            if not brand_id:
                continue
            key = (post_url, brand_id)
            if key in seen:
                continue
            seen.add(key)
            rows.append({
                "brand_id":       brand_id,
                "reddit_post_id": reddit_post_id,
                "subreddit":      item.get("subreddit") or item.get("communityName", ""),
                "country_code":   "US",
                "post_title":     title[:500],
                "post_url":       post_url,
                "content_type":   "Post",
                "content_text":   body[:2000],
                "author":         item.get("author") or item.get("username", ""),
                "upvotes":        item.get("score") or item.get("upvotes", 0),
                "posted_at":      item.get("createdAt") or item.get("created"),
            })

    n = sb.upsert("reddit_mentions", rows, "reddit_post_id,brand_id")
    log.info("✓ %d Reddit mentions upserted", n)
    return n
