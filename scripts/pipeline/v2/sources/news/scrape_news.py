"""News scraper — fetches pickleball brand news articles every 6 hours.

Uses Playwright to scrape Google News and direct brand PR pages.
Scheduled via scheduler.py (APScheduler).
"""

from __future__ import annotations

from datetime import date
from typing import Any

from ...core import apify_client as apify
from ...core import supabase_client as sb
from ...core.logger import get_logger

log = get_logger("news.scraper")

NEWS_QUERIES = [
    "joola pickleball",
    "selkirk pickleball",
    "paddletek pickleball",
    "crbn pickleball",
    "six zero pickleball",
    "engage pickleball",
    "onix pickleball",
    "franklin pickleball",
    "head pickleball",
    "wilson pickleball",
    "gamma pickleball",
    "pickleball paddle review",
    "pickleball brand news",
]

BRAND_KEYWORDS: dict[str, str] = {
    "joola": "joola", "selkirk": "selkirk", "paddletek": "paddletek",
    "crbn": "crbn", "six zero": "six-zero", "six-zero": "six-zero",
    "engage": "engage", "onix": "onix", "franklin": "franklin",
    "head pickleball": "head", "wilson pickleball": "wilson", "gamma": "gamma",
}


def _match_brand(text: str) -> str | None:
    tl = text.lower()
    for kw, slug in BRAND_KEYWORDS.items():
        if kw in tl:
            return slug
    return None


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    today = date.today()

    if dry_run:
        log.info("[DRY-RUN] would scrape news for %d queries", len(NEWS_QUERIES))
        return 0

    # Scrape Google News via Playwright
    items = apify.run_and_fetch("apify/playwright-scraper", {
        "startUrls": [
            {"url": f"https://news.google.com/search?q={q.replace(' ', '+')}&hl=en-US&gl=US&ceid=US:en"}
            for q in NEWS_QUERIES[:5]  # limit per run to control cost
        ],
        "pageFunction": """
async ({ page, request }) => {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const articles = await page.$$eval('article', els =>
    els.slice(0, 20).map(el => ({
      title: el.querySelector('h3, h4, [class*=title]')?.textContent?.trim(),
      url: el.querySelector('a')?.href,
      source: el.querySelector('[class*=source], time')?.textContent?.trim(),
      published: el.querySelector('time')?.getAttribute('datetime'),
    })).filter(a => a.title && a.url)
  );
  return { query: request.url, articles };
}
""",
    })

    rows: list[dict] = []
    for item in items:
        for article in item.get("articles", []):
            title = article.get("title") or ""
            slug = _match_brand(title)
            if brand_filter and slug not in brand_filter:
                continue
            brand_id = brand_map.get(slug) if slug else None
            rows.append({
                "brand_id":    brand_id,
                "title":       title[:300],
                "url":         article.get("url"),
                "source":      article.get("source", "")[:100],
                "published_at": article.get("published"),
                "scraped_date": today.isoformat(),
                "sentiment":   None,  # enriched later
            })

    # De-duplicate by URL
    seen_urls: set[str] = set()
    deduped = []
    for r in rows:
        url = r.get("url") or ""
        if url and url not in seen_urls:
            seen_urls.add(url)
            deduped.append(r)

    n = sb.upsert("news_articles", deduped, "url") if deduped else 0
    log.info("✓ %d news articles upserted", n)
    return n
