# 07 — Deployment

> **Goal.** Deploy the Next.js dashboard to Vercel with Supabase as the DB. Cover env vars, secrets, the auto-deploy loop, and the POC → prod hardening list.

---

## Topology

```
Local laptop                    Supabase                    Vercel
┌──────────────────┐           ┌──────────┐               ┌──────────────────┐
│ python scripts/  │  writes   │ Postgres │   reads       │ Next.js dashboard│
│ run_resumable.py │ ────────► │  tables  │ ────────────► │ (anon key)       │
│ (service_role)   │           │          │               │                  │
└──────────────────┘           └──────────┘               └──────────────────┘
                                   ▲                              ▲
                                   │                              │
                              also writes from                push to main →
                              api/generate-content           Vercel rebuild
```

- **One Next.js app**, deployed to Vercel via GitHub integration.
- **Auto-deploy** on every push to `main`. Build ~90 s.
- **No redeploy required for data changes** — Python pipeline writes to Supabase; the live dashboard re-reads on next page load.

---

## Initial Vercel setup

1. Push the repo to GitHub.
2. Log in to https://vercel.com, **Add New** → **Project** → import the repo.
3. Framework preset: Vercel auto-detects **Next.js**. Leave defaults.
4. **Environment variables** (set for Production **and** Preview):

   | Name | Value source | Notes |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase Settings → API | Browser-safe |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Settings → API → `anon` | Browser-safe |
   | `NEXT_PUBLIC_OPENAI_KEY` | OpenAI dashboard | **POC only — leaks to browser bundle.** Rename to `OPENAI_API_KEY` before prod. |

   Vercel's "paste .env contents" import works for all three at once.

5. Click **Deploy**. After ~90 s, visit the generated `.vercel.app` URL.
6. Verify `https://<your-app>.vercel.app/v2/reddit` renders data.

---

## Required env vars summary

### Vercel (Production + Preview)

| Variable | Where used | Sensitive? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/shared/supabase.ts` | No (URL only) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/shared/supabase.ts` | No (anon-scoped, RLS-protected) |
| `NEXT_PUBLIC_OPENAI_KEY` | `app/api/generate-content/route.ts` | **YES — currently leaks**. Rotate after rename. |

### Local `.env.local` at repo root (frontend dev)

Same three `NEXT_PUBLIC_*` vars. Gitignored.

### Local `scripts/.env` (Python pipeline)

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
APIFY_TOKEN=apify_api_...
OPENAI_API_KEY=sk-...
```

Never in Vercel. Never committed.

---

## Deploy a code change

```bash
git add .
git commit -m "your message"
git push origin main
# Vercel detects push, rebuilds, redeploys in ~90 s
```

Watch the build in the Vercel dashboard. If TypeScript fails (`tsc --noEmit`), the build fails — fix locally with `npm run type-check` before pushing.

---

## Deploy a data refresh

No deploy needed. Just run the pipeline:

```bash
cd c:\Workspace\joola-intel-nextjs
python scripts/run_resumable.py            # or: python scripts/apify_to_supabase.py
python scripts/enrich_with_ai.py
python scripts/populate_mention_facts.py
python scripts/populate_topic_lifecycle.py
```

Refresh the live URL — new data appears.

---

## Pending POC → prod hardening (TODO)

Already listed in CLAUDE.md but **must be done before declaring production**:

- [ ] **Rotate Supabase `service_role` key.** It was exposed when GitHub blocked the first push containing it in 4 Python files + 1 markdown doc.
- [ ] **Rotate Apify token.** Same exposure event.
- [ ] **Rotate OpenAI key.** It was shared in chat transcripts on 2026-05-15.
- [ ] **Rename `NEXT_PUBLIC_OPENAI_KEY` → `OPENAI_API_KEY` (server-only).** Currently shipped to the browser bundle via the `NEXT_PUBLIC_` prefix. Fix in `app/api/generate-content/route.ts`.
- [ ] **Enable RLS on every Supabase table.** Anon role gets `SELECT` only; everything else is `service_role` only. See `02_DATABASE_RECOVERY.md` step 4.
- [ ] **`scripts/requirements.txt`** — pip freeze for Python reproducibility (currently scripts assume `requests`, `python-dotenv` are installed manually).
- [ ] **GitHub Actions cron** for the Monday-morning pipeline run (currently runs on a laptop, brittle).
- [ ] **Custom domain** — currently on default `*.vercel.app`. Add a real DNS name + TLS.
- [ ] **Vercel team plan** if SLA matters (currently free / hobby tier — implies build/run quotas).
- [ ] **Backup strategy** — Supabase free tier has daily backups for 7 days. For longer retention, upgrade or set up `pg_dump` to S3.
- [ ] **Audit log** — currently no record of who triggered each pipeline run.

---

## Build configuration files

| File | What it sets |
|---|---|
| `next.config.js` | Next.js options |
| `tsconfig.json` | TypeScript options (strict where reasonable) |
| `tailwind.config.ts` | Tailwind paths — only relevant to non-v2 pages |
| `postcss.config.js` | PostCSS pipeline for Tailwind |
| `package.json` | Deps + `dev/build/start/lint/type-check/validate` scripts |

`vercel.json` is **absent** — Vercel uses defaults. Add one only if you need to override build commands or cron jobs.

---

## Deploy from scratch (full disaster recovery)

If both GitHub and Vercel are intact:

1. Reconnect the Vercel project to the GitHub repo if needed.
2. Re-add the 3 env vars.
3. Trigger a deploy from the Vercel dashboard.
4. Verify with `/v2/reddit`.

If GitHub is lost:

1. Initialize a new repo locally.
2. **Critically**, do this **first**: extend `.gitignore` with `.env*`, `.claude/`, `__pycache__/`, `*.pyc`, `.venv/`. Otherwise the first push will leak secrets and GitHub's secret scanner will block it.
3. `git push -u origin main`.
4. Import to Vercel, set env vars.

If Supabase is lost: see `02_DATABASE_RECOVERY.md`.

---

## Cost ballpark (POC tier)

| Service | Tier | Cost / month |
|---|---|---|
| Vercel | Hobby | $0 |
| Supabase | Free | $0 (caps: 500 MB DB, 1 GB egress) |
| Apify | Pay-as-you-go | $20–$80/mo at weekly cadence |
| OpenAI | Pay-as-you-go | $2–$10/mo (gpt-4o-mini) |

Total: **~$25–$100/month** at current scale. The dominant cost is Apify; if it gets expensive, look at Reddit and Meta Ads first (the heaviest actors).
