"""Populate topic_lifecycle table from per-channel topics arrays.

The live mention_facts table does NOT have a `topics` column — topics live
on the original channel tables (ig_comments.topics, yt_comments.topics,
x_posts.topics, etc), populated by ai_enricher.

This module aggregates those topic arrays into a (brand, topic, channel,
week, year) rollup with first-seen tracking.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any

from ..core import supabase_client as sb
from ..core.logger import get_logger

log = get_logger("facts.topics")

# (channel, table, ts_col)
TOPIC_SOURCES = [
    ("reddit",       "reddit_mentions",  "posted_at"),
    ("reddit",       "reddit_comments",  "posted_at"),
    ("instagram",    "ig_comments",      "posted_at"),
    ("youtube",      "yt_comments",      "posted_at"),
    ("twitter",      "x_posts",          "posted_at"),
    ("tiktok",       "tiktok_videos",    "posted_at"),
]


def _fetch_topics(table: str, ts_col: str, page_size: int = 1000) -> list[dict]:
    """Paginated fetch of enriched rows with non-null topics."""
    out: list[dict] = []
    offset = 0
    while True:
        try:
            page = sb.get_filtered(
                table,
                f"brand_id,topics,{ts_col}",
                f"topics=not.is.null&enriched_at=not.is.null"
                f"&limit={page_size}&offset={offset}",
            )
        except Exception as e:
            log.warning("fetch %s failed: %s", table, str(e)[:200])
            return out
        if not page:
            break
        out.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return out


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    brand_filter_ids: set[str] | None = None
    if brand_filter:
        brand_filter_ids = {bid for slug, bid in brand_map.items() if slug in brand_filter}

    today = date.today()
    iso_year, iso_week, _ = today.isocalendar()

    # (brand_id, topic, channel) → {count, first_seen}
    agg: dict[tuple[str, str, str], dict] = defaultdict(lambda: {"count": 0, "first_seen": None})

    for channel, table, ts_col in TOPIC_SOURCES:
        rows = _fetch_topics(table, ts_col)
        for r in rows:
            brand_id = r.get("brand_id") or ""
            if not brand_id:
                continue
            if brand_filter_ids and brand_id not in brand_filter_ids:
                continue
            occurred = r.get(ts_col) or None
            for topic in (r.get("topics") or []):
                if not topic:
                    continue
                key = (brand_id, str(topic).lower(), channel)
                e = agg[key]
                e["count"] += 1
                if not e["first_seen"] or (occurred and occurred < e["first_seen"]):
                    e["first_seen"] = occurred

    rows: list[dict] = []
    for (brand_id, topic, channel), e in agg.items():
        rows.append({
            "brand_id":      brand_id,
            "topic":         topic,
            "channel":       channel,
            "mention_count": e["count"],
            "first_seen_at": e["first_seen"],
            "week_number":   iso_week,
            "year":          iso_year,
        })

    if dry_run:
        log.info("[DRY-RUN] would upsert %d topic_lifecycle rows", len(rows))
        return len(rows)

    if not rows:
        log.info("No topics found across channels")
        return 0

    n = sb.upsert("topic_lifecycle", rows, "brand_id,topic,channel,week_number,year")
    log.info("✓ %d topic_lifecycle rows upserted (%d unique topics across %d channels)",
             n, len({k[1] for k in agg}), len({k[2] for k in agg}))
    return n
