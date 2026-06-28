-- Migration 019: Fix topic_lifecycle schema
-- The original migration 007 used a per-topic-slug design (one row per topic globally).
-- The Python facts/topic_lifecycle.py module uses a brand×topic×channel×week design
-- which has never been able to write a single row (brand_id column missing).
-- The frontend does NOT read from this table.
-- This migration replaces the table with the schema the code actually expects.

drop table if exists topic_lifecycle cascade;

create table topic_lifecycle (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  topic         text not null,
  channel       text not null,
  mention_count int default 0,
  first_seen_at timestamptz,
  week_number   int not null,
  year          int not null,
  created_at    timestamptz default now(),
  unique (brand_id, topic, channel, week_number, year)
);

create index if not exists topic_lifecycle_brand_idx  on topic_lifecycle (brand_id);
create index if not exists topic_lifecycle_topic_idx  on topic_lifecycle (topic);
create index if not exists topic_lifecycle_week_idx   on topic_lifecycle (year desc, week_number desc);
create index if not exists topic_lifecycle_first_seen on topic_lifecycle (first_seen_at desc);
