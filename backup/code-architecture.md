# JOOLA Intel — Code Architecture (Quick Reference)

> **Snapshot date:** 2026-05-19
> This is the at-a-glance map. For deep recovery procedures, see `08_RUNBOOK.md` and `05_FRONTEND_REBUILD.md`.

## Deployment model

```
┌──────────────────────────────────────────────────┐
│ Single Next.js 14 app (App Router)               │
│  app/v2/* (pages) + app/api/* (routes)            │
│  → deployed to Vercel from `main` branch          │
└────────────┬─────────────────────────────────────┘
             │
       ┌─────┴──────┐
       ▼            ▼
┌─────────────┐ ┌─────────────┐
│  Supabase   │ │  OpenAI API │
│  (Postgres) │ │  (gpt-4o)   │
└─────────────┘ └─────────────┘
       ▲
       │ (write-only)
┌────────────────────────────────────┐
│ scripts/pipeline/*.py (local+cron) │
│ Apify scrapers + AI enrichers      │
└────────────────────────────────────┘
```

## Directory tree (top level)

```
joola-intel-nextjs/
├── app/                          # Next.js App Router
│   ├── v2/                       # Dashboard pages (all 'use client')
│   │   ├── layout.tsx            # Wraps BrandFilterProvider + sidebar
│   │   ├── page.tsx              # Executive Overview
│   │   ├── instagram/page.tsx
│   │   ├── youtube/page.tsx
│   │   ├── reddit/page.tsx
│   │   ├── comments/page.tsx
│   │   ├── influencers/page.tsx
│   │   ├── ads/page.tsx
│   │   ├── promotions/page.tsx
│   │   ├── products/page.tsx
│   │   ├── market/page.tsx
│   │   ├── twitter/page.tsx
│   │   └── tiktok/page.tsx
│   ├── api/                      # Server endpoints
│   │   ├── generate-content/route.ts
│   │   ├── keyword-research/route.ts
│   │   ├── content-brief/route.ts
│   │   └── seo-analyzer/route.ts
│   └── v2.css                    # All dashboard styles (no Tailwind for v2)
│
├── components/v2/
│   ├── Sidebar.tsx               # Nav (Analytics + Social Media groups)
│   ├── BrandFilterDropdown.tsx   # Global brand filter (top right)
│   ├── PageShell.tsx             # PageHead, MiniKpi, SectionInfo, SortTh, LoadingPage, pgColor, pgName, displayBrandName
│   └── charts.tsx                # LineChart, ScatterChart, Donut, BoxPlot, BubbleChart, SentimentBar, StackedArea
│
├── lib/
│   ├── v2/
│   │   ├── data.ts               # All Supabase fetchers (fetchBrands, fetchIG, fetchAds, ...)
│   │   └── BrandFilterContext.tsx# React Context for global brand filter + localStorage persistence
│   ├── api/                      # Standardized API response helpers
│   ├── db/                       # Typed Supabase client factory
│   └── shared/
│       ├── content-brief/        # ContentBrief agent (POST /api/content-brief)
│       └── seo-analyzer/         # SEO audit agent (POST /api/seo-analyzer)
│
├── scripts/                      # NOT deployed with Next.js
│   ├── deploy.ps1                # PowerShell deploy gate (QA → commit → push)
│   ├── browser_audit.mjs         # one-off Playwright audit script
│   ├── .env                      # SUPABASE/APIFY/OPENAI keys (gitignored)
│   ├── .env.example              # template
│   └── pipeline/                 # Python data pipeline
│       ├── apify_to_supabase.py      # Master scraper orchestrator
│       ├── enrich_with_ai.py         # GPT-4o-mini sentiment/topic/NER
│       ├── populate_mention_facts.py # Fact-table builder
│       ├── populate_topic_lifecycle.py # Topic lifecycle aggregator
│       ├── run_resumable.py          # resumable orchestrator (writes pipeline_state.json)
│       ├── count_rows.py             # quick row-count check across all tables
│       └── ...                       # plus recovery + test scripts
│
├── migrations/                   # SQL migrations 001 → 009 (run in order)
│
├── backup/                       # THIS DIRECTORY — disaster recovery package
│
├── e2e/                          # Playwright E2E tests
│   └── smoke.spec.ts             # All routes + nav + 404 + API routes
│
├── qa/                           # QA artifacts
│   ├── regression.ps1            # 4-stage gate: typecheck → build → routes → playwright
│   ├── playwright-report/        # (gitignored) HTML report
│   └── test-results/             # (gitignored) traces, videos
│
├── .claude/                      # Claude Code agents + commands (portable)
│   ├── agents/                   # qa-runner, backup-curator, session-archivist, brd-curator
│   ├── commands/end-session.md   # /end-session orchestrator
│   └── settings.json             # Hooks: PostToolUse log, PreToolUse git push warn
│
├── .husky/pre-push               # Calls qa/regression.ps1 before any push
├── playwright.config.ts          # Chromium, baseURL from env, reports to qa/
├── tsconfig.json                 # strict + paths {"@/*": ["./*"]}
├── next.config.js                # Security headers, strict build
└── package.json                  # next 14.2.5, react 18, @supabase, openai, playwright
```

## Data flow

```
1. Scrape   :  scripts/pipeline/apify_to_supabase.py     →  Supabase raw tables
                (ig_posts, ig_profiles_weekly, marketing_ads, promotions,
                 reddit_mentions, reddit_comments, x_posts, tiktok_videos,
                 youtube_videos, products, ...)

2. Enrich   :  scripts/pipeline/enrich_with_ai.py        →  Supabase enrichment cols
                (sentiment, topic, brand_mentioned, crisis_flag, purchase_intent)

3. Aggregate:  scripts/pipeline/populate_mention_facts.py
               scripts/pipeline/populate_topic_lifecycle.py
                                               →  mention_facts, topic_lifecycle

4. Read     :  lib/v2/data.ts (anon key)        →  React components render
```

## Dependencies (top-level)

| Package | Purpose |
|---|---|
| `next` 14.2.5 | App Router framework |
| `react` 18 / `react-dom` 18 | UI |
| `@supabase/supabase-js` 2.45 | Postgres client (read from browser, write from scripts) |
| `openai` 6.33 | LLM calls for content-brief, seo-analyzer |
| `cheerio` 1.2 | HTML parsing for SEO analyzer |
| `@playwright/test` 1.49 | E2E test runner (dev) |
| `husky` 9 | Git hook installer (dev) |
| `tailwindcss` 3.4 | Configured but unused on v2; legacy from earlier scaffolding |

## Coding conventions

- **v2 pages**: all `'use client'`. Server components not used here because Supabase reads are filtered per user-selected brand state.
- **Styles**: custom CSS in `app/v2.css`. Tailwind classes are NOT used inside `app/v2/*`. Tailwind config exists for legacy reasons.
- **Brand display**: always go through `displayBrandName(slug, fallback)` from `components/v2/PageShell.tsx`. Handles renames (e.g. Franklin → Franklin Pickleball) in one place.
- **Brand filter**: always read `filteredBrands`, `isFiltered`, `setAllBrands` from `useBrandFilter()`, and pipe lists through `applyBrandFilter(list, filteredBrands, isFiltered)`. The DB `share` field on `v2_ads` is global — recompute SoV from `displayAds` when a filter is active.
- **Engagement-rate outliers**: filter brands with < 50 followers before any ER ranking. A 1-follower account creates astronomical ER and breaks charts. See `app/v2/page.tsx` `EngagementMatrix`, `MoversAndSignals`, and `Briefing`.
- **TypeScript**: `Set` spread errors with some configs — use `Array.from(new Set(...))` not `[...new Set(...)]`.

## QA gates (in order of speed)

| Gate | Command | Time |
|---|---|---|
| Typecheck | `npm run type-check` | ~3s |
| Lint | `npm run lint` | ~5s |
| Validate (both above) | `npm run validate` | ~8s |
| Fast regression (skip build) | `npm run qa:fast` | ~30s if dev server up |
| Full regression | `npm run qa` | ~60–90s |
| Deploy | `npm run deploy -- -Message "..."` | ~2 min including push |

## Test arrays — backup-curator owns these

| Array | File | Source of truth |
|---|---|---|
| `PAGES` | `e2e/smoke.spec.ts` | every `app/v2/**/page.tsx` |
| `API_ROUTES` | `e2e/smoke.spec.ts` | every `app/api/**/route.ts` |
| `$ROUTES` | `qa/regression.ps1` | matches `PAGES` |
| `### Pending POC → prod hardening` | `CLAUDE.md` | updated by `brd-curator` |
