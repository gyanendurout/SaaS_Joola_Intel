"""X/Twitter brand posts scraper.

Handles are read from the `x_accounts` DB table — the single source of truth.
Verified brand handles seeded via migration 003. Brands without a confirmed X
account (crbn, six-zero, engage) have no row in x_accounts and are skipped.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from ...core import apify_client as apify
from ...core import supabase_client as sb
from ...core.logger import get_logger

log = get_logger("twitter.brands")


def _to_iso(raw: Any) -> str | None:
    """Normalize Apify createdAt to an ISO-8601 string for timestamptz inserts.

    apidojo/twitter-scraper-lite generally returns an ISO string, but some
    payloads (and retries against fallback actors) emit a unix epoch int.
    Mirrors the TikTok scraper fix — defensive against both shapes.
    """
    if isinstance(raw, (int, float)):
        try:
            return datetime.fromtimestamp(int(raw), tz=timezone.utc).isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(raw, str) and raw:
        return raw
    return None


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    x_accounts = sb.get("x_accounts", "id,handle,brand_id")

    # Build handle map from DB — covers all brands seeded in x_accounts
    handle_map: dict[str, dict] = {
        r["handle"].lower(): {"account_id": r["id"], "brand_id": r["brand_id"]}
        for r in x_accounts
    }

    # Apply brand filter using brand_ids derived from slugs
    if brand_filter:
        allowed_ids = {brand_map[s] for s in brand_filter if s in brand_map}
        handle_map = {h: info for h, info in handle_map.items()
                      if info["brand_id"] in allowed_ids}

    handles = list(handle_map.keys())
    if not handles:
        log.info("No X handles to scrape")
        return 0

    if dry_run:
        log.info("[DRY-RUN] would scrape X posts for handles: %s", handles)
        return 0

    today = date.today()
    iso_year, iso_week, _ = today.isocalendar()

    items = apify.run_and_fetch("apidojo/twitter-scraper-lite", {
        "twitterHandles": handles,
        "maxItems": 100,
        "addUserInfo": True,
    })

    profiles: list[dict] = []
    posts: list[dict] = []
    seen_profiles: set[str] = set()

    for item in items:
        handle = (item.get("author", {}).get("userName") or "").lower()
        if not handle:
            handle = (item.get("twitterHandle") or "").lower()
        info = handle_map.get(handle)
        brand_id   = info["brand_id"]   if info else None
        account_id = info["account_id"] if info else None

        if handle and handle not in seen_profiles:
            seen_profiles.add(handle)
            author = item.get("author") or item.get("user") or {}
            profiles.append({
                "account_id":  account_id,
                "brand_id":    brand_id,
                "handle":      handle,
                "followers":   author.get("followers") or author.get("followersCount"),
                "following":   author.get("following") or author.get("friendsCount"),
                "tweet_count": author.get("statusesCount"),
                "week_number": iso_week,
                "year":        iso_year,
            })

        tweet_id = str(item.get("id") or item.get("tweetId") or "")
        if not tweet_id:
            continue
        posts.append({
            "account_id":    account_id,
            "brand_id":      brand_id,
            "handle":        handle,
            "tweet_id":      tweet_id,
            "post_url":      item.get("url") or f"https://twitter.com/{handle}/status/{tweet_id}",
            "text":          (item.get("text") or item.get("full_text") or "")[:2000],
            "like_count":    item.get("likeCount") or item.get("favorite_count", 0),
            "retweet_count": item.get("retweetCount") or item.get("retweet_count", 0),
            "reply_count":   item.get("replyCount", 0),
            "view_count":    item.get("viewCount") or item.get("views", 0),
            "posted_at":     _to_iso(item.get("createdAt") or item.get("created_at")),
        })

    p = sb.delete_insert_weekly("x_profiles_weekly", profiles, "week_number", iso_week, iso_year)
    q = sb.upsert("x_posts", posts, "tweet_id")
    log.info("✓ %d X profile snapshots, %d posts upserted", p, q)
    return p + q
