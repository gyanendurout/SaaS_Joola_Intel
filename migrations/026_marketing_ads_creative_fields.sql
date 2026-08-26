-- 026: columns the ad actors already return but marketing_ads had nowhere to put.
--
-- Context: apify/facebook-ads-scraper nests its creative under `snapshot` in
-- camelCase while scrape_meta_ads.py read top-level snake_case, so body/cta/
-- landing_url were written empty for three months without any error. That is
-- repaired by backfill_marketing_ads_from_raw.py against existing columns.
-- These are the remaining fields that were being discarded because no column
-- existed to receive them.
--
-- Safe to re-run. Adds nullable columns only -- no rewrite of existing rows.

ALTER TABLE marketing_ads
  -- Meta: the headline, which is present on 91% of ads and is often the only
  -- real text on a dynamic catalogue ad whose body is a {{token}}.
  ADD COLUMN IF NOT EXISTS ad_title            text,

  -- Meta publisherPlatform (100% populated): FACEBOOK / INSTAGRAM / MESSENGER /
  -- THREADS / AUDIENCE_NETWORK. "Meta" alone hides whether a competitor is
  -- buying Instagram placement, which is a different audience decision.
  ADD COLUMN IF NOT EXISTS publisher_platforms text[],

  -- Google lastShown / approxDaysShown. Without these, is_active defaults true
  -- forever and every ad ever captured reads as currently running.
  ADD COLUMN IF NOT EXISTS last_shown          timestamptz,
  ADD COLUMN IF NOT EXISTS approx_days_shown   integer,

  -- Google adFormat (text / image / video) -- creative mix per competitor.
  ADD COLUMN IF NOT EXISTS ad_format           text,

  -- Google transparency-archive permalink. Deliberately NOT landing_url: it
  -- points at Google, not the advertiser, and would make "where does the click
  -- land" answer google.com for every Google ad.
  ADD COLUMN IF NOT EXISTS archive_url         text,

  -- Meta dynamic catalogue ads carry "{{product.brand}}" as their body. They
  -- are real ads but carry no authored message; flagging them keeps message
  -- analysis from counting 420 sentences nobody wrote.
  ADD COLUMN IF NOT EXISTS is_template_ad      boolean DEFAULT false;

-- Recency queries ("what is running now") drive most of the page.
CREATE INDEX IF NOT EXISTS idx_marketing_ads_last_shown
  ON marketing_ads (last_shown DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_marketing_ads_brand_started
  ON marketing_ads (brand_id, started_at DESC NULLS LAST);

COMMENT ON COLUMN marketing_ads.archive_url IS
  'Ad-archive permalink (Google transparency centre). Not the advertiser landing page.';
COMMENT ON COLUMN marketing_ads.is_template_ad IS
  'Meta dynamic catalogue ad: body was a {{token}} placeholder, not authored copy.';
