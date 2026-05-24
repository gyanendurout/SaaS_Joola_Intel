-- ─── Influencer X (Twitter) ──────────────────────────────────────────────────
-- Adds X presence tracking for athletes in `influencers`.
-- VERIFICATION POLICY (2026-05-24): Only handles empirically confirmed to
-- return scraped posts OR cross-checked against an official source (PPA Tour
-- player page, MLP tag, athlete's own site) are seeded. Best-guess handles
-- that produced ZERO scraped posts have been removed. DO NOT re-add guesses.

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

-- Seed VERIFIED X handles only. Each handle below either:
--   (a) returned >0 posts in the previous pipeline run, OR
--   (b) was cross-checked against an official source (URL in comment).
-- Athletes not listed here have NO known/confirmed X handle as of 2026-05-24.
-- DO NOT add guesses. Leaving x_handle NULL is the correct state for unknowns.
update influencers set x_handle = v.handle
from (values
  -- Previously confirmed (returned posts in prior runs)
  ('anna.leigh.waters',      'AnnaLeighWaters'),
  ('annabright.pb',          'AnnaBright'),
  ('benjohns_pb',            'BenJohns_pb'),
  ('gabejoseph_pb',          'GabeJoseph'),
  ('jamesignatowich',        'JIgnatowich'),
  ('jaydevilliers',          'JayDevilliers'),
  ('leighwaters_pb',         'LeighWaters'),
  ('sarahansboury',          'SarahAnsboury'),
  ('tysonmcguffin',          'TysonMcGuffin'),
  ('zanenavratil',           'ZaneNavratil'),
  -- Newly verified 2026-05-24 (cross-checked against PPA Tour / personal sites)
  ('catherineparenteau',     'CP_Pickleball'),    -- ppatour.com/athlete/catherine-parenteau
  ('connorgarnett_pb',       'Con_Garnett'),      -- connorgarnett.com
  ('kyle_yates_pb',          'KyleYatesPklbl'),   -- x.com/KyleYatesPklbl
  ('rileynewmanpb',          'RiGuy3'),           -- ppatour.com/athlete/riley-newman
  ('jessie_irvine_pb',       'jessie_irvine'),    -- twitter.com/jessie_irvine
  ('roscoebellamy',          'roscoe_bellamy'),   -- ppatour.com/athlete/roscoe-bellamy
  ('ericoncins_pb',          'ericoncins')        -- MLP tagged in x.com/MajorLeaguePB/status/1928109668603417004
) as v(ig, handle)
where influencers.instagram_handle = v.ig;

-- Explicitly NULL out any previously-seeded guesses for athletes we could NOT verify.
-- This prevents future pipeline runs from attempting to scrape fake handles.
update influencers set x_handle = null
where instagram_handle in (
  'alexneumann_pb',         -- guess @AlexNeumann unverified
  'allycejones_pb',         -- guess @AllyceJones unverified
  'andreidae_pb',           -- guess @AndreiDaescu unverified
  'aspenkern_pb',           -- guess @AspenKern returned 0 posts
  'blainehovenier',         -- guess @BlaineHovenier returned 0 posts
  'bobbioshiro',            -- guess @BobbiOshiro returned 0 posts
  'jorjajohnsonpb',         -- guess @JorjaJohnson returned 0 posts
  'patricksmithpb',         -- guess @PatrickSmithPB unverified; PPA only lists IG
  'simonejardim_pb',        -- guess @SimoneJardim returned 0 posts; official site = no X
  'tannertomassi'           -- guess @TannerTomassi returned 0 posts; official site = no X
);
