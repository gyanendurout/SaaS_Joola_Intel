# JOOLA Intel

Pickleball competitive intelligence platform. Tracks 11 paddle brands across
every public social channel, ad library, product catalog, and athlete network;
ships a Next.js dashboard backed by Supabase, with an AI Q&A layer over the
warehouse.

- **Production**: https://saas-joola-intel.vercel.app
- **GitHub**: https://github.com/gyanendurout/SaaS_Joola_Intel
- **Supabase**: project `loecyghnkkxyymelgexz`

## Layout

```
joola-intel-nextjs/
├── frontend/            Next.js 14 dashboard (deploys to Vercel)
├── backend/             Python scraping pipeline
│   └── scraping/        9 scrape channels + enrichment + facts + sales-intel
├── analytics_backend/   Python statistical pipeline (marts, lag scans,
│                        Granger, changepoints) — runs after scraping
├── scripts/             Cross-cutting utilities (weekly_run, deploy, db_verify)
├── migrations/          SQL migrations, shared by both Python units
├── docs/                Architecture, runbooks, schema, recovery
├── DATA/                Particl reference exports (research inputs, not code)
├── .env                 Shared Python env (gitignored)
└── .env.example         Template for new clones
```

Three independent deployment units:

| Unit | Purpose | Deploy target |
|---|---|---|
| `frontend/` | Next.js dashboard | Vercel (auto on push to `main`) |
| `backend/` | Scrape → enrich → derive facts | Local cron / GitHub Actions |
| `analytics_backend/` | Refresh marts + run statistics | Same host as backend |

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
cp .env.example .env          # SUPABASE_SERVICE_ROLE_KEY, APIFY_TOKEN, OPENAI_API_KEY
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
# Frontend — Vercel auto-deploys on push to main
git push origin main

# Frontend — QA-gated deploy from the CLI
cd frontend && npm run deploy -- -Message "fix: …"
```

Vercel project setting required since the 2026-05-24 split:
**Settings → General → Root Directory → `frontend/`**.

After cloning, enable the pre-push regression hook once:
```bash
git config core.hooksPath .husky
```

## Documentation — one owner per topic

Each topic has exactly **one** authoritative file. Update that file, not a copy.

| Topic | Owner | Read it when |
|---|---|---|
| Product, users, scope, KPIs, UX product rules | [BRD.md](BRD.md) | New to JOOLA Intel — start here |
| Coding rules, invariants, gotchas for AI agents | [CLAUDE.md](CLAUDE.md) | Before writing any code |
| Open work / blockers | [TODO.md](TODO.md) | Picking up the next task |
| System topology, file map, data flow | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Mapping a feature end-to-end |
| Running / debugging / extending the scrapers | [backend/README.md](backend/README.md) | Adding or fixing a scraper |
| Marts + statistical jobs | [analytics_backend/README.md](analytics_backend/README.md) | Working on correlations, changepoints |
| Deploy topology, env vars, CI | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Shipping or hardening prod |
| Weekly ops + incident troubleshooting | [docs/RUNBOOK.md](docs/RUNBOOK.md) | The pipeline broke at 2 AM |
| Table-by-table schema, writers, readers | [docs/DATABASE.md](docs/DATABASE.md) | Writing a query or a migration |
| Rebuilding the DB from migrations | [docs/DATABASE_RECOVERY.md](docs/DATABASE_RECOVERY.md) | Schema rebuild from zero |
| Rebuilding the dashboard from zero | [docs/FRONTEND_REBUILD.md](docs/FRONTEND_REBUILD.md) | Disaster recovery |
| Palette, components, chart contracts | [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | Building a new dashboard page |
| Historical session logs | [docs/CHANGELOG.md](docs/CHANGELOG.md) | Archaeology only |

[docs/README.md](docs/README.md) indexes `docs/` and gives the disaster-recovery
reading order.
