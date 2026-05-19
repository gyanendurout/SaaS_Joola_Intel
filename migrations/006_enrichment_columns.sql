-- ─── AI Enrichment Columns ───────────────────────────────────────────────────
-- Adds standard enrichment columns to every text-bearing channel table.
-- The enrich_with_ai.py worker populates these by selecting rows
-- WHERE enriched_at IS NULL and processing through GPT-4o-mini.

-- ─── reddit_mentions ─────────────────────────────────────────────────────────
alter table reddit_mentions
  add column if not exists sentiment_score         numeric,
  add column if not exists sentiment_label         text,
  add column if not exists topics                  jsonb,
  add column if not exists brands_mentioned        text[],
  add column if not exists players_mentioned       text[],
  add column if not exists products_mentioned      text[],
  add column if not exists is_crisis               bool default false,
  add column if not exists is_opportunity          bool default false,
  add column if not exists purchase_intent_score   numeric,
  add column if not exists competitor_switch_from  text,
  add column if not exists competitor_switch_to    text,
  add column if not exists crisis_keywords         text[],
  add column if not exists enriched_at             timestamptz;

create index if not exists reddit_mentions_enriched_at_idx on reddit_mentions (enriched_at);
create index if not exists reddit_mentions_is_crisis_idx on reddit_mentions (is_crisis) where is_crisis;
create index if not exists reddit_mentions_brands_idx on reddit_mentions using gin (brands_mentioned);

-- ─── ig_comments ─────────────────────────────────────────────────────────────
alter table ig_comments
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

create index if not exists ig_comments_enriched_at_idx on ig_comments (enriched_at);
create index if not exists ig_comments_is_crisis_idx on ig_comments (is_crisis) where is_crisis;

-- ─── yt_comments ─────────────────────────────────────────────────────────────
alter table yt_comments
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

create index if not exists yt_comments_enriched_at_idx on yt_comments (enriched_at);
create index if not exists yt_comments_is_crisis_idx on yt_comments (is_crisis) where is_crisis;

-- ─── x_posts ─────────────────────────────────────────────────────────────────
alter table x_posts
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

create index if not exists x_posts_enriched_at_idx on x_posts (enriched_at);
create index if not exists x_posts_is_crisis_idx on x_posts (is_crisis) where is_crisis;

-- ─── tiktok_videos ───────────────────────────────────────────────────────────
alter table tiktok_videos
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

create index if not exists tiktok_videos_enriched_at_idx on tiktok_videos (enriched_at);
create index if not exists tiktok_videos_is_crisis_idx on tiktok_videos (is_crisis) where is_crisis;

-- ─── influencer_x_posts (will exist once 005 is applied) ─────────────────────
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'influencer_x_posts') then
    execute $sql$
      alter table influencer_x_posts
        add column if not exists sentiment_score         numeric,
        add column if not exists sentiment_label         text,
        add column if not exists topics                  jsonb,
        add column if not exists brands_mentioned        text[],
        add column if not exists products_mentioned      text[],
        add column if not exists is_crisis               bool default false,
        add column if not exists is_opportunity          bool default false,
        add column if not exists purchase_intent_score   numeric,
        add column if not exists enriched_at             timestamptz
    $sql$;
  end if;
end$$;
