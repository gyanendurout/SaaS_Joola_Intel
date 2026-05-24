# JOOLA Intel — Scraping Pipeline

Everything that turns the public web into rows in our Supabase database lives here.

```
scripts/pipeline/
├── README.md          ← you are here
├── v2/                ← the live pipeline (everything below)
└── _legacy/           ← v1 scripts kept for reference only; not executed
```

## TL;DR — run it

From the repo root:

```bash
# Full weekly refresh (recommended)
python scripts/weekly_run.py

# Continue an interrupted run
python scripts/weekly_run.py --resume

# Just one channel
python scripts/weekly_run.py --module products
python scripts/weekly_run.py --module instagram --brands joola,selkirk

# Dry-run (no API calls, no DB writes — just print the plan)
python scripts/weekly_run.py --dry-run

# Force sequential execution if something is rate-limited
python -m scripts.scraping.run --module all --no-parallel
```

Logs go to `c:/tmp/joola_weekly_YYYYMMDD_HHMM.log`. Checkpoint state lives in
`pipeline_v2_state.json` at the repo root so an interrupted run resumes
exactly where it left off.

---

## How it's organised — phases and parallelism

The runner thinks in **phases** (sequential) and **modules** (parallel within a
phase) and **groups** (parallel within a module). The whole point is that any
two pieces of work that don't depend on each other run at the same time.

```
PHASE 1 — scrape (9 modules run in parallel)
├── instagram ──→ profiles → posts → (comments ║ detect-replies) → influencers
├── youtube ───→ channels → videos → comments → transcripts
├── reddit ────→ mentions → comments
├── twitter ───→ (brand-posts ║ influencer-posts)
├── tiktok ────→ videos
├── ads ───────→ (meta-ads ║ google-ads)
├── products ──→ (apify-catalog ║ local-catalog ║ promotions)
├── news ──────→ news
└── seo ───────→ seo

PHASE 2 — enrich (1 module, 6 substeps all parallel)
└── enrichment → (ai_enricher ║ tiktok_enrichment ║ twitter_enrichment
                ║ reddit_backfill ║ influencer_sponsored ║ analyze_videos)

PHASE 3 — facts (1 module, 2 groups)
└── facts → group A (parallel): mention_facts ║ competitor_switch
                              ║ instagram_themes ║ populate_product_mentions
         → group B (parallel, after A): topic_lifecycle ║ populate_product_attention

PHASE 4 — sales-intelligence (1 module, 3 groups)
└── sales-intelligence → discover
                      → inventory
                      → (estimate ║ restock ║ sellout ║ launches)
                      → (revenue ║ correlation)
```

`║` = run in parallel · `→` = run after the previous step finishes.

A *step* is a single Python module with a `run(ctx) -> int` function that
returns the number of rows it upserted. The runner records its status in the
checkpoint (`done`, `failed`, `running`) so `--resume` knows what to skip.

The parallel runner uses `concurrent.futures.ThreadPoolExecutor` (default 8
workers — tune with `--max-workers N`). Threads are the right choice because
every step is I/O-bound: HTTP to Apify / Supabase / OpenAI / Playwright.

---

## The 9 scraping channels

| Channel | What we capture | API |
|---|---|---|
| **instagram** | brand profiles, posts, comments + sentiment, athlete posts | Apify `apify/instagram-scraper`, `apify/instagram-comment-scraper` |
| **youtube** | channels, videos, comments, transcripts | Apify `streamers/youtube-scraper`, `streamers/youtube-comments-scraper`, `streamers/youtube-transcripts-scraper` |
| **reddit** | brand mentions in r/Pickleball + sub-thread comments | Apify `trudax/reddit-scraper` |
| **twitter** | brand X account posts, 27 athlete X accounts | Apify `apidojo/twitter-scraper-lite` |
| **tiktok** | brand TikTok videos + creator profiles | Apify `clockworks/tiktok-scraper` |
| **ads** | Meta Ads Library, Google Ads Transparency | Apify `apify/facebook-ads-scraper`, `apify/google-ads-transparency-center-scraper` |
| **products** | paddle catalog (name, price, rating, reviews) + on-site promotions | Apify `apify/playwright-scraper` **and** local Playwright (see below) |
| **news** | news mentions of each brand | Apify `news-scraper` |
| **seo** | Lighthouse-style brand SEO metrics | internal |

### Products is special — it has TWO scrapers running in parallel

Some brand sites can be cracked by Apify's generic Playwright scraper; some can't.
Both scrapers run side-by-side and upsert into the same `products` table:

| Brand | Scraper | Why |
|---|---|---|
| selkirk, paddletek, crbn, gamma | `scrape_catalog.py` (Apify) | Standard Shopify themes |
| joola, six-zero, onix, franklin, head, engage | `scrape_catalog_local.py` (local Playwright) | Custom themes, hashed class names, anti-bot detection |
| wilson | *(neither — Akamai bot manager)* | Needs residential proxy — open work |

The local scraper (`scrape_catalog_local.py`) holds a per-brand recipe:
which CSS selector identifies a product card, where to look for the title and
price, and whether to apply `playwright-stealth` to defeat anti-bot detection
(engage). One Chromium browser, fresh context per brand.

---

## The enrichment & facts pipeline

After Phase 1 finishes, the scraped rows still need to be turned into intel.

**Phase 2 — Enrichment** uses GPT-4o-mini to add:
- Sentiment (positive / neutral / negative) on every Instagram/YouTube/Reddit comment
- Brand, player, product NER (named entity recognition)
- Crisis-signal flag (defection, controversy, paddle defect)
- Purchase-intent score on Reddit OPs
- Sponsored-post detection on athlete Instagram/TikTok posts
- Video content analysis for YouTube

**Phase 3 — Facts** rolls enriched rows into the tables the dashboard reads:
- `mention_facts` — one row per comment that mentions a brand/product
- `topic_lifecycle` — when a topic first appeared, peaked, faded
- `competitor_switch` — Reddit users defecting between brands
- `instagram_themes` — recurring content themes per brand
- `product_mentions` / `product_attention` — per-paddle attention scores

**Phase 4 — Sales-intelligence** estimates revenue, restock cadence, sellout
likelihood, and new-launch detection from product inventory + attention.

---

## Adding a new scraper — the recipe

1. Create `scripts/scraping/sources/<channel>/scrape_<thing>.py` exposing
   `def run(ctx: dict) -> int:` (return the number of rows upserted).
2. Add the import path to `MODULE_STEPS` in `scripts/scraping/run.py`.
   - Put it in its own group if other steps depend on it finishing first.
   - Add it to an existing group's inner list to make it parallel with siblings.
3. Use the helpers in `core/`:
   - `apify_client.run_and_fetch(actor_id, input, timeout_secs=, memory_mb=)`
   - `supabase_client.upsert(table, rows, conflict_key)`
   - `supabase_client.get(table, columns)`
   - `logger.get_logger("channel.thing")`
4. Honour `ctx["brands"]` for filtering and `ctx["dry_run"]` for no-op runs.
5. Smoke test:
   ```bash
   python -m scripts.scraping.run --module <channel> --dry-run
   python -m scripts.scraping.run --module <channel> --brands joola
   ```

## Adding a new local-Playwright product brand

Edit `scripts/scraping/sources/products/scrape_catalog_local.py`:

1. Write a `JS_<BRAND>` extraction function (returns `[{name, price, rating, ...}]`).
2. Append an entry to `BRAND_SCRAPERS`:
   ```python
   {"slug": "<brand>", "url": "<collection-url>",
    "wait_for": "<css-selector>", "js": JS_<BRAND>,
    "currency": "USD", "stealth": False}
   ```
3. `stealth: True` adds `playwright-stealth` + 8-second settle time for sites
   that block headless browsers (engage uses this; wilson needs more).

---

## Source of truth

- **Brands** are seeded in `migrations/000_init.sql` (`brands` table)
- **X/Twitter handles** in `migrations/003_x_tiktok.sql` (`x_accounts`,
  `tiktok_accounts`) — DO NOT hardcode handles in scrapers
- **Influencer X handles** in `migrations/005_influencer_x.sql`
  (`influencers.x_handle`, NULL means "unverified, do not scrape")

Scrapers read handles from the DB on every run. To change which accounts get
scraped, update the DB — never the Python file.

---

## Setup (one-time per machine)

```bash
# Python deps
pip install -r requirements.txt          # if requirements.txt exists, else:
pip install requests supabase python-dotenv playwright playwright-stealth openai

# Chromium for local Playwright scrapers
python -m playwright install chromium

# Credentials — copy and fill in
cp scripts/.env.example scripts/.env
# Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APIFY_TOKEN
# Optional: OPENAI_API_KEY (for enrichment phase)
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Apify actor "FAILED" in 1-2 s | JS error in PAGE_FUNCTION | Check brace/paren matching; test syntax via `node -e "new Function(jsCode)"` |
| Actor TIMED-OUT | Page has too many product links and walk-up is slow | Bump `timeout_secs` in `_scrape_one_brand`, or use local Playwright instead |
| Step fails on parallel run but works on `--no-parallel` | Rate limiting from upstream API | Reduce `--max-workers`, or put step in its own sequential group |
| Local Playwright says "Access denied" | Anti-bot CDN (Akamai, Cloudflare) | Set `stealth: True` in BRAND_SCRAPERS; if still blocked, needs residential proxy |
| Wrong site title in probe | URL is 404 or redirected | Open the URL in a browser and find the real path |
| Step ⏭ "already done" but you want it to re-run | Checkpoint thinks it succeeded | `python scripts/weekly_run.py --module <name>` (defaults to `--restart`) |
| `pipeline_v2_state.json` is corrupt | Disk crash mid-write | Delete it; the next run reseeds from scratch |

---

## CLI reference

`scripts/weekly_run.py` is a thin wrapper. The real CLI is
`python -m scripts.scraping.run`:

```
--module <name>      one of: all instagram youtube reddit twitter tiktok ads
                     products news seo enrichment facts sales-intelligence
                     intelligence maintenance
--source <name>      specific sub-source (e.g. scrape-catalog-local)
--brands a,b,c       limit to specific brand slugs
--dry-run            print the plan without running it
--restart            ignore the checkpoint, start fresh (default in weekly_run)
--no-resume          alias for --restart
--no-parallel        run everything sequentially
--max-workers N      thread pool size (default 8)
--limit N            per-step row cap (smoke tests only)
```

---

## Why _legacy/ exists

`_legacy/` holds the v1 pipeline scripts (`run_resumable.py`, `apify_to_supabase.py`,
`enrich_with_ai.py`, etc.) from before the v2 refactor. Nothing references
them anymore — the modular v2 pipeline supersedes everything in there. They're
kept on disk because some backup/runbook docs in `backup/` still reference
them by path, and deleting would break those historical links.
