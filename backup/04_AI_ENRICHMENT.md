# 04 — AI Enrichment

> **Goal.** After raw rows land in Supabase via the scraping pipeline, run the GPT-4o-mini enrichment worker, then populate the cross-channel fact tables. The dashboard's sentiment/crisis/intent KPIs depend on this step.

---

## Order of operations

Always run in this order. Each step assumes the previous one finished cleanly.

1. **`python scripts/pipeline/apify_to_supabase.py`** — raw scrape (see `03_SCRAPING_PIPELINE.md`).
2. **`python scripts/pipeline/enrich_with_ai.py`** — classifies each new text row via GPT-4o-mini, writes 12 columns per row.
3. **`python scripts/pipeline/populate_mention_facts.py`** — denormalizes enriched rows into `mention_facts` (1 row per channel × source × product/athlete) and creates `competitor_switch_events` from Reddit defection signals.
4. **`python scripts/pipeline/populate_topic_lifecycle.py`** — rolls up topics into `topic_lifecycle` (first-seen / peak / decay timeline).

---

## `enrich_with_ai.py` — the worker

**What it does.** Selects every row from every text-bearing channel table where `enriched_at IS NULL`, sends the text to GPT-4o-mini with a strict JSON schema prompt, then writes the parsed result back.

**Model.** `gpt-4o-mini` with `temperature: 0` and `response_format: {"type": "json_object"}`. Hard-coded — change with care.

**Parallelism.** Uses `ThreadPoolExecutor` (~10 concurrent OpenAI calls). Tunable in the source. Rate-limited responses (HTTP 429) trigger exponential back-off (5 s, 10 s, 20 s).

**Cost rough order.** ~$0.50–$2 USD per full weekly enrichment run depending on volume. Each call uses ~500-1000 input tokens + ~150 output tokens at gpt-4o-mini pricing.

### Tables enriched

Defined in the `TABLES` list at the top of `enrich_with_ai.py`. Each entry is `(table, id_col, select_fields, combine_fn)`:

| Table | Text combined from |
|---|---|
| `reddit_mentions` | `post_title + "\n" + content_text` |
| `reddit_comments` | `comment_text` |
| `ig_comments` | `comment_text` |
| `yt_comments` | `comment_text` |
| `x_posts` | `text` |
| `tiktok_videos` | `text` |
| `influencer_x_posts` | `text` |

### The 12 enrichment columns (written per row)

| Column | Type | Notes |
|---|---|---|
| `sentiment_score` | numeric | -1.0 (very negative) → 1.0 (very positive) |
| `sentiment_label` | text enum | `very_negative` / `negative` / `neutral` / `positive` / `very_positive` |
| `topics` | jsonb | 1-4 short kebab-case tags (e.g. `paddle-review`, `warranty-issue`) |
| `brands_mentioned` | text[] | Brand slugs from the 11-brand list |
| `players_mentioned` | text[] | Athlete full names from the 27-name roster |
| `products_mentioned` | text[] | Paddle names from the curated list of ~25 |
| `is_crisis` | bool | Product failure / defect / warranty / fraud / reputation risk |
| `is_opportunity` | bool | Buying-intent, switch-from-competitor, positive UGC about JOOLA |
| `purchase_intent_score` | numeric | 0.0 → 1.0 explicit purchase intent |
| `crisis_keywords` | text[] | Subset of `{broken, lawsuit, recall, warranty, defective, delaminating, delam, refund, fraud, scam, cracked, snapped}` found in the text |
| `competitor_switch_from` | text (Reddit only) | Brand slug the writer is leaving |
| `competitor_switch_to` | text (Reddit only) | Brand slug the writer is moving to |
| _(meta)_ `enriched_at` | timestamptz | Set to `now()` on successful update — used as the "already processed" flag |

> **`competitor_switch_*` fields are emitted only when `allow_competitor_switch=True`**, which is set for `reddit_mentions` and `reddit_comments` rows. Other channels' switch fields are stripped before write.
>
> **`influencer_x_posts`** lacks `crisis_keywords` and `players_mentioned` columns (per `006_enrichment_columns.sql` lines 95-111). The worker strips those before write via the `TABLE_FIELD_OVERRIDES` map.

### The prompt

Stored as `SYSTEM_PROMPT` in `enrich_with_ai.py`. Key constraints baked into the prompt:

- **Output:** strict JSON, no prose, no markdown.
- **Grounding lists** are passed inline: 11 brand slugs, 27 athlete full names, ~25 product names. The LLM picks subsets from these — open-ended brand/player extraction is **not** allowed (reduces hallucinations).
- **Text truncation:** the input is sliced to `text[:1500]` chars to keep token cost predictable on long Reddit threads.

### Resumability

The `enriched_at IS NULL` filter is the **only resumability mechanism**. If the worker crashes mid-run, just rerun — already-processed rows are skipped because their `enriched_at` is now non-null.

Failed calls (after 3 retries) leave `enriched_at` NULL → the row is retried next run. A mop-up cron is healthy practice; see `08_RUNBOOK.md`.

---

## `populate_mention_facts.py`

**What it does.** Reads enriched rows from every channel, emits one normalized row per `(channel, source_id, brand_id, product_id)` into `mention_facts`. This is the **fact table every cross-channel dashboard reads from.**

**Sources** (defined in `SOURCES` list):
- `reddit` (`reddit_mentions`)
- `reddit_comment` (`reddit_comments`)
- `ig_comment` (`ig_comments`)
- `yt_comment` (`yt_comments`)
- `x` (`x_posts`)
- `tiktok` (`tiktok_videos`)
- `x_influencer` (`influencer_x_posts`)

**Lookups** loaded at start:
- `load_brands()` → `slug → brand_id`
- `load_products()` → `lowercase alias → product_id` (handles all aliases per `products_catalog`)
- `load_athletes()` → `lowercase full name → influencer_id`

**Expansion rule.** A row that mentions 3 brands × 2 products produces up to 6 `mention_facts` rows (one per combo). Idempotent via the unique constraint:

```sql
unique (channel, source_id, brand_id, coalesce(product_id, ZERO_UUID))
```

**Side effect.** Reddit rows with `competitor_switch_from` + `competitor_switch_to` populated also create a `competitor_switch_events` row with the LLM's `confidence` (currently hard-coded to a single value pending a separate confidence pass — TODO: verify).

**Pagination.** `fetch_enriched_unfacted()` uses offset pagination (PostgREST `Range` headers) to handle tables with >1000 enriched rows.

**Idempotency.** Re-runnable. Re-running on the same week just no-ops via the unique constraint.

---

## `populate_topic_lifecycle.py`

**What it does.** Aggregates the `topics` jsonb arrays across `mention_facts` into the `topic_lifecycle` table:

| Column | Logic |
|---|---|
| `topic_slug` | The kebab-case topic tag emitted by the LLM |
| `display_label` | Title-cased version |
| `first_seen_at` | `min(posted_at)` of any mention of this topic |
| `first_seen_channel` | Channel of the first sighting — answers "where did this trend start?" |
| `peak_at` | Posted-at of the row with the highest 24-hour rolling mention count |
| `peak_mentions_24h` | The max 24-hour rolling count |
| `decayed_at` | First time mentions drop below 25% of peak (TODO: verify exact threshold) |
| `total_mentions` | Lifetime mention count |
| `channels_touched` | Distinct channel slugs |
| `is_crisis` | True if **any** contributing mention had `is_crisis=true` |

**Dashboard use.** `/v2/market` surfaces topics ordered by `peak_mentions_24h` with `is_crisis` filter; the "first channel" insight feeds the "Topic lifecycle (first-channel detection)" KPI.

**Idempotency.** Rewrites the whole `topic_lifecycle` table each run (upsert by `topic_slug`).

---

## Verification queries after enrichment

```sql
-- How many rows are still unenriched per table?
select 'reddit_mentions'      as t, count(*) from reddit_mentions      where enriched_at is null
union all
select 'reddit_comments'      , count(*) from reddit_comments      where enriched_at is null
union all
select 'ig_comments'          , count(*) from ig_comments          where enriched_at is null
union all
select 'yt_comments'          , count(*) from yt_comments          where enriched_at is null
union all
select 'x_posts'              , count(*) from x_posts              where enriched_at is null
union all
select 'tiktok_videos'        , count(*) from tiktok_videos        where enriched_at is null
union all
select 'influencer_x_posts'   , count(*) from influencer_x_posts   where enriched_at is null;

-- mention_facts coverage (should grow each run)
select channel, count(*) from mention_facts group by 1 order by 2 desc;

-- Top topics this week
select topic_slug, peak_mentions_24h, is_crisis from topic_lifecycle
  order by peak_mentions_24h desc nulls last limit 20;
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `KeyError: 'SUPABASE_SERVICE_ROLE_KEY'` | `scripts/.env` missing or `python-dotenv` not installed | `pip install python-dotenv`; verify `.env` |
| `✗ No OpenAI key found` | `OPENAI_API_KEY` and `NEXT_PUBLIC_OPENAI_KEY` both unset | Set one of them in `scripts/.env` |
| All rows enriched with `sentiment_score = 0` | Prompt drift or model returning empty arrays | Inspect a sample row's `topics`; if topics are also empty, OpenAI is timing out — check `r.status_code` in logs |
| `mention_facts` count not growing | `enriched_at` filter excluded everything | Verify enrichment ran; check `enriched_at` is not null on raw rows |
| `competitor_switch_events` empty | LLM not detecting switches | Verify the Reddit rows actually have `competitor_switch_from`/`to` populated; if not, the LLM isn't extracting them — check the prompt and sample |

---

## What this layer does **not** do

- It does **not** translate non-English content (LLM handles English-heavy comment streams; non-English rows often come back with `sentiment_label: "neutral"`).
- It does **not** deduplicate at the entity level — a single Reddit thread referencing 3 brands still produces 3 `mention_facts` rows.
- It does **not** train any model — it's pure API calls to a frozen model snapshot.
- It does **not** retain raw LLM responses; only the parsed JSON fields are persisted.
