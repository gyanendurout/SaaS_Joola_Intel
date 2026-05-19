# JOOLA Intel — Disaster Recovery & Rebuild Master Index

> **Purpose of this directory.** If the deployed app and/or laptop are lost, a future engineer (or AI agent) should be able to read the files in this directory **in order** and rebuild JOOLA Intel end-to-end — database, scraping pipeline, AI enrichment, dashboard, and deployment — without further institutional knowledge.

**Snapshot date:** 2026-05-19
**Repo at time of snapshot:** `c:\Workspace\joola-intel-nextjs` (GitHub: `gyanendurout/SaaS_Joola_Intel`)
**Live URL at time of snapshot:** https://saas-joola-intel.vercel.app

---

## How to read this packet

Read each file fully before starting recovery. Do not skip ahead — later docs assume earlier ones are done.

| # | File | Read when… |
|---|---|---|
| 0 | `README.md` (this file) | First. Tells you what's in here and the order. |
| 1 | `01_BUSINESS_REQUIREMENTS.md` | You need to know **what** the product is and **why** it exists before rebuilding it. |
| 2 | `02_DATABASE_RECOVERY.md` | First rebuild step. Create the Supabase project and run migrations 001 → 009 in order. |
| 3 | `03_SCRAPING_PIPELINE.md` | Once DB exists, configure Apify and run the Python pipeline to populate it. |
| 4 | `04_AI_ENRICHMENT.md` | After raw data lands, run GPT-4o-mini enrichment + fact-table populators. |
| 5 | `05_FRONTEND_REBUILD.md` | Stand up the Next.js 14 dashboard locally; verify it reads from Supabase. |
| 6 | `06_DESIGN_SYSTEM.md` | Reference for visual/UX conventions if any UI work is needed. |
| 7 | `07_DEPLOYMENT.md` | Push to GitHub → Vercel. Configure environment variables. |
| 8 | `08_RUNBOOK.md` | Day-to-day operations: weekly cadence, troubleshooting, on-call playbook. |
| 9 | `INVENTORY.md` | Cross-reference of every directory/file in the repo and what each does. |

---

## Ordered recovery playbook (the TL;DR)

1. **Read `01_BUSINESS_REQUIREMENTS.md`** — understand product scope, the 11 tracked brands, 27 athletes, and the weekly cadence.
2. **Create a new Supabase project.** Note the URL and service-role key.
3. **Apply migrations** in numeric order: `migrations/001_particl_features.sql` → `migrations/009_reddit_comments.sql`. (See `02_DATABASE_RECOVERY.md` for the exact order — there are two migration `002_*` files; both must run. Skip `*_rollback.sql` files unless intentionally reverting.)
4. **Seed lookup tables** (brands, influencers, products_catalog, x_accounts, tiktok_accounts) — most seeds are embedded inside the migrations themselves; verify counts (11 brands, 27 influencers, 25 paddles in `products_catalog`).
5. **Set up Apify account** and obtain a token with enough credit (~$5–$20/run depending on actor budgets).
6. **Create `scripts/.env`** with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APIFY_TOKEN`, `OPENAI_API_KEY`. See `03_SCRAPING_PIPELINE.md`.
7. **Run the scraper:** `python scripts/apify_to_supabase.py`. This invokes 10 Apify actors across 13 pipeline steps and writes raw rows.
8. **Run AI enrichment:** `python scripts/enrich_with_ai.py` → `python scripts/populate_mention_facts.py` → `python scripts/populate_topic_lifecycle.py`. See `04_AI_ENRICHMENT.md`.
9. **Stand up the dashboard:** `npm install && npm run dev`. See `05_FRONTEND_REBUILD.md`. Connect to Supabase via anon key.
10. **Push to GitHub, deploy on Vercel.** See `07_DEPLOYMENT.md`.
11. **Adopt the weekly cadence** in `08_RUNBOOK.md`.

---

## Critical contacts & accounts

| What | Where / who | Notes |
|---|---|---|
| Domain & hosting | Vercel project `saas-joola-intel` | Connected to GitHub repo |
| Database | Supabase project `loecyghnkkxyymelgexz` | Managed Postgres, free tier OK for POC |
| Scraping vendor | Apify (apify.com) | All 10 actors used are public actors |
| LLM vendor | OpenAI (gpt-4o-mini) | ~$0.50–$2 per full enrichment run |
| GitHub | `gyanendurout/SaaS_Joola_Intel` | Default branch `main`, push triggers Vercel build |
| Product owner | api@joola.com | TODO: verify with team |

---

## What lives **outside** this packet

- **Live data** in Supabase — not snapshotted here. If the DB is intact, you skip steps 2-4 above and go straight to step 9.
- **Apify dataset history** — kept on Apify for 30 days then garbage-collected. Re-runs always start fresh.
- **OpenAI usage history** — for cost auditing, log into the OpenAI dashboard.
- **Source-of-truth schema** lives in `migrations/*.sql`. Never edit these to recover; treat them as immutable history.

---

## Safety rules when using this packet

1. **Never modify `scripts/` or `migrations/`** — they are versioned source of truth. The only docs you should touch are under `backup/`.
2. **Do not commit secrets.** `scripts/.env` is gitignored; replicate it locally with real values, never push.
3. **Rotate exposed keys** before going to production. See `07_DEPLOYMENT.md` § "Pending hardening".
4. **Migrations are append-only.** Need to change schema? Add `010_*.sql`, never edit older files.

---

## File index

- `01_BUSINESS_REQUIREMENTS.md` — what + why + KPIs
- `02_DATABASE_RECOVERY.md` — Supabase + migration order
- `03_SCRAPING_PIPELINE.md` — Apify actors, env, costs
- `04_AI_ENRICHMENT.md` — GPT-4o-mini + fact tables
- `05_FRONTEND_REBUILD.md` — Next.js 14 dashboard
- `06_DESIGN_SYSTEM.md` — colors, components, hover rules
- `07_DEPLOYMENT.md` — Vercel + env vars
- `08_RUNBOOK.md` — weekly ops + troubleshooting
- `INVENTORY.md` — full file/dir listing
