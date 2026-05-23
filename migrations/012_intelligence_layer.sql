-- ============================================================
-- Migration 012: YouTube Transcript Intelligence + Product Mention Layer
-- Adds 7 new tables; no existing tables modified except a safety UPDATE
-- on yt_videos.is_short for any pre-Migration-011 rows.
--
-- Run in: Supabase SQL Editor after 011_enrichment_extensions.sql
-- ============================================================

-- Required for diacritic-stripping in the alias seed.
-- If your Supabase project's plan blocks unaccent, run the alternate
-- block at the bottom of this file (see "ALIAS SEED — UNACCENT-FREE").
CREATE EXTENSION IF NOT EXISTS unaccent;


-- ─── 0. Drop any pre-existing skeleton table ────────────────
-- A partial run of an earlier ad-hoc CREATE TABLE may have left
-- yt_video_analysis sitting in the DB with only id + video_id columns.
-- CREATE TABLE IF NOT EXISTS would be a no-op against that skeleton,
-- and the subsequent CREATE INDEX on brand_id would fail with
-- "column 'brand_id' does not exist" — rolling the entire migration back.
-- This DROP is safe: the skeleton table has zero rows and no FK pointers
-- into it (only out of it). Re-creation happens below.
DROP TABLE IF EXISTS yt_video_analysis CASCADE;


-- ─── 1. yt_video_transcripts ────────────────────────────────
-- Raw YouTube captions per video. Missing transcripts are NOT errors —
-- they're written with fetch_status='no_transcript' so the pipeline never breaks.
CREATE TABLE IF NOT EXISTS yt_video_transcripts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id          UUID NOT NULL REFERENCES yt_videos(id) ON DELETE CASCADE,
    youtube_video_id  TEXT NOT NULL,                 -- denormalised for cheap joins
    brand_id          UUID REFERENCES brands(id) ON DELETE SET NULL,
    language          TEXT,                          -- 'en', 'en-US', 'auto', ...
    is_auto_generated BOOLEAN DEFAULT FALSE,
    transcript_text   TEXT,                          -- concatenated text, no timestamps
    segments          JSONB,                         -- [{start,dur,text}, ...] when available
    word_count        INTEGER,
    char_count        INTEGER,
    source_actor      TEXT,                          -- which Apify actor produced this row
    fetch_status      TEXT NOT NULL DEFAULT 'ok',    -- 'ok'|'no_transcript'|'private'|'rate_limited'|'error'
    fetch_error       TEXT,
    fetched_at        TIMESTAMPTZ DEFAULT NOW(),
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (youtube_video_id)
);

CREATE INDEX IF NOT EXISTS idx_yt_transcripts_video  ON yt_video_transcripts(video_id);
CREATE INDEX IF NOT EXISTS idx_yt_transcripts_brand  ON yt_video_transcripts(brand_id);
CREATE INDEX IF NOT EXISTS idx_yt_transcripts_status ON yt_video_transcripts(fetch_status);

COMMENT ON TABLE  yt_video_transcripts             IS 'Raw YouTube captions per video — null when transcript unavailable, with fetch_status preserving the failure reason';
COMMENT ON COLUMN yt_video_transcripts.fetch_status IS 'ok | no_transcript | private | rate_limited | error — missing transcript MUST NOT break pipeline';
COMMENT ON COLUMN yt_video_transcripts.segments    IS 'Optional JSONB array of timestamped lines, kept for future chapter detection';


-- ─── 2. yt_video_analysis ───────────────────────────────────
-- One AI analysis per video; explains WHY it performed + extracts product mentions
CREATE TABLE IF NOT EXISTS yt_video_analysis (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id                  UUID NOT NULL REFERENCES yt_videos(id) ON DELETE CASCADE,
    youtube_video_id          TEXT NOT NULL,
    brand_id                  UUID REFERENCES brands(id) ON DELETE SET NULL,
    transcript_id             UUID REFERENCES yt_video_transcripts(id) ON DELETE SET NULL,

    summary                   TEXT,                  -- 1-2 sentence GPT summary
    performance_thesis        TEXT,                  -- why the video performed
    performance_signals       TEXT[],                -- ['hook-strong','celebrity-cameo','tutorial',...]

    content_type              TEXT,                  -- 'review'|'tutorial'|'highlight'|'unboxing'|'announcement'|'news'|'other'
    is_paid_promo             BOOLEAN DEFAULT FALSE,
    sentiment_label           TEXT,
    sentiment_score           NUMERIC(4,3),

    products_mentioned        TEXT[],                -- canonical product display names
    products_matched_ids      UUID[],                -- resolved products_catalog.id list
    brands_mentioned          TEXT[],                -- brand slugs
    players_mentioned         TEXT[],                -- athlete full names
    topics                    TEXT[],

    is_crisis                 BOOLEAN DEFAULT FALSE,
    is_opportunity            BOOLEAN DEFAULT FALSE,
    crisis_keywords           TEXT[],

    -- Engagement snapshot at analysis time (lets us detect drift later)
    view_count_at_analysis    BIGINT,
    like_count_at_analysis    INTEGER,
    comment_count_at_analysis INTEGER,

    model                     TEXT,                  -- e.g. 'gpt-4o-mini'
    enriched_at               TIMESTAMPTZ DEFAULT NOW(),
    created_at                TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (video_id)
);

CREATE INDEX IF NOT EXISTS idx_yt_analysis_brand    ON yt_video_analysis(brand_id);
CREATE INDEX IF NOT EXISTS idx_yt_analysis_content  ON yt_video_analysis(content_type);
CREATE INDEX IF NOT EXISTS idx_yt_analysis_crisis   ON yt_video_analysis(is_crisis) WHERE is_crisis;
CREATE INDEX IF NOT EXISTS idx_yt_analysis_products ON yt_video_analysis USING GIN (products_matched_ids);

COMMENT ON TABLE yt_video_analysis IS 'One AI analysis per yt_video; explains why a video performed and extracts product/brand/athlete mentions';


-- ─── 3. product_aliases ─────────────────────────────────────
-- Synonym table. Many aliases → one products_catalog.id. Matcher loads this once.
CREATE TABLE IF NOT EXISTS product_aliases (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id   UUID NOT NULL REFERENCES products_catalog(id) ON DELETE CASCADE,
    brand_id     UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    alias        TEXT NOT NULL,                       -- raw text (case preserved)
    alias_norm   TEXT NOT NULL,                       -- normalized matcher key
    alias_type   TEXT DEFAULT 'catalog',              -- 'catalog'|'manual'|'pattern'|'learned'
    confidence   NUMERIC(3,2) DEFAULT 1.0,
    is_ambiguous BOOLEAN DEFAULT FALSE,               -- TRUE when alias_norm spans multiple brands
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (alias_norm, product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_aliases_norm    ON product_aliases(alias_norm);
CREATE INDEX IF NOT EXISTS idx_product_aliases_brand   ON product_aliases(brand_id);
CREATE INDEX IF NOT EXISTS idx_product_aliases_product ON product_aliases(product_id);

COMMENT ON TABLE  product_aliases             IS 'Alias dictionary — every recognized product name variant points to exactly one product_id within a brand';
COMMENT ON COLUMN product_aliases.alias_norm  IS 'Normalized form used by matcher (lowercase, ASCII, no punctuation, collapsed whitespace)';
COMMENT ON COLUMN product_aliases.is_ambiguous IS 'TRUE when the same alias_norm appears for multiple brands (e.g. "Pro") — matcher must require brand context';

-- Seed from products_catalog.aliases — display_name + every alias becomes a row
INSERT INTO product_aliases (product_id, brand_id, alias, alias_norm, alias_type, confidence)
SELECT
    pc.id,
    pc.brand_id,
    a                                                                                AS alias,
    regexp_replace(lower(unaccent(coalesce(a, ''))), '[^a-z0-9 ]+', ' ', 'g')        AS alias_norm,
    'catalog'                                                                        AS alias_type,
    1.0                                                                              AS confidence
FROM   products_catalog pc
CROSS JOIN LATERAL unnest(coalesce(pc.aliases, ARRAY[]::text[])) AS a
WHERE  a IS NOT NULL AND length(trim(a)) > 0
ON CONFLICT (alias_norm, product_id) DO NOTHING;

-- Also seed display_name itself so "JOOLA Perseus" matches even if not in aliases[]
INSERT INTO product_aliases (product_id, brand_id, alias, alias_norm, alias_type, confidence)
SELECT
    pc.id,
    pc.brand_id,
    pc.display_name                                                                                  AS alias,
    regexp_replace(lower(unaccent(coalesce(pc.display_name, ''))), '[^a-z0-9 ]+', ' ', 'g')          AS alias_norm,
    'catalog'                                                                                        AS alias_type,
    1.0                                                                                              AS confidence
FROM   products_catalog pc
WHERE  pc.display_name IS NOT NULL AND length(trim(pc.display_name)) > 0
ON CONFLICT (alias_norm, product_id) DO NOTHING;

-- Mark ambiguous aliases (same alias_norm → multiple brands)
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


-- ─── 4. product_mentions ────────────────────────────────────
-- Unified mention store across all channels. One row per (source_row × matched product).
CREATE TABLE IF NOT EXISTS product_mentions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id         UUID NOT NULL REFERENCES products_catalog(id) ON DELETE CASCADE,
    brand_id           UUID REFERENCES brands(id) ON DELETE SET NULL,

    source_table       TEXT NOT NULL,
    source_row_id      UUID NOT NULL,
    channel            TEXT NOT NULL,            -- 'instagram'|'youtube'|'reddit'|'tiktok'|'twitter'|'influencer'|'ads'|'promotions'|'news'

    matched_alias      TEXT,
    matched_alias_norm TEXT,
    match_confidence   NUMERIC(3,2) DEFAULT 1.0,
    is_jl_brand        BOOLEAN GENERATED ALWAYS AS (brand_id = '04db8591-37a3-4634-9d11-536975fa6935'::uuid) STORED,

    -- Denormalized signal columns (so attention rollups don't re-join)
    sentiment_label    TEXT,
    sentiment_score    NUMERIC(4,3),
    is_purchase_intent BOOLEAN DEFAULT FALSE,
    is_crisis          BOOLEAN DEFAULT FALSE,
    engagement_score   NUMERIC(12,2),            -- channel weight × engagement metric
    raw_engagement     JSONB,                    -- {likes,views,upvotes,...} preserved for audit

    occurred_at        TIMESTAMPTZ,
    -- TIMESTAMPTZ → DATE uses session timezone, which isn't immutable. Pin to UTC.
    occurred_date      DATE GENERATED ALWAYS AS ((occurred_at AT TIME ZONE 'UTC')::date) STORED,

    created_at         TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (source_table, source_row_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_mentions_product_date ON product_mentions(product_id, occurred_date DESC);
CREATE INDEX IF NOT EXISTS idx_product_mentions_brand_date   ON product_mentions(brand_id, occurred_date DESC);
CREATE INDEX IF NOT EXISTS idx_product_mentions_channel      ON product_mentions(channel);
CREATE INDEX IF NOT EXISTS idx_product_mentions_purchase     ON product_mentions(is_purchase_intent) WHERE is_purchase_intent;
CREATE INDEX IF NOT EXISTS idx_product_mentions_crisis       ON product_mentions(is_crisis) WHERE is_crisis;
CREATE INDEX IF NOT EXISTS idx_product_mentions_jl           ON product_mentions(is_jl_brand);

COMMENT ON TABLE  product_mentions                  IS 'Unified per-channel product mention store. One row per (source_row,product). Daily rollups read from here.';
COMMENT ON COLUMN product_mentions.engagement_score IS 'channel-weighted engagement attached to this mention; the input to attention scoring';


-- ─── 5. product_attention_daily ─────────────────────────────
-- Daily rollup per (product, date) with weighted attention score
CREATE TABLE IF NOT EXISTS product_attention_daily (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id              UUID NOT NULL REFERENCES products_catalog(id) ON DELETE CASCADE,
    brand_id                UUID REFERENCES brands(id) ON DELETE SET NULL,
    attention_date          DATE NOT NULL,

    mentions_total          INTEGER DEFAULT 0,
    mentions_instagram      INTEGER DEFAULT 0,
    mentions_youtube        INTEGER DEFAULT 0,
    mentions_reddit         INTEGER DEFAULT 0,
    mentions_tiktok         INTEGER DEFAULT 0,
    mentions_twitter        INTEGER DEFAULT 0,
    mentions_influencer     INTEGER DEFAULT 0,
    mentions_ads            INTEGER DEFAULT 0,
    mentions_promotions     INTEGER DEFAULT 0,
    mentions_news           INTEGER DEFAULT 0,

    attention_score         NUMERIC(14,2) DEFAULT 0,
    positive_mentions       INTEGER DEFAULT 0,
    neutral_mentions        INTEGER DEFAULT 0,
    negative_mentions       INTEGER DEFAULT 0,
    purchase_intent_count   INTEGER DEFAULT 0,
    crisis_mentions         INTEGER DEFAULT 0,

    sales_likelihood_score  NUMERIC(6,3) DEFAULT 0,    -- 0..100 — NOT confirmed sales
    sales_likelihood_inputs JSONB,                     -- {purchase_intent_count, ...} for audit

    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (product_id, attention_date)
);

CREATE INDEX IF NOT EXISTS idx_product_attention_date  ON product_attention_daily(attention_date DESC);
CREATE INDEX IF NOT EXISTS idx_product_attention_brand ON product_attention_daily(brand_id, attention_date DESC);
CREATE INDEX IF NOT EXISTS idx_product_attention_score ON product_attention_daily(attention_score DESC);

COMMENT ON TABLE  product_attention_daily                       IS 'Daily roll-up of product mentions, weighted attention score, and sales-likelihood signal (NOT a sales table)';
COMMENT ON COLUMN product_attention_daily.sales_likelihood_score IS '0-100 modelled likelihood of generating sales — kept separate from sales_facts_daily (which holds estimated_units_sold)';


-- ─── 6. product_attention_summary ───────────────────────────
-- Period buckets (last_7d / last_30d / last_90d / all_time) for dashboard
CREATE TABLE IF NOT EXISTS product_attention_summary (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id              UUID NOT NULL REFERENCES products_catalog(id) ON DELETE CASCADE,
    brand_id                UUID REFERENCES brands(id) ON DELETE SET NULL,
    period                  TEXT NOT NULL,           -- 'last_7d'|'last_30d'|'last_90d'|'all_time'
    period_start            DATE,
    period_end              DATE NOT NULL,

    mentions_total          INTEGER DEFAULT 0,
    attention_score         NUMERIC(14,2) DEFAULT 0,
    positive_mentions       INTEGER DEFAULT 0,
    negative_mentions       INTEGER DEFAULT 0,
    purchase_intent_count   INTEGER DEFAULT 0,
    crisis_mentions         INTEGER DEFAULT 0,
    sales_likelihood_score  NUMERIC(6,3) DEFAULT 0,

    rank_in_brand           INTEGER,                  -- within brand: 1 = top
    rank_overall            INTEGER,                  -- across all brands: 1 = top
    joola_vs_competitor_gap NUMERIC(14,2),            -- top JOOLA score - this score; null for JOOLA rows

    computed_at             TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (product_id, period)
);

CREATE INDEX IF NOT EXISTS idx_product_attention_summary_period ON product_attention_summary(period, attention_score DESC);
CREATE INDEX IF NOT EXISTS idx_product_attention_summary_brand  ON product_attention_summary(brand_id, period);

COMMENT ON TABLE product_attention_summary IS 'Period-bucket roll-ups for dashboard cards. Recomputed each pipeline run; supports JOOLA-vs-competitor delta.';


-- ─── 7. product_attention_sales_correlation (DEFERRED) ──────
-- Schema declared so future code can target it. Population not in this ship.
CREATE TABLE IF NOT EXISTS product_attention_sales_correlation (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id               UUID NOT NULL REFERENCES products_catalog(id) ON DELETE CASCADE,
    brand_id                 UUID REFERENCES brands(id) ON DELETE SET NULL,
    window_start             DATE NOT NULL,
    window_end               DATE NOT NULL,
    attention_score_sum      NUMERIC(14,2),
    estimated_units_sold_sum NUMERIC(12,2),
    correlation_coefficient  NUMERIC(5,4),            -- pearson r over daily series
    lag_days                 INTEGER,                  -- best-fit lag attention→sales
    confidence_score         NUMERIC(3,2),
    computed_at              TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (product_id, window_start, window_end)
);

CREATE INDEX IF NOT EXISTS idx_product_sales_corr_product ON product_attention_sales_correlation(product_id);

COMMENT ON TABLE product_attention_sales_correlation IS 'DEFERRED — schema only. Population logic lands later once sales_facts_daily has 60+ days of data.';


-- ─── 8. One-time safety backfill for is_short ───────────────
-- Belt-and-braces fix for any rows that pre-date Migration 011's scraper change.
UPDATE yt_videos
SET    is_short = TRUE
WHERE  is_short = FALSE
  AND  ((duration_seconds IS NOT NULL AND duration_seconds <= 60)
        OR video_url ILIKE '%/shorts/%');


-- ============================================================
-- ALIAS SEED — UNACCENT-FREE FALLBACK
-- If `CREATE EXTENSION IF NOT EXISTS unaccent;` failed (Supabase plan
-- restrictions), run the following INSTEAD of the two INSERT blocks above.
-- Comment out the original blocks and uncomment this one:
-- ============================================================
-- INSERT INTO product_aliases (product_id, brand_id, alias, alias_norm, alias_type, confidence)
-- SELECT
--     pc.id, pc.brand_id, a,
--     regexp_replace(lower(coalesce(a, '')), '[^a-z0-9 ]+', ' ', 'g'),
--     'catalog', 1.0
-- FROM   products_catalog pc
-- CROSS  JOIN LATERAL unnest(coalesce(pc.aliases, ARRAY[]::text[])) AS a
-- WHERE  a IS NOT NULL AND length(trim(a)) > 0
-- ON CONFLICT (alias_norm, product_id) DO NOTHING;
--
-- INSERT INTO product_aliases (product_id, brand_id, alias, alias_norm, alias_type, confidence)
-- SELECT
--     pc.id, pc.brand_id, pc.display_name,
--     regexp_replace(lower(coalesce(pc.display_name, '')), '[^a-z0-9 ]+', ' ', 'g'),
--     'catalog', 1.0
-- FROM   products_catalog pc
-- WHERE  pc.display_name IS NOT NULL AND length(trim(pc.display_name)) > 0
-- ON CONFLICT (alias_norm, product_id) DO NOTHING;
