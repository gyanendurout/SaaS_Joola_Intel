# 08 — Runbook

> **Goal.** Day-to-day operations. Weekly cadence checklist + troubleshooting for the failures we've actually seen.

---

## Weekly cadence (every Monday)

Target window: **07:00 IST Monday**. Full cycle is ~60–120 min.

### Step-by-step checklist

```
☐ 1. Open Vercel + Supabase dashboards in tabs
☐ 2. Verify last week's data landed
       SELECT max(scraped_at) FROM ig_profiles_weekly;
       SELECT count(*) FROM reddit_mentions WHERE posted_at > now() - interval '7 days';
☐ 3. Pull latest code:    git pull origin main
☐ 4. Activate env:        confirm scripts/.env present, APIFY_TOKEN has credit
☐ 5. Run scrape:          python scripts/pipeline/apify_to_supabase.py
       (or `python scripts/pipeline/run_resumable.py` if last week was incomplete)
       Watch the console; expect 13 steps to print SUCCEEDED.
☐ 6. Verify row growth:   python scripts/pipeline/count_rows.py
☐ 7. Run enrichment:      python scripts/pipeline/enrich_with_ai.py
       (~5-20 min depending on backlog)
☐ 8. Populate facts:      python scripts/pipeline/populate_mention_facts.py
☐ 9. Populate topics:     python scripts/pipeline/populate_topic_lifecycle.py
☐ 10. Smoke-test live URL: open /v2 → KPIs updated? /v2/reddit → new posts?
☐ 11. Note any anomalies in scripts/SCRAPE_PROGRESS.md
☐ 12. Send the team a "data refreshed" ping (Slack/email — TODO: define channel)
```

---

## Daily

Nothing required. Data only refreshes weekly. If a quick patch is needed:

- Code change → `git push` → Vercel auto-deploys.
- Hotfix data point → manual `UPDATE` in Supabase SQL editor + log it.

---

## Troubleshooting

### `42P10` — "there is no unique or exclusion constraint matching the ON CONFLICT specification"

The most common pipeline error. Caused by a `sb_upsert(table, rows, on_conflict='colA,colB')` where the DB has no matching unique constraint.

**Pattern to fix** (mirror `004_unique_constraints.sql` and `008_products_constraint.sql`):

```sql
-- 1) Archive duplicates first (safety)
create table if not exists <table>_dupe_archive (
  archived_at timestamptz default now(),
  row_data    jsonb
);
insert into <table>_dupe_archive (row_data)
select to_jsonb(a.*) from <table> a
where a.id in (
  select a.id from <table> a
  join <table> b on a.<colA>=b.<colA> and a.<colB>=b.<colB> and a.id<b.id
);

-- 2) Delete duplicates (keep highest id per group)
delete from <table> a using <table> b
where a.id < b.id and a.<colA>=b.<colA> and a.<colB>=b.<colB>;

-- 3) Add the unique constraint
alter table <table>
  add constraint <table>_<colA>_<colB>_uniq unique (<colA>, <colB>);
```

Save as a new migration (`010_*.sql`, `011_*.sql`, etc.). **Never edit older migrations.**

---

### Network timeout on Supabase request

The scraper already retries 80× with 30 s backoff via `http_request()` in `apify_to_supabase.py`. If you still see timeouts:

- Check Supabase status: https://status.supabase.com
- Check that the service-role key is correct (a 401 looks like a hang due to retries)
- Reduce batch size from 500 to 200 in `sb_upsert()` if the payload is huge

---

### Apify actor failed

```
✗ Run abc123 ended with FAILED
```

1. Open the run in https://console.apify.com/actors/runs/<run_id>.
2. Read the actor's log. Top causes:
   - **No credit.** Top up.
   - **Input schema changed.** Compare the actor's current `INPUT_SCHEMA.json` with the input dict in `run_*()`.
   - **Target site changed structure.** For `apify/playwright-scraper` (used by `run_products` + `run_homepage_promos`), the `pageFunction` may need updating.
   - **Rate-limited / IP-blocked.** Wait an hour and rerun the single step (e.g. `python scripts/pipeline/test_products_only.py`).
3. `_safe_step()` ensures the rest of the pipeline continues even if one step fails — so you can rerun just the broken step afterwards.

---

### Actor `SUCCEEDED` but 0 items returned

Almost always means the seed handle is wrong (account renamed or deleted). Examples we've seen:

- JOOLA X handle was seeded as `joolausa` (a parody account with 253 followers). Real account: `joolapickleball`. Fixed in `004_unique_constraints.sql`.

To fix: `UPDATE x_accounts SET handle='<real>' WHERE …` then rerun the X step.

---

### Enrichment worker stalls / 429s

Symptom: `enrich_with_ai.py` logs `rate-limited, waiting 20s` repeatedly.

- OpenAI's gpt-4o-mini RPM/TPM caps kicked in. The worker already backs off (5 → 10 → 20 s). If it's persistent, reduce parallelism in the `ThreadPoolExecutor` (currently 10).
- Check the OpenAI usage dashboard for spike alerts and credit balance.

If a row keeps failing all 3 attempts, the worker leaves `enriched_at` NULL → it gets retried next run. Run a mop-up:

```bash
python scripts/pipeline/enrich_with_ai.py     # second pass picks up nulls only
```

---

### `mention_facts` not growing after a run

1. Confirm raw rows landed: `select count(*) from reddit_mentions where posted_at > now()-interval '7 days';`
2. Confirm those rows are enriched: same query with `and enriched_at is not null`.
3. Run `populate_mention_facts.py` again — it's idempotent.
4. If still empty, sample a row's `brands_mentioned` and confirm it's a populated text array (not empty). If empty, the LLM didn't find anything matchable — usually expected behavior, not a bug.

---

### Frontend shows "Loading..." forever

1. Open DevTools → Network. Look for failing `supabase.co` requests.
2. If 401: anon key in Vercel env is wrong or RLS is blocking. Check `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. If 200 but empty array: the table is empty (run the pipeline) or filter is excluding everything (check `BrandFilterContext`).
4. If the page references a column that doesn't exist on the table: TS won't catch this — surface it as a runtime error in DevTools.

---

### TypeScript build failure on Vercel

Most common cause: `[...new Set(...)]` spread on iterables (TS2802). Replace with `Array.from(new Set(...))`. Re-run `npm run type-check` locally before pushing.

---

### Reddit scraper returns `is_removed: true` for many rows

Posts get removed by moderators or the user. Migration `009` added an `is_removed bool` column. Filter these out at query time on the dashboard:

```sql
where coalesce(is_removed, false) = false
```

---

### Product brand attribution wrong (e.g. all Wilson paddles attributed to Selkirk)

`run_products()` uses a **triple fallback**: handle map → source URL host → keyword match. If the source URL is missing, the fallback can go wrong. Inspect the misattributed row's `source_url` and `name`; usually the host parser needs tweaking. (Reference: 2026-05-15 session log "Products Brand Attribution — Triple-Fallback".)

---

## Disaster scenarios

| What's broken | What to do |
|---|---|
| Vercel deploy stuck "Building…" | Cancel + redeploy from dashboard. If still stuck, check Vercel status page. |
| Vercel deploy succeeded but `/v2` returns 500 | Open Vercel function logs. Most often an env var is missing — verify all 3 `NEXT_PUBLIC_*` exist. |
| Supabase project suspended (free-tier inactivity) | Log in to Supabase, restore the project. No data loss within suspension window. |
| Supabase project deleted | See `02_DATABASE_RECOVERY.md`. Apify dataset history is **not** recoverable beyond 30 days. |
| Apify account locked / banned | Create a new account; only the token in `scripts/.env` needs updating. No code changes. |
| OpenAI key revoked | New key from OpenAI dashboard → update `scripts/.env` (and Vercel `NEXT_PUBLIC_OPENAI_KEY` if `/api/generate-content` is being used). |
| Laptop dies mid-week | `pipeline_state.json` lets `run_resumable.py` pick up where it stopped on a new machine after `git clone + .env restore`. |
| Secrets pushed to GitHub | GitHub Secret Scanning will block the push and tell you the exact line. Remove the secret, force a clean commit (NOT `--force` to remote without coordination), **rotate the leaked key**. |
| Tampered migration (someone edited a 00X file) | `git diff` against `main`; revert; never edit historical migrations. Add a fix-up `010_*.sql` instead. |

---

## On-call escalation (TODO: verify with team)

1. **Operating contact:** api@joola.com
2. **Vercel / GitHub admin:** TODO
3. **Supabase project owner:** TODO
4. **Apify billing:** TODO

---

## Useful one-liners

```sql
-- Row-count snapshot
select 'brands'                  as t, count(*) from brands union all
select 'influencers'             , count(*) from influencers union all
select 'products_catalog'        , count(*) from products_catalog union all
select 'ig_profiles_weekly'      , count(*) from ig_profiles_weekly union all
select 'ig_posts'                , count(*) from ig_posts union all
select 'yt_videos'               , count(*) from yt_videos union all
select 'reddit_mentions'         , count(*) from reddit_mentions union all
select 'reddit_comments'         , count(*) from reddit_comments union all
select 'marketing_ads'           , count(*) from marketing_ads union all
select 'mention_facts'           , count(*) from mention_facts union all
select 'topic_lifecycle'         , count(*) from topic_lifecycle union all
select 'competitor_switch_events', count(*) from competitor_switch_events;

-- Newest crisis signals (last 7 days)
select brand_id, text_snippet, posted_at
from mention_facts
where is_crisis and posted_at > now() - interval '7 days'
order by posted_at desc limit 20;

-- Brands losing share to JOOLA (last 30 days)
select from_brand_id, count(*) as defections
from competitor_switch_events
where to_brand_id = (select id from brands where slug='joola')
  and posted_at > now() - interval '30 days'
group by 1 order by 2 desc;
```
