-- Migration 021: Fix product_aliases schema + competitor_switch_events constraint
-- Apply in: Supabase Dashboard → SQL Editor

-- ─── 1. Recreate product_aliases with correct schema ─────────────────────────
-- The table exists but is missing the product_id column because CREATE TABLE
-- IF NOT EXISTS in migration 012 silently skipped when the table already existed
-- with a different schema. Drop and recreate; all data is regenerable from
-- products_catalog (which is the authoritative source).

DROP TABLE IF EXISTS product_aliases CASCADE;

CREATE TABLE product_aliases (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id   UUID NOT NULL REFERENCES products_catalog(id) ON DELETE CASCADE,
    brand_id     UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    alias        TEXT NOT NULL,
    alias_norm   TEXT NOT NULL,
    alias_type   TEXT DEFAULT 'catalog',
    confidence   NUMERIC(3,2) DEFAULT 1.0,
    is_ambiguous BOOLEAN DEFAULT FALSE,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (alias_norm, product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_aliases_norm    ON product_aliases (alias_norm);
CREATE INDEX IF NOT EXISTS idx_product_aliases_brand   ON product_aliases (brand_id);
CREATE INDEX IF NOT EXISTS idx_product_aliases_product ON product_aliases (product_id);

-- Seed from products_catalog.aliases array
INSERT INTO product_aliases (product_id, brand_id, alias, alias_norm, alias_type, confidence)
SELECT
    pc.id,
    pc.brand_id,
    a                                                                                 AS alias,
    regexp_replace(lower(unaccent(coalesce(a, ''))), '[^a-z0-9 ]+', ' ', 'g')        AS alias_norm,
    'catalog'                                                                         AS alias_type,
    1.0                                                                               AS confidence
FROM   products_catalog pc
CROSS JOIN LATERAL unnest(coalesce(pc.aliases, ARRAY[]::text[])) AS a
WHERE  a IS NOT NULL AND length(trim(a)) > 0
ON CONFLICT (alias_norm, product_id) DO NOTHING;

-- Seed display_name itself so "JOOLA Perseus" always matches
INSERT INTO product_aliases (product_id, brand_id, alias, alias_norm, alias_type, confidence)
SELECT
    pc.id,
    pc.brand_id,
    pc.display_name                                                                                    AS alias,
    regexp_replace(lower(unaccent(coalesce(pc.display_name, ''))), '[^a-z0-9 ]+', ' ', 'g')            AS alias_norm,
    'catalog'                                                                                          AS alias_type,
    1.0                                                                                                AS confidence
FROM   products_catalog pc
WHERE  pc.display_name IS NOT NULL AND length(trim(pc.display_name)) > 0
ON CONFLICT (alias_norm, product_id) DO NOTHING;

-- Mark ambiguous aliases (same alias_norm spans multiple brands, e.g. "Pro")
WITH amb AS (
    SELECT alias_norm
    FROM   product_aliases
    GROUP BY alias_norm
    HAVING COUNT(DISTINCT brand_id) > 1
)
UPDATE product_aliases pa
SET    is_ambiguous = TRUE
FROM   amb
WHERE  pa.alias_norm = amb.alias_norm;


-- ─── 2. competitor_switch_events unique index for mention_facts upsert ────────
-- mention_facts.py upserts with on_conflict='posted_at,from_brand_id,to_brand_id'
-- PostgREST requires a UNIQUE INDEX (or CONSTRAINT) covering exactly those columns.
-- Rows with NULL brand IDs are lookup failures (brand slug not in DB); skip them
-- by inserting a partial index but PostgREST can only target full indexes,
-- so we use a full unique index and let Python skip null-brand rows.

CREATE UNIQUE INDEX IF NOT EXISTS competitor_switch_time_brands_idx
    ON competitor_switch_events (posted_at, from_brand_id, to_brand_id);
