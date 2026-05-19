# 02 — Database Recovery (Supabase)

> **Goal.** Recreate the Supabase database from `migrations/*.sql` in correct order. Verify seed counts. After this doc you should have a working DB ready for `apify_to_supabase.py`.

---

## Step 1 — Create the Supabase project

1. Log in to https://supabase.com.
2. Create a new project. Region: choose closest to where the Python scraper will run (US East works fine from anywhere).
3. Note these from the project settings:
   - **Project URL** → `https://<ref>.supabase.co`
   - **`service_role` key** (Settings → API) — **server-only, keep secret**.
   - **`anon` key** (Settings → API) — safe for the browser/Vercel.
4. The legacy reference project was `loecyghnkkxyymelgexz`. Any new project ref works.

---

## Step 2 — Apply migrations in order

All migrations live in `migrations/` at the repo root. **Do not modify them — they are append-only history.** Run each one in the Supabase SQL editor (or via `psql`) in this order:

| Order | File | Purpose | Seeds? |
|---|---|---|---|
| 1 | `001_particl_features.sql` | `product_price_history`, `promotions`, `marketing_ads` + columns on `products` | no |
| 2a | `002_keyword_research.sql` | `keyword_research_results` | no |
| 2b | `002_seo_reporting.sql` | `keyword_rankings`, `crawl_pages`, `content_briefs` | no |
| 3 | `003_x_tiktok.sql` | `x_accounts`, `x_profiles_weekly`, `x_posts`, `tiktok_accounts`, `tiktok_profiles_weekly`, `tiktok_videos` | **yes** — 8 X handles + 10 TikTok handles |
| 4 | `004_unique_constraints.sql` | adds unique constraints on `reddit_mentions(reddit_post_id, brand_id)` and `influencer_posts(post_url)`. Archives dupes first. Also fixes JOOLA X handle. | corrects 1 row |
| 5 | `005_influencer_x.sql` | `influencer_x_snapshots`, `influencer_x_posts`, `influencers.x_handle` | **yes** — 27 athlete X handles |
| 6 | `006_enrichment_columns.sql` | adds 12 enrichment columns to `reddit_mentions`, `ig_comments`, `yt_comments`, `x_posts`, `tiktok_videos`, `influencer_x_posts` | no |
| 7 | `007_cross_channel_facts.sql` | `products_catalog`, `mention_facts`, `topic_lifecycle`, `competitor_switch_events` | **yes** — 25 paddles |
| 8 | `008_products_constraint.sql` | adds unique constraint on `products(name, brand_id)`; archives dupes first | no |
| 9 | `009_reddit_comments.sql` | `reddit_comments` table + `reddit_mentions` velocity columns (`upvotes_last_scrape`, `velocity_per_hour`, `awards`, `is_removed`) | no |

**Skip the `*_rollback.sql` files** unless you're intentionally reverting a migration.

> ⚠ **Pre-requisite tables not in these migrations.** `001` references `products` and `brands`, and `003` references `brands`. `004`/`005`/`006` reference `reddit_mentions`, `influencer_posts`, `ig_comments`, `yt_comments`, `influencers`, `ig_profiles_weekly`, `yt_channels`, `yt_videos`. These are the **legacy base schema** from the POC's earlier era and were **not snapshotted** into this `migrations/` directory.
>
> **If recovering from scratch with no DB at all**, you must first recreate the base schema. The contract is:
> - `brands(id uuid PK, slug text unique, name text, is_joola bool)` — seed with the 11 slugs in `01_BUSINESS_REQUIREMENTS.md`.
> - `influencers(id uuid PK, name text, instagram_handle text unique, brand_id uuid, x_handle text)` — seed with 27 athletes; their Instagram handles are listed in `migrations/005_influencer_x.sql` `(values …)`.
> - `products(id uuid PK, brand_id uuid, name text, …)` — scraped paddle SKUs.
> - `ig_profiles_weekly`, `ig_posts`, `ig_comments` — Instagram channel data per brand.
> - `yt_channels`, `yt_videos`, `yt_comments` — YouTube channel data per brand.
> - `reddit_mentions(id uuid PK, reddit_post_id text, brand_id uuid, subreddit text, post_title text, content_text text, upvotes int, comment_count int, posted_at timestamptz, country_code text, …)`.
> - `influencer_posts(id uuid PK, influencer_id uuid, post_url text, …)`.
>
> **TODO: verify with team** — the exact `CREATE TABLE` statements for the base schema aren't in `migrations/`. Either recover from a Supabase backup, or reverse-engineer the schemas from `scripts/apify_to_supabase.py`'s `sb_upsert` calls and the `select=…` strings in `lib/v2/data.ts`.

---

## Step 3 — Verify seed counts

After applying all 9 migrations, run these in the Supabase SQL editor and confirm counts:

```sql
-- 11 brands
select count(*) from brands;                                   -- expect 11

-- 27 athletes
select count(*) from influencers;                              -- expect 27

-- 27 athletes with X handles populated
select count(*) from influencers where x_handle is not null;   -- expect 27

-- 8 brand X accounts (joola, selkirk, franklin, engage, paddletek, onix, wilson, gamma)
select count(*) from x_accounts;                               -- expect 8

-- 10 brand TikTok accounts
select count(*) from tiktok_accounts;                          -- expect 10

-- 25 seeded paddles in the canonical catalog
select count(*) from products_catalog;                         -- expect 25

-- JOOLA's X handle should be 'joolapickleball', NOT 'joolausa'
select handle from x_accounts
  where brand_id = (select id from brands where slug='joola'); -- expect 'joolapickleball'
```

If any number is off, re-check the migration `(values …)` blocks and re-run the affected migration. Migrations use `on conflict` clauses so they're safe to re-run.

---

## Step 4 — Configure Row-Level Security (RLS)

Out of the box Supabase allows anon-key access to anything. For **production hardening** (currently TODO):

```sql
-- Enable RLS on every table
alter table brands enable row level security;
alter table influencers enable row level security;
-- … repeat for every table

-- Public-read policy (anon role)
create policy "public_read" on brands for select using (true);
create policy "public_read" on influencers for select using (true);
-- … repeat for every table the dashboard reads
```

The dashboard only does `SELECT`s with the anon key, so SELECT policies are enough. **Writes** all go through the Python scripts using the `service_role` key, which bypasses RLS entirely.

> Current POC has RLS **disabled** — see CLAUDE.md "Pending POC → prod hardening" checklist.

---

## Step 5 — Indexes & performance

Every migration creates the indexes it needs. Spot-check after recovery:

```sql
-- mention_facts must have these (created in 007)
select indexname from pg_indexes where tablename = 'mention_facts';
-- expect: mention_facts_uniq, mention_facts_posted_at_idx,
--         mention_facts_brand_posted_idx, mention_facts_product_posted_idx,
--         mention_facts_crisis_idx
```

If a dashboard page is slow, the **most common cause** is a missing index on `(brand_id, posted_at desc)` for whatever channel table you're querying. Add it.

---

## Step 6 — Connect from local & Vercel

**Local `scripts/.env`** (gitignored — never commit):

```bash
SUPABASE_URL=https://<your-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...   # server-side, full access
APIFY_TOKEN=apify_api_...               # see 03_SCRAPING_PIPELINE.md
OPENAI_API_KEY=sk-...                   # see 04_AI_ENRICHMENT.md
```

**Vercel project env vars** (Settings → Environment Variables, set for Production + Preview):

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...   # browser-safe
NEXT_PUBLIC_OPENAI_KEY=sk-...               # POC only, leaks to browser bundle
```

---

## Recovery scenarios

| Scenario | What to do |
|---|---|
| Supabase project deleted, no backup | Run all migrations from scratch. **Re-scrape from week 0** — historical scraper data is **not recoverable**. Apify garbage-collects datasets after 30 days. |
| Supabase project deleted, daily backup available | Restore the backup, skip migrations entirely, just re-run scraping going forward. |
| One table corrupted / dropped | Re-run the migration that creates it (idempotent via `if not exists`). Re-run scraper to repopulate. |
| Duplicate-rows error during scrape (`42P10`) | A new unique constraint is needed. Follow the pattern in `004_unique_constraints.sql` / `008_products_constraint.sql`: archive → delete → add constraint. See `08_RUNBOOK.md` for the full pattern. |
| Schema drift between local and prod | Diff `migrations/` against Supabase via `pg_dump --schema-only` and reconcile. |

---

## What is **NOT** in migrations

- The **base schema** (`brands`, `influencers`, base channel tables) — see Step 2 warning above.
- **RLS policies** — disabled in POC.
- **Stored procedures or triggers** — none in use.
- **Materialized views** — none in use; the dashboard re-aggregates on the fly. If pages get slow at scale, this is the first thing to revisit.
