# 05 — Frontend Rebuild

> **Goal.** Stand up the Next.js 14 dashboard locally; verify it reads from Supabase. Then deploy (see `07_DEPLOYMENT.md`).

---

## Stack at a glance

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js **14.2.5** (App Router) | TypeScript |
| UI | Custom CSS in `app/v2.css` | Tailwind is **installed but not used** for the v2 dashboard |
| Data | `@supabase/supabase-js` v2.45 | Read directly from the browser via anon key |
| Charts | Hand-rolled SVG in `components/v2/charts.tsx` | No third-party chart lib |
| AI | `openai` package | Used by one server endpoint `app/api/generate-content/route.ts` |
| Build / host | Vercel | `npm run build && npm start` |

---

## Quick start (local)

```bash
cd c:\Workspace\joola-intel-nextjs
npm install
# Create .env.local at repo root with the THREE NEXT_PUBLIC_ vars below
npm run dev   # http://localhost:3000
```

`.env.local` (gitignored):
```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
NEXT_PUBLIC_OPENAI_KEY=sk-...
```

Smoke test: navigate to `http://localhost:3000/v2/reddit`. If data appears, Supabase wiring is OK.

---

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  Next.js 14 App Router  — single deployable                   │
│                                                                │
│  app/                                                          │
│   ├─ layout.tsx          (root)                                │
│   ├─ page.tsx            (root index)                          │
│   ├─ globals.css         (sitewide reset, non-v2)              │
│   ├─ v2.css              (ALL v2 dashboard styles)             │
│   ├─ v2/                                                       │
│   │   ├─ layout.tsx      (sidebar shell + .main wrapper)       │
│   │   ├─ page.tsx        (Executive Overview)                  │
│   │   ├─ ads/page.tsx                                          │
│   │   ├─ comments/page.tsx                                     │
│   │   ├─ influencers/page.tsx                                  │
│   │   ├─ instagram/page.tsx                                    │
│   │   ├─ market/page.tsx                                       │
│   │   ├─ products/page.tsx                                     │
│   │   ├─ promotions/page.tsx                                   │
│   │   ├─ reddit/page.tsx                                       │
│   │   ├─ tiktok/page.tsx                                       │
│   │   ├─ twitter/page.tsx                                      │
│   │   └─ youtube/page.tsx                                      │
│   └─ api/                                                      │
│       ├─ generate-content/route.ts   (OpenAI proxy)            │
│       ├─ content-brief/route.ts                                │
│       ├─ keyword-research/route.ts                             │
│       └─ seo-analyzer/route.ts                                 │
│                                                                │
│  components/v2/                                                │
│   ├─ Sidebar.tsx              (nav + BrandFilter, fixed)       │
│   ├─ BrandFilterDropdown.tsx                                   │
│   ├─ PageShell.tsx            (PageHead, MiniKpi, SortTh, …)   │
│   ├─ FooterLinks.tsx                                           │
│   └─ charts.tsx               (StackedArea, Donut, Scatter, …) │
│                                                                │
│  lib/v2/                                                       │
│   ├─ data.ts                  (Supabase fetchers)              │
│   └─ BrandFilterContext.tsx   (global brand filter state)      │
│                                                                │
│  lib/shared/supabase.ts       (singleton client, anon key)     │
│                                                                │
└───────────────────────────────────────────────────────────────┘
```

**No API layer for reads.** Browser components call `supabase.from(...).select(...)` directly. The anon key is safe in the browser bundle; RLS protects writes (when enabled — see `02_DATABASE_RECOVERY.md` step 4).

The only **server-side** code is the four routes in `app/api/`, of which only `generate-content` is wired into the v2 dashboard for AI content briefs.

---

## Pages (11 total under `/v2`)

| Route | What it shows | Primary tables |
|---|---|---|
| `/v2` | Executive Overview: KPI strip, SoV, sentiment, crisis count, briefs | aggregates across all |
| `/v2/instagram` | Brand IG followers + engagement + posting cadence | `ig_profiles_weekly`, `ig_posts`, `ig_comments` |
| `/v2/youtube` | YT subs + video output + top videos | `yt_channels`, `yt_videos`, `yt_comments` |
| `/v2/reddit` | Reddit OPs, subreddit breakdown, velocity, crisis | `reddit_mentions`, `reddit_comments` |
| `/v2/twitter` | X profile + posts per brand | `x_profiles_weekly`, `x_posts` |
| `/v2/tiktok` | TikTok profile + videos per brand | `tiktok_profiles_weekly`, `tiktok_videos` |
| `/v2/comments` | Cross-channel comments intel (sentiment, intent) | `mention_facts` (all comment channels) |
| `/v2/influencers` | Athlete bubble chart (followers × engagement × output) | `influencers`, `influencer_posts`, `influencer_x_*` |
| `/v2/ads` | Meta + Google ads library, SoV, top creative | `marketing_ads` |
| `/v2/promotions` | Promotion cadence heatmap + banner text | `promotions` |
| `/v2/products` | Paddle catalog + price-tier mix + price history | `products`, `products_catalog`, `product_price_history` |
| `/v2/market` | Crisis center, topic lifecycle, competitor defection | `mention_facts`, `topic_lifecycle`, `competitor_switch_events` |

---

## Shared components

| Component | Purpose |
|---|---|
| `Sidebar.tsx` | Fixed-position nav (left). Hosts `BrandFilter` at the top. Collapses to 60 px on click; mobile hamburger pattern below 768 px. Drives the `--sidebar-w` CSS variable. |
| `BrandFilterDropdown.tsx` | Multi-select dropdown for the 11 brands. Backed by `BrandFilterContext`. |
| `PageShell.tsx` | Exports `PageHead`, `MiniKpi`, `SectionInfo`, `SortTh`, `LoadingPage`, plus helper functions `pgColor`, `pgName`, `fmt`. |
| `FooterLinks.tsx` | Quick links to external platforms (Reddit subs, IG profiles, etc.) per page. |
| `charts.tsx` | All visualizations: `StackedArea`, `Donut`, `ScatterChart`, `LineChart`, `BubbleChart`, `BoxPlot`, `SentimentBar`, `Heatmap`. |

### `BrandFilterContext`

Global state for the brand filter. Key contract (do not break):

```ts
isFiltered = selectedSlugs.length > 0
          && selectedSlugs.length < allBrands.length
// true  → filter is active, banner shows, displayXxx arrays are sliced
// false → show all brands (either nothing selected OR all selected)
```

Mounted near the root of `app/v2/layout.tsx` so every page sees the same filter.

---

## Data layer (`lib/v2/data.ts`)

Pattern: one async fetcher per page. Each returns reshaped data ready for the page's charts.

```ts
fetchBrands()          → V2Brand[]    // 11 brands w/ colors
fetchIG(brands)        → V2IGRow[]    // /v2/instagram
fetchYT(brands)        → V2YTRow[]    // /v2/youtube
fetchReddit(brands)    → V2RedditRow[]
fetchAds(brands)       → V2AdsRow[]
fetchAdSample(brand)   → V2AdSample[]
fetchPromos(brands)    → V2PromoRow[]
fetchProducts(brands)  → V2ProductRow[]
fetchInfluencers()     → V2InfRow[]
fetchComments(brands)  → V2CommentRow[]
fetchSignals()         → V2SignalRow[]   // ai-flagged crises/opportunities
```

`fetch*` functions accept the filtered brand list when applicable; the page derives `displayXxx` arrays from them.

---

## Brand colors

Authoritative palette lives in `lib/v2/data.ts`:

```ts
BRAND_COLORS = {
  joola: '#22c55e',     // green (always)
  selkirk: '#F5E625',   // yellow
  crbn: '#818cf8',      // indigo
  franklin: '#ec4899',  // pink
  engage: '#06b6d4',    // cyan
  paddletek: '#f59e0b', // amber
  'six-zero': '#a855f7',// purple
  onix: '#ef4444',      // red
  wilson: '#14b8a6',    // teal
  gamma: '#60a5fa',     // blue
  head: '#0ea5e9',      // sky
  prokennex: '#fb923c', // orange (legacy)
}
```

JOOLA's green is also used as the "positive" semantic color in charts — be careful when picking color for sentiment indicators (use `#94a3b8` gray for neutral; never reuse JOOLA green for "good sentiment" unless the JOOLA brand row).

---

## Build & dev commands

| Command | Purpose |
|---|---|
| `npm run dev` | Next dev server, hot reload |
| `npm run build` | Production build — must pass before pushing to main |
| `npm start` | Run the production build locally |
| `npm run lint` | ESLint |
| `npm run type-check` | `tsc --noEmit` |
| `npm run validate` | Type-check + lint together; CI gate equivalent |

**Always run `npm run type-check` after editing TS files.** Common gotcha: `Set` spread (`[...new Set(...)]`) triggers TS2802 — use `Array.from(new Set(...))` instead.

---

## Recovery procedure

If the GitHub repo is intact, recovery is just:

```bash
git clone https://github.com/gyanendurout/SaaS_Joola_Intel.git
cd SaaS_Joola_Intel
npm install
# create .env.local with the 3 NEXT_PUBLIC_ vars
npm run dev
```

If the repo is lost too, you'd need to rebuild from this `backup/` directory **plus the underlying source tree**, which is not snapshotted here. The migrations + `01_BUSINESS_REQUIREMENTS.md` define the data contract; the dashboard would have to be re-implemented. TODO: maintain a periodic full-tree backup elsewhere (e.g. an S3 bucket).
