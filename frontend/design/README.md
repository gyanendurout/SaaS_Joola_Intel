# JOOLA INTEL — Executive Dashboard

Pickleball competitive intelligence dashboard for CEO / CMO use.
Tracks JOOLA + 10 competitors across 17 tables / ~5,500 rows.

## Files in this folder

**For sharing / offline use:**
- `JOOLA Intel — Standalone.html` — single self-contained file. Double-click to open. Works offline, no server, no dependencies.

**Source files (edit these):**
- `Executive Dashboard.html` — entry point; loads everything below
- `styles.css` — design tokens + component CSS (dark intel chrome + JOOLA brand DNA)
- `data.js` — all mock data (KPIs, time series, brand list)
- `charts.jsx` — chart primitives: Sparkline, LineChart, StackedArea, Scatter, Donut, BoxPlot, SentimentBar
- `pages.jsx` — per-channel pages (Instagram, YouTube, Reddit, Comments, Influencers, Ads, Promos, Products, Market Intel)
- `app.jsx` — shell, sidebar router, Executive Overview composition
- `assets/` — JOOLA Trinity icon + lockup

## To run from source
Serve the folder with any static server:
```
npx serve .
# or
python3 -m http.server
```
Open `Executive Dashboard.html`. (Direct file:// works for the standalone build only.)

## Design notes
- **Theme:** dark intelligence chrome (`#0a0d12` canvas) + JOOLA brand DNA (Trinity Yellow `#F5E625` for critical alerts, Archivo Black all-caps display, green `#22c55e` as the JOOLA "you" anchor).
- **Type:** Archivo / Archivo Black / JetBrains Mono (Google Fonts).
- **Charts:** custom inline SVG, no external chart library.

## 10 pages

| Sidebar item | Audience question it answers |
|---|---|
| Executive Overview | What changed this week and what should the team do? |
| Instagram | Whose content actually resonates? |
| YouTube | Are we even competing on long-form? |
| Reddit & Community | Is sentiment trending up or down? |
| Comments Intel | What are fans saying right now? |
| Influencer Network | Who delivers ROI per post, not per follower? |
| Ads Library | What messaging is the market pushing? |
| Promotions | Is there a price war? Are we leaving margin? |
| Product Catalog | How does our shelf compare on price + depth? |
| Market Intel | What's trending we need to respond to? |
