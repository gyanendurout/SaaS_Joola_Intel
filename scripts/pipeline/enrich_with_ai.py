"""
JOOLA Intel — AI Enrichment Worker
Picks up rows with enriched_at IS NULL across every channel table and populates
sentiment / topics / brands_mentioned / players_mentioned / products_mentioned /
is_crisis / is_opportunity / purchase_intent_score / competitor_switch via
GPT-4o-mini.

Run: python scripts/pipeline/enrich_with_ai.py
"""

import os, sys, json, time
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests

try:
    from dotenv import load_dotenv
    # Load python script .env first, then project-root .env.local for
    # NEXT_PUBLIC_OPENAI_KEY fallback
    load_dotenv("scripts/.env")
    load_dotenv(".env.local")
except ImportError:
    pass

OPENAI_KEY = (os.environ.get("OPENAI_API_KEY")
              or os.environ.get("NEXT_PUBLIC_OPENAI_KEY"))
if not OPENAI_KEY:
    print("✗ No OpenAI key found in OPENAI_API_KEY or NEXT_PUBLIC_OPENAI_KEY")
    sys.exit(1)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://loecyghnkkxyymelgexz.supabase.co")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

SB_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

# Brand slugs and athlete names for prompt grounding
BRAND_SLUGS = ["joola", "selkirk", "paddletek", "crbn", "six-zero",
               "engage", "onix", "franklin", "head", "wilson", "gamma"]
ATHLETES = [
    "Ben Johns", "Tyson McGuffin", "Anna Leigh Waters", "Anna Bright",
    "Patrick Smith", "Catherine Parenteau", "Riley Newman", "Simone Jardim",
    "Zane Navratil", "James Ignatowich", "Jorja Johnson", "Jay Devilliers",
    "Jessie Irvine", "Kyle Yates", "Tanner Tomassi", "Bobbi Oshiro",
    "Sarah Ansboury", "Leigh Waters", "Connor Garnett", "Aspen Kern",
    "Roscoe Bellamy", "Alex Neumann", "Andrei Daescu", "Allyce Jones",
    "Blaine Hovenier", "Gabe Joseph", "Eric Oncins",
]
PRODUCTS_HINT = [
    "Perseus", "Hyperion", "Scorpeus", "Agassi Pro", "Solaire",     # JOOLA
    "Vanguard Power Air", "Luxx Control", "Halo", "Invikta",         # Selkirk
    "Bantam TS-5", "Tempest Reign",                                  # Paddletek
    "CRBN-1", "CRBN-3", "CRBN-X",                                    # CRBN
    "Double Black Diamond", "DBD",                                   # Six Zero
    "Pursuit Pro",                                                   # Engage
    "Z5", "Evoke",                                                   # Onix
    "Signature Pro",                                                 # Franklin
    "Radical Pro",                                                   # HEAD
    "Juice Pro",                                                     # Wilson
    "Obsidian",                                                      # Gamma
]
CRISIS_KEYWORDS = ["broken", "lawsuit", "recall", "warranty", "defective",
                   "delaminating", "delam", "refund", "fraud", "scam",
                   "cracked", "snapped"]


# ─── Tables to enrich ────────────────────────────────────────────────────────

# Each entry: (table, id_col, text_col_or_lambda, extra_select)
# Some tables have combined text (post_title + content_text for reddit, etc.)
TABLES = [
    # (table, id_col, fields_to_select, combine_fn)
    ("reddit_mentions",     "id", "id,post_title,content_text",
     lambda r: (r.get("post_title") or "") + "\n" + (r.get("content_text") or "")),
    ("reddit_comments",     "id", "id,comment_text",
     lambda r: r.get("comment_text") or ""),
    ("ig_comments",         "id", "id,comment_text",
     lambda r: r.get("comment_text") or ""),
    ("yt_comments",         "id", "id,comment_text",
     lambda r: r.get("comment_text") or ""),
    ("x_posts",             "id", "id,text",
     lambda r: r.get("text") or ""),
    ("tiktok_videos",       "id", "id,text",
     lambda r: r.get("text") or ""),
    ("influencer_x_posts",  "id", "id,text",
     lambda r: r.get("text") or ""),
]

# Columns each table accepts. Tables that lack a column will skip it on UPDATE.
COMMON_FIELDS = {
    "sentiment_score": float, "sentiment_label": str, "topics": list,
    "brands_mentioned": list, "players_mentioned": list,
    "products_mentioned": list, "is_crisis": bool, "is_opportunity": bool,
    "purchase_intent_score": float, "crisis_keywords": list,
}
REDDIT_ONLY_FIELDS = {"competitor_switch_from": str, "competitor_switch_to": str}

# influencer_x_posts doesn't have crisis_keywords / players_mentioned columns
# per migration 006 — strip those on write.
TABLE_FIELD_OVERRIDES = {
    "influencer_x_posts": {"sentiment_score", "sentiment_label", "topics",
                           "brands_mentioned", "products_mentioned",
                           "is_crisis", "is_opportunity",
                           "purchase_intent_score"},
}


# ─── Prompt template ─────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an analyst classifying social media content about pickleball paddle brands. Output strict JSON only.

For each input text, return:
- sentiment_score: -1.0 (very negative) to 1.0 (very positive)
- sentiment_label: "very_negative" | "negative" | "neutral" | "positive" | "very_positive"
- topics: array of 1-4 short topic tags (lowercase, hyphen-separated, e.g. "paddle-review", "warranty-issue")
- brands_mentioned: array of brand slugs from this list: """ + ", ".join(BRAND_SLUGS) + """
- players_mentioned: array of athlete full names from this list: """ + ", ".join(ATHLETES) + """
- products_mentioned: array of product names from this list: """ + ", ".join(PRODUCTS_HINT) + """
- is_crisis: true if the text describes a product failure, defect, warranty problem, fraud accusation, or other reputation risk
- is_opportunity: true if the text is a buying intent question, switch-from-competitor mention, or positive UGC about JOOLA
- purchase_intent_score: 0.0 (no intent) to 1.0 (explicit "I'm buying X this week")
- crisis_keywords: array of crisis keywords found (e.g. "broken", "delaminating", "warranty"). Empty if none.
- competitor_switch_from: brand slug if the writer mentions switching FROM this brand. Null otherwise.
- competitor_switch_to: brand slug if the writer mentions switching TO this brand. Null otherwise.

Return ONLY the JSON object. No prose."""


# ─── OpenAI call ─────────────────────────────────────────────────────────────

def call_openai(text: str, allow_competitor_switch: bool = False) -> dict | None:
    """Single-row enrichment. Returns dict on success, None on failure."""
    if not text or len(text.strip()) < 3:
        return None

    payload = {
        "model": "gpt-4o-mini",
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text[:1500]},
        ],
    }
    headers = {
        "Authorization": f"Bearer {OPENAI_KEY}",
        "Content-Type":  "application/json",
    }
    for attempt in range(3):
        try:
            r = requests.post("https://api.openai.com/v1/chat/completions",
                              headers=headers, json=payload, timeout=30)
            if r.status_code == 429:
                wait = 2 ** attempt * 5
                print(f"    rate-limited, waiting {wait}s")
                time.sleep(wait)
                continue
            if r.status_code != 200:
                print(f"    OpenAI error {r.status_code}: {r.text[:300]}")
                return None
            content = r.json()["choices"][0]["message"]["content"]
            result = json.loads(content)
            if not allow_competitor_switch:
                result.pop("competitor_switch_from", None)
                result.pop("competitor_switch_to", None)
            return result
        except (requests.exceptions.RequestException,
                json.JSONDecodeError, KeyError) as e:
            print(f"    Attempt {attempt+1}/3 failed: {e}")
            time.sleep(2)
    return None


# ─── Supabase helpers ────────────────────────────────────────────────────────

def fetch_unenriched(table: str, select: str, limit: int = 200) -> list[dict]:
    url = (f"{SUPABASE_URL}/rest/v1/{table}"
           f"?select={select}&enriched_at=is.null&limit={limit}")
    for attempt in range(4):
        try:
            r = requests.get(url, headers=SB_HEADERS, timeout=60)
            r.raise_for_status()
            return r.json()
        except (requests.exceptions.RequestException,
                requests.exceptions.ChunkedEncodingError) as e:
            print(f"    fetch_unenriched {table} attempt {attempt+1}/4: {e}")
            time.sleep(2 ** attempt * 2)
    return []


def update_row(table: str, row_id: str, data: dict) -> bool:
    # Strip fields that don't exist on this table (e.g. influencer_x_posts)
    allowed = TABLE_FIELD_OVERRIDES.get(table)
    if allowed is not None:
        data = {k: v for k, v in data.items() if k in allowed}
    data["enriched_at"] = datetime.utcnow().isoformat()
    url = f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{row_id}"
    for attempt in range(3):
        try:
            r = requests.patch(url, headers=SB_HEADERS, json=data, timeout=60)
            if r.status_code in (200, 204):
                return True
            if attempt == 2:
                print(f"    Update {table}/{row_id} failed {r.status_code}: {r.text[:200]}")
                return False
            time.sleep(2)
        except (requests.exceptions.RequestException,
                requests.exceptions.ChunkedEncodingError) as e:
            if attempt == 2:
                print(f"    Update {table}/{row_id} retry-fail: {e}")
                return False
            time.sleep(2 ** attempt * 2)
    return False


# ─── Main loop ───────────────────────────────────────────────────────────────

def _process_row(table: str, row: dict, combine_fn, allow_switch: bool) -> str:
    """Process one row. Returns status: 'ok' | 'skipped' | 'failed'."""
    text = combine_fn(row)
    if not text or len(text.strip()) < 3:
        update_row(table, row["id"], {"sentiment_label": "neutral"})
        return "skipped"
    result = call_openai(text, allow_competitor_switch=allow_switch)
    if result is None:
        return "failed"
    return "ok" if update_row(table, row["id"], result) else "failed"


def enrich_table(table: str, id_col: str, select: str, combine_fn,
                  max_rows: int | None = None, workers: int = 5) -> int:
    """Enrich up to `max_rows` rows of a table with parallel workers."""
    print(f"\n[ {table} ] starting…", flush=True)
    enriched_count = 0
    skipped_count  = 0
    failed_count   = 0

    allow_switch = (table == "reddit_mentions")

    while True:
        rows = fetch_unenriched(table, select, limit=500)
        if not rows:
            break
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futures = {ex.submit(_process_row, table, r, combine_fn, allow_switch): r
                       for r in rows}
            for fut in as_completed(futures):
                status = fut.result()
                if status == "ok":
                    enriched_count += 1
                elif status == "skipped":
                    skipped_count += 1
                else:
                    failed_count += 1
                processed = enriched_count + skipped_count + failed_count
                if processed % 50 == 0:
                    print(f"  [{table}] processed {processed} "
                          f"(ok={enriched_count}, skip={skipped_count}, "
                          f"fail={failed_count})", flush=True)
                if max_rows and enriched_count >= max_rows:
                    print(f"  [{table}] hit max_rows={max_rows}", flush=True)
                    return enriched_count

    print(f"[ {table} ] done: enriched={enriched_count}, skipped={skipped_count}, "
          f"failed={failed_count}", flush=True)
    return enriched_count


def main():
    print("=" * 55, flush=True)
    print("JOOLA Intel — AI Enrichment Worker", flush=True)
    print(f"Started: {datetime.utcnow().isoformat()}", flush=True)
    print("=" * 55, flush=True)

    grand_total = 0
    for table, id_col, select, combine_fn in TABLES:
        try:
            n = enrich_table(table, id_col, select, combine_fn)
            grand_total += n
        except Exception as e:
            print(f"✗ {table} failed: {e}", flush=True)

    print(f"\n{'=' * 55}", flush=True)
    print(f"Done. Total enriched: {grand_total} rows", flush=True)
    print(f"Finished: {datetime.utcnow().isoformat()}", flush=True)


if __name__ == "__main__":
    main()
