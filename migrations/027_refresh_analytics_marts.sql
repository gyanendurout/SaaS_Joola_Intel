-- 027_refresh_analytics_marts.sql
-- ============================================================================
-- OPERATIONAL SCRIPT — NOT A SCHEMA CHANGE. Safe to run any number of times.
--
-- WHY THIS FILE EXISTS
-- --------------------
-- The three analytics materialized views froze on 2026-05-24 (weekly on
-- 2026-05-18) and nothing reported it for 16 weeks.
--
-- `analytics_backend` issues REFRESH MATERIALIZED VIEW through an
-- `exec_sql(query text)` Postgres RPC. That function is defined in NO migration
-- and does not exist in this project, so every call returns HTTP 404. Because
-- exec_sql never raised, the refresh step went on to report the row count of the
-- STALE view, and the runner logged a healthy
-- `OK marts_refresh_timeseries done -- rows=5619` while refreshing nothing.
-- (That no-op now logs ERROR instead — commit f7ccf6d — but it still cannot
-- perform the refresh.)
--
-- All five statistics modules read joola_timeseries_daily, so while the views are
-- frozen they write FRESH rows into analysis_results computed on data ending
-- 2026-05-24. The Correlations and Changepoints pages therefore look freshly
-- computed and are months behind — worse than visibly stale.
--
-- DEADLINE: after roughly 2026-11-20 the statistics modules' 180-day window stops
-- overlapping the frozen views entirely, and all five switch from returning stale
-- numbers to returning 0 — silently.
--
-- HOW TO RUN
-- ----------
-- Paste into the Supabase SQL editor and run. Takes seconds to a couple of
-- minutes depending on row counts. No locks that matter outside the refresh.
--
-- Order is NOT arbitrary: dim_brand_calendar is the (brand x day) spine both
-- timeseries views left-join onto, so it must be refreshed FIRST or the daily and
-- weekly views rebuild against a date spine that still ends in May.
--
-- Plain REFRESH is used deliberately rather than CONCURRENTLY. All three views do
-- have the unique index CONCURRENTLY requires (ix_brand_calendar_pk, ix_jts_daily,
-- ix_jts_weekly), BUT `REFRESH MATERIALIZED VIEW CONCURRENTLY` cannot run inside a
-- transaction block, and a multi-statement script in the SQL editor may be wrapped
-- in one. Plain REFRESH takes an ACCESS EXCLUSIVE lock on the view for the
-- duration — irrelevant here, since the dashboards tolerate a few seconds and the
-- views are already four months stale. If you want the zero-downtime version, run
-- the CONCURRENTLY variants at the bottom ONE STATEMENT AT A TIME.
-- ============================================================================

REFRESH MATERIALIZED VIEW dim_brand_calendar;
REFRESH MATERIALIZED VIEW joola_timeseries_daily;
REFRESH MATERIALIZED VIEW joola_timeseries_weekly;


-- ── Verify ───────────────────────────────────────────────────────────────────
-- Run this after the refresh. Every `days_behind` should be 0 or 1 (the weekly
-- view trails by up to 7 by design, since it buckets to week_start).
--
-- If dim_brand_calendar is still stuck, nothing downstream will have moved —
-- check that first and re-run.

SELECT 'dim_brand_calendar'      AS relation,
       MAX(metric_date_brand_local)::date      AS newest,
       CURRENT_DATE - MAX(metric_date_brand_local)::date AS days_behind
FROM   dim_brand_calendar
UNION ALL
SELECT 'joola_timeseries_daily',
       MAX(metric_date)::date,
       CURRENT_DATE - MAX(metric_date)::date
FROM   joola_timeseries_daily
UNION ALL
SELECT 'joola_timeseries_weekly',
       MAX(week_start)::date,
       CURRENT_DATE - MAX(week_start)::date
FROM   joola_timeseries_weekly;


-- ── After the refresh: rebuild the statistics on fresh input ─────────────────
-- The refresh fixes the marts but does NOT recompute analysis_results. The rows
-- written on 2026-09-12 are stamped with that date and were computed on May data,
-- so they stay wrong until the statistics modules re-run:
--
--     python -m analytics_backend.run --module statistics
--
-- (or `--module all` to redo marts + statistics in one pass).


-- ── Zero-downtime alternative ────────────────────────────────────────────────
-- Run these THREE STATEMENTS SEPARATELY, never as one script — CONCURRENTLY
-- cannot execute inside a transaction block. Also note CONCURRENTLY requires the
-- view to have been populated at least once, which is true for all three.
--
--     REFRESH MATERIALIZED VIEW CONCURRENTLY dim_brand_calendar;
--     REFRESH MATERIALIZED VIEW CONCURRENTLY joola_timeseries_daily;
--     REFRESH MATERIALIZED VIEW CONCURRENTLY joola_timeseries_weekly;


-- ── What this file deliberately does NOT do ──────────────────────────────────
-- It does not create `exec_sql(query text)`. Doing so would let the pipeline
-- refresh unattended, but a SECURITY DEFINER function that executes arbitrary SQL
-- grants full database control to any holder of the service-role key. That is a
-- privilege decision for a human, not a convenience fix. Until it is made, this
-- script must be run by hand after each weekly run — see TODO.md item 8.
