-- Keyword research results — one row per agent run
create table if not exists keyword_research_results (
  id             uuid primary key default gen_random_uuid(),
  seed           text not null,
  seed_type      text not null check (seed_type in ('topic', 'url')),
  generated_at   timestamptz not null,
  total_keywords integer,
  total_volume   integer,
  avg_difficulty integer,
  cluster_count  integer,
  result_json    jsonb not null,
  created_at     timestamptz default now()
);

create index if not exists idx_kwr_seed on keyword_research_results (seed);
create index if not exists idx_kwr_generated_at on keyword_research_results (generated_at desc);
