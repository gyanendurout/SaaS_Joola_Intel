"""ADF stationarity + Granger causality.

Spec:    docs/superpowers/specs/2026-05-24-analytics-mvp-design.md §6.7
Schema:  migrations/013_analytics_foundation.sql §5.4 / §5.5

For each (brand, top-10 product, driver) × target=estimated_units_sold:
1. Pull last 180 days; interpolate small gaps.
2. ADF on each; difference if p > 0.05 (track integration_order).
3. grangercausalitytests for lags 1..14; pick lag with lowest ssr_ftest_p.
4. Persist tagged `kind='granger'` to `analysis_results`.
"""
from __future__ import annotations

import concurrent.futures
import math
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

import pandas as pd

from backend.scraping.core import supabase_client as sb
from backend.scraping.core.logger import get_logger

log = get_logger("statistics.granger")

_WINDOW_DAYS = 180
_TOP_N_PRODUCTS = 10
_MAX_LAG = 14
_MIN_OBS = 30
_TARGET = "estimated_units_sold"
_DRIVERS = (
    "attention_score",
    "ad_pressure_score",
    "promo_active_flag",
    "yt_transcript_attention",
)
_MAX_WORKERS = 4  # statsmodels is CPU-heavy; keep modest


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


# ─── stationarity prep ─────────────────────────────────────────────────────

def _adf_pvalue(s: pd.Series) -> float | None:
    try:
        from statsmodels.tsa.stattools import adfuller  # type: ignore
    except Exception as exc:
        log.warning("statsmodels.adfuller unavailable: %s", exc)
        return None
    clean = s.dropna()
    if len(clean) < 10:
        return None
    if float(clean.std()) == 0.0:
        return None
    try:
        result = adfuller(clean, autolag="AIC")
        pval = float(result[1])
        if math.isnan(pval):
            return None
        return pval
    except Exception as exc:
        log.warning("adfuller failed: %s", exc)
        return None


def _make_stationary(s: pd.Series) -> tuple[pd.Series, int]:
    """Return (stationary_series, integration_order) where order ∈ {0, 1}."""
    pval = _adf_pvalue(s)
    if pval is None or pval > 0.05:
        diffed = s.diff().dropna()
        return diffed, 1
    return s.dropna(), 0


# ─── granger core ──────────────────────────────────────────────────────────

def _granger_one(
    brand_id: str,
    product_id: str,
    driver: str,
    df: pd.DataFrame,
    run_date: date,
) -> dict[str, Any] | None:
    try:
        from statsmodels.tsa.stattools import grangercausalitytests  # type: ignore
    except Exception as exc:
        log.warning("statsmodels.grangercausalitytests unavailable: %s", exc)
        return None

    try:
        x_raw = _product_series(df, product_id, driver)
        y_raw = _product_series(df, product_id, _TARGET)
        if x_raw.empty or y_raw.empty:
            return None

        x_s, order_x = _make_stationary(x_raw)
        y_s, order_y = _make_stationary(y_raw)

        # grangercausalitytests signature: data has target in col 0, driver in col 1.
        pair = pd.concat([y_s, x_s], axis=1).dropna()
        if len(pair) < _MIN_OBS:
            log.info(
                "granger skip n<%d brand=%s product=%s driver=%s (n=%d)",
                _MIN_OBS, brand_id, product_id, driver, len(pair),
            )
            return None

        max_lag = min(_MAX_LAG, max(1, len(pair) // 5))
        try:
            results = grangercausalitytests(
                pair.to_numpy(), maxlag=max_lag, verbose=False
            )
        except Exception as exc:
            log.warning("grangercausalitytests failed: %s", exc)
            return None

        best_lag: int | None = None
        best_ssr_p: float | None = None
        best_lr_p: float | None = None
        for lag, payload in results.items():
            try:
                tests = payload[0]
                ssr_p = float(tests["ssr_ftest"][1])
                lr_p = float(tests["lrtest"][1])
            except Exception:
                continue
            if math.isnan(ssr_p):
                continue
            if best_ssr_p is None or ssr_p < best_ssr_p:
                best_lag = int(lag)
                best_ssr_p = ssr_p
                best_lr_p = lr_p if not math.isnan(lr_p) else None

        if best_lag is None or best_ssr_p is None:
            return None

        payload_out: dict[str, Any] = {
            "best_lag": best_lag,
            "ssr_ftest_p": best_ssr_p,
            "lrtest_p": best_lr_p,
            "integration_order_driver": int(order_x),
            "integration_order_target": int(order_y),
            "n_samples": int(len(pair)),
            "max_lag_tested": int(max_lag),
        }

        return {
            "kind": "granger",
            "brand_id": brand_id,
            "product_id": product_id,
            "driver": driver,
            "target": _TARGET,
            "metric_date": run_date.isoformat(),
            "payload": payload_out,
            "n_samples": int(len(pair)),
            "best_lag": best_lag,
            "best_score": None,
            "best_pvalue": best_ssr_p,
        }
    except Exception as exc:
        log.warning(
            "granger failed brand=%s product=%s driver=%s: %s",
            brand_id, product_id, driver, exc,
        )
        return None


# ─── runner ────────────────────────────────────────────────────────────────

def run(ctx: dict[str, Any]) -> int:
    dry_run = bool(ctx.get("dry_run"))
    brands = ctx.get("brands")
    run_date = _today()

    brand_map = _load_brand_map()
    brand_ids = _filter_brand_ids(brand_map, brands)
    log.info("granger: %d brands in scope", len(brand_ids))

    tasks: list[tuple[str, str, str, pd.DataFrame]] = []
    for brand_id in brand_ids:
        df = _fetch_brand_window(brand_id)
        if df.empty:
            continue
        products = _top_products(df)
        if not products:
            continue
        present_drivers = [d for d in _DRIVERS if d in df.columns]
        for product_id in products:
            for driver in present_drivers:
                tasks.append((brand_id, product_id, driver, df))

    if not tasks:
        log.info("granger: nothing to do")
        return 0
    if dry_run:
        log.info("[dry-run] would compute %d granger tests", len(tasks))
        return 0

    rows: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        futures = [
            pool.submit(_granger_one, b, p, d, df, run_date) for (b, p, d, df) in tasks
        ]
        for fut in concurrent.futures.as_completed(futures):
            row = fut.result()
            if row is not None:
                rows.append(row)

    if not rows:
        log.info("granger: no rows produced")
        return 0

    n = sb.upsert(
        "analysis_results",
        rows,
        on_conflict="kind,brand_id,product_id,driver,target,metric_date",
    )
    log.info("granger: upserted %d rows", n)
    return int(n)
