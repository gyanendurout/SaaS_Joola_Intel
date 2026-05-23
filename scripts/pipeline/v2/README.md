# JOOLA Intel Pipeline v2

Modular, resumable scraping and enrichment system for 11 pickleball brands.

## Setup

```bash
pip install -r scripts/pipeline/v2/requirements.txt
```

Env vars required in `scripts/.env`:
```
SUPABASE_URL=https://loecyghnkkxyymelgexz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
APIFY_TOKEN=...
OPENAI_API_KEY=...
```

## Run migrations first

Apply in Supabase SQL Editor (Settings → SQL Editor):
1. `migrations/010_sales_intelligence.sql`
2. `migrations/011_enrichment_extensions.sql`

## Usage

```bash
# Full weekly pipeline (all modules, resume from checkpoint)
python -m scripts.pipeline.v2.run --module all

# Single module
python -m scripts.pipeline.v2.run --module instagram
python -m scripts.pipeline.v2.run --module youtube
python -m scripts.pipeline.v2.run --module reddit
python -m scripts.pipeline.v2.run --module twitter
python -m scripts.pipeline.v2.run --module tiktok
python -m scripts.pipeline.v2.run --module ads
python -m scripts.pipeline.v2.run --module products
python -m scripts.pipeline.v2.run --module enrichment
python -m scripts.pipeline.v2.run --module facts
python -m scripts.pipeline.v2.run --module sales-intelligence

# Maintenance tasks
python -m scripts.pipeline.v2.run --module maintenance --source backfill_youtube_comments
python -m scripts.pipeline.v2.run --module maintenance --source backfill_athlete_names
python -m scripts.pipeline.v2.run --module maintenance --source count_rows
python -m scripts.pipeline.v2.run --module maintenance --source validate_data

# Options
python -m scripts.pipeline.v2.run --module all --dry-run        # log only, no API calls
python -m scripts.pipeline.v2.run --module all --restart        # ignore checkpoint, fresh start
python -m scripts.pipeline.v2.run --module instagram --brands joola,selkirk  # limit brands

# Scheduler (news every 6h, SEO every Monday 03:00 UTC)
python -m scripts.pipeline.v2.scheduler
```

## Architecture

```
v2/
├── run.py              CLI entry point
├── scheduler.py        APScheduler (news 6h, SEO weekly)
├── config/             YAML configs (brands, actors, defaults, sales sources)
├── core/               Shared infrastructure (clients, logging, checkpoints)
├── sources/            Scrapers by channel (instagram, youtube, reddit, twitter, tiktok, ads, products, news, seo)
├── enrichment/         AI enrichment (OpenAI GPT-4o-mini, 5 parallel workers)
├── facts/              mention_facts, topic_lifecycle, competitor_switch, ig_themes
├── sales_intelligence/ Inventory tracking, sales estimation, promo correlation
└── maintenance/        Backfills, validation, cleanup
```

## Task fixes included

| Task | Description |
|------|-------------|
| A | YouTube is_short flag (duration ≤ 60s or /shorts/ URL) |
| B | Instagram JOOLA brand reply detection → brand_replies table |
| C | TikTok AI enrichment (sentiment, topics, crisis) |
| D | X/Twitter AI enrichment |
| E | Reddit sentiment backfill |
| F | Influencer sponsorship detection (#ad, #sponsored) |
| G | Dominant Instagram content theme → ig_profiles_weekly |
| H | News scraping every 6 hours (APScheduler) |
| I | SEO scraping every Monday 03:00 UTC (APScheduler) |
| J | Athlete name normalization in ig_posts.athletes_shown |

## New DB tables (migration 010 + 011)

- `product_variants` — SKU-level variant tracking
- `product_snapshots` — inventory readings
- `inventory_events` — sale/restock/sellout events
- `sales_estimates` — estimated units sold from inventory delta
- `promotion_sales_impact` — promo → sales correlation
- `sales_facts_daily` — denormalised daily roll-up
- `brand_replies` — JOOLA complaint response tracking
- New columns on: `influencer_posts`, `yt_videos`, `ig_profiles_weekly`
