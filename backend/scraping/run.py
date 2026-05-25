"""
JOOLA Intel Pipeline v2 — Main CLI Runner (PARALLEL)
=====================================================

Steps within a module are organised as "parallel groups": each inner list of
(module_path, fn) tuples runs concurrently via a ThreadPoolExecutor; groups
themselves run sequentially so that e.g. Instagram comments wait for posts.

Modules within a phase also run in parallel. Phases run in order:
  Phase 1 (scrape):     instagram, youtube, reddit, twitter, tiktok, ads,
                        products, news, seo                    [all parallel]
  Phase 2 (enrich):     enrichment substeps                    [all parallel]
  Phase 3 (facts):      mention/topic/competitor/themes        [groups in order]
  Phase 4 (sales-int):  revenue, restock, sellout, …           [groups in order]

Pass `--no-parallel` to force fully sequential execution (useful for debugging
or rate-limit-sensitive scenarios).

Usage:
  python -m backend.scraping.run --module all
  python -m backend.scraping.run --module products --brands joola,selkirk
  python -m backend.scraping.run --module instagram --source scrape-comments
  python -m backend.scraping.run --module all --dry-run
  python -m backend.scraping.run --module all --restart
  python -m backend.scraping.run --module all --no-parallel
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import sys
import traceback
from datetime import datetime, timezone

from .core.checkpoints import Checkpoint
from .core.logger import get_logger
from .core.settings import require_apify, require_supabase

log = get_logger("runner")


# ── Module registry ───────────────────────────────────────────────────────────
# Each module is a list of *parallel groups*. Inner list = parallel steps,
# outer list = sequential groups. Single-item inner lists run alone.
Step = tuple[str, str]                       # (module_path, fn_name)
Group = list[Step]                           # parallel within a group
Module = list[Group]                         # groups run in order

MODULE_STEPS: dict[str, Module] = {
    # Instagram: profiles → posts → (comments || detect-replies) → influencers
    "instagram": [
        [("backend.scraping.sources.instagram.scrape_profiles",       "run")],
        [("backend.scraping.sources.instagram.scrape_posts",          "run")],
        [("backend.scraping.sources.instagram.scrape_comments",       "run"),
         ("backend.scraping.sources.instagram.detect_brand_replies",  "run")],
        [("backend.scraping.sources.instagram.scrape_influencers",    "run")],
    ],
    # YouTube: must walk channels → videos → comments → transcripts (each
    # step depends on IDs produced by the previous one)
    "youtube": [
        [("backend.scraping.sources.youtube.scrape_channels",         "run")],
        [("backend.scraping.sources.youtube.scrape_videos",           "run")],
        [("backend.scraping.sources.youtube.scrape_comments",         "run")],
        [("backend.scraping.sources.youtube.scrape_transcripts",      "run")],
    ],
    # Reddit: mentions first (gives us post IDs), then comments
    "reddit": [
        [("backend.scraping.sources.reddit.scrape_mentions",          "run")],
        [("backend.scraping.sources.reddit.scrape_comments",          "run")],
    ],
    # Twitter: brand + influencer accounts are completely independent
    "twitter": [
        [("backend.scraping.sources.twitter.scrape_brand_posts",      "run"),
         ("backend.scraping.sources.twitter.scrape_influencer_posts", "run")],
    ],
    "tiktok": [
        [("backend.scraping.sources.tiktok.scrape_videos",            "run")],
        # scrape_comments depends on tiktok_videos rows existing + migration 014
        # applied. Runs sequentially after videos so the comments scraper picks
        # up freshly-upserted video URLs.
        [("backend.scraping.sources.tiktok.scrape_comments",          "run")],
    ],
    # Meta + Google ad libraries — totally separate APIs
    "ads": [
        [("backend.scraping.sources.ads.scrape_meta_ads",             "run"),
         ("backend.scraping.sources.ads.scrape_google_ads",           "run")],
    ],
    # Products: Apify catalog || Local Playwright catalog || promotions
    # All independent — each writes to a different table/conflict-key combo
    "products": [
        [("backend.scraping.sources.products.scrape_catalog",         "run"),
         ("backend.scraping.sources.products.scrape_catalog_local",   "run"),
         ("backend.scraping.sources.products.scrape_promotions",      "run")],
    ],
    "news": [
        [("backend.scraping.sources.news.scrape_news",                "run")],
    ],
    "seo": [
        [("backend.scraping.sources.seo.scrape_seo",                  "run")],
    ],
    # Enrichment: every substep reads from a different scraped table and
    # writes back to a separate column/table → fully parallelizable.
    "enrichment": [
        [("backend.scraping.enrichment.ai_enricher",                  "run"),
         ("backend.scraping.enrichment.tiktok_enrichment",            "run"),
         ("backend.scraping.enrichment.twitter_enrichment",           "run"),
         ("backend.scraping.enrichment.reddit_backfill",              "run"),
         ("backend.scraping.enrichment.influencer_sponsored",         "run"),
         ("backend.scraping.enrichment.analyze_videos",               "run")],
    ],
    # Facts: mention_facts must come before topic_lifecycle; product_mentions
    # must come before product_attention; competitor_switch + instagram_themes
    # are independent.
    "facts": [
        [("backend.scraping.facts.mention_facts",                     "run"),
         ("backend.scraping.facts.competitor_switch",                 "run"),
         ("backend.scraping.facts.instagram_themes",                  "run"),
         ("backend.scraping.facts.populate_product_mentions",         "run")],
        [("backend.scraping.facts.topic_lifecycle",                   "run"),
         ("backend.scraping.facts.populate_product_attention",        "run")],
    ],
    "intelligence": [
        [("backend.scraping.sources.youtube.scrape_transcripts",      "run")],
        [("backend.scraping.enrichment.analyze_videos",               "run")],
        [("backend.scraping.facts.populate_product_mentions",         "run")],
        [("backend.scraping.facts.populate_product_attention",        "run")],
    ],
    "sales-intelligence": [
        [("backend.scraping.sales_intelligence.discover",             "run")],
        [("backend.scraping.sales_intelligence.scrape_inventory",     "run")],
        [("backend.scraping.sales_intelligence.estimate",             "run"),
         ("backend.scraping.sales_intelligence.restock",              "run"),
         ("backend.scraping.sales_intelligence.sellout",              "run"),
         ("backend.scraping.sales_intelligence.launches",             "run")],
        [("backend.scraping.sales_intelligence.revenue",              "run"),
         ("backend.scraping.sales_intelligence.correlation",          "run")],
    ],
    "maintenance": [
        [("backend.scraping.maintenance.backfill_youtube_comments",   "run"),
         ("backend.scraping.maintenance.backfill_athlete_names",      "run")],
        [("backend.scraping.maintenance.validate_data",               "run")],
        [("backend.scraping.maintenance.count_rows",                  "run")],
    ],
}

# ── Phases ────────────────────────────────────────────────────────────────────
# When --module=all, modules in a phase run in parallel; phases run in order.
# This respects the real dependencies: enrichment needs scraped data, facts
# need enriched data, sales-intel needs facts.
PHASES: list[list[str]] = [
    # Phase 1 — independent scraping channels
    ["instagram", "youtube", "reddit", "twitter", "tiktok",
     "ads", "products", "news", "seo"],
    # Phase 2 — AI enrichment on freshly scraped rows
    ["enrichment"],
    # Phase 3 — facts derived from enriched rows
    ["facts"],
    # Phase 4 — sales-intelligence derived from facts
    ["sales-intelligence"],
]

# Default thread pool size: tuned for I/O-bound work (HTTP to Apify/Supabase/OpenAI).
# 8 lets the heaviest scraper sit alongside ~7 lighter ones without bottlenecking.
DEFAULT_MAX_WORKERS = 8


# ── Helpers ───────────────────────────────────────────────────────────────────
def _step_key_for(mod_path: str) -> str:
    """Build a unique step_key from <parent>_<filename>."""
    parts = mod_path.split(".")
    parent = parts[-2] if len(parts) >= 2 else ""
    filename = parts[-1]
    return f"{parent}_{filename}" if parent else filename


def _filter_source(groups: Module, source: str | None) -> Module:
    """Drop steps that don't match --source filter. Empty groups removed."""
    if not source:
        return groups
    src_norm = source.replace("-", "_")
    filtered: Module = []
    for group in groups:
        kept = []
        for mod_path, fn in group:
            step_key = _step_key_for(mod_path)
            filename = mod_path.rsplit(".", 1)[-1]
            if step_key == src_norm or filename == src_norm:
                kept.append((mod_path, fn))
        if kept:
            filtered.append(kept)
    return filtered


def _import_and_run(mod_path: str, fn_name: str, ctx: dict) -> int:
    import importlib
    mod = importlib.import_module(mod_path)
    fn = getattr(mod, fn_name)
    result = fn(ctx)
    return result if isinstance(result, int) else 0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Step execution ────────────────────────────────────────────────────────────
def _run_step(step: Step, ctx: dict, cp: Checkpoint, dry_run: bool,
              restart: bool) -> tuple[str, int, str | None]:
    """Execute a single step. Returns (step_key, rows, error_msg)."""
    mod_path, fn_name = step
    step_key = _step_key_for(mod_path)

    if cp.is_done(step_key) and not restart:
        log.info("  ⏭  %s — skipped (already done)", step_key)
        return step_key, 0, None

    if dry_run:
        log.info("  [DRY-RUN] would run: %s.%s", mod_path, fn_name)
        return step_key, 0, None

    cp.mark_running(step_key)
    log.info("▶ %s starting at %s", step_key, _now())
    try:
        rows = _import_and_run(mod_path, fn_name, ctx)
        cp.mark_done(step_key, rows=rows)
        log.info("✓ %s done — rows=%d", step_key, rows)
        return step_key, rows, None
    except Exception as e:
        tb = traceback.format_exc()
        cp.mark_failed(step_key, f"{type(e).__name__}: {e}", tb)
        log.error("✗ %s failed: %s", step_key, e)
        return step_key, 0, f"{type(e).__name__}: {e}"


def _run_group_parallel(group: Group, ctx: dict, cp: Checkpoint,
                        dry_run: bool, restart: bool,
                        max_workers: int) -> tuple[int, list[str]]:
    """Run all steps in a parallel group concurrently."""
    if len(group) == 1:
        # No point spinning up a worker for one step
        _, rows, err = _run_step(group[0], ctx, cp, dry_run, restart)
        return rows, ([_step_key_for(group[0][0])] if err else [])

    log.info("◆ parallel group (%d steps): %s",
             len(group), [_step_key_for(s[0]) for s in group])
    total = 0
    failed: list[str] = []
    with cf.ThreadPoolExecutor(max_workers=min(max_workers, len(group))) as pool:
        futures = {pool.submit(_run_step, step, ctx, cp, dry_run, restart): step
                   for step in group}
        for fut in cf.as_completed(futures):
            try:
                step_key, rows, err = fut.result()
                total += rows
                if err:
                    failed.append(step_key)
            except Exception as e:
                # _run_step normally catches; this is belt-and-suspenders
                step = futures[fut]
                failed.append(_step_key_for(step[0]))
                log.error("Worker crashed for %s: %s", step[0], e)
    return total, failed


def _run_module(module: str, ctx: dict, cp: Checkpoint, dry_run: bool,
                restart: bool, parallel: bool, source: str | None,
                max_workers: int) -> tuple[int, list[str]]:
    """Run all groups in a module. Groups in order; steps within a group
    in parallel (or sequentially if parallel=False)."""
    groups = MODULE_STEPS.get(module)
    if groups is None:
        log.error("Unknown module: %s. Valid: %s", module, ", ".join(MODULE_STEPS))
        return 0, [module]
    groups = _filter_source(groups, source)
    if not groups:
        log.warning("No steps matched module=%s source=%s", module, source)
        return 0, []

    log.info("\n━━━ Module: %s (%d groups) ━━━", module, len(groups))
    total = 0
    failed: list[str] = []
    for group in groups:
        if parallel:
            rows, errs = _run_group_parallel(group, ctx, cp, dry_run, restart, max_workers)
        else:
            rows = 0; errs = []
            for step in group:
                _, r, e = _run_step(step, ctx, cp, dry_run, restart)
                rows += r
                if e: errs.append(_step_key_for(step[0]))
        total += rows
        failed.extend(errs)
    return total, failed


def _run_phase_parallel(modules: list[str], ctx: dict, cp: Checkpoint,
                        dry_run: bool, restart: bool, parallel: bool,
                        source: str | None, max_workers: int
                        ) -> tuple[int, list[str]]:
    """Run multiple modules in parallel (Phase 1 = all scraping channels)."""
    valid = [m for m in modules if m in MODULE_STEPS]
    if not valid:
        return 0, []
    if not parallel or len(valid) == 1:
        total = 0; failed: list[str] = []
        for m in valid:
            r, e = _run_module(m, ctx, cp, dry_run, restart, parallel, source, max_workers)
            total += r; failed.extend(e)
        return total, failed

    log.info("\n╔═══ Phase running %d modules in parallel: %s ═══╗",
             len(valid), ", ".join(valid))
    total = 0; failed: list[str] = []
    with cf.ThreadPoolExecutor(max_workers=min(max_workers, len(valid))) as pool:
        futures = {pool.submit(_run_module, m, ctx, cp, dry_run, restart,
                               parallel, source, max_workers): m for m in valid}
        for fut in cf.as_completed(futures):
            m = futures[fut]
            try:
                rows, errs = fut.result()
                total += rows
                failed.extend(errs)
                log.info("◀ Module %s finished (rows=%d, failed=%d)", m, rows, len(errs))
            except Exception as e:
                log.error("Module %s crashed: %s", m, e)
                failed.append(m)
    return total, failed


# ── Main ──────────────────────────────────────────────────────────────────────
def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="JOOLA Intel Pipeline v2 (parallel runner)")
    parser.add_argument("--module", default="all",
                        help="Module: all | instagram | youtube | reddit | twitter | "
                             "tiktok | ads | products | news | seo | enrichment | facts | "
                             "sales-intelligence | intelligence | maintenance")
    parser.add_argument("--source", default=None,
                        help="Specific sub-source within a module (e.g. scrape-catalog-local)")
    parser.add_argument("--brands", default=None,
                        help="Comma-separated brand slugs to limit scraping")
    parser.add_argument("--dry-run", action="store_true",
                        help="Log what would run without making API calls or DB writes")
    parser.add_argument("--restart", action="store_true",
                        help="Ignore existing checkpoint, start fresh")
    parser.add_argument("--no-resume", action="store_true",
                        help="Alias for --restart")
    parser.add_argument("--no-parallel", action="store_true",
                        help="Force sequential execution (default: parallel)")
    parser.add_argument("--max-workers", type=int, default=DEFAULT_MAX_WORKERS,
                        help=f"Thread pool size (default: {DEFAULT_MAX_WORKERS})")
    parser.add_argument("--limit", type=int, default=None,
                        help="Per-step row cap for smoke tests")
    args = parser.parse_args(argv)

    if not args.dry_run:
        try:
            require_supabase()
            require_apify()
        except Exception as e:
            log.error("Credential check failed: %s", e)
            sys.exit(1)

    ctx = {
        "dry_run": args.dry_run,
        "brands":  [b.strip() for b in args.brands.split(",")] if args.brands else None,
        "limit":   args.limit,
    }

    cp = Checkpoint()
    if args.restart or args.no_resume:
        cp.reset()
        log.info("Checkpoint reset — starting fresh")
    else:
        cp.load()

    parallel = not args.no_parallel

    log.info("Run ID: %s", cp.run_id)
    log.info("Module: %s  dry_run=%s  parallel=%s  workers=%d  brands=%s",
             args.module, args.dry_run, parallel, args.max_workers, ctx["brands"])

    total = 0
    failed: list[str] = []
    try:
        if args.module == "all":
            for i, phase in enumerate(PHASES, 1):
                log.info("\n══════════════════════════════════════════════")
                log.info("PHASE %d/%d: %s", i, len(PHASES), ", ".join(phase))
                log.info("══════════════════════════════════════════════")
                rows, errs = _run_phase_parallel(
                    phase, ctx, cp, args.dry_run, args.restart,
                    parallel, args.source, args.max_workers,
                )
                total += rows
                failed.extend(errs)
        else:
            rows, errs = _run_module(
                args.module, ctx, cp, args.dry_run, args.restart,
                parallel, args.source, args.max_workers,
            )
            total += rows
            failed.extend(errs)
    except KeyboardInterrupt:
        log.warning("\n  ⓘ Interrupted. State saved; rerun to resume.")
        sys.exit(0)

    log.info("\n%s", "=" * 55)
    log.info("Pipeline finished. Total rows: %d", total)
    for step_key, entry in sorted(cp.summary().items()):
        log.info("  %-32s %-10s rows=%s",
                 step_key, entry.get("status", "-"), entry.get("rows", "-"))
    if failed:
        log.warning("Failed steps: %s", ", ".join(failed))
    log.info("=" * 55)


if __name__ == "__main__":
    main()
