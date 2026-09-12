"""statsmodels CCF on STL-deseasonalized series.

Spec:    docs/superpowers/specs/2026-05-24-analytics-mvp-design.md §6.5
Schema:  migrations/013_analytics_foundation.sql §5.4 / §5.5

For each (brand, top-10 product, driver) × target=estimated_units_sold,
compute statsmodels.tsa.stattools.ccf for lags 0..28 on the STL-
deseasonalized (period=7) series. Persist with 95% confidence band as
`kind='ccf'` in `analysis_results`.
"""
from __future__ import annotations

import concurrent.futures
import math
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

import pandas as pd

from backend.scraping.core import supabase_client as sb
from backend.scraping.core.logger import get_logger

log = get_logger("statistics.cross_correlation")

_WINDOW_DAYS = 180
_TOP_N_PRODUCTS = 10
_MAX_LAG = 28
_MIN_OBS = 30
# Was: estimated_units_sold. That column is 100% NULL in joola_timeseries_daily
# (sales_estimates has never populated), so `pair.dropna()` in _ccf_one emptied
# every pair and this module has never written a single kind='ccf' row.
# mention_count is dense. correlation_scan.py and changepoints.py already made
# this exact switch; it was never propagated here.
_TARGET = "mention_count"
# yt_transcript_attention is not a column of joola_timeseries_daily, so run()'s
# `present_drivers` filter silently dropped it. Removed so _DRIVERS reflects
# what is actually scanned.
_DRIVERS = (
    "attention_score",
    "ad_pressure_score",
    "promo_active_flag",
)
_MAX_WORKERS = 8
_STL_PERIOD = 7


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
        "mention_count,attention_score,ad_pressure_score,promo_active_flag,"
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


# ─── ccf core ──────────────────────────────────────────────────────────────

def _ccf_one(
    brand_id: str,
    lookup_pid: str,
    stored_pid: str | None,
    driver: str,
    df: pd.DataFrame,
    run_date: date,
) -> dict[str, Any] | None:
    # lookup_pid filters `df` inside _product_series; stored_pid is what lands
    # in analysis_results.product_id (None for the brand-wide rollup). Mirrors
    # changepoints.py.
    # Lazy import avoids module-load ordering issues with seasonality.
    from analytics_backend.statistics.seasonality import stl_deseasonalize
    try:
        from statsmodels.tsa.stattools import ccf  # type: ignore
    except Exception as exc:
        log.warning("statsmodels.ccf unavailable: %s", exc)
        return None

    try:
        x_raw = _product_series(df, lookup_pid, driver)
        y_raw = _product_series(df, lookup_pid, _TARGET)
        if x_raw.empty or y_raw.empty:
            return None

        # STL-deseasonalize both series before CCF.
        x_des = stl_deseasonalize(x_raw, period=_STL_PERIOD)
        y_des = stl_deseasonalize(y_raw, period=_STL_PERIOD)

        # Align on shared index, drop NaNs.
        pair = pd.concat([x_des, y_des], axis=1).dropna()
        if len(pair) < _MIN_OBS:
            return None
        a = pair.iloc[:, 0].to_numpy()
        b = pair.iloc[:, 1].to_numpy()
        if float(a.std()) == 0.0 or float(b.std()) == 0.0:
            return None

        # Newer statsmodels uses keyword `nlags`; older accepts positional.
        try:
            vals = ccf(a, b, adjusted=False, nlags=_MAX_LAG + 1)
        except TypeError:
            try:
                vals = ccf(a, b, unbiased=False)[: _MAX_LAG + 1]
            except TypeError:
                vals = ccf(a, b)[: _MAX_LAG + 1]

        ccf_values: list[float] = []
        for v in vals[: _MAX_LAG + 1]:
            fv = float(v)
            ccf_values.append(fv if not math.isnan(fv) else 0.0)
        lags = list(range(0, len(ccf_values)))
        n = int(len(pair))
        band = 1.96 / math.sqrt(n) if n > 0 else None

        if not ccf_values:
            return None
        best_idx = max(range(len(ccf_values)), key=lambda i: abs(ccf_values[i]))
        best_lag = lags[best_idx]
        best_score = ccf_values[best_idx]

        payload: dict[str, Any] = {
            "lags": lags,
            "ccf": ccf_values,
            "confidence_band_95": band,
            "stl_period": _STL_PERIOD,
            "method": "stl_deseasonalized_ccf",
        }

        return {
            "kind": "ccf",
            "brand_id": brand_id,
            "product_id": stored_pid,
            "driver": driver,
            "target": _TARGET,
            "metric_date": run_date.isoformat(),
            "payload": payload,
            "n_samples": n,
            "best_lag": int(best_lag),
            "best_score": float(best_score),
            "best_pvalue": None,
        }
    except Exception as exc:
        log.warning(
            "ccf failed brand=%s product=%s driver=%s: %s",
            brand_id, stored_pid, driver, exc,
        )
        return None


# ─── runner ────────────────────────────────────────────────────────────────

def run(ctx: dict[str, Any]) -> int:
    dry_run = bool(ctx.get("dry_run"))
    brands = ctx.get("brands")
    run_date = _today()

    brand_map = _load_brand_map()
    brand_ids = _filter_brand_ids(brand_map, brands)
    log.info("cross_correlation: %d brands in scope", len(brand_ids))

    # Each task: (brand_id, lookup_pid, stored_pid, driver, df)
    BRAND_AGG = "__brand_agg__"
    tasks: list[tuple[str, str, str | None, str, pd.DataFrame]] = []
    for brand_id in brand_ids:
        df = _fetch_brand_window(brand_id)
        if df.empty:
            continue
        present_drivers = [d for d in _DRIVERS if d in df.columns]
        if not present_drivers:
            continue

        # Brand-level rollup: 100+ daily observations even where individual
        # products carry only 5-15 days. Without this, every product series
        # fell short of _MIN_OBS=30 and the module emitted zero rows.
        brand_df = df.copy()
        brand_df["canonical_product_id"] = BRAND_AGG
        for driver in present_drivers:
            tasks.append((brand_id, BRAND_AGG, None, driver, brand_df))

        # Product-level (original). Sparse products still skip via _MIN_OBS.
        for product_id in _top_products(df):
            for driver in present_drivers:
                tasks.append((brand_id, product_id, product_id, driver, df))

    if not tasks:
        log.info("cross_correlation: nothing to do")
        return 0
    if dry_run:
        log.info("[dry-run] would compute %d CCFs", len(tasks))
        return 0

    rows: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        futures = [
            pool.submit(_ccf_one, b, lp, sp, d, df, run_date)
            for (b, lp, sp, d, df) in tasks
        ]
        for fut in concurrent.futures.as_completed(futures):
            row = fut.result()
            if row is not None:
                rows.append(row)

    if not rows:
        log.info("cross_correlation: no rows produced")
        return 0

    n = sb.upsert(
        "analysis_results",
        rows,
        on_conflict="kind,brand_id,product_id,driver,target,metric_date",
    )
    log.info("cross_correlation: upserted %d rows", n)
    return int(n)
