"""JOOLA Intel Analytics Backend — CLI runner.

Mirrors backend.scraping.run but simpler: sequential execution (modules are
short-running statistical jobs, not 30-min scrapers).

Usage:
  python -m analytics_backend.run --module all
  python -m analytics_backend.run --module marts
  python -m analytics_backend.run --module statistics
  python -m analytics_backend.run --module statistics --source granger
  python -m analytics_backend.run --module all --dry-run
"""
from __future__ import annotations

import argparse
import importlib
import logging
import sys
import traceback
from datetime import datetime, timezone

# Module registry — each entry is a list of parallel groups (inner list = could
# run in parallel; outer list = sequential). We keep the data shape identical
# to backend.scraping.run so future code can be lifted between the two.
Step = tuple[str, str]          # (dotted_module, fn_name)
Group = list[Step]
Module = list[Group]

MODULE_STEPS: dict[str, Module] = {
    "marts": [
        # Phase A — calendar must exist before timeseries can join on it
        [("analytics_backend.marts.refresh_calendar", "run")],
        # Phase B — helpers are independent (each writes its own table)
        [("analytics_backend.marts.refresh_helpers", "run")],
        # Phase C — main mart joins everything together
        [("analytics_backend.marts.refresh_timeseries", "run")],
    ],
    "statistics": [
        # All four read from joola_timeseries_daily and write to analysis_results
        # with their own `kind` tag; independent.
        [("analytics_backend.statistics.correlation_scan", "run"),
         ("analytics_backend.statistics.cross_correlation", "run"),
         ("analytics_backend.statistics.changepoints",      "run"),
         ("analytics_backend.statistics.granger",           "run")],
    ],
}

# Order matters: marts must be fresh before statistics read them.
PHASES: list[list[str]] = [["marts"], ["statistics"]]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("analytics_backend")


def _step_key(mod_path: str) -> str:
    parts = mod_path.split(".")
    return f"{parts[-2]}_{parts[-1]}" if len(parts) >= 2 else parts[-1]


def _filter_source(module: Module, source: str | None) -> Module:
    if not source:
        return module
    src = source.replace("-", "_")
    out: Module = []
    for group in module:
        kept = [s for s in group if _step_key(s[0]) == src or s[0].rsplit(".", 1)[-1] == src]
        if kept:
            out.append(kept)
    return out


def _run_step(step: Step, ctx: dict, dry_run: bool) -> tuple[str, int, str | None]:
    mod_path, fn_name = step
    key = _step_key(mod_path)

    if dry_run:
        log.info("  [DRY-RUN] would run: %s.%s", mod_path, fn_name)
        return key, 0, None

    log.info(">> %s starting", key)
    try:
        mod = importlib.import_module(mod_path)
        fn = getattr(mod, fn_name)
        result = fn(ctx)
        rows = result if isinstance(result, int) else 0
        log.info("OK %s done -- rows=%d", key, rows)
        return key, rows, None
    except Exception as exc:
        log.error("FAIL %s: %s\n%s", key, exc, traceback.format_exc())
        return key, 0, f"{type(exc).__name__}: {exc}"


def _run_module(name: str, ctx: dict, dry_run: bool, source: str | None
                ) -> tuple[int, list[str]]:
    groups = MODULE_STEPS.get(name)
    if not groups:
        log.error("Unknown module: %s. Valid: %s", name, ", ".join(MODULE_STEPS))
        return 0, [name]
    groups = _filter_source(groups, source)
    if not groups:
        log.warning("No steps matched module=%s source=%s", name, source)
        return 0, []

    log.info("\n--- Module: %s (%d groups) ---", name, len(groups))
    total = 0
    failed: list[str] = []
    for group in groups:
        for step in group:
            key, rows, err = _run_step(step, ctx, dry_run)
            total += rows
            if err:
                failed.append(key)
    return total, failed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="JOOLA Analytics Backend")
    parser.add_argument("--module", default="all",
                        help="all | marts | statistics")
    parser.add_argument("--source", default=None,
                        help="Specific sub-step within a module (e.g. granger)")
    parser.add_argument("--brands", default=None,
                        help="Comma-separated brand slugs to limit analysis")
    parser.add_argument("--dry-run", action="store_true",
                        help="Log what would run without executing")
    args = parser.parse_args(argv)

    ctx = {
        "dry_run": args.dry_run,
        "brands":  [b.strip() for b in args.brands.split(",")] if args.brands else None,
    }

    log.info("Run start: %s", datetime.now(timezone.utc).isoformat())
    log.info("Module: %s  source=%s  dry_run=%s  brands=%s",
             args.module, args.source, args.dry_run, ctx["brands"])

    total = 0
    failed: list[str] = []
    if args.module == "all":
        for i, phase in enumerate(PHASES, 1):
            log.info("\n====== PHASE %d/%d: %s ======", i, len(PHASES), ", ".join(phase))
            for mod in phase:
                rows, errs = _run_module(mod, ctx, args.dry_run, args.source)
                total += rows
                failed.extend(errs)
    else:
        rows, errs = _run_module(args.module, ctx, args.dry_run, args.source)
        total += rows
        failed.extend(errs)

    log.info("\n%s", "=" * 55)
    log.info("Analytics finished. Total rows: %d", total)
    if failed:
        log.warning("Failed steps: %s", ", ".join(failed))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
