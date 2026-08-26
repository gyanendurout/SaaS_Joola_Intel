"""News scraper — pickleball brand news articles from Google News.

Reads the Google News **RSS** endpoint rather than scraping the search page.

History: this module used to drive `apify/playwright-scraper` against
`news.google.com/search` and pull `article` elements out of the DOM. Google
changed that markup, `article` began matching zero elements, and the step
reported `0 news articles upserted` as a success for months (see TODO.md).
Two things were wrong, and the selector was only the visible one:

  1. The `article` selector no longer matches (verified 2026-08-18: the search
     HTML contains zero `<article>` tags).
  2. The row shape never matched the live table. It wrote `brand_id`, `source`
     and `scraped_date`; `news_articles` has none of those — the real columns
     are `source_site` and `scraped_at`, and brand attribution goes through
     `is_joola_mention` / `competitors_mentioned`. So even a working selector
     would have written nothing.

RSS fixes both classes of problem at once: it is a stable documented feed, needs
no JS, costs no Apify credits (so every query runs instead of the first five),
and returns title / link / pubDate / source as real fields.

NOTE ON TERMS: Google's RSS copyright notice restricts the feed to personal,
non-commercial feed-reader use. This module targets the same source the previous
implementation did, so it is not a new exposure — but if JOOLA Intel needs a
license-clean footing, swap `_fetch_query()` for a licensed provider (GDELT is
free and permissive; NewsAPI / Bing News are paid). Everything below that
function is provider-agnostic.
"""

from __future__ import annotations

import hashlib
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any

from ...core import supabase_client as sb
from ...core.logger import get_logger
from ...core.network import http_request

log = get_logger("news.scraper")

RSS_ENDPOINT = "https://news.google.com/rss/search"
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

# (query, brand slug the query is about). The slug is the attribution fallback
# when the headline itself does not name the brand — "Pro V Review: Refinement
# or Falling Behind?" came from the joola query but contains no "joola".
NEWS_QUERIES: list[tuple[str, str | None]] = [
    ("joola pickleball",          "joola"),
    ("selkirk pickleball",        "selkirk"),
    ("paddletek pickleball",      "paddletek"),
    ("crbn pickleball",           "crbn"),
    ("six zero pickleball",       "six-zero"),
    ("engage pickleball",         "engage"),
    ("onix pickleball",           "onix"),
    ("franklin pickleball",       "franklin"),
    ("head pickleball",           "head"),
    ("wilson pickleball",         "wilson"),
    ("gamma pickleball",          "gamma"),
    ("pickleball paddle review",  None),
    ("pickleball brand news",     None),
]

BRAND_KEYWORDS: dict[str, str] = {
    "paddletek": "paddletek", "selkirk": "selkirk", "six zero": "six-zero",
    "six-zero": "six-zero", "sixzero": "six-zero", "franklin": "franklin",
    "engage": "engage", "wilson": "wilson", "joola": "joola", "gamma": "gamma",
    "onix": "onix", "crbn": "crbn", "head": "head",
}

_TAG_RE = re.compile(r"<[^>]+>")


def _brands_in(text: str) -> set[str]:
    """Every brand slug named in `text`. Word-boundary matched, so "head" does
    not fire on "headline" and "onix" does not fire on "sonix"."""
    tl = text.lower()
    return {slug for kw, slug in BRAND_KEYWORDS.items()
            if re.search(r"\b" + re.escape(kw) + r"\b", tl)}


def _strip_source_suffix(title: str, source: str) -> str:
    """Google appends " - Publisher" to every headline; `source` already has it."""
    suffix = " - " + source
    if source and title.endswith(suffix):
        return title[: -len(suffix)].strip()
    return title


def _parse_pubdate(raw: str | None) -> str | None:
    if not raw:
        return None
    try:
        return parsedate_to_datetime(raw).astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def _fetch_query(query: str) -> list[dict[str, Any]]:
    """One Google News RSS query, returned as raw article dicts."""
    url = (RSS_ENDPOINT + "?q=" + query.replace(" ", "+")
           + "&hl=en-US&gl=US&ceid=US:en")
    resp = http_request("GET", url, headers={"User-Agent": _UA}, timeout=30)
    if resp.status_code != 200:
        log.warning("news RSS %r returned HTTP %s", query, resp.status_code)
        return []
    try:
        root = ET.fromstring(resp.content)
    except ET.ParseError as e:
        log.warning("news RSS %r returned unparseable XML: %s", query, e)
        return []

    out: list[dict[str, Any]] = []
    for item in root.findall("./channel/item"):
        link = (item.findtext("link") or "").strip()
        source = (item.findtext("source") or "").strip()
        title = _strip_source_suffix((item.findtext("title") or "").strip(), source)
        if not link or not title:
            continue
        excerpt = _TAG_RE.sub(" ", item.findtext("description") or "")
        out.append({
            "title":     title,
            "url":       link,
            "source":    source,
            "published": _parse_pubdate(item.findtext("pubDate")),
            "excerpt":   " ".join(excerpt.split())[:500],
        })
    return out


def _to_row(article: dict[str, Any], query_slug: str | None,
            scraped_at: str) -> dict[str, Any]:
    """Map a raw article onto the live `news_articles` column names."""
    title = article["title"]
    brands = _brands_in(title + " " + (article.get("excerpt") or ""))
    if not brands and query_slug:
        brands = {query_slug}
    competitors = sorted(brands - {"joola"})
    return {
        "url":                    article["url"],
        "title":                  title[:300],
        "source_site":            (article.get("source") or "")[:100],
        "excerpt":                article.get("excerpt") or "",
        "published_at":           article.get("published"),
        "scraped_at":             scraped_at,
        "is_active":              True,
        "is_joola_mention":       "joola" in brands,
        "competitors_mentioned":  competitors,
        "has_competitor_mention": bool(competitors),
        "word_count":             len(title.split()),
        # 1:1 with url, so content_hash never collides beyond the url conflict.
        "content_hash":           hashlib.sha256(
                                      article["url"].encode()).hexdigest(),
    }


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    queries = NEWS_QUERIES
    if brand_filter:
        queries = [(q, s) for q, s in NEWS_QUERIES
                   if s is None or s in brand_filter]

    if dry_run:
        log.info("[DRY-RUN] would query Google News RSS for %d queries",
                 len(queries))
        return 0

    scraped_at = datetime.now(timezone.utc).isoformat()
    rows: dict[str, dict[str, Any]] = {}   # url -> row, dedupes across queries
    fetched = 0

    for query, slug in queries:
        articles = _fetch_query(query)
        fetched += len(articles)
        kept = 0
        for article in articles:
            row = _to_row(article, slug, scraped_at)
            if brand_filter:
                named = set(row["competitors_mentioned"])
                if row["is_joola_mention"]:
                    named.add("joola")
                if not named & set(brand_filter):
                    continue
            rows[row["url"]] = row
            kept += 1
        log.info("  %-26s %3d articles, %3d kept", query, len(articles), kept)

    deduped = list(rows.values())
    n = sb.upsert("news_articles", deduped, "url") if deduped else 0
    log.info("%d news articles upserted (%d fetched, %d unique)",
             n, fetched, len(deduped))

    # Never let "scraped fine, wrote nothing" pass as a clean run again. That is
    # the exact failure mode that hid the broken selector for months.
    if fetched and not n:
        raise RuntimeError(
            "news: fetched " + str(fetched) + " articles but wrote 0 rows — the "
            "row shape or the upsert conflict key is wrong, not the scrape."
        )
    return n
