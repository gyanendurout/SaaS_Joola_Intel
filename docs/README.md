# docs/ — index

Reference documentation. Product spec lives in [`../BRD.md`](../BRD.md); coding
rules live in [`../CLAUDE.md`](../CLAUDE.md); pipeline operation lives in
[`../backend/README.md`](../backend/README.md). Nothing in here should restate
those.

| File | Owns |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System topology, full file map, end-to-end data flow, QA gates |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Three-way deploy topology, env vars, CI wiring, prod hardening |
| [RUNBOOK.md](RUNBOOK.md) | Weekly operating cadence + incident troubleshooting |
| [DATABASE.md](DATABASE.md) | Table-by-table schema inventory, writers, readers, freshness |
| [DATABASE_RECOVERY.md](DATABASE_RECOVERY.md) | Recreating Supabase from `migrations/*.sql` |
| [FRONTEND_REBUILD.md](FRONTEND_REBUILD.md) | Standing the dashboard back up from zero |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Palette, typography, component + chart contracts |
| [CHANGELOG.md](CHANGELOG.md) | Historical session logs (pre-2026-05-24 paths) |

---

## Disaster recovery — reading order

If the deployed app and the laptop are both lost, read these in order to
rebuild end-to-end.

1. [`../BRD.md`](../BRD.md) — what the product is and what it must do. If you
   disagree with the goals here, re-scope before rebuilding.
2. [DATABASE_RECOVERY.md](DATABASE_RECOVERY.md) — recreate the Supabase project
   and run `migrations/` in order.
3. [DATABASE.md](DATABASE.md) — confirm the schema and expected row shapes.
4. [`../backend/README.md`](../backend/README.md) — run the scraping pipeline to
   repopulate raw tables, then enrichment and facts.
5. [`../analytics_backend/README.md`](../analytics_backend/README.md) — refresh
   marts and statistics.
6. [FRONTEND_REBUILD.md](FRONTEND_REBUILD.md) — bring the Next.js dashboard up
   locally against the restored DB.
7. [DEPLOYMENT.md](DEPLOYMENT.md) — deploy frontend to Vercel, schedule the two
   Python units.

What is **not** recoverable from this directory: the source tree itself. These
docs describe how the system is put together; they do not snapshot the code.
Git is the only copy — keep the GitHub remote healthy.

---

## Known staleness

Some command blocks in `DATABASE_RECOVERY.md`, `FRONTEND_REBUILD.md`,
`RUNBOOK.md`, and `DEPLOYMENT.md` still reference the pre-2026-05-24 layout
(`scripts/pipeline/…`, root-level `app/v2/…`). Where they conflict with
[ARCHITECTURE.md](ARCHITECTURE.md) or [`../backend/README.md`](../backend/README.md),
those two win.
