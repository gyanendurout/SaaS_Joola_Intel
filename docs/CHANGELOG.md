# Changelog

Historical session logs, extracted from `CLAUDE.md` on 2026-08-14 so that
`CLAUDE.md` can stay a short, current set of working rules.

**These entries describe the pre-2026-05-24 repo layout**, when the Next.js app
lived at the repo root (`app/v2/`, `lib/v2/`, `components/v2/`) and the Python
pipeline lived in `scripts/pipeline/`. Paths below are historical and are *not*
valid against the current tree — see [ARCHITECTURE.md](ARCHITECTURE.md) for
where those files live today.

For changes after 2026-05-19, read `git log`.

---

## Session Log (Latest Changes — 2026-05-15)
- `app/v2.css`: Sidebar → `position: fixed`, added `--sidebar-w` CSS var, collapse classes, mobile overrides
- `components/v2/Sidebar.tsx`: Added collapse/expand toggle with chevron icons, `useEffect` syncing CSS var
- `components/v2/charts.tsx`: ScatterChart label-on-hover, LineChart floating tooltip
- `app/v2/influencers/page.tsx`: Bubble chart label-on-hover (renamed `r` → `bR`)
- All 9 page files: Removed Export brief button

## Session Log — VIZ Defects Round (2026-05-15)
Fixed 28-item visual defect report (`VIZ-01` through `VIZ-28`):

### charts.tsx (mass overhaul)
- **VIZ-01** LineChart: `fmt()` and `y()` guard with `isFinite`; series with all-zero data filtered out; `<text>` only rendered when `labelY` is finite.
- **VIZ-09** LineChart: deconflict end-of-line labels — sort by y, push down by `minLabelGap=14`, add connector line.
- **VIZ-10/14** LineChart: per-week crosshair + multi-series tooltip on mouse-move over chart area; shows top 6 series sorted by value.
- **VIZ-02** StackedArea: detects layer + week from mouse position; highlights hovered layer (opacity 1, stroke 1.5); floating tooltip with `Week N: V ads`.
- **VIZ-11** BoxPlot: per-row hover with full stats tooltip (Min/Med/Avg/Max + count); transparent row hit-area; wider `padR=120` so labels don't clip (VIZ-22).
- **VIZ-26** Donut: `<title>` SVG tooltip + floating `.tip` div with name + pct on hover.
- **VIZ-25** SentimentBar: neutral band now uses fixed `#94a3b8` gray (not brand color) so green/positive convention is never confused.

### PageShell.tsx
- **VIZ-16** SortTh: ARIA `aria-sort`, larger arrows (9px), active arrow scales to 1.35x in yellow. CSS at v2.css:815-826 unchanged in selectors, tightened active state to scale-transform.
- **VIZ-21** MiniKpi: added `title={src}` to `.src` span for full-name reveal on hover.
- **VIZ-28** SectionInfo: now click-aware; clicking `?` pins popup open; outside click + Esc to dismiss. Hover still works for desktop quick-glance.

### v2.css
- **VIZ-03/19** `.trend-row` grid: `30px 160px minmax(120px,1fr) 50px auto` — third column gives mtrack explicit room (previously 0 width). `.mtrack`: `height: 8px; min-width: 80px; width: 100%`.
- **VIZ-16** Sort arrows: increased to 9px, active uses `transform: scale(1.35)` + yellow color.
- **VIZ-28** Added `.section-info.is-pinned .si-popup { display: block }`.

### Per-page fixes
- **VIZ-05/06/20** `influencers/page.tsx`: iterative bubble repulsion (60 iters, gap=3px, clamped to chart area); per-bubble label deconflict (push down 11px when within 60px horizontally); all athletes get labels with text stroke for readability; quadrant labels in corners with backing rect (`rgba(7,9,14,0.78)`).
- **VIZ-17** `ads/page.tsx`: Copy column now sortable (`col="copy"`). All brands in StackedArea series + legend (was sliced to 6).
- **VIZ-18** `youtube/page.tsx`: Title column now sortable (`col="title"`).
- **VIZ-15** `reddit/page.tsx`: subreddit row gets full `title=` tooltip + clickable subreddit link to reddit.com.
- **VIZ-03 markup** `reddit/page.tsx`: trend-row pill uses brand color gradient (was hard-coded green for JOOLA which clashed with positive sentiment color). Also added `title=` summary on the row.
- **VIZ-23** `promotions/page.tsx`: Promotion text cell uses `maxWidth: 380; overflow:hidden; textOverflow:ellipsis` + full `title=` reveal.
- **VIZ-27** `promotions/page.tsx`: Heatmap cells `title=` now includes brand, week, and active state.

### Architecture notes
- `SectionInfo` is the only stateful "hover or click" pattern — uses `useEffect` with `mousedown` + `keydown` listeners scoped to pinned state.
- LineChart filters out empty series early; downstream code shouldn't pass series with all-zero data, but if it does, an "No data available" message renders instead of NaN labels.
- BoxPlot now needs `w >= 600` to avoid label clipping due to `padR=120`. Default `w=760` is safe.
- Bubble collision uses simple O(n²) repulsion — fine for <50 athletes. If athlete count grows, switch to D3 forceSimulation.

## Session Log — Hover-Pop Behavior (2026-05-15, follow-up)
**Problem**: Entire `.card` was lifting on hover (`translateY(-5px) scale(1.008)`), making the whole list/table box pop instead of individual rows/cells inside.

**Fix**: Decoupled card-level lift from inner-row pop.

### v2.css changes
- `.card:hover` now applies **shadow + border only** (no transform). Cards that contain interactive lists feel stable; the inner content becomes the focus.
- `.kpi:hover`, `.brief-card:hover`, `.opp-card:hover` **keep** the lift (those ARE the interactive unit).
- New per-row hover rules:
  - `.signal:hover` — translateX(4px) + yellow inset border + shadow
  - `.trend-row:hover` — translateX(4px) + mfill brightens
  - `table.data tbody tr:hover` — translateX(3px) + yellow tint + shadow
  - `.heatmap .h-cell:hover` — scale(1.25) + glow + z-index raise
  - `.tier-row:hover` / `.tier-seg:hover` — row lifts, individual segment scales vertically (1.6x)
  - `.cadence-cell:hover` — scale(1.4) + glow
  - `.sent-row:hover` — row lifts, bars brighten

### Class additions for inline-styled cells
- `app/v2/products/page.tsx` price-tier bars → `.tier-row` on each brand, `.tier-seg` on each value/mid/premium div
- `app/v2/instagram/page.tsx` posting cadence cells → `.cadence-cell` on each day cell; richer tooltip with brand + week + day
- `components/v2/charts.tsx` `SentimentBar` → `.sent-row` on each row

### Pattern to follow
**Rule of thumb**: if a card contains a list/table/heatmap, the card itself should NOT transform on hover. Add a class to each inner row and apply the pop there. Reserve whole-card lift for self-contained units (KPI cards, brief cards, opportunity cards).

## Session Log — POC Deployment to Vercel (2026-05-15)

### Repo & deploy setup completed
1. **`.gitignore` extended** — added `.env*`, `.claude/`, `__pycache__/`, `*.pyc`, `.venv/` (was missing `.env*` — would have leaked `.env.local`)
2. **Git init + first push** — initial commit `5fad664` (then amended to `6135ca9` after secret removal)
3. **Secret scrubbing** — GitHub blocked the first push (secret scanner caught hardcoded Supabase service-role key + Apify token in 4 Python files + 1 markdown doc):
   - `scripts/pipeline/count_rows.py:5`
   - `scripts/pipeline/fix_missing_data.py:18,21`
   - `scripts/pipeline/scrape_may15.py:20,23`
   - `scripts/pipeline/apify_to_supabase.py:45,49`
   - `docs/WHERE_WE_LEFT_OFF.md:62,64`
4. **Patched all 4 Python scripts** to read from `os.environ` with optional `python-dotenv` loader:
   ```python
   import os
   try:
       from dotenv import load_dotenv
       load_dotenv(); load_dotenv("scripts/.env")
   except ImportError:
       pass
   SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
   APIFY_TOKEN  = os.environ["APIFY_TOKEN"]
   ```
5. **Created `scripts/.env`** (gitignored) with the original values so scripts keep running locally
6. **Created `scripts/.env.example`** as template (committed) with placeholder values
7. **Vercel import** — connected GitHub repo, pasted 3 env vars via "paste .env contents" option, deployed
8. **Verified live** at https://saas-joola-intel.vercel.app/v2/reddit

### Commit author identity
Used inline env vars (not `git config`) since Git safety protocol forbids modifying git config:
```bash
GIT_AUTHOR_NAME="Gyanendu Rout" GIT_AUTHOR_EMAIL="gyanendu1197@gmail.com" \
GIT_COMMITTER_NAME="Gyanendu Rout" GIT_COMMITTER_EMAIL="gyanendu1197@gmail.com" \
git commit -m "..."
```

### Local dev workflow going forward
```bash
# Code change → push → Vercel auto-deploys
git add . && git commit -m "..." && git push

# Data refresh → run local Python (writes to Supabase, no redeploy needed)
cd c:\Workspace\joola-intel-nextjs
pip install python-dotenv requests  # one-time
python scripts/pipeline/run_resumable.py
```

### Architecture clarification (asked + answered this session)
- **Single deployable Next.js app** — frontend + API routes bundled, deployed to Vercel
- **Supabase** = managed Postgres, browser reads directly via anon key (no custom API layer)
- **Python scripts** = run locally on laptop, write to Supabase via service-role key, NOT deployed with Next.js
- Vercel auto-ignores `scripts/`, `design/`, `docs/`, `migrations/`, `_legacy/` since they're outside the Next.js dep graph

---

## Session Log — Brand Filter UX + QA Bug Fixes (2026-05-16)

### Brand filter panel UX overhaul
- **Sidebar.tsx**: Moved `<BrandFilter />` from bottom of sidebar to **top** (above nav links), defaulting to open (`useState(true)`). Previously it was invisible because 10 nav links pushed it off-screen.
- **BrandFilterContext.tsx**: Added `useEffect` to auto-fetch brands on mount — filter panel now populates independently of page loading (no more empty panel on first visit).
- **v2.css**: `.bf-wrap` border moved from top to bottom; `.bf-list` max-height reduced to `180px` to fit at top of sidebar.

### 7 QA bugs fixed (commit `054757f`)

| Bug | File | Fix |
|-----|------|-----|
| BUG-01 | `ads/page.tsx` | SoV KPI + rank + bar chart + bar % all now computed from `displayAds` (filtered). DB `share` field is global — recomputed as `d.total / totalAds * 100` |
| BUG-02 | `promotions/page.tsx` | Eyebrow brand count: `brandsWithPromos` → `displayPromos.length` |
| BUG-03 | `promotions/page.tsx` | Sub text brand count: `promos.length` → `displayPromos.length` |
| BUG-04 | `promotions`, `comments`, `youtube` | "across all brands" → `` `across ${displayXxx.length} brands` `` |
| BUG-05 | `reddit`, `comments`, `ads` | "All brands" dropdown → `All ${displayXxx.length} brands` |
| BUG-06 | `BrandFilterContext.tsx` | `isFiltered` was `selectedSlugs.length > 0` — showed yellow banner even when all brands manually re-selected. Fixed: `selectedSlugs.length > 0 && selectedSlugs.length < allBrands.length` |
| BUG-07 | `Sidebar.tsx` | Last-brand tooltip updated to warn that removing it resets to all brands |

### Key invariant: Share of Voice recalculation
The DB `share` field on `v2_ads` rows is pre-computed across all 11 brands. **Never use it for KPIs when a brand filter is active.** Always recompute dynamically:
```ts
const totalAds = displayAds.reduce((s, a) => s + a.total, 0)
// SoV for JOOLA:
const joolaSOV = (joolaAd.total / totalAds * 100).toFixed(1) + '%'
// Bar chart share for any brand:
const barShare = (totalAds > 0 ? d.total / totalAds * 100 : 0).toFixed(1) + '%'
```

### `isFiltered` contract (never break this)
```ts
// In BrandFilterContext.tsx
isFiltered: selectedSlugs.length > 0 && selectedSlugs.length < allBrands.length
// true  → filter is active, FilterBanner shown, displayXxx arrays are sliced
// false → show all brands (either nothing selected OR all selected)
```

---

## Session Log — QA Infra + Audit Fixes + Project Reorg (2026-05-19)

Commit `755681f` (pushed alongside the prior unpushed `ed16631`).

### Files touched

**Source code (9 fixes from the senior-QA audit):**
- `app/v2.css` — `.section-nav` now `flex-wrap: wrap` (B1)
- `app/v2/page.tsx` — ER outlier filter (D2), promo-% rounding (D1), sentiment caveat (D3), briefing-card grammar (M4)
- `app/v2/instagram/page.tsx` — heading "by likes" → "by engagement rate" (D5)
- `app/v2/youtube/page.tsx` — Pending KPI no fake spark (B4); "1 videos" → "1 video" (B3)
- `app/v2/products/page.tsx`, `app/v2/market/page.tsx` — `document.title` set (M1)

**QA infrastructure (new):**
- `playwright.config.ts`, `e2e/smoke.spec.ts` — 12 v2 routes + 4 API routes + nav + 404
- `qa/regression.ps1` — 4-stage gate (typecheck → build → routes → playwright); writes `c:\tmp\joola-intel-qa-passed.flag`
- `qa/.gitignore` — excludes `playwright-report/`, `test-results/`
- `.husky/pre-push` — secondary gate calling regression.ps1
- `scripts/deploy.ps1` — QA-gated deploy command (required `-Message`, `-SkipQa` override)
- `.claude/agents/{qa-runner, backup-curator, session-archivist, brd-curator}.md` — portable agent team
- `.claude/commands/end-session.md` — orchestrator
- `.claude/settings.json` — PostToolUse Write/Edit → `c:\tmp\joola-intel-session-changes.log`; PreToolUse `git push` → warns if QA flag missing

**Project reorg:**
- Deleted `docs/` (4 files: `BUSINESS_REQUIREMENTS.md`, `CODE_ARCHITECTURE.md`, `DESIGN_SYSTEM.md`, `WHERE_WE_LEFT_OFF.md` — duplicates of `backup/` or obsolete)
- Moved 14 Python pipeline scripts + 2 markdown logs to `scripts/pipeline/`
- Bulk sed rewrite: `scripts/X.py` → `scripts/pipeline/X.py` across `CLAUDE.md` + 8 `backup/*.md` + `.claude/agents/` + `app/v2/{twitter,tiktok}/page.tsx`
- New: `backup/code-architecture.md` (at-a-glance reference doc)

**Config:**
- `package.json` — added `@playwright/test ^1.49`, `husky ^9`; added scripts `test:e2e`, `test:e2e:ui`, `qa`, `qa:fast`, `deploy`, `prepare`
- `.gitignore` — un-ignored `.claude/{agents,commands,settings.json}`; ignore `**/pipeline_state.json` (covers any cwd)
- `tsconfig.json` — exclude `e2e/`, `playwright.config.ts`, `qa/playwright-report`, `qa/test-results` (keeps typecheck green until `npm install`)
- `backup/README.md` — index row 10 added for `code-architecture.md`

### Bugs fixed

| ID | Severity | File | Fix |
|---|---|---|---|
| B1 | P1 | `app/v2.css:545` | `.section-nav` `flex-wrap: wrap`; removed hidden-scrollbar rules; removed `::after` fade. All 10 nav anchors visible without overflow scroll. |
| D2 | P1 | `app/v2/page.tsx` | Filter `r.followers >= 50` in `EngagementMatrix`, `MoversAndSignals` engRanked, `Briefing` engagement-gap card, `Opportunities` content card. Paddletek (1 follower, 69708% ER) no longer skews charts. |
| B4 | P1 | `app/v2/youtube/page.tsx:126` | `spark={joolaYT && joolaYT.subs > 0 ? (displayTrend['joola'] \|\| []) : undefined}` — no fake sparkline when "Pending". |
| D5 | P2 | `app/v2/instagram/page.tsx:191` | "Top performing posts · by likes" → "Top performing posts · by engagement rate" (matches actual sort). |
| D1 | P2 | `app/v2/page.tsx` (4 places) | Promo % standardized to `toFixed(1)` in Briefing body, price-war text, bar-row `delta-mini`, Opportunities body + why. |
| D3 | P2 | `app/v2/page.tsx:451` | `CommunitySection` checks `rd.every(r => r.positive===0 && r.negative===0)` and renders a yellow "Sentiment classifier in calibration" caveat when true. |
| B3 | P3 | `app/v2/youtube/page.tsx:211` | `{d.videos} {d.videos === 1 ? 'video' : 'videos'}` — proper pluralization. |
| M4 | P3 | `app/v2/page.tsx:81` | Briefing card grammar: "beats JOOLA at N× the audience" → "is N× JOOLA's (X%) on a smaller audience" (semantically correct ER-ratio + grammatical). |
| M1 | P4 | `products/page.tsx`, `market/page.tsx` | Added `useEffect(() => { document.title = 'JOOLA INTEL — Product Catalog' / 'Market Intel' }, [])`. |

**Not addressed** (out of code scope): B2 intermittent render lag, UX5 "Assign" button no-op (needs task backend), CP1–CP4 brand-color audit (needs design review), most M5 table-header naming (largely covered by earlier `displayBrandName()` work).

### Decisions made

- **Single Next.js app, no `frontend/`/`backend/` split** — applied the SaaS_Joola_pulse blueprint with adaptations. Python scrapers in `scripts/pipeline/` are NOT a long-running API; skipped the backend pytest stage. Next.js API routes (`/api/{generate-content,keyword-research,content-brief,seo-analyzer}`) tested inline via Playwright's `request` fixture.
- **No staging repo** — per project convention, `main` IS the Vercel deploy branch. `scripts/deploy.ps1` collapses to QA → commit → push.
- **Refresh `backup/` in place** — existing 9-doc recovery package is solid; added `code-architecture.md` rather than rewriting.
- **Tier A + B cleanup, deferred Tier C** — `utils/`, `hooks/`, `constants/`, `types/` stay at root for now. Collapse into `lib/` would require ~10–20 import path changes and deserves its own focused commit + run-time smoke.
- **`flex-wrap` for nav over JS scroll arrows** — CSS-only fix is portable, doesn't require a state hook or scroll detection.
- **`followers >= 50` threshold for ER outliers** — 1-follower accounts are unambiguously scraping artifacts. Real micro-influencers will still appear; a brand with truly < 50 followers isn't a meaningful competitor.

### Next steps (one-time setup on dev machine)

```powershell
npm install                     # installs @playwright/test + husky; husky wires .husky/pre-push via "prepare" script
npx playwright install chromium # ~130 MB browser binary
```

Then `npm run qa` runs the full local regression, `npm run deploy -- -Message "..."` is the standard ship path. The `.husky/pre-push` hook fires automatically on every direct `git push` once husky is installed.

### Notes / known soft spots

- `.claude/settings.local.json` (gitignored) still holds permission grants like `Bash(python scripts/X.py)` from before the reorg. Will silently re-prompt the next time the user runs `python scripts/pipeline/X.py`. Harmless.
- `scripts/pipeline_state.json` exists at the OLD location (sibling to `pipeline/`); future `run_resumable.py` runs from repo root will write `./pipeline_state.json` at the repo root. Both are gitignored via the new `**/pipeline_state.json` rule.
- The `c:\tmp\joola-intel-session-changes.log` for THIS session is empty — the PostToolUse hook only activates from the next session onward (settings.json was authored mid-session, after the agent had already started).


---

## Session Log — Weekly scrape + two data-loss bugs fixed (2026-08-17)

Full pipeline run (`--module all --restart`): **21,131 rows** across 42 steps,
plus a catch-up chain that recovered what two latent bugs were destroying.

### Bugs fixed
| Bug | Symptom | Fix |
|----|-----|------|
| Unapplied migrations 018 + 020 | `PGRST204 post_url does not exist` killed every `ig_comments` batch — 100% loss | `sb.upsert()`/`sb.insert()` strip the absent column and retry; gap recorded in `SCHEMA_GAPS` and printed in the run summary |
| No dedupe on conflict key | `21000 ON CONFLICT cannot affect row a second time` dropped whole batches in `influencer_posts`, `reddit_mentions` | `sb.upsert()` dedupes by the `on_conflict` tuple (last-write-wins) before batching |

`reddit_scrape_mentions` had been logging `✓ 0 Reddit mentions upserted` and
reporting `done` — a total failure presented as success.

### Files touched
- `backend/scraping/core/supabase_client.py` — `_strip_missing_column()`, `SCHEMA_GAPS`,
  conflict-key dedupe in `upsert()`, fail-fast PGRST204 in `patch()`
- `backend/scraping/run.py` — end-of-run SCHEMA GAPS report
- `backend/scraping/sources/instagram/scrape_influencers.py` — dedupe now central
- `migrations/022_schema_gap_repair.sql` — new; 018 + 020 DDL, minus 020's table-wiping DELETE

### Decisions made
- Decision: `upsert()` strips a missing column, `patch()` does not. Reason: a PATCH
  payload *is* the enrichment result — writing only `enriched_at` would mark rows
  enriched while storing nothing. Tradeoff: enrichment stalls visibly on a schema
  gap rather than degrading silently.
- Decision: omitted `delete from competitor_switch_events where source_mention_id
  is null` from migration 020. Reason: 020 adds that column, so it is NULL on every
  pre-existing row — the statement would have deleted all 80 rows of defection data.
  Tradeoff: legacy NULL-keyed rows won't dedupe until `source_mention_id` is backfilled.

### Verified after
`mention_facts` 0 → 5,042 · `ig_comments` 6,731 → 8,703 · `product_snapshots`
~29,479 → 38,058 (crawl4ai contributed 8,579) · `topic_lifecycle` 44,341
