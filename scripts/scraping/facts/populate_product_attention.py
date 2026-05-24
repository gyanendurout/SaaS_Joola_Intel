"""Roll up product_mentions → product_attention_daily and product_attention_summary.

Daily: aggregate by (product_id, occurred_date). Channel-weighted attention_score
is already baked into each mention's engagement_score, so daily sum is direct.

Summary: roll daily rows into 4 period buckets (last_7d, last_30d, last_90d, all_time)
with rank_in_brand, rank_overall, and joola_vs_competitor_gap.

Sales-likelihood is computed separately and kept distinct from any sales
estimation in sales_facts_daily — this is a SIGNAL, not confirmed sales.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from ..core import supabase_client as sb
from ..core.logger import get_logger
from ..core.settings import JOOLA_BRAND_ID

log = get_logger("facts.product_attention")

LOOKBACK_DAYS = 120  # how far back daily rollup recomputes
MENTION_BATCH = 10000  # rows per get_filtered page

PERIODS = [
    ("last_7d",  7),
    ("last_30d", 30),
    ("last_90d", 90),
    ("all_time", None),
]


# ─── Daily rollup ────────────────────────────────────────────────────────────

def _channel_count_field(channel: str) -> str:
    """Map channel slug to mentions_<channel> column name."""
    return {
        "instagram":  "mentions_instagram",
        "youtube":    "mentions_youtube",
        "reddit":     "mentions_reddit",
        "tiktok":     "mentions_tiktok",
        "twitter":    "mentions_twitter",
        "influencer": "mentions_influencer",
        "ads":        "mentions_ads",
        "promotions": "mentions_promotions",
        "news":       "mentions_news",
    }.get(channel, "")


def _sales_likelihood(d: dict) -> tuple[float, dict]:
    """Compute 0..100 sales-likelihood score from a daily aggregate.

    NOT a sales forecast — it's a signal that combines purchase-intent volume,
    attention score, sentiment positivity, with a crisis penalty.
    """
    pi  = d["purchase_intent_count"]
    att = float(d["attention_score"])
    pos = d["positive_mentions"]
    neg = d["negative_mentions"]
    cri = d["crisis_mentions"]
    total = max(1, d["mentions_total"])

    pos_share = pos / total
    neg_share = (neg + cri) / total

    raw = (
        pi  * 8.0
        + att / 50.0
        + pos_share * 12.0
        - neg_share * 8.0
        - cri * 5.0
    )
    score = max(0.0, min(100.0, raw))
    inputs = {
        "purchase_intent_count": pi,
        "attention_score":       round(att, 2),
        "positive_share":        round(pos_share, 3),
        "negative_share":        round(neg_share, 3),
        "crisis_count":          cri,
    }
    return round(score, 3), inputs


def _run_daily(brand_filter_ids: set[str] | None, dry_run: bool) -> int:
    cutoff = (date.today() - timedelta(days=LOOKBACK_DAYS)).isoformat()

    rows: list[dict] = []
    offset = 0
    while True:
        page = sb.get_filtered(
            "product_mentions",
            "product_id,brand_id,channel,occurred_date,engagement_score,sentiment_label,"
            "is_purchase_intent,is_crisis",
            f"occurred_date=gte.{cutoff}&order=occurred_date.desc&limit={MENTION_BATCH}&offset={offset}",
        )
        if not page:
            break
        rows.extend(page)
        if len(page) < MENTION_BATCH:
            break
        offset += MENTION_BATCH

    if not rows:
        log.info("No product_mentions in last %d days", LOOKBACK_DAYS)
        return 0

    # Group by (product_id, occurred_date)
    by_key: dict[tuple[str, str], dict] = {}
    for r in rows:
        if not r.get("product_id") or not r.get("occurred_date"):
            continue
        if brand_filter_ids and r.get("brand_id") not in brand_filter_ids:
            continue

        key = (r["product_id"], r["occurred_date"])
        agg = by_key.setdefault(key, {
            "product_id":            r["product_id"],
            "brand_id":              r.get("brand_id"),
            "attention_date":        r["occurred_date"],
            "mentions_total":        0,
            "mentions_instagram":    0, "mentions_youtube":   0, "mentions_reddit":  0,
            "mentions_tiktok":       0, "mentions_twitter":   0, "mentions_influencer": 0,
            "mentions_ads":          0, "mentions_promotions": 0, "mentions_news":   0,
            "attention_score":       0.0,
            "positive_mentions":     0, "neutral_mentions":  0, "negative_mentions": 0,
            "purchase_intent_count": 0, "crisis_mentions":   0,
        })
        agg["mentions_total"] += 1
        agg["attention_score"] += float(r.get("engagement_score") or 0)

        channel_field = _channel_count_field(r.get("channel") or "")
        if channel_field:
            agg[channel_field] += 1

        sent = (r.get("sentiment_label") or "").lower()
        if sent in ("positive", "very_positive"):
            agg["positive_mentions"] += 1
        elif sent in ("negative", "very_negative"):
            agg["negative_mentions"] += 1
        elif sent == "neutral":
            agg["neutral_mentions"] += 1

        if r.get("is_purchase_intent"):
            agg["purchase_intent_count"] += 1
        if r.get("is_crisis"):
            agg["crisis_mentions"] += 1

    # Finalise with sales_likelihood
    daily_rows: list[dict] = []
    for agg in by_key.values():
        agg["attention_score"] = round(agg["attention_score"], 2)
        score, inputs = _sales_likelihood(agg)
        agg["sales_likelihood_score"]  = score
        agg["sales_likelihood_inputs"] = inputs
        daily_rows.append(agg)

    if dry_run:
        log.info("[DRY-RUN] would upsert %d product_attention_daily rows", len(daily_rows))
        return 0

    n = sb.upsert("product_attention_daily", daily_rows, "product_id,attention_date")
    log.info("✓ %d product_attention_daily rows upserted", n)
    return n


# ─── Period summary rollup ───────────────────────────────────────────────────

def _run_summary(brand_filter_ids: set[str] | None, dry_run: bool) -> int:
    today = date.today()

    # Load all daily rows we just wrote (last 120 days is plenty for all 4 buckets)
    cutoff = (today - timedelta(days=LOOKBACK_DAYS)).isoformat()
    daily_rows: list[dict] = []
    offset = 0
    while True:
        page = sb.get_filtered(
            "product_attention_daily",
            "product_id,brand_id,attention_date,mentions_total,attention_score,"
            "positive_mentions,negative_mentions,purchase_intent_count,crisis_mentions,"
            "sales_likelihood_score",
            f"attention_date=gte.{cutoff}&limit={MENTION_BATCH}&offset={offset}",
        )
        if not page:
            break
        daily_rows.extend(page)
        if len(page) < MENTION_BATCH:
            break
        offset += MENTION_BATCH

    if not daily_rows:
        log.info("No product_attention_daily rows; nothing to summarize")
        return 0

    summary_rows: list[dict] = []
    for period_name, days in PERIODS:
        if days is not None:
            period_start = today - timedelta(days=days)
            scope = [r for r in daily_rows if r["attention_date"] >= period_start.isoformat()]
        else:
            period_start = None
            scope = daily_rows

        # Aggregate per product
        by_product: dict[str, dict] = {}
        for r in scope:
            pid = r["product_id"]
            if brand_filter_ids and r.get("brand_id") not in brand_filter_ids:
                continue
            agg = by_product.setdefault(pid, {
                "product_id":             pid,
                "brand_id":               r.get("brand_id"),
                "period":                 period_name,
                "period_start":           period_start.isoformat() if period_start else None,
                "period_end":             today.isoformat(),
                "mentions_total":         0,
                "attention_score":        0.0,
                "positive_mentions":      0,
                "negative_mentions":      0,
                "purchase_intent_count":  0,
                "crisis_mentions":        0,
                "sales_likelihood_score": 0.0,
                "_sl_count":              0,
            })
            agg["mentions_total"]        += r.get("mentions_total") or 0
            agg["attention_score"]       += float(r.get("attention_score") or 0)
            agg["positive_mentions"]     += r.get("positive_mentions") or 0
            agg["negative_mentions"]     += r.get("negative_mentions") or 0
            agg["purchase_intent_count"] += r.get("purchase_intent_count") or 0
            agg["crisis_mentions"]       += r.get("crisis_mentions") or 0
            sl = r.get("sales_likelihood_score")
            if sl is not None:
                agg["sales_likelihood_score"] += float(sl)
                agg["_sl_count"] += 1

        # Mean sales-likelihood across the period
        for agg in by_product.values():
            n = agg.pop("_sl_count")
            if n:
                agg["sales_likelihood_score"] = round(agg["sales_likelihood_score"] / n, 3)
            else:
                agg["sales_likelihood_score"] = 0.0
            agg["attention_score"] = round(agg["attention_score"], 2)

        # Ranks: overall and per-brand
        all_sorted = sorted(by_product.values(), key=lambda x: x["attention_score"], reverse=True)
        for i, agg in enumerate(all_sorted, start=1):
            agg["rank_overall"] = i

        by_brand: dict[str, list[dict]] = defaultdict(list)
        for agg in by_product.values():
            by_brand[agg.get("brand_id") or "_none"].append(agg)
        for bid, lst in by_brand.items():
            lst.sort(key=lambda x: x["attention_score"], reverse=True)
            for i, agg in enumerate(lst, start=1):
                agg["rank_in_brand"] = i

        # JOOLA-vs-competitor gap: top JOOLA score minus each competitor
        joola_lst = by_brand.get(JOOLA_BRAND_ID, [])
        top_joola_score = joola_lst[0]["attention_score"] if joola_lst else 0.0
        for agg in by_product.values():
            if agg.get("brand_id") == JOOLA_BRAND_ID:
                agg["joola_vs_competitor_gap"] = None
            else:
                agg["joola_vs_competitor_gap"] = round(top_joola_score - agg["attention_score"], 2)

        summary_rows.extend(by_product.values())

    if dry_run:
        log.info("[DRY-RUN] would upsert %d product_attention_summary rows across %d periods",
                 len(summary_rows), len(PERIODS))
        return 0

    n = sb.upsert("product_attention_summary", summary_rows, "product_id,period")
    log.info("✓ %d product_attention_summary rows upserted (across %d periods)",
             n, len(PERIODS))
    return n


# ─── Module entry point ──────────────────────────────────────────────────────

def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_filter_ids: set[str] | None = None
    if brand_filter:
        brand_rows = sb.get("brands", "id,slug")
        brand_filter_ids = {r["id"] for r in brand_rows if r["slug"] in brand_filter}

    daily   = _run_daily(brand_filter_ids, dry_run)
    summary = _run_summary(brand_filter_ids, dry_run)
    return daily + summary
