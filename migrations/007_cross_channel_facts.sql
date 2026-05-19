-- ─── Cross-Channel Fact Tables ───────────────────────────────────────────────
-- Normalized lookup tables that the enrichment worker populates as a side
-- effect. Every channel's enriched rows produce one or more `mention_facts`,
-- which unlocks all cross-channel dashboards (Product Performance Matrix,
-- Crisis Center, Buying Intent Funnel, Competitor Defection Tracker, etc.)

-- ─── products_catalog (canonical SKU list) ──────────────────────────────────
create table if not exists products_catalog (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid references brands(id),
  sku         text not null,
  display_name text,
  aliases     text[],          -- ["Perseus", "Perseus IV", "Perseus 16mm"]
  category    text,            -- "paddle", "bag", "accessory"
  is_active   bool default true,
  launched_at date,
  created_at  timestamptz default now(),
  unique (brand_id, sku)
);

-- Seed JOOLA + key competitor paddles. Enrichment matches text to `aliases`.
insert into products_catalog (brand_id, sku, display_name, aliases, category)
select b.id, v.sku, v.display_name, v.aliases::text[], 'paddle'
from brands b
join (values
  -- JOOLA
  ('joola',   'PERSEUS_IV',    'Perseus IV',            '{Perseus,"Perseus IV","Perseus 4",PerseusIV}'),
  ('joola',   'PERSEUS_PRO',   'Perseus Pro IV',        '{"Perseus Pro","Perseus Pro IV"}'),
  ('joola',   'HYPERION_CFS',  'Hyperion CFS',          '{Hyperion,"Hyperion CFS","Hyperion 16"}'),
  ('joola',   'SCORPEUS_IV',   'Scorpeus IV',           '{Scorpeus,"Scorpeus IV"}'),
  ('joola',   'AGASSI_PRO',    'Agassi Pro',            '{"Agassi Pro",Agassi}'),
  ('joola',   'SOLAIRE',       'Solaire',               '{Solaire}'),
  ('joola',   'BEN_JOHNS_HYPERION', 'Ben Johns Hyperion', '{"Ben Johns Hyperion","BJ Hyperion"}'),
  -- Selkirk
  ('selkirk', 'VANGUARD_POWER_AIR', 'Vanguard Power Air','{Vanguard,"Power Air","Vanguard Power"}'),
  ('selkirk', 'LUXX_CONTROL',  'Luxx Control Air',      '{Luxx,"Luxx Control","Luxx Air"}'),
  ('selkirk', 'HALO',          'Halo',                  '{Halo}'),
  ('selkirk', 'INVIKTA',       'Invikta',               '{Invikta}'),
  -- Paddletek
  ('paddletek', 'BANTAM_TS5', 'Bantam TS-5',            '{Bantam,"Bantam TS-5","Bantam TS5"}'),
  ('paddletek', 'TEMPEST_REIGN', 'Tempest Reign',       '{"Tempest Reign",Tempest}'),
  -- CRBN
  ('crbn',    'CRBN_3',        'CRBN-3',                '{"CRBN-3","CRBN 3","CRBN3"}'),
  ('crbn',    'CRBN_X',        'CRBN-X',                '{"CRBN-X","CRBN X"}'),
  ('crbn',    'CRBN_1',        'CRBN-1',                '{"CRBN-1","CRBN 1"}'),
  -- Six Zero
  ('six-zero','DBD',           'Double Black Diamond',  '{"Double Black Diamond",DBD,"Six Zero DBD"}'),
  ('six-zero','RUBY',          'Ruby',                  '{Ruby,"Six Zero Ruby"}'),
  -- Engage
  ('engage',  'PURSUIT_PRO',   'Pursuit Pro',           '{Pursuit,"Pursuit Pro","Pursuit Pro 1"}'),
  -- Onix
  ('onix',    'Z5',            'Z5',                    '{Z5,"Onix Z5"}'),
  ('onix',    'EVOKE',         'Evoke',                 '{Evoke,"Onix Evoke"}'),
  -- Franklin
  ('franklin','SIGNATURE_PRO', 'Signature Pro',         '{"Signature Pro",Signature}'),
  -- HEAD
  ('head',    'RADICAL_PRO',   'Radical Pro',           '{Radical,"Radical Pro"}'),
  -- Wilson
  ('wilson',  'JUICE_PRO',     'Juice Pro',             '{"Juice Pro",Juice}'),
  -- Gamma
  ('gamma',   'OBSIDIAN',      'Obsidian',              '{Obsidian,"Gamma Obsidian"}')
) as v(slug, sku, display_name, aliases) on b.slug = v.slug
on conflict (brand_id, sku) do update
  set display_name = excluded.display_name,
      aliases      = excluded.aliases;

-- ─── mention_facts (one row per enriched channel mention) ───────────────────
-- This is the fact table that every cross-channel dashboard reads from.
create table if not exists mention_facts (
  id              uuid primary key default gen_random_uuid(),
  channel         text not null,        -- 'reddit','ig_comment','yt_comment','x','tiktok','x_influencer'
  source_table    text not null,
  source_id       uuid not null,
  brand_id        uuid references brands(id),
  product_id      uuid references products_catalog(id),
  athlete_id      uuid references influencers(id),
  sentiment_score numeric,
  sentiment_label text,
  is_crisis       bool default false,
  is_opportunity  bool default false,
  is_purchase_intent bool default false,
  is_competitor_switch bool default false,
  country_code    text,
  text_snippet    text,
  posted_at       timestamptz,
  created_at      timestamptz default now()
);

create unique index if not exists mention_facts_uniq
  on mention_facts (channel, source_id, brand_id, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists mention_facts_posted_at_idx on mention_facts (posted_at desc);
create index if not exists mention_facts_brand_posted_idx on mention_facts (brand_id, posted_at desc);
create index if not exists mention_facts_product_posted_idx on mention_facts (product_id, posted_at desc);
create index if not exists mention_facts_crisis_idx on mention_facts (is_crisis, posted_at desc) where is_crisis;

-- ─── topic_lifecycle (topic-spread tracking across channels) ─────────────────
create table if not exists topic_lifecycle (
  id                uuid primary key default gen_random_uuid(),
  topic_slug        text unique,            -- 'paddle-delamination','warranty-claim','new-perseus-iv'
  display_label     text,
  first_seen_at     timestamptz,
  first_seen_channel text,
  peak_at           timestamptz,
  peak_mentions_24h int,
  decayed_at        timestamptz,
  total_mentions    int default 0,
  channels_touched  text[],
  is_crisis         bool default false,
  created_at        timestamptz default now()
);

create index if not exists topic_lifecycle_first_seen_idx on topic_lifecycle (first_seen_at desc);
create index if not exists topic_lifecycle_crisis_idx on topic_lifecycle (is_crisis, peak_mentions_24h desc) where is_crisis;

-- ─── competitor_switch_events ────────────────────────────────────────────────
create table if not exists competitor_switch_events (
  id              uuid primary key default gen_random_uuid(),
  mention_id      uuid references mention_facts(id) on delete cascade,
  from_brand_id   uuid references brands(id),
  to_brand_id     uuid references brands(id),
  confidence      numeric,         -- 0-1, how sure the LLM is
  text_snippet    text,
  posted_at       timestamptz,
  created_at      timestamptz default now()
);

create index if not exists competitor_switch_to_idx on competitor_switch_events (to_brand_id, posted_at desc);
create index if not exists competitor_switch_from_idx on competitor_switch_events (from_brand_id, posted_at desc);
