"""Task G: Dominant Instagram content theme per brand per week.

Reads topics from ig_comments (the live table actually populated by ai_enricher).
Falls back to rule-based hashtag analysis when topics are sparse.

Writes the dominant theme to ig_profiles_weekly.dominant_content_theme.
"""

from __future__ import annotations

from collections import Counter
from datetime import date
from typing import Any

from ..core import supabase_client as sb
from ..core.logger import get_logger

log = get_logger("facts.ig_themes")

THEME_RULES: dict[str, list[str]] = {
    "product-launch":   ["new", "launch", "introducing", "meet", "announce"],
    "athlete-content":  ["partner", "athlete", "pro", "team", "ambassador"],
    "tutorial":         ["how to", "tip", "technique", "drill", "learn"],
    "promotion":        ["sale", "off", "discount", "code", "deal", "promo"],
    "community":        ["community", "fan", "player", "court", "game"],
    "brand-lifestyle":  ["lifestyle", "love", "passion", "family", "sport"],
}


def _rule_theme(captions: list[str]) -> str | None:
    counts: Counter[str] = Counter()
    for caption in captions:
        cl = (caption or "").lower()
        for theme, keywords in THEME_RULES.items():
            if any(kw in cl for kw in keywords):
                counts[theme] += 1
    return counts.most_common(1)[0][0] if counts else None


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    brand_filter: list[str] | None = ctx.get("brands")

    today = date.today()
    iso_year, iso_week, _ = today.isocalendar()

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}
    if brand_filter:
        brand_map = {k: v for k, v in brand_map.items() if k in brand_filter}

    updated = 0
    for slug, brand_id in brand_map.items():
        # 1. Pull topics from enriched ig_comments for this brand
        ig_topics_rows = sb.get_filtered(
            "ig_comments",
            "topics",
            f"brand_id=eq.{brand_id}&topics=not.is.null&enriched_at=not.is.null&limit=500",
        )
        all_topics: list[str] = []
        for row in ig_topics_rows:
            for t in (row.get("topics") or []):
                if t:
                    all_topics.append(str(t).lower())

        if all_topics:
            theme = Counter(all_topics).most_common(1)[0][0]
        else:
            # 2. Fallback: rule-based theme from last 30 post captions
            posts = sb.get_filtered(
                "ig_posts",
                "caption",
                f"brand_id=eq.{brand_id}&order=posted_at.desc&limit=30",
            )
            captions = [p.get("caption") or "" for p in posts]
            theme = _rule_theme(captions)

        if not theme:
            continue

        if dry_run:
            log.info("[DRY-RUN] %s → dominant_content_theme=%s", slug, theme)
            continue

        # Update ig_profiles_weekly for current ISO week
        profiles = sb.get_filtered(
            "ig_profiles_weekly",
            "id",
            f"brand_id=eq.{brand_id}&week_number=eq.{iso_week}&year=eq.{iso_year}",
        )
        for profile in profiles:
            ok = sb.patch("ig_profiles_weekly", profile["id"], {"dominant_content_theme": theme})
            if ok:
                updated += 1

    log.info("✓ %d ig_profiles_weekly.dominant_content_theme updated", updated)
    return updated
