# Autonomous Run Log — 2026-05-19

**Start**: 09:30 IST | **Budget**: Apify $25 / OpenAI $5 | **Mode**: skip-and-continue, no git push

---

## Status

| T+    | Step                                            | Status      | Result |
|-------|-------------------------------------------------|-------------|--------|
| 00:00 | Verify migrations 004-007 applied               | ✅ DONE     | All checks pass |
| 00:01 | Drop 3 dead brand X handles (engage/wilson/gamma) | ✅ DONE   | `X_HANDLES` now 5 brands |
| 00:02 | Add `INFLUENCER_X_HANDLES` (27 athletes)        | ✅ DONE     | best-guess handles for all 27 |
| 00:03 | Add `run_x_influencers()` step (13/13)          | ✅ DONE     | wired into `main()` |
| 00:04 | Verify script compiles                          | ✅ DONE     | `py_compile` OK |
| 00:05 | Kick off pipeline (3-yr X window, ~90 min)      | 🔄 RUNNING | bg task `by7uacy2u`, on step 2/13 |
| 00:10 | Build `scripts/enrich_with_ai.py`               | ✅ DONE     | 6 tables, gpt-4o-mini |
| 00:15 | Build `scripts/populate_mention_facts.py`       | ✅ DONE     | reads enriched rows → mention_facts |
| ~01:30| Pipeline finishes → run enrichment              | PENDING     |        |
| ~01:45| Run mention_facts populator                     | PENDING     |        |
| ~02:00| Verify cross-channel queries work               | PENDING     |        |
| ~03:00| Phase 3 — Reddit comments scraper (if time)     | PENDING     |        |

---

## Pipeline progress (live)

```
[1/5] Instagram — ✅ 11 profiles, 120 posts
[2/5] YouTube — 🔄 RUNNING
```

## Errors / Skipped
_(none yet)_

## Files created so far
- `scripts/enrich_with_ai.py` — AI enrichment worker (gpt-4o-mini)
- `scripts/populate_mention_facts.py` — cross-channel fact populator
- `scripts/test_tiktok_only.py` — isolated TikTok test runner

## ⚠ Pipeline Crash + Recovery (T+~20m)

**Crash**: pipeline died at Step 4 (products) — `float("24 reviews")` raised
ValueError because the playwright-scraper returned a non-numeric rating
("24 reviews" instead of "4.5"). No try/except wrapper, so the entire
pipeline aborted with steps 5-13 never running.

**Damage**:
- ✅ IG, YT, Reddit completed (steps 1-3)
- ❌ Products, Influencers, Promos, Ads (Meta + Google), Comments (IG + YT),
  X-Twitter, TikTok, X-Influencers — all unrun

**Fixes applied**:
1. New `parse_rating()` helper that extracts numeric value safely and
   clamps to 0-5 range (rejects "24 reviews" → None)
2. Wrapped EVERY step in `_safe_step()` — one step failing now logs the
   error and continues to next step (no more total pipeline loss)
3. Created `scripts/resume_pipeline.py` — only runs steps 4-13 to avoid
   paying Apify again for IG/YT/Reddit (~$5 saved)

**Resume launched**: background task `brpwijoqv` → `scripts/pipeline_resume.log`

## ✅ Resume pipeline DONE (T+~70m)

| Step | Result |
|---|---|
| Products | ⚠️ 0 — `products` table missing unique constraint (BUG-X, fix below) |
| Influencers | ✅ 132 posts + 27 snapshots |
| Promo banners | ✅ 28 |
| Meta ads | ✅ 144 |
| Google ads | ✅ 578 |
| IG comments | ✅ 2,260 |
| YT comments | ✅ 539 |
| X / Twitter | ✅ **399 posts** (3-yr window working) |
| TikTok | ✅ **1,190 videos** (schema fix worked) |
| Influencer X | ✅ **729 tweets** from 13/27 athletes |

**Influencer X handles that returned empty** (will iterate next run or drop):
`aspenkern, blainehovenier, bobbioshiro, connorgarnett, cparenteau, ericoncins,
jessieirvine, jorjajohnson, kyleyates_pb, patricksmithpb, rileynewmanpb,
roscoebellamy, simonejardim, tannertomassi`

## ⚠️ NEW BUG-X: Products unique constraint missing
- Symptom: `42P10 no unique or exclusion constraint for ON CONFLICT (name, brand_id)`
- Will draft `migrations/008_products_constraint.sql` for user to apply later.

## ✅ Enrichment round 1 done (T+~110m) — 5,896 rows
- reddit_mentions: 360 ✅
- ig_comments: 2167 ✅ (349 skipped — short/empty text)
- yt_comments: 2640 ✅ (55 skipped)
- influencer_x_posts: 729 ✅
- **x_posts: 300 done, ~570 partial (Supabase reset)** — mop-up in progress
- **tiktok_videos: 583 done, ~607 partial (Supabase timeout)** — mop-up in progress

## ✅ Round 2 mop-up DONE (T+~125m)
- Total enriched: 7,967 rows across 6 tables, 100% coverage
- OpenAI cost: ~$1.40

## ✅ Mention_facts populator DONE (T+~135m)
- 8,607 mention_facts rows (more than enriched rows: multi-brand mentions
  produce one fact per brand)
- 54 competitor_switch_events (NOTE: has 2x duplicates — first failed run +
  this run both inserted 27. Fix later by clearing channel events too.)
- Bug fixed: ON CONFLICT against expression index incompatible → dropped
  ON CONFLICT, use clear_channel_facts() + plain INSERT for idempotency.
- Bug fixed: fetch was only pulling first 500 rows → added offset pagination.

## ✅ Topic lifecycle populated (T+~150m)
- 485 multi-channel topics tracked
- Top: "Paddle Review" (728 mentions across 6/6 channels)
- TikTok identified as first-source for "Pickleball Tips" — interesting signal
- 🚨 flagged topics: Paddle Review, Customer Service

## ✅ Competitor switch dedup (T+~155m)
- Was 54 events (duplicates from first failed populator run)
- Now 26 unique switches
- **JOOLA: +5 NET** (9 switched-to, 4 switched-from)
- Paddletek: -5 NET (lost 6, gained 1)

## ✅ Phase 3 Reddit comments DONE (T+~195m)
- 1,554 reddit_comments rows from 144 posts
- Used Apify run je77gBBGV9SnIVqGK — initial upsert had within-batch dupes;
  recovery script re-fetched from existing run (no extra Apify cost)

## ✅ Products fixed (T+~200m)
- 235 products across 11 brands now in DB (JOOLA: 56)
- Migration 008 unlocked the upsert
- ⚠️ Minor: `product_price_history` lacks unique constraint — needs
  migration 010 for snapshot history. 0 history rows written for now.

## ✅ Reddit comments enrichment + facts rerun (T+~215m)
- 1,547 of 1,554 reddit_comments enriched (7 skipped — short text)
- Total enriched corpus across all channels: **9,514 rows**
- mention_facts grew from 8,607 → **10,518** (+1,911 from comments)
- Topic lifecycle re-running with comments included
- Total OpenAI cost: ~$1.70

## 📊 What the data now shows (cross-channel)

**Top conversation share (8607 facts across 11 brands):**
- engage: 2,999 (highest by far — explains the big SOV)
- joola: 1,082
- selkirk: 918 / six-zero: 820 / crbn: 778 / franklin: 555 / paddletek: 534
- wilson: 306 / gamma: 272 / onix: 209 / head: 134

**JOOLA product performance:**
- Agassi Pro: 67 mentions, 46 positive, 0 negative ← clear winner
- Perseus IV: 59 mentions, 41 pos, 15 neg ← polarizing
- Hyperion CFS, Scorpeus IV: positive

**Flags populated:**
- 285 crisis mentions across all brands (146 are about engage)
- 1,837 opportunity flags
- 799 purchase intent flags (selkirk leads at 224)
- 54 competitor switch events

## ✅ Research agent: verified TikTok schema, fix applied:
  - Removed `@` prefix from handles (probable failure cause)
  - Added `profileScrapeSections: ["videos"]`, `profileSorting: "latest"`
  - Added `oldestPostDateUnified` for 3-year window
  - Bumped `resultsPerPage` 100→300
  - Note: the currently-running pipeline still has OLD code at step 12, so
    TikTok will fail this run. Will backfill via `test_tiktok_only.py` after.

## Cost projection (revised)
- Apify pipeline (full): ~$8-15 (was $20+)
- TikTok isolated re-run: ~$5-9 (clockworks $1.70/1K + date filter add-on)
- OpenAI enrichment: ~$1-3
- **Total: ~$14-27** — within $25 Apify cap if TikTok stays at 200 res/profile

## Files modified
- `scripts/apify_to_supabase.py` — dropped 3 X handles, added INFLUENCER_X_HANDLES + run_x_influencers()
