-- ROLLBACK of 006_enrichment_columns.sql
-- Drops every enrichment column from every channel table.
-- Safe: data in these columns is purely derived by the enrichment worker;
-- no original scraped data is lost.

-- reddit_mentions
drop index if exists reddit_mentions_enriched_at_idx;
drop index if exists reddit_mentions_is_crisis_idx;
drop index if exists reddit_mentions_brands_idx;
alter table reddit_mentions
  drop column if exists sentiment_score,
  drop column if exists sentiment_label,
  drop column if exists topics,
  drop column if exists brands_mentioned,
  drop column if exists players_mentioned,
  drop column if exists products_mentioned,
  drop column if exists is_crisis,
  drop column if exists is_opportunity,
  drop column if exists purchase_intent_score,
  drop column if exists competitor_switch_from,
  drop column if exists competitor_switch_to,
  drop column if exists crisis_keywords,
  drop column if exists enriched_at;

-- ig_comments
drop index if exists ig_comments_enriched_at_idx;
drop index if exists ig_comments_is_crisis_idx;
alter table ig_comments
  drop column if exists sentiment_score,
  drop column if exists sentiment_label,
  drop column if exists topics,
  drop column if exists brands_mentioned,
  drop column if exists players_mentioned,
  drop column if exists products_mentioned,
  drop column if exists is_crisis,
  drop column if exists is_opportunity,
  drop column if exists purchase_intent_score,
  drop column if exists crisis_keywords,
  drop column if exists enriched_at;

-- yt_comments
drop index if exists yt_comments_enriched_at_idx;
drop index if exists yt_comments_is_crisis_idx;
alter table yt_comments
  drop column if exists sentiment_score,
  drop column if exists sentiment_label,
  drop column if exists topics,
  drop column if exists brands_mentioned,
  drop column if exists players_mentioned,
  drop column if exists products_mentioned,
  drop column if exists is_crisis,
  drop column if exists is_opportunity,
  drop column if exists purchase_intent_score,
  drop column if exists crisis_keywords,
  drop column if exists enriched_at;

-- x_posts
drop index if exists x_posts_enriched_at_idx;
drop index if exists x_posts_is_crisis_idx;
alter table x_posts
  drop column if exists sentiment_score,
  drop column if exists sentiment_label,
  drop column if exists topics,
  drop column if exists brands_mentioned,
  drop column if exists players_mentioned,
  drop column if exists products_mentioned,
  drop column if exists is_crisis,
  drop column if exists is_opportunity,
  drop column if exists purchase_intent_score,
  drop column if exists crisis_keywords,
  drop column if exists enriched_at;

-- tiktok_videos
drop index if exists tiktok_videos_enriched_at_idx;
drop index if exists tiktok_videos_is_crisis_idx;
alter table tiktok_videos
  drop column if exists sentiment_score,
  drop column if exists sentiment_label,
  drop column if exists topics,
  drop column if exists brands_mentioned,
  drop column if exists players_mentioned,
  drop column if exists products_mentioned,
  drop column if exists is_crisis,
  drop column if exists is_opportunity,
  drop column if exists purchase_intent_score,
  drop column if exists crisis_keywords,
  drop column if exists enriched_at;

-- influencer_x_posts (only if 005 was applied)
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'influencer_x_posts') then
    execute $sql$
      alter table influencer_x_posts
        drop column if exists sentiment_score,
        drop column if exists sentiment_label,
        drop column if exists topics,
        drop column if exists brands_mentioned,
        drop column if exists products_mentioned,
        drop column if exists is_crisis,
        drop column if exists is_opportunity,
        drop column if exists purchase_intent_score,
        drop column if exists enriched_at
    $sql$;
  end if;
end$$;
