-- Fixes pipeline upsert errors caused by missing unique constraints.
-- Errors observed:
--   sb_upsert reddit_mentions on (reddit_post_id, brand_id) → 42P10 no unique constraint
--   sb_upsert influencer_posts on (post_url)                → 42P10 no unique constraint
--
-- SAFETY: archives every duplicate row to *_dupe_archive BEFORE deletion so
-- rollback is possible. To restore: copy rows back from the archive table.

-- ─── 1) Archive duplicates before deletion ──────────────────────────────────

create table if not exists reddit_mentions_dupe_archive (
  archived_at timestamptz default now(),
  row_data    jsonb
);

insert into reddit_mentions_dupe_archive (row_data)
select to_jsonb(a.*)
from reddit_mentions a
where a.id in (
  select a.id
  from reddit_mentions a
  join reddit_mentions b
    on a.reddit_post_id = b.reddit_post_id
   and a.brand_id       = b.brand_id
   and a.id < b.id
);

create table if not exists influencer_posts_dupe_archive (
  archived_at timestamptz default now(),
  row_data    jsonb
);

insert into influencer_posts_dupe_archive (row_data)
select to_jsonb(a.*)
from influencer_posts a
where a.id in (
  select a.id
  from influencer_posts a
  join influencer_posts b
    on a.post_url = b.post_url
   and a.id < b.id
);

-- ─── 2) Delete duplicates ───────────────────────────────────────────────────

delete from reddit_mentions a
using reddit_mentions b
where a.id < b.id
  and a.reddit_post_id = b.reddit_post_id
  and a.brand_id       = b.brand_id;

delete from influencer_posts a
using influencer_posts b
where a.id < b.id
  and a.post_url = b.post_url;

-- ─── 3) Add unique constraints ──────────────────────────────────────────────

alter table reddit_mentions
  add constraint reddit_mentions_post_brand_uniq unique (reddit_post_id, brand_id);

alter table influencer_posts
  add constraint influencer_posts_url_uniq unique (post_url);

-- ─── 4) Correct JOOLA X handle ──────────────────────────────────────────────
-- The seeded `joolausa` was a parody account (253 followers).
-- Real account: https://x.com/joolapickleball

update x_accounts
   set handle = 'joolapickleball',
       profile_url = 'https://x.com/joolapickleball'
 where brand_id = (select id from brands where slug = 'joola');

-- ─── Verification queries (run after to confirm) ────────────────────────────
-- select count(*) from reddit_mentions;                  -- expect 321
-- select count(*) from influencer_posts;                 -- expect 135
-- select count(*) from reddit_mentions_dupe_archive;     -- expect 59
-- select count(*) from influencer_posts_dupe_archive;    -- expect 327
-- select handle from x_accounts where brand_id = (select id from brands where slug='joola');
