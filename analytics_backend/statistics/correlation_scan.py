"""Pearson + Spearman lag scans on joola_timeseries_daily.

Spec:    docs/superpowers/specs/2026-05-24-analytics-mvp-design.md §6.4
Schema:  migrations/013_analytics_foundation.sql §5.4 / §5.5

For each (brand, top-10 products by attention in last 180d) × driver ×
target=estimated_units_sold, compute Pearson + Spearman correlation across
lags -28..+28 days. Skip lags with fewer than 14 aligned observations.
Write one row per (brand, product, driver, target) to `analysis_results`
tagged `kind='lag_scan'`.
"""
from __future__ import annotations

import concurrent.futures
import math
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

import pandas as pd
from scipy.stats import pearsonr, spearmanr

from backend.scraping.core import supabase_client as sb
from backend.scraping.core.logger import get_logger

log = get_logger("statistics.correlation_scan")

_WINDOW_DAYS = 180
_TOP_N_PRODUCTS = 10
_MAX_LAG = 28
# Lowered from 14 → 5 because product_attention_daily is currently very
# sparse (~10 product-day rows per top brand). Once enrichment + scraping
# catch up to historical data, raise this back to 14 for tighter stats.
_MIN_OBS = 5
# Was: estimated_units_sold. Switched to mention_count because
# sales_estimates is empty (no inventory snapshots yet), so the
# estimated_units_sold column is all NULL — nothing to correlate against.
# mention_count is dense in joola_timeseries_daily.
_TARGET = "mention_count"
_DRIVERS = (
    "attention_score",
    "ad_pressure_score",
    "promo_active_flag",
    "total_engagement",
)
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
    """Pull the last 180 days of joola_timeseries_daily for one brand."""
    start = _window_start().isoformat()
    select = (
        "metric_date,brand_id,canonical_product_id,canonical_product_name,"
        "mention_count,total_engagement,attention_score,sales_likelihood_score,"
        "ad_pressure_score,promo_active_flag,promo_depth_pct,price_usd,"
        "price_index_90d,availability_index,estimated_units_sold,"
        "estimated_revenue,sales_estimate_confidence"
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
    """Return canonical_product_ids sorted by total attention_score desc."""
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


def _product_series(
    df: pd.DataFrame, product_id: str, column: str
) -> pd.Series:
    """Daily series for one (product, column), reindexed to daily freq."""
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


# ─── lag-scan core ─────────────────────────────────────────────────────────

def _lag_scan(x: pd.Series, y: pd.Series, max_lag: int = _MAX_LAG) -> dict[str, list]:
    """Return parallel arrays for lags, pearson_r/p, spearman_rho/p, n."""
    lags: list[int] = []
    pr_r: list[float] = []
    pr_p: list[float] = []
    sp_r: list[float] = []
    sp_p: list[float] = []
    ns: list[int] = []
    for lag in range(-max_lag, max_lag + 1):
        x_lag = x.shift(lag)
        pair = pd.concat([x_lag, y], axis=1).dropna()
        if len(pair) < _MIN_OBS:
            continue
        a = pair.iloc[:, 0].to_numpy()
        b = pair.iloc[:, 1].to_numpy()
        if float(a.std()) == 0.0 or float(b.std()) == 0.0:
            continue
        try:
            pr = pearsonr(a, b)
            sr = spearmanr(a, b)
        except Exception:
            continue
        pr_coef = float(pr[0]) if not math.isnan(pr[0]) else None
        pr_pval = float(pr[1]) if not math.isnan(pr[1]) else None
        sr_coef = float(sr[0]) if not math.isnan(sr[0]) else None
        sr_pval = float(sr[1]) if not math.isnan(sr[1]) else None
        if pr_coef is None or sr_coef is None:
            continue
        lags.append(int(lag))
        pr_r.append(pr_coef)
        pr_p.append(pr_pval if pr_pval is not None else float("nan"))
        sp_r.append(sr_coef)
        sp_p.append(sr_pval if sr_pval is not None else float("nan"))
        ns.append(int(len(pair)))
    return {
        "lags": lags,
        "pearson_r": pr_r,
        "pearson_p": pr_p,
        "spearman_rho": sp_r,
        "spearman_p": sp_p,
        "n": ns,
    }


def _best_index(values: list[float]) -> int | None:
    if not values:
        return None
    abs_vals = [abs(v) for v in values]
    return int(max(range(len(abs_vals)), key=lambda i: abs_vals[i]))


def _scan_one(
    brand_id: str,
    product_id: str,
    driver: str,
    df: pd.DataFrame,
    run_date: date,
) -> dict[str, Any] | None:
    try:
        x = _product_series(df, product_id, driver)
        y = _product_series(df, product_id, _TARGET)
        if x.empty or y.empty:
            return None
        scan = _lag_scan(x, y)
        if not scan["lags"]:
            return None
        idx = _best_index(scan["pearson_r"])
        if idx is None:
            return None
        best_lag = scan["lags"][idx]
        best_score = scan["pearson_r"][idx]
        best_pvalue = scan["pearson_p"][idx]
        return {
            "kind": "lag_scan",
            "brand_id": brand_id,
            "product_id": product_id,
            "driver": driver,
            "target": _TARGET,
            "metric_date": run_date.isoformat(),
            "payload": scan,
            "n_samples": _WINDOW_DAYS,
            "best_lag": best_lag,
            "best_score": best_score,
            "best_pvalue": (
                best_pvalue if best_pvalue is not None and not math.isnan(best_pvalue) else None
            ),
        }
    except Exception as exc:
        log.warning(
            "lag_scan failed brand=%s product=%s driver=%s: %s",
            brand_id, product_id, driver, exc,
        )
        return None


# ─── runner ────────────────────────────────────────────────────────────────

def run(ctx: dict[str, Any]) -> int:
    """Execute lag scans and upsert one row per (brand, product, driver, target)."""
    dry_run = bool(ctx.get("dry_run"))
    brands = ctx.get("brands")
    run_date = _today()

    brand_map = _load_brand_map()
    brand_ids = _filter_brand_ids(brand_map, brands)
    log.info("correlation_scan: %d brands in scope", len(brand_ids))

    tasks: list[tuple[str, str, str, pd.DataFrame]] = []
    for brand_id in brand_ids:
        df = _fetch_brand_window(brand_id)
        if df.empty:
            log.info("no timeseries rows for brand %s — skip", brand_id)
            continue
        products = _top_products(df)
        if not products:
            log.info("no products for brand %s — skip", brand_id)
            continue
        present_drivers = [d for d in _DRIVERS if d in df.columns]
        for product_id in products:
            for driver in present_drivers:
                tasks.append((brand_id, product_id, driver, df))

    if not tasks:
        log.info("correlation_scan: nothing to do")
        return 0

    if dry_run:
        log.info("[dry-run] would compute %d lag scans", len(tasks))
        return 0

    rows: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        futures = [
            pool.submit(_scan_one, b, p, d, df, run_date) for (b, p, d, df) in tasks
        ]
        for fut in concurrent.futures.as_completed(futures):
            row = fut.result()
            if row is not None:
                rows.append(row)

    if not rows:
        log.info("correlation_scan: no analysis rows produced")
        return 0

    n = sb.upsert(
        "analysis_results",
        rows,
        on_conflict="kind,brand_id,product_id,driver,target,metric_date",
    )
    log.info("correlation_scan: upserted %d rows", n)
    return int(n)
