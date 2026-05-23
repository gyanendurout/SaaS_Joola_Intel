"""Quick row count summary for all pipeline tables."""

from __future__ import annotations

from typing import Any

from ..core import supabase_client as sb
from ..core.logger import get_logger

log = get_logger("maintenance.count_rows")

ALL_TABLES = [
    "brands", "ig_accounts", "ig_profiles_weekly", "ig_posts", "ig_comments",
    "yt_channels", "yt_channel_weekly", "yt_videos", "yt_comments",
    "reddit_mentions", "reddit_comments",
    "x_accounts", "x_profiles_weekly", "x_posts",
    "tiktok_accounts", "tiktok_profiles_weekly", "tiktok_videos",
    "influencers", "influencer_snapshots", "influencer_posts", "influencer_x_posts",
    "marketing_ads", "promotions", "products", "products_catalog",
    "mention_facts", "topic_lifecycle", "competitor_switch_events",
    "keyword_research_results", "keyword_rankings",
    "product_variants", "product_snapshots", "inventory_events",
    "sales_estimates", "sales_facts_daily", "promotion_sales_impact",
    "brand_replies",
    # Migration 012 — YT transcript + product attention intelligence
    "yt_video_transcripts", "yt_video_analysis",
    "product_aliases", "product_mentions",
    "product_attention_daily", "product_attention_summary",
]


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    if dry_run:
        log.info("[DRY-RUN] would count rows in %d tables", len(ALL_TABLES))
        return 0

    log.info("\n=== Row Count Summary ===")
    total = 0
    for table in ALL_TABLES:
        try:
            rows = sb.get(table, "id")
            count = len(rows)
            total += count
            log.info("  %-40s %6d", table, count)
        except Exception as e:
            log.warning("  %-40s ERROR: %s", table, e)

    log.info("  %-40s %6d", "TOTAL", total)
    return total
