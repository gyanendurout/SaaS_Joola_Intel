-- ROLLBACK of 004_unique_constraints.sql
-- Run this if 004 caused problems. Safe to run multiple times.

-- 1) Drop the constraints
alter table reddit_mentions  drop constraint if exists reddit_mentions_post_brand_uniq;
alter table influencer_posts drop constraint if exists influencer_posts_url_uniq;

-- 2) Restore JOOLA X handle to its previous value
update x_accounts
   set handle = 'joolausa',
       profile_url = 'https://x.com/joolausa'
 where brand_id = (select id from brands where slug = 'joola');

-- 3) Restore duplicate rows from the archive (optional — uncomment to use)
-- insert into reddit_mentions
-- select * from jsonb_populate_recordset(null::reddit_mentions, jsonb_agg(row_data))
-- from reddit_mentions_dupe_archive;
--
-- insert into influencer_posts
-- select * from jsonb_populate_recordset(null::influencer_posts, jsonb_agg(row_data))
-- from influencer_posts_dupe_archive;

-- 4) Drop archive tables (only after you're sure you don't need the data)
-- drop table if exists reddit_mentions_dupe_archive;
-- drop table if exists influencer_posts_dupe_archive;
