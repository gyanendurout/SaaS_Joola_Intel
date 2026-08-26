-- Migration 024: paddle_specs
-- Manufacturer-published paddle specifications, crawled from the 7 in-scope
-- brand websites (joola, selkirk, crbn, paddletek, engage, six-zero, franklin).
-- Created 2026-08-26 for the Product Intel redesign — see
-- docs/PRODUCT_INTEL_REDESIGN.md for the full design and decision log.
--
-- WHY THIS TABLE EXISTS
-- The schema already had spec columns and they were never populated:
--   product_variants.thickness  0 / 9,317 filled
--   product_variants.weight     0 / 9,317 filled
--   product_variants.color      0 / 9,317 filled
--   product_variants.size       0 / 9,317 filled
--   products.ai_category        0 / 474   filled
-- and no column for core material, face material, shape or swing weight was
-- ever defined. Rather than retrofit four dead columns on a variant table
-- whose grain is wrong (see GRAIN below), this migration adds a purpose-built
-- table fed by a dedicated crawler.
--
-- GRAIN: one row per (brand, source product handle, variant_key).
-- NOT one row per product. Multi-shape paddles publish a DIFFERENT spec set
-- per shape — Selkirk Epic vs Invikta, Six Zero Hybrid/Elongated/Widebody,
-- Engage Elongated/Widebody — and Paddletek/JOOLA publish per-thickness
-- variants. A product-grain table would silently keep whichever variant the
-- parser happened to see last.
--
-- WHY variant_key INSTEAD OF (shape, thickness_mm) IN THE UNIQUE KEY
-- Postgres treats NULLs as DISTINCT in a unique constraint, so two rows with
-- shape IS NULL would both be accepted and every re-crawl would duplicate.
-- Several brands genuinely lack one of these (CRBN publishes thickness in
-- prose only; Six Zero exposes shape only as a variant option), so NULLs are
-- expected, not exceptional. `variant_key` is a NOT NULL deterministic string
-- the scraper composes (e.g. 'elongated|16.0', 'widebody|14.0', 'default'),
-- which keeps the upsert idempotent regardless of which fields parsed.
-- shape / thickness_mm remain as nullable descriptive columns for querying.
--
-- POSTGREST NOTE: `unique (brand_id, source_handle, variant_key)` below is a
-- REAL UNIQUE CONSTRAINT, not an expression index. PostgREST's on_conflict
-- only matches real constraints — getting this wrong is what silently killed
-- promotion_daily (fixed in 023) and required 008 to retrofit a constraint on
-- products. The scraper calls:
--     sb.upsert("paddle_specs", rows, "brand_id,source_handle,variant_key")
--
-- IDEMPOTENCY: re-running the crawler UPSERTs in place. raw_specs is fully
-- replaced each run so a removed field on the brand's site disappears here too.

begin;

create table if not exists paddle_specs (
  id                 uuid primary key default gen_random_uuid(),
  brand_id           uuid not null references brands(id),

  -- identity / provenance
  source_handle      text not null,          -- shopify handle, or magento url key
  source_url         text not null,
  product_name       text not null,          -- verbatim, as the brand publishes it
  family_key         text not null,          -- normalized; bridges to products_catalog + paddle_products
  variant_key        text not null,          -- 'shape|thickness' or 'default' — see header

  -- the six fields available for ALL 7 brands: the only honest comparison axes
  shape              text,                   -- elongated | hybrid | widebody | standard
  thickness_mm       numeric(5,2),
  length_in          numeric(5,2),
  width_in           numeric(5,2),
  handle_length_in   numeric(5,2),
  weight_oz_min      numeric(4,2),           -- brands publish RANGES ("7.7-8.1 oz"),
  weight_oz_max      numeric(4,2),           -- collapsing to a midpoint loses real information

  -- available for most but not all 7 — render per product, never rank on these
  grip_circum_in     numeric(5,3),           -- Paddletek does not publish
  core_material      text,
  face_material      text,
  swing_weight       numeric(5,1),           -- JOOLA + Engage do not publish
  twist_weight       numeric(5,2),           -- JOOLA does not publish
  balance_point_mm   numeric(5,1),           -- CRBN only

  -- NULL means NOT STATED, never "not certified". Only 4 of 7 brands publish
  -- this despite all of them being certified. Do not render absence as a
  -- negative signal in the UI.
  usap_approved      boolean,

  -- every label/value pair exactly as scraped. Parsers WILL miss fields; this
  -- lets us backfill by reprocessing instead of re-crawling the brand sites.
  raw_specs          jsonb not null default '{}'::jsonb,

  -- 'labelled' = came from a structured spec table/metafield (trustworthy)
  -- 'variant'  = derived from a Shopify variant option
  -- 'prose'    = regex over marketing copy (Franklin, CRBN thickness) — weakest
  -- The UI surfaces this so a prose-derived number is visibly less certain.
  source_confidence  text not null default 'labelled'
                     check (source_confidence in ('labelled','variant','prose')),

  first_seen_at      timestamptz not null default now(),
  scraped_at         timestamptz not null default now(),

  unique (brand_id, source_handle, variant_key)
);

create index if not exists idx_paddle_specs_brand_id    on paddle_specs(brand_id);
create index if not exists idx_paddle_specs_family_key  on paddle_specs(family_key);
create index if not exists idx_paddle_specs_scraped_at  on paddle_specs(scraped_at desc);
create index if not exists idx_paddle_specs_shape       on paddle_specs(shape) where shape is not null;
create index if not exists idx_paddle_specs_thickness   on paddle_specs(thickness_mm) where thickness_mm is not null;

comment on table  paddle_specs is
  'Manufacturer-published paddle specs crawled from brand sites. Grain: brand x source_handle x variant_key. See docs/PRODUCT_INTEL_REDESIGN.md';
comment on column paddle_specs.variant_key is
  'NOT NULL deterministic key (e.g. "elongated|16.0" or "default"). Exists because Postgres treats NULLs as distinct in unique constraints, which would break upsert idempotency for brands that omit shape or thickness.';
comment on column paddle_specs.usap_approved is
  'NULL means the brand does not state it — NOT that the paddle is uncertified. Only 4 of 7 brands publish this.';
comment on column paddle_specs.source_confidence is
  'How the values were obtained: labelled (structured field) > variant (Shopify option) > prose (regex over marketing copy).';

commit;

-- PostgREST caches the schema; without this the first scraper run fails with
-- PGRST204 "Could not find the 'x' column" even though the DDL landed.
notify pgrst, 'reload schema';
