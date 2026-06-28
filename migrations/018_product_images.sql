-- Migration 018: add image_url to products + products_catalog
--
-- BACKGROUND: New Particl-style sections on /v2/sales-intel (Sections P-T)
-- need a hero image per product for the Best Sellers grid. Neither
-- products nor products_catalog currently carries an image URL.
--
-- This adds nullable image_url TEXT to both tables. The backfill script
-- (scripts/pipeline/backfill_product_images.py) extracts og:image /
-- JSON-LD image / Shopify featured_image from each product's URL and
-- writes it back. The UI falls back to a brand-color placeholder when
-- image_url IS NULL so partial coverage is safe to ship.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS guards re-runs.

begin;

alter table products            add column if not exists image_url text;
alter table products_catalog    add column if not exists image_url text;

comment on column products.image_url
  is 'Hero image scraped from product page (og:image / JSON-LD / Shopify featured_image). Nullable.';
comment on column products_catalog.image_url
  is 'Canonical display image for the catalog entry. Populated by backfill_product_images.py via name match against products.url. Nullable.';

commit;
