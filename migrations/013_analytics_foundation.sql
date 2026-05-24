-- ============================================================
-- Migration 013: Analytics Foundation (Scope B MVP)
-- Adds: brands.timezone column, dim_brand_calendar MV, 4 helper marts
-- (ad_pressure_daily, promotion_daily, price_daily, availability_daily),
-- joola_timeseries_daily/weekly MVs, and analysis_results table.
--
-- Reference: docs/superpowers/specs/2026-05-24-analytics-mvp-design.md §5
--
-- Schema adaptation notes (vs. spec):
--   - The spec references `products(id)` and `canonical_product_id` columns.
--     Reality (per migrations 010 + 012):
--       * Canonical product table is `products_catalog`, not `products`.
--       * `product_attention_daily` uses `product_id` (FK products_catalog.id)
--         and `attention_date` (DATE), NOT `metric_date` / `canonical_product_id`.
--       * `product_aliases` uses `product_id` (FK products_catalog.id), no
--         column called `canonical_product_id`.
--   - This migration therefore joins on the real columns and aliases
--     `product_id` AS `canonical_product_id` in the MV SELECT so downstream
--     code that reads the mart still sees the spec-mandated name.
--   - All product FKs in new tables point to `products_catalog(id)`.
--   - sales_estimates is joined on (brand_id, product_id, estimate_date).
--   - Promotions / price_history / product_snapshots are intentionally NOT
--     joined here — their daily projections are populated by the helper
--     marts (ad_pressure_daily, promotion_daily, price_daily,
--     availability_daily) before the MV refresh runs.
--
-- Run order:
--   1. Execute this file in Supabase SQL editor (or via apply script).
--   2. Then run scripts/analytics_backend/* to populate helper marts.
--   3. Then REFRESH MATERIALIZED VIEW CONCURRENTLY joola_timeseries_daily;
--      and REFRESH MATERIALIZED VIEW CONCURRENTLY joola_timeseries_weekly;
-- ============================================================


-- ─── 5.1  brands.timezone column ────────────────────────────
ALTER TABLE brands ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'UTC';

UPDATE brands
SET    timezone = 'America/New_York'
WHERE  slug IN (
         'joola','selkirk','paddletek','crbn','engage','onix',
         'franklin','head','wilson','gamma'
       )
  AND  COALESCE(timezone, '') <> 'America/New_York';

UPDATE brands
SET    timezone = 'Australia/Sydney'
WHERE  slug = 'six-zero'
  AND  COALESCE(timezone, '') <> 'Australia/Sydney';


-- ─── 5.2  dim_brand_calendar (materialized view) ────────────
-- Dense (brand × day) spine from 2025-01-01 → current_date in each brand's
-- local timezone. Every downstream mart left-joins onto this so empty days
-- still appear (zero-filled by COALESCE in the timeseries view).
CREATE MATERIALIZED VIEW IF NOT EXISTS dim_brand_calendar AS
SELECT
    b.id                                       AS brand_id,
    b.slug                                     AS brand_slug,
    b.timezone                                 AS brand_timezone,
    gs::date                                   AS metric_date_brand_local
FROM   brands b
CROSS  JOIN LATERAL generate_series(
           DATE '2025-01-01',
           CURRENT_DATE,
           INTERVAL '1 day'
       ) gs;

CREATE UNIQUE INDEX IF NOT EXISTS ix_brand_calendar_pk
    ON dim_brand_calendar (brand_id, metric_date_brand_local);


-- ─── 5.3  Helper marts (one per signal type) ────────────────

-- 5.3.a  Ad pressure (rolling proxy for unobservable ad spend)
CREATE TABLE IF NOT EXISTS ad_pressure_daily (
    metric_date       DATE          NOT NULL,
    brand_id          UUID          NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    active_creatives  INTEGER       NOT NULL DEFAULT 0,
    new_creatives     INTEGER       NOT NULL DEFAULT 0,
    platform_count    INTEGER       NOT NULL DEFAULT 0,
    ad_pressure_score NUMERIC(6,2)  NOT NULL DEFAULT 0,
    source_run_ok     BOOLEAN       NOT NULL DEFAULT TRUE,
    computed_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (metric_date, brand_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_pressure_brand
    ON ad_pressure_daily (brand_id, metric_date DESC);

COMMENT ON TABLE  ad_pressure_daily IS
    'Proxy daily ad pressure per brand. Populated by marts/refresh_helpers.py from marketing_ads. NOT real ad spend.';


-- 5.3.b  Promotion presence (per-day flag, optional product scope)
CREATE TABLE IF NOT EXISTS promotion_daily (
    metric_date       DATE          NOT NULL,
    brand_id          UUID          NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    product_id        UUID          NULL  REFERENCES products_catalog(id) ON DELETE CASCADE,
    promo_active_flag SMALLINT      NOT NULL DEFAULT 0,
    promo_depth_pct   NUMERIC(5,2)  NULL,
    promo_count       INTEGER       NOT NULL DEFAULT 0,
    source_run_ok     BOOLEAN       NOT NULL DEFAULT TRUE,
    computed_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (metric_date, brand_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_promotion_daily_brand
    ON promotion_daily (brand_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_promotion_daily_product
    ON promotion_daily (product_id, metric_date DESC);

COMMENT ON TABLE  promotion_daily IS
    'One row per (brand × product × day) when a promotion is in flight. Expanded from promotions.start_date/end_date by marts/refresh_helpers.py.';


-- 5.3.c  Daily price + 90-day rolling index (price ÷ trailing baseline)
CREATE TABLE IF NOT EXISTS price_daily (
    metric_date     DATE          NOT NULL,
    product_id      UUID          NOT NULL REFERENCES products_catalog(id) ON DELETE CASCADE,
    price_usd       NUMERIC(10,2) NULL,
    price_index_90d NUMERIC(6,3)  NULL,
    source_run_ok   BOOLEAN       NOT NULL DEFAULT TRUE,
    computed_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (metric_date, product_id)
);

CREATE INDEX IF NOT EXISTS idx_price_daily_product
    ON price_daily (product_id, metric_date DESC);

COMMENT ON TABLE  price_daily IS
    'Daily last-known price per product + 90-day rolling index (price ÷ trailing 90-day baseline). Populated from product_price_history.';


-- 5.3.d  Daily availability (in_stock ÷ total_variants)
CREATE TABLE IF NOT EXISTS availability_daily (
    metric_date        DATE          NOT NULL,
    brand_id           UUID          NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    product_id         UUID          NULL  REFERENCES products_catalog(id) ON DELETE CASCADE,
    in_stock_count     INTEGER       NOT NULL DEFAULT 0,
    total_variants     INTEGER       NOT NULL DEFAULT 0,
    availability_index NUMERIC(5,4)  NULL,
    source_run_ok      BOOLEAN       NOT NULL DEFAULT TRUE,
    computed_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (metric_date, brand_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_availability_daily_brand
    ON availability_daily (brand_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_availability_daily_product
    ON availability_daily (product_id, metric_date DESC);

COMMENT ON TABLE  availability_daily IS
    'Daily in-stock ratio per (brand × product). availability_index = in_stock_count / NULLIF(total_variants,0). Populated from product_snapshots.';


-- ─── 5.4  joola_timeseries_daily (materialized view) ────────
-- The unified daily mart. One row per (brand × day × product mentioned that
-- day). Empty (brand × day) cells still appear via dim_brand_calendar; rows
-- without a product mention will have NULL canonical_product_id.
--
-- NOTE: `product_attention_daily.product_id` is aliased as
-- `canonical_product_id` so dashboards / statistics modules match the
-- vocabulary in the design spec.
--
-- DROP-then-CREATE (not IF NOT EXISTS) because a partial prior run could
-- have left an MV with a stale schema; IF NOT EXISTS would silently skip
-- recreating it and the downstream index would fail on the missing column.
-- A prior run may also have created either object as a plain TABLE (not an
-- MV). DROP MATERIALIZED VIEW errors on a table and vice-versa, so we
-- inspect pg_class.relkind first and drop with the matching command.
--   relkind = 'r' → ordinary table
--   relkind = 'm' → materialized view
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'joola_timeseries_weekly' AND relkind = 'm') THEN
        EXECUTE 'DROP MATERIALIZED VIEW joola_timeseries_weekly CASCADE';
    ELSIF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'joola_timeseries_weekly' AND relkind = 'r') THEN
        EXECUTE 'DROP TABLE joola_timeseries_weekly CASCADE';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'joola_timeseries_daily' AND relkind = 'm') THEN
        EXECUTE 'DROP MATERIALIZED VIEW joola_timeseries_daily CASCADE';
    ELSIF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'joola_timeseries_daily' AND relkind = 'r') THEN
        EXECUTE 'DROP TABLE joola_timeseries_daily CASCADE';
    END IF;
END $$;
CREATE MATERIALIZED VIEW joola_timeseries_daily AS
SELECT
    cal.metric_date_brand_local                  AS metric_date,
    cal.brand_id,
    att.product_id                               AS canonical_product_id,
    pc.display_name                              AS canonical_product_name,

    -- attention layer (already exists per migration 012)
    COALESCE(att.mentions_total,         0)      AS mention_count,
    COALESCE(att.attention_score,        0)      AS total_engagement,
    COALESCE(att.attention_score,        0)      AS attention_score,
    COALESCE(att.sales_likelihood_score, 0)      AS sales_likelihood_score,

    -- ad / promo / price / avail (new helpers)
    COALESCE(ad.ad_pressure_score, 0)            AS ad_pressure_score,
    COALESCE(pr.promo_active_flag, 0)            AS promo_active_flag,
    pr.promo_depth_pct,
    px.price_usd,
    px.price_index_90d,
    av.availability_index,

    -- outcome (already exists per migration 010)
    se.estimated_units_sold,
    se.estimated_revenue,
    se.confidence_score                          AS sales_estimate_confidence
FROM       dim_brand_calendar cal
LEFT JOIN  product_attention_daily att
       ON  att.attention_date = cal.metric_date_brand_local
      AND  att.brand_id       = cal.brand_id
LEFT JOIN  products_catalog pc
       ON  pc.id = att.product_id
LEFT JOIN  ad_pressure_daily ad
       ON  ad.metric_date = cal.metric_date_brand_local
      AND  ad.brand_id    = cal.brand_id
LEFT JOIN  promotion_daily pr
       ON  pr.metric_date = cal.metric_date_brand_local
      AND  pr.brand_id    = cal.brand_id
      AND  pr.product_id  IS NOT DISTINCT FROM att.product_id
LEFT JOIN  price_daily px
       ON  px.metric_date = cal.metric_date_brand_local
      AND  px.product_id  = att.product_id
LEFT JOIN  availability_daily av
       ON  av.metric_date = cal.metric_date_brand_local
      AND  av.brand_id    = cal.brand_id
      AND  av.product_id  IS NOT DISTINCT FROM att.product_id
LEFT JOIN  sales_estimates se
       ON  se.estimate_date = cal.metric_date_brand_local
      AND  se.brand_id      = cal.brand_id
      AND  se.product_id    = att.product_id;

-- Unique index is REQUIRED for REFRESH MATERIALIZED VIEW CONCURRENTLY.
-- NULL canonical_product_id rows (calendar days with no product activity)
-- require a stable sentinel — we use COALESCE to the nil UUID
-- '00000000-0000-0000-0000-000000000000' in the expression.
CREATE UNIQUE INDEX IF NOT EXISTS ix_jts_daily
    ON joola_timeseries_daily (
        metric_date,
        brand_id,
        COALESCE(canonical_product_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );

CREATE INDEX IF NOT EXISTS ix_jts_daily_brand
    ON joola_timeseries_daily (brand_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS ix_jts_daily_product
    ON joola_timeseries_daily (canonical_product_id, metric_date DESC);


-- joola_timeseries_weekly: weekly rollup (week starts Monday per
-- date_trunc('week', ...) ISO convention).
-- Dropped by CASCADE above; recreate fresh to keep schemas in lockstep.
CREATE MATERIALIZED VIEW joola_timeseries_weekly AS
SELECT
    DATE_TRUNC('week', metric_date)::date AS week_start,
    brand_id,
    canonical_product_id,
    canonical_product_name,
    SUM(mention_count)             AS mention_count,
    SUM(total_engagement)          AS total_engagement,
    AVG(attention_score)           AS attention_score_avg,
    MAX(attention_score)           AS attention_score_max,
    AVG(ad_pressure_score)         AS ad_pressure_score_avg,
    MAX(promo_active_flag)         AS promo_active_any,
    AVG(promo_depth_pct)           AS promo_depth_pct_avg,
    AVG(price_usd)                 AS price_usd_avg,
    AVG(price_index_90d)           AS price_index_90d_avg,
    AVG(availability_index)        AS availability_index_avg,
    SUM(estimated_units_sold)      AS estimated_units_sold,
    SUM(estimated_revenue)         AS estimated_revenue
FROM   joola_timeseries_daily
GROUP  BY 1, 2, 3, 4;

CREATE UNIQUE INDEX IF NOT EXISTS ix_jts_weekly
    ON joola_timeseries_weekly (
        week_start,
        brand_id,
        COALESCE(canonical_product_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );


-- ─── 5.5  analysis_results table ────────────────────────────
-- One row per (kind × brand × product × driver × target × date) statistical
-- result. payload JSONB carries the per-method body (lag scan grid, ccf
-- coefficients, granger p-values, changepoint dates, stl decomposition).
CREATE TABLE IF NOT EXISTS analysis_results (
    id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    kind         TEXT          NOT NULL,                          -- 'lag_scan'|'ccf'|'granger'|'changepoint'|'stl'
    brand_id     UUID          NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    product_id   UUID          NULL  REFERENCES products_catalog(id) ON DELETE CASCADE,
    driver       TEXT          NULL,                              -- e.g. 'attention_score'
    target       TEXT          NULL,                              -- e.g. 'estimated_units_sold'
    metric_date  DATE          NOT NULL,                          -- the date the analysis was run for
    payload      JSONB         NOT NULL,
    n_samples    INTEGER       NULL,
    best_lag     INTEGER       NULL,
    best_score   NUMERIC       NULL,
    best_pvalue  NUMERIC       NULL,
    computed_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (kind, brand_id, product_id, driver, target, metric_date)
);

CREATE INDEX IF NOT EXISTS ix_ar_lookup
    ON analysis_results (brand_id, product_id, kind, metric_date DESC);

COMMENT ON TABLE  analysis_results IS
    'Statistical-test results table. Read by /v2/correlations, /v2/changepoints, /v2/leaderboard. Written by scripts/analytics_backend/statistics/*.';


-- ============================================================
-- ROLLBACK NOTES
-- ------------------------------------------------------------
-- See migrations/013_rollback.sql for a tested reversal.
-- Quick reference:
--   DROP MATERIALIZED VIEW IF EXISTS joola_timeseries_weekly;
--   DROP MATERIALIZED VIEW IF EXISTS joola_timeseries_daily;
--   DROP TABLE IF EXISTS analysis_results;
--   DROP TABLE IF EXISTS availability_daily;
--   DROP TABLE IF EXISTS price_daily;
--   DROP TABLE IF EXISTS promotion_daily;
--   DROP TABLE IF EXISTS ad_pressure_daily;
--   DROP MATERIALIZED VIEW IF EXISTS dim_brand_calendar;
--   ALTER TABLE brands DROP COLUMN IF EXISTS timezone;
-- ============================================================
