"""One-time backfill: ig_comments.post_url from ig_posts.

Why this exists
---------------
`ig_comments.post_url` was added by migration 022 (applied 2026-08-24). Before
that, `scrape_comments.py` was already writing the column — it was the schema-gap
stripper in `core/supabase_client._strip_missing_column()` that silently removed
it from every payload so the rest of the row could land.

So the column arrived empty on all 8,703 pre-022 rows, while the scraper needs no
change: new scrapes populate it correctly from here on.

No re-scrape is required to fix history. `ig_comments.post_id` references
`ig_posts.id`, and `ig_posts.post_url` is populated, so the value is recoverable
with a join — which costs nothing, versus an Apify Instagram run.

Idempotent: only rows with a NULL/empty post_url are touched, so re-running is
safe and a second run reports 0 updated.

    python scripts/backfill_ig_comment_post_url.py [--dry-run]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from backend.scraping.core import supabase_client as sb  # noqa: E402
from backend.scraping.core.logger import get_logger  # noqa: E402

log = get_logger("backfill.ig_post_url")

PAGE = 1000


def _fetch_all(table: str, select: str, extra: str = "") -> list[dict]:
    out: list[dict] = []
    offset = 0
    while True:
        page = sb.get_filtered(table, select, f"{extra}limit={PAGE}&offset={offset}")
        if not page:
            break
        out.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would change without writing")
    args = ap.parse_args()

    posts = _fetch_all("ig_posts", "id,post_url")
    url_by_post = {p["id"]: p["post_url"] for p in posts if p.get("post_url")}
    log.info("ig_posts with a post_url: %d", len(url_by_post))

    comments = _fetch_all("ig_comments", "id,post_id,post_url")
    log.info("ig_comments total: %d", len(comments))

    updates: list[dict] = []
    missing_post = 0
    for c in comments:
        if c.get("post_url"):
            continue
        url = url_by_post.get(c.get("post_id"))
        if not url:
            missing_post += 1
            continue
        updates.append({"id": c["id"], "post_url": url})

    log.info("resolvable: %d | already set: %d | no parent post: %d",
             len(updates),
             sum(1 for c in comments if c.get("post_url")),
             missing_post)

    if missing_post:
        log.warning("%d comments have a post_id with no matching ig_posts row — "
                    "these stay NULL until the parent post is re-scraped.",
                    missing_post)

    if not updates:
        log.info("nothing to backfill")
        return 0

    if args.dry_run:
        log.info("[DRY-RUN] would update %d ig_comments rows", len(updates))
        for u in updates[:3]:
            log.info("   %s -> %s", u["id"], u["post_url"])
        return 0

    # Upsert on the primary key: ON CONFLICT DO UPDATE touches only the columns
    # present in the payload, so this sets post_url and leaves the rest alone.
    n = sb.upsert("ig_comments", updates, "id")
    log.info("backfilled post_url on %d ig_comments rows", n)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
