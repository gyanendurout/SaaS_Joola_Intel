-- 030_dashboard_rpcs_base.sql — shared read-only RPCs for the dashboard.
-- rpc_latest_data_date(): the IST calendar day of the newest core scrape.
-- The date picker anchors its default window on this instead of "today",
-- so a quiet week never shows an empty dashboard.
--
-- Sources are the core weekly-run tables only (social, news, products, ads).
-- product_snapshots and paddle_reviews are refreshed on their own cadence and
-- are deliberately excluded. All columns are timestamptz.
-- marketing_ads has no scraped_at; captured_at is its scrape timestamp.
create or replace function public.rpc_latest_data_date()
returns date
language sql
stable
security invoker
set search_path = ''
as $$
  select (max(t) at time zone 'Asia/Kolkata')::date
  from (
              select max(scraped_at)      as t from public.ig_profiles_weekly
    union all select max(scraped_at)           from public.x_profiles_weekly
    union all select max(scraped_at)           from public.tiktok_profiles_weekly
    union all select max(scraped_at)           from public.yt_channel_weekly
    union all select max(scraped_at)           from public.reddit_mentions
    union all select max(scraped_at)           from public.news_articles
    union all select max(last_scraped_at)      from public.products
    union all select max(captured_at)          from public.marketing_ads
  ) s
$$;

grant execute on function public.rpc_latest_data_date() to anon, authenticated;

-- Verify: select public.rpc_latest_data_date();   -- expect 2026-10-12 (IST) as of 2026-10-17
--   (newest source: products.last_scraped_at 2026-10-12 08:31 UTC = 14:01 IST)
