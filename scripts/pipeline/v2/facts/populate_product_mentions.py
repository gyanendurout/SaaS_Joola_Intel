"""Build product_mentions from all enriched textual tables.

For each (source_table, source_row), extract text → run alias matcher → write
one product_mentions row per (source_row × matched product).

Channel-weighted engagement_score is computed at write-time so the daily
rollup doesn't need to re-query source tables.

Resilient to missing tables (e.g. news_articles): each channel is wrapped
in try/except — missing tables log a warning and skip, never break the run.
"""

from __future__ import annotations

from typing import Any, Callable

from ..core import supabase_client as sb
from ..core.logger import get_logger
from ..sources.products.product_alias_matcher import match as match_products

log = get_logger("facts.product_mentions")

PER_CHANNEL_LIMIT = 2000  # rows scanned per channel per run

# Channel base weights (multiply the raw engagement before sentiment modifier)
CHANNEL_WEIGHTS = {
    "instagram": 1.8,
    "youtube":   2.5,
    "reddit":    1.5,
    "tiktok":    2.0,
    "twitter":   1.2,
    "influencer": 2.2,
    "ads":       0.6,
    "promotions": 0.8,
    "news":      1.4,
}


# ─── Per-channel adapters ────────────────────────────────────────────────────
# Each entry: (table, channel, select_cols, text_fn, engagement_fn, ts_col,
#              sentiment_col, purchase_intent_col, crisis_col)

def _txt(*cols: str) -> Callable[[dict], str]:
    def fn(r: dict) -> str:
        return " ".join(str(r.get(c) or "") for c in cols).strip()
    return fn


def _eng(formula: Callable[[dict], float]) -> Callable[[dict], float]:
    def fn(r: dict) -> float:
        try:
            return max(0.0, float(formula(r)))
        except Exception:
            return 0.0
    return fn


CHANNELS: list[tuple] = [
    # (table, channel, select, text_fn, eng_fn, ts_col, sentiment_col, purchase_intent_col, crisis_col)
    ("ig_posts", "instagram",
     "id,brand_id,caption,like_count,comment_count,view_count,sentiment_label,sentiment_score,purchase_intent_score,is_crisis,posted_at",
     _txt("caption"),
     _eng(lambda r: (r.get("like_count") or 0) + 2 * (r.get("comment_count") or 0) + (r.get("view_count") or 0) / 100),
     "posted_at", "sentiment_label", "purchase_intent_score", "is_crisis"),

    ("ig_comments", "instagram",
     "id,brand_id,comment_text,comment_likes,sentiment_label,sentiment_score,purchase_intent_score,is_crisis,posted_at",
     _txt("comment_text"),
     _eng(lambda r: (r.get("comment_likes") or 0) + 1),
     "posted_at", "sentiment_label", "purchase_intent_score", "is_crisis"),

    ("yt_videos", "youtube",
     "id,brand_id,title,description,view_count,like_count,comment_count,published_at",
     _txt("title", "description"),
     _eng(lambda r: (r.get("view_count") or 0) / 100 + (r.get("like_count") or 0) * 2 + (r.get("comment_count") or 0) * 3),
     "published_at", None, None, None),

    ("yt_comments", "youtube",
     "id,brand_id,comment_text,like_count,sentiment_label,sentiment_score,purchase_intent_score,is_crisis,posted_at",
     _txt("comment_text"),
     _eng(lambda r: (r.get("like_count") or 0) + 1),
     "posted_at", "sentiment_label", "purchase_intent_score", "is_crisis"),

    ("yt_video_analysis", "youtube",
     "id,video_id,brand_id,summary,products_mentioned,sentiment_label,sentiment_score,is_crisis,is_opportunity,view_count_at_analysis,enriched_at",
     _txt("summary"),
     _eng(lambda r: (r.get("view_count_at_analysis") or 0) / 100),
     "enriched_at", "sentiment_label", None, "is_crisis"),

    ("reddit_mentions", "reddit",
     "id,brand_id,post_title,content_text,upvotes,sentiment_label,sentiment_score,purchase_intent_score,is_crisis,posted_at",
     _txt("post_title", "content_text"),
     _eng(lambda r: (r.get("upvotes") or 0)),
     "posted_at", "sentiment_label", "purchase_intent_score", "is_crisis"),

    ("reddit_comments", "reddit",
     "id,brand_id,comment_text,upvotes,sentiment_label,sentiment_score,purchase_intent_score,is_crisis,posted_at",
     _txt("comment_text"),
     _eng(lambda r: (r.get("upvotes") or 0) + 1),
     "posted_at", "sentiment_label", "purchase_intent_score", "is_crisis"),

    ("x_posts", "twitter",
     "id,brand_id,text,like_count,retweet_count,reply_count,view_count,sentiment_label,sentiment_score,purchase_intent_score,is_crisis,posted_at",
     _txt("text"),
     _eng(lambda r: (r.get("like_count") or 0) + 3 * (r.get("retweet_count") or 0) + (r.get("reply_count") or 0) + (r.get("view_count") or 0) / 1000),
     "posted_at", "sentiment_label", "purchase_intent_score", "is_crisis"),

    ("tiktok_videos", "tiktok",
     "id,brand_id,description,view_count,like_count,comment_count,share_count,sentiment_label,sentiment_score,purchase_intent_score,is_crisis,posted_at",
     _txt("description"),
     _eng(lambda r: (r.get("view_count") or 0) / 100 + (r.get("like_count") or 0) * 2 + (r.get("comment_count") or 0) * 3 + (r.get("share_count") or 0) * 4),
     "posted_at", "sentiment_label", "purchase_intent_score", "is_crisis"),

    ("influencer_posts", "influencer",
     "id,brand_id,caption,like_count,comment_count,is_sponsored,posted_at",
     _txt("caption"),
     _eng(lambda r: ((r.get("like_count") or 0) + 2 * (r.get("comment_count") or 0)) * 1.5),
     "posted_at", None, None, None),

    ("influencer_x_posts", "influencer",
     "id,brand_id,text,like_count,retweet_count,reply_count,posted_at",
     _txt("text"),
     _eng(lambda r: ((r.get("like_count") or 0) + 3 * (r.get("retweet_count") or 0)) * 1.5),
     "posted_at", None, None, None),

    ("marketing_ads", "ads",
     "id,brand_id,body,page_name,is_active,started_at",
     _txt("body", "page_name"),
     _eng(lambda r: 50.0 if r.get("is_active") else 10.0),
     "started_at", None, None, None),

    ("promotions", "promotions",
     "id,brand_id,banner_text,detected_at",
     _txt("banner_text"),
     _eng(lambda r: 75.0),
     "detected_at", None, None, None),

    # news_articles is conditional — wrapped in try/except below
    ("news_articles", "news",
     "id,brand_id,title,description,ai_summary,sentiment_label,sentiment_score,published_at",
     _txt("title", "description", "ai_summary"),
     _eng(lambda r: 60.0),
     "published_at", "sentiment_label", None, None),
]


def _sentiment_modifier(label: str | None) -> float:
    return {
        "very_positive": 1.4,
        "positive":      1.2,
        "neutral":       1.0,
        "negative":      0.8,
        "very_negative": 0.6,
    }.get((label or "").lower(), 1.0)


def _row_for_mention(
    *, source_table: str, channel: str, source_row: dict, hit: dict,
    text: str, raw_engagement: float, sentiment_col: str | None,
    purchase_intent_col: str | None, crisis_col: str | None, ts_col: str,
) -> dict:
    sentiment = source_row.get(sentiment_col) if sentiment_col else None
    sentiment_score = source_row.get("sentiment_score")
    weighted_engagement = (
        raw_engagement * CHANNEL_WEIGHTS.get(channel, 1.0) * _sentiment_modifier(sentiment)
    )
    pi_score = source_row.get(purchase_intent_col) if purchase_intent_col else None
    is_pi = bool(pi_score and float(pi_score) >= 0.5)
    is_crisis = bool(source_row.get(crisis_col)) if crisis_col else False

    raw_engagement_obj = {
        k: source_row.get(k) for k in (
            "view_count", "like_count", "comment_count", "share_count",
            "upvotes", "retweet_count", "reply_count", "comment_likes",
        ) if source_row.get(k) is not None
    }

    return {
        "product_id":         hit["product_id"],
        "brand_id":           hit["brand_id"] or source_row.get("brand_id"),
        "source_table":       source_table,
        "source_row_id":      source_row["id"],
        "channel":            channel,
        "matched_alias":      hit["alias"],
        "matched_alias_norm": hit["alias_norm"],
        "match_confidence":   hit["confidence"],
        "sentiment_label":    sentiment,
        "sentiment_score":    sentiment_score,
        "is_purchase_intent": is_pi,
        "is_crisis":          is_crisis,
        "engagement_score":   round(weighted_engagement, 2),
        "raw_engagement":     raw_engagement_obj or None,
        "occurred_at":        source_row.get(ts_col),
    }


def _process_channel(adapter: tuple, brand_filter_ids: set[str] | None,
                     limit: int, dry_run: bool) -> int:
    (table, channel, select, text_fn, eng_fn, ts_col,
     sentiment_col, purchase_intent_col, crisis_col) = adapter

    try:
        rows = sb.get_filtered(
            table, select,
            f"order={ts_col}.desc.nullslast&limit={limit}",
        )
    except Exception as e:
        log.warning("Skipping %s: %s", table, str(e)[:200])
        return 0

    if not rows:
        return 0

    out: list[dict] = []
    matched_rows = 0
    for r in rows:
        if brand_filter_ids and r.get("brand_id") not in brand_filter_ids:
            continue
        text = text_fn(r)
        if not text:
            continue
        hits = match_products(text, hint_brand_id=r.get("brand_id"))
        if not hits:
            continue
        matched_rows += 1
        raw_engagement = eng_fn(r)
        for hit in hits:
            out.append(_row_for_mention(
                source_table=table, channel=channel, source_row=r, hit=hit,
                text=text, raw_engagement=raw_engagement,
                sentiment_col=sentiment_col,
                purchase_intent_col=purchase_intent_col,
                crisis_col=crisis_col, ts_col=ts_col,
            ))

    if dry_run:
        log.info("[DRY-RUN] %s: %d source rows matched, %d mention rows would be written",
                 table, matched_rows, len(out))
        return 0

    if not out:
        log.info("%s: 0 mentions found in %d rows scanned", table, len(rows))
        return 0

    n = sb.upsert("product_mentions", out, "source_table,source_row_id,product_id")
    log.info("%s: %d rows scanned, %d matched, %d mentions upserted",
             table, len(rows), matched_rows, n)
    return n


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")
    limit_override: int | None = ctx.get("limit")

    brand_filter_ids: set[str] | None = None
    if brand_filter:
        brand_rows = sb.get("brands", "id,slug")
        brand_filter_ids = {r["id"] for r in brand_rows if r["slug"] in brand_filter}

    per_channel_limit = limit_override or PER_CHANNEL_LIMIT
    total = 0
    for adapter in CHANNELS:
        total += _process_channel(adapter, brand_filter_ids, per_channel_limit, dry_run)

    log.info("✓ %d total product mentions upserted across %d channels", total, len(CHANNELS))
    return total
