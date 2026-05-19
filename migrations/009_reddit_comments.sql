-- ─── Reddit Comments (reply trees) ──────────────────────────────────────────
-- Adds depth to Reddit data. Currently only scraping OPs (top-level posts) —
-- but reply trees often contain the real buying intent, defection signals,
-- and crisis context.

create table if not exists reddit_comments (
  id              uuid primary key default gen_random_uuid(),
  parent_post_id  uuid references reddit_mentions(id) on delete cascade,
  reddit_comment_id text not null,
  brand_id        uuid references brands(id),
  subreddit       text,
  author          text,
  comment_text    text,
  upvotes         int default 0,
  depth           int default 0,
  posted_at       timestamptz,
  created_at      timestamptz default now(),

  -- Enrichment columns (same schema as reddit_mentions)
  sentiment_score        numeric,
  sentiment_label        text,
  topics                 jsonb,
  brands_mentioned       text[],
  players_mentioned      text[],
  products_mentioned     text[],
  is_crisis              bool default false,
  is_opportunity         bool default false,
  purchase_intent_score  numeric,
  competitor_switch_from text,
  competitor_switch_to   text,
  crisis_keywords        text[],
  enriched_at            timestamptz,

  unique (reddit_comment_id)
);

create index if not exists reddit_comments_parent_idx
  on reddit_comments (parent_post_id);
create index if not exists reddit_comments_brand_idx
  on reddit_comments (brand_id);
create index if not exists reddit_comments_enriched_idx
  on reddit_comments (enriched_at);
create index if not exists reddit_comments_crisis_idx
  on reddit_comments (is_crisis) where is_crisis;

-- ─── Upvote velocity columns on reddit_mentions ─────────────────────────────
-- Allows tracking which posts are gaining traction (going viral) between
-- scrape runs. velocity_per_hour computed on each scrape.

alter table reddit_mentions
  add column if not exists upvotes_last_scrape int,
  add column if not exists velocity_per_hour   numeric,
  add column if not exists awards              jsonb,
  add column if not exists is_removed          bool default false;
