-- ============================================================
-- Migration 013 ROLLBACK
-- Drops every object created by 013_analytics_foundation.sql, in
-- reverse dependency order. Safe to re-run (uses IF EXISTS).
-- ============================================================

-- 5.5
DROP INDEX            IF EXISTS ix_ar_lookup;
DROP TABLE            IF EXISTS analysis_results;

-- 5.4
DROP INDEX            IF EXISTS ix_jts_weekly;
DROP MATERIALIZED VIEW IF EXISTS joola_timeseries_weekly;

DROP INDEX            IF EXISTS ix_jts_daily_product;
DROP INDEX            IF EXISTS ix_jts_daily_brand;
DROP INDEX            IF EXISTS ix_jts_daily;
DROP MATERIALIZED VIEW IF EXISTS joola_timeseries_daily;

-- 5.3
DROP INDEX            IF EXISTS idx_availability_daily_product;
DROP INDEX            IF EXISTS idx_availability_daily_brand;
DROP TABLE            IF EXISTS availability_daily;

DROP INDEX            IF EXISTS idx_price_daily_product;
DROP TABLE            IF EXISTS price_daily;

DROP INDEX            IF EXISTS idx_promotion_daily_product;
DROP INDEX            IF EXISTS idx_promotion_daily_brand;
DROP TABLE            IF EXISTS promotion_daily;

DROP INDEX            IF EXISTS idx_ad_pressure_brand;
DROP TABLE            IF EXISTS ad_pressure_daily;

-- 5.2
DROP INDEX            IF EXISTS ix_brand_calendar_pk;
DROP MATERIALIZED VIEW IF EXISTS dim_brand_calendar;

-- 5.1
-- WARNING: This removes per-brand timezone metadata. Other tables/code
-- may now silently fall back to UTC. Only run this rollback if you are
-- also reverting consumers that read brands.timezone.
ALTER TABLE brands DROP COLUMN IF EXISTS timezone;
