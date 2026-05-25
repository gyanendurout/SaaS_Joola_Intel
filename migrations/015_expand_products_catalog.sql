-- Migration 015: expand products_catalog with widely-recognized paddles per brand
--
-- BACKGROUND: The AI enricher correctly extracts paddle names from comments and
-- captions (verified: "boomstik", "agassi pro", "alpha pro", "courtstrike",
-- "kosmos", etc. all appear in products_mentioned arrays). But mention_facts.py
-- only emits product_id-tagged rows when the extracted name maps to a row in
-- products_catalog via the .aliases JSON array. The original 25-row seed missed
-- most of the famous paddles -- so AI hits were silently dropped at the join.
--
-- This migration adds ~50 additional paddles per the JOOLA team's reference
-- table (2026-05-25 conversation) + AI-detected names found in real
-- reddit_mentions / tiktok_videos / x_posts content this week.
--
-- Source list:
--   - User-provided 2026-05-25 table of "well-known paddles per brand"
--   - AI-extracted products_mentioned arrays from current enriched rows
--
-- Idempotent: uses ON CONFLICT (brand_id, sku) DO NOTHING to skip rows that
-- already exist. SKU naming convention: <BRAND>_<MODEL>_<VARIANT> uppercase
-- with underscores. Re-runs are safe.
--
-- After applying:
--   1. Run: python -m backend.scraping.run --module facts --restart
--   2. Verify: mention_facts row count for product_id IS NOT NULL goes up sharply.

begin;

-- Defensive: products_catalog.sku is the unique identifier we'll dedupe on.
-- The table already has a unique constraint on (brand_id, sku) per migration 010;
-- if that's missing, the ON CONFLICT clauses below will throw.

with brand_ids as (
  select id, slug from brands
)
insert into products_catalog (brand_id, sku, display_name, aliases, category, is_active)
select b.id, v.sku, v.display_name, v.aliases::text[], 'paddle', true
from (values
  -- ===================== JOOLA =====================
  -- existing: AGASSI_PRO, BEN_JOHNS_HYPERION, HYPERION_CFS, PERSEUS_IV,
  --           PERSEUS_PRO, SCORPEUS_IV, SOLAIRE
  ('joola', 'PRO_V_KOSMOS', 'Pro V Kosmos',
    array['Pro V Kosmos','Kosmos','Kosmos Pro V','Joola Kosmos']),
  ('joola', 'VISION',       'Vision',
    array['Vision','Joola Vision']),
  ('joola', 'SOLAIRE_CFS_16', 'Solaire CFS 16mm',
    array['Solaire CFS 16','Solaire CFS','Solaire 16mm']),

  -- ===================== SELKIRK =====================
  -- existing: HALO, INVIKTA, LUXX_CONTROL, VANGUARD_POWER_AIR
  ('selkirk', 'AMPED_PRO_AIR',     'Amped Pro Air',
    array['Amped Pro Air','Amped Pro','Pro Air']),
  ('selkirk', 'SLK_HALO_CONTROL',  'SLK Halo Control',
    array['SLK Halo Control','Halo Control','SLK Halo']),
  ('selkirk', 'VANGUARD_CONTROL',  'Vanguard Control',
    array['Vanguard Control']),
  ('selkirk', 'SLK_GEO',           'SLK Geo',
    array['SLK Geo','Geo','Selkirk Geo']),
  ('selkirk', 'AMPED_EPIC',        'Amped Epic',
    array['Amped Epic','Epic']),
  ('selkirk', 'POWER_AIR_INVIKTA', 'Power Air Invikta',
    array['Power Air Invikta','Power Air','Invikta Power Air']),
  ('selkirk', 'PROJECT_BOOMSTIK',  'Project Boomstik',
    array['Project Boomstik','Boomstik','Selkirk LABS Project Boomstik','Selkirk Boomstik']),
  ('selkirk', 'SLK_DAUNTLESS',     'SLK Dauntless',
    array['SLK Dauntless','Dauntless','Selkirk Dauntless']),

  -- ===================== PADDLETEK =====================
  -- existing: BANTAM_TS5, TEMPEST_REIGN
  ('paddletek', 'TEMPEST_WAVE_PRO',   'Tempest Wave Pro',
    array['Tempest Wave Pro','Tempest Wave','Wave Pro']),
  ('paddletek', 'BANTAM_EXL',         'Bantam EX-L',
    array['Bantam EX-L','Bantam EXL','EX-L','EX L']),
  ('paddletek', 'PHOENIX_GENESIS',    'Phoenix Genesis',
    array['Phoenix Genesis','Phoenix']),
  ('paddletek', 'TEMPEST_REIGN_PRO',  'Tempest Reign Pro',
    array['Tempest Reign Pro','Reign Pro']),
  ('paddletek', 'BANTAM_ALWC',        'Bantam ALW-C',
    array['Bantam ALW-C','Bantam ALWC','ALW-C','Anna Leigh Waters paddle','ALW paddle']),

  -- ===================== ONIX =====================
  -- existing: EVOKE, Z5
  ('onix', 'GRAPHITE_Z5',  'Graphite Z5',
    array['Graphite Z5','Onix Z5','Z5 Graphite']),
  ('onix', 'EVOKE_PREMIER','Evoke Premier',
    array['Evoke Premier','Premier']),
  ('onix', 'EVOKE_PRO',    'Evoke Pro',
    array['Evoke Pro']),
  ('onix', 'STRYKER_4',    'Stryker 4',
    array['Stryker 4','Stryker','Onix Stryker']),
  ('onix', 'SUMMIT_C1',    'Summit C1',
    array['Summit C1','Summit','Onix Summit']),
  ('onix', 'MALICE_CFS',   'Malice CFS',
    array['Malice CFS','Malice','Onix Malice']),

  -- ===================== GAMMA =====================
  -- existing: OBSIDIAN
  ('gamma', 'COMPASS_NEUCORE', 'Compass NeuCore',
    array['Compass NeuCore','Compass','Gamma Compass']),
  ('gamma', 'SHARD_NEUCORE',   'Shard NeuCore',
    array['Shard NeuCore','Shard','Gamma Shard']),
  ('gamma', 'RZR',             'RZR',
    array['RZR','Gamma RZR']),
  ('gamma', 'NEEDLE',          'Needle',
    array['Needle','Gamma Needle']),
  ('gamma', 'MIRAGE',          'Mirage',
    array['Mirage','Gamma Mirage']),
  ('gamma', 'POLYCORE_505',    'PolyCore 505',
    array['PolyCore 505','PolyCore','505']),

  -- ===================== SIX ZERO =====================
  -- existing: DBD (Double Black Diamond), RUBY
  ('six-zero', 'BLACK_DIAMOND_POWER', 'Black Diamond Power',
    array['Black Diamond Power','Black Diamond','BDP']),
  ('six-zero', 'SAPPHIRE',             'Sapphire',
    array['Sapphire','Six Zero Sapphire']),
  ('six-zero', 'DBD_CONTROL',          'Double Black Diamond Control',
    array['Double Black Diamond Control','DBD Control','DBDC']),
  ('six-zero', 'SIX_ZERO_PRO',         'Six Zero Pro',
    array['Six Zero Pro','SZ Pro']),
  ('six-zero', 'CFC',                  'Carbon Framed Control',
    array['Carbon Framed Control','CFC']),
  ('six-zero', 'RUBY_PRO',             'Ruby Pro',
    array['Ruby Pro','Six Zero Ruby Pro']),
  ('six-zero', 'BLACK_OPAL',           'Black Opal',
    array['Black Opal','Six Zero Black Opal']),
  ('six-zero', 'R4LLY',                'R4LLY',
    array['R4LLY','R4lly','Six Zero R4LLY','Six Zero R4lly','Rally']),

  -- ===================== FRANKLIN =====================
  -- existing: SIGNATURE_PRO
  ('franklin', 'SIGNATURE_CARBON_STK', 'Signature Carbon STK',
    array['Signature Carbon STK','Signature Carbon','Signature STK','Carbon STK','ALW Carbon']),
  ('franklin', 'ACTIVATOR',            'Activator',
    array['Activator','Franklin Activator']),
  ('franklin', 'X40_PERFORMANCE',      'X-40 Performance',
    array['X-40 Performance','X-40','X40']),
  ('franklin', 'FS1000',               'FS1000',
    array['FS1000','FS 1000']),
  ('franklin', 'PILOT',                'Pilot',
    array['Pilot','Franklin Pilot']),

  -- ===================== HEAD =====================
  -- existing: RADICAL_PRO
  ('head', 'RADICAL_TOUR_GRAPHITE', 'Radical Tour Graphite',
    array['Radical Tour Graphite','Radical Tour']),
  ('head', 'GRAVITY_PRO',           'Gravity Pro',
    array['Gravity Pro','Gravity','HEAD Gravity']),
  ('head', 'EXTREME_TOUR',          'Extreme Tour',
    array['Extreme Tour','Extreme','HEAD Extreme']),
  ('head', 'EXTREME_ELITE',         'Extreme Elite',
    array['Extreme Elite']),
  ('head', 'SPEED_PRO',             'Speed Pro',
    array['Speed Pro','HEAD Speed']),

  -- ===================== CRBN =====================
  -- existing: CRBN_1, CRBN_3, CRBN_X
  ('crbn', 'CRBN_2',         'CRBN-2',
    array['CRBN-2','CRBN 2']),
  ('crbn', 'CRBN_POWER_1X',  'CRBN Power 1X',
    array['CRBN Power 1X','Power 1X']),
  ('crbn', 'CRBN_1X_PRO',    'CRBN 1X Pro',
    array['CRBN 1X Pro','1X Pro']),

  -- ===================== ENGAGE =====================
  -- existing: PURSUIT_PRO
  ('engage', 'ENCORE_PRO',           'Encore Pro',
    array['Encore Pro','Encore']),
  ('engage', 'POACH_INFINITY_EX',    'Poach Infinity EX 6.0',
    array['Poach Infinity EX 6.0','Poach Infinity','Poach','Infinity EX']),
  ('engage', 'PURSUIT_EX_6',         'Pursuit EX 6.0',
    array['Pursuit EX 6.0','Pursuit EX']),
  ('engage', 'PURSUIT_MX_6',         'Pursuit MX 6.0',
    array['Pursuit MX 6.0','Pursuit MX']),
  ('engage', 'OMEGA_EVOLUTION_ELITE','Omega Evolution Elite',
    array['Omega Evolution Elite','Omega Evolution','Omega']),
  ('engage', 'ENCORE_MX_6',          'Encore MX 6.0',
    array['Encore MX 6.0','Encore MX']),

  -- ===================== WILSON =====================
  -- existing: JUICE_PRO
  ('wilson', 'ECHO_CARBON',     'Echo Carbon',
    array['Echo Carbon','Echo','Wilson Echo']),
  ('wilson', 'JUICE',           'Juice',
    array['Juice','Wilson Juice']),
  ('wilson', 'SURGE',           'Surge',
    array['Surge','Wilson Surge']),
  ('wilson', 'CARBON_FORCE_PRO','Carbon Force Pro',
    array['Carbon Force Pro','Carbon Force']),
  ('wilson', 'FIERCE_TEAM',     'Fierce Team',
    array['Fierce Team','Fierce']),
  ('wilson', 'ULTRA_TEAM',      'Ultra Team',
    array['Ultra Team','Wilson Ultra'])
) as v(brand_slug, sku, display_name, aliases)
join brand_ids b on b.slug = v.brand_slug
on conflict (brand_id, sku) do nothing;

commit;

-- Verify counts post-migration:
--   select b.slug, count(*) from products_catalog p
--     join brands b on b.id = p.brand_id group by b.slug order by b.slug;
-- Expected approximate counts (depending on existing seed):
--   crbn=6, engage=7, franklin=6, gamma=7, head=6, joola=10, onix=8,
--   paddletek=7, selkirk=11, six-zero=10, wilson=7  (total ~85)
