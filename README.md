# JOOLA Intel

Pickleball competitive intelligence platform. Tracks 11 brands across all
social channels, ad libraries, product catalogs, and athlete networks; ships
a Next.js dashboard backed by Supabase.

## Layout

```
joola-intel-nextjs/
├── frontend/            # Next.js 14 dashboard (deploys to Vercel)
├── backend/             # Python scraping pipeline (runs locally / cron)
│   └── scraping/        # All 9 scrape channels + AI enrichment + facts
├── analytics_backend/   # Python statistical pipeline (lag scans, Granger,
│                        # changepoints) — runs after scraping
├── scripts/             # Cross-cutting utilities (deploy, weekly run,
│                        # one-off migrations)
├── migrations/          # SQL migrations (shared by backend + analytics)
├── docs/                # Architecture, runbooks, recovery docs
├── .env                 # Shared Python env (gitignored)
├── .env.example         # Template for new clones
└── CLAUDE.md            # Claude Code session memory
```

Three independent deployment units:

| Unit | Purpose | Deploy target |
|---|---|---|
| `frontend/` | Next.js dashboard | Vercel (auto on push to `main`) |
| `backend/` | Scrape + enrich + fact-derive | Local cron / Railway / GH Actions |
| `analytics_backend/` | Refresh marts + run stats | Same host as backend |

## Quick start

### Frontend
```bash
cd frontend
npm install
cp .env.example .env.local   # then fill in NEXT_PUBLIC_SUPABASE_*
npm run dev                   # http://localhost:3000
```

### Backend (scraping pipeline)
```bash
python -m pip install -r backend/requirements.txt
cp .env.example .env          # fill in SUPABASE_SERVICE_ROLE_KEY, APIFY_TOKEN, OPENAI_API_KEY
python -m backend.scraping.run --module all                  # full weekly run
python -m backend.scraping.run --module enrichment           # just AI enrichment
python -m backend.scraping.run --module instagram --brands joola,selkirk
```

### Analytics backend
```bash
python -m pip install -r analytics_backend/requirements.txt
python -m analytics_backend.run                              # marts + stats
```

### One-shot weekly pipeline (scraping → analytics)
```bash
python scripts/weekly_run.py
```

## Deployment

```bash
# Frontend (Vercel auto-deploys on push to main)
git push origin main

# Frontend qa-gated deploy from CLI
cd frontend && npm run deploy -- -Message "fix: …"
```

Vercel project setting required after the 2026-05-24 reorg:
**Settings → General → Root Directory → `frontend/`**.

## Key docs

| Doc | Read it when |
|---|---|
| [docs/BUSINESS_REQUIREMENTS.md](docs/BUSINESS_REQUIREMENTS.md) | New to JOOLA Intel — start here |
| [docs/CODE_ARCHITECTURE.md](docs/CODE_ARCHITECTURE.md) | Mapping a feature end-to-end |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Shipping or hardening prod |
| [docs/SCRAPING_PIPELINE.md](docs/SCRAPING_PIPELINE.md) | Adding / debugging a scraper |
| [docs/AI_ENRICHMENT.md](docs/AI_ENRICHMENT.md) | Tuning sentiment / crisis / NER |
| [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | Building a new dashboard page |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Pipeline broke at 2 AM |
| [docs/DATABASE_RECOVERY.md](docs/DATABASE_RECOVERY.md) | Schema rebuild from migrations |
| [docs/RECOVERY_INDEX.md](docs/RECOVERY_INDEX.md) | Index of all recovery docs |
| [CLAUDE.md](CLAUDE.md) | Per-session memory for Claude Code |

## Live URLs

- **Production**: https://saas-joola-intel.vercel.app
- **GitHub**: https://github.com/gyanendurout/SaaS_Joola_Intel
- **Supabase**: project `loecyghnkkxyymelgexz`

## Husky pre-push (fresh clones)

After cloning, one-time setup so the pre-push regression hook runs:

```bash
git config core.hooksPath .husky
```

The hook lives at `.husky/pre-push` and invokes `frontend/qa/regression.ps1`.
