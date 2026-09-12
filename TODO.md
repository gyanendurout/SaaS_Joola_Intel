# TODO — open work

**Pending items only.** When something ships, delete it from this file — the
record lives in `git log`, not here. Do not add "what shipped" write-ups.

Scope split: this file owns *engineering tasks and blockers*.
[BRD.md](BRD.md) §13 owns *production-readiness commitments* (key rotation, RLS,
cron). Don't duplicate across the two.

> Last reviewed 2026-08-24 by a full-repo code audit (see [BRD.md](BRD.md) §17).
> DB-side items re-verified **2026-09-12** by live introspection of all 138
> relations — counts, key coverage and freshness are in
> [docs/DATABASE_REFERENCE.md](docs/DATABASE_REFERENCE.md). Numbers below carry
> their own measurement date; trust the newer one.

---

## Blocking — needs a human (Claude cannot run these)

### ~~0. Apply `migrations/022_schema_gap_repair.sql`~~ — applied 2026-08-24

Verified on the live DB: `ig_comments.post_url`, `mention_facts.engagement` and
`mention_facts.link_url` all exist. The facts pipeline now runs with **no SCHEMA
GAPS block at all** — the first fully clean run.

Backfill done in the same pass:
- `engagement` populated on 8,889 of 46,268 mention_facts (zero elsewhere is
  real — those sources genuinely have no like/upvote count).
- `link_url` populated on 13,033. The channels still at 0
  (`reddit_comment`, `yt_comment`, `tiktok_comment`, `product_review`) have no
  URL column in their source table; that is by design, not a gap.
- `ig_comments.post_url` arrived empty (new column). It did **not** need an
  Apify re-scrape — `post_id` resolves to `ig_posts.post_url`, so all 8,703 rows
  were filled by join via `scripts/backfill_ig_comment_post_url.py` (idempotent;
  a second run reports 0). `scrape_comments.py` already wrote the column, so new
  scrapes populate it without further work.

### ~~1. Apply migration 016 — `product_reviews`~~ — already applied

The table exists on the live DB with **0 rows** (probe, 2026-08-14). Migration
016 is done; the table is empty only because the scraper has no widget
credentials yet — that is item 3 below, which is the real blocker.

### ~~1b. Apply `migrations/023_promotion_daily_brand_grain.sql`~~ — applied 2026-08-24

`promotion_daily` went 0 → **9 rows** and `marts_refresh_helpers` is green for
the first time since migration 013 created the table. All four helper marts now
write: ad_pressure 740, availability 293, promotion 9. `price_daily` still
computes 0, but that is an empty source (`product_price_history`), not a mart bug
— see the sales-estimation item below.

The follow-up documented in the migration file still stands: the
`joola_timeseries_daily` MV joins `pr.product_id IS NOT DISTINCT FROM
att.product_id`, so brand-level promo pressure does not reach product-level MV
rows. That is a promo-attribution decision, not a defect.

### ~~2. Apply migration 017 — `ask_intel_qa_log`~~ — applied 2026-08-24

Table exists and the full feedback loop was round-trip tested against the live
DB: insert returns a `messageId` (which is what unhides the thumbs up/down
buttons), PATCH writes `feedback`, and the `feedback=eq.up` filter used by the
review screen returns the row. Test row deleted; the table is back to 0 rows.

The `localStorage` fallback (`ask_intel_feedback_log`) is now redundant but
harmless — leave it as a degraded-mode path.

### ~~3. Extract per-brand widget credentials for the reviews scraper~~ — superseded 2026-08-24

Solved from a different direction. `paddle_reviews` now holds **22,210 retail
reviews** — gathered retailer-side (Okendo / Judge.me / Yotpo / Bazaarvoice) by a
pipeline that lives **outside this repo** — already enriched, with `brand_id` on
100% of rows and 4.80 average rating across crbn / selkirk / joola / paddletek /
six-zero.

No per-brand `bv_passkey` / `jm_shop_domain` hunt is needed. `product_reviews`
(migration 016) stays at 0 rows and is now effectively dead — the
`product_review` fact channel and Ask Intel both read `paddle_reviews` instead.

**Watch item:** the writer is not in this repo, so nothing here guarantees the
table keeps refreshing. `paddle_review_runs` carries the run telemetry
(`status`, `reviews_new`, `sources_ok`) — wire it into `scripts/db_verify.py`
if this data becomes load-bearing.

### 4. Validate Track B — rating backport for 6 brands

The local Playwright scraper gained rating selectors for
joola / six-zero / onix / franklin / head / wilson (was engage only).

```powershell
python -m backend.scraping.run --module products --restart
```

```sql
select b.slug,
       count(*)                                       as total,
       count(p.avg_rating)                            as has_rating,
       round(100.0 * count(p.avg_rating) / count(*))  as pct_rating,
       count(p.review_count)                          as has_reviews
from products p join brands b on b.id = p.brand_id
where p.category = 'paddle' and p.last_scraped_at >= now() - interval '24 hours'
group by b.slug order by b.slug;
```

Expected fill: joola 60–100%, six-zero 50–90%, onix 30–80% (Bazaarvoice
lazy-render risk), franklin 40–80%, wilson 30–80%, head 0% (no widget —
intentional), engage ~100%.

**Measured 2026-09-12** after a full `--module products` run *and* a
`reviews-crawl4ai` pass (`category = 'paddle'`, all rows):

| brand | paddles | has rating | pct | vs expected |
|---|---|---|---|---|
| paddletek | 24 | 24 | 100% | ✓ |
| six-zero | 23 | 17 | 74% | ✓ in range |
| franklin | 34 | 21 | 62% | ✓ in range |
| crbn | 35 | 17 | 49% | — |
| selkirk | 73 | 30 | 41% | — |
| engage | 21 | 3 | **14%** | ✗ expected ~100% |
| joola | 45 | 5 | **11%** | ✗ expected 60–100% |
| head | 26 | 1 | 4% | ✓ (0% was intentional) |
| onix | 23 | 1 | **4%** | ✗ expected 30–80% |
| gamma | 24 | 0 | **0%** | — |
| wilson | **0** | — | — | ✗ no paddle rows at all |
| **TOTAL** | **328** | **119** | **36%** | |

So the backport is **not** validated: joola, engage and onix all land far below
target, gamma is empty, and wilson has no paddle rows whatsoever (consistent with
the Akamai block noted under Backend / scrapers — its catalog never lands).

Onix confirms the predicted Bazaarvoice lazy-render failure, so apply the remedy
already written here: raise `extra_wait` in `scrape_catalog_local.py`
`BRAND_SCRAPERS` from 8000 → 12000 ms and add a scroll-to-bottom step in
`_scrape_brand`. Joola and engage need diagnosing separately — both have working
widgets on their PDPs, so 11% / 14% points at the selector set, not at timing.

### ~~5. Fix `topic_lifecycle` schema-cache error~~ — closed 2026-08-24

Confirmed a stale PostgREST cache, not a missing column. `022` ended with
`notify pgrst, 'reload schema';` and the next facts run wrote **5,771
topic_lifecycle rows** with no error. Nothing further to do.

### ~~6. Fix `product_aliases` schema mismatch~~ — already fixed

`product_aliases.product_id`, `.alias_norm`, and `.is_ambiguous` all exist on the
live DB (column probe, 2026-08-14) — migration 021 was applied. Nothing to do.

### 8. Un-freeze the three materialized views — `exec_sql` does not exist

Found 2026-09-12. `dim_brand_calendar` and `joola_timeseries_daily` are stuck at
**2026-05-24**, `joola_timeseries_weekly` at **2026-05-18**. Root cause is not a
mart bug: `analytics_backend` issues `REFRESH MATERIALIZED VIEW` through an
`exec_sql(query text)` Postgres RPC that **is defined in no migration and does
not exist in this project** — every call 404s.

All five statistics modules read `joola_timeseries_daily`, so the analytics pages
are worse than stale: today's run wrote 79 fresh `analysis_results` rows stamped
`computed_at = 2026-09-12` that were computed on data ending 2026-05-24. The
Correlations and Changepoints pages look freshly computed and are 16 weeks behind.

Two ways out — **pick one, this needs a human**:

1. Run the refresh by hand in the Supabase SQL editor after each weekly run:
   ```sql
   refresh materialized view dim_brand_calendar;
   refresh materialized view concurrently joola_timeseries_daily;
   refresh materialized view concurrently joola_timeseries_weekly;
   ```
2. Install the RPC once so the pipeline can do it unattended:
   ```sql
   create or replace function exec_sql(query text) returns void
   language plpgsql security definer as $$ begin execute query; end $$;
   ```
   **Read the trade-off first:** this grants arbitrary SQL to any holder of the
   service-role key. That is a privilege decision, not a chore.

Deadline: after roughly **2026-11-20** the statistics modules' 180-day window
stops overlapping the frozen views entirely, and all five switch from returning
stale numbers to returning 0 — silently.

Related decision: `marts/refresh_timeseries.py` and `refresh_calendar.py` now log
`ERROR  STALE MART … NO-OP` instead of a healthy row count, but still **exit 0**.
Deliberately left that way pending this decision — make it hard-fail once the
refresh path works, or the next breakage is invisible again.

### 7. Reinstall `node.exe` on the build host

`npx tsc` is broken there. Current workaround: `bunx tsc --noEmit`.

---

## Engineering punch list

### Frontend

- **Sales Intel actionability** — add an executive-summary card above the four
  sub-tables: top 3 trending up/down, biggest gainers, biggest price drops.
- **Platform takeaway cards** — add a small "Platform takeaway" card at the
  bottom of each of the 5 platform pages: JOOLA position vs top competitor,
  WoW indicator, one-line "what to do".
- **JOOLA visibility consistency** — grep for `=== 'joola'` and confirm the
  styling branch always renders JOOLA's row/dot/bar even when the value is 0.
- **Formatting audit** — revenue in `sales-intel/page.tsx`, dates in
  `changepoints/page.tsx`, prices in `product-intel/page.tsx`.
- **Empty-state coverage** — `sales-intel` and the `product-intel` matrix can
  render blank cards at zero filtered rows. Use the standard
  `<div className="card" style={{ textAlign: 'center', padding: 48 }}>` pattern.
- **Product-level discount filter** on `/v2/campaign-offer-intel` — today only
  sitewide banner discounts are filterable; add a "products on sale" toggle on
  `products.discount_pct > 0`.
- **Strike-through `price → sale_price`** in the product table (currently two
  separate columns).
- **Rating-trend sparkline per product** — needs a `product_rating_history`
  table (separate migration).
- **"Best-rated paddle per brand" KPI strip** on `/v2/product-intel` —
  deferred; the section 7 table columns cover it for now.

### Backend / scrapers

- **News source is on an unlicensed feed.** `scrape_news.py` now reads the
  Google News RSS endpoint, whose copyright notice restricts it to personal,
  non-commercial feed-reader use. It replaced a scraper pointed at the same host,
  so this is not a new exposure — but a commercial BI product should sit on a
  licensed source. Swap `_fetch_query()` for GDELT (free, permissive) or
  NewsAPI/Bing News (paid); everything downstream of that function is
  provider-agnostic. **Decision needed, not an engineering blocker.**
- **`publishedTimeText` is relative-only.** The YouTube comments actor exposes
  "12 hours ago", never an absolute date, so `yt_comments.posted_at` is now
  approximate (month = 30 d, year = 365 d) rather than NULL. Fine for weekly
  bucketing; do not build day-precision analysis on it.
- **Review pagination** — v1 fetches page 1 only, so Boomstik's 2,383 reviews
  cap at ~50. Walk `Offset` (Bazaarvoice) / `page` (Judge.me) until empty in
  `scrape_reviews.py`.
- **9 fabricated seed rows inflate every brand's YouTube subscriber count.**
  Diagnosed precisely 2026-08-18; **left in place at the user's request.**
  Every row in `yt_channel_weekly` with `week_number = 14, year = 2026`
  (`scraped_at = 2026-04-03`) is a hand-seeded placeholder: round subscriber
  numbers and `total_views IS NULL`, which no real scrape produces. They are the
  *earliest* point in the series, so every WoW/growth chart anchored there shows
  a fake ~10× collapse:

  | Brand | Seeded (w14) | Real (w34) |
  |---|---|---|
  | selkirk | 142,000 | ~3,450 |
  | joola | 48,000 | (see w34) |
  | paddletek | 38,000 | |
  | crbn | 31,000 | ~3,450 |
  | six-zero | 22,000 | |
  | engage | 19,000 | ~2,050 |
  | onix | 14,000 | |
  | wilson | 12,000 | |
  | gamma | 7,800 | |

  `total_views IS NULL` is an exact discriminator — it matches these 9 rows and
  nothing else. One-line fix when you want it:
  ```sql
  delete from yt_channel_weekly where total_views is null;  -- 9 rows
  ```
  This was previously filed as "Selkirk subscriber inflation, confirm the
  `@SelkirkSport` handle". The handle is fine — all 9 `yt_channels` rows carry
  correct canonical brand URLs. The channel mapping was never the problem.
- **Franklin + Head have no `yt_channels` row at all** (probe 2026-08-18), so
  the old "Franklin + Wilson point at parent corporate channels" note is stale:
  Wilson now resolves to `@WilsonPickleball`, which is pickleball-specific.
  Nothing to purge; re-verify if YouTube pages show them as empty rather than
  absent.
- **Wilson product catalog** — blocked by Akamai bot manager. Needs a
  residential proxy; no scraper covers it today.
- **5 products never receive review data — URL shadowing.** Found 2026-09-12.
  `scrape_reviews_crawl4ai._scrape_batch` builds `url_to_product` as a dict keyed
  by URL, but 5 of the 200 scraped products share a URL with another product
  (variant query strings: `amped-pro-air-epic…?variant=…`, `dude-perfect-trickshot`,
  CRBN `counter-…`, `joola-perseus-iv-14mm`, CRBN `best-pickleball-eyewear`). The
  dict keeps one product per URL, so the twin is silently never updated while the
  survivor is PATCHed twice. That is also why the module reports 103 writes but
  only 98 distinct rows change — the count is PATCH calls, not rows. Key the map
  by product id and fan results out to every product sharing that URL.
- **`ad_payload.writable_columns()` has never run.** It calls
  `sb.get(table, "*", {"limit": "1"})`, which PostgREST renders as `?limit=eq.1`
  — `limit` is a reserved integer param, so the request 400s, a bare
  `except Exception` swallows it, and the function returns an empty set. That
  makes `restrict()` a permanent no-op, so the documented safety net ("drop
  unknown columns so an unapplied migration cannot lose a week of ads") has never
  once fired. Pass the limit as a real param, or drop the helper and admit the
  guard does not exist.
- **Delete the union-fill workaround in `scrape_inventory_crawl4ai.py:412-417`.**
  It pre-dates `_uniform_batches()` and solves the same ragged-key problem the
  wrong way: it fills missing keys with `None`, which under
  `Prefer: resolution=merge-duplicates` becomes `SET col = excluded.col` and
  blanks previously-captured values, and on insert overrides column DEFAULTs. The
  shared client now groups rows by key set, so the local workaround is redundant.
  Give the three row literals one shared shape and remove it. (Audited
  2026-09-12: today's 8,370 new snapshots have a NULL profile identical to the
  pre-run rows, so nothing is currently corrupted — this is latent, not active.)
- **Six unique INDEXes cannot be used as `on_conflict` targets.** PostgREST
  accepts only unique *constraints*. Affects `promotions`, `marketing_ads`,
  `influencer_x_snapshots`, `mention_facts` and two on `competitor_switch` —
  any upsert naming those keys fails at the edge. Convert each to
  `alter table … add constraint … unique (…)`.

### Data quality

- **45 → 42 player roster discrepancy** in `frontend/lib/v2/playerRoster.ts` —
  the Set dedupes 3 multi-brand players (Parris Todd, Riley Newman, Steve
  Deakin). If the business expects a 43rd, identify and add it.
- **Six-zero AUD pricing** — rows carry `price_usd = NULL`, `currency = 'AUD'`,
  so six-zero is absent from price-tier analysis. Add FX conversion or a
  `price_aud` column.
- **42,258 of 46,428 `product_snapshots` rows have no `product_id`** (91%;
  re-measured 2026-09-12 — was 33,742 on 2026-08-18, so the gap is *growing* with
  every run, not shrinking: the 8,370 snapshots written on 2026-09-12 were 98%
  unlinked). 40,684 also lack `variant_id`. They cannot be keyed at product grain
  and `availability_daily` skips them —
  that mart went 0 → 359 rows once the skip was added, because a single NULL was
  killing the entire 452-row batch. This is the same root cause as the sales
  estimation chain below; fixing the snapshot → variant link is the shared
  upstream work and would grow this mart by roughly two orders of magnitude.
- **`price_daily` computes 0 rows** — "nothing to upsert" on every run. Its source
  (`product_price_history`) has never been populated; see the sales-estimation
  item below. Not a mart bug.
- **Sales estimation chain is broken** (diagnosed 2026-07-11, unresolved):
  only 4 of ~29.5K `product_snapshots` carry `visible_inventory_qty`; only
  ~3.9K are variant-linked; snapshot cadence is batch, not daily; `estimate.py`
  has a hard `limit=5000`; `product_reviews` and `product_price_history` have
  never been populated. Highest-leverage fix is review velocity — see blocking
  items 1 and 3.

---

## From the 2026-08-24 code audit

Raised by auditing the working tree against [BRD.md](BRD.md). Requirements and
scope decisions live in the BRD sections named below; the work is here.

### Security — unmet requirements (BRD §12.1)

- **`NEXT_PUBLIC_OPENAI_KEY` still wins over the server key in two agents.**
  `frontend/lib/shared/content-brief/agent.ts:103` and
  `frontend/lib/shared/keyword-research/agent.ts:152` both resolve
  `process.env.NEXT_PUBLIC_OPENAI_KEY ?? process.env.OPENAI_API_KEY` — public
  name first. `frontend/app/api/generate-content/route.ts:10` reads the public
  name only. `app/api/v2/ask-intel/route.ts` has the correct shape (server key
  preferred, warn on fallback); copy it. Then drop `NEXT_PUBLIC_OPENAI_KEY`
  from Vercel. The `NEXT_PUBLIC_` prefix means the value is inlined into any
  client bundle that references it, so the name is the hazard even where the
  current reader is server-side.
- **SSRF on `POST /api/seo-analyzer`.** `frontend/app/api/seo-analyzer/route.ts`
  validates only that the protocol is `http:`/`https:`, then
  `lib/shared/seo-analyzer/analyzer.ts:439` fetches it with a 15 s timeout — no
  host allowlist, no private-range or loopback block, no redirect ceiling, no
  auth. Either gate it (allowlist, or block RFC1918 + link-local + metadata
  endpoints and cap redirects) or delete the route with the rest of the §4.1
  surface.
- **No authentication anywhere.** No `middleware.ts`; no session check on any
  page or API route. Every page and endpoint on the public Vercel URL is open.
  Needs an access-control decision before this is used as a board/CFO surface.

### Scope decisions needed (BRD §4.1, §10.10)

- **Four orphaned generative API routes.** `keyword-research`, `content-brief`,
  `generate-content`, `seo-analyzer` are called by no page, component, or test —
  only reachable by POSTing the deployed domain. Matching `seo` pipeline module
  (`backend/scraping/sources/seo/scrape_seo.py`) writes tables no frontend
  reads. Spec them as a second product surface or delete both ends.
- **Seven unlinked legacy routes.** `/v2/ads`, `/v2/comments`, `/v2/crisis`,
  `/v2/leaderboard`, `/v2/products`, `/v2/products-intel`, `/v2/promotions`
  ship and are QA-covered but have no sidebar or command-palette entry. Keep as
  deep-link legacy or delete, together with their entries in
  `frontend/constants/routes.ts`, `qa/regression.ps1`, `qa/tooltip-check.mjs`,
  and `e2e/smoke.spec.ts`.
- **`news_articles` is a dead end.** 923 rows scraped weekly, but it is not a
  `mention_facts` channel, is absent from `lib/v2/askIntel/schema.ts`, and no
  page reads it. Wire it in as a 10th fact channel or stop scraping it. (The
  licensing question on the Google News RSS feed, below, only matters if it
  stays.)

### Correctness

- **Franklin renders under its DB name on three pages.** `pgName()` applies the
  `BRAND_DISPLAY_OVERRIDES` map, but `lib/v2/productIntel.ts:682,980` and
  `lib/v2/campaignOfferIntel.ts:487,606,639` build a `brandName` field straight
  from `brands.name` (`nameByBid[...]` / `nameBySlug[...]` / `b.name`), and
  Product Intel, Sales Intel and Campaign & Offer Intel render that field
  directly. Route those builders through `displayBrandName(slug, name)` so the
  Franklin → Franklin Pickleball override applies everywhere. BRD §10.8.
- **Data Health probes a dead table and misses the live ones.**
  `app/v2/data-health/page.tsx` `TABLES` includes `product_reviews` (0 rows,
  superseded) but omits `paddle_reviews` (22k rows, now a fact channel),
  `paddle_review_runs` (the only refresh telemetry for a dataset written
  outside this repo), and the three helper marts that were silently dead for
  three months — `availability_daily`, `promotion_daily`, `ad_pressure_daily`.
- **`ER_MIN_FOLLOWERS` is a magic number in two files.**
  `app/v2/overview/page.tsx:151,187,195` and `lib/v2/playbook.ts:115` hardcode
  `50` instead of importing the constant that `instagram/page.tsx` and
  `market/page.tsx` define. Same value today, so this is drift risk, not a bug.

---

## Watch list — known soft spots

- **Apify `streamers/youtube-comments-scraper`** intermittently returns FAILED
  runs. Retries handle it; 2+ consecutive failures means check the Apify console.
- **Bazaarvoice widgets lazy-render** for 5–10 s. The scraper waits 8000 ms for
  onix/wilson; raise it if a page change extends the delay.
- **OpenAI `gpt-4o-mini` rate limits** — the pipeline runs 8 concurrent workers
  (`ENRICH_WORKERS=8`). Tier-1 caps at 500 RPM: comfortable now, would throttle
  a 10× scale-up.
- **PostgREST schema cache** — after any migration adding columns that existing
  code references, run `notify pgrst, 'reload schema';` or expect PGRST204.
- **Schema-gap handling (read + write).** `core/supabase_client.py` degrades on a
  column the live DB lacks rather than losing the batch, and reports both kinds
  in the end-of-run SCHEMA GAPS block:
  - *write* (PGRST204): `_strip_missing_column()` drops the key and retries, so
    the rest of the row lands. Recorded in `SCHEMA_GAPS`.
  - *read* (42703): `_strip_missing_select_column()` drops the column from the
    select and retries. Recorded in `SCHEMA_GAPS_READ`. Only fires when the
    column is actually in the select list — a 42703 from an `order=` or filter
    clause still raises, by design.

  A read gap is **as likely to be a stale column NAME in the caller as a missing
  migration** — that is what it turned out to be for 4 of the 5 dead
  `mention_facts` channels. Check the real schema before reaching for a migration.
- **A write that lands nothing now raises.** `sb.upsert()` / `sb.insert()` call
  `_assert_wrote_something()`: non-empty input plus zero rows written is a hard
  error, and a partial failure logs `N of M rows written … this run is
  INCOMPLETE`. This is the "scraped N, wrote 0" guard, placed in the client where
  the row counts exist rather than in `run.py`. `scrape_news.py` and
  `scrape_comments.py` additionally assert at the module level (fetched > 0 but
  built 0 rows means a field rename upstream). The guard lives in `upsert()` /
  `insert()` only — **a module writing via `sb.patch()` must assert for itself**
  (`scrape_reviews_crawl4ai` does), or zero successful writes returns a cheerful 0.
- **Runner exit codes are a contract, not cosmetic.** `backend/scraping/run.py`
  exports `EXIT_OK = 0`, `EXIT_CANNOT_RUN = 1`, `EXIT_PARTIAL = 2`, and
  `scripts/weekly_run.py` branches on them: `1` (credential check failed, nothing
  ran) aborts the whole weekly run, `2` (ran, some steps failed or write columns
  were stripped) **continues to the analytics phase** and returns 2 at the end.
  The distinction matters — the modules that succeeded did write their rows, so a
  flat `1` would let one blocked brand throw away the entire analytics phase. Do
  not collapse these to a single non-zero value; pinned by
  `backend/tests/test_runner_exit_code.py`.
- **A partial-column update must never be expressed as an upsert.** `products`
  requires `name` (NOT NULL, no default — verified against PostgREST's OpenAPI,
  since `products` DDL is not in `migrations/`), and Postgres validates the
  proposed insert tuple *before* `ON CONFLICT` arbitration, so a payload missing
  `name` dies with `23502` and takes the whole batch with it. Use `sb.patch()`.
  Adding `name` to an upsert payload is not the fix either: rows read via SELECT
  would resurrect any product the dedup job (`migrations/008`,
  `products_dupe_archive`) deleted in the meantime as a name-only zombie.
- **`mention_facts._clear_channel_facts(channel)`** deletes the whole channel
  before re-insert. Re-runs are safe, but the frontend sees a transient gap
  during the DELETE → INSERT window.
- **Checkpoint files** at `C:\Workspace\pipeline_v2_state*` sometimes raise
  `FileExistsError` on `--restart`. Delete them manually and retry.
- **Ask Intel v1 limits** — table/select/filter/groupBy/orderBy only; no
  arbitrary joins beyond `schema.ts` join hints; no CTEs. A v2 would need an
  `exec_safe_sql` stored proc behind an explicit read-only role.
- **Topic Lifecycle and Brand Reply Advantage sections render empty** until
  blocking item 5 is fixed and `detect_brand_replies.py` is wired into the
  weekly scheduler.
- **Athlete impact follower growth** uses `influencer_x_snapshots` only — IG and
  YouTube growth are not snapshotted week over week.

---

## Command reference

```powershell
# Full weekly pipeline
rm -f C:\Workspace\pipeline_v2_state.prev C:\Workspace\pipeline_v2_state.json
python -m backend.scraping.run --module all --restart

# Enrichment + facts only (idempotent re-run after a manual fix)
python -m backend.scraping.run --module enrichment
python -m backend.scraping.run --module facts

# Analytics rollup (marts + statistics)
python -m analytics_backend.run --module all

# Brand-scoped smoke tests
python -m backend.scraping.run --module youtube --brands joola --restart
python -m backend.scraping.run --module tiktok --brands selkirk --restart

# Pipeline health check (prints per-table remediation commands)
python scripts/db_verify.py

# Frontend
cd frontend; npx tsc --noEmit; npm run dev
```

Load `.env` into a PowerShell session:
```powershell
Get-Content c:\Workspace\joola-intel-nextjs\.env | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') { Set-Item -Path "env:$($matches[1].Trim())" -Value $matches[2].Trim() }
}
```

## Product Intel rebuild — follow-ups (2026-08-26)

- [ ] **Franklin is blocked in every module, and crawl4ai does NOT fix it.**
      The earlier suggestion here — "point crawl4ai/Playwright at
      `franklinsports.com`, both already run in this repo for reviews" — was
      tested on 2026-09-12 and **does not work**. crawl4ai hit
      `Blocked by anti-bot protection: Cloudflare JS challenge` on every Franklin
      PDP, in both the Phase-4 inventory crawl and the reviews crawl (23 of 23
      failures on that host; zero failures on any other brand). So Franklin is
      systematically thinner than the other ten brands across specs, inventory
      and reviews — not one missing page. A real fix needs a challenge-solving
      path (residential proxy, or a service that executes the JS challenge), the
      same class of problem as the Wilson/Akamai item. Its parser remains
      UNVERIFIED — the only brand with no fixture.
- [ ] **Selkirk price coverage is 2/10 on the ranked paddles** (24% overall).
      Selkirk is served by the Apify catalog scraper, not the local one.
- [ ] **Replace the manual FX rate.** `fx_rates` holds a hand-seeded
      AUD→USD 0.66 from migration 025. Needs a real feed with a date.
- [ ] **Shopify geo-pricing.** Prices now come from `/products.json`, which is
      IP-independent, but the DOM fallback still exists for non-Shopify brands.
      Running the catalog crawl from a non-US egress will mislabel those.
- [ ] **Customer Voice sentiment renders "0% pos · 0 neg"** on some rows in the
      retained §7. Pre-existing in `fetchCustomerVoice`; not touched by the
      Product Intel rebuild.
- [ ] **`family_key` lives in two languages.** Parity is enforced by
      `backend/tests/test_family_parity.py`, which needs node + the frontend's
      `tsc`. It SKIPS rather than fails when the toolchain is missing — make
      sure CI has node, or the guard is silently inactive.

## QA gate defects found while shipping this work (2026-08-26)

`frontend/qa/regression.ps1` writes `c:\tmp\joola-intel-qa-passed.flag`, and that
flag is what `.husky/pre-push` and `scripts/deploy.ps1` read as permission to
ship. Two bugs make the gate weaker than it looks:

- [x] **A skipped stage counts as a pass.** Fixed 2026-08-26: incidental skips
      (no dev server, tool missing) now withhold the flag and exit 1; only the
      explicit `-Skip*` switches stay green. Reachability probe raised 5s->30s. Routes, Playwright and tooltips all
      SKIP when the dev server does not answer a `HEAD` within 5s — and the run
      still reports PASS and still writes the flag. A cold Next dev server takes
      ~43s to compile the first route, so on any fresh machine the deploy gate
      degrades to "`tsc` succeeded" without saying so. Either SKIP on
      routes/E2E should withhold the flag, or it should require an explicit
      opt-out switch (`-SkipPlaywright` is already the honest way to ask).
- [x] **`2>&1` on native commands aborts the run under PowerShell 5.1.** Fixed
      2026-08-26: native calls go through an `Invoke-Native` helper that drops
      `$ErrorActionPreference` to Continue and judges only `$LASTEXITCODE`. With
      `$ErrorActionPreference = 'Stop'`, `& npx playwright test … 2>&1` turns
      each stderr line into an ErrorRecord and throws. A harmless node notice
      ("The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set")
      killed the run before the playwright result was ever recorded. Drop the
      `2>&1` on the native calls, or wrap them so only `$LASTEXITCODE` decides.
