# INVENTORY — Top-level file & directory map

> One-line purpose for every top-level entry in `c:\Workspace\joola-intel-nextjs`. Snapshot date: **2026-05-19**.

---

## Repo root

| Path | Type | Purpose |
|---|---|---|
| `CLAUDE.md` | file | Session memory / project rules for AI agents. Contains live deployment table, business reqs, and per-session change log. |
| `README.md` | file | Public README. |
| `package.json` | file | Next 14.2.5, React 18, `@supabase/supabase-js`, `openai`. Dev: TS 5, Tailwind 3 (installed but unused by v2). Scripts: `dev`, `build`, `start`, `lint`, `type-check`, `validate`. |
| `package-lock.json` | file | NPM lockfile. |
| `tsconfig.json` | file | TypeScript config (strict-ish; aliases `@/*` → repo root). |
| `tsconfig.tsbuildinfo` | file | TS incremental build cache. Gitignored. |
| `next.config.js` | file | Next config (defaults + any project overrides). |
| `next-env.d.ts` | file | Next-generated type shims. Do not edit. |
| `postcss.config.js` | file | PostCSS pipeline for Tailwind. |
| `tailwind.config.ts` | file | Tailwind paths. Used only by non-v2 pages — the v2 dashboard uses custom CSS in `app/v2.css`. |
| `app/` | dir | Next 14 App Router pages + API routes. |
| `components/` | dir | Shared React components. |
| `lib/` | dir | Data fetchers, Supabase client, shared API helpers. |
| `scripts/` | dir | Python pipeline workers (DO NOT MODIFY). |
| `migrations/` | dir | SQL migrations 001-009 + rollbacks (DO NOT MODIFY). |
| `constants/` | dir | App-level constants (brand list, routes, SEO). |
| `hooks/` | dir | Reusable React hooks. |
| `utils/` | dir | TS utility helpers (cn, format). |
| `types/` | dir | Shared TS type defs. |
| `design/` | dir | Original static HTML/JSX prototypes. Reference; not deployed. |
| `docs/` | dir | Auxiliary written docs (business reqs, design system, code architecture, "where we left off"). |
| `backup/` | dir | **This directory.** Disaster-recovery + rebuild docs. |
| `_legacy/` | dir | Old code paths kept for reference. Not built. |
| `node_modules/` | dir | NPM deps. Gitignored. |

---

## `app/`

| Path | Purpose |
|---|---|
| `app/layout.tsx` | Root layout for the whole site. |
| `app/page.tsx` | Root index page. |
| `app/globals.css` | Sitewide reset/baseline. |
| `app/v2.css` | **All** v2 dashboard styles — sidebar, cards, charts, tables, pills, hover patterns. Single source of truth. |
| `app/v2/layout.tsx` | v2 dashboard shell: `<V2Sidebar />` + `<main className="main">`. Mounts `BrandFilterContext`. |
| `app/v2/page.tsx` | Executive Overview (`/v2`). |
| `app/v2/ads/page.tsx` | Ads Library (Meta + Google). |
| `app/v2/comments/page.tsx` | Cross-channel Comments Intel. |
| `app/v2/influencers/page.tsx` | 27-athlete bubble chart. |
| `app/v2/instagram/page.tsx` | Instagram analytics. |
| `app/v2/market/page.tsx` | Market Intel: crisis center, topic lifecycle, defection. |
| `app/v2/products/page.tsx` | Product catalog + price-tier mix + price history. |
| `app/v2/promotions/page.tsx` | Promotions heatmap + banner text. |
| `app/v2/reddit/page.tsx` | Reddit & community. |
| `app/v2/tiktok/page.tsx` | TikTok analytics. |
| `app/v2/twitter/page.tsx` | X (Twitter) analytics. |
| `app/v2/youtube/page.tsx` | YouTube analytics. |
| `app/api/generate-content/route.ts` | OpenAI content generation proxy (the one route the v2 dashboard actually uses). |
| `app/api/content-brief/route.ts` | SEO content-brief generator. |
| `app/api/keyword-research/route.ts` | Keyword research agent endpoint. |
| `app/api/seo-analyzer/route.ts` | On-page SEO analyzer endpoint. |

---

## `components/`

| Path | Purpose |
|---|---|
| `components/v2/Sidebar.tsx` | Fixed-position sidebar with collapse toggle. Hosts the `BrandFilter` at the top. Mutates `--sidebar-w` CSS var. |
| `components/v2/BrandFilterDropdown.tsx` | Multi-select brand filter UI. |
| `components/v2/PageShell.tsx` | Exports `PageHead`, `MiniKpi`, `SectionInfo`, `SortTh`, `LoadingPage`, `pgColor`, `pgName`, `fmt`. |
| `components/v2/FooterLinks.tsx` | External-platform CTA links rendered per page. |
| `components/v2/charts.tsx` | All visualizations: StackedArea, Donut, ScatterChart, LineChart, BubbleChart, BoxPlot, SentimentBar, Heatmap. |

---

## `lib/`

| Path | Purpose |
|---|---|
| `lib/v2/data.ts` | Per-page Supabase fetchers (`fetchBrands`, `fetchIG`, `fetchYT`, etc.). Exports `BRAND_COLORS`. |
| `lib/v2/BrandFilterContext.tsx` | React context for global brand filter. `isFiltered = 0 < selected < all`. |
| `lib/shared/supabase.ts` | Singleton Supabase client using anon key. |
| `lib/shared/content-brief/` | Helpers for the content-brief API route. |
| `lib/shared/keyword-research/` | Helpers for the keyword-research API route. |
| `lib/shared/seo-analyzer/` | Helpers for the SEO analyzer route. |
| `lib/api/errors.ts` | Standard API error shapes. |
| `lib/api/index.ts` | API helpers barrel export. |
| `lib/api/response.ts` | API response builders. |
| `lib/api/validate.ts` | Request validation helpers. |
| `lib/db/client.ts` | DB client (server-side helper, separate from the v2 singleton). |
| `lib/db/index.ts` | DB barrel export. |
| `lib/db/query.ts` | Query helpers. |

---

## `scripts/` — Python pipeline (DO NOT MODIFY)

| Path | Purpose |
|---|---|
| `scripts/pipeline/apify_to_supabase.py` | **Main pipeline.** 13 steps × 10 Apify actors → Supabase. Run weekly. |
| `scripts/pipeline/run_resumable.py` | Resumable wrapper around the pipeline (uses `pipeline_state.json`). |
| `scripts/pipeline/resume_pipeline.py` | Manual resume helper. |
| `scripts/pipeline/fix_missing_data.py` | Re-scrape only the channels that came up empty. |
| `scripts/pipeline/scrape_may15.py` | Historical one-shot scrape used during initial population. |
| `scripts/pipeline/scrape_reddit_comments.py` | Pulls Reddit reply trees under existing OPs (writes `reddit_comments`). |
| `scripts/pipeline/reddit_comments_recover.py` | Recovery helper for Reddit comments. |
| `scripts/pipeline/enrich_with_ai.py` | GPT-4o-mini enrichment worker. Populates 12 columns per row across 7 channel tables. |
| `scripts/pipeline/populate_mention_facts.py` | Denormalizes enriched rows into `mention_facts` + emits `competitor_switch_events`. |
| `scripts/pipeline/populate_topic_lifecycle.py` | Aggregates `topics` into `topic_lifecycle` (first-seen / peak / decay). |
| `scripts/pipeline/count_rows.py` | Row-count printer per table. |
| `scripts/pipeline/test_products_only.py` | Runs just the products step (used after migration 008). |
| `scripts/pipeline/test_tiktok_only.py` | Runs just the TikTok step. |
| `scripts/SCRAPE_PROGRESS.md` | Manual progress log. |
| `scripts/AUTONOMOUS_RUN_LOG.md` | Log of autonomous pipeline runs. |
| `scripts/pipeline_state.json` | Resumable state checkpoint. |
| `scripts/*.log` | Run logs (gitignored). |
| `scripts/__pycache__/` | Python bytecode cache (gitignored). |

`scripts/.env` (gitignored) holds `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APIFY_TOKEN`, `OPENAI_API_KEY`.
`scripts/.env.example` is the committed template.

---

## `migrations/` — SQL (DO NOT MODIFY)

| Path | Purpose |
|---|---|
| `001_particl_features.sql` | `product_price_history`, `promotions`, `marketing_ads` + columns on `products`. |
| `002_keyword_research.sql` | `keyword_research_results`. |
| `002_seo_reporting.sql` | `keyword_rankings`, `crawl_pages`, `content_briefs`. |
| `003_x_tiktok.sql` | X + TikTok schemas. Seeds 8 X handles + 10 TikTok handles. |
| `004_unique_constraints.sql` | Unique constraints on `reddit_mentions` + `influencer_posts` (archives dupes first). Also fixes JOOLA X handle. |
| `004_rollback.sql` | Rollback for 004. |
| `005_influencer_x.sql` | `influencer_x_snapshots`, `influencer_x_posts`, `influencers.x_handle`. Seeds 27 athlete X handles. |
| `005_rollback.sql` | Rollback for 005. |
| `006_enrichment_columns.sql` | Adds 12 enrichment columns across `reddit_mentions`, `ig_comments`, `yt_comments`, `x_posts`, `tiktok_videos`, `influencer_x_posts`. |
| `006_rollback.sql` | Rollback for 006. |
| `007_cross_channel_facts.sql` | `products_catalog` (seeds 25 paddles), `mention_facts`, `topic_lifecycle`, `competitor_switch_events`. |
| `007_rollback.sql` | Rollback for 007. |
| `008_products_constraint.sql` | Unique constraint on `products(name, brand_id)`. |
| `008_rollback.sql` | Rollback for 008. |
| `009_reddit_comments.sql` | `reddit_comments` + velocity columns on `reddit_mentions`. |
| `009_rollback.sql` | Rollback for 009. |

---

## Other top-level dirs

| Path | Purpose |
|---|---|
| `constants/brands.ts` | Brand metadata constants. |
| `constants/routes.ts` | Route name constants. |
| `constants/seo.ts` | SEO defaults (used by SEO routes). |
| `constants/index.ts` | Barrel. |
| `hooks/useAsync.ts` | Generic async state hook. |
| `hooks/useLocalStorage.ts` | Persisted state hook. |
| `utils/cn.ts` | className helper. |
| `utils/format.ts` | Number/date formatters. |
| `utils/index.ts` | Barrel. |
| `types/market.ts` | Market-related TS types. |
| `design/` | Static HTML/JSX prototypes from before the Next port (`Executive Dashboard.html`, `JOOLA Intel - Standalone.html`, `app.jsx`, `charts.jsx`, `pages.jsx`, `data.js`, `styles.css`). Reference, not deployed. |
| `docs/BUSINESS_REQUIREMENTS.md` | Long-form BRD (older; this packet's `01_BUSINESS_REQUIREMENTS.md` is the recovery-friendly summary). |
| `docs/CODE_ARCHITECTURE.md` | Code-architecture notes. |
| `docs/DESIGN_SYSTEM.md` | Long-form design system (older; this packet's `06_DESIGN_SYSTEM.md` is the recovery-friendly summary). |
| `docs/WHERE_WE_LEFT_OFF.md` | Mid-session handoff doc (historical). |
| `_legacy/app/`, `_legacy/components/`, `_legacy/lib/`, `_legacy/lib-shared/`, `_legacy/shared/` | Pre-v2 code paths kept for reference. Not built. |
| `backup/` | **This packet.** See `backup/README.md`. |
| `node_modules/` | NPM deps (gitignored). |
