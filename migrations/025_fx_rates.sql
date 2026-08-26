-- Migration 025: fx_rates + local-price capture on products
-- Created 2026-08-26 for the Product Intel redesign.
-- See docs/PRODUCT_INTEL_REDESIGN.md decision D-FX.
--
-- PROBLEM
-- Six Zero is an AU storefront. Today its catalog rows land as:
--     price_usd = NULL, currency = 'AUD', country_code = 'AU'
-- for all 15 AUD rows. The published AUD figure is not stored ANYWHERE — the
-- scraper drops it because the column it writes to is named price_usd and the
-- value isn't USD. Net effect: 24 of Six Zero's 35 catalog rows have no price
-- at all, so Six Zero is absent from price-tier analysis and cannot be
-- assigned a Tier (Value / Mid / Premium) on Product Intel.
--
-- You cannot convert a number you never captured. So this migration does two
-- things, in this order:
--   1. price_local + price_local_currency  — capture what the site actually says
--   2. fx_rates + audit columns            — convert it, and record how
--
-- WHY AN fx_rates TABLE RATHER THAN A CONSTANT
-- A hardcoded rate silently rots: six months on, every Six Zero price is wrong
-- and nothing in the data says so. Storing the rate and its as-of date beside
-- the converted value makes any historical price auditable — you can always
-- answer "what rate produced this number, and when".
--
-- CONVERSION IS AT WRITE TIME, NOT READ TIME. The frontend keeps reading
-- price_usd and needs no FX awareness. A row whose fx_rate_used is set is a
-- converted row; NULL means price_usd came straight from the source.

begin;

-- ── 1. capture the price as published ────────────────────────────────────────
alter table products
  add column if not exists price_local           numeric(10,2),
  add column if not exists price_local_currency  text,
  add column if not exists fx_rate_used          numeric(12,6),
  add column if not exists fx_rate_date          date;

comment on column products.price_local is
  'Price exactly as published by the storefront, in price_local_currency. Populated for non-USD stores (today: Six Zero / AUD) so the original figure is never lost.';
comment on column products.fx_rate_used is
  'The rate applied to derive price_usd from price_local. NULL means price_usd came directly from the source and was not converted.';
comment on column products.fx_rate_date is
  'as_of date of the fx_rates row used. Makes a converted price auditable after the fact.';

-- ── 2. the rate table ────────────────────────────────────────────────────────
create table if not exists fx_rates (
  id           uuid primary key default gen_random_uuid(),
  base_ccy     text not null,              -- currency being converted FROM, e.g. 'AUD'
  quote_ccy    text not null,              -- currency being converted TO,   e.g. 'USD'
  rate         numeric(12,6) not null,     -- 1 base = <rate> quote
  as_of        date not null,
  source       text not null,              -- provider name, or 'manual'
  created_at   timestamptz not null default now(),

  -- real UNIQUE CONSTRAINT (not an expression index) so PostgREST on_conflict
  -- works: sb.upsert("fx_rates", rows, "base_ccy,quote_ccy,as_of")
  unique (base_ccy, quote_ccy, as_of),

  constraint fx_rates_rate_positive check (rate > 0),
  constraint fx_rates_ccy_differ    check (base_ccy <> quote_ccy)
);

create index if not exists idx_fx_rates_lookup on fx_rates(base_ccy, quote_ccy, as_of desc);

comment on table fx_rates is
  'FX rates used to normalise non-USD storefront prices. One row per (base, quote, as_of). Read the newest as_of <= the price scrape date.';

-- Seed a manual AUD→USD rate so Six Zero converts on the very next scrape even
-- before an automated rate feed exists. `source = 'manual'` marks it as
-- operator-entered rather than provider-sourced; replace with a real feed when
-- one is wired up. Idempotent — re-running this migration will not duplicate.
insert into fx_rates (base_ccy, quote_ccy, rate, as_of, source)
values ('AUD', 'USD', 0.660000, date '2026-08-26', 'manual')
on conflict (base_ccy, quote_ccy, as_of) do nothing;

commit;

notify pgrst, 'reload schema';

-- ── VERIFY (run manually after applying) ─────────────────────────────────────
-- Expect: 4 new columns on products, fx_rates with >= 1 row.
--   select column_name from information_schema.columns
--    where table_name = 'products'
--      and column_name in ('price_local','price_local_currency','fx_rate_used','fx_rate_date');
--   select * from fx_rates;
--
-- Six Zero backfill is NOT done here — the AUD figures were never stored, so
-- there is nothing in the DB to convert. They populate on the next
-- `--module products` run once scrape_catalog_local.py writes price_local.
