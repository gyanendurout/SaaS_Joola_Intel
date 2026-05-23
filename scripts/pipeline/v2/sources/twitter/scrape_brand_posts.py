"""X/Twitter brand posts scraper."""

from __future__ import annotations

from datetime import date
from typing import Any

from ...core import apify_client as apify
from ...core import supabase_client as sb
from ...core.logger import get_logger

log = get_logger("twitter.brands")

X_HANDLES: dict[str, str] = {
    "joola":     "joolapickleball",
    "selkirk":   "SelkirkSport",
    "franklin":  "FranklinSports",
    "paddletek": "PaddletekLLC",
    "onix":      "OnixPickleball",
}


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    x_accounts = sb.get("x_accounts", "id,handle,brand_id")
    handle_map: dict[str, dict] = {r["handle"].lower(): {"account_id": r["id"], "brand_id": r["brand_id"]}
                                    for r in x_accounts}

    handles = list(X_HANDLES.values())
    if brand_filter:
        handles = [h for slug, h in X_HANDLES.items() if slug in brand_filter]

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
            "brand_id":      brand_id,
            "handle":        handle,
            "tweet_id":      tweet_id,
            "post_url":      item.get("url") or f"https://twitter.com/{handle}/status/{tweet_id}",
            "text":          (item.get("text") or item.get("full_text") or "")[:2000],
            "like_count":    item.get("likeCount") or item.get("favorite_count", 0),
            "retweet_count": item.get("retweetCount") or item.get("retweet_count", 0),
            "reply_count":   item.get("replyCount", 0),
            "view_count":    item.get("viewCount") or item.get("views", 0),
            "posted_at":     item.get("createdAt") or item.get("created_at"),
        })

    p = sb.delete_insert_weekly("x_profiles_weekly", profiles, "week_number", iso_week, iso_year)
    q = sb.upsert("x_posts", posts, "tweet_id")
    log.info("✓ %d X profile snapshots, %d posts upserted", p, q)
    return p + q
