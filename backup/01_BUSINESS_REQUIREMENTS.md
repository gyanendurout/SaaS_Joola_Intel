# 01 — Business Requirements

> **Read this first.** Every other document in `backup/` describes implementation. This one describes the product. If you don't agree with the goals here, don't rebuild — re-scope first.

---

## Product

**JOOLA Intel** — a pickleball competitive intelligence dashboard. A single-pane-of-glass view of what 11 competing paddle brands are doing across every public digital channel, refreshed weekly, with AI-generated signals on top of the raw data.

## Owner

- **Sponsor:** JOOLA (paddle/pickleball brand)
- **Operating contact:** api@joola.com (TODO: verify with team)

## Users

JOOLA's **marketing & competitive-intel team**. Internal-only. Not a customer-facing product.

Primary roles:
- **Marketing managers** — set weekly campaign focus based on what competitors did.
- **Brand / PR** — catch crisis signals (defect mentions, viral negative threads) within days of them surfacing.
- **Product team** — see which paddles are gaining/losing mindshare; price-track competitors.
- **Athlete partnerships** — quantify ROI on JOOLA's 27-athlete roster vs competitor signings.
- **Executive sponsors** — get a Monday-morning briefing without reading 200 Reddit threads themselves.

## Why this exists

Manual competitive monitoring across Instagram, YouTube, Reddit, X, TikTok, Meta Ads, Google Ads, and brand websites for 11 brands is ~20+ hrs/wk of analyst time and still misses signal. JOOLA Intel consolidates the same coverage into a single dashboard refreshed automatically, layered with AI sentiment + crisis flagging so the team spots issues before they trend.

**One sentence:** "Track 11 brands' performance across all social channels in one view; spot crisis signals, defection trends, product wins/losses, athlete ROI."

---

## Tracked brands (11)

| Slug | Display name | Notes |
|---|---|---|
| `joola` | JOOLA | The home brand. Always rendered in `#22c55e` green. |
| `selkirk` | Selkirk | Largest competitor. |
| `paddletek` | Paddletek | Established, mid-premium. |
| `crbn` | CRBN | Carbon-fiber-first challenger. |
| `six-zero` | Six Zero | Direct-to-consumer disruptor. |
| `engage` | Engage | Performance-focused. |
| `onix` | Onix | Mass-market presence. |
| `franklin` | Franklin (Franklin Pickleball) | Sporting-goods conglomerate. |
| `head` | HEAD | Cross-sport racquet brand. |
| `wilson` | Wilson | Cross-sport racquet brand. |
| `gamma` | Gamma | Mid-tier, broad distribution. |

ProKennex is referenced in some scripts (TikTok seed) but is **not** part of the canonical 11 — verify with team before adding to dashboards.

Brand IDs live in the `brands` table; the dashboard keys by `slug` for design parity.

---

## Tracked athletes (27)

Full roster is in the `influencers` table (seed lives in migrations + earlier seed scripts). Names include:

Ben Johns, Tyson McGuffin, Anna Leigh Waters, Anna Bright, Patrick Smith, Catherine Parenteau, Riley Newman, Simone Jardim, Zane Navratil, James Ignatowich, Jorja Johnson, Jay Devilliers, Jessie Irvine, Kyle Yates, Tanner Tomassi, Bobbi Oshiro, Sarah Ansboury, Leigh Waters, Connor Garnett, Aspen Kern, Roscoe Bellamy, Alex Neumann, Andrei Daescu, Allyce Jones, Blaine Hovenier, Gabe Joseph, Eric Oncins.

Each athlete has an Instagram handle (seeded), an X handle (seeded in `migrations/005_influencer_x.sql`), and per-week snapshot rows.

---

## Tracked products

**25 paddles seeded in `products_catalog`** (migration `007_cross_channel_facts.sql`):

- **JOOLA (7):** Perseus IV, Perseus Pro IV, Hyperion CFS, Scorpeus IV, Agassi Pro, Solaire, Ben Johns Hyperion.
- **Selkirk (4):** Vanguard Power Air, Luxx Control Air, Halo, Invikta.
- **Paddletek (2):** Bantam TS-5, Tempest Reign.
- **CRBN (3):** CRBN-3, CRBN-X, CRBN-1.
- **Six Zero (2):** Double Black Diamond (DBD), Ruby.
- **Engage (1):** Pursuit Pro.
- **Onix (2):** Z5, Evoke.
- **Franklin (1):** Signature Pro.
- **HEAD (1):** Radical Pro.
- **Wilson (1):** Juice Pro.
- **Gamma (1):** Obsidian.

The catalog is **extensible** — adding a new SKU is a normal upsert. Each row has an `aliases` text[] so the AI enrichment can match free-text mentions (e.g. "Perseus 4", "PerseusIV") back to a canonical paddle.

A separate `products` table holds **scraped** SKUs (price, stock, discount) per weekly run and is **distinct** from `products_catalog`. Both are needed.

---

## Data sources

| Channel | Apify actor | Frequency | Cost order |
|---|---|---|---|
| Instagram (brand) | `apify/instagram-profile-scraper` | Weekly | Low |
| Instagram (athlete) | `apify/instagram-profile-scraper` | Weekly | Low |
| Instagram comments | `apify/instagram-comment-scraper` | Weekly | Med |
| YouTube channels + videos | `streamers/youtube-scraper` | Weekly | Low |
| YouTube comments | `streamers/youtube-comments-scraper` | Weekly | Med |
| Reddit OPs (brand subs + cross-sub mentions) | `trudax/reddit-scraper-lite` | Weekly | Low |
| Reddit comments | `trudax/reddit-scraper-lite` (separate run via `scrape_reddit_comments.py`) | Weekly | Med |
| X / Twitter (brand) | `apidojo/twitter-scraper-lite` | Weekly | Low |
| X / Twitter (athlete) | `apidojo/twitter-scraper-lite` | Weekly | Low |
| TikTok | `clockworks/tiktok-scraper` | Weekly | Low |
| Brand homepage banners (promos) | `apify/playwright-scraper` | Weekly | Low |
| Brand product catalog | `apify/playwright-scraper` | Weekly | Med |
| Meta Ad Library | `apify/facebook-ads-scraper` | Weekly | Med |
| Google Ads Transparency | `solidcode/ads-transparency-scraper` | Weekly | Low |

Full actor IDs, env vars, and per-run costs are in `03_SCRAPING_PIPELINE.md`.

---

## Update cadence

- **Weekly, Monday 07:00 IST** (TODO: confirm time zone with team).
- **Manual trigger** for now: a human runs `python scripts/apify_to_supabase.py` on their laptop. Cron is `TODO: set up GitHub Actions cron` (see `08_RUNBOOK.md`).
- **Data flow:** scripts write to Supabase via service-role key → dashboard reads from Supabase via anon key → no redeploy needed when data changes.
- **Code flow:** dev pushes to `main` on GitHub → Vercel rebuilds in ~90 s.

---

## AI enrichment scope

GPT-4o-mini classifies every text-bearing row across all channels:

| Field | Type | Purpose |
|---|---|---|
| `sentiment_score` | numeric (-1.0 → 1.0) | continuous sentiment |
| `sentiment_label` | enum | `very_negative` / `negative` / `neutral` / `positive` / `very_positive` |
| `topics` | jsonb[] | 1-4 short topic tags |
| `brands_mentioned` | text[] | brand slugs found in text |
| `players_mentioned` | text[] | athletes found in text |
| `products_mentioned` | text[] | paddle names found in text |
| `is_crisis` | bool | product failure / defect / warranty / fraud signal |
| `is_opportunity` | bool | buying intent / switch-from-competitor / positive UGC about JOOLA |
| `purchase_intent_score` | numeric (0.0 → 1.0) | "I'm buying X this week" detector |
| `crisis_keywords` | text[] | found crisis words (e.g. broken, delaminating, refund) |
| `competitor_switch_from` | text (Reddit only) | brand the writer is leaving |
| `competitor_switch_to` | text (Reddit only) | brand the writer is moving to |

Total **12 enrichment columns** populated per row (some channels skip a subset — see `04_AI_ENRICHMENT.md`).

---

## Key KPIs surfaced on the dashboard

| KPI | Where shown | Calculation |
|---|---|---|
| Share of Voice (SoV) | `/v2/ads`, `/v2` Executive Overview | `brand_ads / total_ads` across the filtered brand set (NOT the DB `share` field — that's a global pre-compute) |
| Engagement rate | `/v2/instagram`, `/v2/youtube` | (likes + comments) / followers, per weekly snapshot |
| Sentiment by brand × product | `/v2/comments`, `/v2/reddit`, `/v2/products` | avg `sentiment_score` from `mention_facts` |
| Crisis count | `/v2` Executive Overview, `/v2/reddit` | `count(*)` where `is_crisis = true` in the rolling window |
| Purchase-intent count | `/v2/comments` | `count(*)` where `purchase_intent_score >= 0.6` |
| Competitor net defection | `/v2/market` | `count(switch_to=JOOLA) - count(switch_from=JOOLA)` from `competitor_switch_events` |
| Topic lifecycle (first-channel detection) | `/v2/market` | `topic_lifecycle.first_seen_channel` — answers "where did this trend start?" |
| Influencer ROI bubble | `/v2/influencers` | x = followers, y = engagement, bubble = post count |
| Price-tier mix | `/v2/products` | bucketed `value/mid/premium` from `products` table |
| Promotion cadence | `/v2/promotions` | days-active count of `promotions` rows per brand per week |

---

## Non-functional requirements

- **Dark theme only.** All views use the dark palette in `06_DESIGN_SYSTEM.md`.
- **Single deployable Next.js 14 app.** No separate backend service.
- **Browser reads Supabase directly** via anon key — no custom API layer for reads.
- **One server endpoint** exists: `app/api/generate-content/route.ts` for OpenAI content generation. POC-stage; key currently leaks via `NEXT_PUBLIC_OPENAI_KEY`.
- **Mobile responsive at 375 px and 768 px breakpoints** — but the product is primarily desktop.
- **Data freshness target:** weekly. Real-time is explicitly **out of scope**.

---

## Out of scope

- Real-time data (sub-day refresh).
- Direct customer-facing publication of any insights.
- Authentication / multi-tenant — single internal team only.
- Mobile-native app (web responsive is sufficient).
- Sales/CRM integration.
- Automated content publishing (AI generates briefs; humans publish).
