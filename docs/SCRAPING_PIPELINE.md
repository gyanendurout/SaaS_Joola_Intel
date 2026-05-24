# 03 — Scraping Pipeline

> **Goal.** Run the Python pipeline end-to-end. Each weekly run pulls raw data from 10 Apify actors across 13 pipeline steps and writes to Supabase.

---

## Quick start

```bash
cd c:\Workspace\joola-intel-nextjs
pip install python-dotenv requests        # one-time
python scripts/pipeline/apify_to_supabase.py       # full weekly run, ~30–90 min
```

Output appears at the console and is also redirected to `resumable_run.log` / `pipeline_run_6mo.log` in some workflows.

---

## Required environment

Create `scripts/.env` (gitignored). Never commit. Never paste into chat.

| Variable | Source | Notes |
|---|---|---|
| `SUPABASE_URL` | Supabase project settings | e.g. `https://loecyghnkkxyymelgexz.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings → API → `service_role` | server-only, full write access |
| `APIFY_TOKEN` | Apify dashboard → Account → Integrations | needs sufficient credit for all 10 actors |
| `OPENAI_API_KEY` | OpenAI dashboard | used by enrichment, not by the scraper itself; can also be `NEXT_PUBLIC_OPENAI_KEY` as fallback |

A safe template lives in `scripts/.env.example` — copy and fill in.

The pipeline tolerates `~40 min of network outage` per request (80 retries × 30 s wait — see `http_request()` in `apify_to_supabase.py`).

---

## The 13 pipeline steps

`apify_to_supabase.py::main()` runs these in order, each wrapped in `_safe_step()` so one failure doesn't abort the rest:

| # | Step | Actor | Writes to | Approx cost / run |
|---|---|---|---|---|
| 1 | `instagram` | `apify/instagram-profile-scraper` | `ig_profiles_weekly`, `ig_posts` | $ |
| 2 | `youtube` | `streamers/youtube-scraper` | `yt_channels`, `yt_videos` | $ |
| 3 | `reddit` | `trudax/reddit-scraper-lite` (×2 runs: brand-sub OPs + cross-sub mentions) | `reddit_mentions` | $$ |
| 4 | `products` | `apify/playwright-scraper` | `products`, `product_price_history` | $$ |
| 5 | `influencers` | `apify/instagram-profile-scraper` | `influencer_posts`, athlete snapshots | $$ |
| 6 | `homepage_promos` | `apify/playwright-scraper` | `promotions` | $ |
| 7 | `meta_ads` | `apify/facebook-ads-scraper` | `marketing_ads` (platform=meta) | $$$ |
| 8 | `google_ads` | `solidcode/ads-transparency-scraper` | `marketing_ads` (platform=google) | $ |
| 9 | `ig_comments` | `apify/instagram-comment-scraper` | `ig_comments` | $$ |
| 10 | `yt_comments` | `streamers/youtube-comments-scraper` | `yt_comments` | $$ |
| 11 | `x_twitter` | `apidojo/twitter-scraper-lite` | `x_profiles_weekly`, `x_posts` | $$ |
| 12 | `tiktok` | `clockworks/tiktok-scraper` | `tiktok_profiles_weekly`, `tiktok_videos` | $$ |
| 13 | `x_influencers` | `apidojo/twitter-scraper-lite` | `influencer_x_snapshots`, `influencer_x_posts` | $$ |

**Total per full weekly run:** roughly **$5–$20 USD on Apify** depending on volume; varies most with Meta Ad Library (large pages) and Reddit (long threads). Track in the Apify dashboard.

Reddit **comments** (replies under OPs) are scraped by the separate `scripts/pipeline/scrape_reddit_comments.py` because they require a per-post pass — not part of the 13-step main pipeline.

---

## Pipeline shape (per step)

Each `run_*()` function in `apify_to_supabase.py` follows the same shape:

1. **`run_actor(actor_id, input_data)`** — POSTs to `apify.com/v2/acts/{id}/runs` with the actor's input JSON; returns the run ID.
2. **`wait_for_run(run_id)`** — polls every 15 s until `SUCCEEDED` / `FAILED` / `TIMED-OUT` / `ABORTED`.
3. **`fetch_results(run_id)`** — pulls the dataset items as JSON.
4. **Per-row normalize** — pluck the fields the schema needs, attach `brand_id` via the brand-keyword matcher.
5. **`sb_upsert(table, rows, on_conflict=…)`** — POST to Supabase REST with `Prefer: resolution=merge-duplicates`, batches of 500.

### Brand attribution

For Reddit, ad copy, and free-text content, `match_brands(text)` walks `BRAND_KEYWORDS` (lowercased) and returns all matched slugs. For per-channel scrapes (Instagram, YouTube, X, TikTok), the brand is determined by the seeded handle map (`ig_account_map`, `yt_channel_map`, etc.).

For products, brand attribution uses a **triple-fallback**: (a) handle map, (b) source URL host match, (c) keyword match on title/description.

---

## Helpers in the pipeline file

| Function | Job |
|---|---|
| `week_start()` | Returns Monday of the current week as `YYYY-MM-DD`. |
| `http_request(method, url, **kw)` | Wraps `requests.request` with 80-retry / 30 s backoff for connection errors + timeouts. |
| `match_brands(text)` | Maps a free-text string to a list of brand slugs. |
| `ad_library_url(query)` | Builds a Meta Ad Library search URL for a brand. |
| `load_brand_map()` / `load_ig_account_map()` / `load_yt_channel_map()` / `load_influencer_map()` | Pulls lookup tables from Supabase at the start of `main()`. |
| `sb_get`, `sb_upsert` | Supabase REST wrappers. |
| `_safe_step(label, fn, *args)` | Runs a single pipeline step; catches+logs exceptions and continues. **This is why one bad actor doesn't kill the whole run.** |

---

## Supporting scripts

| Script | When to use |
|---|---|
| `run_resumable.py` | Top-level resumable runner. Restores state from `pipeline_state.json` so a crashed run resumes. |
| `resume_pipeline.py` | Manual resume helper. |
| `fix_missing_data.py` | Re-scrape only the channels that came up empty last week. Reads + writes `pipeline_state.json`. |
| `scrape_may15.py` | Historical one-shot scrape used during initial population. Reference only. |
| `count_rows.py` | Prints row counts per table — useful after a run to sanity-check yields. |
| `test_products_only.py` | Runs **only** `run_products()`. Used after migration `008` cleaned dup product names. |
| `test_tiktok_only.py` | Runs only the TikTok step. |
| `scrape_reddit_comments.py` | Pulls **replies** under OPs that already exist in `reddit_mentions`. Populates the `reddit_comments` table from migration `009`. |
| `reddit_comments_recover.py` | Recovery helper for comments. |
| `enrich_with_ai.py` | See `04_AI_ENRICHMENT.md`. |
| `populate_mention_facts.py` | See `04_AI_ENRICHMENT.md`. |
| `populate_topic_lifecycle.py` | See `04_AI_ENRICHMENT.md`. |

---

## Apify actor input notes

Inputs are inlined in each `run_*()` function. A few non-obvious ones:

- **`apify/instagram-profile-scraper`** — pass `usernames: [list]` (NOT URLs), `resultsType: "posts"` for posts, `resultsLimit` per username.
- **`streamers/youtube-scraper`** — passes `startUrls` with each brand's channel URL; harvests channel-level + recent videos.
- **`trudax/reddit-scraper-lite`** — two distinct runs:
  - Run A: `startUrls = brand subreddits` (e.g. `r/JOOLA`, `r/Selkirk`)
  - Run B: cross-subreddit `searches = ["joola", "selkirk", …]`
- **`apify/playwright-scraper`** — used for both promos and product scrape; takes `startUrls` + a `pageFunction` per use case.
- **`apify/facebook-ads-scraper`** — accepts a `urls` list of Ad Library search URLs (built by `ad_library_url(brand_name)`).
- **`solidcode/ads-transparency-scraper`** — Google Ads transparency search; query per brand.
- **`apidojo/twitter-scraper-lite`** — pass `searchTerms = ["from:joolapickleball", …]` + `tweetLanguage`, `maxItems`.
- **`clockworks/tiktok-scraper`** — pass `profiles = [handle, …]`, `resultsPerPage`. Verified against the actor's schema in `apify_to_supabase.py:1252`.

---

## Common per-actor failures

| Symptom | Likely cause | Fix |
|---|---|---|
| Actor `FAILED` immediately | Token has no credit, or actor input schema changed | Top up Apify, or re-check the actor's input schema on apify.com |
| Actor `SUCCEEDED` with 0 items | Handle changed (account renamed/deleted) | Update the seed in the relevant migration / DB row |
| `42P10 no unique constraint` on upsert | Schema missing a unique index for that `on_conflict` tuple | Add a migration following `004` / `008` pattern. See `08_RUNBOOK.md`. |
| ChunkedEncodingError, ConnectionError | Network outage | The `http_request()` wrapper retries 80×30 s automatically. If it still fails, just rerun the step. |
| Reddit "video link" rows | Reddit returns post stubs with no text | Filtered out by `content_text` length check in `run_reddit()`. |

---

## What this pipeline does **not** do

- It does **not** scrape **real-time** — weekly only.
- It does **not** enforce idempotency at the row level beyond `on_conflict` upserts. Re-running the same week is generally safe but may re-insert ad rows if the actor returns new `ad_id`s.
- It does **not** delete stale rows. Old data accumulates forever. Add a retention job if Supabase storage becomes a concern.
- It does **not** dedupe across channels. That's `populate_mention_facts.py`'s job (see `04_AI_ENRICHMENT.md`).
