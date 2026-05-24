# 06 — Design System

> **Goal.** Cheat-sheet for visual conventions and component contracts in the v2 dashboard. Pulled from `app/v2.css`, `lib/v2/data.ts`, and the CLAUDE.md session logs.

---

## Palette

### Brand colors (authoritative — `lib/v2/data.ts::BRAND_COLORS`)

| Slug | Hex | Use |
|---|---|---|
| `joola` | `#22c55e` | **Always green.** Used as the brand mark color too. |
| `selkirk` | `#F5E625` | Yellow. Also the dashboard "accent" highlight color. |
| `crbn` | `#818cf8` | Indigo |
| `franklin` | `#ec4899` | Pink |
| `engage` | `#06b6d4` | Cyan |
| `paddletek` | `#f59e0b` | Amber |
| `six-zero` | `#a855f7` | Purple |
| `onix` | `#ef4444` | Red |
| `wilson` | `#14b8a6` | Teal |
| `gamma` | `#60a5fa` | Blue |
| `head` | `#0ea5e9` | Sky |
| `prokennex` | `#fb923c` | Orange (legacy seed only) |

### System colors

| Token | Hex | Use |
|---|---|---|
| Background | `#0d1117` | Page bg (GitHub-dark feel) |
| Card bg | `rgba(255,255,255,0.04)` | All cards |
| Card border | `1px solid rgba(255,255,255,0.08)` | All cards |
| Muted text | `var(--muted)` (`#6b7280`) | Secondary labels |
| Neutral chart | `#94a3b8` (gray) | Neutral sentiment band (never green/yellow — avoids confusion with brand or positive semantics) |
| Accent / highlight | `#F5E625` | Sort arrows active, hover borders, callouts |

### Pill classes (in `v2.css`)

`.pill-green`, `.pill-info`, `.pill-amber`, `.pill-ghost` — pre-styled chip variants. Use these instead of inline colors for status indicators.

### Dark mode only

There is **no light theme**. Don't add `@media (prefers-color-scheme: light)` blocks — they'd break the contrast assumptions baked into every component.

---

## Layout system

### Sidebar (fixed)

```css
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

Single source of truth for sidebar width is the `--sidebar-w` CSS variable. `Sidebar.tsx` mutates it in a `useEffect` when the user toggles collapse. `.main`'s `margin-left` mirrors it automatically.

### Mobile (< 768 px)

- Sidebar disappears, hamburger overlay pattern.
- `.main` loses its left margin.
- Collapse button hidden.

---

## Card pattern

```css
.card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  padding: 20px;
}
```

Section titles inside cards: bold, white, ~14-16 px.

### Hover behavior (critical)

After the "Hover-Pop Behavior" session-log fix, **whole-card hover lift is removed** for cards that contain lists/tables/heatmaps. The hover effect is moved to **inner rows**:

| Element | Hover effect |
|---|---|
| `.card` | shadow + border change only — no transform |
| `.kpi`, `.brief-card`, `.opp-card` | full translateY(-5px) + scale(1.008) — self-contained units, OK to lift the whole thing |
| `.signal:hover` | translateX(4px) + yellow inset border + shadow |
| `.trend-row:hover` | translateX(4px) + mfill brightens |
| `table.data tbody tr:hover` | translateX(3px) + yellow tint + shadow |
| `.heatmap .h-cell:hover` | scale(1.25) + glow + z-index raise |
| `.tier-row:hover` / `.tier-seg:hover` | row lifts, individual segment scales vertically 1.6× |
| `.cadence-cell:hover` | scale(1.4) + glow |
| `.sent-row:hover` | row lifts, bars brighten |

**Rule of thumb.** If a card contains a list/table/heatmap, the card itself should not transform on hover — add a class to each inner row and apply the pop there.

---

## KPI card (`MiniKpi` from `PageShell.tsx`)

- Big number (~28 px), small label below.
- `<span className="src">` underneath shows "Source: …" with full source name on hover (`title=` attribute).
- Self-contained — whole card lifts on hover.

---

## Chart conventions

All charts live in `components/v2/charts.tsx`. SVG-based, no third-party lib.

### ScatterChart / BubbleChart — label-on-hover

When brands cluster, labels overlap. The rule:

> **Render labels only for JOOLA (always) and the currently hovered item.**

```tsx
{(isJ || isHov) && (
  <text x={cx} y={cy - dotR - 8} textAnchor="middle" className="scatter-label"
    style={{ fontWeight: 800, fill: isJ ? '#22c55e' : '#fff',
             fontSize: 11, pointerEvents: 'none' }}>
    {d.name}
  </text>
)}
```

Never render all labels at once.

### LineChart — hover tooltip pattern

Wrap the chart in `<div className="scatter-wrap" style={{ position: 'relative' }}>`. On mouse-move over the chart area:

1. Render a per-week vertical crosshair line.
2. Render a floating `.tip` div positioned absolutely:
   ```tsx
   <div className="tip" style={{ left: …, top: …, whiteSpace: 'nowrap' }}>
     <div className="t-name" style={{ color: hovSeries.color }}>{hovSeries.label}</div>
     Latest: {fmt(hovLastVal)}
   </div>
   ```
3. Show end-of-line series labels deconflicted vertically (sort by y, push down by `minLabelGap=14`, draw connector lines).
4. Guard `fmt()` and `y()` with `isFinite` to prevent NaN labels when a series has all-zero data.

### StackedArea — layer hover

Detect layer + week from mouse position. Highlight the hovered layer (opacity 1, stroke 1.5×). Show a floating tooltip with `Week N: V ads`.

### BoxPlot

- Per-row hover with full stats (Min/Med/Avg/Max + count).
- Needs `w >= 600` to avoid label clipping (`padR = 120`).

### Donut

- Native `<title>` SVG tooltip + floating `.tip` div.
- Hover surface: name + percentage.

### SentimentBar

- Neutral band uses fixed gray `#94a3b8` — never a brand color. Otherwise positive/green vs JOOLA green become confusing.

### Heatmap (e.g. promotion cadence)

- Cells get full title="brand, week, active state" on hover.
- Hover scales the cell 1.25×, raises z-index, glows.

---

## Tables

- Single class: `table.data`.
- Sortable columns use `<SortTh col="…" />` from `PageShell`. ARIA `aria-sort` is set; active arrow scales to 1.35× in yellow (`#F5E625`).
- Long cells (promotion text, comments) clip with `max-width + textOverflow:ellipsis + title="..."` for full reveal.

---

## `PageHead`

```tsx
<PageHead
  eyebrow="..."   // small uppercase label
  title="..."     // big page title
  accent="..."    // word from title rendered in yellow
  sub="..."       // subtitle
  actions={<>...</>}  // search input / filter dropdown — NEVER an export button
/>
```

### Hard rule: no Export brief button

The `<button className="btn btn-yellow">Export brief</button>` was removed from all 9 pages. **Do not add it back.** Action slots are for filters and search, not export.

---

## `SectionInfo`

Tiny `?` icon next to section titles. Hover shows the popup (desktop); click pins it open (mobile + accessibility). Outside click + Esc dismiss.

---

## Typography

- System stack by default.
- Brand mark / hero may use `Archivo Black`.
- Numbers in KPIs: tabular-nums for stable alignment.

---

## Responsive breakpoints

| Width | Behavior |
|---|---|
| ≥ 1024 px | Full layout: sidebar 232 px, multi-column grids. |
| 768 – 1023 px | Sidebar collapsible (click chevron). |
| < 768 px | Sidebar becomes hamburger overlay; `.main` has no left margin. |
| < 375 px | Best-effort. Some dense tables scroll horizontally. |

---

## CTAs to external platforms

Each channel page should have at least one CTA (open in new tab):

- YouTube → brand's YouTube channel
- Instagram → brand's IG profile
- Reddit → subreddit URL
- Meta Ads → `https://www.facebook.com/ads/library/?…&q={brand}`
- Brand website if available

Render these via `FooterLinks.tsx` or inline in the `PageHead` actions slot.

---

## Anti-patterns (do not do)

- ❌ Whole-card transform on `.card` containing a table/list.
- ❌ All-series labels rendered on a Scatter when brands cluster.
- ❌ JOOLA green used as "positive sentiment" color anywhere outside the JOOLA row.
- ❌ Export brief button on any v2 page.
- ❌ Light-theme media queries.
- ❌ Tailwind utility classes inside v2 components (the dashboard is custom CSS only).
- ❌ Hard-coding sidebar width — use `--sidebar-w`.
- ❌ Recompute SoV from the DB `share` field when a brand filter is active — always recompute from `displayAds`.
