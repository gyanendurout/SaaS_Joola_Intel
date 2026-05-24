"""
JOOLA Intel — Weekly Intelligence Pipeline
==========================================
Single entry point for every weekly data refresh. Run from the repo root:

  python scripts/weekly_run.py                     # full fresh weekly run
  python scripts/weekly_run.py --resume            # continue if interrupted
  python scripts/weekly_run.py --module products   # one module only
  python scripts/weekly_run.py --module instagram
  python scripts/weekly_run.py --module youtube
  python scripts/weekly_run.py --module reddit
  python scripts/weekly_run.py --module twitter
  python scripts/weekly_run.py --module tiktok
  python scripts/weekly_run.py --module ads
  python scripts/weekly_run.py --module enrichment
  python scripts/weekly_run.py --module facts
  python scripts/weekly_run.py --brands joola,selkirk    # limit to specific brands
  python scripts/weekly_run.py --dry-run                 # preview without API calls

Pipeline order (--module all):
  1. instagram    — profiles, posts, comments, influencer posts
  2. youtube      — channels, videos, comments, transcripts
  3. reddit       — mentions, comment threads
  4. twitter      — brand posts, athlete posts
  5. tiktok       — brand videos
  6. ads          — Meta Ads Library, Google Ads Transparency
  7. products     — product catalog (name/price/rating/reviews), promotions
  8. news         — brand news mentions
  9. seo          — brand SEO metrics
  10. enrichment  — GPT-4o-mini sentiment, NER, crisis flags
  11. facts       — mention facts, topic lifecycle, competitor-switch signals
  12. sales-intel — revenue estimates, restock signals, launch detection

Logs written to: c:/tmp/joola_weekly_YYYYMMDD_HHMM.log
State saved to: pipeline_v2_state.json (auto-resume on re-run after crash)
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).parent.parent
ENV_FILE  = REPO_ROOT / ".env"

# Add repo root to path so `backend.scraping.*` and `analytics_backend.*`
# imports resolve when this script is invoked as `python scripts/weekly_run.py`.
sys.path.insert(0, str(REPO_ROOT))

# ── Environment ────────────────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv(ENV_FILE)
    load_dotenv(REPO_ROOT / "scripts" / ".env")   # legacy fallback
except ImportError:
    pass  # python-dotenv optional; env vars can be set in shell instead

# ── Logging ────────────────────────────────────────────────────────────────────
LOG_DIR = Path("c:/tmp")
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / f"joola_weekly_{datetime.now().strftime('%Y%m%d_%H%M')}.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(str(LOG_FILE), encoding="utf-8"),
    ],
)
log = logging.getLogger("weekly")

# Required env vars for a live run
_REQUIRED_VARS = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "APIFY_TOKEN",
]


def _check_env() -> list[str]:
    return [v for v in _REQUIRED_VARS if not os.environ.get(v)]


def _banner(args: argparse.Namespace) -> None:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    log.info("=" * 65)
    log.info("  JOOLA Intel — Weekly Intelligence Pipeline")
    log.info("  %s", now)
    log.info("  module=%s  resume=%s  dry_run=%s", args.module, args.resume, args.dry_run)
    if args.brands:
        log.info("  brands=%s", args.brands)
    log.info("  Log: %s", LOG_FILE)
    log.info("=" * 65)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="JOOLA Intel weekly pipeline runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--module", default="all",
        help=(
            "Module to run (default: all). Options: all | instagram | youtube | "
            "reddit | twitter | tiktok | ads | products | news | seo | "
            "enrichment | facts | sales-intelligence | intelligence | maintenance"
        ),
    )
    parser.add_argument(
        "--resume", action="store_true",
        help="Resume a previously interrupted run (skip already-done steps). "
             "Default: fresh weekly restart.",
    )
    parser.add_argument(
        "--brands", default=None,
        help="Comma-separated brand slugs to limit scraping (e.g. joola,selkirk). "
             "Default: all 11 brands.",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Log what would run without making API calls or DB writes.",
    )
    parser.add_argument(
        "--source", default=None,
        help="Sub-source within a module (e.g. scrape-catalog, scrape-promotions).",
    )
    args = parser.parse_args()

    _banner(args)

    # Credential check — fail fast before spending time on imports
    if not args.dry_run:
        missing = _check_env()
        if missing:
            log.error("Missing required environment variables: %s", ", ".join(missing))
            log.error("Add them to: %s", ENV_FILE)
            log.error("Or export them in your shell before running.")
            return 1

    # Build argv for v2/run.py main()
    # Weekly runs default to --restart (fresh) unless --resume is given
    pipeline_argv: list[str] = ["--module", args.module]
    if not args.resume:
        pipeline_argv.append("--restart")
    if args.dry_run:
        pipeline_argv.append("--dry-run")
    if args.brands:
        pipeline_argv.extend(["--brands", args.brands])
    if args.source:
        pipeline_argv.extend(["--source", args.source])

    log.info("Pipeline args: %s", " ".join(pipeline_argv))
    log.info("")

    # Phase 1-4 — scraping pipeline (instagram, youtube, …, enrichment, facts)
    try:
        from backend.scraping.run import main as _scraping_main
        _scraping_main(pipeline_argv)
    except SystemExit as exc:
        code = exc.code if isinstance(exc.code, int) else (1 if exc.code else 0)
        if code != 0:
            log.error("Scraping pipeline exited with code %d", code)
            return code
    except KeyboardInterrupt:
        log.warning("Run interrupted by user. Re-run without --restart to resume.")
        return 130
    except Exception as exc:
        log.exception("Unexpected error in scraping phase: %s", exc)
        return 1

    # Phase 5 — analytics backend (marts + statistical jobs).
    # Only runs when --module is all or analytics; other module filters
    # are scraping-specific and should not trigger analytics.
    if args.module in ("all", "analytics"):
        log.info("")
        log.info("=" * 65)
        log.info("  Scraping done. Starting analytics backend.")
        log.info("=" * 65)
        try:
            from analytics_backend.run import main as _analytics_main
            analytics_argv: list[str] = ["--module", "all"]
            if args.dry_run:
                analytics_argv.append("--dry-run")
            if args.brands:
                analytics_argv.extend(["--brands", args.brands])
            _analytics_main(analytics_argv)
        except SystemExit as exc:
            code = exc.code if isinstance(exc.code, int) else (1 if exc.code else 0)
            if code != 0:
                log.error("Analytics backend exited with code %d", code)
                return code
        except Exception as exc:
            log.exception("Unexpected error in analytics phase: %s", exc)
            return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
