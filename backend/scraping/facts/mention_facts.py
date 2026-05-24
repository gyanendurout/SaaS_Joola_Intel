"""Populate mention_facts table from enriched channel tables.

Matches the live Supabase schema:
  mention_facts(channel, source_table, source_id, brand_id, product_id, athlete_id,
                sentiment_score, sentiment_label, is_crisis, is_opportunity,
                is_purchase_intent, is_competitor_switch, country_code,
                text_snippet, posted_at, created_at)

NOTE: mention_facts has NO topics / brands_mentioned / players_mentioned /
products_mentioned arrays — those live on the source-channel rows. This module
EXPANDS each source row into one mention_facts row per (brand × product).

Idempotent via clear-before-insert per channel.
"""

from __future__ import annotations

from typing import Any, Callable

from ..core import supabase_client as sb
from ..core.logger import get_logger
from ..core.network import http_request
from ..core.settings import require_supabase

log = get_logger("facts.mentions")

PURCHASE_INTENT_THRESHOLD = 0.6


# (channel, table, select_cols, ts_col, country_col, snippet_fn)
SOURCES: list[tuple] = [
    ("reddit", "reddit_mentions",
     "id,brand_id,sentiment_score,sentiment_label,is_crisis,is_opportunity,"
     "purchase_intent_score,brands_mentioned,players_mentioned,products_mentioned,"
     "competitor_switch_from,competitor_switch_to,country_code,post_title,"
     "content_text,posted_at,enriched_at",
     "posted_at", "country_code",
     lambda r: ((r.get("post_title") or "") + " — " + (r.get("content_text") or ""))[:280]),

    ("reddit_comment", "reddit_comments",
     "id,brand_id,sentiment_score,sentiment_label,is_crisis,is_opportunity,"
     "purchase_intent_score,brands_mentioned,players_mentioned,products_mentioned,"
     "competitor_switch_from,competitor_switch_to,comment_text,posted_at,enriched_at",
     "posted_at", None,
     lambda r: (r.get("comment_text") or "")[:280]),

    ("ig_comment", "ig_comments",
     "id,brand_id,sentiment_score,sentiment_label,is_crisis,is_opportunity,"
     "purchase_intent_score,brands_mentioned,players_mentioned,products_mentioned,"
     "comment_text,posted_at,enriched_at",
     "posted_at", None,
     lambda r: (r.get("comment_text") or "")[:280]),

    ("yt_comment", "yt_comments",
     "id,brand_id,sentiment_score,sentiment_label,is_crisis,is_opportunity,"
     "purchase_intent_score,brands_mentioned,players_mentioned,products_mentioned,"
     "comment_text,posted_at,enriched_at",
     "posted_at", None,
     lambda r: (r.get("comment_text") or "")[:280]),

    ("x", "x_posts",
     "id,brand_id,sentiment_score,sentiment_label,is_crisis,is_opportunity,"
     "purchase_intent_score,brands_mentioned,players_mentioned,products_mentioned,"
     "text,posted_at,enriched_at",
     "posted_at", None,
     lambda r: (r.get("text") or "")[:280]),

    ("tiktok", "tiktok_videos",
     "id,brand_id,sentiment_score,sentiment_label,is_crisis,is_opportunity,"
     "purchase_intent_score,brands_mentioned,players_mentioned,products_mentioned,"
     "description,posted_at,enriched_at",
     "posted_at", None,
     lambda r: (r.get("description") or "")[:280]),

    ("x_influencer", "influencer_x_posts",
     "id,brand_id,influencer_id,sentiment_score,sentiment_label,is_crisis,"
     "is_opportunity,purchase_intent_score,brands_mentioned,products_mentioned,"
     "text,posted_at,enriched_at",
     "posted_at", None,
     lambda r: (r.get("text") or "")[:280]),
]


def _fetch_enriched(table: str, select: str, page_size: int = 500) -> list[dict]:
    """Paginated fetch of enriched rows."""
    out: list[dict] = []
    offset = 0
    while True:
        try:
            page = sb.get_filtered(
                table, select,
                f"enriched_at=not.is.null&limit={page_size}&offset={offset}",
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


def _clear_channel_facts(channel: str) -> None:
    """Delete all mention_facts for a channel before re-populating (idempotency)."""
    url, key = require_supabase()
    hdrs = {"apikey": key, "Authorization": f"Bearer {key}"}
    try:
        http_request("DELETE", f"{url}/rest/v1/mention_facts?channel=eq.{channel}",
                     headers=hdrs, timeout=30)
    except Exception as e:
        log.warning("clear %s mention_facts failed: %s", channel, e)


def _insert_facts(rows: list[dict]) -> int:
    if not rows:
        return 0
    return sb.upsert("mention_facts", rows, "channel,source_table,source_id,brand_id,product_id")


def _insert_switch_events(rows: list[dict]) -> int:
    if not rows:
        return 0
    return sb.upsert("competitor_switch_events", rows, "posted_at,from_brand_id,to_brand_id")


def _build_for_channel(
    channel: str, table: str, select: str, ts_col: str, country_col: str | None,
    snippet_fn: Callable[[dict], str],
    brand_map: dict[str, str], product_map: dict[str, str], athlete_map: dict[str, str],
    brand_filter_ids: set[str] | None,
) -> tuple[int, int]:
    _clear_channel_facts(channel)
    rows = _fetch_enriched(table, select)

    facts: list[dict] = []
    switches: list[dict] = []

    for r in rows:
        base_brand_id = r.get("brand_id")
        if brand_filter_ids and base_brand_id not in brand_filter_ids:
            continue

        sentiment_score = r.get("sentiment_score")
        sentiment_label = r.get("sentiment_label")
        is_crisis = bool(r.get("is_crisis"))
        is_opp = bool(r.get("is_opportunity"))
        purchase_intent = (r.get("purchase_intent_score") or 0) >= PURCHASE_INTENT_THRESHOLD
        country = r.get(country_col) if country_col else None

        # Expand brand_mentions: ensure base brand_id at minimum, plus LLM-detected brands
        brand_ids: set[str] = set()
        if base_brand_id:
            brand_ids.add(base_brand_id)
        for slug in (r.get("brands_mentioned") or []):
            bid = brand_map.get((slug or "").lower())
            if bid:
                brand_ids.add(bid)
        if not brand_ids:
            continue

        # Resolve products via alias map (lowercase display_name OR alias text → product_id)
        product_ids: set[str | None] = set()
        for p in (r.get("products_mentioned") or []):
            pid = product_map.get((p or "").lower())
            if pid:
                product_ids.add(pid)
        if not product_ids:
            product_ids.add(None)

        # Resolve athlete (one per row, from influencer_id if available, else first match)
        athlete_id = r.get("influencer_id")
        if not athlete_id:
            for ath in (r.get("players_mentioned") or []):
                aid = athlete_map.get((ath or "").lower())
                if aid:
                    athlete_id = aid
                    break

        is_switch = bool(
            channel == "reddit" and (r.get("competitor_switch_from") or r.get("competitor_switch_to"))
        )

        for bid in brand_ids:
            for pid in product_ids:
                facts.append({
                    "channel":              channel,
                    "source_table":         table,
                    "source_id":            r["id"],
                    "brand_id":             bid,
                    "product_id":           pid,
                    "athlete_id":           athlete_id,
                    "sentiment_score":      sentiment_score,
                    "sentiment_label":      sentiment_label,
                    "is_crisis":            is_crisis,
                    "is_opportunity":       is_opp,
                    "is_purchase_intent":   purchase_intent,
                    "is_competitor_switch": is_switch,
                    "country_code":         country,
                    "text_snippet":         snippet_fn(r),
                    "posted_at":            r.get(ts_col),
                })

        if channel == "reddit":
            f_slug = r.get("competitor_switch_from")
            t_slug = r.get("competitor_switch_to")
            if f_slug or t_slug:
                switches.append({
                    "from_brand_id": brand_map.get((f_slug or "").lower()),
                    "to_brand_id":   brand_map.get((t_slug or "").lower()),
                    "confidence":    0.8,
                    "text_snippet":  snippet_fn(r),
                    "posted_at":     r.get(ts_col),
                })

    return _insert_facts(facts), _insert_switch_events(switches)


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}

    # Product map: lowercase display_name + every alias text → product_id
    product_rows = sb.get("products_catalog", "id,sku,display_name,aliases")
    product_map: dict[str, str] = {}
    for row in product_rows:
        if row.get("sku"):
            product_map[row["sku"].lower()] = row["id"]
        if row.get("display_name"):
            product_map[row["display_name"].lower()] = row["id"]
        for alias in (row.get("aliases") or []):
            if alias:
                product_map[alias.lower()] = row["id"]

    # Athlete map: lowercase name → influencer_id
    athlete_rows = sb.get("influencers", "id,name")
    athlete_map = {r["name"].lower(): r["id"] for r in athlete_rows if r.get("name")}

    brand_filter_ids: set[str] | None = None
    if brand_filter:
        brand_filter_ids = {bid for slug, bid in brand_map.items() if slug in brand_filter}

    if dry_run:
        log.info("[DRY-RUN] would build mention_facts from %d channels", len(SOURCES))
        return 0

    total_facts = total_switches = 0
    for channel, table, select, ts_col, country_col, snippet_fn in SOURCES:
        try:
            f, s = _build_for_channel(
                channel, table, select, ts_col, country_col, snippet_fn,
                brand_map, product_map, athlete_map, brand_filter_ids,
            )
            log.info("[%s] %d facts, %d switch_events", channel, f, s)
            total_facts += f
            total_switches += s
        except Exception as e:
            log.warning("channel %s failed: %s", channel, str(e)[:200])

    log.info("✓ %d total mention_facts, %d competitor_switch_events upserted",
             total_facts, total_switches)
    return total_facts
