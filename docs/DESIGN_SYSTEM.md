# JOOLA Intel — Design System

A self-contained reference for building the JOOLA Intel dashboard UI. This document covers every token, component, pattern, and interaction rule used in the live product. It is technology-agnostic; the examples reference the existing Next.js / React implementation for context, but the rules apply to any stack.

---

## 1. Foundations

### 1.1 Brand Identity

| Element | Value |
|---|---|
| Product name | **JOOLA INTEL** |
| Category | Pickleball competitive intelligence |
| Personality | Data-dense, authoritative, dark-chrome, high-contrast |
| Tagline | "Pickleball Intelligence" |

The wordmark splits: `JOOLA` in white + `INTEL` in yellow (`#F5E625`). The brand mark is a black 32×32 square with a yellow border and a white "J" letterform in Archivo Black.

---

### 1.2 Color Tokens

All colors are scoped under `.v2-root` via CSS custom properties.

#### Surfaces

| Token | Hex | Usage |
|---|---|---|
| `--bg` | `#0a0d12` | Page background |
| `--bg-2` | `#0f1219` | Deeper background layer |
| `--surface` | `#141821` | Card / panel fill |
| `--surface-2` | `#1a1f2b` | Secondary surface (inputs, chips) |
| `--line` | `rgba(255,255,255,0.07)` | Border default |
| `--line-2` | `rgba(255,255,255,0.04)` | Subtle separator (table rows) |

#### Text

| Token | Hex | Usage |
|---|---|---|
| `--fg` | `#ffffff` | Primary text, headings |
| `--fg-2` | `#e2e6ed` | Body text |
| `--fg-3` | `#c4cad6` | Secondary / muted text |
| `--fg-4` | `#9aa2b0` | Placeholder, metadata, timestamps |

#### JOOLA Brand

| Token | Value | Usage |
|---|---|---|
| `--yellow` | `#F5E625` | Primary accent — CTAs, active states, eyebrows |
| `--yellow-deep` | `#D9CB1F` | Yellow hover/pressed state |
| `--yellow-dim` | `rgba(245,230,37,0.10)` | Yellow-tinted fill (active nav, chip.on) |
| `--yellow-edge` | `rgba(245,230,37,0.30)` | Yellow-tinted border |
| `--red` | `#D6182A` | Crisis / danger |
| `--red-deep` | `#A30E1E` | Red hover |
| `--red-dim` | `rgba(214,24,42,0.10)` | Red-tinted fill |

#### Functional / Semantic

| Token | Value | Usage |
|---|---|---|
| `--joola` | `#22c55e` | JOOLA brand highlight in data (green) |
| `--joola-dim` | `rgba(34,197,94,0.12)` | Green-tinted fill |
| `--joola-edge` | `rgba(34,197,94,0.28)` | Green-tinted border |
| `--up` | `#22c55e` | Positive delta |
| `--down` | `#ef4444` | Negative delta |
| `--warn` | `#f59e0b` | Warning / threat |
| `--info` | `#818cf8` | Informational / indigo |

#### Competitor Brand Colors (chart series)

| Slug | Color |
|---|---|
| joola | `#22c55e` |
| selkirk | `#F5E625` |
| crbn | `#818cf8` |
| franklin | `#ec4899` |
| engage | `#06b6d4` |
| paddletek | `#f59e0b` |
| six-zero | `#a855f7` |
| onix | `#ef4444` |
| wilson | `#14b8a6` |
| gamma | `#60a5fa` |
| prokennex | `#fb923c` |
| head | `#0ea5e9` |

---

### 1.3 Typography

| Role | Font | Weight | Size | Notes |
|---|---|---|---|---|
| Display / headings | Archivo Black | 900 | varies | Uppercase, tight tracking |
| Body / UI labels | Archivo | 400–800 | 11–15px | System fallback: system-ui, sans-serif |
| Monospaced numbers | JetBrains Mono | 500–700 | 10–13px | KPI values, timestamps, deltas |

Google Fonts import:
```
https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Archivo+Black&family=JetBrains+Mono:wght@500;600;700&display=swap
```

#### Type Scale

| Usage | Family | Size | Weight | Letter-spacing | Transform |
|---|---|---|---|---|---|
| Page H1 | Archivo Black | 40px (28px mobile) | 900 | -0.01em | uppercase |
| Section H2 | Archivo Black | 18px | 900 | 0.02em | uppercase |
| Card heading | Archivo | 12px | 800 | 0.14em | uppercase |
| Eyebrow label | Archivo | 10px | 700 | 0.18em | uppercase |
| Nav section label | Archivo | 10px | 700 | 0.16em | uppercase |
| Nav item | Archivo | 13px | 600 | — | — |
| Body / cell text | Archivo | 12–13px | 500–600 | — | — |
| Timestamps / mono | JetBrains Mono | 10–11px | 600 | — | — |
| KPI value | Archivo Black | 30px | 900 | -0.02em | — |

---

### 1.4 Spacing & Radius

| Name | Value |
|---|---|
| Page padding | 24px 32px (mobile: 64px 16px top/side) |
| Section gap | 36px |
| Card padding | 18px (`.card-pad`), 22px (`.card-pad-lg`) |
| Card radius | 12px |
| Pill radius | 3px |
| Chip radius | 4px |
| Button radius | 6px |
| Grid gap (KPIs) | 12px |
| Grid gap (cards) | 14px |

---

### 1.5 Atmospheric Background

Two persistent fixed layers behind all content:

1. **Radial gradient wash** — three soft color blobs (yellow top-left, indigo top-right, green bottom-center), all at 3–4% opacity.
2. **Dot grid** — 24px repeating radial dots at 3.5% opacity, masked to fade out toward the bottom.

```css
.app-bg {
  background:
    radial-gradient(900px 600px at 12% -10%, rgba(245,230,37,0.04), transparent 60%),
    radial-gradient(800px 600px at 95% 8%,  rgba(129,140,248,0.04), transparent 60%),
    radial-gradient(700px 500px at 60% 95%, rgba(34,197,94,0.03),   transparent 60%);
}
.dot-grid {
  background-image: radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px);
  background-size: 24px 24px;
  mask-image: linear-gradient(to bottom, black, transparent 90%);
}
```

---

## 2. Layout

### 2.1 Shell Structure

```
<body class="v2-root">
  <div class="app-bg" />
  <div class="dot-grid" />
  <div class="shell">
    <aside class="sidebar">…</aside>
    <main class="main">
      <div class="main-inner">
        <!-- page content -->
      </div>
    </main>
  </div>
</body>
```

### 2.2 Sidebar

- **Width**: `232px` desktop → `60px` collapsed. Controlled via CSS custom property `--sidebar-w` on `:root`, updated by JS.
- **Position**: `fixed` top/left/bottom. `z-index: 50`.
- **Background**: `rgba(7,10,15,0.92)` with `backdrop-filter: blur(16px)`.
- **Right border**: `1px solid var(--line)`.
- **Transition**: `width 240ms ease`, `min-width 240ms ease`.
- Mobile: slides in from left (`translateX(-100%)` → `translateX(0)`) with an overlay backdrop.

#### Sidebar anatomy

```
┌─ brand ─────────────────────────────┐
│  [J]  JOOLA INTEL                   │
│       Pickleball Intelligence       │
├─ nav-section ───────────────────────┤
│  CHANNELS                           │
│  [icon] Executive Overview  [LIVE]  │
│  [icon] Instagram                   │
│  [icon] YouTube                     │
│  [icon] Reddit & Community          │
│  [icon] Comments Intel              │
│  [icon] Influencer Network          │
│  [icon] Ads Library                 │
│  [icon] Promotions                  │
│  [icon] Product Catalog             │
│  [icon] Market Intel                │
├─ collapse-btn ──────────────────────┤
│  ‹ Collapse                         │
├─ sidebar-foot ──────────────────────┤
│  ● Live data · Mon · 07:00 IST      │
└─────────────────────────────────────┘
```

#### Nav item states

| State | Background | Color | Border |
|---|---|---|---|
| Default | transparent | `--fg-3` | transparent |
| Hover | `rgba(255,255,255,0.03)` | `--fg` | transparent |
| Active | `--yellow-dim` | `--yellow` | `--yellow-edge` |

Active state: icon gets `drop-shadow(0 0 5px rgba(245,230,37,0.55))`.

### 2.3 Main Content

- `margin-left: var(--sidebar-w)` — follows sidebar width via CSS var.
- `max-width: 1280px`, centered.
- Responsive: margin-left collapses to 0 on mobile.

### 2.4 Sticky Section Nav

A full-width nav strip pinned to the top of the page, used for in-page anchor navigation:

```css
.section-nav {
  position: sticky; top: 0; z-index: 30;
  background: rgba(10,13,18,0.92);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--line);
  margin: -24px -32px 28px;
  padding: 12px 32px;
}
```

Items (`.snav-item`): same active/hover pattern as nav items but smaller (11px, `padding: 7px 14px`).

---

## 3. Components

### 3.1 Page Header (`PageHead`)

```html
<header class="page-head">
  <div>
    <div class="eyebrow">
      <span class="live-pulse-dot" />
      COMPETITIVE INTEL · INSTAGRAM
    </div>
    <h1>INSTAGRAM <em>ANALYTICS</em></h1>
    <div class="sub">Follower growth, engagement rates, and posting cadence across all brands.</div>
  </div>
  <div class="head-actions">
    <!-- filter dropdowns, search inputs, select menus -->
    <!-- DO NOT add export buttons here -->
  </div>
</header>
```

- `h1`: Archivo Black, 40px, uppercase. The `<em>` portion renders in `--yellow`.
- Eyebrow: 10px, 0.18em tracking, `--yellow`. Includes a small pulsing yellow dot (6px circle with matching glow).
- Actions slot: only filter controls (selects, chip rows). No "Export brief" buttons.

---

### 3.2 KPI Card (`MiniKpi`)

```html
<div class="kpi [joola|warn|danger]">
  <div class="label">
    <span>TOTAL FOLLOWERS</span>
    <span class="src">Instagram · all brands</span>  <!-- monospace, truncated -->
  </div>
  <div class="row">
    <div class="value">2.4<span class="unit">M</span></div>
    <div class="spark"><!-- 90×30 SVG sparkline --></div>
  </div>
  <div class="delta up">▲ 12,400 (+1.2%) <span class="vs">vs. last wk</span></div>
</div>
```

Layout: 4-column grid (`.kpi-grid`), 12px gap.

Modifier classes add a 2px top accent bar:
- `.joola` → green bar
- `.warn` → amber bar
- `.danger` → red bar

Delta classes: `.up` (green), `.down` (red), `.flat` (muted).

Hover: `translateY(-4px) scale(1.005)` + shadow lift.

---

### 3.3 Card

```html
<div class="card [card-pad|card-pad-lg]">
  <div class="card-head">
    <h3>SECTION TITLE</h3>
    <span class="meta">12 brands · 13 weeks</span>
  </div>
  <!-- content -->
</div>
```

- Background: `linear-gradient(160deg, rgba(20,24,33,0.98), rgba(15,18,26,0.95))`.
- Hover: shadow + border brightens. **No translateY** — cards contain interactive rows; the rows pop, not the card.

---

### 3.4 Brief Card

Used in the 4-column `briefing-strip` at the top of the overview page.

```html
<div class="brief-card [crisis|opportunity|threat|watch]">
  <div class="severity"></div>   <!-- 3px left accent bar -->
  <div class="tag">⚠ CRISIS</div>
  <h4>Franklin launches 20% price cut</h4>
  <p>Franklin dropped MKIII to $129 with bundle offers — threatens mid-range position.</p>
  <div class="action">→ VIEW ADS LIBRARY</div>
</div>
```

Severity bar colors: crisis=red, opportunity=green, threat=amber, watch=indigo.

---

### 3.5 Opportunity Card

```html
<div class="opp-card">
  <div class="num">01</div>
  <h4>AMBASSADOR GAP</h4>
  <p>Only 3 brands actively sponsor athletes. JOOLA has space to dominate.</p>
  <div class="why">// Source: influencer data · 13 wk avg</div>
  <div class="cta">→ EXPLORE INFLUENCERS</div>
</div>
```

3-column grid (`.opps`). The number is 44px Archivo Black in yellow. CTA arrow animates gap from 6px → 10px on hover.

---

### 3.6 Data Table

```html
<div class="table-wrap">
  <table class="data">
    <thead>
      <tr>
        <th class="sortable sort-desc" aria-sort="descending">
          <span class="sort-ic">
            BRAND
            <span class="sort-arrows" aria-hidden="true">
              <span class="arr-up">▲</span>
              <span class="arr-down">▼</span>
            </span>
          </span>
        </th>
        …
      </tr>
    </thead>
    <tbody>
      <tr class="joola">  <!-- JOOLA row gets green left border + tinted bg -->
        <td>JOOLA <span class="you-badge">YOU</span></td>
        <td class="cell-num">248,000</td>
        <td class="cell-delta up">▲ +2.1%</td>
      </tr>
    </tbody>
  </table>
</div>
```

- Header: 10px, 0.12em tracking, uppercase, `--fg-3`. `rgba(255,255,255,0.015)` background.
- Row hover: `translateX(3px)` + yellow-tinted background.
- JOOLA row: `rgba(34,197,94,0.04)` tint + `border-left: 2px solid var(--joola)`.
- Sortable headers: active column turns yellow, active arrow scales 1.35×.

---

### 3.7 Bar Row

```html
<div class="bar-row [joola]">
  <span class="lbl">JOOLA</span>
  <div class="track">
    <div class="fill" style="width: 68%; background: linear-gradient(90deg, #22c55e, #16a34a)"></div>
  </div>
  <span class="spark-mini">248K</span>
  <span class="delta-mini up">▲+2%</span>
</div>
```

Grid: `110px 1fr 80px 60px`. Fill has an inner top highlight (`inset 0 1px 0 rgba(255,255,255,0.18)`) for a subtle 3D effect. Row translates 4px right on hover.

---

### 3.8 Trend Row (keyword / brand mention)

```html
<div class="trend-row [joola]">
  <span class="rank">01</span>
  <span class="kw">pickleball paddle</span>
  <div class="mtrack"><div class="mfill" style="width: 72%"></div></div>
  <span class="mvol">1,240</span>
  <span class="pill pill-green">↑ 18%</span>
</div>
```

Grid: `30px 160px minmax(120px,1fr) 50px auto`. The mini-bar (`.mtrack` / `.mfill`) is 8px tall, yellow fill. Row translates 4px right on hover.

---

### 3.9 Pills / Badges

```html
<span class="pill pill-yellow">TRENDING</span>
<span class="pill pill-green">+18%</span>
<span class="pill pill-red">CRISIS</span>
<span class="pill pill-amber">WATCH</span>
<span class="pill pill-info">SOCIAL</span>
<span class="pill pill-ghost">NEUTRAL</span>
<span class="pill pill-solid">LIVE</span>
```

All pills: 10px Archivo, 800 weight, 0.1em tracking, 3px border-radius, `padding: 3px 8px`.

---

### 3.10 Chips (Filter Toggle)

```html
<div class="chip-row">
  <button class="chip on">All</button>
  <div class="chip-divider"></div>
  <button class="chip">JOOLA</button>
  <button class="chip">Selkirk</button>
</div>
```

Active (`.on`): yellow background, black text. Default: dark surface, muted text.

---

### 3.11 Signal Feed Row

```html
<div class="signal">
  <span class="sig-tag ad">AD</span>
  <span class="brand-pill">
    <span class="brand-dot" style="background:#F5E625"></span>
    Selkirk
  </span>
  <span class="desc">Launched 3 new video ads targeting the competitive segment.</span>
  <span class="when">2h ago</span>
</div>
```

Signal tag variants: `.ad` (amber), `.promo` (red), `.social` (indigo), `.reddit` (cyan), `.product` (green).

Row hover: `translateX(4px)` + yellow inset left border + shadow.

---

### 3.12 Mover Row

```html
<div class="movers">
  <div class="mover-row [joola]">
    <span class="rank">1</span>
    <div class="brand">
      <span class="brand-dot" style="background:#22c55e"></span>
      <span class="name">JOOLA</span>
    </div>
    <span class="metric">Followers</span>
    <span class="value">248K</span>
    <span class="delta up">▲ +1.2%</span>
  </div>
</div>
```

Two-column grid (`.movers`). JOOLA row gets a subtle green tint and a `YOU` badge after the name.

---

### 3.13 Section Info Tooltip (`?` icon)

```html
<span class="section-info [is-pinned]" role="button">
  ?
  <span class="si-popup">
    <div class="si-title">FOLLOWERS</div>
    <div class="si-body">Total Instagram followers per brand, summed across all tracked accounts.</div>
    <div class="si-source">Source: Apify · weekly scrape</div>
  </span>
</span>
```

- Hover: reveals popup (CSS-only).
- Click: pins popup open (JS adds `is-pinned`). Outside click or Esc dismisses.
- Popup: 268px wide, dark glass, yellow border, blurred backdrop, arrow caret at top.

---

### 3.14 Heatmap

```html
<div class="heatmap">
  <div class="h-lbl">JOOLA</div>
  <div class="h-cell" style="background:rgba(34,197,94,0.52)" title="JOOLA · Week 3 · 4 posts"></div>
  …
</div>
```

Grid: `110px repeat(N, 1fr)`. Cell height: 22px. Hover: `scale(1.25)` + brightness boost + glow ring.

---

### 3.15 Buttons

| Class | Style |
|---|---|
| `.btn` | Dark surface, `--line` border, muted text |
| `.btn-yellow` | Yellow fill, black text |
| `.btn-ghost` | Transparent, `--line` border |

All buttons: 12px Archivo 600, `padding: 9px 14px`, 6px radius, 160ms transition. Active state: `scale(0.985)`.

---

### 3.16 External Link Styles

```html
<a class="ext-link" href="…" target="_blank">↗ View on Instagram</a>
<a class="cta-link" href="…" target="_blank">↗ open</a>
```

- `.ext-link`: small pill-style link with dark background, turns yellow on hover.
- `.cta-link`: inline dashed-underline link, turns yellow on hover.

---

### 3.17 Toast

```html
<div class="toast [toast-err]">
  <span class="toast-dot"></span>
  CSV exported successfully
</div>
```

Fixed to `bottom: 24px; right: 24px`. Animates in from below. Auto-dismisses after 2.8s. Error variant: red border + red dot.

---

### 3.18 Skeleton Loader

```html
<div class="sk-kpis">
  <div class="skel sk-h80"></div>
  <div class="skel sk-h80"></div>
  <div class="skel sk-h80"></div>
  <div class="skel sk-h80"></div>
</div>
<div class="skel sk-h160" style="margin-top:20px"></div>
```

Shimmer animation: 1.6s linear loop over a 1200px wide gradient. Heights: `sk-h12` (12px), `sk-h18`, `sk-h24`, `sk-h80` (with 12px radius), `sk-h160` (with 12px radius).

---

### 3.19 Command Palette (⌘K)

Dark modal, centered, `width: min(640px, calc(100vw - 32px))`. Yellow border. Opens with a `pop-in` keyframe (scale 0.96 → 1). Contains a search input with yellow caret, a results list, and a keyboard shortcut hint footer.

---

### 3.20 Info Modal

```html
<div class="info-modal-backdrop">
  <div class="info-modal">
    <h3>ABOUT THIS DATA</h3>
    <p>…</p>
    <button class="close-btn">CLOSE</button>
  </div>
</div>
```

Width: `min(520px, calc(100vw - 32px))`. Yellow border. Same `pop-in` animation as command palette.

---

## 4. Charts

All charts are SVG-based (Recharts or hand-rolled). All SVGs inside `.card` receive a subtle drop shadow: `drop-shadow(0 2px 10px rgba(0,0,0,0.35))`.

### 4.1 Stacked Area Chart

- Used for: ad volume over time, stacked by brand.
- Hover behavior: detects which layer and which week is under the cursor. Hovered layer opacity → 1, stroke 1.5. Other layers dim. Floating tooltip shows `Week N: V ads`.
- All brands are included in both the chart series and the legend (no slicing to top N).

### 4.2 Line Chart

- Used for: follower trends, metric trends over weeks.
- End-of-line labels: sorted by y-value, pushed apart by a minimum gap of 14px to avoid overlap. Connector lines drawn when label is pushed from its natural position.
- Per-week crosshair: on mousemove, a vertical line appears at the hovered week; a multi-series tooltip shows the top 6 series by value.
- Empty series (all-zero data) are filtered out before render; if no data remains, a "No data available" message is shown.

### 4.3 Donut Chart

- Used for: share of voice, market share.
- Hover: SVG `<title>` tooltip + floating `.tip` div with name and percentage.
- Accompanied by a `.donut-legend` list (color swatch, name, value).

### 4.4 Scatter / Bubble Chart

- Used for: brand positioning (engagement vs. followers), influencer network.
- Label rule: **only render labels for JOOLA (always) and the hovered brand**. Never all-at-once — they overlap.
- JOOLA dot: green (`#22c55e`), label weight 800.
- Quadrant grid lines + corner labels: use a backing rect (`rgba(7,9,14,0.78)`) behind each quadrant label for readability.
- Bubble sizes are repulsion-clamped (iterative O(n²) push-apart, 60 iterations, 3px gap) to avoid overlap.

### 4.5 Sparkline

- Used inside KPI cards.
- 90×30px. No axes, no labels. Just the line with a gradient fill.

### 4.6 Box Plot

- Used for: price range comparison.
- Per-row hover reveals a full-stats tooltip (Min / Median / Avg / Max + count).
- Right padding: 120px to avoid label clipping.

### 4.7 Sentiment Bar

- Horizontal stacked bar: positive (green), neutral (fixed `#94a3b8` gray), negative (red).
- Gray is always neutral — never use the brand green for neutral.
- Each row wrapped in `.sent-row` for hover pop.

### 4.8 Tooltip Style (`.tip`)

```css
.tip {
  position: absolute;
  background: #000;
  border: 1px solid rgba(245,230,37,0.30);
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-family: JetBrains Mono;
  color: #fff;
  white-space: nowrap;
  z-index: 50;
  transform: translate(-50%, -120%);
}
.tip .t-name {
  font-family: Archivo;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #F5E625;
  font-size: 10px;
  margin-bottom: 2px;
}
```

---

## 5. Interaction Patterns

### 5.1 Hover Hierarchy Rule

> **Cards that contain lists or tables must NOT transform on hover. Only self-contained units (KPI, brief card, opp card) get the lift.**

| Element | Hover behavior |
|---|---|
| `.kpi`, `.brief-card`, `.opp-card` | `translateY(-4px) scale(1.005)` + shadow |
| `.card` (container) | shadow + border only — no transform |
| `.signal` row | `translateX(4px)` + yellow inset left border |
| `.trend-row` | `translateX(4px)` + bar brightens |
| `table.data tbody tr` | `translateX(3px)` + yellow tint |
| `.heatmap .h-cell` | `scale(1.25)` + brightness + glow |
| `.tier-row` | `translateX(3px)` + segments brighten |
| `.tier-seg` (individual) | `scaleY(1.6)` + brightness |
| `.cadence-cell` | `scale(1.4)` + glow |
| `.sent-row` | `translateX(3px)` + bars brighten |
| `.bar-row` | `translateX(4px)` + fill brightens |
| `.mover-row` | background lightens |

### 5.2 Animations

| Name | Keyframe | Usage |
|---|---|---|
| `fade-up` | `opacity 0→1, translateY 10px→0, 500ms` | Staggered section entry |
| `fade-in` | `opacity 0→1, 150ms` | Modal backdrops |
| `pop-in` | `scale 0.96→1, translateY -8px→0, 180ms, cubic-bezier(0.22,1,0.36,1)` | Modals |
| `toast-in` | `opacity 0→1, translateY 12px→0, 220ms` | Toast notification |
| `pulse` | `opacity/scale pulse, 1.8s infinite` | Live data dot |
| `shimmer` | `background-position -600px→600px, 1.6s linear` | Skeleton loader |

### 5.3 Transitions

All interactive elements use `160–220ms ease` transitions. Nothing above 300ms except the sidebar collapse (240ms) and mobile sidebar slide (280ms cubic-bezier).

---

## 6. Pages

| Route | Title | Key Sections |
|---|---|---|
| `/v2` | Executive Overview | Briefing strip, KPI grid, movers, signal feed, stacked area |
| `/v2/instagram` | Instagram Analytics | KPIs, follower bar chart, engagement scatter, posting cadence heatmap |
| `/v2/youtube` | YouTube Analytics | KPIs, view trend lines, video table |
| `/v2/reddit` | Reddit & Community | Subreddit table, trend rows, sentiment bars |
| `/v2/comments` | Comments Intel | Comment table with brand/sentiment filters |
| `/v2/influencers` | Influencer Network | Bubble chart (engagement vs. followers vs. deal count) |
| `/v2/ads` | Ads Library | Stacked area, ad card table with sortable columns |
| `/v2/promotions` | Promotions | Heatmap, promotion text table |
| `/v2/products` | Product Catalog | Price tier bars, product table |
| `/v2/market` | Market Intel | Opportunity cards, market share donut |

---

## 7. Rules & Anti-Patterns

### Do

- Use `Array.from(new Set(...))` not `[...new Set(...)]` — TypeScript Set spread requires `downlevelIteration`.
- Guard chart functions with `isFinite()` before rendering SVG `<text>` elements.
- Use `position: relative` on the `.scatter-wrap` container for absolute-positioned tooltips.
- Always add `title="…"` to truncated text cells for full-text reveal on hover.
- Keep the sidebar collapse toggle hidden on mobile (CSS `display: none !important`).
- Open all external links (YouTube, Instagram, Reddit, Meta Ads) in a new tab (`target="_blank"`, `rel="noopener noreferrer"`).

### Do Not

- Do **not** add `<button class="btn btn-yellow">Export brief</button>` to any page header. It was removed from all 9 pages.
- Do **not** render all scatter/bubble labels simultaneously — only JOOLA (always) + hovered item.
- Do **not** use the brand green (`#22c55e`) as the neutral color in sentiment bars. Neutral must be `#94a3b8`.
- Do **not** apply `translateY` transform to `.card` on hover when the card contains a list or table.
- Do **not** slice chart series to a top-N subset — include all brands.
- Do **not** use `position: sticky` for the sidebar — it breaks on certain scroll contexts. Use `position: fixed`.

---

## 8. Responsive Breakpoints

| Breakpoint | Rule |
|---|---|
| `> 1100px` | Full layout: 4-col KPI grid, 2-col cards, full sidebar |
| `769px–1100px` | Sidebar narrows to 200px; KPI grid → 2-col |
| `≤ 768px` | Sidebar hidden (slide-in drawer); main padding 64px top; KPI grid → 2-col; no collapse button |
| `≤ 480px` | KPI grid → 1-col; H1 → 22px |

---

## 9. Brand Identity Summary (Quick Reference)

```
Primary accent:    #F5E625  (yellow)
JOOLA data:        #22c55e  (green)
Background:        #0a0d12
Card surface:      #141821
Primary text:      #ffffff
Body text:         #e2e6ed
Muted:             #9aa2b0
Danger:            #D6182A
Warning:           #f59e0b
Info/Indigo:       #818cf8

Font display:      Archivo Black (headings, numbers)
Font body:         Archivo (UI, labels)
Font mono:         JetBrains Mono (values, timestamps)

Border default:    rgba(255,255,255,0.07)
Card radius:       12px
Base font size:    14px
```
