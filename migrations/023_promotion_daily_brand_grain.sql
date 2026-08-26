-- 023_promotion_daily_brand_grain.sql
--
-- Fix: `promotion_daily` has held 0 rows since migration 013 created it.
--
-- Root cause. 013 declares the column as nullable:
--
--     product_id UUID NULL REFERENCES products_catalog(id) ...
--     PRIMARY KEY (metric_date, brand_id, product_id)
--
-- but in PostgreSQL a PRIMARY KEY column is NOT NULL regardless of what the
-- column definition says. The explicit `NULL` is silently overridden. So the
-- author's intent (allow brand-level rows with no product) was never honoured.
--
-- Meanwhile the source table has no product dimension at all: `promotions`
-- carries (brand_id, discount_pct, detected_at) and nothing else — these are
-- sitewide banner promos. `_compute_promotion_daily()` therefore emits
-- product_id = NULL on every row, and every batch died with
--
--     23502: null value in column "product_id" of relation "promotion_daily"
--            violates not-null constraint
--
-- Before 2026-08-18 that surfaced only as a logged error and an upsert return of
-- 0, so the step reported `done` and the loss was invisible. It is now a hard
-- failure (core/supabase_client._assert_wrote_something).
--
-- Fix: move the primary key to the grain the data actually has —
-- (metric_date, brand_id) — matching `ad_pressure_daily`, which has the same
-- brand-level shape and has always worked. `product_id` stays as a nullable
-- non-key column so a future product-level promo source needs no column change.
--
-- This also matches the only real consumer: the campaign-offer-intel ad-pressure
-- vs promo-pressure matrix reads promo_active_flag / promo_depth_pct per brand.
--
-- After applying, re-run:
--     python -m analytics_backend.run --module marts
-- Expect ~10 promotion_daily rows on the current 90-day window.

begin;

-- Drop the composite PK that forced product_id NOT NULL.
alter table promotion_daily
  drop constraint if exists promotion_daily_pkey;

-- Belt and braces: with the PK gone the column is genuinely nullable again.
alter table promotion_daily
  alter column product_id drop not null;

-- Re-key at brand grain. PostgREST needs a real UNIQUE CONSTRAINT (not an
-- expression index) to serve on_conflict=metric_date,brand_id.
alter table promotion_daily
  add constraint promotion_daily_pkey primary key (metric_date, brand_id);

comment on table promotion_daily is
  'One row per (brand x day) when a promotion is in flight, derived from '
  'promotions.detected_at. product_id is nullable and currently always NULL: '
  'the promotions source is sitewide banners with no product dimension.';

notify pgrst, 'reload schema';

commit;

-- ── Known follow-up, deliberately NOT changed here ────────────────────────
-- joola_timeseries_daily joins this table as:
--     LEFT JOIN promotion_daily pr
--            ON pr.metric_date = cal.metric_date_brand_local
--           AND pr.brand_id    = cal.brand_id
--           AND pr.product_id  IS NOT DISTINCT FROM att.product_id
-- With product_id NULL on every promotion_daily row, that last predicate only
-- matches attention rows whose product_id is also NULL — so brand-level promo
-- pressure will not reach product-level rows in the MV. Dropping the predicate
-- would fan brand promo data across every product for that brand, which is a
-- semantic decision about how promo pressure should be attributed, not a bug
-- fix. Left for a separate, deliberate migration.
