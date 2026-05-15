# Where we left off — JOOLA Intel

**Last update:** 2026-05-15 — end of session before account switch.

## TL;DR

Everything is on disk. Open this folder and run:
```
npm run dev        # http://localhost:3000  (v1 default, click "Executive" for v2)
python count_rows.py   # verify Supabase still has the data
```

## Current DB snapshot

| Table | Rows |
|---|---:|
| brands | 11 |
| ig_accounts | 11 |
| ig_profiles_weekly | 42 |
| ig_posts | 250 |
| ig_comments | 1,896 |
| yt_channels | 11 |
| yt_channel_weekly | 13 |
| yt_videos | 391 |
| yt_comments | 1,078 |
| reddit_mentions | 362 |
| products | 238 |
| product_price_history | 0 |
| influencers | 27 |
| influencer_posts | 198 |
| influencer_snapshots | 54 |
| promotions | 27 |
| marketing_ads | 735 |
| **Total** | **~5,498** |

## What's done

- ✅ **Pipeline** — all 10 Apify → Supabase steps working. Resumable via [run_resumable.py](run_resumable.py) with checkpoint in [pipeline_state.json](pipeline_state.json)
- ✅ **v1 UI** — 10 pages (Overview, Instagram, YouTube, Reddit, Comments, Influencers, Ads, Promotions, Products, Market) — all wired to real Supabase data
- ✅ **v2 UI Phase 1** — Executive Overview page only, with 11 sections (Briefing / Pulse / Movers / Engagement matrix / Ads / Promos / Community / Influencers / Catalog / Opportunities) all wired to real data
- ✅ **Toggle** — top-right "Classic ↔ Executive" persists in localStorage
- ✅ **Refactor** — code organised into `(v1)/`, `v2/`, `shared/` folders

## What's next (Phase 2 of v2)

The 9 other v2 pages are stubs (404). Source mock-data versions are in [design/pages.jsx](design/pages.jsx). Port each using [lib/v2/data.ts](lib/v2/data.ts):

- [ ] `/v2/instagram`
- [ ] `/v2/youtube`
- [ ] `/v2/reddit`
- [ ] `/v2/comments`
- [ ] `/v2/influencers`
- [ ] `/v2/ads`
- [ ] `/v2/promotions`
- [ ] `/v2/products`
- [ ] `/v2/market`

## Credentials (also in [.env.local](.env.local) and [apify_to_supabase.py](apify_to_supabase.py))

| Service | Value |
|---|---|
| Apify token | (set `APIFY_TOKEN` in `scripts/.env` — gitignored) |
| Supabase URL | (set `SUPABASE_URL` in `scripts/.env` and `NEXT_PUBLIC_SUPABASE_URL` in `.env.local`) |
| Supabase service key | (set `SUPABASE_SERVICE_ROLE_KEY` in `scripts/.env` — gitignored) |

**If you switch accounts**, replace these in both [apify_to_supabase.py](apify_to_supabase.py) (lines 45-49) and [.env.local](.env.local) (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).

## Key files to know

| File | Purpose |
|---|---|
| [apify_to_supabase.py](apify_to_supabase.py) | The 10-step scraper. All actor IDs + Supabase upserts. |
| [run_resumable.py](run_resumable.py) | Resumable driver. Writes per-step state to `pipeline_state.json`. |
| [count_rows.py](count_rows.py) | Diagnostic — row counts across all tables. |
| [pipeline_state.json](pipeline_state.json) | Checkpoint — all steps `done` after last run. |
| [CHANGELOG.md](CHANGELOG.md) | Full session log of every change made. |
| [migrations/001_particl_features.sql](migrations/001_particl_features.sql) | Schema for `marketing_ads`, `promotions`, `product_price_history` |
| [design/](design/) | Untouched original design HTML/JSX — reference for porting v2 pages |
| [DB_README.md](DB_README.md) | Supabase schema documentation |
| [REQUIREMENTS_PARTICL.md](REQUIREMENTS_PARTICL.md) | Original requirements brief |

## Caveats

- **Product scraper returns 0** on most runs — pre-existing issue. The 238 products in DB are from a 2026-04-03 seed.
- **WoW deltas mostly null** — `*_weekly` tables only have current snapshots. Need a second weekly run to compute real week-over-week.
- **ProKennex** is in the design brand list (11 brands) but not in Supabase `brands` table (10 competitors + JOOLA). v2 just shows what's in the DB.
- **Some IG profile snapshots** got "dedup constraint absent" → plain insert. Means duplicates can accumulate if you re-run within the same ISO week without adding a unique index.
- **`apify/facebook-ads-scraper`** is rate-limited / sometimes returns fewer than 50 ads per page. Last run got 157 Meta ads total.

## How to run things

```bash
# === Frontend ===
npm run dev                        # http://localhost:3000
                                   # → v1 at /, v2 at /v2

# === Pipeline ===
python run_resumable.py            # resume from checkpoint
python run_resumable.py --restart  # fresh full scrape (all 10 steps)

# === Diagnostics ===
python count_rows.py               # row counts across 17 tables
tail -f resumable_run.log          # watch live pipeline output
cat pipeline_state.json | python -m json.tool   # inspect checkpoint state
```

## Folder layout (high level)

```
joola-intel-nextjs/
├── app/
│   ├── (v1)/              ← v1 pages (route group, URLs unchanged)
│   ├── v2/                ← v2 pages (under /v2)
│   ├── api/               ← shared API routes
│   ├── layout.tsx
│   ├── globals.css        ← v1 styles
│   └── v2.css             ← v2 styles (scoped under .v2-root)
├── components/
│   ├── shared/            ← AppShell, DesignToggle
│   ├── v1/                ← original primitives
│   └── v2/                ← new design (Sidebar, charts)
├── lib/
│   ├── shared/            ← supabase client, useDesignVersion
│   ├── v1/                ← dateFilter, utils
│   └── v2/                ← Supabase → v2 data adapter
├── design/                ← untouched reference (HTML/JSX prototype)
├── migrations/            ← SQL schema additions
├── apify_to_supabase.py
├── run_resumable.py
├── count_rows.py
├── pipeline_state.json
├── CHANGELOG.md           ← full history of every change in this session
└── WHERE_WE_LEFT_OFF.md   ← this file
```

## Background tasks status

- Dev server running on http://localhost:3000 (task `bzsugza9x`)
- Pipeline finished cleanly (task `bd7ieafao` completed)
- No active wakeup loops
- MySQL Server on :3306 (auto-recovered after earlier port-cleanup)

**On next session start:** if the dev server isn't running, just `npm run dev` again.
