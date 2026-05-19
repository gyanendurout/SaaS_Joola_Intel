-- ─── Influencer X (Twitter) ──────────────────────────────────────────────────
-- Adds X presence tracking for the 27 athletes already in `influencers`.
-- Strategy: best-guess handle from IG handle pattern, populated next pipeline
-- run will diagnostic-log the 404s for iteration.

alter table influencers
  add column if not exists x_handle text;

create table if not exists influencer_x_snapshots (
  id              uuid primary key default gen_random_uuid(),
  influencer_id   uuid references influencers(id) on delete cascade,
  brand_id        uuid references brands(id),
  handle          text,
  followers       int,
  following       int,
  tweet_count     int,
  is_verified     bool default false,
  week_number     int,
  year            int,
  scraped_at      timestamptz default now()
);

create unique index if not exists influencer_x_snapshots_uniq
  on influencer_x_snapshots (influencer_id, week_number, year);

create table if not exists influencer_x_posts (
  id              uuid primary key default gen_random_uuid(),
  influencer_id   uuid references influencers(id) on delete cascade,
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

-- Seed best-guess X handles for all 27 athletes. Diagnostic logging on next
-- pipeline run will reveal which return empty.
update influencers set x_handle = v.handle
from (values
  ('alexneumann_pb',         'AlexNeumann'),
  ('allycejones_pb',         'AllyceJones'),
  ('andreidae_pb',           'AndreiDaescu'),
  ('anna.leigh.waters',      'AnnaLeighWaters'),
  ('annabright.pb',          'AnnaBright'),
  ('aspenkern_pb',           'AspenKern'),
  ('benjohns_pb',            'BenJohns_pb'),
  ('blainehovenier',         'BlaineHovenier'),
  ('bobbioshiro',            'BobbiOshiro'),
  ('catherineparenteau',     'CParenteau'),
  ('connorgarnett_pb',       'ConnorGarnett'),
  ('ericoncins_pb',          'EricOncins'),
  ('gabejoseph_pb',          'GabeJoseph'),
  ('jamesignatowich',        'JIgnatowich'),
  ('jaydevilliers',          'JayDevilliers'),
  ('jessie_irvine_pb',       'JessieIrvine'),
  ('jorjajohnsonpb',         'JorjaJohnson'),
  ('kyle_yates_pb',          'KyleYates_pb'),
  ('leighwaters_pb',         'LeighWaters'),
  ('patricksmithpb',         'PatrickSmithPB'),
  ('rileynewmanpb',          'RileyNewmanPB'),
  ('roscoebellamy',          'RoscoeBellamy'),
  ('sarahansboury',          'SarahAnsboury'),
  ('simonejardim_pb',        'SimoneJardim'),
  ('tannertomassi',          'TannerTomassi'),
  ('tysonmcguffin',          'TysonMcGuffin'),
  ('zanenavratil',           'ZaneNavratil')
) as v(ig, handle)
where influencers.instagram_handle = v.ig;
