-- ─── X (Twitter) ─────────────────────────────────────────────────────────────

create table if not exists x_accounts (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid references brands(id),
  handle      text not null,
  profile_url text,
  created_at  timestamptz default now(),
  unique (brand_id)
);

create table if not exists x_profiles_weekly (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid references x_accounts(id),
  brand_id     uuid references brands(id),
  handle       text,
  followers    int,
  following    int,
  tweet_count  int,
  is_verified  bool default false,
  week_number  int,
  year         int,
  scraped_at   timestamptz default now()
);

create table if not exists x_posts (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid references x_accounts(id),
  brand_id        uuid references brands(id),
  handle          text,
  tweet_id        text unique,
  post_url        text,
  text            text,
  like_count      int default 0,
  retweet_count   int default 0,
  reply_count     int default 0,
  view_count      int default 0,
  posted_at       timestamptz,
  created_at      timestamptz default now()
);

-- Seed X accounts
-- VERIFICATION POLICY (2026-05-24): Only handles confirmed to return scraped
-- posts are seeded. Brands without confirmed X handles are intentionally
-- omitted — DO NOT add guesses here. Verified absences (no X account exists):
--   - crbn       (confirmed via crbnpickleball.com — IG/TikTok/FB only)
--   - six-zero   (confirmed via sixzeropickleball.com — IG/FB only)
--   - engage     (confirmed via engagepickleball.com — FB/YT/IG/TT only)
--   - head       (no dedicated pickleball X; @head_tennis is parent acct, kept below)
insert into x_accounts (brand_id, handle, profile_url)
select b.id, v.handle, 'https://x.com/' || v.handle
from brands b
join (values
  ('joola',     'joolapickleball'),
  ('selkirk',   'SelkirkSport'),
  ('franklin',  'FranklinSports'),
  ('paddletek', 'PaddletekLLC'),
  ('onix',      'OnixPickleball'),
  ('wilson',    'WilsonSportingG'),
  ('gamma',     'gammapickleball'),     -- verified via x.com/gammapickleball
  ('head',      'head_tennis')          -- parent brand; pickleball posts mixed in
) as v(slug, handle) on b.slug = v.slug
on conflict (brand_id) do update set handle = excluded.handle, profile_url = excluded.profile_url;


-- ─── TikTok ───────────────────────────────────────────────────────────────────

create table if not exists tiktok_accounts (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid references brands(id),
  handle      text not null,
  profile_url text,
  created_at  timestamptz default now(),
  unique (brand_id)
);

create table if not exists tiktok_profiles_weekly (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid references tiktok_accounts(id),
  brand_id      uuid references brands(id),
  handle        text,
  followers     int,
  following     int,
  video_count   int,
  total_hearts  bigint,
  is_verified   bool default false,
  week_number   int,
  year          int,
  scraped_at    timestamptz default now()
);

create table if not exists tiktok_videos (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid references tiktok_accounts(id),
  brand_id         uuid references brands(id),
  handle           text,
  tiktok_video_id  text unique,
  video_url        text,
  text             text,
  view_count       bigint default 0,
  like_count       int default 0,
  comment_count    int default 0,
  share_count      int default 0,
  duration_seconds int,
  thumbnail_url    text,
  posted_at        timestamptz,
  created_at       timestamptz default now()
);

-- Seed TikTok accounts
insert into tiktok_accounts (brand_id, handle, profile_url)
select b.id, v.handle, 'https://www.tiktok.com/@' || v.handle
from brands b
join (values
  ('joola',      'joolapickleball'),
  ('selkirk',    'selkirksport'),
  ('crbn',       'crbnpickleball'),
  ('franklin',   'franklinsportsofficial'),
  ('engage',     'engage_pickleball'),
  ('six-zero',   'sixzeropickleball'),
  ('onix',       'onix_pickleball'),
  ('wilson',     'wilsonsportinggoods'),
  ('gamma',      'gammasports'),
  ('prokennex',  'prokennexpickleball')
) as v(slug, handle) on b.slug = v.slug
on conflict (brand_id) do update set handle = excluded.handle, profile_url = excluded.profile_url;
