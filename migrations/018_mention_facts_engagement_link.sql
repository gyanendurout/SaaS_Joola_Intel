-- Migration 018: Add engagement + link_url to mention_facts; add post_url to ig_comments
-- These fields enable the frontend Player Mentions table to show engagement counts and
-- direct links to the original post/comment for each mention_fact row.

-- ── 1. ig_comments: store the parent post URL so mention_facts can surface it ──
ALTER TABLE ig_comments
  ADD COLUMN IF NOT EXISTS post_url TEXT;

-- ── 2. mention_facts: engagement count from source row ──────────────────────────
ALTER TABLE mention_facts
  ADD COLUMN IF NOT EXISTS engagement BIGINT NOT NULL DEFAULT 0;

-- ── 3. mention_facts: direct link to the source post / comment ──────────────────
ALTER TABLE mention_facts
  ADD COLUMN IF NOT EXISTS link_url TEXT;

-- Backfill comment: existing rows will keep engagement=0 and link_url=NULL until
-- the next pipeline run re-populates mention_facts from the updated SOURCES list.
