"""X/Twitter influencer posts scraper.

Handles are read exclusively from the `influencers.x_handle` DB column.
Verification policy (migration 005): only empirically confirmed handles are
non-NULL. Do NOT add a hardcoded fallback dict — the DB is the source of truth.
"""

from __future__ import annotations

from typing import Any

from ...core import apify_client as apify
from ...core import supabase_client as sb
from ...core.logger import get_logger

log = get_logger("twitter.influencers")


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)

    # DB is the single source of truth — handles verified via migration 005.
    # Rows with x_handle = NULL are skipped (unconfirmed guesses).
    inf_rows = sb.get("influencers", "id,brand_id,instagram_handle,x_handle")
    inf_map: dict[str, dict] = {}
    for r in inf_rows:
        x_handle = r.get("x_handle")
        if x_handle:
            inf_map[x_handle.lower()] = {"influencer_id": r["id"], "brand_id": r["brand_id"]}

    handles = list(inf_map.keys())
    if not handles:
        log.info("No influencer X handles in DB (influencers.x_handle)")
        return 0

    if dry_run:
        log.info("[DRY-RUN] would scrape X posts for %d influencers", len(handles))
        return 0

    items = apify.run_and_fetch("apidojo/twitter-scraper-lite", {
        "twitterHandles": handles,
        "maxItems": 50,
        "addUserInfo": True,
    })

    rows: list[dict] = []
    empty_handles: list[str] = []

    for item in items:
        handle = (item.get("author", {}).get("userName") or "").lower()
        info = inf_map.get(handle)
        if not info:
            if handle not in empty_handles:
                empty_handles.append(handle)
            continue

        tweet_id = item.get("id") or item.get("tweetId")
        if not tweet_id:
            continue

        rows.append({
            "influencer_id": info["influencer_id"],
            "brand_id":      info["brand_id"],
            "tweet_id":      tweet_id,
            "text":          (item.get("text") or "")[:2000],
            "like_count":    item.get("likeCount", 0),
            "retweet_count": item.get("retweetCount", 0),
            "reply_count":   item.get("replyCount", 0),
            "view_count":    item.get("viewCount"),
            "posted_at":     item.get("createdAt"),
        })

    if empty_handles:
        log.warning("Empty results for X handles: %s", empty_handles)

    n = sb.upsert("influencer_x_posts", rows, "tweet_id")
    log.info("✓ %d influencer X posts upserted", n)
    return n
