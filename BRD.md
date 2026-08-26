# JOOLA Intel — Business Requirements Document

> Living document. Owner: Gyanendu Rout (`systems@joola.in`). Last updated: 2026-08-24.
> **This file is the sole owner of the product spec.** `CLAUDE.md` holds coding
> rules only and must not restate anything below. Architecture and file maps
> live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
>
> **Verified against the code on 2026-08-24** by a full-repo audit. Every count,
> route, and claim below was checked against the working tree, not carried
> forward from a previous revision. §17 records what the audit changed and what
> it left open.

---

## 1. Product

**JOOLA Intel** — a pickleball competitive intelligence dashboard. A single-pane-of-glass view of what **11 competing paddle brands** are doing across every public digital channel, refreshed weekly, with AI-generated signals on top of the raw data, plus a natural-language Q&A surface (Ask Intel).

- **Live URL:** https://saas-joola-intel.vercel.app
- **Repo:** https://github.com/gyanendurout/SaaS_Joola_Intel (`main` auto-deploys to Vercel)
- **Local path:** `c:\Workspace\joola-intel-nextjs`

## 2. Owner & Users

- **Sponsor:** JOOLA (paddle / pickleball brand). Operating contact: `api@joola.com`.
- **Primary users:** JOOLA's marketing & competitive-intel team (internal).
- **Secondary surface:** CFO / executive / board — the dashboard doubles as a BI surface translating public signals into leading indicators for the internal P&L.

### Primary roles
| Role | What they get from JOOLA Intel |
|---|---|
| Marketing managers | Weekly competitive briefing — what each of the 10 competitors did, where to focus next |
| Brand / PR | Crisis signals (defect mentions, viral negative threads) flagged within days |
| Product team | Mindshare per paddle, competitor price/promo activity, public-review velocity, customer-review voice |
| Athlete partnerships | Quantified ROI on JOOLA's sponsored-athlete roster vs competitor signings |
| Executive sponsors / CFO | Monday-morning brief without reading 200 Reddit threads; BI surface tied to sales/inventory/forecast variables |

## 3. Why this exists

Manual competitive monitoring across Instagram, YouTube, Reddit, X, TikTok, Meta Ads, Google Ads, and brand websites for 11 brands is ~20+ hours/week of analyst time and still misses signal. JOOLA Intel consolidates that coverage into one dashboard refreshed automatically, layered with AI sentiment + crisis flagging + a natural-language query interface so the team spots issues before they trend — and so the CFO can ask the data questions directly.

**One sentence:** *Translate 11 brands' public signal into JOOLA's competitive playbook — and, increasingly, into JOOLA's sales / inventory / forecast leading indicators.*

---

## 4. Scope

### In scope
- All publicly-available data across Instagram, YouTube, Reddit, X, TikTok, Meta Ad Library, Google Ads Transparency, brand homepages (promotions), brand product catalogs (with public review counts), weekly product-page stock snapshots, and retail customer reviews.
- AI enrichment via GPT-4o-mini: sentiment, topic extraction, brand/player/product NER, crisis flagging, purchase-intent scoring, Reddit competitor-switch detection.
- Read-only Ask Intel natural-language Q&A over the warehouse.

### Strictly out of scope (today)
- **Internal sales, inventory, or ERP feeds are NOT wired in.** Schema is designed to fold them in later — today every number is derived from public signal.
- OpenAI never executes SQL. The backend (`sqlSafety.ts`) validates every structured query plan before execution.
- Supabase access is read-only via anon key for the dashboard. Service-role key is scoped to Python pipeline writes.
- No data modification path from the dashboard, with one declared exception: Ask Intel writes its own Q&A + thumbs-up/down telemetry to `ask_intel_qa_log` (migration 017). No other user data is inserted, updated, or deleted.
- No web search at runtime by the analytics surfaces — they read only the curated, scraped corpus. See §4.1 for the one code path that does fetch live URLs.

### 4.1 Undeclared surface — SEO / content generation (**decision required**)

Four Next.js API routes ship in the deployed app and are **not part of the
product described above**:

| Route | What it does |
|---|---|
| `POST /api/keyword-research` | LLM keyword-research agent |
| `POST /api/content-brief` | LLM SEO content-brief generator |
| `POST /api/generate-content` | LLM blog-post generator for joola.com |
| `POST /api/seo-analyzer` | Fetches an arbitrary user-supplied URL and audits its on-page SEO |

They are **generative, not read-only**, and `seo-analyzer` performs live
outbound fetches — both contrary to the scope rules above. No page, component,
or test in the repo calls any of them: they are reachable only by POSTing
directly to the deployed domain, and the app has no authentication.

There is also a matching `seo` module in the Python pipeline
(`backend/scraping/sources/seo/scrape_seo.py`) writing SEO tables that no
frontend surface reads.

**This is a scope question, not a bug.** Either SEO/content tooling is a
declared second product surface — in which case it needs a spec, a UI, and its
own security review — or it is dead POC code and must be deleted. Until that
call is made, treat §12's security requirements for these routes as binding.
The engineering task is tracked in [TODO.md](TODO.md).

---

## 5. Tracked entities

| Entity | Count | Source-of-truth |
|---|---|---|
| Brands | 11 (`joola`, `selkirk`, `paddletek`, `crbn`, `six-zero`, `engage`, `onix`, `franklin` aka Franklin Pickleball, `head`, `wilson`, `gamma`) | `brands` table |
| Athletes | **42 distinct players across 45 roster rows** — 3 players (Parris Todd, Riley Newman, Steve Deakin) are multi-brand and appear twice. 10 of the 11 brands have at least one roster entry. | `influencers` table; UI roster in `frontend/lib/v2/playerRoster.ts`; original 27 seeded in `migrations/005_influencer_x.sql` |
| Products | 86 paddles post-migration 015 (extensible) — JOOLA Perseus/Hyperion/Scorpeus, Selkirk Vanguard/Luxx/Boomstick, Paddletek Bantam, CRBN-1/3/X, Six Zero DBD, Engage Pursuit Pro, Onix Z5, etc. | `products_catalog` |
| Retail reviews | 22,210 rows, `brand_id` on 100%, 4.80 avg rating, across crbn / selkirk / joola / paddletek / six-zero | `paddle_reviews` (written by a pipeline **outside this repo** — see §6) |

> The "27 athletes" figure used before 2026-08-24 was the original migration-005
> seed and had been superseded by roster growth. 42 is the number the UI
> renders. If the business expects a different roster size, `playerRoster.ts` is
> the file to reconcile.

---

## 6. Data sources & cadence

| Source | What we pull | Cadence | Pipeline module |
|---|---|---|---|
| Instagram | Brand profiles + athlete profiles + posts + comments + brand replies | Weekly | `instagram` |
| YouTube | Brand channels + videos + comments + transcripts | Weekly | `youtube` |
| Reddit | OPs + full comment trees from pickleball subs | Weekly | `reddit` |
| X (Twitter) | Brand + athlete posts | Weekly | `twitter` |
| TikTok | Brand videos + comments | Weekly | `tiktok` |
| Meta Ad Library | Active creatives per brand | Weekly | `ads` |
| Google Ads Transparency | Active creatives per brand | Weekly | `ads` |
| Brand homepages | Promotion banners | Weekly | `products` |
| Brand product catalogs | SKU listing + public review counts | Weekly | `products` |
| Brand product pages | Stock snapshots (in / out of stock) | Weekly | `sales-intelligence` |
| Brand product widgets | Per-product review text (Bazaarvoice / Judge.me) | On demand | `reviews`, `reviews-crawl4ai` |
| News | Pickleball / brand news articles | Weekly | `news` |
| SEO | Domain / keyword ranking data | Weekly | `seo` |

**Retail reviews (`paddle_reviews`) are supplied by a pipeline outside this
repo** — retailer-side collection across Okendo / Judge.me / Yotpo /
Bazaarvoice, arriving pre-enriched. Nothing in this repo guarantees it keeps
refreshing; `paddle_review_runs` carries the run telemetry. This supersedes the
in-repo `product_reviews` table (migration 016), which remains at 0 rows and is
effectively dead.

**Two sources are collected but reach no user-facing surface.** `news_articles`
(923 rows) and the `seo` tables are written by the pipeline, are not a
`mention_facts` channel, are absent from the Ask Intel schema, and are read by
no frontend page. They are cost without product value until wired in or
retired — tracked in [TODO.md](TODO.md).

- **Trigger:** `python scripts/weekly_run.py` (manual today; GitHub Actions cron is a pending hardening item).
- **Enrichment chain:** phase 2 (`backend/scraping/enrichment/`) → phase 3 (`backend/scraping/facts/`) → phase 4 (`backend/scraping/sales_intelligence/`) → phase 5 (`analytics_backend/` marts + statistics). Step-by-step detail: [backend/README.md](backend/README.md).

### 6.1 Cross-channel fact table

`mention_facts` is the canonical cross-channel mention grain. It is fed by
**9 channels**, and every one of them is live as of 2026-08-24:

`reddit` · `reddit_comment` · `ig_comment` · `yt_comment` · `x` · `tiktok` ·
`tiktok_comment` · `x_influencer` · `product_review`

`product_review` reads `paddle_reviews`. There is deliberately **no news
channel** — see the note above.

---

## 7. Key KPIs surfaced

- **Share of voice (SoV) by brand** — recomputed from `displayAds` (filtered), never the static DB `share` field
- **Sentiment per brand × product** (positive / neutral / negative + net score)
- **Crisis count** (mentions flagged `is_crisis = true` by enrichment)
- **Purchase-intent count** (mentions classified as buyer-intent)
- **Competitor net defection score** (Reddit "switching from X to Y" deltas)
- **Topic lifecycle with first-channel detection** (TikTok / Reddit / IG / YT origin per topic)
- **In-stock / out-of-stock % by brand × SKU**
- **Review-count velocity** per public product page
- **Customer voice** — per-paddle retail review volume, average rating, sentiment split, top complaint category, and verified-purchase share (§7.1)

### 7.1 Customer Voice (shipped 2026-08-24)

`/v2/product-intel` carries a **Customer Voice** section reading `paddle_reviews`.

Requirements:
- A KPI strip: total reviews, average rating, sentiment split, crisis-flagged count
- A per-paddle expandable table: paddle, review count, average rating, sentiment split, top complaint category, verified-purchase share
- Because PostgREST caps any response at 1,000 rows regardless of `.limit()`,
  the reader **must** take an exact `count` first and page with `.range()`.
  A single unpaged select silently truncates 22,210 rows to 1,000 and every
  number on the section becomes wrong.

---

## 8. Ask Intel (AI Q&A layer)

`/v2/ask-intel` lets any user query the warehouse in plain English ("Which competitor is most discounted this week?", "Where is JOOLA losing customers?").

- Two-step OpenAI flow: planner → executor → answerer
- Structured query plans (not raw SQL) validated by `sqlSafety.ts`
- Column-alias autocorrect for LLM hallucinations
- Name → UUID resolution before query execution
- Exposes **36 schema entries** (tables plus derived metric definitions) via `frontend/lib/v2/askIntel/schema.ts`
- Feedback loop live: every answer logs to `ask_intel_qa_log`; thumbs up/down PATCHes the row; `/v2/ask-intel/feedback` reviews them
- Hardened to **0 hard errors on the 29-question test harness** (`scripts/test_ask_intel.py`); 23 success + 6 graceful clarifications

---

## 9. BI correlation use-cases (CFO-facing)

The platform is designed so each public signal becomes a **leading indicator** for an internal P&L variable. Implementations vary by section; the design intent is documented here.

| Public signal | Internal P&L variable | Lead-time |
|---|---|---|
| Athlete signing → mention spike + sentiment shift + SoV gain | Unit attach lift on that brand's hero paddle | 0–30 d |
| Competitor stockout (weekly snapshots) | Demand-transfer window to JOOLA | 7–14 d |
| Reddit "switching from X to Y" velocity | Competitor defection / JOOLA retail re-order spike | 4–8 wk |
| Promo + ad density per brand × mention velocity | Implied "cost per attributable mention" / ad ROI proxy | Real-time |
| Public review-count delta × 3–5% review-rate | Unit sales estimator for that competitor SKU | 30 d |
| Retail review sentiment + complaint category per paddle | Warranty / returns exposure per SKU | 30–60 d |
| Topic lifecycle first-channel (TikTok → Reddit → IG → YT) | Defensive inventory burn window before competitor demand peaks | 7–14 d |
| Negative-sentiment spike | Warranty-claim / return-rate forecast | 30–60 d |
| Athlete ER × follower × per-post brand-attribution | Optimal marketing-spend reallocation per quarter | Quarterly |

**Futuristic plays on the same dataset** (no new sources required):
- Athlete-signing simulator, pre-crisis detector, topic-lifecycle forecaster, demand-transfer matrix, athlete defection risk, ad-creative fatigue detector, dynamic pricing engine, influencer yield optimizer, M&A target scoring, counter-launch war room, comment-to-Reel generator, RL promo calendar, weekly CFO co-pilot.

---

## 10. Dashboard UX standards

These are **product rules**, not suggestions. New sections must comply.

1. **Layman tooltips everywhere.** Every KPI box, section heading, and table
   column header must carry a 1–3 sentence layman-language tooltip explaining
   (a) what it shows, (b) the source, (c) the formula if computed, (d) how
   comparisons work. Owners: `MiniKpi.tip` prop, `SectionInfo` component,
   `SortTh.title`.
   **Wording rules:** no schema words in user-facing text — no table names,
   column names, or migration numbers. Say what a high or low value *implies*.
   Shared column labels resolve through the glossary in
   `frontend/lib/v2/tooltips.ts` (`tipFor(label)`) so a term defined once reads
   the same on every page; only section headings, which are page-specific, are
   written inline.
2. **No duplicate KPI rows.** The compact `SummaryItem` strip is canonical. Redundant `MiniKpi` grids that repeat the same numbers are forbidden.
3. **No top-level filter bars.** Global page-level filter bars (Range / From / To / Channel / Sentiment / Crisis style) are removed from `community-intel`, `campaign-offer-intel`, and `influencers`. State is retained for future selective re-introduction; UI gone. Per-table `ColumnFilter` rows and brand-search inside table headers stay. The sidebar-hosted brand filter and date-range control are *shell* controls, not page filter bars, and are permitted.
4. **Charts must be interactive on hover.** All scatter / matrix / quadrant charts must show floating React-state tooltips with full datapoint detail. SVG `<title>` alone is insufficient. Required for: Community Trend chart, Ads vs Promotions Matrix, Player Impact Map, Campaign Strategy Matrix.
5. **Quadrant charts must look like quadrant charts.** 4 visible quadrants split by the **median** of plotted values, tinted backgrounds, corner labels with counts + 1-line explanations, in-tooltip quadrant indicator on hover.
6. **Contrast rules.** Search-box text is pure white (`color: #ffffff !important`). Table "open →" links use brand-yellow (`#F5E625`) so they're visible on the dark canvas.
7. **JOOLA highlighting.** JOOLA is always rendered in `#22c55e` green; accent / call-out yellow is `#F5E625`. JOOLA rows in tables get a 3 px green left border.
8. **Brand display names.** Brand labels render through `pgName(slug, brands)`
   from `PageShell.tsx`, which applies the `BRAND_DISPLAY_OVERRIDES` map
   (Franklin → Franklin Pickleball). Data-layer helpers that build a
   `brandName` field from raw `brands.name` bypass this and must not be
   rendered directly.
9. **Sidebar / navigation.** The sidebar has a fixed **Home** entry plus two
   groups:
   - *Analytics* — Ask Intel, Community Intel, Influencer Intel, Campaign &
     Offer Intel, Product Intel, Sales Intel, Market Intel, Correlations,
     Changepoints, Data Health
   - *Social Media* — Instagram, YouTube, Reddit & Community, X / Twitter,
     TikTok

   `/v2` redirects to `/v2/overview`, and **Executive Overview is the home
   page** — it was retired in May 2026 and subsequently reinstated. Data Health
   (`/v2/data-health`) probes **17 tables** for staleness. A command palette
   (Cmd-K), keyboard shortcuts, recent-pages list, bookmarks, density toggle,
   and light/dark theme toggle are shell features available on every page.

### 10.10 Legacy routes (unlinked, still deployed)

Seven top-level routes ship in the build and are covered by the QA suites but
are reachable from **no** sidebar entry and no command-palette entry:

`/v2/ads` · `/v2/comments` · `/v2/crisis` · `/v2/leaderboard` ·
`/v2/products` · `/v2/products-intel` · `/v2/promotions`

Each was superseded by a consolidated "Intel" page — `campaign-offer-intel`
replaced ads + promotions, `community-intel` replaced comments,
`product-intel` replaced products + products-intel + leaderboard. They remain
in `constants/routes.ts`, `qa/regression.ps1`, `qa/tooltip-check.mjs`, and
`e2e/smoke.spec.ts`.

**Product decision required:** keep them as deep-link-only legacy surfaces (in
which case they stay in scope and must keep meeting §10) or delete them and
their QA entries. Until decided they are in scope and maintained. Tracked in
[TODO.md](TODO.md).

---

## 11. Architecture (product-level constraints only)

Full topology, file map, and data flow: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Deploy mechanics and env vars: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

The constraints that are **product** decisions, not implementation details:

- **Three independent deployment units** since 2026-05-24 — `frontend/` (Vercel),
  `backend/` (scrape → enrich → facts), `analytics_backend/` (marts + statistics).
  They share one Supabase database and can be released separately.
- **The dashboard is read-only.** It reads Supabase directly via the anon key.
  Only the Python units hold the service-role key, and only they write.
- **The Python pipeline never ships with the frontend build.** A data refresh
  requires no redeploy; a code change requires no re-scrape.
- **OpenAI is never given write access and never executes SQL.**
- **A write that lands nothing is a hard error.** The Supabase client asserts
  that a non-empty batch wrote at least one row, and degrades gracefully on a
  column the live DB lacks (read *and* write side) rather than losing the
  batch. Silent zero-row writes hid two dead marts for three months; this
  assertion is the control that prevents a repeat.

---

## 12. Security & data-governance rules

- **Read-only by design.** Dashboard never modifies data apart from the declared Ask Intel telemetry write (§4). Ask Intel's planner produces structured plans, never raw SQL; validator rejects mutations, multi-statements, comments, and system-catalog access.
- **No secrets in client bundle.** `OPENAI_API_KEY` must be server-only.
- **Row-Level Security policies pending** on Supabase tables (anon role should be SELECT-only across the board).
- **Three keys to rotate before prod hardening** (exposed during POC bootstrap): Supabase service-role key, Apify token, OpenAI key.

### 12.1 Open findings — audit 2026-08-24

These are **requirements**, not suggestions. All three are currently unmet.

1. **`NEXT_PUBLIC_OPENAI_KEY` is still in use, and in two places is preferred
   over the server key.** `content-brief/agent.ts` and
   `keyword-research/agent.ts` resolve
   `NEXT_PUBLIC_OPENAI_KEY ?? OPENAI_API_KEY` — the public name wins.
   `generate-content/route.ts` reads the public name only. Ask Intel prefers
   the server key and falls back with a warning, which is the correct shape.
   *Requirement:* every OpenAI key read resolves `OPENAI_API_KEY` first, and
   the `NEXT_PUBLIC_` name is removed from Vercel once nothing reads it. A
   `NEXT_PUBLIC_`-prefixed value is inlined into any client bundle that
   references it, so the name itself is the hazard.
2. **`POST /api/seo-analyzer` is an unauthenticated server-side fetch of an
   arbitrary user-supplied URL.** The only validation is that the protocol is
   http or https — no host allowlist, no private-address or loopback block, no
   redirect ceiling. Deployed on Vercel this is a server-side request forgery
   surface reachable by anyone who knows the path.
   *Requirement:* an allowlist (or at minimum a private-range and
   metadata-endpoint block plus a redirect cap) before this route stays in
   production — or delete the route per §4.1.
3. **The application has no authentication.** There is no `middleware.ts` and
   no session check on any page or API route. Every dashboard page and every
   API route on the public Vercel URL is open to anyone with the link.
   *Requirement:* an access-control decision before this is presented as a
   board/CFO BI surface. "Unlisted URL" is not access control.

---

## 13. Pending POC → prod hardening

Production-readiness commitments only. Engineering tasks and data blockers live
in [TODO.md](TODO.md) — do not duplicate them here.

- [ ] Rotate Supabase service-role key (was exposed when GitHub blocked initial push)
- [ ] Rotate Apify token (same exposure window)
- [ ] Rotate OpenAI key (was shared in a chat transcript 2026-05-15)
- [ ] Make `OPENAI_API_KEY` the only key name read anywhere (§12.1 #1) and add it to Vercel env vars
- [ ] Gate or delete `POST /api/seo-analyzer` (§12.1 #2)
- [ ] Decide and implement an access-control posture (§12.1 #3)
- [ ] Enable Supabase Row-Level Security policies on all tables (anon role = SELECT only)
- [ ] Set up GitHub Actions cron for the weekly Python pipeline (currently manual on laptop)
- [ ] Resolve the §4.1 scope question on the SEO / content-generation surface
- [ ] Resolve the §10.10 scope question on the seven unlinked legacy routes

---

## 14. Definitions of Done

A feature is considered shipped when:
1. Code typechecks (`npm run type-check`, or `bunx tsc --noEmit` on the build host where Node is broken)
2. Every new KPI / section / table header carries a layman tooltip per §10.1, sourced from the shared glossary where the label is not page-specific
3. The tooltip regression stage passes — `frontend/qa/regression.ps1` step 5 asserts computed *visibility* of a real tooltip on every route, not just its presence in the DOM
4. Every new chart with multiple data points has a floating hover tooltip per §10.4
5. No duplicate KPI rows added per §10.2
6. No top-level filter bars re-introduced per §10.3
7. JOOLA highlighting (§10.7), brand display names (§10.8), and contrast rules (§10.6) preserved
8. Any new Supabase reader that can exceed 1,000 rows pages with `.range()` per §7.1
9. Committed to `main` → Vercel auto-deploy verified
10. If touching Ask Intel: `scripts/test_ask_intel.py` retains 0 hard errors on the 29-question harness

---

## 15. Glossary

- **SoV** — Share of voice. The % of total category conversation about a given brand in a window.
- **ER** — Engagement rate. (likes + comments + shares) ÷ followers × 100 per post, averaged. Always computed with a `followers >= 50` floor; scraping artifacts with 1 follower otherwise produce ~69,000% ER.
- **Crisis signal** — mention_facts row where `is_crisis = true`. Much higher bar than "negative sentiment" — requires recall, safety issue, coordinated backlash, scandal.
- **Defection** — A Reddit user post or comment indicating they switched paddles from brand X to brand Y.
- **Mention_facts** — Cross-channel enriched fact table; one row per resolved mention with brand_id, athlete_id, product_id, sentiment, is_crisis, etc. 9 source channels (§6.1).
- **Topic lifecycle** — Time series of topic appearance across channels, with first-channel detection.
- **Customer voice** — Retail review signal from `paddle_reviews`: volume, rating, sentiment split, complaint category, verified share (§7.1).

---

## 16. References

- Codebase: `c:\Workspace\joola-intel-nextjs`
- Repo map + quickstart: [README.md](README.md)
- Coding rules for AI agents: [CLAUDE.md](CLAUDE.md)
- Open work: [TODO.md](TODO.md)
- Architecture + file map: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Docs index + disaster-recovery reading order: [docs/README.md](docs/README.md)
- Database schema inventory: [docs/DATABASE.md](docs/DATABASE.md)
- Ask Intel test harness: `scripts/test_ask_intel.py`

---

## 17. Audit log — 2026-08-24

Full-repo audit of code against this document. Method: enumerate every route,
API handler, pipeline module, fact channel, and invariant in the working tree
and compare against the spec. Typecheck was clean at audit time.

### Corrected — the spec was wrong, the code was right

| § | Was | Now |
|---|---|---|
| 10.9 | "Home (`/v2`) redirects to `/v2/ask-intel`. Executive Overview is retired." | `/v2` redirects to `/v2/overview`; Executive Overview **is** the home page and the sidebar's Home link. The stale claim was also repeated in the redirect file's own comment and in `docs/ARCHITECTURE.md`. |
| 5 | Athletes: 27 | 42 distinct across 45 roster rows |
| 6 | 10 sources listed | 13 — News, SEO, and per-product review widgets were undocumented |
| 4 | "No data modification path" | Ask Intel telemetry write declared as the one exception |
| 8 | — | Feedback loop and schema size documented |
| 10.8 | Rule stated as `displayBrandName(slug, fallback)` | Restated as `pgName(slug, brands)`, which is the function pages actually call |

### Newly specified — shipped code that had no requirement

- §7.1 Customer Voice section and its 1,000-row paging rule
- §6.1 the 9 `mention_facts` channels, all live
- §10.1 tooltip glossary + wording rules
- §11 the write-nothing assertion as a product-level control
- §14 the tooltip-visibility regression gate and the `.range()` paging gate

### Raised — open decisions, not defects

- §4.1 SEO / content-generation surface: four orphaned generative API routes plus an unread `seo` pipeline module
- §10.10 seven unlinked legacy routes
- §6 `news_articles` and the SEO tables reach no user surface

### Raised — security requirements now unmet

- §12.1 #1 `NEXT_PUBLIC_OPENAI_KEY` preferred over the server key in two agents
- §12.1 #2 SSRF surface on `POST /api/seo-analyzer`
- §12.1 #3 no authentication anywhere in the app

### Verified as compliant — no change needed

Share-of-voice recomputation under brand filter; the `isFiltered` contract;
the `followers >= 50` ER floor; no `[...new Set()]` spread anywhere; §10.2
(no duplicate KPI rows); §10.3 (no page-level filter bars); §10.4 (27 files
carry React-state hover handlers); §10.5 (quadrants split on median); §10.1
tooltip coverage — 202 `SectionInfo`, 803 titled headers, 68 KPI tips against a
236-entry glossary.
