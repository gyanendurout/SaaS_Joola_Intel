"""Core AI enrichment — processes all tables with enriched_at IS NULL.

Covers: reddit_mentions, reddit_comments, ig_comments, yt_comments,
        x_posts, tiktok_videos, tiktok_comments, influencer_x_posts.
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Callable

from ..core import supabase_client as sb
from ..core.logger import get_logger
from ..core.openai_client import call_openai
from ..core.settings import ENRICH_BATCH, ENRICH_WORKERS

log = get_logger("enrichment.ai")

TABLE_FIELD_OVERRIDES: dict[str, set[str]] = {
    "influencer_x_posts": {
        "sentiment_score", "sentiment_label", "topics",
        "brands_mentioned", "products_mentioned",
        "is_crisis", "is_opportunity", "purchase_intent_score",
    },
}

TABLES: list[tuple[str, str, str, Callable[[dict], str]]] = [
    ("reddit_mentions",    "id", "id,post_title,content_text",
     lambda r: (r.get("post_title") or "") + "\n" + (r.get("content_text") or "")),
    ("reddit_comments",    "id", "id,comment_text",
     lambda r: r.get("comment_text") or ""),
    ("ig_comments",        "id", "id,comment_text",
     lambda r: r.get("comment_text") or ""),
    ("yt_comments",        "id", "id,comment_text",
     lambda r: r.get("comment_text") or ""),
    ("x_posts",            "id", "id,text",
     lambda r: r.get("text") or ""),
    ("tiktok_videos",      "id", "id,text",
     lambda r: r.get("text") or ""),
    ("tiktok_comments",    "id", "id,comment_text",
     lambda r: r.get("comment_text") or ""),
    ("influencer_x_posts", "id", "id,text",
     lambda r: r.get("text") or ""),
    # product_reviews — added by migration 016. Combines title + body so
    # short titles still get sentiment + topic enrichment.
    ("product_reviews",    "id", "id,review_text,review_title",
     lambda r: ((r.get("review_title") or "") + "\n" + (r.get("review_text") or ""))),
]


def _process_row(table: str, row: dict, combine_fn: Callable, allow_switch: bool) -> str:
    text = combine_fn(row)
    if not text or len(text.strip()) < 3:
        sb.patch(table, row["id"], {"sentiment_label": "neutral",
                                    "enriched_at": datetime.utcnow().isoformat()})
        return "skipped"
    result = call_openai(text, allow_competitor_switch=allow_switch)
    if result is None:
        return "failed"
    allowed = TABLE_FIELD_OVERRIDES.get(table)
    if allowed is not None:
        result = {k: v for k, v in result.items() if k in allowed}
    result["enriched_at"] = datetime.utcnow().isoformat()
    return "ok" if sb.patch(table, row["id"], result) else "failed"


def enrich_table(table: str, id_col: str, select: str, combine_fn: Callable,
                 workers: int = ENRICH_WORKERS) -> int:
    log.info("[%s] starting enrichment", table)
    ok_count = skipped = failed = 0

    allow_switch = (table == "reddit_mentions")

    while True:
        rows = sb.get_filtered(table, select, f"enriched_at=is.null&limit={ENRICH_BATCH}")
        if not rows:
            break
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futures = {ex.submit(_process_row, table, r, combine_fn, allow_switch): r for r in rows}
            for fut in as_completed(futures):
                status = fut.result()
                if status == "ok":
                    ok_count += 1
                elif status == "skipped":
                    skipped += 1
                else:
                    failed += 1
                done = ok_count + skipped + failed
                if done % 50 == 0:
                    log.info("[%s] processed %d (ok=%d skip=%d fail=%d)", table, done, ok_count, skipped, failed)

    log.info("[%s] done: enriched=%d skipped=%d failed=%d", table, ok_count, skipped, failed)
    return ok_count


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    if dry_run:
        log.info("[DRY-RUN] would enrich %d tables", len(TABLES))
        return 0

    total = 0
    for table, id_col, select, combine_fn in TABLES:
        try:
            n = enrich_table(table, id_col, select, combine_fn)
            total += n
        except Exception as e:
            log.error("Enrichment failed for %s: %s", table, e)
    log.info("Total enriched: %d rows", total)
    return total
