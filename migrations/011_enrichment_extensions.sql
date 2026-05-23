-- ============================================================
-- Migration 011: Enrichment Extensions
-- Adds columns to 3 existing tables + creates brand_replies table.
-- All changes are additive (no existing data at risk).
-- Run in: Supabase SQL Editor
-- ============================================================

-- 1. influencer_posts: add sentiment + is_sponsored
--    (migration 006 added enrichment to influencer_x_posts but NOT influencer_posts)
ALTER TABLE influencer_posts
    ADD COLUMN IF NOT EXISTS sentiment      TEXT,
    ADD COLUMN IF NOT EXISTS is_sponsored   BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS enriched_at    TIMESTAMPTZ;

-- 2. yt_videos: add is_short flag
--    (existing rows have is_short=false; new scrape sets it from duration < 61s + /shorts/ URL)
ALTER TABLE yt_videos
    ADD COLUMN IF NOT EXISTS is_short BOOLEAN DEFAULT FALSE;

-- 3. ig_profiles_weekly: add dominant content theme
--    (Task G — populated by analyzing last 30 posts per brand/week)
ALTER TABLE ig_profiles_weekly
    ADD COLUMN IF NOT EXISTS dominant_content_theme TEXT;

-- 4. brand_replies: new table for JOOLA complaint response tracking (Task B)
--    Tracks when JOOLA (or any brand) replies to another brand's content / a user complaint
CREATE TABLE IF NOT EXISTS brand_replies (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    replying_brand_id UUID REFERENCES brands(id) ON DELETE CASCADE,
    source_table      TEXT NOT NULL,     -- 'ig_comments' | 'yt_comments' | 'reddit_comments'
    source_row_id     UUID NOT NULL,     -- FK into the source table row
    original_text     TEXT,             -- the original comment/post
    reply_text        TEXT,             -- JOOLA's reply text
    replied_at        TIMESTAMPTZ,
    response_time_mins INTEGER,         -- minutes from original post to this reply
    joola_responded   BOOLEAN DEFAULT FALSE,
    sentiment         TEXT,             -- sentiment of the original complaint
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source_table, source_row_id)
);

CREATE INDEX IF NOT EXISTS idx_brand_replies_brand ON brand_replies(replying_brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_replies_responded ON brand_replies(joola_responded);
CREATE INDEX IF NOT EXISTS idx_brand_replies_replied_at ON brand_replies(replied_at DESC);

COMMENT ON TABLE brand_replies IS 'Tracks brand reply activity, primarily JOOLA responding to complaints on social';
COMMENT ON COLUMN brand_replies.response_time_mins IS 'Minutes between original post and brand reply (null if reply not found)';
COMMENT ON COLUMN ig_profiles_weekly.dominant_content_theme IS 'Most frequent content theme from last 30 posts this week';
COMMENT ON COLUMN yt_videos.is_short IS 'True if video duration <= 60s or URL contains /shorts/';
COMMENT ON COLUMN influencer_posts.is_sponsored IS 'True if post contains #ad, #sponsored, or paid partnership disclosure';
