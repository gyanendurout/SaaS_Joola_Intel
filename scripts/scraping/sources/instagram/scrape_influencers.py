"""Instagram influencer profile scraper.

Matches live Supabase schema:
  influencer_snapshots(influencer_id, brand_id, follower_count_ig,
                       week_number, year)  — weekly delete-insert
  influencer_posts(influencer_id, brand_id, platform, post_url,
                   caption, hashtags, like_count, comment_count,
                   view_count, posted_at)
Conflict key for posts: post_url
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any

from ...core import apify_client as apify
from ...core import supabase_client as sb
from ...core.logger import get_logger

log = get_logger("ig.influencers")


def _extract_hashtags(text: str) -> list[str]:
    return re.findall(r"#(\w+)", text or "")


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)

    inf_rows = sb.get("influencers", "id,brand_id,instagram_handle")
    inf_map = {
        r["instagram_handle"]: {"influencer_id": r["id"], "brand_id": r["brand_id"]}
        for r in inf_rows if r.get("instagram_handle")
    }

    if dry_run:
        log.info("[DRY-RUN] would scrape IG profiles for %d influencers", len(inf_map))
        return 0

    today = date.today()
    iso_year, iso_week, _ = today.isocalendar()

    items = apify.run_and_fetch("apify/instagram-profile-scraper", {
        "usernames": list(inf_map.keys()),
        "resultsLimit": 12,
    })

    snapshots: list[dict] = []
    posts: list[dict] = []

    for item in items:
        handle = item.get("username") or item.get("inputUrl", "").split("/")[-1].strip("/")
        info = inf_map.get(handle)
        if not info:
            log.warning("No influencer record for IG handle: %r", handle)
            continue

        snapshots.append({
            "influencer_id":     info["influencer_id"],
            "brand_id":          info["brand_id"],
            "follower_count_ig": item.get("followersCount"),
            "week_number":       iso_week,
            "year":              iso_year,
        })

        for post in item.get("latestPosts", []):
            shortcode = post.get("shortCode") or post.get("id")
            if not shortcode:
                continue
            caption = (post.get("caption") or "")[:2000]
            posts.append({
                "influencer_id": info["influencer_id"],
                "brand_id":      info["brand_id"],
                "platform":      "instagram",
                "post_url":      f"https://www.instagram.com/p/{shortcode}/",
                "caption":       caption,
                "hashtags":      _extract_hashtags(caption),
                "like_count":    post.get("likesCount", 0),
                "comment_count": post.get("commentsCount", 0),
                "view_count":    post.get("videoViewCount", 0),
                "posted_at":     post.get("timestamp"),
            })

    p = sb.delete_insert_weekly("influencer_snapshots", snapshots, "week_number", iso_week, iso_year)
    q = sb.upsert("influencer_posts", posts, "post_url")
    log.info("✓ %d influencer snapshots, %d posts upserted", p, q)
    return p + q
