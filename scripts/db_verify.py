"""
DB Cross-Verification -- checks today's data freshness across all pipeline tables.
Run from repo root: python scripts/db_verify.py
"""

from __future__ import annotations

import os
import sys
import datetime as dt
from pathlib import Path

try:
    from dotenv import load_dotenv
    root = Path(__file__).resolve().parents[1]
    load_dotenv(root / ".env")
    load_dotenv(root / "scripts" / ".env")
    load_dotenv(root / ".env.local")
except ImportError:
    pass

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://loecyghnkkxyymelgexz.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_KEY:
    sys.exit("ERROR: SUPABASE_SERVICE_ROLE_KEY not set")

TODAY = dt.date.today().isoformat()
TODAY_DT = dt.date.today()
YESTERDAY = (TODAY_DT - dt.timedelta(days=1)).isoformat()

# GET-only headers — no Content-Type (avoids server rejections on GET)
HDRS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}


def _url(table: str, select: str = "*", filters: str = "", limit: int = 1, order: str = "") -> str:
    u = f"{SUPABASE_URL}/rest/v1/{table}?select={select}&limit={limit}"
    if filters:
        u += f"&{filters}"
    if order:
        u += f"&order={order}"
    return u


def row_count(table: str, filters: str = "") -> int | str:
    """Return exact row count using Prefer: count=exact (HEAD request)."""
    u = f"{SUPABASE_URL}/rest/v1/{table}?select=*"
    if filters:
        u += f"&{filters}"
    try:
        resp = requests.head(u, headers={**HDRS, "Prefer": "count=exact"}, timeout=20)
    except Exception as e:
        return f"TIMEOUT"
    if resp.status_code not in (200, 206):
        return f"ERR({resp.status_code})"
    ct = resp.headers.get("content-range", "")
    # content-range: 0-0/1234  or  */1234  or  0-0/*
    if "/" in ct:
        raw = ct.split("/")[1]
        if raw.isdigit():
            return int(raw)
        return 0
    return 0


def max_val(table: str, col: str, filters: str = "") -> str:
    """Return max value of col, or latest row ordered desc."""
    u = _url(table, col, filters, limit=1, order=f"{col}.desc.nullslast")
    try:
        resp = requests.get(u, headers=HDRS, timeout=20)
    except Exception:
        return "TIMEOUT"
    if resp.status_code != 200:
        return f"ERR({resp.status_code})"
    rows = resp.json()
    if not rows:
        return "(none)"
    val = rows[0].get(col)
    return str(val)[:19] if val else "(null)"


def sample_cols(table: str) -> list[str]:
    """Return column names from one row (for schema discovery)."""
    u = _url(table, "*", limit=1)
    try:
        resp = requests.get(u, headers=HDRS, timeout=10)
    except Exception:
        return []
    if resp.status_code != 200:
        return []
    rows = resp.json()
    return list(rows[0].keys()) if rows else []


# ── Display ───────────────────────────────────────────────────────────────────
W = 64

def hdr(title: str):
    print(f"\n{'-'*W}")
    print(f"  {title}")
    print(f"{'-'*W}")

def chk(label: str, val, want_positive: bool = True, note: str = ""):
    if isinstance(val, str) and (val.startswith("ERR") or val == "TIMEOUT"):
        sym = "[!!]"
    elif isinstance(val, int) and val == 0 and want_positive:
        sym = "[--]"
    elif isinstance(val, int) and val > 0 and not want_positive:
        sym = "[!!]"
    else:
        sym = "[OK]"
    suffix = f"  | {note}" if note else ""
    print(f"  {sym}  {label:<44} {val}{suffix}")

def inf(label: str, val: str):
    print(f"       {label:<42} {val}")


# ─────────────────────────────────────────────────────────────────────────────
print(f"\n{'='*W}")
print(f"  JOOLA Intel -- DB Cross-Verification")
print(f"  TODAY: {TODAY}  (yesterday: {YESTERDAY})")
print(f"{'='*W}")
print("  [OK]=expected  [--]=zero/unexpected  [!!]=error or bad state")

# ════════════════════════════════════════════════════════════════════
hdr("P1 -- SCRAPING  (social content)")

# Social posts: most scraped yesterday (pipeline ran before midnight UTC)
# So we check >=yesterday as "fresh"

for tbl, col, label in [
    ("ig_posts",         "posted_at",   "ig_posts"),
    ("ig_comments",      "posted_at",   "ig_comments"),
    ("yt_videos",        "posted_at",   "yt_videos"),
    ("yt_comments",      "posted_at",   "yt_comments"),
    ("reddit_mentions",  "posted_at",   "reddit_mentions"),
    ("reddit_comments",  "posted_at",   "reddit_comments"),
    ("x_posts",          "posted_at",   "x_posts"),
    ("tiktok_videos",    "posted_at",   "tiktok_videos"),
    ("tiktok_comments",  "posted_at",   "tiktok_comments"),
    ("influencer_posts", "posted_at",   "influencer_posts"),
    ("influencer_x_posts","posted_at",  "influencer_x_posts"),
]:
    latest = max_val(tbl, col)
    total = row_count(tbl)
    fresh = "STALE" if latest < YESTERDAY[:10] and latest not in ("(none)", "(null)") else "fresh"
    print(f"  ---  {label:<30} total={total:>6}   latest: {latest}  [{fresh}]")

# Ads
print()
total = row_count("marketing_ads")
latest = max_val("marketing_ads", "detected_at")
inf("marketing_ads total", f"{total}   latest detected_at: {latest}")

# Promotions
total = row_count("promotions")
latest = max_val("promotions", "detected_at")
inf("promotions total", f"{total}   latest detected_at: {latest}")

# Inventory / crawl4ai
total = row_count("inventory_events")
latest = max_val("inventory_events", "event_time")
chk("inventory_events (crawl4ai)", total, want_positive=True)
inf("latest event_time", latest)

# Products catalog
total = row_count("products_catalog")
inf("products_catalog total", str(total))

# ════════════════════════════════════════════════════════════════════
hdr("P2 -- ENRICHMENT  (AI sentiment / NER / crisis flags)")

for tbl, label in [
    ("ig_comments",       "ig_comments"),
    ("reddit_mentions",   "reddit_mentions"),
    ("reddit_comments",   "reddit_comments"),
    ("x_posts",           "x_posts"),
    ("tiktok_comments",   "tiktok_comments"),
    ("influencer_posts",  "influencer_posts"),
    ("influencer_x_posts","influencer_x_posts"),
]:
    enriched   = row_count(tbl, "enriched_at=not.is.null")
    unenriched = row_count(tbl, "enriched_at=is.null")
    latest_e   = max_val(tbl, "enriched_at")
    chk(f"{label} enriched", enriched, want_positive=True)
    chk(f"{label} NOT enriched (want 0)", unenriched, want_positive=False)
    inf("latest enriched_at", latest_e)

# YouTube video analysis
yt_analyzed = row_count("yt_video_analysis")
yt_total    = row_count("yt_videos")
latest_yt   = max_val("yt_video_analysis", "analyzed_at")
chk("yt_video_analysis rows", yt_analyzed, want_positive=True)
inf(f"vs yt_videos total ({yt_total})", f"latest analyzed_at: {latest_yt}")

# ════════════════════════════════════════════════════════════════════
hdr("P3 -- FACTS")

# mention_facts uses posted_at (from source mention)
total_mf = row_count("mention_facts")
latest_mf = max_val("mention_facts", "posted_at")
chk("mention_facts total", total_mf, want_positive=True)
inf("latest posted_at", latest_mf)

# Fresh mention_facts = posted_at >= yesterday
fresh_mf = row_count("mention_facts", f"posted_at=gte.{YESTERDAY}")
inf(f"mention_facts with posted_at >= {YESTERDAY}", str(fresh_mf))

# topic_lifecycle
total_tl = row_count("topic_lifecycle")
latest_tl = max_val("topic_lifecycle", "first_seen_at")
chk("topic_lifecycle total", total_tl, want_positive=True)
inf("latest first_seen_at", latest_tl)

# product_attention_daily
total_pa = row_count("product_attention_daily")
latest_pa = max_val("product_attention_daily", "attention_date")
chk("product_attention_daily total", total_pa, want_positive=True)
inf("latest attention_date", latest_pa)

# competitor_switch_events
total_cs = row_count("competitor_switch_events")
latest_cs = max_val("competitor_switch_events", "posted_at")
chk("competitor_switch_events total", total_cs, want_positive=False)
inf("latest posted_at", latest_cs)

# product_mentions
total_pm = row_count("product_mentions")
latest_pm = max_val("product_mentions", "created_at")
chk("product_mentions total", total_pm, want_positive=True)
inf("latest created_at", latest_pm)

# ════════════════════════════════════════════════════════════════════
hdr("P4 -- SALES INTEL")

# sales_estimates
se_today  = row_count("sales_estimates", f"estimate_date=eq.{TODAY}")
se_total  = row_count("sales_estimates")
latest_se = max_val("sales_estimates", "estimate_date")
chk("sales_estimates today", se_today, want_positive=True)
inf(f"total rows / latest estimate_date", f"{se_total} / {latest_se}")

# sales_facts_daily
sf_today  = row_count("sales_facts_daily", f"date=eq.{TODAY}")
sf_total  = row_count("sales_facts_daily")
latest_sf = max_val("sales_facts_daily", "date")
chk("sales_facts_daily today", sf_today, want_positive=True)
inf(f"total rows / latest date", f"{sf_total} / {latest_sf}")

# promotion_sales_impact (0 expected until 7+ days of sales_facts_daily)
psi_total = row_count("promotion_sales_impact")
chk("promotion_sales_impact total", psi_total, want_positive=False,
    note="0 OK -- needs 7+ days of daily sales history to correlate")

print(f"\n{'='*W}")
print(f"  Done. TODAY={TODAY}")
print(f"{'='*W}\n")
