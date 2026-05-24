"""
JOOLA Intel Pipeline v2 — Scheduler

Runs two recurring jobs:
  • News scraping: every 6 hours
  • SEO scraping:  every Monday at 03:00 UTC

Usage:
  python -m scripts.scraping.scheduler
  python -m scripts.scraping.scheduler --dry-run
"""

from __future__ import annotations

import argparse
import sys

from .core.logger import get_logger

log = get_logger("scheduler")


def _run_news(dry_run: bool = False) -> None:
    log.info("Scheduler: triggering news scrape")
    if dry_run:
        log.info("[DRY-RUN] would run news scrape")
        return
    from .run import main as run_main
    run_main(["--module", "news"])


def _run_seo(dry_run: bool = False) -> None:
    log.info("Scheduler: triggering SEO scrape")
    if dry_run:
        log.info("[DRY-RUN] would run SEO scrape")
        return
    from .run import main as run_main
    run_main(["--module", "seo"])


def start(dry_run: bool = False) -> None:
    try:
        from apscheduler.schedulers.blocking import BlockingScheduler
        from apscheduler.triggers.cron import CronTrigger
        from apscheduler.triggers.interval import IntervalTrigger
    except ImportError:
        log.error("APScheduler not installed. Run: pip install apscheduler")
        sys.exit(1)

    scheduler = BlockingScheduler(timezone="UTC")

    # News: every 6 hours
    scheduler.add_job(
        _run_news,
        trigger=IntervalTrigger(hours=6),
        id="news_scrape",
        name="News Scrape (6h)",
        kwargs={"dry_run": dry_run},
        replace_existing=True,
    )

    # SEO: every Monday at 03:00 UTC
    scheduler.add_job(
        _run_seo,
        trigger=CronTrigger(day_of_week="mon", hour=3, minute=0, timezone="UTC"),
        id="seo_scrape",
        name="SEO Scrape (Mon 03:00 UTC)",
        kwargs={"dry_run": dry_run},
        replace_existing=True,
    )

    log.info("Scheduler started:")
    log.info("  • News scrape: every 6 hours")
    log.info("  • SEO scrape:  every Monday 03:00 UTC")
    log.info("  dry_run=%s", dry_run)
    log.info("Press Ctrl-C to stop.")

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        log.info("Scheduler stopped.")


def main() -> None:
    parser = argparse.ArgumentParser(description="JOOLA Intel Pipeline v2 Scheduler")
    parser.add_argument("--dry-run", action="store_true",
                        help="Log scheduled jobs without running them")
    args = parser.parse_args()
    start(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
