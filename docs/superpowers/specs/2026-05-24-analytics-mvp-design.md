# JOOLA Intel — Analytics Backend MVP (Scope B)

**Date**: 2026-05-24
**Scope**: B (foundation + Granger + changepoints; no ITS/DiD/Synthetic yet)
**Owner**: data + analytics
**Status**: Design — pending implementation approval

---

## 1. Goal

Turn the existing raw scraping rows into one dense daily mart and a small set
of statistical signals that answer two questions on every paddle:

1. **Which signal tends to lead estimated sales, and by how many days?**
2. **When did the time series shift regimes (regime breaks / changepoints)?**

The MVP ships exactly three new dashboards on top of the existing site, and
adds zero new scraping channels. Causal inference (ITS, DiD, Synthetic) is
explicitly deferred to a later phase.

## 2. Non-goals

- No actual ad-spend integration (no first-party feed exists). Use proxy
  `ad_pressure_score` only, with confidence label in UI.
- No ITS / DiD / Synthetic Control. Those need careful event curation and
  assumption-checking; we'll build them on top of the foundation in v2.
- No Prophet / NeuralProphet forecasting. Same reason — needs its own design.
- No new scrapers. The blueprint's raw-data assumptions are already met.
- No new schema for tables that already exist (product_aliases,
  product_mentions, product_attention_daily, yt_video_transcripts,
  yt_video_analysis, product_snapshots, sales_estimates, etc. all exist
  per migrations 010-012).

## 3. What we already have

Confirmed in `migrations/` and `scripts/scraping/`:

- Raw scraping for instagram, youtube, reddit, twitter, tiktok, ads,
  products, news, seo (Phase 1, 9 channels, runs in parallel).
- AI enrichment producing sentiment / NER / crisis flags / purchase intent.
- Facts layer: mention_facts, topic_lifecycle, competitor_switch,
  populate_product_mentions, populate_product_attention.
- Sales intelligence: product_snapshots, inventory_events, sales_estimates,
  promotion_sales_impact, sales_facts_daily.
- YouTube intelligence: yt_video_transcripts, yt_video_analysis,
  product_attention_sales_correlation.
- 10 descriptive dashboards at `/v2/*`.

What's missing is the **analytical brain on top**: a brand-local daily mart
that fuses everything, plus statistical tests + dashboards.

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Monday 07:00 IST — python scripts/weekly_run.py             │
└─────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 1-4 — scripts/scraping/run.py                         │
│   (instagram, youtube, …, enrichment, facts, sales-intel)   │
│   Writes raw + enriched rows to ~30 Supabase tables         │
└─────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 5 — scripts/analytics_backend/run.py                  │
│                                                              │
│   marts/                                                     │
│   ├── refresh_calendar.py   → dim_brand_calendar (MV)       │
│   ├── refresh_helpers.py    → ad_pressure_daily,            │
│   │                            promotion_daily,             │
│   │                            price_daily,                 │
│   │                            availability_daily           │
│   └── refresh_timeseries.py → joola_timeseries_daily (MV)   │
│                              joola_timeseries_weekly (MV)   │
│                                                              │
│   statistics/                                                │
│   ├── correlation_scan.py  → analysis_results (lag_scan)    │
│   ├── cross_correlation.py → analysis_results (ccf)         │
│   ├── changepoints.py      → analysis_results (changepoint) │
│   ├── granger.py           → analysis_results (granger)     │
│   └── seasonality.py       → analysis_results (stl)         │
└─────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│ Next.js dashboards read from:                                │
│   - joola_timeseries_daily / weekly  (existing pages too)   │
│   - analysis_results                  (new pages)            │
│                                                              │
│ New pages:                                                   │
│   - /v2/correlations    lead/lag heatmap                    │
│   - /v2/changepoints    regime-shift monitor                │
│   - /v2/leaderboard     product leaderboard w/ stats        │
└─────────────────────────────────────────────────────────────┘
```

The analytics backend runs **after** scraping finishes (Phase 5), uses the
same checkpoint + parallel-runner pattern, and writes back to Supabase. The
frontend reads from materialized views and the `analysis_results` table — no
new API routes needed for the MVP.

## 5. Schema additions

### 5.1 `brands.timezone` column
```sql
alter table brands add column if not exists timezone text default 'UTC';
update brands set timezone = 'America/New_York' where slug in (
  'joola','selkirk','paddletek','crbn','engage','onix','franklin',
  'head','wilson','gamma'
);
update brands set timezone = 'Australia/Sydney' where slug = 'six-zero';
```

Without per-brand timezone, all rollups are UTC, which gives wrong daily
counts at brand-local day boundaries (a 10pm-EST post lands on the next
UTC day).

### 5.2 `dim_brand_calendar` materialized view
```sql
create materialized view if not exists dim_brand_calendar as
select
  b.id as brand_id,
  b.slug as brand_slug,
  b.timezone as brand_timezone,
  gs::date as metric_date_brand_local
from brands b
cross join lateral generate_series(
  date '2025-01-01',
  current_date,
  interval '1 day'
) gs;

create unique index if not exists ix_brand_calendar_pk
  on dim_brand_calendar (brand_id, metric_date_brand_local);
```

### 5.3 Helper marts (one per signal type)
```sql
create table if not exists ad_pressure_daily (
  metric_date    date not null,
  brand_id       uuid not null references brands(id),
  active_creatives  int not null default 0,
  new_creatives     int not null default 0,
  platform_count    int not null default 0,
  ad_pressure_score numeric(6,2) not null default 0,
  source_run_ok     bool not null default true,
  computed_at       timestamptz not null default now(),
  primary key (metric_date, brand_id)
);

create table if not exists promotion_daily (
  metric_date      date not null,
  brand_id         uuid not null references brands(id),
  product_id       uuid null references products(id),
  promo_active_flag smallint not null default 0,
  promo_depth_pct  numeric(5,2) null,
  promo_count      int not null default 0,
  source_run_ok    bool not null default true,
  computed_at      timestamptz not null default now(),
  primary key (metric_date, brand_id, product_id)
);

create table if not exists price_daily (
  metric_date    date not null,
  product_id     uuid not null references products(id),
  price_usd      numeric(10,2) null,
  price_index_90d numeric(6,3) null,  -- price ÷ trailing 90-day baseline
  source_run_ok  bool not null default true,
  computed_at    timestamptz not null default now(),
  primary key (metric_date, product_id)
);

create table if not exists availability_daily (
  metric_date     date not null,
  brand_id        uuid not null references brands(id),
  product_id      uuid null references products(id),
  in_stock_count  int not null default 0,
  total_variants  int not null default 0,
  availability_index numeric(5,4) null,
  source_run_ok   bool not null default true,
  computed_at     timestamptz not null default now(),
  primary key (metric_date, brand_id, product_id)
);
```

### 5.4 `joola_timeseries_daily` materialized view
```sql
create materialized view if not exists joola_timeseries_daily as
select
  cal.metric_date_brand_local as metric_date,
  cal.brand_id,
  p.canonical_product_id,
  p.canonical_product_name,
  -- attention layer (already exists)
  coalesce(att.mention_count, 0)         as mention_count,
  coalesce(att.total_engagement, 0)      as total_engagement,
  coalesce(att.attention_score, 0)       as attention_score,
  coalesce(att.sales_likelihood_score,0) as sales_likelihood_score,
  -- ad/promo/price/avail (new helpers)
  coalesce(ad.ad_pressure_score, 0)      as ad_pressure_score,
  coalesce(pr.promo_active_flag, 0)      as promo_active_flag,
  pr.promo_depth_pct,
  px.price_usd,
  px.price_index_90d,
  av.availability_index,
  -- outcome (already exists)
  se.estimated_units_sold,
  se.estimated_revenue,
  se.confidence_score                    as sales_estimate_confidence
from dim_brand_calendar cal
left join product_attention_daily att
  on att.metric_date = cal.metric_date_brand_local
 and att.brand_id    = cal.brand_id
left join ad_pressure_daily ad
  on ad.metric_date = cal.metric_date_brand_local
 and ad.brand_id    = cal.brand_id
left join promotion_daily pr
  on pr.metric_date = cal.metric_date_brand_local
 and pr.brand_id    = cal.brand_id
 and pr.product_id  = att.canonical_product_id
left join price_daily px
  on px.metric_date = cal.metric_date_brand_local
 and px.product_id  = att.canonical_product_id
left join availability_daily av
  on av.metric_date = cal.metric_date_brand_local
 and av.brand_id    = cal.brand_id
 and av.product_id  = att.canonical_product_id
left join sales_estimates se
  on se.estimate_date = cal.metric_date_brand_local
 and se.brand_id      = cal.brand_id
 and se.product_id    = att.canonical_product_id
left join product_aliases p
  on p.canonical_product_id = att.canonical_product_id;

create unique index if not exists ix_jts_daily
  on joola_timeseries_daily (metric_date, brand_id, canonical_product_id);

create materialized view if not exists joola_timeseries_weekly as
select
  date_trunc('week', metric_date)::date as week_start,
  brand_id, canonical_product_id, canonical_product_name,
  sum(mention_count)             as mention_count,
  sum(total_engagement)          as total_engagement,
  avg(attention_score)           as attention_score_avg,
  max(attention_score)           as attention_score_max,
  avg(ad_pressure_score)         as ad_pressure_score_avg,
  max(promo_active_flag)         as promo_active_any,
  avg(promo_depth_pct)           as promo_depth_pct_avg,
  avg(price_usd)                 as price_usd_avg,
  avg(price_index_90d)           as price_index_90d_avg,
  avg(availability_index)        as availability_index_avg,
  sum(estimated_units_sold)      as estimated_units_sold,
  sum(estimated_revenue)         as estimated_revenue
from joola_timeseries_daily
group by 1,2,3,4;
```

### 5.5 `analysis_results` table
```sql
create table if not exists analysis_results (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,           -- 'lag_scan' | 'ccf' | 'granger' | 'changepoint' | 'stl'
  brand_id     uuid not null references brands(id),
  product_id   uuid null,
  driver       text null,               -- e.g. 'attention_score'
  target       text null,               -- e.g. 'estimated_units_sold'
  metric_date  date not null,           -- the date the analysis was run for
  payload      jsonb not null,          -- {lags: [...], correlations: [...], p_values: [...]}
  n_samples    int null,
  best_lag     int null,
  best_score   numeric null,
  best_pvalue  numeric null,
  computed_at  timestamptz not null default now(),
  unique (kind, brand_id, product_id, driver, target, metric_date)
);

create index if not exists ix_ar_lookup
  on analysis_results (brand_id, product_id, kind, metric_date desc);
```

## 6. Module specs

### 6.1 `marts/refresh_calendar.py`
```python
def run(ctx: dict) -> int:
    # Refresh dim_brand_calendar MV (extend trailing edge to today)
    # Returns number of rows in the MV after refresh
```

### 6.2 `marts/refresh_helpers.py`
```python
def run(ctx: dict) -> int:
    # Compute ad_pressure_daily from marketing_ads (rolling 30-day window
    # of active creatives, new launches, platform breadth)
    # Compute promotion_daily from promotions (expand date ranges to one row
    # per active day)
    # Compute price_daily from product_price_history (last known price per day,
    # plus 90-day rolling index)
    # Compute availability_daily from product_snapshots (per-day in-stock /
    # total variants)
    # All four can run concurrently inside this module since they touch
    # different tables
```

### 6.3 `marts/refresh_timeseries.py`
```python
def run(ctx: dict) -> int:
    # REFRESH MATERIALIZED VIEW CONCURRENTLY joola_timeseries_daily;
    # REFRESH MATERIALIZED VIEW CONCURRENTLY joola_timeseries_weekly;
    # Return new row count for each
```

### 6.4 `statistics/correlation_scan.py`
For each (brand, top-N products by mentions, driver in [attention_score,
ad_pressure_score, promo_active_flag, yt_transcript_attention]) compute
Pearson + Spearman over lags -28..+28 days. Use last 180 days of data.

```python
def lag_scan(x: pd.Series, y: pd.Series, max_lag=28) -> pd.DataFrame:
    rows = []
    for lag in range(-max_lag, max_lag + 1):
        x_lag = x.shift(lag)
        pair = pd.concat([x_lag, y], axis=1).dropna()
        if len(pair) < 14: continue
        pr, pp = pearsonr(pair.iloc[:, 0], pair.iloc[:, 1])
        sr, sp = spearmanr(pair.iloc[:, 0], pair.iloc[:, 1])
        rows.append({"lag": lag, "pearson_r": pr, "pearson_p": pp,
                     "spearman_rho": sr, "spearman_p": sp, "n": len(pair)})
    return pd.DataFrame(rows)
```

Write one `analysis_results` row per (brand, product, driver, target) pair,
with the lag-scan dataframe in `payload` and the best (highest |coefficient|)
captured in `best_lag`, `best_score`, `best_pvalue`.

### 6.5 `statistics/cross_correlation.py`
For each (brand, top-N product, driver, target) pair: use `statsmodels.ccf`
on STL-deseasonalized series. Provides a finer-grained companion to the
lag scan and is what the frontend heatmap will visualize.

### 6.6 `statistics/changepoints.py`
For each (brand, top-N product) and each series in
[`attention_score`, `estimated_units_sold`, `ad_pressure_score`]:
run `ruptures.Pelt(model="rbf")` with penalty=8 on the smoothed series
(7-day rolling mean). Write detected changepoint dates to `analysis_results`.

### 6.7 `statistics/granger.py`
For each (brand, top-N product, driver, target) pair:
1. Run ADF on each series; difference if `p > 0.05`.
2. Use `VAR.select_order` to pick optimal lag (max 14).
3. Run `grangercausalitytests` with that lag.
4. Write `(lag, ssr_ftest_p, lrtest_p, integration_order)` to
   `analysis_results` for the lag with the lowest p-value.

### 6.8 `statistics/seasonality.py`
For each (brand, top-N product) series, run `STL` from statsmodels with
period=7 (weekly seasonality is the dominant cycle in social data).
Store the decomposition coefficients + estimated seasonal amplitude.
Used by Granger to deseasonalize before testing.

## 7. Frontend plan

### 7.1 New dependencies
Just one: nothing. Existing `recharts` covers heatmaps with custom cells.
Reuse `components/v2/charts.tsx`.

### 7.2 New components (all in `components/v2/charts/`)
| Component | Purpose |
|---|---|
| `CorrelationHeatmap.tsx` | Rows = drivers, columns = lag values, cell color = correlation strength. Tooltip shows p-value, n, raw/differenced/deseasonalized. |
| `LagScanChart.tsx` | Single (driver, target) line chart of correlation by lag. Used in drilldown. |
| `ChangepointTimeline.tsx` | Time-series line with vertical markers at detected break dates. Tooltip shows date + magnitude. |
| `IndexedTimeSeries.tsx` | Dual-line indexed (base=100) chart with event overlays (promo bands, ad-burst circles, video-publish triangles). |
| `LeaderboardTable.tsx` | Ranked table with sparklines per product. Columns: attention, mentions, est sales, lead-lag info. |

### 7.3 New pages
| Route | Purpose | Hero chart |
|---|---|---|
| `/v2/correlations` | Lead/lag explorer | `CorrelationHeatmap` for each brand × product, with `LagScanChart` drilldown |
| `/v2/changepoints` | Regime-shift monitor | `ChangepointTimeline` per top-N product, attention + sales overlaid |
| `/v2/leaderboard` | Product leaderboard with stats | `LeaderboardTable`, click row → drill into `/v2/products` page with stats sidebar |

### 7.4 Existing-page additions
- `/v2/products/[id]` — add stats sidebar showing best lag from `analysis_results`
- `/v2` (Executive Overview) — add a "Top lead/lag signals this week" mini-widget
- `/v2/promotions` — overlay detected changepoints on the promo timeline

### 7.5 Data fetching
All reads via direct Supabase queries from client components (existing
pattern). Two new helpers in `lib/v2/`:

- `lib/v2/analytics.ts` — `fetchLagScans(brandSlug, productSlug?)`,
  `fetchChangepoints(brandSlug, productSlug?)`, `fetchGrangerResults(...)`
- `lib/v2/timeseries.ts` — fetch from `joola_timeseries_daily` /
  `joola_timeseries_weekly` with smart indexing (100-base) helpers

### 7.6 Interpretation guard rails
Every new page header shows a copy-paste interpretation legend:

> 📊 **How to read this**
> - *Correlated with* — Pearson/Spearman coefficient; says nothing about direction
> - *Tended to lead by N days* — peak correlation at lag N; suggests but does not prove causality
> - *Predictive-causal screen (Granger)* — past values of X improved forecast of Y; not a structural cause
> - *Regime break* — algorithm detected a level shift; investigate against event log

This prevents the most common misread of correlation as causation.

## 8. Implementation order

| # | Sprint | Days | Deliverable |
|---|---|---|---|
| 1 | Foundation | 1 | Migration 013: brands.timezone, dim_brand_calendar, 4 helper tables, analysis_results, joola_timeseries_daily/weekly |
| 2 | Mart refresh code | 1 | `marts/refresh_calendar.py`, `marts/refresh_helpers.py`, `marts/refresh_timeseries.py` |
| 3 | Statistics: descriptive | 2 | `statistics/correlation_scan.py`, `cross_correlation.py`, `seasonality.py` |
| 4 | Statistics: predictive | 1 | `statistics/granger.py`, `changepoints.py` |
| 5 | Frontend components | 1 | `CorrelationHeatmap`, `LagScanChart`, `ChangepointTimeline`, `IndexedTimeSeries` |
| 6 | Frontend pages | 1.5 | `/v2/correlations`, `/v2/changepoints`, `/v2/leaderboard` |
| 7 | Polish + e2e tests | 0.5 | Interpretation copy, Playwright smoke tests, README updates |

**Total: ~8 working days for full B-scope.**

## 9. Acceptance criteria

- `python scripts/weekly_run.py` runs scrape + analytics end-to-end
- `joola_timeseries_daily` has at least one row per (brand, product, day)
  for every day in the last 90 days
- Per-brand local timezone correctly applied (verified with a manual test
  on a 10pm-EST Instagram post)
- `analysis_results` has rows for every (top-10 product per brand, each of
  4 drivers, each of `lag_scan`/`ccf`/`granger`/`changepoint` kinds)
- All 3 new dashboards load in under 2 seconds against the live DB
- Every new dashboard shows the interpretation legend
- Playwright e2e tests pass for all 3 new routes
- README explains how to add a new statistical job

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Materialized view refresh blocks reads | Use `REFRESH MATERIALIZED VIEW CONCURRENTLY` (requires unique index) |
| Granger fails on series with too many NULLs | Skip pairs with <30 valid observations; log + continue |
| Frontend overclaims causality | Mandatory interpretation legend on every analytics page |
| Six-zero AUD prices skew `price_usd` aggregations | `price_daily` keeps both `price_usd` and `currency`; UI shows native currency |
| Analytics step fails but scraping succeeded | Independent checkpoint; analytics failure doesn't block next week's scrape |

## 11. Out of scope (for next phase)

- ITS / DiD / Synthetic Control causal inference
- Prophet / NeuralProphet forecasting
- `causal_events` auto-detection table
- Real ad-spend integration
- Forecasting console (`/v2/forecast`)
- Causal studies dashboard (`/v2/causal`)

These will land in scope C and D once we've used scope B in production for
a few weeks and seen what the data actually tells us.
