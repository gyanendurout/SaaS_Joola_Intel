"""Instagram brand profiles and weekly snapshots."""

from __future__ import annotations

import re
from datetime import date
from typing import Any

from ...core import apify_client as apify
from ...core import supabase_client as sb
from ...core.logger import get_logger

log = get_logger("ig.profiles")

_TYPE_MAP = {
    "Image": "Image", "Video": "Video", "Sidecar": "Carousel",
    "GraphImage": "Image", "GraphVideo": "Video",
    "GraphSidecar": "Carousel", "XDTMediaTypeVideo": "Reel",
}


def _extract_hashtags(text: str) -> list[str]:
    return re.findall(r"#(\w+)", text or "")


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    ig_map = sb.get("ig_accounts", "id,handle,brand_id")
    account_map = {r["handle"]: {"account_id": r["id"], "brand_id": r["brand_id"]} for r in ig_map}

    handles = list(account_map.keys())
    if brand_filter:
        brand_ids = {r["id"] for r in sb.get("brands", "id,slug") if r["slug"] in brand_filter}
        handles = [h for h, info in account_map.items() if info["brand_id"] in brand_ids]

    if dry_run:
        log.info("[DRY-RUN] would scrape IG profiles for: %s", handles)
        return 0

    today = date.today()
    iso_year, iso_week, _ = today.isocalendar()

    items = apify.run_and_fetch("apify/instagram-profile-scraper", {
        "usernames": handles,
        "resultsLimit": 150,
    })

    profiles: list[dict] = []
    posts: list[dict] = []

    for item in items:
        handle = item.get("username") or item.get("inputUrl", "").split("/")[-1].strip("/")
        info = account_map.get(handle)
        if not info:
            log.warning("No ig_accounts record for handle: %r", handle)
            continue

        brand_id = info["brand_id"]
        account_id = info["account_id"]

        profiles.append({
            "account_id":  account_id,
            "brand_id":    brand_id,
            "handle":      handle,
            "followers":   item.get("followersCount"),
            "following":   item.get("followsCount"),
            "post_count":  item.get("postsCount"),
            "bio_text":    item.get("biography"),
            "bio_link":    item.get("externalUrl"),
            "is_verified": item.get("verified", False),
            "week_number": iso_week,
            "year":        iso_year,
        })

        for post in item.get("latestPosts", []):
            shortcode = post.get("shortCode") or post.get("id")
            if not shortcode:
                continue
            caption = (post.get("caption") or "")[:2000]
            posts.append({
                "account_id":        account_id,
                "brand_id":          brand_id,
                "handle":            handle,
                "instagram_post_id": shortcode,
                "post_url":          f"https://www.instagram.com/p/{shortcode}/",
                "post_format":       _TYPE_MAP.get(post.get("type", ""), "Image"),
                "caption":           caption,
                "hashtags":          _extract_hashtags(caption),
                "like_count":        post.get("likesCount", 0),
                "comment_count":     post.get("commentsCount", 0),
                "view_count":        post.get("videoViewCount", 0),
                "image_url":         post.get("displayUrl"),
                "posted_at":         post.get("timestamp"),
            })

    p = sb.delete_insert_weekly("ig_profiles_weekly", profiles, "week_number", iso_week, iso_year)
    q = sb.upsert("ig_posts", posts, "instagram_post_id")
    log.info("✓ %d profile snapshots, %d posts upserted", p, q)
    return p + q
