# JOOLA Intel — Claude Session Memory

## Project Overview
Next.js 14 dashboard (`/app/v2/`) — Pickleball competitive intelligence platform.
Dark-themed, data-rich, chart-heavy. Uses custom CSS (`app/v2.css`), not Tailwind.

## Deployment & Architecture (IMPORTANT)
**This is a SINGLE deployable Next.js 14 app.** Not a separate frontend + backend.

```
┌───────────────────────────────────────────────┐
│  Next.js 14 App (App Router)  — single deploy │
│                                                │
│  ┌─────────────────┐    ┌──────────────────┐ │
│  │ Frontend pages  │    │ API Routes       │ │
│  │ /app/v2/*       │    │ /app/api/*       │ │
│  │ React Server +  │    │ Serverless       │ │
│  │ Client comps    │    │ functions        │ │
│  └────────┬────────┘    └────────┬─────────┘ │
│           │                       │            │
│           └──────────┬────────────┘            │
└───────────────────────┼────────────────────────┘
                        │
        ┌───────────────┼────────────────┐
        ▼                                ▼
┌──────────────────┐            ┌──────────────────┐
│ Supabase (cloud) │            │ OpenAI API       │
│ PostgreSQL DB    │            │ (LLM calls from  │
│ + auth           │            │  api routes)     │
└──────────────────┘            └──────────────────┘
        ▲
        │ (writes only)
┌──────────────────────────────────┐
│ Python scripts (scripts/*.py)    │ ← SEPARATE, runs locally/cron
│ Scrape & populate Supabase       │   NOT deployed with the app
└──────────────────────────────────┘
```

- **Deploy target**: Vercel (recommended) or any Node host. One `npm run build && npm start`.
- **Backend logic lives inside Next.js**:
  - **API routes**: `app/api/generate-content/route.ts` — OpenAI content generation (the only custom server endpoint)
  - **Direct Supabase queries**: `lib/v2/data.ts` uses `@supabase/supabase-js` directly from client components — no custom API layer needed for reads
- **Database**: Supabase (managed Postgres). Connected via `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Python pipeline** (`scripts/`): scrapes Instagram/YouTube/Reddit/Ads via Apify, writes to Supabase. **Runs separately** — does NOT ship with the Next.js build. Trigger it on cron / Mondays.

### Required env vars at deploy
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_OPENAI_KEY` (only if `/api/generate-content` is used)

### Dependencies (`package.json`)
Runtime: `next 14.2.5`, `react 18`, `@supabase/supabase-js`, `openai`
Build: TypeScript 5, Tailwind 3 (config exists but v2 uses custom CSS instead)

---

## Architecture

### Key Files
| File | Purpose |
|------|---------|
| `app/v2.css` | All styles for the v2 dashboard (sidebar, layout, charts, tables, pills, etc.) |
| `app/v2/layout.tsx` | Root layout: wraps `<V2Sidebar />` + `<main className="main">` |
| `components/v2/Sidebar.tsx` | Client component sidebar with collapse/expand toggle |
| `components/v2/charts.tsx` | All chart components: `StackedArea`, `Donut`, `ScatterChart`, `LineChart`, `BubbleChart` |
| `components/v2/PageShell.tsx` | `PageHead`, `MiniKpi`, `SectionInfo`, `SortTh`, `LoadingPage`, `pgColor`, `pgName`, `fmt` |
| `lib/v2/data.ts` | Data fetching: `fetchBrands`, `fetchAds`, `fetchAdSample`, etc. |

### Pages (`app/v2/`)
- `/v2` — Executive Overview
- `/v2/instagram` — Instagram analytics
- `/v2/youtube` — YouTube analytics
- `/v2/reddit` — Reddit & Community
- `/v2/comments` — Comments Intel
- `/v2/influencers` — Influencer Network (bubble chart)
- `/v2/ads` — Ads Library
- `/v2/promotions` — Promotions
- `/v2/products` — Product Catalog
- `/v2/market` — Market Intel

---

## Layout System (Critical)

### Sidebar — Fixed Positioning
```css
/* In app/v2.css */
:root { --sidebar-w: 232px; }

.v2-root .sidebar {
  width: var(--sidebar-w); min-width: var(--sidebar-w);
  position: fixed; top: 0; left: 0; bottom: 0; z-index: 50;
  overflow: hidden;
  transition: width 240ms ease, min-width 240ms ease;
}

.v2-root .sidebar.sidebar-collapsed { width: 60px; min-width: 60px; }

.v2-root .main {
  padding: 24px 32px 64px;
  margin-left: var(--sidebar-w);
  transition: margin-left 240ms ease;
}

@media (max-width: 768px) {
  .v2-root .main { margin-left: 0; }
  .v2-root .collapse-btn { display: none !important; }
}
```

### Sidebar Collapse (JS side)
In `components/v2/Sidebar.tsx`:
```tsx
const [collapsed, setCollapsed] = useState(false)
useEffect(() => {
  document.documentElement.style.setProperty('--sidebar-w', collapsed ? '60px' : '232px')
}, [collapsed])
```
- CSS custom property `--sidebar-w` is the single source of truth, shared between sidebar width and `.main`'s `margin-left`.
- Mobile: hamburger + overlay pattern (unchanged), collapse button hidden.

---

## Chart Patterns

### ScatterChart / BubbleChart — No Label Overlap
Labels are rendered **only for JOOLA (always)** and the **currently hovered item**:
```tsx
{(isJ || isHov) && (
  <text x={cx} y={cy - dotR - 8} textAnchor="middle" className="scatter-label"
    style={{ fontWeight: 800, fill: isJ ? '#22c55e' : '#fff', fontSize: 11, pointerEvents: 'none' }}>
    {d.name}
  </text>
)}
```
Never render all labels at once — they overlap when brands cluster.

### LineChart — Hover Tooltip
Wrapped in `<div className="scatter-wrap" style={{ position: 'relative' }}>`.
On hover: floating `.tip` div (company name + latest value), crosshair line, endpoint circle.
```tsx
{hovSeries && (
  <div className="tip" style={{ left: ..., top: ..., whiteSpace: 'nowrap' }}>
    <div className="t-name" style={{ color: hovSeries.color }}>{hovSeries.label}</div>
    Latest: {fmt(hovLastVal)}
  </div>
)}
```

---

## UI Conventions

### Colors (brand)
- JOOLA: `#22c55e` (green)
- Accent/highlight: `#F5E625` (yellow)
- Pill classes: `pill-green`, `pill-info`, `pill-amber`, `pill-ghost`

### No Export Brief Button
**Do NOT add** `<button className="btn btn-yellow">Export brief</button>` to any page.
It was removed from all 9 pages and should not return.

### PageHead Component
```tsx
<PageHead eyebrow="..." title="..." accent="..." sub="..." actions={<>...</>} />
```
Actions slot: search inputs, selects, filter dropdowns — NOT export buttons.

### CTAs Pattern
Each page should have CTAs to external platforms (open in new tab):
- YouTube: link to brand's YouTube channel
- Instagram: link to brand's Instagram
- Reddit: link to subreddit
- Meta Ads Library: `https://www.facebook.com/ads/library/?...`
- Brand website if available in DB

---

## TypeScript Notes
- `Set` spread: use `Array.from(new Set(...))` not `[...new Set(...)]` (TS2802 error with some configs).
- Always run `npx tsc --noEmit` to verify no type errors after changes.

---

## Design System

### Style
- Dark mode only, `#0d1117` background
- Card: `background: rgba(255,255,255,0.04)`, `border: 1px solid rgba(255,255,255,0.08)`
- Section titles: bold, white
- Muted text: `var(--muted)` (~`#6b7280`)
- Font: system stack or Archivo Black for brand mark

### Charts
- All bar/pie charts: 3D effect requested
- All boxes/cards: 3D hover pop-out effect on mouse hover
- Responsive: tablet (768px) and mobile (375px)

### Scatter/Bubble chart quadrant labels
- Keep 4 quadrant regions clearly visible with grid lines and labels
- Brands that cluster: use hover-only labels to avoid overlap

---

## Scraping / Data Pipeline (Background)
- Script: `scripts/fix_missing_data.py`
- Progress file: `scripts/SCRAPE_PROGRESS.md`
- Pipeline state: `pipeline_state.json`
- Row counts script: `_count_rows.py`
- Log: `resumable_run.log`

---

## Known Issues / History
1. **Sidebar sticky → fixed**: Was `position: sticky`, broke on some scroll contexts. Now `position: fixed`.
2. **Set spread TS error**: Fixed with `Array.from(new Set(...))`.
3. **Scatter label overlap**: Fixed by label-on-hover-only pattern.
4. **LineChart hover**: Now shows floating tooltip + crosshair.
5. **Export brief**: Removed from all pages (ads, comments, influencers, instagram, market, products, promotions, reddit, youtube).

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
