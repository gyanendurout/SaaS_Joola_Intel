"""JOOLA Intel Analytics Backend — CLI runner (skeleton).

Mirrors the scraping runner: phase/group/step parallel execution, checkpointed,
brand-filter aware, dry-run capable. Modules are not yet implemented — see
docs/superpowers/specs/2026-05-24-analytics-mvp-design.md for the build plan.

Usage:
  python -m analytics_backend.run --module all
  python -m analytics_backend.run --module marts
  python -m analytics_backend.run --module statistics
  python -m analytics_backend.run --module statistics --source granger
  python -m analytics_backend.run --module all --dry-run
"""
from __future__ import annotations

import argparse
import sys

# Module registry — populated as we implement each step in Phase 2.
# Format identical to backend/scraping/run.py: list of parallel groups.
MODULE_STEPS: dict[str, list[list[tuple[str, str]]]] = {
    "marts": [
        # Phase A — calendar must exist before timeseries can join on it
        [("analytics_backend.marts.refresh_calendar", "run")],
        # Phase B — helpers can run in parallel (each writes its own table)
        [("analytics_backend.marts.refresh_helpers", "run")],
        # Phase C — main mart joins everything together
        [("analytics_backend.marts.refresh_timeseries", "run")],
    ],
    "statistics": [
        # All four can run in parallel; each reads from joola_timeseries_daily
        # and writes to analysis_results with its own `kind` tag
        [("analytics_backend.statistics.correlation_scan", "run"),
         ("analytics_backend.statistics.cross_correlation", "run"),
         ("analytics_backend.statistics.changepoints",      "run"),
         ("analytics_backend.statistics.granger",           "run")],
    ],
}

PHASES = [["marts"], ["statistics"]]


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="JOOLA Analytics Backend")
    parser.add_argument("--module", default="all",
                        help="all | marts | statistics")
    parser.add_argument("--source", default=None,
                        help="Specific sub-step within a module")
    parser.add_argument("--brands", default=None,
                        help="Comma-separated brand slugs")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-parallel", action="store_true")
    args = parser.parse_args(argv)

    # TODO(phase-2): wire in Checkpoint + parallel runner mirroring scraping/run.py
    # For now this is a stub so weekly_run.py can call it without erroring.
    if args.dry_run:
        print(f"[analytics_backend DRY-RUN] module={args.module} source={args.source} "
              f"brands={args.brands} parallel={not args.no_parallel}")
        if args.module == "all":
            for phase in PHASES:
                for mod in phase:
                    for group in MODULE_STEPS.get(mod, []):
                        for step in group:
                            print(f"  would run: {step[0]}.{step[1]}")
        return

    print("analytics_backend: not yet implemented. "
          "See docs/superpowers/specs/2026-05-24-analytics-mvp-design.md")
    sys.exit(0)


if __name__ == "__main__":
    main()
