"""
JOOLA Intel Pipeline v2 — Main CLI Runner

Usage:
  python -m scripts.pipeline.v2.run --module all
  python -m scripts.pipeline.v2.run --module instagram
  python -m scripts.pipeline.v2.run --module youtube
  python -m scripts.pipeline.v2.run --module reddit
  python -m scripts.pipeline.v2.run --module twitter
  python -m scripts.pipeline.v2.run --module tiktok
  python -m scripts.pipeline.v2.run --module ads
  python -m scripts.pipeline.v2.run --module news
  python -m scripts.pipeline.v2.run --module seo
  python -m scripts.pipeline.v2.run --module products
  python -m scripts.pipeline.v2.run --module enrichment
  python -m scripts.pipeline.v2.run --module facts
  python -m scripts.pipeline.v2.run --module sales-intelligence
  python -m scripts.pipeline.v2.run --module intelligence
  python -m scripts.pipeline.v2.run --module maintenance --source backfill-yt-comments
  python -m scripts.pipeline.v2.run --module youtube --source scrape-transcripts
  python -m scripts.pipeline.v2.run --module facts --source populate-product-mentions
  python -m scripts.pipeline.v2.run --module facts --source populate-product-attention
  python -m scripts.pipeline.v2.run --module all --dry-run
  python -m scripts.pipeline.v2.run --module all --restart
  python -m scripts.pipeline.v2.run --module all --brands joola,selkirk
  python -m scripts.pipeline.v2.run --module intelligence --limit 5
"""

from __future__ import annotations

import argparse
import sys
import traceback
from datetime import datetime, timezone

from .core.checkpoints import Checkpoint
from .core.logger import get_logger
from .core.settings import require_apify, require_supabase

log = get_logger("runner")


# ── Module registry ───────────────────────────────────────────────────────────
# Each entry: step_key → (import_path, function_name)
MODULE_STEPS = {
    "instagram": [
        ("scripts.pipeline.v2.sources.instagram.scrape_profiles",  "run"),
        ("scripts.pipeline.v2.sources.instagram.scrape_posts",     "run"),
        ("scripts.pipeline.v2.sources.instagram.scrape_comments",  "run"),
        ("scripts.pipeline.v2.sources.instagram.detect_brand_replies", "run"),
        ("scripts.pipeline.v2.sources.instagram.scrape_influencers", "run"),
    ],
    "youtube": [
        ("scripts.pipeline.v2.sources.youtube.scrape_channels",    "run"),
        ("scripts.pipeline.v2.sources.youtube.scrape_videos",      "run"),
        ("scripts.pipeline.v2.sources.youtube.scrape_comments",    "run"),
        ("scripts.pipeline.v2.sources.youtube.scrape_transcripts", "run"),
    ],
    "reddit": [
        ("scripts.pipeline.v2.sources.reddit.scrape_mentions",     "run"),
        ("scripts.pipeline.v2.sources.reddit.scrape_comments",     "run"),
    ],
    "twitter": [
        ("scripts.pipeline.v2.sources.twitter.scrape_brand_posts", "run"),
        ("scripts.pipeline.v2.sources.twitter.scrape_influencer_posts", "run"),
    ],
    "tiktok": [
        ("scripts.pipeline.v2.sources.tiktok.scrape_videos",       "run"),
    ],
    "ads": [
        ("scripts.pipeline.v2.sources.ads.scrape_meta_ads",        "run"),
        ("scripts.pipeline.v2.sources.ads.scrape_google_ads",      "run"),
    ],
    "products": [
        ("scripts.pipeline.v2.sources.products.scrape_catalog",       "run"),
        ("scripts.pipeline.v2.sources.products.scrape_catalog_local", "run"),
        ("scripts.pipeline.v2.sources.products.scrape_promotions",    "run"),
    ],
    "news": [
        ("scripts.pipeline.v2.sources.news.scrape_news",           "run"),
    ],
    "seo": [
        ("scripts.pipeline.v2.sources.seo.scrape_seo",             "run"),
    ],
    "enrichment": [
        ("scripts.pipeline.v2.enrichment.ai_enricher",             "run"),
        ("scripts.pipeline.v2.enrichment.tiktok_enrichment",       "run"),
        ("scripts.pipeline.v2.enrichment.twitter_enrichment",      "run"),
        ("scripts.pipeline.v2.enrichment.reddit_backfill",         "run"),
        ("scripts.pipeline.v2.enrichment.influencer_sponsored",    "run"),
        ("scripts.pipeline.v2.enrichment.analyze_videos",          "run"),
    ],
    "facts": [
        ("scripts.pipeline.v2.facts.mention_facts",                "run"),
        ("scripts.pipeline.v2.facts.topic_lifecycle",              "run"),
        ("scripts.pipeline.v2.facts.competitor_switch",            "run"),
        ("scripts.pipeline.v2.facts.instagram_themes",             "run"),
        ("scripts.pipeline.v2.facts.populate_product_mentions",    "run"),
        ("scripts.pipeline.v2.facts.populate_product_attention",   "run"),
    ],
    "intelligence": [
        ("scripts.pipeline.v2.sources.youtube.scrape_transcripts", "run"),
        ("scripts.pipeline.v2.enrichment.analyze_videos",          "run"),
        ("scripts.pipeline.v2.facts.populate_product_mentions",    "run"),
        ("scripts.pipeline.v2.facts.populate_product_attention",   "run"),
    ],
    "sales-intelligence": [
        ("scripts.pipeline.v2.sales_intelligence.discover",        "run"),
        ("scripts.pipeline.v2.sales_intelligence.scrape_inventory","run"),
        ("scripts.pipeline.v2.sales_intelligence.estimate",        "run"),
        ("scripts.pipeline.v2.sales_intelligence.restock",         "run"),
        ("scripts.pipeline.v2.sales_intelligence.sellout",         "run"),
        ("scripts.pipeline.v2.sales_intelligence.launches",        "run"),
        ("scripts.pipeline.v2.sales_intelligence.revenue",         "run"),
        ("scripts.pipeline.v2.sales_intelligence.correlation",     "run"),
    ],
    "maintenance": [
        ("scripts.pipeline.v2.maintenance.backfill_youtube_comments", "run"),
        ("scripts.pipeline.v2.maintenance.backfill_athlete_names",    "run"),
        ("scripts.pipeline.v2.maintenance.validate_data",             "run"),
        ("scripts.pipeline.v2.maintenance.count_rows",                "run"),
    ],
}

FULL_ORDER = [
    "instagram", "youtube", "reddit", "twitter", "tiktok",
    "ads", "products", "news", "seo",
    "enrichment", "facts",
    "sales-intelligence",
]


def _step_key_for(mod_path: str) -> str:
    """Build a unique step_key from <parent>_<filename> so colliding filenames
    across modules (e.g. instagram.scrape_comments vs youtube.scrape_comments)
    do NOT silently skip each other via the checkpoint."""
    parts = mod_path.split(".")
    parent = parts[-2] if len(parts) >= 2 else ""
    filename = parts[-1]
    return f"{parent}_{filename}" if parent else filename


def _resolve_steps(module: str, source: str | None) -> list[tuple[str, str, str]]:
    """Return list of (step_key, module_path, fn_name)."""
    modules = list(MODULE_STEPS.keys()) if module == "all" else [module]
    result: list[tuple[str, str, str]] = []
    src_norm = source.replace("-", "_") if source else None
    for mod in modules:
        if mod not in MODULE_STEPS:
            log.error("Unknown module: %s. Valid: %s", mod, ", ".join(MODULE_STEPS))
            sys.exit(1)
        for mod_path, fn in MODULE_STEPS[mod]:
            step_key = _step_key_for(mod_path)
            filename = mod_path.rsplit(".", 1)[-1]
            if src_norm and step_key != src_norm and filename != src_norm:
                continue
            result.append((step_key, mod_path, fn))
    return result


def _import_and_run(mod_path: str, fn_name: str, ctx: dict) -> int:
    import importlib
    mod = importlib.import_module(mod_path)
    fn = getattr(mod, fn_name)
    result = fn(ctx)
    return result if isinstance(result, int) else 0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="JOOLA Intel Pipeline v2")
    parser.add_argument("--module", default="all",
                        help="Module to run: all | instagram | youtube | reddit | twitter | "
                             "tiktok | ads | products | news | seo | enrichment | facts | "
                             "sales-intelligence | intelligence | maintenance")
    parser.add_argument("--source", default=None,
                        help="Specific sub-source to run within a module (e.g. backfill-yt-comments, "
                             "scrape-transcripts, populate-product-mentions, populate-product-attention)")
    parser.add_argument("--brands", default=None,
                        help="Comma-separated brand slugs to limit scraping (e.g. joola,selkirk)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Log what would run without making API calls or DB writes")
    parser.add_argument("--restart", action="store_true",
                        help="Ignore existing checkpoint, start fresh")
    parser.add_argument("--no-resume", action="store_true",
                        help="Alias for --restart")
    parser.add_argument("--limit", type=int, default=None,
                        help="Per-step row cap for smoke tests (e.g. --limit 5)")
    args = parser.parse_args(argv)

    # Validate credentials upfront so we fail fast
    if not args.dry_run:
        try:
            require_supabase()
            require_apify()
        except Exception as e:
            log.error("Credential check failed: %s", e)
            sys.exit(1)

    ctx = {
        "dry_run": args.dry_run,
        "brands": [b.strip() for b in args.brands.split(",")] if args.brands else None,
        "limit":  args.limit,
    }

    cp = Checkpoint()
    if args.restart or args.no_resume:
        cp.reset()
        log.info("Checkpoint reset — starting fresh")
    else:
        cp.load()

    log.info("Run ID: %s", cp.run_id)
    log.info("Module: %s  dry_run=%s  brands=%s", args.module, args.dry_run, ctx["brands"])

    steps = _resolve_steps(args.module, args.source)
    if not steps:
        log.error("No steps matched module=%s source=%s", args.module, args.source)
        sys.exit(1)

    total_rows = 0
    failed: list[str] = []

    for step_key, mod_path, fn_name in steps:
        if cp.is_done(step_key) and not args.restart:
            log.info("  ⏭  %s — skipped (already done)", step_key)
            continue

        if args.dry_run:
            log.info("  [DRY-RUN] would run: %s.%s", mod_path, fn_name)
            continue

        cp.mark_running(step_key)
        log.info("\n▶ %s starting at %s", step_key, _now())

        try:
            rows = _import_and_run(mod_path, fn_name, ctx)
            total_rows += rows
            cp.mark_done(step_key, rows=rows)
            log.info("  ✓ %s done — rows=%d", step_key, rows)
        except KeyboardInterrupt:
            cp.mark_failed(step_key, "Interrupted by user")
            log.warning("\n  ⓘ Interrupted. State saved; rerun to resume.")
            sys.exit(0)
        except Exception as e:
            tb = traceback.format_exc()
            cp.mark_failed(step_key, f"{type(e).__name__}: {e}", tb)
            log.error("  ✗ %s failed: %s", step_key, e)
            failed.append(step_key)

    log.info("\n%s", "=" * 55)
    log.info("Pipeline finished. Total rows: %d", total_rows)
    for step_key, _, _ in steps:
        entry = cp.summary().get(step_key, {})
        log.info("  %-30s %s  rows=%s", step_key, entry.get("status", "-"), entry.get("rows", "-"))
    if failed:
        log.warning("Failed steps: %s", ", ".join(failed))
    log.info("=" * 55)


if __name__ == "__main__":
    main()
