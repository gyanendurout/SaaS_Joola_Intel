# JOOLA Intel — Pending Work

Pending action items only. Historical completed work has been removed (see
`git log` for past changes). Update this file by **removing** items as they
complete and **adding** new pending items as they're discovered.

---

## In-flight: Correlations/Changepoints sections + Data Health page + feedback localStorage fallback (2026-05-25)

- Appended "Leading Indicator Board" + "Action Translation" sections to `/v2/correlations`.
- Appended "Competitor Signal Detector" section to `/v2/changepoints`.
- Added new `/v2/data-health` page that probes 17 important tables for freshness.
- Added Data Health entry to Analytics sidebar group.
- Updated `ChatMessage.tsx` feedback widget to always render and write to `localStorage.ask_intel_feedback_log` as a fallback when migration 017 isn't applied.

---

## Ask Intel test harness + UUID resolution + feedback system (2026-05-25)

### What shipped
- **UUID resolution layer** in `frontend/app/api/v2/ask-intel/route.ts` —
  `resolveNameToUuidFilters()` runs after `autoCorrectAliases` and before
  `executePlan`. For any filter on `brand_id` / `product_id` / `athlete_id` /
  `influencer_id` whose value isn't already a UUID, it looks up:
  - `brand_id`   → `brands.slug` then `brands.name` (case-insensitive)
  - `product_id` → `products_catalog.display_name`, then `aliases[]` (case-insensitive)
  - `athlete_id`/`influencer_id` → `influencers.name` (case-insensitive)
  Single match → eq UUID. Multiple → in [uuid1, uuid2]. No match → graceful
  degradation to `text_snippet ilike '%name%'` (when the table has that
  column) plus a warning in the response.
  Fixes the user-reported "invalid input syntax for type uuid: 'Pro V Kosmos'"
  error.

- **Strengthened planner prompt** with explicit "NEVER place a product name
  into a filter value when the column is `_id` — executor auto-resolves",
  and an explicit out-of-scope / future-data / read-only / ambiguous-query
  rubric so empty / "weather" / "delete all data" / "best brand?" type
  questions get clean clarifications instead of 500s.

- **QA logging**: every Q&A turn (success, clarification, validation error,
  Supabase error) writes one row to `ask_intel_qa_log` via the new
  `logQaTurn()` helper. The route returns `messageId` on the response so
  the frontend can patch feedback later. Insert failures are silent (warn
  log only) so the API still works pre-migration.

- **Migration 017**: `migrations/017_ask_intel_feedback.sql` creates the
  `ask_intel_qa_log` table (question, answer_summary, visuals_count,
  data_sources, feedback up/down/none, feedback_notes, user_followup,
  latency_ms, confidence, warnings, error_message, created_at) plus three
  indexes (created_at desc, feedback, session_id+created_at).

- **Feedback API**:
  - `POST /api/v2/ask-intel/feedback` — `{ messageId, feedback: 'up'|'down', notes?, userFollowup? }` patches the log row.
  - `GET  /api/v2/ask-intel/feedback?feedback=down&limit=50` — internal
    debug query for the admin page.

- **Thumbs-up/down UI** in `frontend/components/v2/askIntel/ChatMessage.tsx`
  — `<FeedbackButtons messageId>` renders only on AI messages with a server
  id. Click → POST to /feedback → state flips to "Thanks — logged" with a
  green tint. Hidden entirely when `messageId` is null (e.g. before
  migration 017 is applied) so the UI doesn't render a useless widget.

- **Admin debug page** at `/v2/ask-intel/feedback` lists the last 50 turns
  with feedback / question / latency / confidence / visuals + expandable
  per-row details (answer summary, data sources, warnings, feedback notes,
  user follow-up, session id). Filter by 👍 / 👎 / no-feedback / all.

- **Conversation memory verified**: `page.tsx` already sends
  `history: turns.slice(-6).map(...)` on each request, and the route
  forwards it to the planner via `historyMessages`. The chain tests
  (cases 26-29) exercise it end-to-end.

- **Test harness** at `scripts/test_ask_intel.py` — 29 questions covering
  positive, negative/edge-case, and 2 multi-turn conversation chains.
  Reads `ASK_INTEL_BASE_URL` env var (defaults to http://localhost:3000),
  writes per-question results to `c:\tmp\ask_intel_test_results.json` with
  status (success/clarification/error/network_error), latency, visual
  count, warnings, message_id, and a 240-char answer preview. Handles
  conn-refused gracefully with exit code 2.

### USER ACTIONS pending
1. **Apply migration 017** — paste `migrations/017_ask_intel_feedback.sql`
   into the [Supabase SQL editor](https://supabase.com/dashboard/project/loecyghnkkxyymelgexz/sql)
   and click Run. Without this the API still works but `messageId` will
   always be null and the thumbs-up/down buttons stay hidden.
2. **Run the test harness** once the dev server is up:
   ```powershell
   # Terminal 1
   cd c:\Workspace\joola-intel-nextjs\frontend
   npm run dev

   # Terminal 2
   cd c:\Workspace\joola-intel-nextjs
   python scripts\test_ask_intel.py
   # → results in c:\tmp\ask_intel_test_results.json
   ```
3. **Skim 👎 rows** at `/v2/ask-intel/feedback` once real users start using
   the app — every down vote is a planner-prompt iteration opportunity.

### How feedback flows
```
user clicks 👎  →  POST /api/v2/ask-intel/feedback  →  UPDATE ask_intel_qa_log
                                                                  ↓
admin opens /v2/ask-intel/feedback  →  GET /api/v2/ask-intel/feedback?feedback=down
                                                                  ↓
                                                       table renders 👎 rows
                                                       with full context for
                                                       prompt iteration
```

### Cost note
Every Q&A turn now writes 1 row to `ask_intel_qa_log` (~negligible Supabase
cost — small text payload, no JSONB). Service-role insert; no RLS surface.

---

## USER ACTIONS (blocking — Claude cannot run these)

### 1. Apply migration 016: `product_reviews` table

The scraper + AI enricher + facts wiring is ready in code, but the table doesn't exist yet.

- File: `migrations/016_product_reviews.sql`
- Apply via [Supabase SQL editor](https://supabase.com/dashboard/project/loecyghnkkxyymelgexz/sql) — paste, click Run.
- Failure mode if skipped: `python -m backend.scraping.run --module reviews` will 404 on every insert.

### 2. Extract per-brand widget credentials for product_reviews scraper

The scraper at `backend/scraping/sources/products/scrape_reviews.py` has a `WIDGET_CONFIG` dict with `needs_inspector: True` entries. Each brand needs its credentials filled in:

| Brand | Need to extract | From URL like |
|---|---|---|
| selkirk | `bv_passkey` | `https://api.bazaarvoice.com/data/reviews.json?passkey=XXX...` |
| onix | `bv_passkey` | same |
| wilson | `bv_passkey` | same |
| franklin | `bv_passkey` | same |
| joola | `jm_shop_domain` | `https://judge.me/api/v1/reviews?shop_domain=joolausa.myshopify.com&...` |
| paddletek | `jm_shop_domain` | same |
| crbn | `jm_shop_domain` | same |
| gamma | `jm_shop_domain` | same |

How: open brand product detail page (e.g. selkirk.com/products/project-boomstik) in Chrome → DevTools → Network tab → filter "reviews" or "bazaarvoice" or "judge.me" → copy query parameters into the `WIDGET_CONFIG` dict.

Start with **selkirk** to validate end-to-end against Project Boomstik (2,383 reviews — should be the canary).

### 3. Run end-to-end review pipeline after credentials set

```powershell
rm -f C:\Workspace\pipeline_v2_state.prev C:\Workspace\pipeline_v2_state.json
python -m backend.scraping.run --module reviews --restart       # scrape (default: 20 products × 50 reviews)
python -m backend.scraping.run --module enrichment --restart    # AI sentiment/NER
python -m backend.scraping.run --module facts --restart         # surface as channel='product_review'

# Verify
curl.exe -s -I -H "apikey: $env:SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $env:SUPABASE_SERVICE_ROLE_KEY" -H 'Prefer: count=exact' "$env:SUPABASE_URL/rest/v1/mention_facts?select=id&channel=eq.product_review" 2>&1 | Select-String 'Content-Range'
```

### 4. Validate Track B (rating backport for 6 brands)

The local Playwright scraper now has rating selectors for joola/six-zero/onix/franklin/head/wilson (was engage only). Validate by running the next product scrape and checking fill rates:

```powershell
python -m backend.scraping.run --module products --restart
```

Then per-brand fill check:
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

Expected fill rates (per Track B docs):
- joola 60-100%, six-zero 50-90%, onix 30-80% (BV lazy-render risk), franklin 40-80%, wilson 30-80%, head 0% (no widget — intentional), engage ~100%.

If **onix** stays at 0%, raise `extra_wait` in `scrape_catalog_local.py` BRAND_SCRAPERS from 8000 → 12000ms and add a scroll-to-bottom step inside `_scrape_brand`.

### 5. Fix `topic_lifecycle` schema cache error

Every `python -m backend.scraping.run --module facts` logs:
```
PGRST204: Could not find the 'brand_id' column of 'topic_lifecycle' in the schema cache
```

Diagnose via SQL editor:
```sql
select column_name from information_schema.columns where table_name='topic_lifecycle';
```

If `brand_id` is **missing**: write a migration that adds it + backfills from joined channel tables.
If `brand_id` **exists**: run `notify pgrst, 'reload schema';` in SQL editor to refresh PostgREST cache.

Currently every facts run says "✓ 0 topic_lifecycle rows upserted (1826 unique topics across 5 channels)" — full pipeline silently loses topic data.

### 6. Fix `product_aliases` schema mismatch

Live schema: `id, canonical_name, alias, platform, confidence, created_at`.
Matcher expects: `product_id, brand_id, alias, alias_norm, confidence, is_ambiguous`.

This breaks `analyze_videos.py` (video-level paddle NER) and `populate_product_mentions.py`. mention_facts is unaffected (uses `products_catalog.aliases` JSON directly).

Fix path: write a migration that adds the missing columns + backfills `product_id` by joining `canonical_name` → `products_catalog.display_name`.

---

## ENGINEERING PUNCH LIST (Claude can do; queue for next session)

### Frontend

- **YouTube comments scraper returns 0 rows** even on full scrape. Apify actor `streamers/youtube-comments-scraper` may need individual video URLs rather than channel URL input. Investigate `backend/scraping/sources/youtube/scrape_comments.py`. Low priority — `yt_comments` already-stored rows enrich correctly.
- **"Best-rated paddle per brand" KPI strip** at top of /v2/product-intel — deferred. The Section 7 table columns are sufficient for now.
- **Product-level discount filter** on `/v2/campaign-offer-intel` — currently only filters by sitewide banner discounts. Could add a "products on sale" toggle that filters `products.discount_pct > 0`.
- **Strike-through rendering of `price → sale_price`** on product table — currently shown as separate columns.
- **Visual sparkline of rating trend over time per product** — needs a `product_rating_history` table (separate migration).
- **Per-paddle review-text rendering** on `/v2/product-intel` — when migration 016 lands, surface top 3 reviews per product (expandable row, sort by helpful_count).
- **Section 2 — Community trend date desync**: when user sets a custom date filter window, `filteredTrend` may still be keyed on un-filtered fetch range. Trace `frontend/app/v2/community-intel/page.tsx` `filteredTrend` computation; rebuild via useMemo from `filteredSignals` instead of using `data.trend` directly.
- **Section 7 — Internal "Review required" tables** still visible on `/v2/instagram` and `/v2/twitter`. Wrap in `process.env.NODE_ENV !== 'production'` or move to `/v2/_dev`.
- **Section 11 — Sales Intel actionability**: add executive-summary card above the 4 sub-tables aggregating "where are sales going?" (top 3 trending up/down, biggest gainers, biggest price drops).
- **Section 13 — Platform takeaway sections** at bottom of each of 5 platform pages (instagram/youtube/reddit/twitter/tiktok): add small `Platform takeaway` card with JOOLA position vs top competitor + WoW indicator + one-line "what to do".
- **Section 14 — JOOLA visibility consistency**: spot-check every chart highlights JOOLA the same way (green ring + label-always-on). Grep for `=== 'joola'` and confirm the styling branch always renders JOOLA's row/dot/bar even when value is 0.
- **Section 15 — Number / date / unit formatting** audit. `app/v2/sales-intel/page.tsx` revenue, `app/v2/changepoints/page.tsx` dates, `app/v2/product-intel/page.tsx` price formatting all need a once-over.
- **Section 16 — Empty state coverage**: pages like sales-intel + product-intel matrix may still render blank cards on zero-filter-rows. Use the standard `<div className="card" style={{ textAlign: 'center', padding: 48 }}>` pattern.

### Backend / scrapers

- **Pagination for product_reviews** (v2 enhancement). v1 fetches page 1 only — Boomstik's 2,383 reviews cap at ~50. Walk `Offset` (BV) / `page` (Judge.me) until empty in `scrape_reviews.py`.
- **Selkirk YT subscriber inflation** — yt_channel_weekly may still show 142K vs live ~17K. Inspect yt_channels for the brand_id, confirm channel_id is the `@SelkirkSport` canonical handle, fix or DELETE stale rows.
- **Franklin + Wilson YouTube cleanup** — these brands have no pickleball-specific YT channel. The `brands.yaml` mapping points at parent corporate channels. Either remove the youtube: line or purge stale rows via REST DELETE (commands in git history pre-2026-05-25).
- **AI enrichment doesn't cover `product_reviews` yet at runtime** — code is wired in `ai_enricher.py TABLES` but migration 016 must apply first or the enricher fails fast on the table-missing error.

### Data quality

- **45 → 42 player roster discrepancy** in `frontend/lib/v2/playerRoster.ts`. Set dedupes 3 multi-brand players (Parris Todd, Riley Newman, Steve Deakin). If business expected 43rd, identify and add.
- **Six-zero AUD pricing** — rows have `price_usd=NULL`, `currency='AUD'`. Add FX conversion or a `price_aud` column so six-zero shows in price-tier analysis.

---

## KNOWN SOFT SPOTS (watch list — not necessarily actionable yet)

- **Apify `streamers/youtube-comments-scraper`** sometimes returns FAILED runs — handled with retry, but if 2+ runs fail in a row, the actor may be down. Check Apify console.
- **Bazaarvoice widgets lazy-render** for ~5-10s. Scraper now waits 8000ms for onix/wilson; if a future page change extends this, raise the wait.
- **OpenAI `gpt-4o-mini` rate limits** — current pipeline uses 8 concurrent workers (`ENRICH_WORKERS=8`). Tier 1 OpenAI account caps at 500 RPM, which is comfortable for current volume but would throttle a 10x scale-up.
- **PostgREST schema cache** — after any migration that adds columns referenced by existing code, run `notify pgrst, 'reload schema';` in SQL editor to avoid PGRST204 errors. (See `topic_lifecycle.brand_id` failure above.)
- **mention_facts._clear_channel_facts(channel)** deletes the whole channel before re-insert. Re-runs are safe but transient gaps will be visible to the frontend during the few-second DELETE → INSERT window.
- **Checkpoint files at `C:\Workspace\pipeline_v2_state*`** sometimes hit `FileExistsError` on `--restart`. Delete manually before retrying if that error appears.

---

## ONE-LINER REFERENCE

```powershell
# Full weekly pipeline
rm -f C:\Workspace\pipeline_v2_state.prev C:\Workspace\pipeline_v2_state.json
python -m backend.scraping.run --module all --restart

# Just enrichment + facts (idempotent re-run after manual fix)
python -m backend.scraping.run --module enrichment
python -m backend.scraping.run --module facts

# Analytics rollup (marts + statistics)
python -m analytics_backend.run --module all

# Brand-scoped tests
python -m backend.scraping.run --module youtube --brands joola --restart
python -m backend.scraping.run --module tiktok --brands selkirk --restart

# Frontend
cd frontend; npx tsc --noEmit; npm run dev
```

Env load helper (one-time per PowerShell session):
```powershell
Get-Content c:\Workspace\joola-intel-nextjs\.env | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') { Set-Item -Path "env:$($matches[1].Trim())" -Value $matches[2].Trim() }
}
```

## Ask Intel — net-new build (2026-05-25)

### Files
- Schema: frontend/lib/v2/askIntel/schema.ts (40K — tables/columns/metrics)
- Safety: frontend/lib/v2/askIntel/sqlSafety.ts
- Types:  frontend/lib/v2/askIntel/types.ts
- API:    frontend/app/api/v2/ask-intel/route.ts (POST + GET /schema + GET /suggestions)
- Page:   frontend/app/v2/ask-intel/page.tsx
- Components: frontend/components/v2/askIntel/*.tsx
- Sidebar: added "Ask Intel" entry

### Architecture
Two-step OpenAI flow (planner → executor → answerer).
Structured plan (not raw SQL) — translates to typed supabase-js calls; no need for exec_safe_sql RPC.
JOOLA green #22c55e throughout. Reuses existing charts.tsx primitives.

### USER ACTIONS
- Add OPENAI_API_KEY (server-only, no NEXT_PUBLIC_) to frontend/.env.local AND Vercel env vars.
- Optionally create read-only DB role + RLS policies for defense in depth.

### Cost
~$0.003 per question (gpt-4o-mini planner + answerer ≈ 2k input + 1k output each).

### Known limitations
- v1 supports table/select/filter/groupBy/orderBy only — no arbitrary joins beyond schema.ts join hints.
- Complex CTEs not supported in v1.
- Future v2: exec_safe_sql stored proc with explicit read-only role.

## Community Intel + Influencer Intel expansion (2026-05-25)

### What shipped
8 new additive sections — 4 on `/v2/community-intel` and 4 on `/v2/influencers`. All existing sections preserved.

#### Community Intel — 4 new sections
- **A. Competitor Complaint Map** — per-brand top crisis keyword + 3 example snippets + JOOLA opportunity (rule-based).
  - Source: ig_comments + yt_comments + reddit_comments + tiktok_comments where is_crisis OR sentiment=negative; aggregates crisis_keywords text[] per brand.
- **B. Defection Signals** — competitor_switch_events grouped by (from_brand, to_brand) with avg confidence + example. Includes net-defection KPI strip (JOOLA inflow / outflow / net / total).
- **C. Topic Lifecycle Radar** — topic_lifecycle rows with first-channel + peak + channels touched + action. Empty-state explains the known PGRST204 brand_id bug in populator and gives the USER ACTION to fix it.
- **D. Brand Reply Advantage** — brand_replies aggregated per brand: avg response time, replied vs ignored counts, ranking. Empty-state callout: "Activate detect_brand_replies.py in weekly scheduler".

#### Influencer Intel — 4 new sections
- **E. Athlete Impact Score** — composite ROI-proxy = normalized sum of {posts (30d), avg engagement, mentions, follower growth WoW from influencer_x_snapshots, product mentions, positive %}. Top 10 = rising, bottom 10 = underperforming.
- **F. Sponsored vs Organic Performance** — per-athlete ER comparison (is_sponsored split). Rule-based recommendation: <50% organic → review, >150% → scale.
- **G. Athlete-to-Product Pull** — (athlete × product) pairs from mention_facts. Enriches with product_attention_summary.last_30d sales_likelihood_score when available. JOOLA filter chip.
- **H. Competitor Athlete Threats** — top-10 competitor-only athletes by impact score, threat level = percentile within their own brand.

### New fetcher functions
#### `frontend/lib/v2/communityIntel.ts`
- `fetchComplaintMap(brands, opts)` → `ComplaintRow[]`
- `fetchDefectionSignals(brands, opts)` → `{ rows: DefectionRow[]; kpis: DefectionKpis }`
- `fetchTopicLifecycle()` → `TopicLifecycleRow[]`
- `fetchBrandReplies(brands)` → `BrandReplyRow[]`

#### `frontend/lib/v2/influencerIntel.ts`
- `fetchAthleteImpact(brands)` → `AthleteImpactRow[]`
- `fetchSponsoredVsOrganic(brands)` → `SponsoredOrganicRow[]`
- `fetchAthleteProductPull(brands)` → `AthleteProductPullRow[]`
- `fetchCompetitorAthleteThreats(brands, impactRows, platformStats, productConnections)` → `CompetitorThreatRow[]`

All fetchers wrap supabase calls in the existing safeQuery / safeSelect helpers so missing tables / RLS denials return [] instead of crashing.

### Framing cards
Sections A, B, F, G, H each render an `ImpactCards` triplet below the viz — Competitor move / Business impact / Recommended JOOLA action.

### Typecheck
`cd frontend && npx tsc --noEmit` — 0 errors in any file I edited. (Remaining 4 errors all live in `product-intel/page.tsx`, `productIntel.ts` — owned by the parallel product/sales agent.)

### Known limitations
- Topic Lifecycle empty until the topic_lifecycle.py PGRST204 brand_id bug is patched.
- Brand Reply Advantage empty until detect_brand_replies.py is wired into the weekly scheduler.
- Athlete Impact follower growth uses influencer_x_snapshots only (X-platform); IG/YT growth not yet snapshotted week-over-week.
- Athlete-to-Product Pull engagement column reads as 0 today because mention_facts does not carry engagement metrics — surfaced as "—".
- Competitor Athlete Threats relies on the Athlete Impact composite; if Impact has <10 athletes per brand, percentile bucketing is coarse.
