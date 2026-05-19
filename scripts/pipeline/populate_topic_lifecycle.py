"""
JOOLA Intel — Topic Lifecycle Populator
Aggregates `mention_facts` rows by topic (extracted from each enriched row's
`topics` array), then writes a `topic_lifecycle` row per unique topic
describing: first-seen channel + time, peak day, total mentions, channels
touched, crisis flag.

Run after `populate_mention_facts.py`.

Run: python scripts/pipeline/populate_topic_lifecycle.py
"""

import os, sys, re
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from datetime import datetime, timedelta
from collections import defaultdict
import requests

try:
    from dotenv import load_dotenv
    load_dotenv("scripts/.env")
except ImportError:
    pass

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://loecyghnkkxyymelgexz.supabase.co")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

SB_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}


def slugify(text: str) -> str:
    s = text.lower().strip()
    s = re.sub(r"[^a-z0-9\-_ ]", "", s)
    s = re.sub(r"\s+", "-", s)
    return s[:80]


def fetch_all_enriched_with_topics() -> list[dict]:
    """Pull (topic, channel, posted_at, is_crisis) from every channel table."""
    rows: list[dict] = []
    for table, channel in [
        ("reddit_mentions",    "reddit"),
        ("reddit_comments",    "reddit_comment"),
        ("ig_comments",        "ig_comment"),
        ("yt_comments",        "yt_comment"),
        ("x_posts",            "x"),
        ("tiktok_videos",      "tiktok"),
        ("influencer_x_posts", "x_influencer"),
    ]:
        offset = 0
        page_size = 500
        while True:
            url = (f"{SUPABASE_URL}/rest/v1/{table}"
                   f"?select=topics,posted_at,is_crisis"
                   f"&topics=not.is.null&limit={page_size}&offset={offset}")
            r = None
            for attempt in range(3):
                try:
                    r = requests.get(url, headers=SB_HEADERS, timeout=90)
                    break
                except (requests.exceptions.ReadTimeout,
                        requests.exceptions.ConnectionError) as e:
                    print(f"    fetch retry {attempt+1}/3: {e}", flush=True)
                    import time as _t; _t.sleep(5)
            if r is None:
                break
            batch = r.json()
            if not batch:
                break
            for b in batch:
                topics = b.get("topics") or []
                if not topics:
                    continue
                # `topics` is jsonb — could be list of strings or list of objects
                if isinstance(topics, list):
                    for t in topics:
                        if isinstance(t, str):
                            rows.append({
                                "topic":    t,
                                "channel":  channel,
                                "posted_at": b.get("posted_at"),
                                "is_crisis": bool(b.get("is_crisis")),
                            })
            if len(batch) < page_size:
                break
            offset += page_size
        print(f"  loaded from {table} ({channel})", flush=True)
    return rows


def aggregate(rows: list[dict]) -> list[dict]:
    """For each unique topic_slug, compute first-seen, peak, totals."""
    by_topic: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        slug = slugify(r["topic"])
        if not slug:
            continue
        by_topic[slug].append(r)

    out = []
    for slug, occurrences in by_topic.items():
        if len(occurrences) < 2:
            # Skip noise — topics that appear only once aren't lifecycle-worthy
            continue

        # Sort by posted_at
        timed = sorted([o for o in occurrences if o.get("posted_at")],
                       key=lambda x: x["posted_at"])
        if not timed:
            continue

        first = timed[0]
        # Peak — bucket by day, find max
        by_day = defaultdict(int)
        for o in timed:
            day = (o["posted_at"] or "")[:10]
            by_day[day] += 1
        peak_day, peak_count = max(by_day.items(), key=lambda x: x[1])

        channels = sorted({o["channel"] for o in occurrences})
        is_crisis = any(o["is_crisis"] for o in occurrences)

        display = " ".join(w.capitalize() for w in slug.replace("-", " ").split())

        out.append({
            "topic_slug":         slug,
            "display_label":      display,
            "first_seen_at":      first["posted_at"],
            "first_seen_channel": first["channel"],
            "peak_at":            f"{peak_day}T00:00:00+00:00",
            "peak_mentions_24h":  peak_count,
            "total_mentions":     len(occurrences),
            "channels_touched":   channels,
            "is_crisis":          is_crisis,
        })
    return out


def upsert_lifecycle(rows: list[dict]) -> int:
    if not rows:
        return 0
    # Clear and re-insert (table is small, this is simplest)
    requests.delete(f"{SUPABASE_URL}/rest/v1/topic_lifecycle?id=not.is.null",
                    headers={k: v for k, v in SB_HEADERS.items() if k != "Prefer"},
                    timeout=30)
    url = f"{SUPABASE_URL}/rest/v1/topic_lifecycle"
    inserted = 0
    for i in range(0, len(rows), 500):
        batch = rows[i:i + 500]
        r = requests.post(url, headers=SB_HEADERS, json=batch, timeout=30)
        if r.status_code in (200, 201, 204):
            inserted += len(batch)
        else:
            print(f"  ✗ insert topic_lifecycle error {r.status_code}: {r.text[:300]}")
    return inserted


def main():
    print("=" * 55, flush=True)
    print("JOOLA Intel — Topic Lifecycle Populator", flush=True)
    print("=" * 55, flush=True)

    rows = fetch_all_enriched_with_topics()
    print(f"\n  {len(rows)} topic occurrences loaded across channels", flush=True)

    lifecycle = aggregate(rows)
    print(f"  {len(lifecycle)} unique multi-occurrence topics aggregated", flush=True)

    # Top 10 by total
    top = sorted(lifecycle, key=lambda x: -x["total_mentions"])[:10]
    print(f"\n  --- Top 10 topics ---")
    for t in top:
        marker = "🚨" if t["is_crisis"] else "  "
        print(f"  {marker} {t['display_label']:35} mentions={t['total_mentions']:4} "
              f"channels={len(t['channels_touched'])} first_on={t['first_seen_channel']}",
              flush=True)

    n = upsert_lifecycle(lifecycle)
    print(f"\n  ✓ {n} topic_lifecycle rows written", flush=True)


if __name__ == "__main__":
    main()
