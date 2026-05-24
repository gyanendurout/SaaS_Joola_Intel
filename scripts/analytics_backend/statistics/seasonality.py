"""STL decomposition for weekly seasonality (period=7).

Spec:    docs/superpowers/specs/2026-05-24-analytics-mvp-design.md §6.8
Schema:  migrations/013_analytics_foundation.sql §5.4 / §5.5

Exposes `stl_deseasonalize(s, period)` as a helper for other modules
(notably `cross_correlation.py`). The `run(ctx)` entry point persists
per-series STL summaries (trend_last_value, seasonal_amplitude, resid_std)
to `analysis_results` tagged `kind='stl'`.
"""
from __future__ import annotations

import concurrent.futures
import math
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

import pandas as pd

from scripts.scraping.core import supabase_client as sb
from scripts.scraping.core.logger import get_logger

log = get_logger("statistics.seasonality")

_WINDOW_DAYS = 180
_TOP_N_PRODUCTS = 10
_PERIOD = 7
_MIN_OBS = _PERIOD * 2  # STL minimum requirement
_SERIES = ("attention_score", "estimated_units_sold", "ad_pressure_score")
_MAX_WORKERS = 8


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


# ─── public helper: used by cross_correlation ─────────────────────────────

def stl_deseasonalize(s: pd.Series, period: int = _PERIOD) -> pd.Series:
    """Subtract the STL seasonal component; return trend+resid.

    Falls back to the original series on failure (insufficient obs, NaN gaps
    that defeat interpolation, or statsmodels import failure).
    """
    if s is None or s.empty:
        return pd.Series(dtype="float64") if s is None else s
    clean = s.dropna()
    if len(clean) < period * 2:
        return s
    try:
        from statsmodels.tsa.seasonal import STL  # type: ignore
    except Exception as exc:
        log.warning("statsmodels.STL unavailable (%s); returning raw series", exc)
        return s
    try:
        result = STL(clean, period=period, robust=True).fit()
        seasonal = result.seasonal.reindex(s.index)
        deseasoned = s - seasonal.fillna(0.0)
        return deseasoned.astype(float)
    except Exception as exc:
        log.warning("STL decomposition failed (%s); returning raw series", exc)
        return s


# ─── runner core ───────────────────────────────────────────────────────────

def _stl_summary(s: pd.Series, period: int = _PERIOD) -> dict[str, Any] | None:
    """Run STL and return summary dict, or None if insufficient data."""
    clean = s.dropna()
    if len(clean) < _MIN_OBS:
        return None
    try:
        from statsmodels.tsa.seasonal import STL  # type: ignore
    except Exception as exc:
        log.warning("statsmodels.STL unavailable: %s", exc)
        return None
    try:
        result = STL(clean, period=period, robust=True).fit()
    except Exception as exc:
        log.warning("STL fit failed: %s", exc)
        return None
    trend = result.trend.dropna()
    seasonal = result.seasonal.dropna()
    resid = result.resid.dropna()
    trend_last = float(trend.iloc[-1]) if not trend.empty else None
    seasonal_amplitude = (
        float(seasonal.max() - seasonal.min()) if not seasonal.empty else None
    )
    resid_std = float(resid.std(ddof=1)) if len(resid) > 1 else None
    return {
        "trend_last_value": (
            trend_last if trend_last is not None and not math.isnan(trend_last) else None
        ),
        "seasonal_amplitude": (
            seasonal_amplitude
            if seasonal_amplitude is not None and not math.isnan(seasonal_amplitude)
            else None
        ),
        "resid_std": (
            resid_std if resid_std is not None and not math.isnan(resid_std) else None
        ),
        "period": period,
        "n_obs": int(len(clean)),
    }


def _stl_one(
    brand_id: str,
    product_id: str,
    series_name: str,
    df: pd.DataFrame,
    run_date: date,
) -> dict[str, Any] | None:
    try:
        s = _product_series(df, product_id, series_name)
        summary = _stl_summary(s)
        if summary is None:
            return None
        return {
            "kind": "stl",
            "brand_id": brand_id,
            "product_id": product_id,
            "driver": series_name,
            "target": series_name,
            "metric_date": run_date.isoformat(),
            "payload": summary,
            "n_samples": int(summary["n_obs"]),
            "best_lag": None,
            "best_score": summary.get("seasonal_amplitude"),
            "best_pvalue": None,
        }
    except Exception as exc:
        log.warning(
            "stl failed brand=%s product=%s series=%s: %s",
            brand_id, product_id, series_name, exc,
        )
        return None


def run(ctx: dict[str, Any]) -> int:
    """Execute STL decomposition on key series; upsert one row per series."""
    dry_run = bool(ctx.get("dry_run"))
    brands = ctx.get("brands")
    run_date = _today()

    brand_map = _load_brand_map()
    brand_ids = _filter_brand_ids(brand_map, brands)
    log.info("seasonality: %d brands in scope", len(brand_ids))

    tasks: list[tuple[str, str, str, pd.DataFrame]] = []
    for brand_id in brand_ids:
        df = _fetch_brand_window(brand_id)
        if df.empty:
            continue
        products = _top_products(df)
        if not products:
            continue
        present_series = [s for s in _SERIES if s in df.columns]
        for product_id in products:
            for series_name in present_series:
                tasks.append((brand_id, product_id, series_name, df))

    if not tasks:
        log.info("seasonality: nothing to do")
        return 0

    if dry_run:
        log.info("[dry-run] would compute %d STL decompositions", len(tasks))
        return 0

    rows: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        futures = [
            pool.submit(_stl_one, b, p, sn, df, run_date) for (b, p, sn, df) in tasks
        ]
        for fut in concurrent.futures.as_completed(futures):
            row = fut.result()
            if row is not None:
                rows.append(row)

    if not rows:
        log.info("seasonality: no rows produced")
        return 0

    n = sb.upsert(
        "analysis_results",
        rows,
        on_conflict="kind,brand_id,product_id,driver,target,metric_date",
    )
    log.info("seasonality: upserted %d rows", n)
    return int(n)
