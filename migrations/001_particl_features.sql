-- ============================================================
-- JOOLA Intel — Particl-style feature migration
-- Run this in Supabase SQL Editor BEFORE running apify_to_supabase.py
-- ============================================================

-- 1. Product price/inventory snapshots — captured each scrape run
CREATE TABLE IF NOT EXISTS product_price_history (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  brand_id        UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  captured_at     TIMESTAMPTZ DEFAULT now(),
  price_usd       NUMERIC(10,2),
  sale_price_usd  NUMERIC(10,2),
  discount_pct    NUMERIC(5,2),
  in_stock        BOOLEAN,
  stock_count     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pph_product ON product_price_history(product_id);
CREATE INDEX IF NOT EXISTS idx_pph_brand ON product_price_history(brand_id);
CREATE INDEX IF NOT EXISTS idx_pph_captured ON product_price_history(captured_at DESC);

-- 2. Promotions detected from brand homepage banners
CREATE TABLE IF NOT EXISTS promotions (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id      UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  banner_text   TEXT NOT NULL,
  promo_type    TEXT,            -- 'sitewide', 'category', 'product', 'flash', 'seasonal'
  discount_pct  NUMERIC(5,2),
  source_url    TEXT,
  detected_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promotions_brand ON promotions(brand_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_promotions_brand_text ON promotions(brand_id, banner_text);

-- 3. Marketing ads — Meta Ad Library + Google Ads Transparency
CREATE TABLE IF NOT EXISTS marketing_ads (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id      UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,   -- 'meta' or 'google'
  ad_id         TEXT,
  page_name     TEXT,
  body          TEXT,
  cta           TEXT,
  creative_url  TEXT,            -- image/video URL
  landing_url   TEXT,
  started_at    TIMESTAMPTZ,
  is_active     BOOLEAN DEFAULT true,
  raw           JSONB,
  captured_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ads_brand ON marketing_ads(brand_id);
CREATE INDEX IF NOT EXISTS idx_ads_platform ON marketing_ads(platform);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ads_platform_ad ON marketing_ads(platform, ad_id);

-- 4. Add columns to existing products table
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sale_price_usd NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS discount_pct   NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS stock_count    INTEGER,
  ADD COLUMN IF NOT EXISTS discontinued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_category    TEXT;

-- 5. ig_comments / yt_comments already exist in main schema — no change needed
