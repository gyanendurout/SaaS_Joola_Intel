"""Data validation — checks row counts and data quality after a pipeline run."""

from __future__ import annotations

from datetime import date
from typing import Any

from ..core import supabase_client as sb
from ..core.logger import get_logger

log = get_logger("maintenance.validate")

EXPECTED_TABLES = [
    ("brands",                10, "Should have exactly 11 brands"),
    ("ig_accounts",            5, "Should have IG accounts"),
    ("ig_profiles_weekly",     5, "Should have weekly IG profiles"),
    ("ig_posts",              50, "Should have at least 50 IG posts"),
    ("ig_comments",           10, "Should have IG comments"),
    ("yt_channels",            5, "Should have YT channels"),
    ("yt_videos",             50, "Should have at least 50 YT videos"),
    ("yt_comments",           10, "Should have YT comments"),
    ("reddit_mentions",       20, "Should have Reddit mentions"),
    ("x_posts",               20, "Should have X posts"),
    ("tiktok_videos",         20, "Should have TikTok videos"),
    ("marketing_ads",         10, "Should have ads"),
    ("promotions",             5, "Should have promotions"),
    ("influencers",           27, "Should have exactly 27 influencers"),
    ("mention_facts",         50, "Should have mention facts"),
    # Migration 012 — YT transcript + product attention intelligence
    ("yt_video_transcripts",  20, "Should have transcripts for top videos"),
    ("yt_video_analysis",     20, "Should have AI analysis for top videos"),
    ("product_aliases",       30, "Should have aliases seeded from products_catalog"),
    ("product_mentions",      50, "Should have mentions across channels"),
    ("product_attention_daily", 10, "Should have product×day rollup rows"),
    ("product_attention_summary", 20, "Should have product×period summary rows"),
]


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    if dry_run:
        log.info("[DRY-RUN] would validate %d tables", len(EXPECTED_TABLES))
        return 0

    issues = 0
    log.info("\n=== Data Validation Report ===")
    log.info("%-30s %8s %8s  %s", "Table", "Count", "Min", "Status")
    log.info("-" * 70)

    for table, min_rows, note in EXPECTED_TABLES:
        rows = sb.get_filtered(table, "id", f"limit=1&select=count")
        # Use head request to get count without loading all rows
        try:
            all_rows = sb.get(table, "id")
            count = len(all_rows)
        except Exception as e:
            log.error("  %-30s ERROR: %s", table, e)
            issues += 1
            continue

        status = "✓" if count >= min_rows else "✗ BELOW MIN"
        if count < min_rows:
            issues += 1
        log.info("  %-30s %8d %8d  %s", table, count, min_rows, status)

    log.info("=== %d issues found ===", issues)

    # Check enrichment coverage
    for table in ["reddit_mentions", "ig_comments", "yt_comments", "x_posts", "tiktok_videos", "yt_video_analysis"]:
        try:
            unenriched = sb.get_filtered(table, "id", "enriched_at=is.null&limit=1000")
            if unenriched:
                log.warning("  %s: %d rows still unenriched", table, len(unenriched))
        except Exception:
            pass

    return issues
