-- Migration 022: Schema gap repair — applies the DDL from 018 and 020 that
-- never landed on the live database.
--
-- WHY THIS EXISTS
-- On 2026-08-14 a full pipeline run failed to write ig_comments at all:
--   PGRST204 "Could not find the 'post_url' column of 'ig_comments'"
-- A column probe against the live DB found that migrations 018 and 020 were
-- never applied, while 018_product_images, 019 and 021 were. So the DB is at
-- "017 + 018_product_images + 019 + 021" — not at 021 as the filenames imply.
--
-- Verified MISSING on the live DB (2026-08-14):
--   ig_comments.post_url, mention_facts.engagement, mention_facts.link_url
-- Verified PRESENT (so 019/021 are applied; do not re-run them):
--   products_catalog.image_url, topic_lifecycle.brand_id,
--   product_aliases.product_id / .alias_norm / .is_ambiguous
--
-- WHAT WAS DELIBERATELY OMITTED FROM 020
-- Migration 020 ends with:
--     delete from competitor_switch_events where source_mention_id is null;
-- Because source_mention_id is added by that same migration, it is NULL for
-- every pre-existing row — so that statement would delete the entire table.
-- competitor_switch_events held 80 rows of real defection data at the time of
-- writing (a BRD §7 headline KPI). The DELETE is NOT reproduced here.
--
-- The unique index below still works with those 80 NULL rows in place:
-- Postgres treats NULLs as distinct in a unique index. The consequence is that
-- legacy NULL-keyed rows will not dedupe against each other — acceptable, and
-- reversible, unlike deleting them. Decide separately whether to backfill
-- source_mention_id for those 80 rows or archive them.
--
-- Everything below is additive and safe to re-run.

-- ─── from 018: ig_comments parent post URL ───────────────────────────────────
alter table ig_comments
  add column if not exists post_url text;

-- ─── from 018: mention_facts engagement + source link ────────────────────────
alter table mention_facts
  add column if not exists engagement bigint not null default 0,
  add column if not exists link_url   text;

-- ─── from 020: ig_posts enrichment columns (006 added these to ig_comments
--     but missed ig_posts; the enricher and product_mentions both need them) ──
alter table ig_posts
  add column if not exists sentiment_score       numeric,
  add column if not exists sentiment_label       text,
  add column if not exists topics                jsonb,
  add column if not exists brands_mentioned      text[],
  add column if not exists players_mentioned     text[],
  add column if not exists products_mentioned    text[],
  add column if not exists is_crisis             bool default false,
  add column if not exists is_opportunity        bool default false,
  add column if not exists purchase_intent_score numeric,
  add column if not exists crisis_keywords       text[],
  add column if not exists enriched_at           timestamptz;

create index if not exists ig_posts_enriched_at_idx on ig_posts (enriched_at);
create index if not exists ig_posts_is_crisis_idx   on ig_posts (is_crisis) where is_crisis;

-- ─── from 020: yt_comments like_count (product_mentions computes engagement
--     as (like_count or 0) + 1 per comment) ─────────────────────────────────
alter table yt_comments
  add column if not exists like_count int default 0;

-- ─── from 020: competitor_switch_events columns the Python module writes ─────
alter table competitor_switch_events
  add column if not exists channel           text,
  add column if not exists source_mention_id uuid,
  add column if not exists detected_at       timestamptz,
  add column if not exists post_url          text;

update competitor_switch_events
  set detected_at = posted_at
  where detected_at is null and posted_at is not null;

-- NOTE: 020's "delete from competitor_switch_events where source_mention_id
-- is null" is intentionally omitted — see the header. Do not add it back
-- without first backfilling source_mention_id.

create unique index if not exists competitor_switch_source_idx
  on competitor_switch_events (source_mention_id);

-- NOT INCLUDED: product_mentions.post_url. A probe showed the column absent,
-- but no migration adds it and populate_product_mentions.py never writes it
-- (it upserts on source_table,source_row_id,product_id). Nothing is broken by
-- its absence — do not add it speculatively.

-- After applying, refresh the PostgREST schema cache so the API sees the new
-- columns without waiting for its periodic reload:
notify pgrst, 'reload schema';
