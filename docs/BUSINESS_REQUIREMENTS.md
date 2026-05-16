# JOOLA Intel — Business Requirements Document

**Version**: 1.0  
**Date**: 2026-05-15  
**Product**: JOOLA Intel — Pickleball Competitive Intelligence Platform  
**Owner**: JOOLA (api@joola.com)  
**Status**: Active (POC deployed, iterating toward production)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Business Context & Problem Statement](#2-business-context--problem-statement)
3. [Stakeholders](#3-stakeholders)
4. [Business Objectives & Success Metrics](#4-business-objectives--success-metrics)
5. [User Personas](#5-user-personas)
6. [Functional Requirements](#6-functional-requirements)
   - 6.1 Executive Overview
   - 6.2 Instagram Intelligence
   - 6.3 YouTube Intelligence
   - 6.4 Reddit & Community
   - 6.5 Comments Intel
   - 6.6 Influencer Network
   - 6.7 Ads Library
   - 6.8 Promotions
   - 6.9 Product Catalog
   - 6.10 Market Intel
   - 6.11 AI Content Generation
   - 6.12 Navigation & Shell
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [Data Requirements](#8-data-requirements)
9. [Integration Requirements](#9-integration-requirements)
10. [Security & Compliance Requirements](#10-security--compliance-requirements)
11. [Constraints & Assumptions](#11-constraints--assumptions)
12. [Out of Scope](#12-out-of-scope)
13. [Glossary](#13-glossary)

---

## 1. Executive Summary

JOOLA Intel is an internal competitive intelligence platform built for JOOLA's marketing, product, and strategy teams. It aggregates, processes, and visualizes publicly available social media data, advertising activity, promotional activity, and product catalog information across the top 11-12 pickleball equipment brands in the North American market.

The platform delivers a single-pane-of-glass view that answers one core question every Monday morning: **"What did our competitors do this week — and what should JOOLA do about it?"**

The system scrapes data via automated Python scripts that run on a weekly cadence, stores everything in a shared cloud database, and surfaces it through a dark-themed, chart-heavy Next.js dashboard deployed on Vercel. The target is an executive-level briefing that is actionable within minutes of opening, with drill-down capability for each channel and data type.

---

## 2. Business Context & Problem Statement

### 2.1 Industry Context

The pickleball equipment market is growing rapidly in North America. JOOLA competes against 10+ established brands including Selkirk, CRBN, Franklin, Engage, Paddletek, Six Zero, Onix, Wilson, Gamma, ProKennex, and Head. Each brand maintains an active digital presence across Instagram, YouTube, Reddit, Meta Ads, and Google Ads.

Monitoring competitors manually is time-consuming, inconsistent, and incomplete. A marketing analyst checking five brands across five platforms manually would require 20+ hours per week — and would still miss nuances like engagement-rate trends, promotion cadence, or shifts in influencer strategy.

### 2.2 Problem Statement

JOOLA's marketing and strategy teams lack:

1. **Timely competitive signal** — by the time competitive activity (new ad campaigns, pricing drops, influencer partnerships) is noticed organically, the window to respond has often passed.
2. **Cross-channel visibility** — competitor strength on Instagram may not correlate with YouTube reach or Reddit sentiment; seeing all channels together surfaces non-obvious patterns.
3. **Quantified benchmarks** — "Selkirk is doing well on social" is an opinion; "Selkirk's engagement rate is 2.3× JOOLA's at 60% of our follower count" is an actionable insight.
4. **Effort efficiency** — analyst time is better spent interpreting data and drafting responses than manually collecting it.

### 2.3 Proposed Solution

An automated weekly intelligence pipeline that:
- Scrapes public data from Instagram, YouTube, Reddit, Meta Ads Library, and Google Ads Library
- Stores structured data in a managed cloud database (Supabase / Postgres)
- Surfaces the data through a React dashboard with charts, tables, and AI-generated briefing cards
- Delivers a Monday morning "Executive Briefing" as the primary entry point

---

## 3. Stakeholders

| Stakeholder | Role | Interest |
|---|---|---|
| **JOOLA Executive Team** | Primary consumers of the Overview page | High-level competitive position; threat / opportunity signals |
| **Marketing Manager / Director** | Primary consumer of Instagram, Ads, Promotions pages | Ad strategy, content benchmarking, promo cadence |
| **Content & Social Team** | Consumers of Instagram, YouTube, Comments, Influencer pages | Post ideas, engagement benchmarks, influencer pipeline |
| **Product Manager** | Consumer of Products, Market Intel pages | Pricing strategy, catalog gaps, market positioning |
| **Strategy / Growth Team** | All pages | Synthesizing signals into JOOLA's competitive roadmap |
| **Data / Analytics Engineer** | Maintains the scraping pipeline and database | Data accuracy, scraper uptime, schema stability |
| **Platform Developer** | Maintains the Next.js dashboard | Feature velocity, code quality, deployment reliability |

---

## 4. Business Objectives & Success Metrics

### 4.1 Primary Objectives

| # | Objective | Metric | Target |
|---|---|---|---|
| OBJ-1 | Reduce time-to-insight for weekly competitive review | Time for marketing lead to produce weekly competitive report | From 4+ hours → under 20 minutes |
| OBJ-2 | Surface JOOLA-specific threats within 48 hours of competitor action | % of material competitor events surfaced in dashboard within 48h of occurrence | ≥ 85% |
| OBJ-3 | Increase marketing team's data-driven decision confidence | Qualitative team survey score (1–5) | ≥ 4.0 |
| OBJ-4 | Enable data-driven ad budget decisions | Number of ad decisions informed by dashboard data per quarter | ≥ 6 |
| OBJ-5 | Maintain dashboard availability during Monday morning usage peak | Uptime during 07:00–10:00 IST Monday window | ≥ 99.5% |

### 4.2 Secondary Objectives

- Build internal capability for data-driven competitive intelligence
- Reduce dependency on expensive third-party intelligence tools (e.g. Semrush, Sprout Social enterprise tiers)
- Create a repeatable weekly cadence for strategic review meetings

### 4.3 Key Performance Indicators (Dashboard-level)

| KPI | Definition |
|---|---|
| Data freshness | Maximum age of any dataset at time of Monday 07:00 IST opening |
| Brand coverage | Number of tracked brands with at least one data point across all tables |
| Page load time | Time from navigation click to interactive content on each page |
| Weekly active users | Unique users who open the dashboard per week |
| Briefing card relevance | % of auto-generated briefing cards rated "useful" in team survey |

---

## 5. User Personas

### Persona A — The Executive (CMO / VP Marketing)

- **Goal**: In 5 minutes, know if anything significant changed in the competitive landscape
- **Pain point**: No time for detail; needs distilled signals with "what to do"
- **Primary page**: Executive Overview (`/v2`)
- **Key features needed**: Briefing cards (crisis / threat / opportunity), top-line KPI bar, movers table

### Persona B — The Marketing Manager

- **Goal**: Plan the week's ad spend and content calendar with a competitive edge
- **Pain point**: Doesn't know what competitors are running in ads or promotions right now
- **Primary pages**: Ads Library, Promotions, Instagram
- **Key features needed**: Active ad creatives table, promo heatmap, posting cadence grid, export

### Persona C — The Content Strategist

- **Goal**: Find out what content formats and topics are winning engagement across brands
- **Pain point**: Subjectively guessing what content to post; no benchmark for "good" engagement
- **Primary pages**: Instagram, YouTube, Comments Intel
- **Key features needed**: Top posts table, engagement rate comparison, comment sentiment + top text

### Persona D — The Product Manager

- **Goal**: Understand the full competitor product catalog and pricing positioning
- **Pain point**: JOOLA's pricing decisions are made without a systematic view of where competitors sit
- **Primary pages**: Product Catalog, Market Intel
- **Key features needed**: Price distribution box plots, price tier bar, market share scatter, trend lines

### Persona E — The Data / Platform Engineer

- **Goal**: Keep data fresh and the platform running without manual intervention
- **Pain point**: Scraping scripts break, schemas drift, secrets get exposed
- **Primary interface**: Python pipeline scripts, Supabase console, Vercel deploy logs
- **Key features needed**: Resumable pipeline, clear schema documentation, env-var management

---

## 6. Functional Requirements

> **Convention**: `[MUST]` = mandatory for current scope, `[SHOULD]` = high priority, `[COULD]` = desirable but lower priority.

---

### 6.1 Executive Overview (`/v2`)

This is the product's primary landing page and the highest-traffic view. It must be self-explanatory to a first-time viewer without any onboarding.

#### 6.1.1 Live Briefing Cards

| ID | Requirement | Priority |
|---|---|---|
| OV-01 | Display 2–4 auto-generated intelligence cards categorized as: `crisis` (red), `threat` (amber), `opportunity` (green), or `watch` (info) | MUST |
| OV-02 | Each card MUST contain: a category tag, a headline (one sentence, quantified), a body (two sentences of supporting data), and a CTA button linking to the relevant detail page | MUST |
| OV-03 | Cards MUST be generated automatically from live data — not hardcoded | MUST |
| OV-04 | The following signals MUST be evaluated for briefing card generation: (a) competitors outpacing JOOLA in active ads, (b) JOOLA running zero promotions vs competitors, (c) brands with lower follower counts but higher engagement rates than JOOLA, (d) top audience comments with high engagement | MUST |
| OV-05 | Cards MUST refresh when underlying data refreshes (no manual intervention) | MUST |

#### 6.1.2 Top-Line KPI Bar

| ID | Requirement | Priority |
|---|---|---|
| OV-06 | Display 4 platform-level KPIs: Total Instagram Followers tracked, Total YouTube Subscribers tracked, Total Ads tracked, Total Promotions tracked | MUST |
| OV-07 | Each KPI MUST show: current value, week-over-week delta (absolute + percentage), and a 6–8 week sparkline trend | MUST |
| OV-08 | Positive delta displayed in green (`#22c55e`), negative delta in red (`#ef4444`) | MUST |

#### 6.1.3 Movers Table

| ID | Requirement | Priority |
|---|---|---|
| OV-09 | Display a ranked table of brands sorted by week-over-week Instagram follower change | MUST |
| OV-10 | Each row MUST show: brand name with color dot, follower count, WoW delta, WoW delta percentage, and a 6-week mini trend bar | MUST |
| OV-11 | JOOLA row MUST be visually distinguished (green highlight or border) | MUST |

#### 6.1.4 Engagement Matrix (Scatter Plot)

| ID | Requirement | Priority |
|---|---|---|
| OV-12 | Display an interactive scatter plot: X-axis = Instagram followers, Y-axis = engagement rate | MUST |
| OV-13 | Each brand rendered as a colored dot (using BRAND_COLORS mapping) with JOOLA always labeled | MUST |
| OV-14 | On hover: show brand label and exact values | MUST |
| OV-15 | Quadrant dividers (median X, median Y lines) with quadrant labels: "High Reach + High Engagement", "Low Reach + High Engagement", "High Reach + Low Engagement", "Low Reach + Low Engagement" | MUST |

#### 6.1.5 Ads & Spend Summary

| ID | Requirement | Priority |
|---|---|---|
| OV-16 | Display a stacked area chart of weekly ad count by brand over the tracked period | MUST |
| OV-17 | Display a donut chart of current ad share (% of total ads per brand) | MUST |
| OV-18 | Both charts MUST use the consistent BRAND_COLORS palette | MUST |

#### 6.1.6 Pricing War Summary

| ID | Requirement | Priority |
|---|---|---|
| OV-19 | Display a table of current promotions per brand with count and promotion types | MUST |
| OV-20 | JOOLA's row highlighted; if JOOLA has 0 promotions and competitors have active ones, this state must be visually emphasized | MUST |

#### 6.1.7 Community Pulse

| ID | Requirement | Priority |
|---|---|---|
| OV-21 | Display Reddit sentiment bars per brand: positive / neutral / negative breakdown | MUST |
| OV-22 | Use the neutral-band gray convention (not brand color) for the neutral segment | MUST |

#### 6.1.8 Influencer Summary

| ID | Requirement | Priority |
|---|---|---|
| OV-23 | Display top influencers by engagement rate with brand affiliation | SHOULD |

#### 6.1.9 Product Catalog Summary

| ID | Requirement | Priority |
|---|---|---|
| OV-24 | Display a box plot of price distribution per brand (min, median, average, max) | MUST |

#### 6.1.10 Opportunities Panel

| ID | Requirement | Priority |
|---|---|---|
| OV-25 | Display 2–4 automatically computed opportunity cards: whitespace in the market that JOOLA is not exploiting, based on live data | MUST |
| OV-26 | Each opportunity card MUST contain: a category, a specific headline, supporting body text, and a CTA link | MUST |

#### 6.1.11 Section Navigation

| ID | Requirement | Priority |
|---|---|---|
| OV-27 | A sticky horizontal navigation bar at the top of the overview page must anchor-link to each section | MUST |

---

### 6.2 Instagram Intelligence (`/v2/instagram`)

#### 6.2.1 Follower Leaderboard

| ID | Requirement | Priority |
|---|---|---|
| IG-01 | Table of all tracked brands sorted by current follower count (descending) | MUST |
| IG-02 | Columns: Brand, Followers, WoW Delta, WoW Delta %, Engagement Rate, 8-week Sparkline | MUST |
| IG-03 | Columns must be sortable (click-to-sort ascending/descending) with visual sort indicators | MUST |
| IG-04 | Export to CSV from the table | SHOULD |

#### 6.2.2 KPI Cards

| ID | Requirement | Priority |
|---|---|---|
| IG-05 | 4 KPI cards: JOOLA Followers, JOOLA Engagement Rate, Market Average Engagement Rate, Most Active Brand This Week | MUST |
| IG-06 | Each card includes a sparkline and delta where applicable | MUST |

#### 6.2.3 Top Posts

| ID | Requirement | Priority |
|---|---|---|
| IG-07 | Table of top 12 Instagram posts by engagement (likes + comments), sorted by engagement | MUST |
| IG-08 | Columns: Brand, Format (Reel / Image / Carousel), Caption (truncated + hover for full), Likes, Comments, Views, Days old, Engagement Rate | MUST |
| IG-09 | Columns must be sortable | MUST |
| IG-10 | Caption column must truncate with ellipsis and reveal full text on hover (`title` attribute) | MUST |

#### 6.2.4 Posting Cadence

| ID | Requirement | Priority |
|---|---|---|
| IG-11 | Heatmap: rows = brands, columns = calendar weeks, cell value = number of posts that week | MUST |
| IG-12 | Cell color intensity scales from transparent (0 posts) to brand accent color (max posts) | MUST |
| IG-13 | Hover on each cell reveals: brand name, week, number of posts | MUST |
| IG-14 | Cells scale on hover to indicate interactivity | MUST |

#### 6.2.5 Platform CTA

| ID | Requirement | Priority |
|---|---|---|
| IG-15 | Page includes external link to JOOLA's official Instagram profile (opens in new tab) | MUST |

---

### 6.3 YouTube Intelligence (`/v2/youtube`)

#### 6.3.1 Channel Leaderboard

| ID | Requirement | Priority |
|---|---|---|
| YT-01 | Table of all tracked brands sorted by subscriber count | MUST |
| YT-02 | Columns: Brand, Subscribers, Total Videos, Total Views, WoW Subscriber Delta — all sortable | MUST |

#### 6.3.2 Top Videos

| ID | Requirement | Priority |
|---|---|---|
| YT-03 | Table of top 15 YouTube videos by view count | MUST |
| YT-04 | Columns: Brand, Title (sortable), Views, Likes, Comments, Duration, Published date | MUST |
| YT-05 | Title column sortable; text truncated with hover reveal | MUST |

#### 6.3.3 Subscriber Trend

| ID | Requirement | Priority |
|---|---|---|
| YT-06 | Multi-series line chart: subscriber count over time per brand | MUST |
| YT-07 | Hover shows crosshair + floating tooltip listing top 6 brands by value at hovered week | MUST |
| YT-08 | End-of-line labels deconflicted (sorted by y-position, pushed down to avoid overlap) | MUST |

#### 6.3.4 Platform CTA

| ID | Requirement | Priority |
|---|---|---|
| YT-09 | Page includes external link to JOOLA's YouTube channel (opens in new tab) | MUST |

---

### 6.4 Reddit & Community (`/v2/reddit`)

#### 6.4.1 Brand Mention Rankings

| ID | Requirement | Priority |
|---|---|---|
| RD-01 | Table of all brands ranked by total Reddit mention count | MUST |
| RD-02 | Columns: Rank, Brand, Mentions, Positive count, Neutral count, Negative count, WoW delta | MUST |
| RD-03 | Sentiment displayed as color-coded counts and as a stacked bar within each row | MUST |

#### 6.4.2 Sentiment Distribution

| ID | Requirement | Priority |
|---|---|---|
| RD-04 | Per-brand horizontal sentiment bar: positive (green) / neutral (gray, not brand color) / negative (red) | MUST |
| RD-05 | Hover on each row reveals full brand name, exact counts, and percentages | MUST |

#### 6.4.3 Subreddit Activity

| ID | Requirement | Priority |
|---|---|---|
| RD-06 | Table of tracked subreddits with post count and top brand mentions | MUST |
| RD-07 | Each subreddit row links to `reddit.com/r/<subreddit>` (opens in new tab) | MUST |
| RD-08 | Row hover reveals full summary via `title` attribute | MUST |

#### 6.4.4 Mention Trend

| ID | Requirement | Priority |
|---|---|---|
| RD-09 | Multi-series line chart of weekly Reddit mention counts per brand | MUST |

#### 6.4.5 Platform CTA

| ID | Requirement | Priority |
|---|---|---|
| RD-10 | Links to key pickleball subreddits (r/pickleball, r/pickleballequipment) | MUST |

---

### 6.5 Comments Intel (`/v2/comments`)

This page surfaces the raw voice-of-customer data embedded in social comments — the unfiltered language customers and fans use about each brand.

#### 6.5.1 Top Comments

| ID | Requirement | Priority |
|---|---|---|
| CM-01 | Table of top comments sorted by engagement (likes/upvotes) | MUST |
| CM-02 | Columns: Platform, Brand, User, Comment text (truncated), Likes, Sentiment pill | MUST |
| CM-03 | Comment text truncated to ~80 chars; full text on hover (`title` attribute) | MUST |
| CM-04 | Sentiment pill color-coded: positive = green, neutral = gray, negative = red | MUST |

#### 6.5.2 Filters

| ID | Requirement | Priority |
|---|---|---|
| CM-05 | Filter by brand (multi-select or single-select dropdown) | MUST |
| CM-06 | Filter by sentiment (all / positive / negative / neutral) | MUST |
| CM-07 | Filter by platform (Instagram / YouTube / Reddit) | SHOULD |

#### 6.5.3 Sentiment Summary KPIs

| ID | Requirement | Priority |
|---|---|---|
| CM-08 | 4 KPI cards: Total Comments tracked, JOOLA positive sentiment %, Most discussed topic, Top comment this week | MUST |

---

### 6.6 Influencer Network (`/v2/influencers`)

#### 6.6.1 Bubble Chart

| ID | Requirement | Priority |
|---|---|---|
| INF-01 | Interactive bubble chart: X = follower count, Y = engagement rate, bubble size = average likes per post | MUST |
| INF-02 | Bubble color corresponds to associated brand (BRAND_COLORS) | MUST |
| INF-03 | JOOLA-affiliated athletes always labeled; other labels appear only on hover | MUST |
| INF-04 | Collision detection: bubbles must not overlap; positions adjusted iteratively with minimum gap | MUST |
| INF-05 | Quadrant dividers with labels (e.g., "High Reach + High Engagement") | MUST |

#### 6.6.2 Influencer Table

| ID | Requirement | Priority |
|---|---|---|
| INF-06 | Sortable table of all tracked influencers | MUST |
| INF-07 | Columns: Athlete name/initials avatar, Brand, Followers, Posts tracked, Avg Likes, Engagement Rate — all sortable | MUST |
| INF-08 | Brand pill with correct brand color per row | MUST |

#### 6.6.3 KPI Cards

| ID | Requirement | Priority |
|---|---|---|
| INF-09 | 4 KPI cards: Total influencers tracked, JOOLA influencer count, Highest engagement rate athlete, Average engagement across all | MUST |

---

### 6.7 Ads Library (`/v2/ads`)

#### 6.7.1 Ad Creative Table

| ID | Requirement | Priority |
|---|---|---|
| AD-01 | Sortable table of latest ad creatives across all brands | MUST |
| AD-02 | Columns: Brand, Platform (Meta/Google), Ad copy (truncated + hover), CTA button text, Start date, Active status — all sortable | MUST |
| AD-03 | Active ads visually distinguished (green "LIVE" pill) | MUST |
| AD-04 | Copy column text truncated; full text revealed on hover | MUST |

#### 6.7.2 Ad Volume Chart

| ID | Requirement | Priority |
|---|---|---|
| AD-05 | Stacked area chart: weekly ad count by brand over time | MUST |
| AD-06 | All tracked brands included in the chart and legend (not limited to top 6) | MUST |
| AD-07 | Hover on chart area highlights the hovered brand's layer with a floating tooltip showing week + ad count | MUST |

#### 6.7.3 Ad Share Donut

| ID | Requirement | Priority |
|---|---|---|
| AD-08 | Donut chart showing current share of tracked ads per brand | MUST |
| AD-09 | Hover on each segment reveals brand name and percentage | MUST |

#### 6.7.4 Filters

| ID | Requirement | Priority |
|---|---|---|
| AD-10 | Filter by brand (dropdown) | MUST |
| AD-11 | Filter by platform (Meta / Google / All) | MUST |
| AD-12 | Filter by status (Active / All) | SHOULD |

#### 6.7.5 Platform CTA

| ID | Requirement | Priority |
|---|---|---|
| AD-13 | Link to Meta Ads Library filtered for pickleball category | MUST |

---

### 6.8 Promotions (`/v2/promotions`)

#### 6.8.1 Promotion Table

| ID | Requirement | Priority |
|---|---|---|
| PR-01 | Sortable table of all tracked promotions | MUST |
| PR-02 | Columns: Brand, Promotion text (truncated, max 380px), Promotion type, Discount value/pct, Start date, End date | MUST |
| PR-03 | Promotion text revealed in full on hover (`title` attribute) | MUST |

#### 6.8.2 Promotion Heatmap

| ID | Requirement | Priority |
|---|---|---|
| PR-04 | Heatmap: rows = brands, columns = weeks, cell = whether brand had active promotion that week | MUST |
| PR-05 | Active = brand-colored fill; inactive = dark/transparent | MUST |
| PR-06 | Hover on each cell reveals: brand, week, active/inactive state | MUST |

#### 6.8.3 KPI Cards

| ID | Requirement | Priority |
|---|---|---|
| PR-07 | KPI cards: Total promotions tracked, JOOLA active promo count, Most promotionally active brand, Brand with largest average discount | MUST |

#### 6.8.4 Promotion Type Breakdown

| ID | Requirement | Priority |
|---|---|---|
| PR-08 | Donut or bar chart showing distribution of promotion types (discount, BOGO, bundle, free shipping, etc.) | SHOULD |

---

### 6.9 Product Catalog (`/v2/products`)

#### 6.9.1 Product Table

| ID | Requirement | Priority |
|---|---|---|
| PD-01 | Sortable table of all tracked products | MUST |
| PD-02 | Columns: Brand, Product name, Category, Price (USD), scraped date | MUST |
| PD-03 | Columns sortable; brand filter via dropdown | MUST |

#### 6.9.2 Price Distribution Chart

| ID | Requirement | Priority |
|---|---|---|
| PD-04 | Box plot: one box per brand showing min, 25th percentile, median, 75th percentile, max of price_usd | MUST |
| PD-05 | Hover on each box reveals full statistics (min, median, avg, max, count) | MUST |

#### 6.9.3 Price Tier Bar

| ID | Requirement | Priority |
|---|---|---|
| PD-06 | Per-brand horizontal bar divided into three segments: Value (<$100), Mid ($100–$199), Premium (≥$200) | MUST |
| PD-07 | Each segment clickable/hoverable to show count and percentage | MUST |

#### 6.9.4 KPI Cards

| ID | Requirement | Priority |
|---|---|---|
| PD-08 | KPI cards: Total products tracked, JOOLA product count, JOOLA average price vs market average, Price range leaders | MUST |

---

### 6.10 Market Intel (`/v2/market`)

This page is a configurable freeform intelligence layer — a catch-all for signals that don't fit neatly into one channel.

#### 6.10.1 Market Signal Feed

| ID | Requirement | Priority |
|---|---|---|
| MK-01 | Chronological feed of market signals: new product launches, press mentions, tournament partnerships, major ad spend changes | MUST |
| MK-02 | Each signal card: date, source, category tag, headline, brief body, external link (opens in new tab) | MUST |
| MK-03 | Filter by category (product / partnerships / media / ads) | SHOULD |

#### 6.10.2 Market Share Scatter

| ID | Requirement | Priority |
|---|---|---|
| MK-04 | Scatter plot: X = Instagram share of voice, Y = ad volume share | MUST |
| MK-05 | Quadrant labels: "Dominant", "Ad-heavy", "Organic-only", "Quiet" | MUST |

#### 6.10.3 Trend Lines

| ID | Requirement | Priority |
|---|---|---|
| MK-06 | Multi-series line chart showing a selected metric (e.g. follower count) over time for all brands | SHOULD |

#### 6.10.4 AI-Generated Market Summary

| ID | Requirement | Priority |
|---|---|---|
| MK-07 | A button to invoke the OpenAI content generation API that produces a weekly market summary paragraph based on current data | SHOULD |
| MK-08 | Generated content displayed inline with a "Regenerate" option | SHOULD |

---

### 6.11 AI Content Generation

The system includes a server-side AI endpoint for generating marketing content based on the intelligence data.

| ID | Requirement | Priority |
|---|---|---|
| AI-01 | `POST /api/generate-content` endpoint accepts a prompt constructed from live dashboard data and returns GPT-4o generated content | MUST |
| AI-02 | API route runs server-side only — OpenAI key MUST NOT be exposed in the browser bundle | MUST |
| AI-03 | Generated content types: Instagram caption, Blog post intro, YouTube video description, Promotional email subject line | SHOULD |
| AI-04 | Response includes a "Copy to clipboard" button | SHOULD |
| AI-05 | Error handling: if generation fails, display a user-friendly error message (not a raw API error) | MUST |
| AI-06 | Generation calls are rate-limited or authenticated to prevent abuse | SHOULD |

---

### 6.12 Navigation & Shell

#### 6.12.1 Sidebar

| ID | Requirement | Priority |
|---|---|---|
| NAV-01 | Fixed-position sidebar (always visible on scroll) with links to all 10 pages | MUST |
| NAV-02 | Active page highlighted in sidebar | MUST |
| NAV-03 | Collapse/expand toggle on desktop: collapses to 60px icon-only rail; expands to 232px full labels | MUST |
| NAV-04 | Collapse state syncs via CSS custom property `--sidebar-w` so main content area adjusts automatically | MUST |
| NAV-05 | Mobile: sidebar hidden by default; hamburger button opens a drawer overlay | MUST |
| NAV-06 | Mobile: tapping any nav link closes the drawer | MUST |
| NAV-07 | "LIVE" badge displayed on Executive Overview link | MUST |
| NAV-08 | Footer shows live data sync status (last scraped timestamp) | SHOULD |

#### 6.12.2 Page Shell

| ID | Requirement | Priority |
|---|---|---|
| NAV-09 | Each page has a consistent `PageHead` with: eyebrow label, H1 title + italic accent, subtitle, and optional actions slot | MUST |
| NAV-10 | Section `?` tooltip (SectionInfo) available on any section header; click-to-pin, Esc to dismiss, outside-click to dismiss | MUST |
| NAV-11 | Loading state: skeleton placeholders render during data fetch (no blank screens or layout shift) | MUST |
| NAV-12 | Toast notification component for async actions (copy, export, generation complete) | SHOULD |

#### 6.12.3 Search & Filtering

| ID | Requirement | Priority |
|---|---|---|
| NAV-13 | Brand filter is consistent across pages that support it: dropdown or chip-based multi-select | MUST |
| NAV-14 | Filters do not require page reload (client-side filtering) | MUST |

---

## 7. Non-Functional Requirements

### 7.1 Performance

| ID | Requirement | Target |
|---|---|---|
| PERF-01 | Page load time (Time to Interactive) for any dashboard page | ≤ 3 seconds on a standard broadband connection |
| PERF-02 | Data fetching: Supabase queries return within | ≤ 1500ms for all page fetchers |
| PERF-03 | Overview page uses parallel data fetching (`Promise.all`) — no sequential waterfall | Mandatory pattern |
| PERF-04 | Charts render without visible jank during initial paint | < 16ms per animation frame |
| PERF-05 | Python pipeline completes a full scrape of all brands across all platforms | ≤ 4 hours per weekly run |

### 7.2 Reliability & Availability

| ID | Requirement | Target |
|---|---|---|
| REL-01 | Dashboard uptime | ≥ 99.5% monthly (Vercel SLA) |
| REL-02 | Python pipeline failure: partial failure must not corrupt previously stored data | MUST |
| REL-03 | Pipeline supports resume from checkpoint (if run is interrupted, it continues from last successful step) | MUST |
| REL-04 | Dashboard renders gracefully with partial data (if one Supabase query fails, page still loads with available data) | MUST |

### 7.3 Scalability

| ID | Requirement | Notes |
|---|---|---|
| SCAL-01 | System must support adding new competitor brands without code changes (data-driven via `brands` table) | Brand list controlled by DB |
| SCAL-02 | System must support adding new data platforms by adding new Supabase tables and a corresponding fetcher | MUST |
| SCAL-03 | Influencer bubble collision algorithm must handle up to 50 athletes without noticeable slowdown | Current: O(n²) repulsion — acceptable for <50 athletes |

### 7.4 Accessibility

| ID | Requirement | Standard |
|---|---|---|
| ACC-01 | All interactive table columns have `aria-sort` attribute reflecting current sort state | WCAG 2.1 AA |
| ACC-02 | All icon-only buttons have `aria-label` | WCAG 2.1 AA |
| ACC-03 | Color is not the sole differentiator for data — charts include labels, tooltips, and tables | WCAG 2.1 AA |
| ACC-04 | Keyboard navigation: all interactive elements reachable and operable via keyboard | WCAG 2.1 AA |
| ACC-05 | Minimum text contrast ratio | 4.5:1 (normal text), 3:1 (large text) |

### 7.5 Maintainability

| ID | Requirement |
|---|---|
| MAIN-01 | All dashboard styles in a single file (`app/v2.css`) — no per-component style files |
| MAIN-02 | All data fetchers in a single file (`lib/v2/data.ts`) — no scattered Supabase calls |
| MAIN-03 | Chart components in a single file (`components/v2/charts.tsx`) |
| MAIN-04 | No hardcoded brand names or colors in page files — always use `BRAND_COLORS` and `brands` data |
| MAIN-05 | TypeScript strict mode; no `any` types in production code (data.ts may use `any` for raw Supabase rows only) |

### 7.6 Browser Support

| Browser | Requirement |
|---|---|
| Chrome (latest) | MUST support |
| Firefox (latest) | MUST support |
| Safari (latest) | MUST support |
| Edge (latest) | MUST support |
| Mobile Chrome / Safari | MUST support (responsive layout) |
| IE / legacy | Out of scope |

---

## 8. Data Requirements

### 8.1 Tracked Brands

The system tracks the following brands. The brand list is controlled by the `brands` table and must be extensible without code changes.

| Brand | Slug | Color |
|---|---|---|
| JOOLA | `joola` | `#22c55e` |
| Selkirk | `selkirk` | `#F5E625` |
| CRBN | `crbn` | `#818cf8` |
| Franklin | `franklin` | `#ec4899` |
| Engage | `engage` | `#06b6d4` |
| Paddletek | `paddletek` | `#f59e0b` |
| Six Zero | `six-zero` | `#a855f7` |
| Onix | `onix` | `#ef4444` |
| Wilson | `wilson` | `#14b8a6` |
| Gamma | `gamma` | `#60a5fa` |
| ProKennex | `prokennex` | `#fb923c` |
| Head | `head` | `#0ea5e9` |

### 8.2 Data Sources

| Source | Method | Frequency | Volume Estimate |
|---|---|---|---|
| Instagram profiles (followers, engagement) | Apify scraper → Supabase | Weekly (Monday) | ~12 rows/week per brand |
| Instagram posts (content, likes, comments) | Apify scraper | Weekly | ~50–200 posts per brand |
| YouTube channels (subscribers, views) | Apify scraper | Weekly | ~12 rows/week per brand |
| YouTube videos (view count, likes) | Apify scraper | Weekly | ~50–100 videos per brand |
| Meta Ads Library (ad creatives) | Apify scraper | Weekly | ~20–100 ads per brand |
| Google Ads Library (ad creatives) | Apify scraper | Weekly | Varies |
| Reddit mentions | Apify scraper (r/pickleball etc.) | Weekly | ~100–500 mentions total |
| Promotions (from brand websites) | Apify scraper | Weekly | ~5–30 per brand |
| Products (from brand websites / marketplaces) | Apify scraper | Weekly | ~20–100 per brand |
| Influencers (from IG / manual seed list) | Apify scraper + manual | Monthly | ~50–200 total |

### 8.3 Database Tables

| Table | Description | Key Columns |
|---|---|---|
| `brands` | Master brand list | `id`, `name`, `slug`, `is_joola` |
| `ig_profiles_weekly` | Weekly Instagram follower snapshots | `brand_id`, `followers`, `week_number`, `year` |
| `ig_posts` | Individual Instagram posts | `brand_id`, `handle`, `caption`, `like_count`, `comment_count`, `view_count`, `post_format`, `posted_at` |
| `yt_channel_weekly` | Weekly YouTube channel snapshots | `brand_id`, `subscribers`, `total_videos`, `total_views`, `week_number`, `year` |
| `yt_videos` | Individual YouTube videos | `brand_id`, `title`, `view_count`, `like_count`, `comment_count`, `duration`, `published_at` |
| `marketing_ads` | Ad creatives from Meta + Google | `brand_id`, `platform`, `body`, `cta`, `started_at`, `is_active`, `captured_at` |
| `promotions` | Promotional offers from brand websites | `brand_id`, `promo_type`, `description`, `discount_pct`, `started_at`, `ended_at` |
| `products` | Product catalog entries | `brand_id`, `name`, `category`, `price_usd`, `scraped_at` |
| `reddit_mentions` | Reddit post/comment mentions | `brand_id`, `subreddit`, `title`, `body`, `sentiment`, `score`, `created_at` |
| `influencers` | Tracked influencer accounts | `id`, `name`, `brand_id`, `follower_count_ig`, `handle_ig` |
| `influencer_posts` | Posts by tracked influencers | `influencer_id`, `like_count`, `comment_count`, `posted_at` |
| `comments` | Comments from IG/YT/Reddit | `brand_id`, `platform`, `user`, `text`, `likes`, `sentiment` |
| `subreddits` | Tracked subreddit list | `name`, `description`, `subscriber_count` |

### 8.4 Data Freshness Requirements

| Dataset | Maximum Acceptable Age |
|---|---|
| Instagram followers | 8 days (weekly scrape) |
| YouTube subscribers | 8 days |
| Ad creatives | 8 days |
| Promotions | 8 days |
| Products | 14 days |
| Reddit mentions | 8 days |
| Influencer data | 30 days |

### 8.5 Data Quality Requirements

| ID | Requirement |
|---|---|
| DQ-01 | Every Supabase table row must have a valid `brand_id` that references the `brands` table |
| DQ-02 | Null handling: all numeric fields that are null must be treated as 0 in aggregations, not NaN |
| DQ-03 | Duplicate detection: the pipeline must not insert duplicate rows for the same brand + week combination in weekly snapshot tables |
| DQ-04 | Sentiment classification (positive / neutral / negative) must be applied consistently; unknown or unclassifiable sentiment defaults to `neutral` |
| DQ-05 | Price values must be stored in USD; non-USD prices must be converted at time of scraping |

---

## 9. Integration Requirements

### 9.1 Supabase

| ID | Requirement |
|---|---|
| INT-01 | The Next.js app connects to Supabase using the public anon key — read-only operations only |
| INT-02 | The Python pipeline connects using the service_role key — full read/write access |
| INT-03 | Supabase Row Level Security (RLS) MUST be enabled on all tables with anon role restricted to SELECT |
| INT-04 | Supabase client singleton (`lib/shared/supabase.ts`) used for all dashboard queries |

### 9.2 OpenAI

| ID | Requirement |
|---|---|
| INT-05 | OpenAI API called exclusively from the server-side API route (`app/api/generate-content/route.ts`) |
| INT-06 | Model: GPT-4o (or latest available) |
| INT-07 | API key stored as a server-only environment variable (`OPENAI_API_KEY`) — NOT prefixed with `NEXT_PUBLIC_` |

### 9.3 Apify

| ID | Requirement |
|---|---|
| INT-08 | Apify used as the scraping runtime for Instagram, YouTube, Reddit, Meta Ads, Google Ads, and brand websites |
| INT-09 | Apify token stored in `scripts/.env` only — never committed to git, never in Vercel env vars |
| INT-10 | Apify actors called from Python scripts; results written directly to Supabase |

### 9.4 Vercel

| ID | Requirement |
|---|---|
| INT-11 | Application deployed to Vercel; auto-deploys on push to `main` branch |
| INT-12 | Production environment variables set in Vercel project settings: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `OPENAI_API_KEY` |

---

## 10. Security & Compliance Requirements

| ID | Requirement | Priority |
|---|---|---|
| SEC-01 | Supabase service_role key MUST never be stored in the Next.js app or committed to git | MUST |
| SEC-02 | OpenAI API key MUST be server-only (no `NEXT_PUBLIC_` prefix) | MUST |
| SEC-03 | All scraped data is from publicly accessible sources only — no login-gated scraping | MUST |
| SEC-04 | Supabase Row Level Security enabled on all tables; anon key allows SELECT only | MUST |
| SEC-05 | `.env` files added to `.gitignore`; CI must fail if secrets are detected in commits | MUST |
| SEC-06 | Apify token stored in `scripts/.env` only; Python scripts read from environment, not hardcoded | MUST |
| SEC-07 | No PII (Personally Identifiable Information) stored in the database — influencer names are public figures | SHOULD verify |
| SEC-08 | Rotate all credentials exposed during initial GitHub push: Supabase service_role key, Apify token, OpenAI key | MUST (pending) |
| SEC-09 | The dashboard has no authentication layer in POC; add SSO / password protection before sharing externally | SHOULD |

---

## 11. Constraints & Assumptions

### 11.1 Constraints

| Constraint | Detail |
|---|---|
| Data availability | All data is from publicly accessible sources via Apify. Data behind login walls (e.g. private Instagram profiles) is not available |
| Scraping rate limits | Apify actors are subject to platform rate limits; run frequency is limited to avoid IP bans |
| API cost | OpenAI and Apify both incur per-call costs; high generation frequency or large scrape volumes increase costs |
| Single timezone | Dashboard timestamps and "last sync" labels are in IST (Indian Standard Time) — the team's working timezone |
| Weekly cadence | Data freshness is weekly by design; real-time or daily scraping requires a different pipeline architecture |
| Python runtime | The scraping pipeline runs on a local Windows laptop or a cron job; it is not deployed with the Next.js app |
| Browser-only Supabase reads | The dashboard reads from Supabase directly via the browser using the anon key; there is no custom API middleware layer |

### 11.2 Assumptions

| Assumption | Detail |
|---|---|
| A1 | The 11–12 tracked brands represent the complete relevant competitive set in North American pickleball equipment |
| A2 | Public Instagram, YouTube, Reddit, and ad library data is sufficient for competitive intelligence without needing any paid data APIs |
| A3 | Weekly data refresh is sufficient for strategic decision-making; tactical decisions (intra-week ad response) are out of scope |
| A4 | The team accessing the dashboard is internal JOOLA employees — no external user accounts needed for POC |
| A5 | Vercel's free/pro tier is adequate for the expected traffic volume (internal team, ~10–20 weekly active users) |
| A6 | Supabase's free tier or pro tier is adequate for the data volume (~500K rows, growing ~50K/week) |
| A7 | Python scripts are maintained by a technical team member who can run them manually or set up a cron job |

---

## 12. Out of Scope

The following items are explicitly excluded from the current scope:

| Item | Notes |
|---|---|
| User authentication / login | POC assumes internal access only; Vercel password protection is sufficient for now |
| Real-time data (< 24h freshness) | Requires streaming infrastructure; out of scope for weekly intelligence use case |
| TikTok data | Not currently scraped; could be added in a future sprint |
| Amazon / retail data | Product pricing from retail platforms (Amazon, Dick's Sporting Goods) not in scope |
| Email / push notifications | Dashboard is pull-only; no alerts or notifications sent proactively |
| Multi-language support | English only |
| Dark/Light mode toggle | Dark mode only |
| Historical data beyond tracking start date | No backfill of data before the system was deployed |
| Predictive analytics / forecasting | Dashboard is descriptive, not predictive |
| Competitor website traffic data | Requires paid tools (SimilarWeb, etc.); not in scope |
| Paid social media API access | All social data is via scraping, not official platform APIs |
| Admin panel for data management | No UI for editing/deleting Supabase records; use Supabase Studio directly |
| Export to PDF or PowerPoint | CSV export from tables is in scope; full report export is not |

---

## 13. Glossary

| Term | Definition |
|---|---|
| **Engagement Rate** | `(avg likes + avg comments per post) / followers × 100` — expressed as a percentage |
| **Share of Voice** | A brand's percentage of total tracked activity in a given channel (e.g., 23% of all tracked ads) |
| **WoW** | Week-over-Week — the difference between the current week's value and the prior week's value |
| **Sparkline** | A small inline chart (8–12 data points) showing trend without axes or labels |
| **Brand slug** | A lowercase, hyphenated identifier for a brand (e.g. `six-zero`, `prokennex`) used as the canonical key across all tables |
| **Apify** | Cloud-based web scraping platform used to run scraping actors that collect public social data |
| **Supabase** | Managed Postgres database with a real-time API; the system's single data store |
| **Vercel** | Cloud hosting platform for Next.js; handles build, deploy, and edge CDN |
| **Anon key** | Supabase's public API key — allows read access to tables with RLS policies that permit SELECT |
| **Service_role key** | Supabase's admin API key — bypasses RLS; used only by Python pipeline scripts |
| **RLS** | Row Level Security — Supabase/Postgres feature to restrict data access at the row level per role |
| **Pipeline** | The Python scraping system (`scripts/`) that collects data from external sources and writes it to Supabase |
| **Briefing card** | An automatically generated intelligence card on the Overview page categorized as crisis / threat / opportunity / watch |
| **Brand dot** | A small colored circle (6×6px) preceding a brand name in tables and lists, using the brand's designated color |
| **Quadrant chart** | A scatter plot with four regions defined by median or midpoint crosshairs on both axes |
| **Active ad** | An ad creative where `is_active = true` in the database — currently being served by the platform |
| **Promotion** | A temporary pricing offer (discount, bundle, BOGO, etc.) scraped from brand websites |
| **Heatmap** | A grid visualization where cell color intensity represents a quantitative value |
| **Box plot** | A statistical chart showing distribution of values: min, Q1, median, Q3, max per group |
| **JOOLA** | The client brand — the subject of competitive intelligence; always highlighted green (`#22c55e`) |
