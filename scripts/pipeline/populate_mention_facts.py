"""
JOOLA Intel — Cross-Channel Fact Populator
Reads enriched rows from every channel table and writes one normalized
`mention_facts` row per (channel, source, product/athlete). Also creates
`competitor_switch_events` rows for Reddit mentions that detected a brand
defection.

Run after `enrich_with_ai.py`. Idempotent — uses ON CONFLICT (channel,
source_id, brand_id, product_id) to avoid duplicates on re-runs.

Run: python scripts/pipeline/populate_mention_facts.py
"""

import os, sys
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from datetime import datetime
import requests

try:
    from dotenv import load_dotenv
    load_dotenv("scripts/.env")
    load_dotenv(".env.local")
except ImportError:
    pass

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://loecyghnkkxyymelgexz.supabase.co")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

SB_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",
}


# ─── Lookups ─────────────────────────────────────────────────────────────────

def load_brands() -> dict[str, str]:
    """slug → brand_id"""
    r = requests.get(f"{SUPABASE_URL}/rest/v1/brands?select=id,slug", headers=SB_HEADERS)
    r.raise_for_status()
    return {row["slug"]: row["id"] for row in r.json()}


def load_products() -> dict[str, str]:
    """lowercase alias → product_id (handles many aliases per product)"""
    r = requests.get(f"{SUPABASE_URL}/rest/v1/products_catalog?select=id,sku,aliases",
                     headers=SB_HEADERS)
    r.raise_for_status()
    alias_map: dict[str, str] = {}
    for row in r.json():
        alias_map[row["sku"].lower()] = row["id"]
        for alias in (row.get("aliases") or []):
            alias_map[alias.lower()] = row["id"]
    return alias_map


def load_athletes() -> dict[str, str]:
    """lowercase full name → influencer_id"""
    r = requests.get(f"{SUPABASE_URL}/rest/v1/influencers?select=id,name",
                     headers=SB_HEADERS)
    r.raise_for_status()
    return {row["name"].lower(): row["id"] for row in r.json() if row.get("name")}


# ─── Per-channel source table descriptors ────────────────────────────────────

SOURCES = [
    # (channel_name, table, select_columns, posted_at_col, country_col, snippet_fn)
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
     "text,posted_at,enriched_at",
     "posted_at", None,
     lambda r: (r.get("text") or "")[:280]),

    ("x_influencer", "influencer_x_posts",
     "id,brand_id,influencer_id,sentiment_score,sentiment_label,is_crisis,"
     "is_opportunity,purchase_intent_score,brands_mentioned,products_mentioned,"
     "text,posted_at,enriched_at",
     "posted_at", None,
     lambda r: (r.get("text") or "")[:280]),
]


# ─── Fact construction ───────────────────────────────────────────────────────

def fetch_enriched_unfacted(table: str, select: str, page_size: int = 500) -> list[dict]:
    """Pull ALL enriched rows for a table via offset pagination."""
    all_rows = []
    offset = 0
    while True:
        url = (f"{SUPABASE_URL}/rest/v1/{table}"
               f"?select={select}&enriched_at=not.is.null"
               f"&limit={page_size}&offset={offset}")
        r = requests.get(url, headers=SB_HEADERS, timeout=60)
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        all_rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return all_rows


def insert_facts(rows: list[dict]) -> int:
    """Plain INSERT — dedup is handled by clearing mention_facts per channel
    at the start of each populator run (see clear_channel_facts)."""
    if not rows:
        return 0
    url = f"{SUPABASE_URL}/rest/v1/mention_facts"
    headers = {**SB_HEADERS, "Prefer": "return=minimal"}
    headers.pop("Prefer", None)
    headers["Prefer"] = "return=minimal"
    inserted = 0
    for i in range(0, len(rows), 500):
        batch = rows[i:i + 500]
        r = requests.post(url, headers=headers, json=batch, timeout=30)
        if r.status_code in (200, 201, 204):
            inserted += len(batch)
        else:
            print(f"  ✗ insert mention_facts error {r.status_code}: {r.text[:300]}")
    return inserted


def clear_channel_facts(channel: str) -> None:
    """Delete all mention_facts for a channel before re-populating (idempotency)."""
    url = f"{SUPABASE_URL}/rest/v1/mention_facts?channel=eq.{channel}"
    headers = {k: v for k, v in SB_HEADERS.items() if k != "Prefer"}
    requests.delete(url, headers=headers, timeout=30)


def insert_switch_events(rows: list[dict]) -> int:
    if not rows:
        return 0
    url = f"{SUPABASE_URL}/rest/v1/competitor_switch_events"
    headers = {**SB_HEADERS, "Prefer": "return=minimal"}
    inserted = 0
    for i in range(0, len(rows), 500):
        batch = rows[i:i + 500]
        r = requests.post(url, headers=headers, json=batch, timeout=30)
        if r.status_code in (200, 201, 204):
            inserted += len(batch)
        else:
            print(f"  ✗ insert switch_events error {r.status_code}: {r.text[:300]}")
    return inserted


def build_facts_for_channel(channel: str, table: str, select: str,
                              posted_at_col: str, country_col: str | None,
                              snippet_fn,
                              brand_map: dict, product_map: dict,
                              athlete_map: dict) -> tuple[int, int]:
    # Wipe existing facts for this channel so re-runs are idempotent
    clear_channel_facts(channel)
    rows = fetch_enriched_unfacted(table, select)
    facts: list[dict] = []
    switches: list[dict] = []

    for r in rows:
        base_brand_id = r.get("brand_id")
        sentiment_score = r.get("sentiment_score")
        sentiment_label = r.get("sentiment_label")
        is_crisis      = bool(r.get("is_crisis"))
        is_opp         = bool(r.get("is_opportunity"))
        purchase_intent = (r.get("purchase_intent_score") or 0) >= 0.6
        country = r.get(country_col) if country_col else None

        # Expand brand_mentions: ensure brand_id at minimum, plus any LLM-detected brands
        brand_ids = set()
        if base_brand_id:
            brand_ids.add(base_brand_id)
        for slug in (r.get("brands_mentioned") or []):
            bid = brand_map.get((slug or "").lower())
            if bid:
                brand_ids.add(bid)
        if not brand_ids:
            continue

        # Resolve products
        product_ids = set()
        for p in (r.get("products_mentioned") or []):
            pid = product_map.get((p or "").lower())
            if pid:
                product_ids.add(pid)
        if not product_ids:
            product_ids.add(None)

        # Resolve athlete (only one per row from `influencer_id` if present)
        athlete_id = r.get("influencer_id")
        if not athlete_id:
            for ath in (r.get("players_mentioned") or []):
                aid = athlete_map.get((ath or "").lower())
                if aid:
                    athlete_id = aid
                    break

        is_switch = bool(channel == "reddit" and (r.get("competitor_switch_from")
                                                  or r.get("competitor_switch_to")))

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
                    "posted_at":            r.get(posted_at_col),
                })

        if channel == "reddit":
            f_slug = r.get("competitor_switch_from")
            t_slug = r.get("competitor_switch_to")
            if f_slug or t_slug:
                switches.append({
                    "mention_id":    None,  # we don't have the new fact id back
                    "from_brand_id": brand_map.get((f_slug or "").lower()),
                    "to_brand_id":   brand_map.get((t_slug or "").lower()),
                    "confidence":    0.8,
                    "text_snippet":  snippet_fn(r),
                    "posted_at":     r.get(posted_at_col),
                })

    f = insert_facts(facts)
    s = insert_switch_events(switches)
    return f, s


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    print("=" * 55, flush=True)
    print("JOOLA Intel — Mention Facts Populator", flush=True)
    print(f"Started: {datetime.utcnow().isoformat()}", flush=True)
    print("=" * 55, flush=True)

    print("Loading lookup maps…", flush=True)
    brand_map   = load_brands()
    product_map = load_products()
    athlete_map = load_athletes()
    print(f"  brands={len(brand_map)}, product-aliases={len(product_map)}, "
          f"athletes={len(athlete_map)}", flush=True)

    grand_facts = 0
    grand_switches = 0
    for entry in SOURCES:
        channel, table, select, posted_at_col, country_col, snippet_fn = entry
        try:
            f, s = build_facts_for_channel(channel, table, select,
                                            posted_at_col, country_col, snippet_fn,
                                            brand_map, product_map, athlete_map)
            print(f"  [{channel:14}] {f:5} facts, {s:3} switch events", flush=True)
            grand_facts += f
            grand_switches += s
        except Exception as e:
            print(f"  ✗ {channel}/{table}: {e}", flush=True)

    print(f"\n{'=' * 55}", flush=True)
    print(f"Done. {grand_facts} facts, {grand_switches} switch events.", flush=True)


if __name__ == "__main__":
    main()
