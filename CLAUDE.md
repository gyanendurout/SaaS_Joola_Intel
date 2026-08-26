# CLAUDE.md — working rules for this repo

How to work in JOOLA Intel. **Rules and invariants only** — no product spec, no
history. If you need something else:

| You need | Read |
|---|---|
| What the product is, who it's for, what's in scope | [BRD.md](BRD.md) |
| Repo map + quickstart | [README.md](README.md) |
| Where a given file lives, end-to-end data flow | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Open work | [TODO.md](TODO.md) |
| Visual conventions, component contracts | [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) |
| Running / debugging the scrapers | [backend/README.md](backend/README.md) |
| Past session logs (pre-2026-05-24 paths) | [docs/CHANGELOG.md](docs/CHANGELOG.md) |

**Do not restate content from those files here.** Each fact has exactly one
home; duplicating it is how this repo's docs went stale before.

---

## Repo shape (the thing most often gotten wrong)

Three independent units since the 2026-05-24 split. There is **no `app/` at the
repo root** and **no `scripts/pipeline/`** — both were moved.

```
frontend/           Next.js 14 dashboard  → Vercel (Root Directory = frontend/)
backend/scraping/   Python scrape + enrich + facts + sales-intelligence
analytics_backend/  Python marts + statistics (runs after scraping)
scripts/            Cross-cutting utilities (weekly_run.py, deploy.ps1, db_verify.py)
migrations/         SQL, shared by both Python units
```

Frontend paths are `frontend/app/v2/…`, `frontend/lib/v2/…`,
`frontend/components/v2/…`, `frontend/app/v2.css`. Always include the
`frontend/` prefix.

---

## Invariants — breaking these breaks the product

### 1. Share of Voice must be recomputed under a brand filter

The DB `share` field on `v2_ads` is precomputed across all 11 brands. It is
**wrong** whenever a brand filter is active. Always derive from the filtered
list:

```ts
const totalAds = displayAds.reduce((s, a) => s + a.total, 0)
const sov = totalAds > 0 ? (d.total / totalAds * 100) : 0
```

### 2. `isFiltered` contract

In `frontend/lib/v2/BrandFilterContext.tsx`:

```ts
isFiltered: selectedSlugs.length > 0 && selectedSlugs.length < allBrands.length
```

`true` → filter active, banner shown, `displayXxx` arrays are sliced.
`false` → show everything (nothing selected **or** everything selected).
Never simplify this to `selectedSlugs.length > 0`.

### 3. Engagement-rate outliers

Filter `followers >= 50` before any ER ranking, chart, or "top performer" list.
Scraping artifacts with 1 follower produce ~69,000% ER and destroy every axis.

### 4. Brand display names

Render brand labels through `pgName(slug, brands)` from
`frontend/components/v2/PageShell.tsx`. It looks the name up and then applies
`displayBrandName()`, which owns the rename map (Franklin → Franklin
Pickleball). Call `displayBrandName(slug, name)` directly only when you already
have the raw name and no `brands` array.

**Known bypass:** `productIntel.ts` and `campaignOfferIntel.ts` build a
`brandName` field straight from `brands.name`, and Product / Sales / Campaign
& Offer Intel render it unmodified — so the override does not apply there. Do
not copy that pattern into new code; the fix is tracked in TODO.md.

### 5. Scraper targets live in the database, not in Python

Handles for Instagram / X / TikTok / YouTube and the influencer roster are
seeded via `migrations/`. To change what gets scraped, update the DB row — never
hardcode a handle in a scraper.

---

## Conventions

- **v2 pages are all `'use client'`.** Supabase reads are filtered by
  user-selected brand state, so server components don't fit.
- **v2 uses custom CSS, not Tailwind.** All styles live in
  `frontend/app/v2.css`. Tailwind is installed but unused by `app/v2/*`.
- **`Array.from(new Set(...))`**, not `[...new Set(...)]` — the spread form
  raises TS2802 under this tsconfig.
- **No "Export brief" button.** It was removed from every page and should not
  return.
- **Card hover:** if a card contains a list / table / heatmap, the card itself
  must not transform on hover — put the pop on the inner row class. Whole-card
  lift is reserved for self-contained units (KPI cards, brief cards).
- **Direct Supabase reads.** Browser components call Supabase via the anon key;
  there is no custom read API layer. Only `frontend/app/api/*` routes are
  server-side.

---

## Product rules that are also code rules

These are specified in [BRD.md](BRD.md) §10 and enforced at review time. Listed
here only as a checklist — the spec is in BRD.md:

- Every KPI, section heading, and table column header carries a layman tooltip
- No duplicate KPI rows (the compact summary strip is canonical)
- No page-level global filter bars
- Every multi-point chart has a floating React-state hover tooltip — SVG
  `<title>` alone is not enough
- Quadrant charts split by **median**, with tinted quadrants and corner labels
- JOOLA renders `#22c55e`; accent is `#F5E625`

---

## Before you push

Run from `frontend/`:

| Gate | Command |
|---|---|
| Typecheck | `npm run type-check` |
| Typecheck + lint | `npm run validate` |
| Fast regression (skip build) | `npm run qa:fast` |
| Full regression | `npm run qa` |
| QA-gated deploy | `npm run deploy -- -Message "..."` |

`.husky/pre-push` runs `frontend/qa/regression.ps1`. On a fresh clone, enable it
with `git config core.hooksPath .husky`.

---

## Known soft spots

- **`/v2` redirects to `/v2/overview`, not `/v2/ask-intel`.** The comment at the
  top of `frontend/app/v2/page.tsx` still says otherwise — Executive Overview
  was retired in May 2026 and later reinstated as the home page. Trust the
  `redirect()` call, not the comment.

- **`docs/DATABASE_RECOVERY.md`, `docs/FRONTEND_REBUILD.md`, `docs/RUNBOOK.md`,
  `docs/DEPLOYMENT.md`** still carry some pre-split paths in their command
  blocks. Trust `backend/README.md` and `docs/ARCHITECTURE.md` over them.
- **`docs/DATABASE.md`** row counts are last-observed values, not live. Run
  `python scripts/db_verify.py` for current state.
- `.claude/settings.local.json` (gitignored) holds permission grants using
  pre-split script paths; expect re-prompts.
- Node is unreliable on the build host — `bunx tsc --noEmit` is the working
  typecheck fallback.
