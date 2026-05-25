-- Migration 014: tiktok_comments
-- Mirrors ig_comments + yt_comments shape so the existing enrichment pipeline
-- (ai_enricher + mention_facts populator) can ingest TikTok comments without
-- code changes. Created 2026-05-24.

create table if not exists tiktok_comments (
  id                     uuid primary key default gen_random_uuid(),
  tiktok_comment_id      text unique,
  video_id               uuid references tiktok_videos(id) on delete cascade,
  brand_id               uuid references brands(id),
  commenter_username     text,
  comment_text           text,
  comment_likes          int default 0,
  reply_to_comment_id    text,
  posted_at              timestamptz,
  scraped_at             timestamptz default now(),

  -- enrichment columns (populated by ai_enricher)
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
  enriched_at            timestamptz
);

create index if not exists idx_tiktok_comments_video_id    on tiktok_comments(video_id);
create index if not exists idx_tiktok_comments_brand_id    on tiktok_comments(brand_id);
create index if not exists idx_tiktok_comments_posted_at   on tiktok_comments(posted_at desc);
create index if not exists idx_tiktok_comments_enriched_at on tiktok_comments(enriched_at);
create index if not exists idx_tiktok_comments_is_crisis   on tiktok_comments(is_crisis) where is_crisis = true;
