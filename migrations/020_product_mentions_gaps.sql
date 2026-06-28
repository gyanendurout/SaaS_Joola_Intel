-- Migration 020: Fix product_mentions column gaps
-- Addresses channels silently skipping in populate_product_mentions.py
-- Apply in: Supabase Dashboard → SQL Editor

-- ─── 1. ig_posts ─────────────────────────────────────────────────────────────
-- Migration 006 added enrichment columns to ig_comments but missed ig_posts.
-- The enricher + product_mentions module both need these to process ig post text.
alter table ig_posts
  add column if not exists sentiment_score         numeric,
  add column if not exists sentiment_label         text,
  add column if not exists topics                  jsonb,
  add column if not exists brands_mentioned        text[],
  add column if not exists players_mentioned       text[],
  add column if not exists products_mentioned      text[],
  add column if not exists is_crisis               bool default false,
  add column if not exists is_opportunity          bool default false,
  add column if not exists purchase_intent_score   numeric,
  add column if not exists crisis_keywords         text[],
  add column if not exists enriched_at             timestamptz;

create index if not exists ig_posts_enriched_at_idx on ig_posts (enriched_at);
create index if not exists ig_posts_is_crisis_idx   on ig_posts (is_crisis) where is_crisis;

-- ─── 2. yt_comments ──────────────────────────────────────────────────────────
-- Pre-existing table created before tracked migrations. Missing like_count.
-- product_mentions computes engagement as (like_count or 0) + 1 per comment.
alter table yt_comments
  add column if not exists like_count int default 0;

-- ─── 3. competitor_switch_events ─────────────────────────────────────────────
-- Migration 007 created the table with (mention_id, from_brand_id, to_brand_id,
-- confidence, text_snippet, posted_at). The Python module writes different fields:
-- channel, source_mention_id, detected_at, post_url.
-- Adding the missing columns so upsert on source_mention_id works.
alter table competitor_switch_events
  add column if not exists channel           text,
  add column if not exists source_mention_id uuid,
  add column if not exists detected_at       timestamptz,
  add column if not exists post_url          text;

-- Backfill detected_at from posted_at for existing rows
update competitor_switch_events
  set detected_at = posted_at
  where detected_at is null and posted_at is not null;

-- Remove any rows with null source_mention_id before adding unique constraint
-- (rows written under the old schema had no source_mention_id)
delete from competitor_switch_events
  where source_mention_id is null;

-- Unique index enables idempotent upsert on source_mention_id
create unique index if not exists competitor_switch_source_idx
  on competitor_switch_events (source_mention_id);
