# JOOLA Intel — May 15, 2026 Scrape Progress

**Last updated:** 2026-05-15 04:27 (auto-updated by loop monitor)
**Background task ID:** `b44j73kcj` — **COMPLETED at 03:37:50**
**Script:** `scripts/pipeline/scrape_may15.py`
**Started:** 03:13:06 | **Finished:** 03:37:50

---

## Scrape Steps — scrape_may15.py

| Step | Name | Status | Apify Run ID | Result |
|------|------|--------|-------------|--------|
| 1/8 | IG Brand Profiles | ✅ DONE | `bLckvwxm1JhSYfnjf` | 11 brands — fixed via fix_missing_data.py |
| 2/8 | IG Influencer Profiles | ✅ DONE | `SxCkLTzWCaht3fq6W` | 27 snapshots, 132 posts — fixed via fix script |
| 3/8 | YouTube Channels | ⚠️ PARTIAL | `B1EnVivVYopVhjUwm` | 1/11 channels stored (fix script limitation) |
| 4/8 | Reddit Mentions | ✅ DONE | `AIohhW4DUhuPo0MxN` + `vUPBUQAfpsctmyZiB` | 380 rows in DB (already populated) |
| 5/8 | Promo Banners | ✅ DONE | `4Ut0M8V8kjK5c3mMm` | 28 promotions in DB |
| 6/8 | Meta Ads | ✅ DONE | — | 735 ads in DB |
| 7/8 | IG Comments | ✅ DONE | — | 2,099 comments in DB |
| 8/8 | YT Comments | ✅ DONE | — | 1,617 comments in DB |

---

## Fix Script — fix_missing_data.py

**Status:** ✅ COMPLETED at 04:27:39 on 2026-05-15

**Results:**
- [A] ig_profiles_weekly: ✅ 11 brand snapshots inserted (week 20/2026)
- [B] ig_posts: ✅ 120 brand posts stored
- [C] influencer_snapshots: ✅ 27 inserted | influencer_posts: ✅ 132 stored
- [D] yt_channel_weekly: ⚠️ Only 1/11 channels — Apify returned 269 items but matched 1 channel
- [E] reddit_mentions: ✅ 380 rows already in DB (no duplicates inserted)
- [F] influencer follower counts: ✅ 27 synced

---

## Final DB State — 2026-05-15 04:27

| Table | Rows | Status |
|-------|------|--------|
| brands | 11 | ✅ |
| ig_accounts | 11 | ✅ |
| ig_profiles_weekly | 21 | ✅ (10 prior + 11 new week 20) |
| ig_posts | 254 | ✅ |
| ig_comments | 2,099 | ✅ |
| yt_channels | 11 | ✅ |
| yt_channel_weekly | 12 | ⚠️ (should be ~22) |
| yt_videos | 391 | ✅ |
| yt_comments | 1,617 | ✅ |
| reddit_mentions | 380 | ✅ |
| products | 238 | ✅ |
| influencers | 27 | ✅ |
| influencer_posts | 462 | ✅ |
| influencer_snapshots | 27 | ✅ |
| promotions | 28 | ✅ |
| marketing_ads | 735 | ✅ |

---

## Outstanding Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| yt_channel_weekly only 12 rows | Medium | Apify YT run returned 269 items but fix script only matched 1 channel — may need to re-run YT scrape or inspect run output format |
| Jay Devilliers 78 followers | Low | Handle `@jaydevilliers` likely wrong — verify correct IG handle |
| Bobbi Oshiro 5,753 vs DB 28,000 | Low | Handle may have changed or wrong account scraped |
| 15 influencers show 0 followers | Medium | Accounts not found — private/deactivated or wrong handles |
| ig_comments shows 1,000 in fix report vs 2,099 in count_rows | Low | Likely truncated in fix script report — count_rows is authoritative |

---

## Key Influencer Data (week 20/2026)

| Athlete | Handle | Followers | Notes |
|---------|--------|-----------|-------|
| Anna Leigh Waters | `@anna.leigh.waters` | 207,261 | ✅ Corrected |
| Ben Johns | `@benjohns_pb` | 175,785 | ✅ Corrected |
| Tyson McGuffin | `@tysonmcguffin` | 114,735 | ✅ |
| Anna Bright | `@annabright.pb` | 111,788 | ✅ Corrected |
| James Ignatowich | — | 35,009 | ✅ |
| Roscoe Bellamy | — | 35,663 | ✅ |
| Riley Newman | — | 27,480 | ✅ |
| Sarah Ansboury | — | 8,070 | ✅ |
| Jay Devilliers | `@jaydevilliers` | 78 | ⚠️ Suspicious |
| Bobbi Oshiro | `@bobbioshiro` | 5,753 | ⚠️ Mismatch |
| Catherine Parenteau | — | 158 | ⚠️ Very low |
| 16 others | — | 0 | ⚠️ Not matched |

---

## Files Modified This Session

| File | Change |
|------|--------|
| `scripts/pipeline/apify_to_supabase.py` | Added `sb_delete_insert_weekly()` — fixes 42P10 for future runs |
| `scripts/pipeline/scrape_may15.py` | Full May 15 scrape pipeline (8 steps) |
| `scripts/pipeline/fix_missing_data.py` | Data recovery for steps 1–4 that hit 42P10 |
| `scripts/SCRAPE_PROGRESS.md` | This file — persistent progress tracker |

---

*All scrape steps done. fix_missing_data.py completed. Loop stopped — no further monitoring needed.*
