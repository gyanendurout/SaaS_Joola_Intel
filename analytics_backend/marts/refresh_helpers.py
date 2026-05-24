"""Compute the 4 daily helper marts for the analytics backend.

Spec:    docs/superpowers/specs/2026-05-24-analytics-mvp-design.md §6.2
Schema:  migrations/013_analytics_foundation.sql §5.3

Helpers (in execution order — each writes its own table, parallelizable):
  a. ad_pressure_daily   ← marketing_ads        (last 90 days)
  b. promotion_daily     ← promotions           (last 90 days)
  c. price_daily         ← product_price_history (last 90 days)
  d. availability_daily  ← product_snapshots    (last 90 days)

Adaptations vs spec (because source schemas differ):
  - `promotions` has NO start_date/end_date/product_id columns; we treat
    `detected_at::date` as the only active day and write NULL product_id.
  - `marketing_ads` has `started_at` (created_at proxy) and `captured_at`
    (last-seen proxy); active window = [started_at, captured_at].
  - `product_snapshots` uses `snapshot_time` + `availability_status`
    ('in_stock' / 'in stock' counted as in-stock).
  - Only rows with successful source computation (source_run_ok=True) are
    written; source_run_ok=False is reserved for sentinel "we tried but had
    nothing" rows the dashboards can distinguish from "never computed".
"""
from __future__ import annotations

import concurrent.futures
import math
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

from backend.scraping.core import supabase_client as sb
from backend.scraping.core.logger import get_logger

log = get_logger("marts.refresh_helpers")

_WINDOW_DAYS = 90
_PAGE_SIZE = 1000


# ─── shared helpers ─────────────────────────────────────────────────────────

def _today() -> date:
    return datetime.now(timezone.utc).date()


def _window_start() -> date:
    return _today() - timedelta(days=_WINDOW_DAYS)


def _iso(d: date) -> str:
    return d.isoformat()


def _parse_date(value: Any) -> date | None:
    """Robust ISO/date parser. Returns None if value is null/unparseable."""
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
        except ValueError:
            try:
                return date.fromisoformat(value[:10])
            except ValueError:
                return None
    return None


def _load_brand_map() -> dict[str, str]:
    """Return {slug → brand_id} for every brand."""
    rows = sb.get("brands", select="id,slug")
    return {r["slug"]: r["id"] for r in rows if r.get("slug") and r.get("id")}


def _filter_brand_ids(brand_map: dict[str, str], brands: Iterable[str] | None) -> set[str]:
    """If brands filter is provided, return matching brand_ids; else all."""
    if not brands:
        return set(brand_map.values())
    wanted = {b.strip() for b in brands if b}
    return {bid for slug, bid in brand_map.items() if slug in wanted}


def _fetch_window(table: str, select: str, ts_col: str,
                  extra_filter: str = "") -> list[dict]:
    """Page through `table` for rows where ts_col >= window_start."""
    start_iso = _iso(_window_start())
    out: list[dict] = []
    offset = 0
    while True:
        filters = f"{ts_col}=gte.{start_iso}&order={ts_col}.asc&limit={_PAGE_SIZE}&offset={offset}"
        if extra_filter:
            filters = f"{extra_filter}&{filters}"
        try:
            page = sb.get_filtered(table, select, filters)
        except Exception as exc:
            log.error("Fetch %s failed at offset %d: %s", table, offset, exc)
            break
        if not page:
            break
        out.extend(page)
        if len(page) < _PAGE_SIZE:
            break
        offset += _PAGE_SIZE
    log.info("Loaded %d rows from %s (last %d days).", len(out), table, _WINDOW_DAYS)
    return out


# ─── (a) ad_pressure_daily ──────────────────────────────────────────────────

def _compute_ad_pressure(allowed_brand_ids: set[str]) -> list[dict]:
    """For each (brand_id, date) in the window:
       active_creatives = creatives where date in [started_at, captured_at]
       new_creatives    = creatives whose started_at::date == date
       platform_count   = distinct platforms active on that date
       ad_pressure_score = log1p(active)*10 + log1p(new)*20 + platforms*5 (cap 100)
    """
    rows = _fetch_window(
        "marketing_ads",
        select="brand_id,platform,started_at,captured_at,is_active",
        ts_col="captured_at",
    )
    if not rows:
        return []

    today = _today()
    window_start = _window_start()

    # (brand_id, date) → {active: int, new: int, platforms: set}
    daily: dict[tuple[str, date], dict[str, Any]] = defaultdict(
        lambda: {"active": 0, "new": 0, "platforms": set()}
    )

    for r in rows:
        brand_id = r.get("brand_id")
        if not brand_id or brand_id not in allowed_brand_ids:
            continue
        platform = (r.get("platform") or "").strip().lower() or "unknown"
        created = _parse_date(r.get("started_at")) or _parse_date(r.get("captured_at"))
        last = _parse_date(r.get("captured_at")) or today
        if created is None:
            continue
        # clamp the active window to our 90-day mart window
        win_lo = max(created, window_start)
        win_hi = min(last, today)
        if win_lo > win_hi:
            continue
        d = win_lo
        while d <= win_hi:
            cell = daily[(brand_id, d)]
            cell["active"] += 1
            cell["platforms"].add(platform)
            if d == created:
                cell["new"] += 1
            d += timedelta(days=1)

    out: list[dict] = []
    for (brand_id, d), cell in daily.items():
        active = int(cell["active"])
        new = int(cell["new"])
        platforms = len(cell["platforms"])
        raw_score = (
            math.log1p(active) * 10.0
            + math.log1p(new) * 20.0
            + platforms * 5.0
        )
        score = round(max(0.0, min(100.0, raw_score)), 2)
        out.append({
            "metric_date": _iso(d),
            "brand_id": brand_id,
            "active_creatives": active,
            "new_creatives": new,
            "platform_count": platforms,
            "ad_pressure_score": score,
            "source_run_ok": True,
        })
    log.info("ad_pressure_daily: %d (brand × day) rows computed.", len(out))
    return out


# ─── (b) promotion_daily ────────────────────────────────────────────────────

def _compute_promotion_daily(allowed_brand_ids: set[str]) -> list[dict]:
    """One row per (brand_id, product_id, date) when a promotion was detected.

    `promotions` has no start_date/end_date — only detected_at — and no
    product_id. Each promotion contributes a single active day = detected
    date. promo_count counts multiple detections per same (brand, day).
    """
    rows = _fetch_window(
        "promotions",
        select="brand_id,discount_pct,detected_at",
        ts_col="detected_at",
    )
    if not rows:
        return []

    # (brand_id, None, date) → {count: int, depths: list[float]}
    daily: dict[tuple[str, None, date], dict[str, Any]] = defaultdict(
        lambda: {"count": 0, "depths": []}
    )

    for r in rows:
        brand_id = r.get("brand_id")
        if not brand_id or brand_id not in allowed_brand_ids:
            continue
        d = _parse_date(r.get("detected_at"))
        if d is None:
            continue
        cell = daily[(brand_id, None, d)]
        cell["count"] += 1
        depth = r.get("discount_pct")
        if depth is not None:
            try:
                cell["depths"].append(float(depth))
            except (TypeError, ValueError):
                pass

    out: list[dict] = []
    for (brand_id, product_id, d), cell in daily.items():
        depth = (sum(cell["depths"]) / len(cell["depths"])) if cell["depths"] else None
        out.append({
            "metric_date": _iso(d),
            "brand_id": brand_id,
            "product_id": product_id,
            "promo_active_flag": 1,
            "promo_depth_pct": round(depth, 2) if depth is not None else None,
            "promo_count": int(cell["count"]),
            "source_run_ok": True,
        })
    log.info("promotion_daily: %d (brand × product × day) rows computed.", len(out))
    return out


# ─── (c) price_daily ────────────────────────────────────────────────────────

def _compute_price_daily() -> list[dict]:
    """Daily last-known price per product + 90-day rolling index.

    price_index_90d = price_usd / 90-day average price (per product).
    Index NULL when product has no usable history.
    """
    rows = _fetch_window(
        "product_price_history",
        select="product_id,price_usd,captured_at",
        ts_col="captured_at",
    )
    if not rows:
        return []

    today = _today()
    window_start = _window_start()

    # group observations by product_id, sorted by date
    by_product: dict[str, list[tuple[date, float]]] = defaultdict(list)
    for r in rows:
        pid = r.get("product_id")
        price = r.get("price_usd")
        d = _parse_date(r.get("captured_at"))
        if not pid or price is None or d is None:
            continue
        try:
            by_product[pid].append((d, float(price)))
        except (TypeError, ValueError):
            continue

    out: list[dict] = []
    for pid, obs in by_product.items():
        obs.sort(key=lambda t: t[0])
        prices_in_window = [p for d, p in obs if window_start <= d <= today]
        avg_90d = (sum(prices_in_window) / len(prices_in_window)) if prices_in_window else None

        # walk each day in window forward, carrying the most recent price
        last_price: float | None = None
        obs_iter = iter(obs)
        next_pt = next(obs_iter, None)
        # consume any pre-window observations to seed last_price
        while next_pt is not None and next_pt[0] < window_start:
            last_price = next_pt[1]
            next_pt = next(obs_iter, None)

        d = window_start
        while d <= today:
            while next_pt is not None and next_pt[0] <= d:
                last_price = next_pt[1]
                next_pt = next(obs_iter, None)
            if last_price is not None:
                index = round(last_price / avg_90d, 3) if avg_90d and avg_90d > 0 else None
                out.append({
                    "metric_date": _iso(d),
                    "product_id": pid,
                    "price_usd": round(last_price, 2),
                    "price_index_90d": index,
                    "source_run_ok": True,
                })
            d += timedelta(days=1)

    log.info("price_daily: %d (product × day) rows computed.", len(out))
    return out


# ─── (d) availability_daily ─────────────────────────────────────────────────

_IN_STOCK_STATUSES = {"in_stock", "in stock", "available", "instock"}


def _is_in_stock(snapshot: dict) -> bool:
    status = (snapshot.get("availability_status") or "").strip().lower()
    return status in _IN_STOCK_STATUSES


def _compute_availability_daily(allowed_brand_ids: set[str]) -> list[dict]:
    """Per (brand × product × day):
       in_stock_count / total_variants from product_snapshots.
    """
    rows = _fetch_window(
        "product_snapshots",
        select="brand_id,product_id,snapshot_time,availability_status,variant_id",
        ts_col="snapshot_time",
    )
    if not rows:
        return []

    # (brand_id, product_id, date) → {in_stock: int, total: int}
    daily: dict[tuple[str, str | None, date], dict[str, int]] = defaultdict(
        lambda: {"in_stock": 0, "total": 0}
    )

    for r in rows:
        brand_id = r.get("brand_id")
        if not brand_id or brand_id not in allowed_brand_ids:
            continue
        pid = r.get("product_id")
        d = _parse_date(r.get("snapshot_time"))
        if d is None:
            continue
        cell = daily[(brand_id, pid, d)]
        cell["total"] += 1
        if _is_in_stock(r):
            cell["in_stock"] += 1

    out: list[dict] = []
    for (brand_id, pid, d), cell in daily.items():
        total = int(cell["total"])
        in_stock = int(cell["in_stock"])
        idx = round(in_stock / total, 4) if total > 0 else None
        out.append({
            "metric_date": _iso(d),
            "brand_id": brand_id,
            "product_id": pid,
            "in_stock_count": in_stock,
            "total_variants": total,
            "availability_index": idx,
            "source_run_ok": True,
        })
    log.info("availability_daily: %d (brand × product × day) rows computed.", len(out))
    return out


# ─── orchestration ──────────────────────────────────────────────────────────

def _upsert(table: str, rows: list[dict], on_conflict: str) -> int:
    if not rows:
        log.info("%s: nothing to upsert.", table)
        return 0
    n = sb.upsert(table, rows, on_conflict=on_conflict)
    log.info("%s: upserted %d rows.", table, n)
    return n


def run(ctx: dict[str, Any]) -> int:
    """Compute + upsert all 4 helper marts in parallel.

    Returns total rows upserted across the 4 tables.
    """
    dry_run = bool(ctx.get("dry_run"))
    brands = ctx.get("brands")
    if isinstance(brands, str):
        brands = [b.strip() for b in brands.split(",") if b.strip()]

    brand_map = _load_brand_map()
    allowed = _filter_brand_ids(brand_map, brands)
    log.info(
        "Helper marts run — window=%d days, brands=%d/%d allowed (filter=%s), dry_run=%s",
        _WINDOW_DAYS, len(allowed), len(brand_map), brands or "ALL", dry_run,
    )

    if dry_run:
        log.info("[dry-run] would compute ad/promo/price/availability daily marts.")
        return 0

    # Each task touches a different source table → safe to parallelize.
    jobs = {
        "ad_pressure_daily":   (lambda: _compute_ad_pressure(allowed),    "metric_date,brand_id"),
        "promotion_daily":     (lambda: _compute_promotion_daily(allowed), "metric_date,brand_id,product_id"),
        "price_daily":         (_compute_price_daily,                      "metric_date,product_id"),
        "availability_daily":  (lambda: _compute_availability_daily(allowed), "metric_date,brand_id,product_id"),
    }

    computed: dict[str, list[dict]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        future_map = {pool.submit(fn): name for name, (fn, _pk) in jobs.items()}
        for future in concurrent.futures.as_completed(future_map):
            name = future_map[future]
            try:
                computed[name] = future.result()
            except Exception as exc:
                log.error("%s computation failed: %s", name, exc)
                computed[name] = []

    # Upserts run serially — Supabase REST is the bottleneck, not Python.
    total = 0
    for table, (_fn, pk) in jobs.items():
        total += _upsert(table, computed.get(table, []), pk)

    log.info("Helper marts done — %d total rows upserted.", total)
    return total
