# JOOLA Intel — Analytics Backend

The analytical brain that sits on top of the scraping pipeline. It turns the
raw scraped rows into a dense daily time-series mart, then runs statistical
tests for lead/lag relationships, predictive causality, and regime shifts.

```
scripts/
├── scraping/           ← scraping pipeline (Phase 1-4 of weekly_run.py)
└── analytics_backend/  ← this folder (Phase 5+: marts + statistics)
    ├── README.md
    ├── run.py                  CLI entry point (mirrors scraping/run.py)
    ├── requirements.txt        scipy, statsmodels, ruptures, scikit-learn
    ├── core/                   shared utilities (logger, supabase, db wrappers)
    ├── marts/                  materialized-view refresh jobs
    │   ├── refresh_calendar.py        dim_brand_calendar
    │   ├── refresh_timeseries.py      joola_timeseries_daily/weekly
    │   └── helpers.py                 ad_pressure_daily, promotion_daily, etc.
    └── statistics/             analytical jobs writing to analysis_results table
        ├── correlation_scan.py        Pearson + Spearman lag scans
        ├── cross_correlation.py       statsmodels CCF for one driver/target pair
        ├── granger.py                 ADF + VAR.select_order + Granger test
        ├── changepoints.py            ruptures PELT on smoothed series
        └── seasonality.py             STL decomposition
```

## How it fits

```
Monday 07:00 IST
   │
   ▼
weekly_run.py
   │
   ├─→ Phase 1-4: backend.scraping.run  (all 9 channels + enrichment + facts)
   │       ↓ writes to: instagram_*, yt_*, products, sales_estimates, …
   │
   └─→ Phase 5:  scripts.analytics_backend.run
           │
           ├─→ marts/refresh_*    rebuild dim_brand_calendar +
           │                      joola_timeseries_daily/weekly +
           │                      ad_pressure_daily, promotion_daily, …
           │       ↓ writes to: materialized views, joola_timeseries_* tables
           │
           └─→ statistics/*       per (brand, product) compute Pearson +
                                  Spearman lag scans, CCF, Granger, changepoints
                   ↓ writes to: analysis_results
```

The frontend reads from `joola_timeseries_*` and `analysis_results` —
both are tables, not API calls, so dashboards stay fast.

## Run it

```bash
# Full weekly pass (scrape THEN analyze)
python scripts/weekly_run.py

# Just analytics (assumes scraping already populated tables)
python -m scripts.analytics_backend.run --module all

# Just one mart
python -m scripts.analytics_backend.run --module marts

# Just one statistical job
python -m scripts.analytics_backend.run --module statistics --source granger
```

## What's in v1 (scope "B")

| Component | What it does | Output table / view |
|---|---|---|
| `marts/refresh_calendar.py` | Brand × date spine respecting brand-local timezones | `dim_brand_calendar` (MV) |
| `marts/refresh_timeseries.py` | Aligns mentions, attention, ads, promo, price, availability, sales estimates onto the calendar | `joola_timeseries_daily`, `joola_timeseries_weekly` (MV) |
| `marts/helpers.py` | Per-day aggregations: ad_pressure_score, promo_active_flag, price_index, availability_index | `ad_pressure_daily`, `promotion_daily`, `price_daily`, `availability_daily` |
| `statistics/correlation_scan.py` | Pearson + Spearman across lag window -28..+28 days for each (driver, target) pair | `analysis_results` rows tagged `kind='lag_scan'` |
| `statistics/cross_correlation.py` | statsmodels CCF for finer cross-correlation analysis | `analysis_results` rows tagged `kind='ccf'` |
| `statistics/granger.py` | ADF → differencing if needed → VAR lag-order → Granger non-causality test | `analysis_results` rows tagged `kind='granger'` |
| `statistics/changepoints.py` | Ruptures PELT on attention_score / estimated_units_sold / ad_pressure_score | `analysis_results` rows tagged `kind='changepoint'` |
| `statistics/seasonality.py` | STL decomposition for deseasonalized series before Granger | `analysis_results` rows tagged `kind='stl'` |

Out of scope for v1 (deferred to later phases):
- Interrupted Time Series, DiD, Synthetic Control (causal inference)
- Prophet / NeuralProphet forecasting
- Real ad-spend integration (until first-party feed exists)

## Adding a new statistical job

1. Create `statistics/<your_job>.py` exposing `run(ctx: dict) -> int`.
2. Read source data from `joola_timeseries_daily` (don't hit raw tables).
3. Write rows to `analysis_results` table with `kind`, `metric_date`, `brand_id`,
   `product_id` (nullable), `payload jsonb`, `created_at`.
4. Register in `run.py` MODULE_STEPS.

## Conventions

- All dates are **brand-local** (`metric_date_brand_local` in the mart),
  computed using `AT TIME ZONE brands.timezone` in the calendar MV.
- NULL ≠ 0 — a `NULL` mention count means "source did not run that day".
  Imputation happens in the statistics layer, not at ingest.
- Statistical jobs are idempotent: rerunning replaces prior `analysis_results`
  for the same `(kind, brand, product, run_date)` tuple.

See `docs/superpowers/specs/2026-05-24-analytics-mvp-design.md` for the full
design rationale.
