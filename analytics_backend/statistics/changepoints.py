"""Ruptures PELT changepoint detection on smoothed daily series.

Spec:    docs/superpowers/specs/2026-05-24-analytics-mvp-design.md §6.6
Schema:  migrations/013_analytics_foundation.sql §5.4 / §5.5

For each (brand, top-10 product) × series in [attention_score,
estimated_units_sold, ad_pressure_score]:
- Pull last 180 days
- 7-day rolling mean smoothing
- `ruptures.Pelt(model='rbf').fit(smoothed).predict(pen=8)`
- Persist breakpoint dates (excluding the trailing end-of-series sentinel)
  as `kind='changepoint'` rows in `analysis_results`.
"""
from __future__ import annotations

import concurrent.futures
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

import pandas as pd

from backend.scraping.core import supabase_client as sb
from backend.scraping.core.logger import get_logger

log = get_logger("statistics.changepoints")

_WINDOW_DAYS = 180
_TOP_N_PRODUCTS = 10
# Lowered from 30 -> 5: product_attention_daily is sparse (~5-15 days
# per product); brand-level rollup has 100+ daily rows so it stays well
# above this threshold. Raise back to 30 once historical backfill grows.
_MIN_OBS = 5
# Lowered from 7 -> 3: with sparse data the 7-day window dropped the
# first 6 observations entirely.
_SMOOTH_WINDOW = 3
_PENALTY = 8
_MODEL = "rbf"
# Dropped estimated_units_sold (always NULL until sales_estimates populates)
# and added mention_count which is dense in the MV. Once units-sold data
# exists, add it back to this tuple.
_SERIES = ("attention_score", "mention_count", "ad_pressure_score")
_MAX_WORKERS = 4  # ruptures is CPU-heavy; keep modest


# ─── shared helpers ────────────────────────────────────────────────────────

def _today() -> date:
    return datetime.now(timezone.utc).date()


def _window_start() -> date:
    return _today() - timedelta(days=_WINDOW_DAYS)


def _load_brand_map() -> dict[str, str]:
    rows = sb.get("brands", select="id,slug")
    return {r["slug"]: r["id"] for r in rows if r.get("slug") and r.get("id")}


def _filter_brand_ids(
    brand_map: dict[str, str], brands: Iterable[str] | None
) -> list[str]:
    if not brands:
        return list(brand_map.values())
    wanted = {b.strip().lower() for b in brands if b}
    return [bid for slug, bid in brand_map.items() if slug.lower() in wanted]


def _fetch_brand_window(brand_id: str) -> pd.DataFrame:
    start = _window_start().isoformat()
    select = (
        "metric_date,brand_id,canonical_product_id,canonical_product_name,"
        "attention_score,ad_pressure_score,promo_active_flag,"
        "estimated_units_sold"
    )
    filters = (
        f"brand_id=eq.{brand_id}"
        f"&metric_date=gte.{start}"
        f"&order=metric_date.asc"
        f"&limit=100000"
    )
    try:
        rows = sb.get_filtered("joola_timeseries_daily", select=select, filters=filters)
    except Exception as exc:
        log.error("fetch failed for brand %s: %s", brand_id, exc)
        return pd.DataFrame()
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df["metric_date"] = pd.to_datetime(df["metric_date"], errors="coerce")
    df = df.dropna(subset=["metric_date"])
    return df


def _top_products(df: pd.DataFrame, n: int = _TOP_N_PRODUCTS) -> list[str]:
    if df.empty or "canonical_product_id" not in df.columns:
        return []
    sub = df.dropna(subset=["canonical_product_id"])
    if sub.empty:
        return []
    grouped = (
        sub.assign(attention_score=pd.to_numeric(sub["attention_score"], errors="coerce"))
        .groupby("canonical_product_id")["attention_score"]
        .sum(min_count=1)
        .sort_values(ascending=False)
    )
    return [pid for pid in grouped.head(n).index.tolist() if pid]


def _product_series(df: pd.DataFrame, product_id: str, column: str) -> pd.Series:
    if column not in df.columns:
        return pd.Series(dtype="float64")
    sub = df[df["canonical_product_id"] == product_id]
    if sub.empty:
        return pd.Series(dtype="float64")
    s = (
        sub.set_index("metric_date")[column]
        .apply(pd.to_numeric, errors="coerce")
        .groupby(level=0)
        .mean()
        .sort_index()
    )
    if s.empty:
        return s
    try:
        s = s.asfreq("D")
        s = s.interpolate(method="time", limit=2)
    except Exception:
        pass
    return s.astype(float)


# ─── changepoint core ──────────────────────────────────────────────────────

def _changepoint_one(
    brand_id: str,
    lookup_pid: str,
    stored_pid: str | None,
    series_name: str,
    df: pd.DataFrame,
    run_date: date,
) -> dict[str, Any] | None:
    try:
        import ruptures as rpt  # type: ignore
    except Exception as exc:
        log.warning("ruptures unavailable: %s", exc)
        return None

    try:
        raw = _product_series(df, lookup_pid, series_name)
        if raw.empty:
            return None
        smoothed = raw.rolling(window=_SMOOTH_WINDOW, min_periods=_SMOOTH_WINDOW).mean()
        smoothed = smoothed.dropna()
        if len(smoothed) < _MIN_OBS:
            return None

        arr = smoothed.to_numpy()
        if float(arr.std()) == 0.0:
            return None

        try:
            algo = rpt.Pelt(model=_MODEL).fit(arr)
            bkps = algo.predict(pen=_PENALTY)
        except Exception as exc:
            log.warning("ruptures fit/predict failed: %s", exc)
            return None

        # Ruptures always appends len(series) as the trailing sentinel.
        idx_series = smoothed.index
        cp_dates: list[str] = []
        for bkp in bkps:
            if bkp >= len(arr):
                continue
            try:
                ts = idx_series[bkp]
                cp_dates.append(pd.Timestamp(ts).date().isoformat())
            except Exception:
                continue

        payload: dict[str, Any] = {
            "changepoint_dates": cp_dates,
            "smoothing_window": _SMOOTH_WINDOW,
            "model": _MODEL,
            "penalty": _PENALTY,
            "n_changepoints": len(cp_dates),
        }

        return {
            "kind": "changepoint",
            "brand_id": brand_id,
            "product_id": stored_pid,
            "driver": series_name,
            "target": series_name,
            "metric_date": run_date.isoformat(),
            "payload": payload,
            "n_samples": int(len(smoothed)),
            "best_lag": None,
            "best_score": float(len(cp_dates)),
            "best_pvalue": None,
        }
    except Exception as exc:
        log.warning(
            "changepoint failed brand=%s product=%s series=%s: %s",
            brand_id, stored_pid, series_name, exc,
        )
        return None


# ─── runner ────────────────────────────────────────────────────────────────

def run(ctx: dict[str, Any]) -> int:
    dry_run = bool(ctx.get("dry_run"))
    brands = ctx.get("brands")
    run_date = _today()

    brand_map = _load_brand_map()
    brand_ids = _filter_brand_ids(brand_map, brands)
    log.info("changepoints: %d brands in scope", len(brand_ids))

    # Each task: (brand_id, lookup_pid, stored_pid, series_name, df)
    #   lookup_pid is used to filter `df` inside _product_series
    #   stored_pid is what gets persisted to analysis_results.product_id
    # For brand-level rollup these differ (lookup uses a synthetic sentinel
    # so the series aggregates across all products; stored is None so the
    # page shows it as a brand-wide signal).
    BRAND_AGG = "__brand_agg__"
    tasks: list[tuple[str, str, str | None, str, pd.DataFrame]] = []
    for brand_id in brand_ids:
        df = _fetch_brand_window(brand_id)
        if df.empty:
            continue

        present_series = [s for s in _SERIES if s in df.columns]
        if not present_series:
            continue

        # Brand-level: 100+ daily obs even when individual products are sparse.
        brand_df = df.copy()
        brand_df["canonical_product_id"] = BRAND_AGG
        for series_name in present_series:
            tasks.append((brand_id, BRAND_AGG, None, series_name, brand_df))

        # Product-level (original). Many products will still skip via
        # _MIN_OBS, but the brand-level row above guarantees data.
        products = _top_products(df)
        for product_id in products:
            for series_name in present_series:
                tasks.append((brand_id, product_id, product_id, series_name, df))

    if not tasks:
        log.info("changepoints: nothing to do")
        return 0
    if dry_run:
        log.info("[dry-run] would run %d changepoint detections", len(tasks))
        return 0

    rows: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        futures = [
            pool.submit(_changepoint_one, b, lp, sp, sn, df, run_date)
            for (b, lp, sp, sn, df) in tasks
        ]
        for fut in concurrent.futures.as_completed(futures):
            row = fut.result()
            if row is not None:
                rows.append(row)

    if not rows:
        log.info("changepoints: no rows produced")
        return 0

    n = sb.upsert(
        "analysis_results",
        rows,
        on_conflict="kind,brand_id,product_id,driver,target,metric_date",
    )
    log.info("changepoints: upserted %d rows", n)
    return int(n)
