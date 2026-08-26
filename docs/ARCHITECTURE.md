# Architecture

> Snapshot: 2026-08-14. Replaces the former `CODE_ARCHITECTURE.md` and
> `INVENTORY.md`, both of which described the pre-2026-05-24 single-app layout.

System topology, the file map, and how data moves end to end. For *why* the
product exists see [`../BRD.md`](../BRD.md); for coding rules see
[`../CLAUDE.md`](../CLAUDE.md).

---

## Topology

Three independently deployable units over one Supabase database.

```
┌──────────────────────────────┐
│ frontend/  Next.js 14        │  → Vercel (Root Directory = frontend/)
│  app/v2/*   dashboard pages  │
│  app/api/*  server routes    │
└──────────┬─────────────┬─────┘
           │ anon key    │ server-side
           │ (reads)     │
           ▼             ▼
   ┌──────────────┐  ┌──────────────┐
   │  Supabase    │  │  OpenAI API  │
   │  Postgres    │  │  gpt-4o-mini │
   └──────────────┘  └──────────────┘
           ▲                 ▲
           │ service_role    │
           │ (writes)        │
┌──────────┴─────────────────┴──────┐
│ backend/scraping/                 │  Phases 1–4: scrape → enrich → facts
│ analytics_backend/                │  Phase 5+: marts → statistics
│  local cron / GitHub Actions      │
└───────────────────────────────────┘
```

The Python units never ship with the Next.js build. The dashboard never writes.

---

## Data flow

```
1. Scrape     backend/scraping/sources/<channel>/…      → raw tables
              (ig_posts, yt_videos, reddit_mentions, x_posts, tiktok_videos,
               marketing_ads, promotions, products, …)

2. Enrich     backend/scraping/enrichment/…             → enrichment columns
              (sentiment, topics, NER, is_crisis, purchase_intent)

3. Facts      backend/scraping/facts/…                  → mention_facts,
              topic_lifecycle, competitor_switch_events, product_mentions,
              product_attention, instagram_themes

4. Sales      backend/scraping/sales_intelligence/…     → sales_estimates,
              inventory_events, sales_facts_daily

5. Marts      analytics_backend/marts/…                 → dim_brand_calendar,
              joola_timeseries_daily / _weekly

6. Stats      analytics_backend/statistics/…            → analysis_results
              (correlation scans, Granger, changepoints, seasonality)

7. Read       frontend/lib/v2/*.ts (anon key)           → React components
```

Phase detail — which steps run in parallel, and the `--module` names — lives in
[`../backend/README.md`](../backend/README.md).

---

## `frontend/`

Next.js 14 App Router. All `app/v2/*` pages are `'use client'`. Styles are
custom CSS in `app/v2.css`; Tailwind is installed but unused by v2.

### Pages — `frontend/app/v2/`

| Group | Routes |
|---|---|
| Q&A | `ask-intel` |
| Social | `instagram`, `youtube`, `reddit`, `twitter`, `tiktok` |
| Commercial | `ads`, `promotions`, `campaign-offer-intel`, `products`, `products-intel`, `product-intel`, `sales-intel` |
| Intel | `market`, `community-intel`, `crisis`, `influencers`, `leaderboard`, `overview` |
| Analytics | `correlations`, `changepoints`, `data-health` |
| Misc | `comments` |

`/v2` redirects to `/v2/overview` — Executive Overview is the home page. Seven
of the routes above (`ads`, `comments`, `crisis`, `leaderboard`, `products`,
`products-intel`, `promotions`) are superseded legacy pages with no sidebar or
command-palette entry; see BRD.md §10.10.

None of the four non-`ask-intel` API routes below is called by any page,
component, or test; see BRD.md §4.1.

### API routes — `frontend/app/api/`

| Route | Job |
|---|---|
| `v2/ask-intel/route.ts` | Planner → executor → answerer over the warehouse |
| `v2/ask-intel/schema/route.ts` | Serves the queryable schema to the planner |
| `v2/ask-intel/suggestions/route.ts` | Suggested-question list |
| `v2/ask-intel/feedback/route.ts` | Thumbs up/down log (migration 017) |
| `generate-content/route.ts` | OpenAI content generation |
| `content-brief/route.ts` | SEO content-brief generator |
| `keyword-research/route.ts` | Keyword research agent |
| `seo-analyzer/route.ts` | On-page SEO audit |

### Data layer — `frontend/lib/v2/`

| File | Job |
|---|---|
| `data.ts` | Core Supabase fetchers + `BRAND_COLORS` |
| `analytics.ts` | Correlation / changepoint / seasonality readers |
| `campaignOfferIntel.ts` | Ads + promotions intel |
| `communityIntel.ts` | Reddit / comments / defection intel |
| `influencerIntel.ts` | Athlete roster metrics |
| `marketIntel.ts` | Cross-channel market rollups |
| `productIntel.ts` | Catalog, price tiers, review velocity |
| `crisis.ts` | Crisis-flagged mention readers |
| `playbook.ts`, `playerRoster.ts` | Static reference data |
| `tooltips.ts` | Layman-language glossary + `tipFor(label)` for shared column headers |
| `askIntel/` | Planner schema (`schema.ts`), `sqlSafety.ts`, executor helpers |
| `BrandFilterContext.tsx` | Global brand filter + localStorage persistence |
| `DateRangeContext.tsx` | Global date-range state |
| `format.ts`, `animations.ts`, `urlState.ts`, `useBookmarks.ts` | Utilities |

`frontend/lib/shared/supabase.ts` is the anon-key singleton. `frontend/lib/db/`
and `frontend/lib/api/` hold server-side client + response helpers for the API
routes.

### Components — `frontend/components/v2/`

| File | Exports |
|---|---|
| `PageShell.tsx` | `PageHead`, `MiniKpi`, `SectionInfo`, `SortTh`, `LoadingPage`, `pgColor`, `pgName`, `fmt`, `displayBrandName` |
| `charts.tsx` | `LineChart`, `ScatterChart`, `BubbleChart`, `Donut`, `BoxPlot`, `SentimentBar`, `StackedArea` |
| `Sidebar.tsx` | Fixed nav, collapse toggle, hosts the brand filter |
| `BrandFilterDropdown.tsx`, `DateRangeDropdown.tsx`, `DateRangePicker.tsx` | Global filter UI |
| `ScrollTable.tsx`, `TableSearch.tsx`, `Pagination.tsx`, `DensityToggle.tsx`, `BrandCell.tsx`, `BrandSummaryTable.tsx` | Table primitives |
| `CommandPalette.tsx`, `CmdKPalette.tsx`, `Breadcrumb.tsx`, `BackButton.tsx`, `BackToTop.tsx` | Navigation |
| `StatCard.tsx`, `StatusBadge.tsx`, `ActionFrame.tsx`, `PlatformPlaybook.tsx`, `FooterLinks.tsx` | Presentation |
| `CustomerVoiceSection.tsx` | Retail-review KPI strip + per-paddle table (BRD §7.1) |
| `charts/`, `product-detail/`, `askIntel/` | Per-feature component subtrees |
| `ThemeToggle.tsx`, `LayoutClientExtras.tsx`, `AgentationFeedback.tsx` | Shell extras |

### Supporting dirs

`frontend/e2e/smoke.spec.ts` (Playwright routes + API + nav + 404),
`frontend/qa/regression.ps1` (typecheck → build → routes → playwright),
`frontend/design/` (pre-port static HTML prototypes; reference only),
plus `constants/`, `hooks/`, `utils/`, `types/`.

---

## `backend/scraping/`

| Dir | Contents |
|---|---|
| `run.py` | CLI entry point; owns `MODULE_STEPS`, phases, thread pool |
| `scheduler.py` | Cron-facing wrapper |
| `config/` | `actors.yaml`, `brands.yaml`, `sales_sources.yaml`, `scrape_defaults.yaml` |
| `core/` | `apify_client`, `crawl4ai_client`, `openai_client`, `supabase_client`, `checkpoints`, `rate_limits`, `network`, `settings`, `logger`, `errors` |
| `sources/` | One package per channel: `instagram`, `youtube`, `reddit`, `twitter`, `tiktok`, `ads`, `products`, `news`, `seo` |
| `enrichment/` | `ai_enricher`, `analyze_videos`, `influencer_sponsored`, `reddit_backfill`, `tiktok_enrichment`, `twitter_enrichment` |
| `facts/` | `mention_facts`, `topic_lifecycle`, `competitor_switch`, `instagram_themes`, `populate_product_mentions`, `populate_product_attention` |
| `sales_intelligence/` | `discover`, `scrape_inventory`, `scrape_inventory_crawl4ai`, `estimate`, `restock`, `sellout`, `launches`, `revenue`, `correlation` |
| `maintenance/` | `count_rows`, `validate_data`, `cleanup`, `backfill_athlete_names`, `backfill_youtube_comments` |

Every step exposes `run(ctx: dict) -> int` returning rows upserted. Checkpoint
state is `pipeline_v2_state.json` at the repo root.

---

## `analytics_backend/`

| Dir | Contents |
|---|---|
| `run.py` | CLI entry point, mirrors `backend.scraping.run` |
| `core/exec_sql.py` | Raw-SQL execution helper |
| `marts/` | `refresh_calendar`, `refresh_timeseries`, `refresh_helpers` |
| `statistics/` | `correlation_scan` (Pearson + Spearman lag scans), `cross_correlation` (statsmodels CCF), `granger` (ADF + VAR order + Granger), `changepoints` (ruptures PELT), `seasonality` (STL) |

Writes to `analysis_results`, read by `/v2/correlations` and `/v2/changepoints`.

---

## `scripts/` — cross-cutting

| Script | Job |
|---|---|
| `weekly_run.py` | One-shot scraping → analytics |
| `deploy.ps1` | QA-gated deploy (typecheck → build → commit → push) |
| `db_verify.py` | 4-phase pipeline health check with per-table remediation commands |
| `launch_pipeline.ps1`, `run_unattended.py`, `progress_monitor.py` | Unattended run helpers |
| `test_ask_intel.py` | 29-question Ask Intel regression harness |
| `apply_migration.py`, `apply_migration_013.py` | Migration appliers |
| `backfill_product_images.py`, `consolidate_catalog_images.py`, `fix_product_prices.py` | One-off data repairs |

---

## `migrations/`

`001` → `021`, applied in filename order; `*_rollback.sql` files undo the
matching forward migration. Highlights:

| Migration | Adds |
|---|---|
| `001_particl_features` | `product_price_history`, `promotions`, `marketing_ads` |
| `003_x_tiktok` | X + TikTok schema, seeds handles |
| `005_influencer_x` | Athlete X snapshots/posts, seeds the 27-athlete roster |
| `006_enrichment_columns` | 12 enrichment columns across 6 channel tables |
| `007_cross_channel_facts` | `products_catalog`, `mention_facts`, `topic_lifecycle`, `competitor_switch_events` |
| `010_sales_intelligence` | 6-table inventory → revenue schema |
| `012_intelligence_layer` | Derived intel tables |
| `013_analytics_foundation` | Marts + `analysis_results` |
| `015_expand_products_catalog` | Catalog to 86 paddles |
| `016_product_reviews` | Review-velocity table |
| `017_ask_intel_feedback` | `ask_intel_qa_log` |
| `018`–`021` | Engagement links, product images, price/lifecycle fixes, alias + switch fixes |

Per-table columns, writers, and readers: [DATABASE.md](DATABASE.md).

---

## QA gates

Run from `frontend/`.

| Gate | Command | Time |
|---|---|---|
| Typecheck | `npm run type-check` | ~3 s |
| Lint | `npm run lint` | ~5 s |
| Both | `npm run validate` | ~8 s |
| Fast regression (skip build) | `npm run qa:fast` | ~30 s |
| Full regression | `npm run qa` | ~60–90 s |
| Deploy | `npm run deploy -- -Message "..."` | ~2 min |

`.husky/pre-push` invokes `frontend/qa/regression.ps1`. Enable on a fresh clone
with `git config core.hooksPath .husky`.

### Route arrays that must stay in sync

| Array | File | Source of truth |
|---|---|---|
| `PAGES` | `frontend/e2e/smoke.spec.ts` | every `frontend/app/v2/**/page.tsx` |
| `API_ROUTES` | `frontend/e2e/smoke.spec.ts` | every `frontend/app/api/**/route.ts` |
| `$ROUTES` | `frontend/qa/regression.ps1` | matches `PAGES` |
| `PAGES` | `frontend/qa/tooltip-check.mjs` | matches `PAGES`; `/v2/ask-intel` is excluded by design (chat page, no static sections) |

---

## Dependencies

**Frontend runtime**: `next` 14.2.5, `react` 18, `@supabase/supabase-js`,
`openai`, `cheerio`. **Dev**: TypeScript 5, `@playwright/test`, `husky`,
`tailwindcss` (config only — unused by v2).

**backend**: `requests`, `supabase`, `python-dotenv`, `playwright`,
`playwright-stealth`, `openai`, `crawl4ai` — see `backend/requirements.txt`.

**analytics_backend**: `scipy`, `statsmodels`, `ruptures`, `scikit-learn` — see
`analytics_backend/requirements.txt`.
