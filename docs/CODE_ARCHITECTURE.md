# JOOLA Intel — Code Architecture

A complete technical reference for the JOOLA Intel Next.js codebase. Covers directory structure, data flow, component hierarchy, database schema, API surface, and extension patterns.

---

## 1. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 14.2.5 |
| UI | React | 18 |
| Language | TypeScript | 5 |
| Database | Supabase (managed Postgres) | — |
| DB client | `@supabase/supabase-js` | ^2.45.0 |
| AI | OpenAI GPT-4o | via `openai` ^6.33.0 |
| Styling | Custom CSS (`v2.css`) + Tailwind (config only) | Tailwind 3.4 |
| Hosting | Vercel | — |
| Data pipeline | Python 3 scripts (local / cron) | — |

Tailwind is installed but the V2 dashboard does **not** use Tailwind utility classes — all styles live in `app/v2.css`. Tailwind is used only by any leftover legacy pages.

---

## 2. Directory Structure

```
joola-intel-nextjs/
│
├── app/                          ← Next.js App Router root
│   ├── layout.tsx                ← Root HTML layout (no UI, just <html>/<body>)
│   ├── page.tsx                  ← Redirects / to /v2
│   ├── globals.css               ← Tailwind base + legacy utilities
│   │
│   ├── api/
│   │   └── generate-content/
│   │       └── route.ts          ← POST /api/generate-content (OpenAI endpoint)
│   │
│   └── v2/                       ← Executive dashboard (all active UI)
│       ├── layout.tsx            ← V2 layout: metadata, sidebar, footer, v2.css import
│       ├── v2.css                ← All V2 styles (~1433 lines, single source of truth)
│       ├── page.tsx              ← /v2 — Executive Overview
│       ├── instagram/page.tsx    ← /v2/instagram
│       ├── youtube/page.tsx      ← /v2/youtube
│       ├── reddit/page.tsx       ← /v2/reddit
│       ├── comments/page.tsx     ← /v2/comments
│       ├── influencers/page.tsx  ← /v2/influencers
│       ├── ads/page.tsx          ← /v2/ads
│       ├── promotions/page.tsx   ← /v2/promotions
│       ├── products/page.tsx     ← /v2/products
│       └── market/page.tsx       ← /v2/market
│
├── components/
│   └── v2/
│       ├── Sidebar.tsx           ← Navigation sidebar (collapse + mobile)
│       ├── PageShell.tsx         ← Shared UI: PageHead, MiniKpi, SortTh, SectionInfo, Toast, etc.
│       ├── charts.tsx            ← All chart components
│       └── FooterLinks.tsx       ← Footer quick links (info modals)
│
├── lib/
│   ├── shared/
│   │   └── supabase.ts           ← Supabase client singleton
│   └── v2/
│       └── data.ts               ← All data-fetching functions + TypeScript types
│
├── types/
│   └── market.ts                 ← Shared TS interfaces (MarketIntelItem, GeneratedContent, etc.)
│
├── scripts/                      ← Python data pipeline (NOT deployed)
│   ├── run_resumable.py          ← Main pipeline entry point
│   ├── apify_to_supabase.py      ← Apify → Supabase ingestion
│   ├── scrape_may15.py           ← Scraping orchestrator
│   ├── fix_missing_data.py       ← Data repair utility
│   ├── count_rows.py             ← DB audit tool
│   ├── pipeline_state.json       ← Checkpoint for resumable runs
│   ├── .env                      ← Pipeline secrets (gitignored)
│   └── .env.example              ← Secret template (committed)
│
├── migrations/                   ← Supabase SQL migration files
├── docs/                         ← Documentation (this file)
├── design/                       ← Static design assets (not used in v2)
├── _legacy/                      ← Old v1 code (excluded from tsconfig)
│
├── next.config.js                ← Minimal Next.js config (defaults)
├── tsconfig.json                 ← Strict TypeScript, @/* path alias
├── tailwind.config.ts            ← Extended Tailwind (not used by v2)
└── package.json
```

---

## 3. Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER                                  │
│                                                                 │
│  app/v2/**/page.tsx   ──useEffect──▶  lib/v2/data.ts           │
│  ("use client")                        fetchBrands()            │
│                                        fetchIG()                │
│  components/v2/                        fetchAds()               │
│    charts.tsx          ◀──setState──   fetchOverview()  ──▶ Supabase
│    PageShell.tsx                       …etc.              (anon key)
│    Sidebar.tsx                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     SERVER (Vercel Serverless)                  │
│                                                                 │
│  POST /api/generate-content                                     │
│    ├── reads market_intel_items from Supabase (anon key)        │
│    ├── calls OpenAI GPT-4o                                      │
│    └── writes generated_content to Supabase (anon key)         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     LOCAL MACHINE (cron / manual)               │
│                                                                 │
│  scripts/run_resumable.py                                       │
│    ├── calls Apify APIs                                         │
│    └── writes to Supabase (service_role key)                   │
│                         ↓                                       │
│                    Supabase Postgres                            │
│                    (17+ tables)                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Key principles

- **All reads are client-side**: pages are `'use client'` and query Supabase directly via the anon key. There is no custom REST/GraphQL API layer for reads.
- **The only server-side endpoint** is `POST /api/generate-content` (OpenAI proxy).
- **Data writes** happen exclusively from the Python pipeline using the `service_role` key — never from the Next.js app.
- **No SSR / RSC**: all V2 pages are client components because they need React state for charts, filters, and sorting.

---

## 4. File-by-File Reference

### `app/v2/layout.tsx`

Sets page metadata, imports `v2.css`, wraps every V2 page in the shell:

```tsx
<div className="v2-root">
  <div className="app-bg" />
  <div className="dot-grid" />
  <div className="shell">
    <V2Sidebar />
    <main className="main">
      <div className="main-inner">
        {children}
      </div>
    </main>
  </div>
  <footer>…</footer>
  <FooterLinks />
</div>
```

This layout never re-mounts between page navigations (Next.js App Router segment caching).

---

### `app/v2/**/page.tsx` (all pages)

Every page follows the same pattern:

```tsx
'use client'

export default function PageName() {
  const [data, setData] = useState<ReturnType | null>(null)

  useEffect(() => {
    fetchXxx().then(setData)  // one or more parallel fetches
  }, [])

  if (!data) return <LoadingPage />

  return (
    <>
      <div className="section-nav">…</div>
      <PageHead eyebrow="…" title="…" accent="…" sub="…" actions={…} />
      <section id="…">
        <div className="section-head"><h2>…</h2><SectionInfo …/></div>
        <div className="card card-pad">…</div>
      </section>
    </>
  )
}
```

No data is passed as props from a server component — all pages self-fetch on mount.

---

### `lib/v2/data.ts`

The entire data layer. 20+ async functions, each independently callable. Pages import only what they need.

#### TypeScript types exported

| Type | Shape |
|---|---|
| `V2Brand` | `{ id, brand_id, name, color, joola? }` |
| `V2IGRow` | `{ brand, followers, delta, deltaPct, engRate, trend[] }` |
| `V2AdRow` | `{ brand, total, meta, google, active, share }` |
| `V2PromoRow` | `{ brand, count, types[], pct }` |
| `V2ProductRow` | `{ brand, count, avg, min, med, max }` |
| `V2YTRow` | `{ brand, subs, videos, views, delta }` |
| `V2RedditRow` | `{ brand, mentions, positive, neutral, negative, delta }` |
| `V2InfluencerRow` | `{ name, brand, followers, posts, avgLikes, engRate }` |
| `V2AdSample` | `{ brand, platform, copy, cta, started, active }` |
| `V2TopIGPost` | `{ brand, handle, caption, likes, comments, views, format, days, engRate }` |
| `V2TopYTVideo` | `{ brand, title, views, likes, comments, duration, days }` |
| `V2TopComment` | `{ user, text, platform, brand, likes, sentiment, days }` |
| `V2Overview` | All of the above bundled |

#### Fetcher index

| Function | Tables queried | Notes |
|---|---|---|
| `fetchBrands()` | `brands` | Foundation — call first or via `fetchOverview` |
| `fetchIG()` | `ig_profiles_weekly`, `ig_posts` | Calculates engagement rate from posts |
| `fetchAds()` | `marketing_ads` | Counts by platform + active flag |
| `fetchPromos()` | `promotions` | Counts per brand, extracts promo_type[] |
| `fetchProductStats()` | `products` | Min/avg/med/max price per brand |
| `fetchYT()` | `yt_channel_weekly`, `yt_videos` | Subs + view totals |
| `fetchReddit()` | `reddit_mentions` | Counts by sentiment label |
| `fetchInfluencers()` | `influencers`, `influencer_posts` | Joins + avg engagement |
| `fetchAdSample()` | `marketing_ads` | Latest 12 rows with copy/cta text |
| `fetchTopIGPosts()` | `ig_posts` | Sorted by likes |
| `fetchTopYTVideos()` | `yt_videos` | Sorted by views |
| `fetchTopComments()` | `ig_comments`, `yt_comments` | Merged, sorted by likes |
| `fetchYTTrend()` | `yt_channel_weekly` | Weekly subscribers per brand → `Record<slug, number[]>` |
| `fetchRedditTrend()` | `reddit_mentions` | Weekly mention count per brand |
| `fetchRedditSubreddits()` | `reddit_mentions` | Top 6 subreddits by count |
| `fetchPostFrequency()` | `ig_posts` | 4-week × 7-day heatmap per brand |
| `fetchPromoDetails()` | `promotions` | Full promo text + discount % |
| `fetchProductsList()` | `products` | Full product list (limit 500) |
| `fetchCommentCounts()` | `ig_comments`, `yt_comments` | Total comment counts per brand |
| **`fetchOverview()`** | All critical tables | `Promise.all` of 10+ fetchers — used by `/v2` overview page |

#### Pattern: parallel fetch

```ts
export async function fetchOverview(): Promise<V2Overview> {
  const [brands, ig, ads, promos, products, yt, reddit, influencers, adSample, …] =
    await Promise.all([
      fetchBrands(),
      fetchIG(),
      fetchAds(),
      …
    ])
  return { brands, ig, ads, … }
}
```

---

### `lib/shared/supabase.ts`

```ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
```

Module-level singleton — imported by every fetcher in `data.ts`. Uses the **anon key** (public, read-only in practice). The service-role key is only used by Python scripts.

---

### `app/api/generate-content/route.ts`

The only custom server endpoint. Acts as a secure proxy for OpenAI.

**Request:** `POST /api/generate-content`
```json
{ "item_id": "uuid", "content_type": "blog_post" | "instagram_post" }
```

**Flow:**
1. Reads the source item from `market_intel_items` via Supabase
2. Chooses a prompt template (`BLOG_PROMPT` or `INSTAGRAM_PROMPT`)
3. Calls `openai.chat.completions.create()` with model `gpt-4o`
4. Parses the returned JSON (title, body, meta_description, seo_keywords…)
5. Saves to `generated_content` table
6. Returns `{ content, saved: boolean, id?, error? }`

**Output schemas:**

Blog post:
```json
{
  "title": "…",
  "body": "<h2>…</h2><p>…</p>",
  "meta_description": "…",
  "seo_keywords": ["…"],
  "word_count": 900,
  "cta": "…"
}
```

Instagram post:
```json
{
  "caption": "…",
  "hashtags": ["…×12"],
  "image_prompt": "…",
  "best_time_to_post": "…"
}
```

---

### `components/v2/Sidebar.tsx`

Client component. Owns two pieces of state:
- `open: boolean` — mobile drawer open/close
- `collapsed: boolean` — desktop icon-only mode

On `collapsed` change, updates the CSS custom property on `:root`:
```ts
document.documentElement.style.setProperty('--sidebar-w', collapsed ? '60px' : '232px')
```

This single variable propagates to both the sidebar width and `.main`'s `margin-left`, keeping them in sync.

Nav items are defined as a static array:
```ts
const nav = [
  { href: '/v2',             label: 'Executive Overview', ic: I.overview, badge: 'LIVE' },
  { href: '/v2/instagram',   label: 'Instagram',          ic: I.ig },
  …10 total items…
]
```

Active detection: `path === item.href` (exact for `/v2`) or `path.startsWith(item.href)` (prefix for all others).

---

### `components/v2/PageShell.tsx`

Exports reusable UI primitives used across all pages:

| Export | Type | Purpose |
|---|---|---|
| `PageHead` | Component | Page title block (eyebrow, h1, sub, actions slot) |
| `MiniKpi` | Component | KPI metric card (value, sparkline, delta) |
| `SectionInfo` | Component | `?` tooltip icon — hover + click-to-pin |
| `SortTh` | Component | Sortable `<th>` with aria-sort and arrow indicators |
| `LoadingPage` | Component | Full-page shimmer skeleton |
| `Toast` | Component | Success/error notification (auto-dismiss 2.8s) |
| `BrandPill` | Component | Color dot + brand name inline |
| `useSortTable<T>` | Hook | Sort state + sorted array + toggle function |
| `exportCSV` | Function | Converts rows array to a downloaded CSV file |
| `pgColor(slug)` | Function | Returns hex color for a brand slug |
| `pgName(slug, brands)` | Function | Returns display name for a brand slug |
| `fmt(n)` | Function | Number formatter (K / M suffix) |

---

### `components/v2/charts.tsx`

All chart components. SVG-based, hand-rolled (no chart library dependency).

| Component | Props | Notes |
|---|---|---|
| `Sparkline` | `data[], color` | 90×30px line + area fill, no axes |
| `Delta` | `value, pct` | Colored ▲/▼ delta with percentage |
| `StackedArea` | `data[], brands[], colors` | Weekly stacked area, hover per layer |
| `LineChart` | `series[], weeks[]` | Multi-brand lines, end-label deconfliction, crosshair tooltip |
| `ScatterChart` | `points[], xLabel, yLabel` | Brand positioning plot, label-on-hover-only |
| `BubbleChart` | `points[]` | Like scatter but bubble radius = third dimension; iterative repulsion |
| `Donut` | `slices[]` | SVG pie/donut with floating tooltip |
| `BoxPlot` | `rows[]` | Horizontal box-and-whisker per brand |
| `SentimentBar` | `rows[]` | Stacked horizontal sentiment (pos/neu/neg) |

All chart components accept a `w` (width) and `h` (height) prop and render a fixed-size SVG. Tooltips are absolutely-positioned `<div>` elements inside a `position: relative` wrapper.

---

### `components/v2/FooterLinks.tsx`

Renders the footer quick-link buttons. Clicking each opens an `<InfoModal>` (defined in the same file) with explanatory content. Modal state is local to the component.

---

## 5. Database Schema

Supabase project ID: `loecyghnkkxyymelgexz`. Tables used by the dashboard:

| Table | Key columns | Written by |
|---|---|---|
| `brands` | `id, name, slug, is_joola` | Manually seeded |
| `ig_profiles_weekly` | `brand_id, week, followers, following` | Python scraper |
| `ig_posts` | `brand_id, posted_at, likes, comments, views, format` | Python scraper |
| `ig_comments` | `brand_id, post_id, text, likes, sentiment` | Python scraper |
| `yt_channel_weekly` | `brand_id, week, subscribers, videos` | Python scraper |
| `yt_videos` | `brand_id, published_at, title, views, likes, comments, duration` | Python scraper |
| `yt_comments` | `brand_id, video_id, text, likes, sentiment` | Python scraper |
| `reddit_mentions` | `brand_id, mentioned_at, subreddit, sentiment` | Python scraper |
| `marketing_ads` | `brand_id, platform, copy, cta, started_at, is_active` | Python scraper |
| `promotions` | `brand_id, promo_type, discount_pct, banner_text, starts_at` | Python scraper |
| `products` | `brand_id, name, price, category, in_stock` | Python scraper |
| `influencers` | `id, name, brand_id, followers, platform` | Python scraper |
| `influencer_posts` | `influencer_id, posted_at, likes, comments` | Python scraper |
| `market_intel_items` | `id, title, body, source, created_at` | Manual / scraper |
| `generated_content` | `id, item_id, content_type, title, body, meta_description` | API route |

All brand references use `brand_id` (UUID) as the FK. The `brands.slug` is the human-readable key used throughout the frontend (e.g. `"joola"`, `"selkirk"`).

---

## 6. Environment Variables

### Vercel (production + preview)

| Variable | Used by | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/shared/supabase.ts` | Exposed to browser (anon is public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/shared/supabase.ts` | Exposed to browser — read-only |
| `NEXT_PUBLIC_OPENAI_KEY` | `app/api/generate-content/route.ts` | **⚠ should be renamed to `OPENAI_API_KEY` (server-only) — currently leaks to browser bundle** |

### Local `scripts/.env` (gitignored, never commit)

| Variable | Used by |
|---|---|
| `SUPABASE_URL` | Python scripts |
| `SUPABASE_SERVICE_ROLE_KEY` | Python scripts (write access) |
| `APIFY_TOKEN` | Scraping pipeline |

---

## 7. Adding a New Page

1. Create `app/v2/your-page/page.tsx` as `'use client'`
2. Add one or more fetcher functions to `lib/v2/data.ts`
3. Add a nav entry to the `nav` array in `components/v2/Sidebar.tsx`
4. Use `PageHead`, `MiniKpi`, `SortTh`, `SectionInfo`, and chart components from the existing library
5. Do **not** add Tailwind classes — use `v2.css` class names

Template:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { fetchBrands, fetchXxx } from '@/lib/v2/data'
import { PageHead, MiniKpi, LoadingPage, SectionInfo } from '@/components/v2/PageShell'

export default function YourPage() {
  const [data, setData] = useState<any>(null)

  useEffect(() => {
    Promise.all([fetchBrands(), fetchXxx()]).then(([brands, xxx]) => {
      setData({ brands, xxx })
    })
  }, [])

  if (!data) return <LoadingPage />

  return (
    <>
      <PageHead eyebrow="CHANNEL · YOUR PAGE" title="YOUR" accent="PAGE" sub="…" />
      <section id="main">
        <div className="section-head">
          <h2>Section Title <SectionInfo title="…" description="…" source="…" /></h2>
        </div>
        <div className="card card-pad">
          {/* content */}
        </div>
      </section>
    </>
  )
}
```

---

## 8. Adding a New Fetcher

In `lib/v2/data.ts`:

```ts
export type V2YourType = {
  brand: string
  metric: number
}

export async function fetchYours(): Promise<V2YourType[]> {
  const { data } = await supabase
    .from('your_table')
    .select('brand_id, metric_col')
    .order('metric_col', { ascending: false })

  return (data || []).map((row: any) => ({
    brand: row.brand_id,   // ideally join brands to get slug
    metric: row.metric_col ?? 0,
  }))
}
```

If you need the brand slug, either join `brands` in the query or do a two-step fetch and map by `brand_id`.

---

## 9. Python Data Pipeline

The pipeline runs locally (or on a cron server) and has no coupling to the Next.js app. It only writes to Supabase; the dashboard reads from the same database.

```
run_resumable.py
  └── loads pipeline_state.json (checkpoint)
  └── calls scrape_may15.py or apify_to_supabase.py
        └── fetches from Apify actor APIs
        └── writes rows to Supabase (service_role key)
        └── saves progress back to pipeline_state.json
```

To extend the pipeline: add a new Apify actor, write a new Python module that parses the actor output and inserts to a new Supabase table, then add a fetcher in `data.ts` that reads that table.

---

## 10. TypeScript Configuration

```json
{
  "compilerOptions": {
    "strict": true,
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "paths": { "@/*": ["./*"] }
  },
  "exclude": ["node_modules", "_legacy"]
}
```

Key gotcha: `Set` spread (`[...new Set(...)]`) triggers TS2802 in this config. Use `Array.from(new Set(...))` everywhere.

---

## 11. Build & Deploy

```bash
# Local development
npm run dev          # http://localhost:3000

# Type check (run before every push)
npx tsc --noEmit

# Production build (Vercel runs this automatically)
npm run build

# Push to deploy (Vercel auto-rebuilds on push to main)
git push origin main
```

Vercel picks up env vars from the project settings dashboard. No `.env` file is needed on Vercel.

Data changes (new scraper runs) are live immediately without a redeploy — the browser fetches from Supabase at page load time.

---

## 12. Key Constraints & Gotchas

| Issue | Rule |
|---|---|
| TS Set spread | Use `Array.from(new Set(...))` not `[...new Set(...)]` |
| Sidebar position | Must be `position: fixed` — `sticky` breaks on some scroll contexts |
| Chart label overlap | Scatter/bubble: only render labels for JOOLA + hovered brand |
| LineChart empty series | Filter all-zero series before passing to `LineChart` |
| BoxPlot clipping | Needs `w >= 600` due to `padR: 120` for right-side labels |
| Hover on cards with tables | Apply `translateY` only to `.kpi`, `.brief-card`, `.opp-card` — not `.card` |
| Sentiment neutral color | Always use `#94a3b8`, never `--joola` green, for the neutral bar segment |
| OpenAI key exposure | `NEXT_PUBLIC_OPENAI_KEY` leaks to the browser bundle — rename to server-only before production |
| Supabase anon key | Public by design; enforce Row-Level Security policies before production |
| Set spread TS error | `Array.from(new Set(...))` — not `[...new Set(...)]` |
