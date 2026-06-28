-- Migration 019: Fix product prices stored in milli-dollars instead of USD
--
-- Root cause: _parse_price() in scrape_catalog.py removed commas from European-format
-- prices (e.g. "$280,20" → "28020" → 28020.0) instead of treating the comma as a
-- decimal separator. This resulted in prices being stored 100x–1000x too large.
--
-- Fix: divide price_usd and sale_price_usd by 1000 where the stored value > 1000,
-- since no pickleball paddle or accessory legitimately costs more than $1,000.

UPDATE products_catalog
SET
  price_usd      = ROUND(price_usd      / 1000.0, 2)
WHERE price_usd > 1000;

UPDATE products_catalog
SET
  sale_price_usd = ROUND(sale_price_usd / 1000.0, 2)
WHERE sale_price_usd > 1000;

-- Verify: after migration, no product should have a price above $1000
-- SELECT count(*) FROM products_catalog WHERE price_usd > 1000;  -- should be 0
