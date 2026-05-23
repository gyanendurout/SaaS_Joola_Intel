-- ============================================================
-- Migration 010: Sales Intelligence Engine
-- Particl-style inventory signal tracking
-- Creates 6 new tables; no existing tables modified.
-- Run in: Supabase SQL Editor
-- ============================================================

-- 1. Product variants (SKU-level granularity)
CREATE TABLE IF NOT EXISTS product_variants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id            UUID REFERENCES brands(id) ON DELETE CASCADE,
    product_id          UUID REFERENCES products_catalog(id) ON DELETE SET NULL,
    external_variant_id TEXT,
    sku                 TEXT,
    upc                 TEXT,
    variant_title       TEXT,
    color               TEXT,
    size                TEXT,
    thickness           TEXT,
    weight              TEXT,
    price               NUMERIC(10, 2),
    compare_at_price    NUMERIC(10, 2),
    currency            TEXT DEFAULT 'USD',
    availability_status TEXT DEFAULT 'unknown',  -- 'in_stock' | 'out_of_stock' | 'limited' | 'unknown'
    first_seen_at       TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at        TIMESTAMPTZ DEFAULT NOW(),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (brand_id, external_variant_id)
);

CREATE INDEX IF NOT EXISTS idx_product_variants_brand ON product_variants(brand_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_status ON product_variants(availability_status);

-- 2. Product snapshots (point-in-time inventory readings)
CREATE TABLE IF NOT EXISTS product_snapshots (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id                UUID REFERENCES brands(id) ON DELETE CASCADE,
    product_id              UUID REFERENCES products_catalog(id) ON DELETE SET NULL,
    variant_id              UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    snapshot_time           TIMESTAMPTZ DEFAULT NOW(),
    product_url             TEXT NOT NULL,
    price                   NUMERIC(10, 2),
    compare_at_price        NUMERIC(10, 2),
    currency                TEXT DEFAULT 'USD',
    discount_percent        NUMERIC(5, 2),
    availability_status     TEXT,
    visible_inventory_qty   INTEGER,      -- qty shown on page if any
    estimated_inventory_qty INTEGER,      -- inferred qty
    inventory_confidence    TEXT DEFAULT 'low',  -- 'high' | 'medium' | 'low'
    inventory_signal_type   TEXT,         -- 'json_ld' | 'shopify_json' | 'cart_signal' | 'html_text'
    stock_message           TEXT,         -- raw "Only 3 left" text
    raw_payload             JSONB,        -- full extracted JSON for reprocessing
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_brand_time ON product_snapshots(brand_id, snapshot_time DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_variant ON product_snapshots(variant_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_product ON product_snapshots(product_id);

-- 3. Inventory events (delta stream)
CREATE TABLE IF NOT EXISTS inventory_events (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id         UUID REFERENCES brands(id) ON DELETE CASCADE,
    product_id       UUID REFERENCES products_catalog(id) ON DELETE SET NULL,
    variant_id       UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    event_time       TIMESTAMPTZ DEFAULT NOW(),
    event_type       TEXT NOT NULL,  -- 'sale' | 'restock' | 'adjustment' | 'sellout' | 'reappearance'
    previous_qty     INTEGER,
    current_qty      INTEGER,
    delta_qty        INTEGER,        -- positive = restock, negative = sales
    confidence_score NUMERIC(3, 2) DEFAULT 0.5,
    reason_code      TEXT,           -- 'inventory_drop' | 'zero_stock_detected' | 'qty_increase'
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_events_brand ON inventory_events(brand_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_events_type ON inventory_events(event_type);

-- 4. Sales estimates (computed from inventory deltas)
CREATE TABLE IF NOT EXISTS sales_estimates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id            UUID REFERENCES brands(id) ON DELETE CASCADE,
    product_id          UUID REFERENCES products_catalog(id) ON DELETE SET NULL,
    variant_id          UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    estimate_date       DATE NOT NULL,
    estimated_units_sold NUMERIC(10, 2),
    estimated_revenue   NUMERIC(14, 2),
    currency            TEXT DEFAULT 'USD',
    price_used          NUMERIC(10, 2),
    confidence_score    NUMERIC(3, 2) DEFAULT 0.5,
    inventory_start     INTEGER,
    inventory_end       INTEGER,
    restock_qty         INTEGER DEFAULT 0,
    adjustment_qty      INTEGER DEFAULT 0,
    estimation_method   TEXT,   -- 'inventory_delta' | 'velocity_model' | 'hybrid'
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (brand_id, variant_id, estimate_date)
);

CREATE INDEX IF NOT EXISTS idx_sales_estimates_brand_date ON sales_estimates(brand_id, estimate_date DESC);

-- 5. Promotion sales impact (correlate promos → sales lift)
CREATE TABLE IF NOT EXISTS promotion_sales_impact (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id                UUID REFERENCES brands(id) ON DELETE CASCADE,
    promotion_id            UUID REFERENCES promotions(id) ON DELETE SET NULL,
    product_id              UUID REFERENCES products_catalog(id) ON DELETE SET NULL,
    variant_id              UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    campaign_start          DATE,
    campaign_end            DATE,
    baseline_sales_velocity NUMERIC(10, 4),  -- units/day before promo
    promo_sales_velocity    NUMERIC(10, 4),  -- units/day during promo
    estimated_lift_percent  NUMERIC(8, 2),
    estimated_lift_units    NUMERIC(10, 2),
    estimated_lift_revenue  NUMERIC(14, 2),
    confidence_score        NUMERIC(3, 2) DEFAULT 0.3,
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promo_impact_brand ON promotion_sales_impact(brand_id);

-- 6. Sales facts daily (denormalised daily roll-up for the dashboard)
CREATE TABLE IF NOT EXISTS sales_facts_daily (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id         UUID REFERENCES brands(id) ON DELETE CASCADE,
    date             DATE NOT NULL,
    category         TEXT,               -- 'control' | 'power' | 'composite'
    product_id       UUID REFERENCES products_catalog(id) ON DELETE SET NULL,
    variant_id       UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    estimated_units_sold  NUMERIC(10, 2),
    estimated_revenue     NUMERIC(14, 2),
    avg_price             NUMERIC(10, 2),
    discount_percent      NUMERIC(5, 2),
    stockout_flag         BOOLEAN DEFAULT FALSE,
    restock_flag          BOOLEAN DEFAULT FALSE,
    promotion_flag        BOOLEAN DEFAULT FALSE,
    confidence_score      NUMERIC(3, 2) DEFAULT 0.5,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (brand_id, date, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_facts_brand_date ON sales_facts_daily(brand_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_facts_date ON sales_facts_daily(date DESC);

COMMENT ON TABLE product_variants IS 'SKU-level product granularity for sales intelligence tracking';
COMMENT ON TABLE product_snapshots IS 'Point-in-time inventory readings from brand product pages';
COMMENT ON TABLE inventory_events IS 'Inventory change event stream (sales, restocks, adjustments)';
COMMENT ON TABLE sales_estimates IS 'Estimated units sold computed from inventory delta method';
COMMENT ON TABLE promotion_sales_impact IS 'Correlation between promotions and sales velocity changes';
COMMENT ON TABLE sales_facts_daily IS 'Denormalised daily sales roll-up for dashboard queries';
