-- Migration 016: product_reviews
-- Captures actual customer review prose from brand product detail pages
-- (Bazaarvoice / Judge.me / Okendo / Yotpo / SPR widgets), so the existing
-- AI enricher can extract sentiment + topics + brand/player/product NER from
-- the review body just like it does for reddit_mentions / yt_comments /
-- tiktok_comments. Created 2026-05-25.
--
-- This unlocks paddle-level sentiment + topic enrichment that scrape_catalog
-- currently can't deliver (catalog only captures aggregate star rating +
-- review count — no prose).
--
-- Shape mirrors tiktok_comments (migration 014) so the ai_enricher TABLES
-- list and the mention_facts SOURCES list can ingest it with a single new
-- entry each. The product_id FK points at products_catalog (canonical SKU
-- table) — same target the mention_facts pipeline already uses.
--
-- Idempotent re-scrapes: source_review_id is the per-widget unique key
-- (Bazaarvoice review ID / Judge.me review ID / Okendo review ID / etc.)
-- so re-running the scraper UPSERTs in place without duplicating rows.

create table if not exists product_reviews (
  id                     uuid primary key default gen_random_uuid(),
  brand_id               uuid references brands(id),
  product_id             uuid references products_catalog(id),
  source_review_id       text not null,            -- per-widget unique id
  review_widget          text,                     -- 'bazaarvoice','judgeme','okendo','yotpo','spr'
  reviewer_name          text,
  review_title           text,
  review_text            text,
  rating                 numeric,                  -- 1-5 (or null if widget doesn't expose)
  helpful_count          int default 0,
  posted_at              timestamptz,
  scraped_at             timestamptz default now(),

  -- enrichment columns (populated by ai_enricher — mirror tiktok_comments)
  sentiment_score        numeric,
  sentiment_label        text,
  topics                 text[] default '{}',
  brands_mentioned       text[] default '{}',
  players_mentioned      text[] default '{}',
  products_mentioned     text[] default '{}',
  is_crisis              bool default false,
  is_opportunity         bool default false,
  purchase_intent_score  numeric default 0,
  crisis_keywords        text[] default '{}',
  enriched_at            timestamptz,

  unique (source_review_id)
);

create index if not exists idx_product_reviews_brand_id    on product_reviews(brand_id);
create index if not exists idx_product_reviews_product_id  on product_reviews(product_id);
create index if not exists idx_product_reviews_posted_at   on product_reviews(posted_at desc);
create index if not exists idx_product_reviews_enriched_at on product_reviews(enriched_at);
create index if not exists idx_product_reviews_is_crisis   on product_reviews(is_crisis) where is_crisis = true;
