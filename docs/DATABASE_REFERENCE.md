# Database reference - JOOLA Intel (live introspection)

> **Generated**: 2026-09-12 - by introspecting the running Supabase project, not by reading migrations.
> **Project ref**: `loecyghnkkxyymelgexz` (`SUPABASE_URL` in `.env`)
> **Scope**: every relation exposed on the `public` schema - **138 relations, 2001 columns, 295,840 rows**.
> **Supersedes the inventory in** [DATABASE.md](DATABASE.md), which is a 2026-05-25 snapshot listing 56 tables and migrations 001-016. It is now missing 82 live relations and 10 migrations. Treat this file as the schema inventory and `DATABASE.md` as historical narrative.

---

## How this was produced (so you can reproduce or distrust it)

| Fact | Method | Accuracy |
|---|---|---|
| Relation list, column names, types, nullability, defaults, PK/FK | PostgREST OpenAPI document at `GET /rest/v1/` with the service-role key | exact |
| Row counts | `GET /rest/v1/<table>?limit=0` with `Prefer: count=exact` | exact at generation time |
| Date coverage (min/max) | `order=<col>.asc/desc&limit=1` per temporal column (223 columns) | exact |
| Null rate, distinct count, example values, numeric range | computed over a sample of **up to 800 rows per table** in physical order | **indicative, not exact** - a column shown as "always NULL" is always null *in the sample* |
| Relation kind (table vs materialized view), keys, indexes, constraints, seeds | read from `migrations/*.sql` | exact for the 60 relations whose DDL is tracked there; **unknown for the other 78** |
| Writers | read from `backend/scraping/**`, `analytics_backend/**`, `scripts/**` | exact |
| Readers | read from `frontend/**` | exact |

There is **no arbitrary-SQL path** to this database from the repo: `SUPABASE_DB_URL`/`SUPABASE_DB_PASSWORD` are not in `.env`, and the `exec_sql` RPC that `scripts/apply_migration.py` tries does not exist (404/PGRST202). Everything here came through PostgREST.

---

## 1. What this database is

One Postgres instance carrying **two unrelated products**:

1. **Brand intelligence** (128 relations) - a weekly competitive-intelligence pipeline for pickleball. It scrapes 11 brands across Instagram, YouTube, TikTok, X, Reddit, news, ad libraries and storefronts; enriches the text with OpenAI; folds everything into a cross-channel fact layer; then computes product-attention, inferred sales and statistical marts that the Next.js `/v2` dashboard reads.
2. **KPI & people app** (10 relations: `users`, `roles`, `regions`, `kpis`, `kpi_templates`, `kpi_contributors`, `kpi_number_sequences`, `approvals`, `notifications`, `audit_log`) - an employee KPI tracker. It shares nothing with the brand tables: no foreign key crosses between the two halves.

### The pipeline, end to end

```
 seed/config            raw capture                  enrichment              fact layer                 marts                    app
 -----------            -----------                  ----------              ----------                 -----                    ---
 brands            ->   ig_posts / ig_comments   ->   OpenAI writes      ->   mention_facts        ->    product_attention_*  ->  /v2/* pages
 ig_accounts            yt_videos / yt_comments       sentiment, topics,      product_mentions           ad_pressure_daily        (direct Supabase
 x_accounts             tiktok_videos/comments        brands_mentioned,       topic_lifecycle            promotion_daily           reads, anon key)
 tiktok_accounts        x_posts, reddit_mentions      products_mentioned,     competitor_switch_events   availability_daily
 yt_channels            reddit_comments               is_crisis,                                         joola_timeseries_daily
 influencers            influencer_posts              purchase_intent                                    joola_timeseries_weekly
 products_catalog       marketing_ads, promotions     *in place, on the                                  analysis_results
 product_aliases        products / product_variants    raw row*                                          (correlation, granger,
 fx_rates               product_snapshots                                                                changepoint)
 news_sources           news_articles, paddle_reviews
```

Stage order (`scripts/weekly_run.py` -> `backend/scraping/run.py`, then `analytics_backend/run.py`):

1. **scrape** (parallel): `instagram`, `youtube`, `reddit`, `twitter`, `tiktok`, `ads`, `products`, `news`, `seo`
2. **enrichment** (parallel): `ai_enricher`, `tiktok_enrichment`, `twitter_enrichment`, `reddit_backfill`, `influencer_sponsored`, `analyze_videos`
3. **facts**: `mention_facts` / `competitor_switch` / `instagram_themes` / `populate_product_mentions`, then `topic_lifecycle` / `populate_product_attention`
4. **sales-intelligence**: inventory scrape, then `estimate` / `restock` / `sellout` / `launches`, then `revenue` / `correlation`
5. **analytics marts**: `refresh_calendar` -> `refresh_helpers` -> `refresh_timeseries`
6. **analytics statistics**: `correlation_scan`, `cross_correlation`, `changepoints`, `granger`

Not part of `--module all` (manual cadence): `product-specs`, `reviews`, `reviews-crawl4ai`, `intelligence`, `maintenance`.

---

## 2. Conventions that hold across the schema

| Convention | Detail |
|---|---|
| **`brands.id` is the hub** | 71 of the 183 foreign keys point at `brands.id`. Almost every table is brand-scoped. |
| Surrogate keys | `uuid` PK named `id`, default `gen_random_uuid()` (KPI-app tables use `extensions.uuid_generate_v4()`). The exception is the daily marts (`ad_pressure_daily`, `promotion_daily`, `price_daily`, `availability_daily`), which use composite natural PKs. |
| Platform IDs are text | `instagram_post_id`, `tiktok_video_id`, `youtube_video_id`, `tweet_id`, `reddit_post_id`, `joola_ig_*.post_id` / `comment_id`. These are the upsert conflict targets - never the UUIDs. |
| Timestamps | `timestamptz` everywhere **except the entire `joola_ig_*` cluster**, which uses `timestamp without time zone`. Comparing across the two silently shifts by the session timezone. |
| Capture vs event time | `posted_at` / `published_at` / `occurred_at` = when the world produced it; `scraped_at` / `captured_at` / `first_scraped_at` = when we saw it; `enriched_at` / `analyzed_at` = when OpenAI processed it. Freshness checks use the capture column, analysis filters use `enriched_at`. |
| Inline enrichment block | `sentiment_score`, `sentiment_label`, `topics`, `brands_mentioned`, `players_mentioned`, `products_mentioned`, `is_crisis`, `is_opportunity`, `purchase_intent_score`, `crisis_keywords`, `enriched_at` - added by `migrations/006` to `reddit_mentions`, `ig_comments`, `yt_comments`, `x_posts`, `tiktok_videos` and later to more tables. The same idea also exists as separate `*_analysis` tables; those are all empty (see below). |
| Arrays vs JSONB | Short label lists are `text[]`; `topics` is `jsonb` on some tables and `text[]` on others - check per table before querying. Raw provider payloads are `jsonb` (`marketing_ads.raw`, `paddle_specs.raw_specs`, `product_snapshots.raw_payload`, `keywords.raw_payload`). |
| Sentiment scale | `sentiment_label` has five levels: `very_negative`, `negative`, `neutral`, `positive`, `very_positive`. `sentiment_score` is -1.0 .. 1.0. |
| Enum discipline | Only **5 CHECK constraints exist in the whole database** (`keyword_research_results.seed_type` - table since dropped, `ask_intel_qa_log.feedback`, `paddle_specs.source_confidence`, and two on `fx_rates`). Every other "enum" column is unconstrained `text` with the allowed values in a SQL comment. |
| No triggers, functions or RLS | `migrations/` contains zero `CREATE TRIGGER`, zero `CREATE FUNCTION`, zero `ENABLE ROW LEVEL SECURITY`, zero `CREATE POLICY`. `updated_at` columns are maintained by application code, not triggers. Access control is the anon key vs the service-role key, nothing more. |
| Dedupe archives | `*_dupe_archive` tables hold JSONB copies of rows deleted by de-duplication migrations. No PK, never read by the app. |

### Relation kinds

- **135 tables**
- **3 materialized views**: `dim_brand_calendar`, `joola_timeseries_daily`, `joola_timeseries_weekly` - refreshed by `analytics_backend/marts/refresh_timeseries.py` via `REFRESH MATERIALIZED VIEW [CONCURRENTLY]`. They are stale until that job runs; you cannot write to them.
- **0 plain views.**

---

## 3. Row census

138 relations, newest-first by domain. "Created in `migrations/`" = this relation's `CREATE TABLE` lives in version control. 78 relations are only *referenced* there or not at all - see finding 6.

| # | Relation | Rows | Domain | Created in `migrations/` | Written by |
|---|---|---|---|---|---|
| 1 | `brands` | 11 | Reference & scrape targets | no | manual seed (no Python writer) |
| 2 | `ig_accounts` | 11 | Reference & scrape targets | no | manual seed |
| 3 | `x_accounts` | 6 | Reference & scrape targets | yes | `migrations/003_x_tiktok.sql` seed |
| 4 | `tiktok_accounts` | 8 | Reference & scrape targets | yes | `migrations/003_x_tiktok.sql` seed |
| 5 | `yt_channels` | 9 | Reference & scrape targets | no | manual seed |
| 6 | `influencers` | 27 | Reference & scrape targets | no | manual seed; `x_handle` set by `migrations/005` |
| 7 | `products_catalog` | 86 | Reference & scrape targets | yes | `migrations/007` + `015` seed; images via `scripts/backfill_product_images.py` |
| 8 | `product_aliases` | 209 | Reference & scrape targets | yes | `migrations/012` / `021` derived seed from `products_catalog.aliases` |
| 9 | `fx_rates` | 1 | Reference & scrape targets | yes | `migrations/025` seed |
| 10 | `news_sources` | 20 | Reference & scrape targets | no | manual seed (not in `migrations/`) |
| 11 | `dim_brand_calendar` | 5,599 | Reference & scrape targets | MATERIALIZED VIEW | `analytics_backend/marts/refresh_calendar.py` |
| 12 | `ig_posts` | 1,147 | Instagram - competitor set | no | `instagram --source scrape-profiles` -> `sources/instagram/scrape_profiles.py` |
| 13 | `ig_comments` | 10,200 | Instagram - competitor set | no | `instagram --source scrape-comments` -> `sources/instagram/scrape_comments.py`; enriched by `enrichment/ai_enricher` |
| 14 | `ig_profiles_weekly` | 208 | Instagram - competitor set | no | `instagram --source scrape-profiles`; theme columns PATCHed by `facts/instagram_themes.py` |
| 15 | `ig_post_analysis` | 0 | Instagram - competitor set | no | nothing |
| 16 | `ig_comment_analysis` | 0 | Instagram - competitor set | no | nothing |
| 17 | `joola_ig_posts` | 614 | Instagram - JOOLA deep dive (`joola_ig_*`) | no | JOOLA-IG pipeline (outside `migrations/`) |
| 18 | `joola_ig_comments` | 13,782 | Instagram - JOOLA deep dive (`joola_ig_*`) | no | JOOLA-IG pipeline |
| 19 | `joola_ig_post_analysis` | 567 | Instagram - JOOLA deep dive (`joola_ig_*`) | no | JOOLA-IG pipeline (OpenAI) |
| 20 | `joola_ig_comment_analysis` | 13,415 | Instagram - JOOLA deep dive (`joola_ig_*`) | no | JOOLA-IG pipeline (OpenAI) |
| 21 | `joola_ig_loyal_users` | 7,054 | Instagram - JOOLA deep dive (`joola_ig_*`) | no | JOOLA-IG pipeline (computed) |
| 22 | `joola_ig_user_post_activity` | 10,700 | Instagram - JOOLA deep dive (`joola_ig_*`) | no | JOOLA-IG pipeline (computed) |
| 23 | `joola_ig_weekly_snapshot` | 56 | Instagram - JOOLA deep dive (`joola_ig_*`) | no | JOOLA-IG pipeline (computed) |
| 24 | `joola_ig_hashtag_performance` | 165 | Instagram - JOOLA deep dive (`joola_ig_*`) | no | JOOLA-IG pipeline (computed) |
| 25 | `joola_ig_athlete_mentions` | 88 | Instagram - JOOLA deep dive (`joola_ig_*`) | no | JOOLA-IG pipeline (OpenAI extraction) |
| 26 | `joola_ig_competitor_mentions` | 39 | Instagram - JOOLA deep dive (`joola_ig_*`) | no | JOOLA-IG pipeline (OpenAI extraction) |
| 27 | `joola_ig_product_mentions` | 158 | Instagram - JOOLA deep dive (`joola_ig_*`) | no | JOOLA-IG pipeline (OpenAI extraction) |
| 28 | `joola_ig_complaint_log` | 105 | Instagram - JOOLA deep dive (`joola_ig_*`) | no | JOOLA-IG pipeline (OpenAI extraction) |
| 29 | `joola_ig_wishlist_items` | 93 | Instagram - JOOLA deep dive (`joola_ig_*`) | no | JOOLA-IG pipeline (OpenAI extraction) |
| 30 | `joola_ig_joola_replies` | 0 | Instagram - JOOLA deep dive (`joola_ig_*`) | no | nothing |
| 31 | `joola_ig_generated_posts` | 2 | Instagram - JOOLA deep dive (`joola_ig_*`) | no | AI post generator (manual trigger) |
| 32 | `yt_videos` | 855 | YouTube | no | `youtube --source scrape-channels` -> `sources/youtube/scrape_channels.py` |
| 33 | `yt_comments` | 3,762 | YouTube | no | `youtube --source scrape-comments`; enriched by `enrichment/ai_enricher`; `brand_id` repaired by `sources/youtube/backfill_brand_id.py` |
| 34 | `yt_channel_weekly` | 139 | YouTube | no | `youtube --source scrape-channels` |
| 35 | `yt_video_transcripts` | 139 | YouTube | yes | `youtube --source scrape-transcripts` -> `sources/youtube/scrape_transcripts.py` |
| 36 | `yt_video_analysis` | 288 | YouTube | yes | `enrichment --source analyze-videos` -> `enrichment/analyze_videos.py` |
| 37 | `yt_comment_analysis` | 0 | YouTube | no | nothing |
| 38 | `tiktok_videos` | 1,427 | TikTok | yes | `tiktok --source scrape-videos` -> `sources/tiktok/scrape_videos.py`; enriched by `enrichment/tiktok_enrichment` |
| 39 | `tiktok_comments` | 1,021 | TikTok | yes | `tiktok --source scrape-comments` -> `sources/tiktok/scrape_comments.py`; enriched by `enrichment` |
| 40 | `tiktok_profiles_weekly` | 136 | TikTok | yes | `tiktok --source scrape-videos` |
| 41 | `x_posts` | 483 | X / Twitter | yes | `twitter --source scrape-brand-posts` -> `sources/twitter/scrape_brand_posts.py`; enriched by `enrichment/twitter_enrichment` |
| 42 | `x_replies` | 4 | X / Twitter | no | one-off script (not in the weekly pipeline) |
| 43 | `x_profiles_weekly` | 84 | X / Twitter | yes | `twitter --source scrape-brand-posts` |
| 44 | `reddit_mentions` | 1,218 | Reddit | yes | `reddit --source scrape-mentions` -> `sources/reddit/scrape_mentions.py`; enriched by `enrichment/ai_enricher` + `reddit_backfill` |
| 45 | `reddit_comments` | 2,849 | Reddit | yes | `reddit --source scrape-comments` -> `sources/reddit/scrape_comments.py`; enriched by `enrichment` |
| 46 | `influencer_posts` | 841 | Influencers & athletes | yes | `instagram --source scrape-influencers` -> `sources/instagram/scrape_influencers.py`; sponsored flag by `enrichment/influencer_sponsored.py` |
| 47 | `influencer_snapshots` | 486 | Influencers & athletes | no | `instagram --source scrape-influencers` |
| 48 | `influencer_x_posts` | 749 | Influencers & athletes | yes | `twitter --source scrape-influencer-posts` -> `sources/twitter/scrape_influencer_posts.py`; enriched by `enrichment/ai_enricher` |
| 49 | `influencer_x_snapshots` | 13 | Influencers & athletes | yes | `twitter --source scrape-influencer-posts` |
| 50 | `news_articles` | 1,280 | News & market intel | no | `news` -> `sources/news/scrape_news.py` |
| 51 | `news_mentions` | 0 | News & market intel | no | nothing |
| 52 | `news_scrape_runs` | 5 | News & market intel | no | `sources/news/scrape_news.py` |
| 53 | `news_scrape_errors` | 0 | News & market intel | no | `sources/news/scrape_news.py` (on failure) |
| 54 | `market_intel_items` | 324 | News & market intel | no | market-intel collector (frozen since Apr 2026) |
| 55 | `market_trends` | 8 | News & market intel | no | market-intel collector |
| 56 | `brand_mentions_external` | 46 | News & market intel | no | market-intel collector (derived from `market_intel_items`) |
| 57 | `marketing_ads` | 1,606 | Ads & promotions | yes | `ads --source scrape-meta-ads` + `scrape-google-ads` -> `sources/ads/*.py` |
| 58 | `ad_pressure_daily` | 1,613 | Ads & promotions | yes | `analytics` -> `analytics_backend/marts/refresh_helpers.py` |
| 59 | `promotions` | 66 | Ads & promotions | yes | `products --source scrape-promotions` -> `sources/products/scrape_promotions.py` |
| 60 | `promotion_daily` | 14 | Ads & promotions | yes | `analytics` -> `marts/refresh_helpers.py` |
| 61 | `promotion_sales_impact` | 0 | Ads & promotions | yes | `sales-intelligence --source correlation` (never produced rows) |
| 62 | `products` | 468 | Catalogue, pricing & reviews | yes | `products --source scrape-catalog` / `scrape-catalog-local` -> `sources/products/scrape_catalog*.py` |
| 63 | `product_variants` | 9,317 | Catalogue, pricing & reviews | yes | `sales-intelligence` -> `sales_intelligence/scrape_inventory_crawl4ai.py` |
| 64 | `product_snapshots` | 38,058 | Catalogue, pricing & reviews | yes | `sales-intelligence` -> `scrape_inventory_crawl4ai.py`; pruned by `maintenance/cleanup.py` |
| 65 | `price_daily` | 0 | Catalogue, pricing & reviews | yes | `analytics` -> `marts/refresh_helpers.py` (source table empty, so no rows) |
| 66 | `product_price_history` | 0 | Catalogue, pricing & reviews | yes | nothing |
| 67 | `availability_daily` | 359 | Catalogue, pricing & reviews | yes | `analytics` -> `marts/refresh_helpers.py` |
| 68 | `paddle_products` | 702 | Catalogue, pricing & reviews | no | paddle review/spec harvester (outside `migrations/`) |
| 69 | `paddle_reviews` | 26,888 | Catalogue, pricing & reviews | no | paddle review harvester (Okendo/Judge.me/Yotpo/Bazaarvoice) |
| 70 | `paddle_specs` | 184 | Catalogue, pricing & reviews | yes | `product-specs` -> `sources/products/scrape_specs.py` |
| 71 | `paddle_review_runs` | 10 | Catalogue, pricing & reviews | no | paddle review harvester |
| 72 | `paddle_review_errors` | 16 | Catalogue, pricing & reviews | no | paddle review harvester (on failure) |
| 73 | `product_reviews` | 0 | Catalogue, pricing & reviews | yes | `reviews` -> `sources/products/scrape_reviews.py` (never produced rows) |
| 74 | `mention_facts` | 48,239 | Cross-channel fact layer | yes | `facts --source mention-facts` -> `facts/mention_facts.py` |
| 75 | `product_mentions` | 1,568 | Cross-channel fact layer | yes | `facts --source populate-product-mentions` -> `facts/populate_product_mentions.py` |
| 76 | `topic_lifecycle` | 62,453 | Cross-channel fact layer | yes | `facts --source topic-lifecycle` -> `facts/topic_lifecycle.py` |
| 77 | `competitor_switch_events` | 114 | Cross-channel fact layer | yes | `facts` - two writers: `facts/mention_facts.py` and `facts/competitor_switch.py` |
| 78 | `product_attention_daily` | 619 | Cross-channel fact layer | yes | `facts --source populate-product-attention` -> `facts/populate_product_attention.py` |
| 79 | `product_attention_summary` | 212 | Cross-channel fact layer | yes | same file as `product_attention_daily` |
| 80 | `product_attention_sales_correlation` | 0 | Cross-channel fact layer | yes | nothing |
| 81 | `inventory_events` | 10,710 | Sales intelligence (inferred) | yes | `sales-intelligence` -> `sales_intelligence/estimate.py`, `sellout.py`, `launches.py` |
| 82 | `sales_estimates` | 24 | Sales intelligence (inferred) | yes | `sales-intelligence --source estimate` -> `sales_intelligence/estimate.py` |
| 83 | `sales_facts_daily` | 16 | Sales intelligence (inferred) | yes | `sales-intelligence --source revenue` -> `sales_intelligence/revenue.py` |
| 84 | `joola_timeseries_daily` | 5,619 | Analytics & statistics marts | MATERIALIZED VIEW | `analytics` -> `marts/refresh_timeseries.py` |
| 85 | `joola_timeseries_weekly` | 870 | Analytics & statistics marts | MATERIALIZED VIEW | `analytics` -> `marts/refresh_timeseries.py` |
| 86 | `composite_scores_weekly` | 26 | Analytics & statistics marts | no | analytics statistics layer |
| 87 | `analysis_results` | 645 | Analytics & statistics marts | yes | `analytics` statistics -> `correlation_scan.py`, `cross_correlation.py`, `changepoints.py`, `granger.py` |
| 88 | `analytics_runs` | 25 | Analytics & statistics marts | no | `analytics_backend/run.py` |
| 89 | `correlation_results` | 45 | Analytics & statistics marts | no | analytics statistics layer |
| 90 | `granger_results` | 36 | Analytics & statistics marts | no | analytics statistics layer |
| 91 | `changepoint_results` | 29 | Analytics & statistics marts | no | analytics statistics layer |
| 92 | `forecast_results` | 0 | Analytics & statistics marts | no | nothing |
| 93 | `its_results` | 0 | Analytics & statistics marts | no | nothing |
| 94 | `causal_events` | 4 | Analytics & statistics marts | no | manual curation |
| 95 | `ai_narratives` | 1 | Analytics & statistics marts | no | analytics narrative step |
| 96 | `brand_comparison_runs` | 8 | Brand comparison runs | no | brand-comparison API route (UI-triggered) |
| 97 | `brand_comparison_metrics` | 400 | Brand comparison runs | no | brand-comparison API route |
| 98 | `brand_comparison_products` | 405 | Brand comparison runs | no | brand-comparison API route |
| 99 | `brand_comparison_discrepancies` | 10 | Brand comparison runs | no | brand-comparison API route |
| 100 | `runs` | 8 | SEO & site audit | no | `seo` module / SEO worker |
| 101 | `seo_sweeps` | 2 | SEO & site audit | no | SEO sweep worker |
| 102 | `seo_brand_metrics` | 24 | SEO & site audit | no | SEO sweep worker |
| 103 | `seo_provider_calls` | 2 | SEO & site audit | no | SEO sweep worker |
| 104 | `pages` | 2 | SEO & site audit | no | SEO crawler |
| 105 | `issues` | 4 | SEO & site audit | no | SEO rule engine |
| 106 | `keywords` | 144 | SEO & site audit | no | SEO keyword worker (DataForSEO) |
| 107 | `domain_ranked_keywords` | 2,000 | SEO & site audit | no | SEO worker (Semrush / DataForSEO) |
| 108 | `competitor_domains` | 70 | SEO & site audit | no | SEO worker |
| 109 | `serp_results` | 10 | SEO & site audit | no | DataForSEO worker (external) |
| 110 | `entities` | 24 | SEO & site audit | no | SEO AI entity extraction |
| 111 | `backlinks_summary` | 0 | SEO & site audit | no | nothing |
| 112 | `gap_analyses` | 0 | SEO & site audit | no | nothing |
| 113 | `performance_cache` | 0 | SEO & site audit | no | nothing |
| 114 | `jobs` | 0 | SEO & site audit | no | nothing |
| 115 | `integrations` | 0 | SEO & site audit | no | nothing |
| 116 | `content_drafts` | 409 | Content studio | no | content-studio API route (OpenAI) |
| 117 | `content_generation_runs` | 661 | Content studio | no | content-studio API route |
| 118 | `content_templates` | 6 | Content studio | no | manual seed |
| 119 | `content_brand_voice` | 1 | Content studio | no | manual seed |
| 120 | `content_calendar` | 0 | Content studio | no | nothing |
| 121 | `generated_content` | 4 | Content studio | no | `frontend/app/api/generate-content/route.ts` |
| 122 | `writer_examples` | 104 | Content studio | no | blog scraper (manual cadence) |
| 123 | `brand_replies` | 4 | Content studio | yes | `instagram --source detect-brand-replies` -> `sources/instagram/detect_brand_replies.py` |
| 124 | `users` | 6 | KPI & people app | no | KPI app (Supabase Auth + admin UI) |
| 125 | `roles` | 5 | KPI & people app | no | KPI app seed |
| 126 | `regions` | 5 | KPI & people app | no | KPI app seed |
| 127 | `kpis` | 19 | KPI & people app | no | KPI app |
| 128 | `kpi_templates` | 3 | KPI & people app | no | KPI app |
| 129 | `kpi_contributors` | 0 | KPI & people app | no | KPI app (unused) |
| 130 | `kpi_number_sequences` | 6 | KPI & people app | no | KPI app number allocator |
| 131 | `approvals` | 0 | KPI & people app | no | KPI app (unused) |
| 132 | `notifications` | 0 | KPI & people app | no | KPI app (unused) |
| 133 | `audit_log` | 0 | KPI & people app | no | nothing |
| 134 | `weekly_run_log` | 2 | Ops, logs & archives | no | legacy weekly runner (stopped writing after Apr 2026) |
| 135 | `ask_intel_qa_log` | 0 | Ops, logs & archives | yes | `frontend/app/api/v2/ask-intel/route.ts` (insert) + `.../feedback/route.ts` (update) |
| 136 | `products_dupe_archive` | 13 | Ops, logs & archives | yes | `migrations/008` |
| 137 | `influencer_posts_dupe_archive` | 327 | Ops, logs & archives | yes | `migrations/004` |
| 138 | `reddit_mentions_dupe_archive` | 59 | Ops, logs & archives | yes | `migrations/004` |

**24 relations are empty.** They fall into three groups, and the distinction matters:

- *Superseded designs* - a newer table does the job: `ig_post_analysis`, `ig_comment_analysis`, `yt_comment_analysis`, `joola_ig_joola_replies`, `news_mentions`, `product_reviews`, `product_price_history`, `content_calendar`.
- *Deferred by design* - schema shipped, population waiting on data volume: `product_attention_sales_correlation`, `promotion_sales_impact`, `price_daily`, `forecast_results`, `its_results`, `gap_analyses`, `backlinks_summary`.
- *Wired but silent* - something should be writing here and isn't: `ask_intel_qa_log` (Ask Intel telemetry), `audit_log` (KPI change trail), `approvals`, `notifications`, `kpi_contributors`, `jobs`, `performance_cache`, `integrations`.

Full list: `approvals`, `ask_intel_qa_log`, `audit_log`, `backlinks_summary`, `content_calendar`, `forecast_results`, `gap_analyses`, `ig_comment_analysis`, `ig_post_analysis`, `integrations`, `its_results`, `jobs`, `joola_ig_joola_replies`, `kpi_contributors`, `news_mentions`, `news_scrape_errors`, `notifications`, `performance_cache`, `price_daily`, `product_attention_sales_correlation`, `product_price_history`, `product_reviews`, `promotion_sales_impact`, `yt_comment_analysis`.

---

## 4. How the tables connect

183 foreign keys. Four join patterns cover nearly all of them.

**a) Brand fan-out.** `brands.id` <- 71 foreign keys from ~70 tables. Every dashboard query starts here.

```
brands.id <-- ig_posts.brand_id, ig_comments.brand_id, yt_videos.brand_id, tiktok_videos.brand_id,
              x_posts.brand_id, reddit_mentions.brand_id, marketing_ads.brand_id, products.brand_id,
              mention_facts.brand_id, product_mentions.brand_id, topic_lifecycle.brand_id, ... (+60 more)
```

**b) Account -> content -> comment chains.** One per platform:

```
ig_accounts      -> ig_posts      -> ig_comments      (+ ig_profiles_weekly off the account)
yt_channels      -> yt_videos     -> yt_comments      (+ yt_video_transcripts, yt_video_analysis, yt_channel_weekly)
tiktok_accounts  -> tiktok_videos -> tiktok_comments  (+ tiktok_profiles_weekly)
x_accounts       -> x_posts       -> x_replies        (+ x_profiles_weekly)
reddit_mentions  -> reddit_comments                   (FK exists but is ~99% NULL - see the table notes)
influencers      -> influencer_posts / influencer_x_posts / influencer_snapshots / influencer_x_snapshots
```

**c) Product attribution chain.** The spine of product analytics:

```
products_catalog.id
  <- product_aliases.product_id        (alias dictionary used by the matcher)
  <- product_mentions.product_id       (one row per source row x matched product)
  <- product_attention_daily.product_id
  <- product_attention_summary.product_id
  <- mention_facts.product_id
  <- product_variants.product_id, product_snapshots.product_id, availability_daily.product_id
  <- joola_timeseries_daily.canonical_product_id, joola_timeseries_weekly.canonical_product_id
```

`products` (raw scraped listings) and `paddle_products` (retailer listings) are **separate** from `products_catalog` (curated dictionary). Only `product_price_history` points at `products`; `paddle_reviews.product_id` points at `paddle_products`. Do not join `products.id` to anything expecting catalogue semantics.

**d) Run-header -> detail.** Every batch job writes a header row plus children:

```
runs           -> pages, issues, keywords, domain_ranked_keywords, competitor_domains, serp_results, entities, jobs
seo_sweeps     -> runs, seo_brand_metrics, seo_provider_calls
analytics_runs -> correlation_results, granger_results, changepoint_results, forecast_results, its_results
paddle_review_runs    -> paddle_review_errors
news_scrape_runs      -> news_scrape_errors
brand_comparison_runs -> brand_comparison_metrics, brand_comparison_products, brand_comparison_discrepancies
```

**Polymorphic links that are not foreign keys** - these carry a table name in a text column and a UUID with no constraint, so nothing enforces them and `JOIN` needs a `WHERE source_table = ...`:

| Table | Columns | Points at |
|---|---|---|
| `mention_facts` | `source_table` + `source_id` | any raw channel table |
| `product_mentions` | `source_table` + `source_row_id` | any raw channel table |
| `brand_replies` | `source_table` + `source_row_id` | `ig_comments` / `yt_comments` / `reddit_comments` |
| `competitor_switch_events` | `source_mention_id` | `mention_facts.id` (parallel to the real `mention_id` FK) |

The KPI app has its own closed graph: `users` -> `regions`, `roles`, self-referencing `manager_id`; `kpis` -> `users`, `regions`, self-referencing `parent_id`; `approvals`, `kpi_contributors`, `notifications`, `audit_log` -> `users`/`kpis`.

---

## 5. Table-by-table reference

Every relation, every column. Column order is the physical order. "What's in it" is measured from the live sample described in the methodology table - distinct counts marked `+` hit the 800-row sampling ceiling.


### Reference & scrape targets

Seeded config. Everything else hangs off `brands`; the account tables are the roster the scrapers read before they run.

#### `brands`

The 11 tracked pickleball brands - JOOLA plus 10 competitors. This is the hub of the entire schema: 71 foreign keys across ~70 tables point here. Also holds the matching keys the scrapers use: `amazon_brand_name` for retail lookups and `reddit_keywords` for organic search.

| | |
|---|---|
| **Rows** | 11 |
| **Grain** | one row per tracked brand |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | manual seed (no Python writer) - read-only |
| **Read by** | every `/v2/*` page via `frontend/lib/v2/data.ts` (`fetchBrands`) |
| **Referenced by** | `ad_pressure_daily.brand_id`, `analysis_results.brand_id`, `availability_daily.brand_id`, `backlinks_summary.brand_id`, `brand_comparison_discrepancies.brand_id`, `brand_comparison_metrics.brand_id`, `brand_comparison_products.brand_id`, `brand_comparison_runs.brand_a_id`, `brand_comparison_runs.brand_b_id`, `brand_mentions_external.brand_id`, `brand_replies.replying_brand_id`, `competitor_domains.brand_id`, `competitor_switch_events.from_brand_id`, `competitor_switch_events.to_brand_id`, `domain_ranked_keywords.brand_id`, `entities.brand_id`, `gap_analyses.brand_id`, `ig_accounts.brand_id`, `ig_comments.brand_id`, `ig_posts.brand_id`, `ig_profiles_weekly.brand_id`, `influencer_posts.brand_id`, `influencer_snapshots.brand_id`, `influencer_x_posts.brand_id`, `influencer_x_snapshots.brand_id`, `influencers.brand_id`, `inventory_events.brand_id`, `issues.brand_id`, `jobs.brand_id`, `keywords.brand_id`, `marketing_ads.brand_id`, `mention_facts.brand_id`, `news_mentions.brand_id`, `paddle_specs.brand_id`, `pages.brand_id`, `product_aliases.brand_id`, `product_attention_daily.brand_id`, `product_attention_sales_correlation.brand_id`, `product_attention_summary.brand_id`, `product_mentions.brand_id`, `product_price_history.brand_id`, `product_reviews.brand_id`, `product_snapshots.brand_id`, `product_variants.brand_id`, `products.brand_id`, `products_catalog.brand_id`, `promotion_daily.brand_id`, `promotion_sales_impact.brand_id`, `promotions.brand_id`, `reddit_comments.brand_id`, `reddit_mentions.brand_id`, `runs.brand_id`, `sales_estimates.brand_id`, `sales_facts_daily.brand_id`, `seo_brand_metrics.brand_id`, `seo_provider_calls.brand_id`, `serp_results.brand_id`, `tiktok_accounts.brand_id`, `tiktok_comments.brand_id`, `tiktok_profiles_weekly.brand_id`, `tiktok_videos.brand_id`, `topic_lifecycle.brand_id`, `x_accounts.brand_id`, `x_posts.brand_id`, `x_profiles_weekly.brand_id`, `yt_channel_weekly.brand_id`, `yt_channels.brand_id`, `yt_comments.brand_id`, `yt_video_analysis.brand_id`, `yt_video_transcripts.brand_id`, `yt_videos.brand_id` |
| **Date coverage** | `created_at` 2026-04-03 -> 2026-04-03 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 11 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `f15b6f97-2390-49e2-92f5-b3868e31da09` |  |
| `name` | text | NOT NULL |  | 11 distinct; e.g. `JOOLA`, `Selkirk Sport`, `Paddletek` |  |
| `slug` | text | NOT NULL |  | 11 distinct; e.g. `joola`, `selkirk`, `paddletek` | Stable key used across the frontend; `displayBrandName()` overrides the label for franklin. |
| `website_url` | text | no |  | 11 distinct; e.g. `https://joola.com`, `https://selkirk.com`, `https://paddletek.com` |  |
| `headquarters` | text | no |  | 10 distinct; e.g. `USA`, `Gaithersburg, MD`, `Hayden, ID` |  |
| `founded_year` | integer | no |  | 11 distinct; range 1913 .. 2021; e.g. `1952`, `2014`, `2010` |  |
| `amazon_brand_name` | text | no |  | 11 distinct; e.g. `JOOLA Pickleball`, `Selkirk Sport`, `Paddletek` | Retail-side brand string used for marketplace matching. |
| `reddit_keywords` | text[] | no |  | 11 distinct; e.g. `["joola", "joola pickleball", "joola paddle"]`, `["selkirk", "selkirk sport", "selkirk paddle",...`, `["paddletek", "paddletek paddle"]` | Search terms the Reddit scraper uses for this brand. Editing this changes what gets scraped. |
| `is_joola` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` | True for exactly one row - the flag every 'us vs them' query pivots on. |
| `is_active` | boolean <br>`= True` | no |  | 1 distinct; e.g. `True` |  |
| `country_code` | text <br>`= US` | no |  | 1 distinct; e.g. `US` |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 1 distinct; e.g. `2026-04-03T02:59:40.068672+00:00` |  |
| `timezone` | text <br>`= UTC` | no |  | 2 distinct; e.g. `America/New_York`, `Australia/Sydney` | Only two values live: America/New_York and Australia/Sydney (Six Zero). Drives `dim_brand_calendar`. |

#### `ig_accounts`

Instagram handles the scraper should visit, one per brand. Changing what gets scraped means editing this table, never the Python.

| | |
|---|---|
| **Rows** | 11 |
| **Grain** | one row per brand Instagram account |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | manual seed - read-only |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `brand_id` -> `brands.id` |
| **Referenced by** | `ig_posts.account_id`, `ig_profiles_weekly.account_id` |
| **Date coverage** | `added_at` 2026-04-03 -> 2026-04-03 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 11 distinct; e.g. `0a5a8781-9142-44d5-8b9e-f4a4c298d08c`, `78c5f650-4885-41f5-afd8-97206c1e4239`, `d4747a67-7dee-40fc-a2ce-931e0a87bc70` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 11 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `f9acc948-f636-4582-a7eb-c98e630fb5cd`, `f8cb05a4-4de3-41a5-9c52-1ee7f5443926` |  |
| `handle` | text | NOT NULL |  | 11 distinct; e.g. `joolapickleball`, `crbnpickleball`, `sixzeropickleball` |  |
| `region` | text <br>`= USA` | no |  | 1 distinct; e.g. `USA` |  |
| `country_code` | text <br>`= US` | no |  | 1 distinct; e.g. `US` |  |
| `is_primary` | boolean <br>`= True` | no |  | 1 distinct; e.g. `True` |  |
| `is_active` | boolean <br>`= True` | no |  | 1 distinct; e.g. `True` |  |
| `added_at` | timestamp with time zone <br>`= now()` | no |  | 1 distinct; e.g. `2026-04-03T02:59:40.270751+00:00` |  |

#### `x_accounts`

X/Twitter handles to scrape. Only 6 of 11 brands have an active X presence worth tracking.

| | |
|---|---|
| **Rows** | 6 |
| **Grain** | one row per brand X account |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(brand_id)` - one X account per brand |
| **Written by** | `migrations/003_x_tiktok.sql` seed - read-only |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `brand_id` -> `brands.id` |
| **Referenced by** | `x_posts.account_id`, `x_profiles_weekly.account_id` |
| **Date coverage** | `created_at` 2026-05-19 -> 2026-05-24 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 6 distinct; e.g. `716c41b5-5d2c-48c4-949e-6d07ac14b8dc`, `77f015a0-97a0-42cf-875d-828535ffa866`, `6d14bfcf-d7ae-4bf6-a857-3c0757ba4447` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 6 distinct; e.g. `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `f15b6f97-2390-49e2-92f5-b3868e31da09`, `238c76d9-cd72-4632-adac-42e459beab92` |  |
| `handle` | text | NOT NULL |  | 6 distinct; e.g. `SelkirkSport`, `PaddletekLLC`, `OnixPickleball` |  |
| `profile_url` | text | no |  | 6 distinct; e.g. `https://x.com/SelkirkSport`, `https://x.com/PaddletekLLC`, `https://x.com/OnixPickleball` |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 3 distinct; e.g. `2026-05-19T02:24:47.592654+00:00`, `2026-05-24T00:34:31.378712+00:00`, `2026-05-24T00:40:38.248354+00:00` |  |

#### `tiktok_accounts`

TikTok handles to scrape (8 brands).

| | |
|---|---|
| **Rows** | 8 |
| **Grain** | one row per brand TikTok account |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(brand_id)` |
| **Written by** | `migrations/003_x_tiktok.sql` seed - read-only |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `brand_id` -> `brands.id` |
| **Referenced by** | `tiktok_profiles_weekly.account_id`, `tiktok_videos.account_id` |
| **Date coverage** | `created_at` 2026-05-19 -> 2026-05-19 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 8 distinct; e.g. `c821951e-287b-4438-8bfa-c3c55fe2c878`, `697431d0-a16f-4e95-a4a7-1feed990f9fc`, `bf1ae3f9-226e-4f6f-a01f-34bf36db3a20` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 8 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `f9acc948-f636-4582-a7eb-c98e630fb5cd` |  |
| `handle` | text | NOT NULL |  | 8 distinct; e.g. `joolapickleball`, `selkirksport`, `crbnpickleball` |  |
| `profile_url` | text | no |  | 8 distinct; e.g. `https://www.tiktok.com/@joolapickleball`, `https://www.tiktok.com/@selkirksport`, `https://www.tiktok.com/@crbnpickleball` |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 1 distinct; e.g. `2026-05-19T02:24:47.592654+00:00` |  |

#### `yt_channels`

YouTube channels to scrape. `channel_id` was never backfilled - the scraper resolves by `channel_url`.

| | |
|---|---|
| **Rows** | 9 |
| **Grain** | one row per brand YouTube channel |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | manual seed - read-only |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `brand_id` -> `brands.id` |
| **Referenced by** | `yt_channel_weekly.channel_id`, `yt_videos.channel_id` |
| **Date coverage** | `added_at` 2026-04-03 -> 2026-04-03 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 9 distinct; e.g. `4bcfa712-9622-4457-b231-20ae81f3d4c3`, `34cb003c-0050-45c0-8c3e-e17a77349007`, `f277978b-c053-453c-bf8b-b39c71ea24ba` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 9 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `f15b6f97-2390-49e2-92f5-b3868e31da09` |  |
| `channel_id` | text | 100% |  | **always NULL** in the sampled rows | Null for every row - YouTube's own channel id was never resolved; join by `channel_url`. |
| `channel_name` | text | no |  | 9 distinct; e.g. `JOOLA Pickleball`, `Selkirk Sport`, `Paddletek Pickleball` |  |
| `channel_url` | text | no |  | 9 distinct; e.g. `https://www.youtube.com/@joolapickleball`, `https://www.youtube.com/@SelkirkSport`, `https://www.youtube.com/@paddletek` |  |
| `region` | text <br>`= USA` | no |  | 1 distinct; e.g. `USA` |  |
| `country_code` | text <br>`= US` | no |  | 1 distinct; e.g. `US` |  |
| `is_primary` | boolean <br>`= True` | no |  | 1 distinct; e.g. `True` |  |
| `is_active` | boolean <br>`= True` | no |  | 1 distinct; e.g. `True` |  |
| `added_at` | timestamp with time zone <br>`= now()` | no |  | 1 distinct; e.g. `2026-04-03T02:59:40.465192+00:00` |  |

#### `influencers`

The sponsored-athlete roster across all brands (Ben Johns, Anna Bright, Tyson McGuffin ...), with per-platform handles. Drives athlete-level tracking and is also the lookup for `mention_facts.athlete_id`.

| | |
|---|---|
| **Rows** | 27 |
| **Grain** | one row per athlete/influencer |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | manual seed; `x_handle` set by `migrations/005` - read-only |
| **Read by** | `/v2/influencers`, `/v2/overview`, `/v2/product-intel` |
| **Foreign keys out** | `brand_id` -> `brands.id` |
| **Referenced by** | `influencer_posts.influencer_id`, `influencer_snapshots.influencer_id`, `influencer_x_posts.influencer_id`, `influencer_x_snapshots.influencer_id`, `mention_facts.athlete_id` |
| **Date coverage** | `added_at` 2026-04-03 -> 2026-04-03 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 27 distinct; e.g. `db4b18f4-da4b-49fd-a1e8-64b52ea8ae3b`, `9a925fc4-d080-4b40-a566-4de9be16f1b9`, `1eb20d81-3dff-4fcb-ab0f-be93768af354` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 11 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `f15b6f97-2390-49e2-92f5-b3868e31da09`, `f9acc948-f636-4582-a7eb-c98e630fb5cd` |  |
| `name` | text | NOT NULL |  | 27 distinct; e.g. `Ben Johns`, `Anna Bright`, `Tyson McGuffin` |  |
| `type` | text | no |  | 1 distinct; e.g. `Pro Athlete` | Every row is 'Pro Athlete' today. |
| `instagram_handle` | text | no |  | 27 distinct; e.g. `benjohns_pb`, `annabright.pb`, `tysonmcguffin` |  |
| `youtube_channel_url` | text | 93% |  | 2 distinct; e.g. `https://youtube.com/@benjohnspb`, `https://youtube.com/@annaleighwaters` |  |
| `tiktok_handle` | text | 89% |  | 3 distinct; e.g. `benjohns.pb`, `annabright.pb`, `tysonmcguffinpb` |  |
| `follower_count_ig` | integer | no |  | 13 distinct; range 0 .. 207,261; e.g. `0`, `175785`, `111788` |  |
| `follower_count_yt` | integer | 100% |  | **always NULL** in the sampled rows | Never populated. |
| `country_code` | text <br>`= US` | no |  | 1 distinct; e.g. `US` |  |
| `contract_type` | text | no |  | 2 distinct; e.g. `Sponsored`, `Former Sponsor` | Sponsored vs Former Sponsor - the only churn signal on the roster. |
| `is_active` | boolean <br>`= True` | no |  | 2 distinct; e.g. `True`, `False` |  |
| `added_at` | timestamp with time zone <br>`= now()` | no |  | 1 distinct; e.g. `2026-04-03T04:07:35.710188+00:00` |  |
| `x_handle` | text | 26% |  | 20 distinct; e.g. `BenJohns_pb`, `AnnaBright`, `TysonMcGuffin` |  |

#### `products_catalog`

The canonical product dictionary - the spine of all product attribution. 86 curated paddles with a stable SKU, display name and alias array. Free-text mentions anywhere in the pipeline resolve to a row here.

| | |
|---|---|
| **Rows** | 86 |
| **Grain** | one row per canonical product |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(brand_id, sku)` |
| **Written by** | `migrations/007` + `015` seed; images via `scripts/backfill_product_images.py` - seed + PATCH |
| **Read by** | `/v2/product-intel`, `/v2/sales-intel`, `/v2/influencers`, `/v2/market`, `/v2/correlations`, `/v2/changepoints` |
| **Foreign keys out** | `brand_id` -> `brands.id` |
| **Referenced by** | `analysis_results.product_id`, `availability_daily.product_id`, `inventory_events.product_id`, `joola_timeseries_daily.canonical_product_id`, `joola_timeseries_weekly.canonical_product_id`, `mention_facts.product_id`, `price_daily.product_id`, `product_aliases.product_id`, `product_attention_daily.product_id`, `product_attention_sales_correlation.product_id`, `product_attention_summary.product_id`, `product_mentions.product_id`, `product_reviews.product_id`, `product_snapshots.product_id`, `product_variants.product_id`, `promotion_daily.product_id`, `promotion_sales_impact.product_id`, `sales_estimates.product_id`, `sales_facts_daily.product_id` |
| **Date coverage** | `created_at` 2026-05-19 -> 2026-05-25 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 86 distinct; e.g. `a24fdd68-ab97-4716-a443-c3811d2c92d3`, `a455badf-5a2a-40da-96a8-592ef8c9418d`, `18f5e252-ffb0-45f3-8e1c-2d35d4d7c1d2` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 11 distinct; e.g. `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `04db8591-37a3-4634-9d11-536975fa6935`, `f8cb05a4-4de3-41a5-9c52-1ee7f5443926` |  |
| `sku` | text | NOT NULL |  | 86 distinct; e.g. `SOLAIRE`, `CRBN_1`, `CRBN_3` | Internal uppercase key (e.g. `SOLAIRE_CFS_16`), not a retailer SKU. |
| `display_name` | text | no |  | 86 distinct; e.g. `Solaire`, `CRBN-1`, `CRBN-3` |  |
| `aliases` | text[] | no |  | 86 distinct; e.g. `["Solaire"]`, `["CRBN-1", "CRBN 1"]`, `["CRBN-3", "CRBN 3", "CRBN3"]` | Array of spellings; exploded into `product_aliases` for matching. |
| `category` | text | no |  | 1 distinct; e.g. `paddle` |  |
| `is_active` | boolean <br>`= True` | no |  | 1 distinct; e.g. `True` |  |
| `launched_at` | date | 100% |  | **always NULL** in the sampled rows |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 2 distinct; e.g. `2026-05-25T01:43:56.168765+00:00`, `2026-05-19T03:57:33.093834+00:00` |  |
| `image_url` | text | 27% |  | 52 distinct; e.g. `https://cdn.shopify.com/s/files/1/0481/9828/75...`, `https://mcprod.head.com/media/wysiwyg/head-wis...`, `https://cdn.shopify.com/s/files/1/0152/5763/28...` |  |

#### `product_aliases`

Exploded, normalised alias index for `products_catalog` (one row per spelling). Used by the mention matcher so 'Power Air', 'Vanguard Power' and 'Vanguard Power Air' all land on one product.

| | |
|---|---|
| **Rows** | 209 |
| **Grain** | one row per (product, alias spelling) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(alias_norm, product_id)` |
| **Written by** | `migrations/012` / `021` derived seed from `products_catalog.aliases` - seed |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `product_id` -> `products_catalog.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `created_at` 2026-06-28 -> 2026-06-28 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 209 distinct; e.g. `5d1018da-14ce-4a03-8bc0-7785257cdc9f`, `d60c2d48-66dc-4c3f-bd29-70c90b88be60`, `ef9ce97f-8c78-4de3-819d-55777c578328` |  |
| `product_id` | uuid | NOT NULL | FK -> `products_catalog.id` | 86 distinct; e.g. `2aa948c3-cebe-4b1b-95ef-2dfb6cd7a9cf`, `46f13c22-53fa-4f0c-b648-d154d6efcd2b`, `695bfc79-11a3-46f2-b789-c2ee148b5358` |  |
| `brand_id` | uuid | NOT NULL | FK -> `brands.id` | 11 distinct; e.g. `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `04db8591-37a3-4634-9d11-536975fa6935`, `f8cb05a4-4de3-41a5-9c52-1ee7f5443926` |  |
| `alias` | text | NOT NULL |  | 206 distinct; e.g. `Juice`, `Power Air`, `Onix Z5` |  |
| `alias_norm` | text | NOT NULL |  | 206 distinct; e.g. `juice`, `power air`, `onix z5` |  |
| `alias_type` | text <br>`= catalog` | no |  | 1 distinct; e.g. `catalog` |  |
| `confidence` | numeric <br>`= 1.0` | no |  | 1 distinct; range 1 .. 1; e.g. `1.0` |  |
| `is_ambiguous` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 1 distinct; e.g. `2026-06-28T09:44:17.340314+00:00` |  |

#### `fx_rates`

Currency conversion used to normalise non-USD storefront prices (today only AUD->USD for Six Zero). Manually maintained.

| | |
|---|---|
| **Rows** | 1 |
| **Grain** | one row per (base, quote, as_of date) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(base_ccy, quote_ccy, as_of)`; CHECK `rate > 0`, CHECK `base_ccy <> quote_ccy` |
| **Written by** | `migrations/025` seed - manual |
| **Read by** | _no frontend consumer_ |
| **Date coverage** | `as_of` 2026-08-26 -> 2026-08-26; `created_at` 2026-08-26 -> 2026-08-26 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 1 distinct; e.g. `8ddd54ce-8397-48f0-adfb-e28db311d3df` |  |
| `base_ccy` | text | NOT NULL |  | 1 distinct; e.g. `AUD` |  |
| `quote_ccy` | text | NOT NULL |  | 1 distinct; e.g. `USD` |  |
| `rate` | numeric | NOT NULL |  | 1 distinct; range 0.66 .. 0.66; e.g. `0.66` |  |
| `as_of` | date | NOT NULL |  | 1 distinct; e.g. `2026-08-26` |  |
| `source` | text | NOT NULL |  | 1 distinct; e.g. `manual` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 1 distinct; e.g. `2026-08-26T06:09:38.291178+00:00` |  |

#### `news_sources`

The whitelist of pickleball publications the news scraper crawls, with an authority score used to weight article importance, plus per-source success/failure health.

| | |
|---|---|
| **Rows** | 20 |
| **Grain** | one row per news domain |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | manual seed (not in `migrations/`) - manual |
| **Read by** | _no frontend consumer_ |
| **Date coverage** | `last_success_at` 2026-05-17 -> 2026-05-17; `created_at` 2026-05-16 -> 2026-05-16 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 20 distinct; e.g. `f36df371-133e-41ee-915c-1d561d6e6326`, `dc69305c-272e-4275-b4be-152cdb3919cf`, `97e7d598-e068-45f8-a050-393a550143e2` |  |
| `name` | text | NOT NULL |  | 20 distinct; e.g. `majorleaguepickleball.co`, `theapp.global`, `dupr.com` |  |
| `base_url` | text | NOT NULL |  | 20 distinct; e.g. `https://majorleaguepickleball.co`, `https://www.theapp.global`, `https://www.dupr.com` |  |
| `authority_score` | integer <br>`= 50` | NOT NULL |  | 9 distinct; range 50 .. 90; e.g. `60`, `65`, `55` |  |
| `is_active` | boolean <br>`= True` | NOT NULL |  | 1 distinct; e.g. `True` |  |
| `last_success_at` | timestamp with time zone | no |  | 20 distinct; e.g. `2026-05-17T06:08:14.003729+00:00`, `2026-05-17T06:08:21.715158+00:00`, `2026-05-17T06:08:28.156887+00:00` |  |
| `last_failed_at` | timestamp with time zone | 100% |  | **always NULL** in the sampled rows |  |
| `last_error` | text | 100% |  | **always NULL** in the sampled rows |  |
| `total_articles` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 1 distinct; e.g. `2026-05-16T13:12:42.346275+00:00` |  |

#### `dim_brand_calendar`

Date-spine dimension: every (brand, local calendar date) combination with the brand's timezone resolved, so daily marts can be joined without gaps. A generated dimension, not scraped data.

| | |
|---|---|
| **Rows** | 5,599 |
| **Grain** | one row per (brand, brand-local date) |
| **Kind** | **materialized view** - refreshed, not written |
| **Primary key** | `brand_id` |
| **Uniqueness / upsert key** | UNIQUE INDEX `(brand_id, metric_date_brand_local)` (required for `REFRESH CONCURRENTLY`) |
| **Written by** | `analytics_backend/marts/refresh_calendar.py` - REFRESH MATERIALIZED VIEW |
| **Read by** | _no frontend consumer_ |
| **Date coverage** | `metric_date_brand_local` 2025-01-01 -> 2026-05-24 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `brand_id` | uuid | no | **PK** | 11 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `f15b6f97-2390-49e2-92f5-b3868e31da09` |  |
| `brand_slug` | text | no |  | 11 distinct; e.g. `joola`, `selkirk`, `paddletek` |  |
| `brand_timezone` | text | no |  | 2 distinct; e.g. `America/New_York`, `Australia/Sydney` |  |
| `metric_date_brand_local` | date | no |  | 73 distinct; e.g. `2025-01-01`, `2025-01-02`, `2025-01-03` | Brand-local date, so daily metrics line up with the brand's own business day. |

### Instagram - competitor set

All 11 brands' public IG accounts. Raw posts + comments, weekly follower snapshots, and two enrichment side-tables that were superseded by inline enrichment columns.

#### `ig_posts`

Instagram posts for all 11 brands - captions, format, hashtags, engagement counts and CDN image URL. The enrichment columns exist but are unused here (enrichment happens on comments instead); `ig_post_analysis` was the intended home for vision analysis and was never populated.

| | |
|---|---|
| **Rows** | 1,147 |
| **Grain** | one row per Instagram post |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | `instagram --source scrape-profiles` -> `sources/instagram/scrape_profiles.py` - upsert on `instagram_post_id` |
| **Read by** | `/v2/instagram`, `/v2/overview` |
| **Foreign keys out** | `account_id` -> `ig_accounts.id`, `brand_id` -> `brands.id` |
| **Referenced by** | `ig_comments.post_id`, `ig_post_analysis.post_id` |
| **Date coverage** | `posted_at` 2023-10-16 -> 2026-09-06; `first_scraped_at` 2026-04-03 -> 2026-09-07; `last_updated_at` 2026-04-03 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `8f28aaaf-f71f-4e40-b178-3f29039bdce2`, `43ceeee6-a7b5-4762-acdc-60d1faae3d21`, `4645acd9-38c9-40a2-afa8-c8cdb10db42b` |  |
| `instagram_post_id` | text | no |  | 800 distinct+; e.g. `3659306733059783077`, `3791214513232976301`, `3755777185211655484` |  |
| `account_id` | uuid | no | FK -> `ig_accounts.id` | 11 distinct; e.g. `0a5a8781-9142-44d5-8b9e-f4a4c298d08c`, `78c5f650-4885-41f5-afd8-97206c1e4239`, `c1cd5510-9771-4243-9c9f-2912432d4f09` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 11 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `f9acc948-f636-4582-a7eb-c98e630fb5cd`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec` |  |
| `region` | text <br>`= USA` | no |  | 1 distinct; e.g. `USA` |  |
| `handle` | text | no |  | 11 distinct; e.g. `joolapickleball`, `crbnpickleball`, `selkirksport` |  |
| `post_url` | text | no |  | 780 distinct+; e.g. `https://www.instagram.com/p/DTgPScljS3z/`, `https://www.instagram.com/p/DLfZ0XkPILy/`, `https://www.instagram.com/p/DLz8kxxAnmP/` |  |
| `posted_at` | timestamp with time zone | no |  | 780 distinct+; e.g. `2026-01-14T20:03:29+00:00`, `2025-06-29T16:02:52+00:00`, `2025-07-07T15:34:24+00:00` |  |
| `post_format` | text | no |  | 4 distinct; e.g. `Video`, `Carousel`, `Image` |  |
| `caption` | text | 1% |  | 756 distinct; e.g. `Save this & send to your drill partner 🙌 and c...`, `Save this video & send to your drill partner 🙌...`, `Save this video and send to your drill partner...` |  |
| `hashtags` | text[] | no |  | 233 distinct; e.g. `[]`, `["pickleball", "pickleballislife", "pickleball...`, `["pickleball", "pickleballislife", "pickleball...` |  |
| `tagged_accounts` | text[] | 84% |  | 27 distinct; e.g. `[]`, `["gammapickleball"]`, `["dickssportinggoods"]` |  |
| `location_tag` | text | 100% |  | **always NULL** in the sampled rows |  |
| `like_count` | integer <br>`= 0` | no |  | 437 distinct; range -1 .. 24,631; e.g. `-1`, `53`, `88` | Uses -1 as a sentinel for 'hidden by the account', so filter `like_count >= 0` before averaging. |
| `comment_count` | integer <br>`= 0` | no |  | 106 distinct; range 0 .. 3419; e.g. `0`, `1`, `2` |  |
| `view_count` | integer <br>`= 0` | 3% |  | 395 distinct; range 0 .. 863,756; e.g. `0`, `2559`, `3647` |  |
| `image_url` | text | no |  | 800 distinct+; e.g. `https://scontent-lga3-3.cdninstagram.com/v/t51...`, `https://scontent-lga3-3.cdninstagram.com/v/t51...`, `https://scontent-lga3-3.cdninstagram.com/v/t51...` |  |
| `all_media_urls` | text[] | 100% |  | **always NULL** in the sampled rows | Never populated; only `image_url` is filled. |
| `is_sponsored` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `first_scraped_at` | timestamp with time zone <br>`= now()` | no |  | 33 distinct; e.g. `2026-05-14T15:23:14.321395+00:00`, `2026-06-15T07:00:17.505122+00:00`, `2026-06-01T06:32:26.161256+00:00` |  |
| `last_updated_at` | timestamp with time zone <br>`= now()` | no |  | 33 distinct; e.g. `2026-05-14T15:23:14.321395+00:00`, `2026-06-15T07:00:17.505122+00:00`, `2026-06-01T06:32:26.161256+00:00` |  |
| `sentiment_score` | numeric | 100% |  | **always NULL** in the sampled rows |  |
| `sentiment_label` | text | 100% |  | **always NULL** in the sampled rows |  |
| `topics` | jsonb | 100% |  | **always NULL** in the sampled rows |  |
| `brands_mentioned` | text[] | 100% |  | **always NULL** in the sampled rows |  |
| `players_mentioned` | text[] | 100% |  | **always NULL** in the sampled rows |  |
| `products_mentioned` | text[] | 100% |  | **always NULL** in the sampled rows |  |
| `is_crisis` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `is_opportunity` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `purchase_intent_score` | numeric | 100% |  | **always NULL** in the sampled rows |  |
| `crisis_keywords` | text[] | 100% |  | **always NULL** in the sampled rows |  |
| `enriched_at` | timestamp with time zone | 100% |  | **always NULL** in the sampled rows | Null for every row: post-level enrichment never ran. Use `ig_comments` for sentiment. |

#### `ig_comments`

Comments on competitor-brand IG posts, enriched inline by GPT: sentiment, topics, brand/player/product mentions, crisis and purchase-intent flags. One of the main feeds into `mention_facts`.

| | |
|---|---|
| **Rows** | 10,200 |
| **Grain** | one row per Instagram comment |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | `instagram --source scrape-comments` -> `sources/instagram/scrape_comments.py`; enriched by `enrichment/ai_enricher` - upsert on `instagram_comment_id`, then PATCH |
| **Read by** | `/v2/community-intel`, `/v2/overview` |
| **Foreign keys out** | `post_id` -> `ig_posts.id`, `brand_id` -> `brands.id` |
| **Referenced by** | `ig_comment_analysis.comment_id` |
| **Date coverage** | `posted_at` 2025-04-18 -> 2026-09-07; `scraped_at` 2026-05-14 -> 2026-09-07; `enriched_at` 2026-05-19 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `b4cfdf9f-1eda-498b-ab10-057f77df79d7`, `af13813e-ea98-41f6-aa11-f83b7137c75f`, `39ec3a00-9618-4794-9f78-c2d3ef5a36a3` |  |
| `instagram_comment_id` | text | 1% |  | 791 distinct+; e.g. `18091330220657399`, `17930857638391760`, `18126879997769853` |  |
| `post_id` | uuid | no | FK -> `ig_posts.id` | 169 distinct; e.g. `ef655093-7668-42a2-8d8f-0463e31e6015`, `95f094cf-5c9c-48a0-8f6e-5d0b614a9b1c`, `cbbd6c37-f904-4d2c-a707-10cf97d5ef06` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 11 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `9f0eb357-eea4-4ab7-9a28-74cbb07940b0`, `f9acc948-f636-4582-a7eb-c98e630fb5cd` |  |
| `commenter_username` | text | 1% |  | 620 distinct; e.g. `toddbobjones`, `wubbalubbadubduuuuub`, `thedukeofrescue` |  |
| `comment_text` | text | 5% |  | 671 distinct; e.g. `🔥🔥🔥`, `👏👏👏`, `😂😂` |  |
| `comment_likes` | integer <br>`= 0` | no |  | 12 distinct; range 0 .. 18; e.g. `0`, `1`, `2` |  |
| `is_brand_reply` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `reply_to_comment_id` | text | 100% |  | **always NULL** in the sampled rows |  |
| `posted_at` | timestamp with time zone | 1% |  | 791 distinct+; e.g. `2026-09-03T22:27:53+00:00`, `2026-09-02T19:48:13+00:00`, `2026-09-03T02:44:13+00:00` |  |
| `scraped_at` | timestamp with time zone <br>`= now()` | no |  | 38 distinct; e.g. `2026-08-17T17:36:46.4675+00:00`, `2026-08-31T07:33:19.212123+00:00`, `2026-08-17T17:36:43.069175+00:00` |  |
| `sentiment_score` | numeric | 13% |  | 12 distinct; range -1 .. 1; e.g. `0.0`, `0.5`, `0.8` |  |
| `sentiment_label` | text | 0% |  | 5 distinct; e.g. `neutral`, `positive`, `very_positive` | Five-level scale: very_negative / negative / neutral / positive / very_positive. |
| `topics` | jsonb | 13% |  | 234 distinct; e.g. `[]`, `["positive-feedback"]`, `["excitement", "enthusiasm"]` | JSONB array of short topic slugs from the enricher, e.g. `["excitement","enthusiasm"]`. |
| `brands_mentioned` | text[] | 13% |  | 9 distinct; e.g. `[]`, `["engage"]`, `["joola"]` |  |
| `players_mentioned` | text[] | 13% |  | 18 distinct; e.g. `[]`, `["Anna Leigh Waters"]`, `["Riley Newman"]` |  |
| `products_mentioned` | text[] | 13% |  | 19 distinct; e.g. `[]`, `["Signature Pro"]`, `["AXIOM"]` |  |
| `is_crisis` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `is_opportunity` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `purchase_intent_score` | numeric | 13% |  | 7 distinct; range 0 .. 1; e.g. `0.0`, `0.7`, `0.8` |  |
| `crisis_keywords` | text[] | 13% |  | 9 distinct; e.g. `[]`, `["failure", "defect"]`, `["break", "fail"]` |  |
| `enriched_at` | timestamp with time zone | no |  | 799 distinct+; e.g. `2026-08-17T17:55:20.039371+00:00`, `2026-09-07T07:07:02.197218+00:00`, `2026-09-07T07:07:07.454437+00:00` |  |
| `post_url` | text | no |  | 169 distinct; e.g. `https://www.instagram.com/p/DcJ-wfaAWWx/`, `https://www.instagram.com/p/DbqAXxqoSRJ/`, `https://www.instagram.com/p/DcPInwnpolG/` | Denormalised from `ig_posts` so comment queries need no join. |

#### `ig_profiles_weekly`

Weekly follower/following/post-count snapshot per brand IG account - the time series behind follower-growth and engagement-rate charts.

| | |
|---|---|
| **Rows** | 208 |
| **Grain** | one row per (account, ISO week) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | `instagram --source scrape-profiles`; theme columns PATCHed by `facts/instagram_themes.py` - delete+insert per ISO week |
| **Read by** | `/v2/instagram`, `/v2/overview`, `/v2/market`, `/v2/data-health` |
| **Foreign keys out** | `account_id` -> `ig_accounts.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `scraped_at` 2026-04-03 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 208 distinct; e.g. `132137a0-ab88-4553-9bcf-3dd00b8e910f`, `449ef3f9-60e2-4a57-a40d-c559c6884276`, `b9c611fb-041c-45b6-92a9-b40ac8a6b9da` |  |
| `account_id` | uuid | no | FK -> `ig_accounts.id` | 11 distinct; e.g. `f5bf78ef-df06-4706-819e-b25ffff5d1f5`, `250456c0-ea0c-4fe6-8c22-9d35c0e074ba`, `35b578de-7806-4d35-ab54-2c6aa656e545` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 11 distinct; e.g. `f15b6f97-2390-49e2-92f5-b3868e31da09`, `38863e89-6ee4-4838-9992-1cbf61b3f235`, `0926e8fa-34d4-4aa8-96e6-ec01425f0fb1` |  |
| `region` | text <br>`= USA` | no |  | 1 distinct; e.g. `USA` |  |
| `handle` | text | no |  | 11 distinct; e.g. `paddletekpickleball`, `wilsonpickleball`, `engagepickleball` |  |
| `followers` | integer | no |  | 197 distinct; range 0 .. 124,755; e.g. `241`, `240`, `236` |  |
| `following` | integer | 5% |  | 84 distinct; range 0 .. 955; e.g. `0`, `90`, `949` |  |
| `post_count` | integer | 8% |  | 149 distinct; range 0 .. 5893; e.g. `0`, `19`, `17` |  |
| `bio_text` | text | 13% |  | 13 distinct; e.g. `#DefiantlyDifferent`, `The #1 brand in pickleball. Focused on that ne...`, `OWN EVERY COURT` |  |
| `bio_link` | text | 13% |  | 14 distinct; e.g. `https://www.head.com/en_US/sports/pickleball/t...`, `http://linktr.ee/selkirksport/`, `https://linktr.ee/onixpickleball` |  |
| `is_verified` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `week_number` | integer | no |  | 19 distinct; range 14 .. 37; e.g. `24`, `20`, `22` |  |
| `year` | integer | no |  | 1 distinct; range 2026 .. 2026; e.g. `2026` |  |
| `scraped_at` | timestamp with time zone <br>`= now()` | no |  | 19 distinct; e.g. `2026-06-08T06:22:08.960182+00:00`, `2026-05-14T22:56:52.464223+00:00`, `2026-05-25T06:04:56.706181+00:00` |  |
| `dominant_content_theme` | text | 15% |  | 5 distinct; e.g. `pickleball`, `paddle-review`, `player-mention` |  |

#### `ig_post_analysis`

Designed as per-post vision analysis (scene, product visible, logo, mood, colours). Never populated - superseded by `joola_ig_post_analysis` for JOOLA and by nothing for competitors.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per analysed post (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | nothing - never written |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `post_id` -> `ig_posts.id` |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | _table is empty_ |  |
| `post_id` | uuid | - | FK -> `ig_posts.id` | _table is empty_ |  |
| `content_category` | text | - |  | _table is empty_ |  |
| `scene_description` | text | - |  | _table is empty_ |  |
| `product_visible` | boolean <br>`= False` | - |  | _table is empty_ |  |
| `product_name_detected` | text | - |  | _table is empty_ |  |
| `logo_visible` | boolean <br>`= False` | - |  | _table is empty_ |  |
| `person_present` | boolean <br>`= False` | - |  | _table is empty_ |  |
| `person_type` | text | - |  | _table is empty_ |  |
| `setting` | text | - |  | _table is empty_ |  |
| `mood` | text | - |  | _table is empty_ |  |
| `mood_score` | integer | - |  | _table is empty_ |  |
| `dominant_colors` | text[] | - |  | _table is empty_ |  |
| `text_overlays` | text | - |  | _table is empty_ |  |
| `text_intent` | text | - |  | _table is empty_ |  |
| `aspiration_level` | text | - |  | _table is empty_ |  |
| `caption_sentiment` | text | - |  | _table is empty_ |  |
| `caption_sentiment_score` | double precision | - |  | _table is empty_ |  |
| `caption_themes` | text[] | - |  | _table is empty_ |  |
| `analyzed_at` | timestamp with time zone <br>`= now()` | - |  | _table is empty_ |  |

#### `ig_comment_analysis`

Designed as a normalised per-comment analysis side-table. Never populated - the same fields were folded into `ig_comments` as inline enrichment columns.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per analysed comment (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | nothing - never written |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `comment_id` -> `ig_comments.id` |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | _table is empty_ |  |
| `comment_id` | uuid | - | FK -> `ig_comments.id` | _table is empty_ |  |
| `sentiment` | text | - |  | _table is empty_ |  |
| `sentiment_score` | double precision | - |  | _table is empty_ |  |
| `theme` | text | - |  | _table is empty_ |  |
| `is_complaint` | boolean <br>`= False` | - |  | _table is empty_ |  |
| `is_purchase_intent` | boolean <br>`= False` | - |  | _table is empty_ |  |
| `is_hype` | boolean <br>`= False` | - |  | _table is empty_ |  |
| `is_question` | boolean <br>`= False` | - |  | _table is empty_ |  |
| `question_text` | text | - |  | _table is empty_ |  |
| `competitor_mentioned` | text | - |  | _table is empty_ |  |
| `competitor_sentiment` | text | - |  | _table is empty_ |  |
| `commenter_type` | text | - |  | _table is empty_ |  |
| `analyzed_at` | timestamp with time zone <br>`= now()` | - |  | _table is empty_ |  |

### Instagram - JOOLA deep dive (`joola_ig_*`)

A second, JOOLA-only Instagram pipeline with far richer per-comment analysis, community/loyalty modelling and weekly rollups. Keyed on Instagram's own string IDs, not UUIDs.

#### `joola_ig_posts`

JOOLA's own Instagram posts with publishing-behaviour detail the competitor table lacks: day/hour of posting, CTA detection, caption length, emoji count, carousel slide count, computed engagement rate and the full media URL array.

| | |
|---|---|
| **Rows** | 614 |
| **Grain** | one row per JOOLA IG post (`post_id` = Instagram media id) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | JOOLA-IG pipeline (outside `migrations/`) - insert/upsert on `post_id` |
| **Read by** | _no frontend consumer_ |
| **Referenced by** | `joola_ig_athlete_mentions.post_id`, `joola_ig_comments.post_id`, `joola_ig_post_analysis.post_id`, `joola_ig_product_mentions.post_id`, `joola_ig_user_post_activity.post_id` |
| **Date coverage** | `posted_at` 2025-04-24 -> 2026-08-12; `scraped_at` 2026-04-03 -> 2026-08-12 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 614 distinct; e.g. `078e560e-3e2a-4ffd-a588-584223baaa0d`, `0dc8f0fe-de5c-45df-a33d-80b2e6f8b73e`, `2543abf1-1619-4cf2-ac9f-87c21584e7b0` |  |
| `post_id` | text | NOT NULL |  | 614 distinct; e.g. `3866670420509917459`, `3865929306857366566`, `3865828799087222107` |  |
| `post_url` | text | no |  | 604 distinct; e.g. `https://www.instagram.com/p/DYXV2gVxQXi/`, `https://www.instagram.com/p/DYQ1lKExLjg/`, `https://www.instagram.com/p/DYU_52hRGzG/` |  |
| `post_type` | text | no |  | 5 distinct; e.g. `reel`, `carousel`, `photo` |  |
| `caption` | text | no |  | 602 distinct; e.g. `👀`, `The R4LLy shoe didn’t happen overnight… it’s b...`, `And that’s a wrap on this year’s Trailblazers ...` |  |
| `hashtags` | text[] | 15% |  | 77 distinct; e.g. `[]`, `["#1"]`, `["#juniorppa"]` |  |
| `mentions` | text[] | 15% |  | 143 distinct; e.g. `[]`, `["@joolapickleball"]`, `["@federico_staksrud"]` |  |
| `tagged_accounts` | text[] | 15% |  | 454 distinct; e.g. `[]`, `["{\"full_name\": \"Kate Fahey\", \"id\": \"14...`, `["{\"full_name\": \"Rachel Rettger\", \"id\": ...` |  |
| `has_cta` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `cta_text` | text | 95% |  | 6 distinct; e.g. `visit link`, `tag someone`, `shop` |  |
| `caption_length` | integer | 15% |  | 270 distinct; range 1 .. 1552; e.g. `90`, `103`, `95` |  |
| `emoji_count` | integer <br>`= 0` | no |  | 11 distinct; range 0 .. 12; e.g. `1`, `2`, `0` |  |
| `language` | text <br>`= en` | no |  | 1 distinct; e.g. `en` |  |
| `like_count` | integer <br>`= 0` | no |  | 454 distinct; range -1 .. 13,703; e.g. `-1`, `338`, `94` | -1 sentinel for hidden likes, same as `ig_posts`. |
| `comment_count` | integer <br>`= 0` | no |  | 121 distinct; range 0 .. 6515; e.g. `4`, `7`, `5` |  |
| `view_count` | integer <br>`= 0` | no |  | 339 distinct; range 0 .. 194,303; e.g. `0`, `1365`, `4152` |  |
| `carousel_slide_count` | integer <br>`= 0` | 3% |  | 18 distinct; range 0 .. 20; e.g. `0`, `5`, `2` |  |
| `posted_at` | timestamp without time zone | no |  | 604 distinct; e.g. `2026-05-15T15:48:37`, `2026-05-13T03:21:42`, `2026-05-14T17:55:12` | `timestamp without time zone` in this cluster, unlike the rest of the database - compare carefully against tz-aware columns. |
| `day_of_week` | text | no |  | 13 distinct; e.g. `Friday`, `Sunday`, `Tuesday` |  |
| `hour_of_day` | integer | no |  | 23 distinct; range 0 .. 23; e.g. `20`, `19`, `18` |  |
| `first_comment_at` | timestamp without time zone | 100% |  | **always NULL** in the sampled rows |  |
| `comments_first_hour` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `comments_first_24h` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `engagement_rate` | double precision <br>`= 0` | 3% |  | 472 distinct; range 0 .. 14.5; e.g. `0`, `0.286`, `0.171` |  |
| `media_urls` | text[] | 15% |  | 519 distinct; e.g. `["https://scontent-ord5-3.cdninstagram.com/v/t...`, `["https://scontent-hou1-1.cdninstagram.com/v/t...`, `["https://scontent-ord5-3.cdninstagram.com/v/t...` |  |
| `thumbnail_url` | text | no |  | 614 distinct; e.g. `https://scontent-ord5-3.cdninstagram.com/v/t51...`, `https://scontent-hou1-1.cdninstagram.com/v/t51...`, `https://scontent-ord5-3.cdninstagram.com/v/t51...` |  |
| `scraped_at` | timestamp without time zone <br>`= now()` | no |  | 10 distinct; e.g. `2026-04-03T17:07:54.683534`, `2026-04-03T17:07:55.423113`, `2026-04-03T17:07:56.368047` |  |

#### `joola_ig_comments`

Every comment on a JOOLA post with thread structure (reply depth, parent), comment length, emoji count and whether JOOLA itself replied. The base table for the whole community-analysis cluster.

| | |
|---|---|
| **Rows** | 13,782 |
| **Grain** | one row per comment on a JOOLA post |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | JOOLA-IG pipeline - insert/upsert on `comment_id` |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `post_id` -> `joola_ig_posts.post_id` |
| **Referenced by** | `joola_ig_comment_analysis.comment_id`, `joola_ig_competitor_mentions.comment_id`, `joola_ig_complaint_log.comment_id`, `joola_ig_wishlist_items.comment_id` |
| **Date coverage** | `commented_at` 2025-04-24 -> 2026-08-12; `scraped_at` 2026-04-03 -> 2026-08-12 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `af1c70c1-4439-44c7-bee2-7d41e477d21a`, `39b4f2ea-7658-4b28-85a1-ce2b9aeb8292`, `f85caa1f-54df-4e6d-bb22-296da006bbe7` |  |
| `comment_id` | text | NOT NULL |  | 800 distinct+; e.g. `18107892169878604`, `18158739313442382`, `18009183293700461` | Instagram's own string id, and the FK target used by five sibling tables. |
| `post_id` | text | no | FK -> `joola_ig_posts.post_id` | 47 distinct; e.g. `3863817131952047264`, `3862252008506490625`, `3847118336577046647` |  |
| `username` | text | no |  | 678 distinct; e.g. `ray_rett`, `charlie_white`, `cadennemoff` |  |
| `comment_text` | text | no |  | 681 distinct; e.g. `R4LLy`, `🔥🔥🔥`, `🔥` |  |
| `comment_length` | integer | no |  | 112 distinct; range 1 .. 1041; e.g. `5`, `3`, `13` |  |
| `language` | text <br>`= en` | no |  | 1 distinct; e.g. `en` |  |
| `emoji_count` | integer <br>`= 0` | no |  | 7 distinct; range 0 .. 6; e.g. `0`, `1`, `2` |  |
| `likes_on_comment` | integer <br>`= 0` | no |  | 38 distinct; range 0 .. 497; e.g. `1`, `0`, `2` |  |
| `is_reply` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `parent_comment_id` | text | 100% |  | **always NULL** in the sampled rows |  |
| `thread_depth` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `reply_count` | integer <br>`= 0` | no |  | 9 distinct; range 0 .. 25; e.g. `0`, `1`, `2` |  |
| `is_joola_reply` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `commented_at` | timestamp without time zone | no |  | 800 distinct+; e.g. `2026-03-29T21:55:05`, `2026-03-29T21:54:23`, `2026-03-29T21:51:27` |  |
| `minutes_after_post` | integer | 100% |  | **always NULL** in the sampled rows |  |
| `scraped_at` | timestamp without time zone <br>`= now()` | no |  | 6 distinct; e.g. `2026-04-03T17:08:07.999643`, `2026-04-03T17:08:08.206352`, `2026-04-03T17:08:08.558138` |  |

#### `joola_ig_post_analysis`

GPT vision+caption analysis of each JOOLA post: content theme, products and athletes shown, setting, shot type, CTA type, visual/caption quality scores, tournament reference and a predicted-performance bucket.

| | |
|---|---|
| **Rows** | 567 |
| **Grain** | one row per analysed JOOLA post |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | JOOLA-IG pipeline (OpenAI) - upsert on `post_id` |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `post_id` -> `joola_ig_posts.post_id` |
| **Date coverage** | `analyzed_at` 2026-04-03 -> 2026-06-28 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 567 distinct; e.g. `51cbe984-5c08-417a-8e4d-512672f74cdb`, `281477d3-f613-4934-9249-449f082bb879`, `e9bd85c4-ba1f-42ab-9cb9-8b0c989e438b` |  |
| `post_id` | text | no | FK -> `joola_ig_posts.post_id` | 567 distinct; e.g. `3865929306857366566`, `3865828799087222107`, `3865761647323708740` |  |
| `content_theme` | text | no |  | 15 distinct; e.g. `Tournament`, `General`, `Product Launch` |  |
| `content_subtheme` | text | 100% |  | **always NULL** in the sampled rows |  |
| `products_shown` | text[] | no |  | 13 distinct; e.g. `[]`, `["perseus"]`, `["vision"]` |  |
| `athletes_shown` | text[] | no |  | 8 distinct; e.g. `[]`, `["benjohns"]`, `["ben johns"]` |  |
| `setting` | text | 12% |  | 5 distinct; e.g. `studio`, `outdoor court`, `event venue` |  |
| `shot_type` | text | 12% |  | 6 distinct; e.g. `promotional`, `action`, `portrait` |  |
| `has_text_overlay` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `text_overlay_content` | text | 67% |  | 1 distinct; e.g. `promotional text` |  |
| `brand_colors_present` | boolean <br>`= True` | no |  | 1 distinct; e.g. `True` |  |
| `brand_logo_visible` | boolean <br>`= True` | no |  | 1 distinct; e.g. `True` |  |
| `people_count` | integer <br>`= 0` | no |  | 4 distinct; range 0 .. 5; e.g. `1`, `0`, `2` |  |
| `visual_quality_score` | integer | no |  | 5 distinct; range 5 .. 9; e.g. `6`, `7`, `9` |  |
| `post_intent` | text | no |  | 11 distinct; e.g. `engagement`, `announcement`, `celebrate` |  |
| `sentiment_tone` | text | no |  | 8 distinct; e.g. `informative`, `exciting`, `positive` |  |
| `caption_summary` | text | no |  | 566 distinct; e.g. `👀`, `Come with us to rebrand the YOLA office ✨  APR...`, `Allow us to reintroduce ourselves… meet YOLA 😎...` |  |
| `caption_quality_score` | integer | no |  | 10 distinct; range 1 .. 10; e.g. `1`, `2`, `3` |  |
| `hashtag_count` | integer <br>`= 0` | no |  | 14 distinct; range 0 .. 13; e.g. `0`, `3`, `1` |  |
| `hashtag_relevance_score` | integer | no |  | 8 distinct; range 1 .. 8; e.g. `7`, `2`, `3` |  |
| `cta_type` | text | 83% |  | 10 distinct; e.g. `none`, `shop`, `visit link` |  |
| `is_sponsored` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `sponsor_brand` | text | 100% |  | **always NULL** in the sampled rows |  |
| `tournament_reference` | text | 80% |  | 19 distinct; e.g. `ppa`, `championship`, `mlp` |  |
| `predicted_performance` | text | no |  | 4 distinct; e.g. `low`, `high`, `medium` |  |
| `analyzed_at` | timestamp without time zone <br>`= now()` | no |  | 20 distinct; e.g. `2026-04-03T17:07:56.873395`, `2026-04-03T17:07:57.311542`, `2026-04-03T17:07:57.51361` |  |

#### `joola_ig_comment_analysis`

Per-comment GPT classification for JOOLA comments: sentiment + emotion, primary topic, and boolean intent flags (question, complaint, wishlist, purchase intent, competitor mention, spam/bot) with the extracted evidence text.

| | |
|---|---|
| **Rows** | 13,415 |
| **Grain** | one row per analysed JOOLA comment |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | JOOLA-IG pipeline (OpenAI) - upsert on `comment_id` |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `comment_id` -> `joola_ig_comments.comment_id` |
| **Date coverage** | `analyzed_at` 2026-04-03 -> 2026-06-28 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `6ac35b37-5b84-434a-86b2-fffb2af5e379`, `3ef52e88-f908-40da-a2df-797c6edf50d2`, `bdf004df-bfb2-4a66-bc68-d9888f4d3de5` |  |
| `comment_id` | text | no | FK -> `joola_ig_comments.comment_id` | 800 distinct+; e.g. `18107892169878604`, `18158739313442382`, `18009183293700461` |  |
| `post_id` | text | no |  | 47 distinct; e.g. `3863817131952047264`, `3862252008506490625`, `3847118336577046647` |  |
| `username` | text | no |  | 678 distinct; e.g. `ray_rett`, `charlie_white`, `cadennemoff` |  |
| `sentiment` | text | no |  | 3 distinct; e.g. `neutral`, `positive`, `negative` |  |
| `sentiment_score` | double precision | no |  | 7 distinct; range 0.4 .. 1; e.g. `0.5`, `0.6`, `0.7` |  |
| `emotion` | text | no |  | 6 distinct; e.g. `neutral`, `excited`, `love` |  |
| `primary_topic` | text | no |  | 7 distinct; e.g. `general`, `praise`, `product question` |  |
| `secondary_topic` | text | 100% |  | **always NULL** in the sampled rows |  |
| `is_question` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `question_text` | text | 92% |  | 60 distinct; e.g. `Is that Richard?!??`, `What a match though 🙌🏻✨`, `What a great team of ladies!!` |  |
| `is_complaint` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `complaint_category` | text | 100% |  | 1 distinct; e.g. `customer service` |  |
| `is_wishlist` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `wishlist_text` | text | 99% |  | 7 distinct; e.g. `Wish I’d known you were in Dallas! Those are m...`, `Hi Scout love your video. Do you remember me? ...`, `@mayyylane We would love to get this paddle 🥹🥹...` |  |
| `mentions_competitor` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `competitor_mentioned` | text | 100% |  | 1 distinct; e.g. `Head` |  |
| `competitor_context` | text | 100% |  | **always NULL** in the sampled rows |  |
| `purchase_intent` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `purchase_signal_text` | text | 100% |  | 3 distinct; e.g. `telling myself i don’t need this 😅`, `I NEED this!!!! 🔥🔥🔥❤️ Kosmos`, `take my money…!` |  |
| `product_mentioned` | text | 99% |  | 3 distinct; e.g. `Perseus`, `Ben Johns`, `Magnus` |  |
| `athlete_mentioned` | text | 100% |  | 1 distinct; e.g. `Ben Johns` |  |
| `is_spam` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `is_bot_likely` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `analyzed_at` | timestamp without time zone <br>`= now()` | no |  | 6 distinct; e.g. `2026-04-03T17:08:24.739607`, `2026-04-03T17:08:24.918953`, `2026-04-03T17:08:25.11695` |  |

#### `joola_ig_loyal_users`

Community/loyalty model of everyone who has ever commented on a JOOLA post: comment volume, tenure, dominant emotion and topic, complaint/praise/question counts, a loyalty tier, an ambassador score and whether they also engage with competitors. This is the brand-advocate shortlist.

| | |
|---|---|
| **Rows** | 7,054 |
| **Grain** | one row per commenter username |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | JOOLA-IG pipeline (computed) - upsert on `username` |
| **Read by** | _no frontend consumer_ |
| **Date coverage** | `first_seen_at` 2025-04-24 -> 2026-06-28; `last_seen_at` 2025-04-24 -> 2026-06-28; `updated_at` 2026-06-28 -> 2026-06-28 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `db2692ef-e60a-4287-9ec6-757038312f76`, `6c57722a-639c-4938-a94e-0a01480edbc9`, `2677b9b0-a816-42a0-b961-e557c71351c3` |  |
| `username` | text | NOT NULL |  | 800 distinct+; e.g. `rahil_doctor94`, `jojotx11`, `joshshikoff` |  |
| `display_name` | text | 100% |  | **always NULL** in the sampled rows |  |
| `profile_url` | text | no |  | 800 distinct+; e.g. `https://www.instagram.com/rahil_doctor94/`, `https://www.instagram.com/jojotx11/`, `https://www.instagram.com/joshshikoff/` |  |
| `bio` | text | 100% |  | **always NULL** in the sampled rows |  |
| `follower_count` | integer <br>`= 0` | 100% |  | **always NULL** in the sampled rows | Null for every row - follower enrichment of commenters never ran, so influence ranking rests on comment behaviour only. |
| `following_count` | integer <br>`= 0` | 100% |  | **always NULL** in the sampled rows |  |
| `is_verified` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `is_business_account` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `is_potential_influencer` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `total_comments` | integer <br>`= 0` | no |  | 38 distinct; range 1 .. 102; e.g. `1`, `2`, `3` |  |
| `total_posts_commented_on` | integer <br>`= 0` | no |  | 36 distinct; range 1 .. 99; e.g. `1`, `2`, `3` |  |
| `total_replies_made` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `total_likes_received_on_comments` | integer <br>`= 0` | no |  | 79 distinct; range 0 .. 1501; e.g. `1`, `0`, `2` |  |
| `first_seen_at` | timestamp without time zone | no |  | 800 distinct+; e.g. `2026-03-29T21:51:27`, `2026-03-09T21:36:09`, `2026-03-29T21:35:34` |  |
| `last_seen_at` | timestamp without time zone | no |  | 800 distinct+; e.g. `2026-03-29T21:51:27`, `2026-03-09T21:36:09`, `2026-03-29T21:35:34` |  |
| `active_months` | integer <br>`= 0` | no |  | 15 distinct; range 1 .. 15; e.g. `1`, `11`, `5` |  |
| `avg_sentiment_score` | double precision | no |  | 90 distinct; range 0 .. 1; e.g. `0.5`, `0.6`, `0.7` |  |
| `dominant_emotion` | text | no |  | 7 distinct; e.g. `neutral`, `excited`, `love` |  |
| `dominant_topic` | text | no |  | 7 distinct; e.g. `general`, `praise`, `product question` |  |
| `complaint_count` | integer <br>`= 0` | no |  | 3 distinct; range 0 .. 2; e.g. `0`, `1`, `2` |  |
| `praise_count` | integer <br>`= 0` | no |  | 38 distinct; range 0 .. 101; e.g. `1`, `2`, `3` |  |
| `question_count` | integer <br>`= 0` | no |  | 6 distinct; range 0 .. 10; e.g. `0`, `1`, `2` |  |
| `purchase_intent_count` | integer <br>`= 0` | no |  | 2 distinct; range 0 .. 1; e.g. `0`, `1` |  |
| `competitor_mention_count` | integer <br>`= 0` | no |  | 4 distinct; range 0 .. 3; e.g. `0`, `1`, `3` |  |
| `wishlist_count` | integer <br>`= 0` | no |  | 4 distinct; range 0 .. 4; e.g. `0`, `1`, `4` |  |
| `loyalty_tier` | text | no |  | 4 distinct; e.g. `casual`, `regular`, `loyal` |  |
| `ambassador_score` | double precision | no |  | 62 distinct; range 0 .. 100; e.g. `13`, `15`, `17` | 0-100 composite; `is_potential_ambassador` is the thresholded flag. |
| `is_potential_ambassador` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `also_comments_on_competitors` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `updated_at` | timestamp without time zone <br>`= now()` | no |  | 31 distinct; e.g. `2026-06-28T11:27:41.801722`, `2026-06-28T11:27:41.90038`, `2026-06-28T11:27:41.797723` |  |

#### `joola_ig_user_post_activity`

The (user x post) bridge behind the loyalty model - how much a given user commented on a given post and their average sentiment on it.

| | |
|---|---|
| **Rows** | 10,700 |
| **Grain** | one row per (username, post) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | JOOLA-IG pipeline (computed) - insert |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `post_id` -> `joola_ig_posts.post_id` |
| **Date coverage** | `first_comment_at` 2025-04-24 -> 2026-04-03 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `fdcbf63a-84bd-41a2-9fd3-010522ceb98b`, `fa914d72-f1be-4735-8b10-23b0a60b2acd`, `7f9f5280-87c5-4c9b-a22e-8e43ed72de9d` |  |
| `username` | text | no |  | 146 distinct; e.g. `ray_rett`, `cadennemoff`, `dianaysa3` |  |
| `post_id` | text | no | FK -> `joola_ig_posts.post_id` | 306 distinct; e.g. `3862252008506490625`, `3865828799087222107`, `3847365621617809550` |  |
| `comment_count_on_post` | integer <br>`= 0` | no |  | 3 distinct; range 1 .. 3; e.g. `1`, `2`, `3` |  |
| `total_comment_length` | integer <br>`= 0` | no |  | 98 distinct; range 1 .. 465; e.g. `3`, `5`, `1` |  |
| `avg_sentiment_on_post` | double precision | no |  | 10 distinct; range 0.4 .. 1; e.g. `0.5`, `0.6`, `0.7` |  |
| `first_comment_at` | timestamp without time zone | no |  | 800 distinct+; e.g. `2026-03-29T21:54:23`, `2026-03-29T21:51:27`, `2026-03-29T21:35:34` |  |
| `is_first_commenter` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `post_theme` | text | 100% |  | **always NULL** in the sampled rows |  |
| `post_type` | text | 100% |  | **always NULL** in the sampled rows |  |

#### `joola_ig_weekly_snapshot`

Week-over-week JOOLA Instagram scorecard: posts published, total likes/comments/views, engagement rate, top post, new vs returning commenters, sentiment split, complaint/purchase-intent/competitor/wishlist counts and JOOLA's own reply behaviour.

| | |
|---|---|
| **Rows** | 56 |
| **Grain** | one row per ISO week |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | JOOLA-IG pipeline (computed) - upsert per week |
| **Read by** | _no frontend consumer_ |
| **Date coverage** | `week_start` 2025-04-21 -> 2026-06-22; `week_end` 2025-04-27 -> 2026-06-28; `created_at` 2026-04-03 -> 2026-06-28 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 56 distinct; e.g. `54dbc4ae-e5e3-461f-9803-d83be7d8742a`, `5849a675-3cdf-4c59-9d87-90f93ec7f210`, `81a98dcd-782b-46e8-b722-bc26643a4347` |  |
| `week_start` | date | no |  | 56 distinct; e.g. `2025-04-21`, `2025-04-28`, `2025-05-05` |  |
| `week_end` | date | no |  | 56 distinct; e.g. `2025-04-27`, `2025-05-04`, `2025-05-11` |  |
| `posts_published` | integer <br>`= 0` | no |  | 19 distinct; range 0 .. 40; e.g. `7`, `9`, `6` |  |
| `total_likes` | integer <br>`= 0` | no |  | 55 distinct; range 0 .. 32,660; e.g. `0`, `4515`, `7148` |  |
| `total_comments` | integer <br>`= 0` | no |  | 55 distinct; range 3 .. 6614; e.g. `147`, `100`, `427` |  |
| `total_views` | integer <br>`= 0` | no |  | 55 distinct; range 0 .. 471,162; e.g. `0`, `63203`, `47338` |  |
| `avg_engagement_rate` | double precision <br>`= 0` | no |  | 53 distinct; range 0 .. 2.706; e.g. `0`, `0.469`, `0.81` |  |
| `top_post_id` | text | 4% |  | 54 distinct; e.g. `3618761168338351798`, `3624712390521673803`, `3626660061830627697` |  |
| `top_post_engagement` | double precision <br>`= 0` | no |  | 55 distinct; range 0 .. 9788; e.g. `0`, `3.473`, `2.084` |  |
| `new_commenters` | integer <br>`= 0` | no |  | 16 distinct; range 0 .. 660; e.g. `0`, `14`, `321` |  |
| `returning_commenters` | integer <br>`= 0` | no |  | 11 distinct; range 0 .. 72; e.g. `0`, `11`, `2` |  |
| `positive_comment_pct` | double precision <br>`= 0` | no |  | 16 distinct; range 0 .. 75; e.g. `0`, `15.7894736842105`, `33.6065573770492` |  |
| `negative_comment_pct` | double precision <br>`= 0` | no |  | 14 distinct; range 0 .. 66.67; e.g. `0`, `5.26315789473684`, `1.89393939393939` |  |
| `neutral_comment_pct` | double precision <br>`= 0` | no |  | 14 distinct; range 0 .. 82.94; e.g. `0`, `20`, `78.9473684210526` |  |
| `avg_sentiment_score` | double precision <br>`= 0` | no |  | 16 distinct; range -0.4 .. 0.7; e.g. `0`, `0.515789473684211`, `0.556010928961748` |  |
| `top_emotion` | text | 73% |  | 3 distinct; e.g. `neutral`, `joy`, `anger` |  |
| `complaint_count` | integer <br>`= 0` | no |  | 9 distinct; range 0 .. 15; e.g. `0`, `1`, `5` |  |
| `purchase_intent_count` | integer <br>`= 0` | no |  | 4 distinct; range 0 .. 4; e.g. `0`, `1`, `2` |  |
| `competitor_mention_count` | integer <br>`= 0` | no |  | 6 distinct; range 0 .. 9; e.g. `0`, `1`, `2` |  |
| `wishlist_count` | integer <br>`= 0` | no |  | 8 distinct; range 0 .. 14; e.g. `0`, `4`, `1` |  |
| `joola_reply_count` | integer <br>`= 0` | no |  | 2 distinct; range 0 .. 1; e.g. `0`, `1` |  |
| `avg_joola_response_time_mins` | double precision <br>`= 0` | 27% |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `dominant_content_theme` | text | 100% |  | **always NULL** in the sampled rows |  |
| `new_super_fans` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `created_at` | timestamp without time zone <br>`= now()` | no |  | 5 distinct; e.g. `2026-04-03T17:07:58.425139`, `2026-06-28T11:28:19.812757`, `2026-05-16T10:56:58.46141` |  |

#### `joola_ig_hashtag_performance`

Per-hashtag performance on JOOLA's account: times used, average likes/comments/views, average engagement rate, best-performing post and first/last used dates.

| | |
|---|---|
| **Rows** | 165 |
| **Grain** | one row per hashtag |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | JOOLA-IG pipeline (computed) - upsert on `hashtag` |
| **Read by** | _no frontend consumer_ |
| **Date coverage** | `first_used_at` 2025-04-27 -> 2026-03-26; `last_used_at` 2025-04-27 -> 2026-04-01; `updated_at` 2026-04-03 -> 2026-04-03 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 165 distinct; e.g. `4c189683-037d-417f-823d-5bc86ada875d`, `36385f88-adf8-4c6e-a69d-c44ea1a7e32d`, `e295621a-6bdf-4e95-ac1f-05afe9082964` |  |
| `hashtag` | text | NOT NULL |  | 165 distinct; e.g. `#pickleballers`, `#pickleballaddiction`, `#pickleballislife` |  |
| `times_used` | integer <br>`= 0` | no |  | 10 distinct; range 1 .. 40; e.g. `1`, `2`, `3` |  |
| `avg_like_count` | double precision <br>`= 0` | no |  | 83 distinct; range -1 .. 3715; e.g. `-1`, `205`, `929.5` |  |
| `avg_comment_count` | double precision <br>`= 0` | no |  | 61 distinct; range 1 .. 6515; e.g. `8`, `24`, `1` |  |
| `avg_view_count` | double precision <br>`= 0` | no |  | 66 distinct; range 0 .. 52,633; e.g. `0`, `5888`, `22195.5` |  |
| `avg_engagement_rate` | double precision <br>`= 0` | no |  | 55 distinct; range 0 .. 8.83; e.g. `0.38`, `1.68`, `0.01` |  |
| `best_post_id` | text | 1% |  | 62 distinct; e.g. `3762944827735486586`, `3821981276081627388`, `3746907597514568695` |  |
| `first_used_at` | timestamp without time zone | no |  | 63 distinct; e.g. `2025-09-08T18:03:31`, `2025-04-27T11:33:15`, `2025-12-22T23:35:51` |  |
| `last_used_at` | timestamp without time zone | no |  | 62 distinct; e.g. `2025-08-10T23:36:31`, `2026-01-31T05:02:05`, `2025-11-10T18:07:54` |  |
| `updated_at` | timestamp without time zone <br>`= now()` | no |  | 2 distinct; e.g. `2026-04-03T17:07:58.092313`, `2026-04-03T17:07:58.263865` |  |

#### `joola_ig_athlete_mentions`

Every mention of a JOOLA-roster athlete inside a JOOLA post caption or its comments, with sentiment - athlete-equity tracking.

| | |
|---|---|
| **Rows** | 88 |
| **Grain** | one row per athlete mention |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | JOOLA-IG pipeline (OpenAI extraction) - insert |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `post_id` -> `joola_ig_posts.post_id` |
| **Date coverage** | `mentioned_at` 2025-04-25 -> 2026-03-29 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 88 distinct; e.g. `1f4b6cdb-d832-4641-b7db-221ee9bcc7a7`, `b0c6c7af-8810-496b-8067-6d0c45ab5dbc`, `f04696c6-8717-4ce6-a446-b8ab534b15ad` |  |
| `post_id` | text | no | FK -> `joola_ig_posts.post_id` | 66 distinct; e.g. `3852105741847376631`, `3855689143263624606`, `3732658550082634284` |  |
| `source` | text | no |  | 2 distinct; e.g. `comment`, `caption` |  |
| `comment_id` | text | 44% |  | 49 distinct; e.g. `17880819780488820`, `18081642476363650`, `18087814604224694` |  |
| `username` | text | 44% |  | 44 distinct; e.g. `mohdfirdausabdulr`, `richlee79`, `jp19799` |  |
| `athlete_name` | text | no |  | 7 distinct; e.g. `Tysonmcguffin`, `Ben Johns`, `Benjohns` |  |
| `mention_type` | text | no |  | 1 distinct; e.g. `written` |  |
| `sentiment` | text | no |  | 3 distinct; e.g. `positive`, `neutral`, `negative` |  |
| `mentioned_at` | timestamp without time zone <br>`= now()` | no |  | 85 distinct; e.g. `2026-03-13T18:38:09`, `2026-03-06T22:56:23`, `2025-08-07T22:05:31` |  |

#### `joola_ig_competitor_mentions`

Comments on JOOLA posts that name a competitor, with the full comment text and sentiment toward both JOOLA and the competitor. Small but high-signal.

| | |
|---|---|
| **Rows** | 39 |
| **Grain** | one row per competitor mention in a comment |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | JOOLA-IG pipeline (OpenAI extraction) - insert |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `comment_id` -> `joola_ig_comments.comment_id` |
| **Date coverage** | `mentioned_at` 2025-05-05 -> 2026-03-28 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 39 distinct; e.g. `635eee0c-d3c7-4cc3-9f21-0d9a0f7b2f4c`, `3759a506-f551-4880-8843-febd09ca1e45`, `0b1878ff-9d3e-44e3-a762-944c2a8f7984` |  |
| `comment_id` | text | no | FK -> `joola_ig_comments.comment_id` | 39 distinct; e.g. `18025256675811380`, `18081288455581608`, `18309174733260215` |  |
| `post_id` | text | no |  | 33 distinct; e.g. `3793433067911306867`, `3852105741847376631`, `3855652197317831943` |  |
| `username` | text | no |  | 38 distinct; e.g. `amigosdepickleball`, `lucuriel22`, `pickleballpoa` |  |
| `competitor_name` | text | no |  | 7 distinct; e.g. `Head`, `Franklin`, `Crbn` |  |
| `mention_context` | text | no |  | 1 distinct; e.g. `comparing` |  |
| `full_comment_text` | text | no |  | 39 distinct; e.g. `You got this Richard !!! Vamos ! I will never ...`, `Happy birthday, @benjohns_pb ! 🎉 Wishing you a...`, `Well mine is a Franklin. 😵‍💫` |  |
| `sentiment_toward_joola` | text | no |  | 3 distinct; e.g. `neutral`, `positive`, `negative` |  |
| `sentiment_toward_competitor` | text | no |  | 1 distinct; e.g. `neutral` |  |
| `mentioned_at` | timestamp without time zone <br>`= now()` | no |  | 39 distinct; e.g. `2026-03-28T15:33:00`, `2026-03-18T20:48:20`, `2026-03-13T22:29:15` |  |

#### `joola_ig_product_mentions`

Product names extracted from JOOLA captions and comments, with mention context (promotional / praise / general) and sentiment.

| | |
|---|---|
| **Rows** | 158 |
| **Grain** | one row per product mention |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | JOOLA-IG pipeline (OpenAI extraction) - insert |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `post_id` -> `joola_ig_posts.post_id` |
| **Date coverage** | `mentioned_at` 2025-04-30 -> 2026-03-29 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 158 distinct; e.g. `fc0874ec-af62-49b0-86e1-83a2e08346d4`, `452f1186-b05b-453a-9634-64b0406a878f`, `8a30a8d2-c025-4c87-b6cf-7ef8c864edde` |  |
| `post_id` | text | no | FK -> `joola_ig_posts.post_id` | 108 distinct; e.g. `3831010444597862856`, `3840536780509149638`, `3828882163236772934` |  |
| `source` | text | no |  | 2 distinct; e.g. `comment`, `caption` |  |
| `comment_id` | text | 49% |  | 80 distinct; e.g. `18107816626697009`, `18353941483238403`, `17880819780488820` |  |
| `username` | text | 49% |  | 73 distinct; e.g. `elcapitan0629`, `wilshaffer_pb`, `moon.russ` |  |
| `product_name` | text | no |  | 10 distinct; e.g. `Perseus`, `Ben Johns`, `Scorpeus` |  |
| `product_category` | text | no |  | 1 distinct; e.g. `paddle` |  |
| `mention_context` | text | no |  | 6 distinct; e.g. `promotional`, `general`, `praise` |  |
| `sentiment` | text | no |  | 2 distinct; e.g. `positive`, `neutral` |  |
| `mentioned_at` | timestamp without time zone <br>`= now()` | no |  | 146 distinct; e.g. `2026-02-25T19:31:11`, `2026-02-12T16:02:18`, `2026-02-26T20:11:31` |  |

#### `joola_ig_complaint_log`

Triage queue of complaints found in JOOLA comments: category, severity, the complaint text and whether JOOLA responded (and how fast). `joola_responded` is false for every row - the response loop is not wired up.

| | |
|---|---|
| **Rows** | 105 |
| **Grain** | one row per complaint comment |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | JOOLA-IG pipeline (OpenAI extraction) - insert |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `comment_id` -> `joola_ig_comments.comment_id` |
| **Date coverage** | `complained_at` 2025-05-12 -> 2026-06-27 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 105 distinct; e.g. `2abb65fd-0d52-4b74-ad58-62fb516b9d18`, `31fd9b3d-edf0-4a55-84af-73229ef0a90d`, `f9fb677b-698f-438b-acd6-e6fd34aa4608` |  |
| `comment_id` | text | no | FK -> `joola_ig_comments.comment_id` | 105 distinct; e.g. `18061058213678401`, `18115495483629335`, `17941135485014721` |  |
| `post_id` | text | no |  | 83 distinct; e.g. `3852105741847376631`, `3831010444597862856`, `3855652197317831943` |  |
| `username` | text | no |  | 83 distinct; e.g. `bretchristy`, `pebravoll`, `laurazhang_3` |  |
| `complaint_category` | text | 50% |  | 7 distinct; e.g. `customer service`, `other`, `price` |  |
| `complaint_text` | text | no |  | 89 distinct; e.g. `Why is your customer service so bad? I submitt...`, `JOOLA SUCKS!!!`, `your legal patent drive for pickleball paddles...` |  |
| `severity` | text | no |  | 3 distinct; e.g. `low`, `high`, `medium` |  |
| `joola_responded` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` | False for every row; the response-tracking loop is not implemented. |
| `joola_response_text` | text | 100% |  | **always NULL** in the sampled rows |  |
| `joola_response_time_mins` | integer | 100% |  | **always NULL** in the sampled rows |  |
| `complained_at` | timestamp without time zone <br>`= now()` | no |  | 105 distinct; e.g. `2026-03-07T22:22:32`, `2026-03-13T21:23:23`, `2026-04-01T18:58:58` |  |

#### `joola_ig_wishlist_items`

Unmet-demand log: comments asking for a product, colour, size or event that JOOLA does not offer, with a summarised request.

| | |
|---|---|
| **Rows** | 93 |
| **Grain** | one row per wishlist comment |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | JOOLA-IG pipeline (OpenAI extraction) - insert |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `comment_id` -> `joola_ig_comments.comment_id` |
| **Date coverage** | `requested_at` 2025-05-11 -> 2026-06-27 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 93 distinct; e.g. `614b6281-0a9d-4a80-b583-0c9271d69ede`, `e377a791-b0f5-4d1b-94a4-e0809cd810d5`, `66282d87-5d79-4483-b419-0f9b466cc8a8` |  |
| `comment_id` | text | no | FK -> `joola_ig_comments.comment_id` | 93 distinct; e.g. `18127674706495443`, `18075326642166854`, `18135277927513457` |  |
| `post_id` | text | no |  | 57 distinct; e.g. `3738918692030692972`, `3855689143263624606`, `DaArN3TRRLH` |  |
| `username` | text | no |  | 87 distinct; e.g. `sliccgaming`, `jcrum49`, `ozeighty8` |  |
| `wishlist_text` | text | no |  | 92 distinct; e.g. `gear up with quality pieces that actually elev...`, `Wish I’d known you were in Dallas! Those are m...`, `Hi Scout love your video. Do you remember me? ...` |  |
| `category` | text | no |  | 2 distinct; e.g. `product`, `general` |  |
| `product_reference` | text | 100% |  | **always NULL** in the sampled rows |  |
| `request_summary` | text | 32% |  | 63 distinct; e.g. `Wish I’d known you were in Dallas! Those are m...`, `Hi Scout love your video. Do you remember me? ...`, `@mayyylane We would love to get this paddle 🥹🥹...` |  |
| `times_similar_requested` | integer <br>`= 1` | no |  | 1 distinct; range 1 .. 1; e.g. `1` |  |
| `requested_at` | timestamp without time zone <br>`= now()` | no |  | 93 distinct; e.g. `2026-03-13T11:48:43`, `2026-03-23T15:59:43`, `2026-03-21T11:42:59` |  |

#### `joola_ig_joola_replies`

Intended log of JOOLA's own replies to comments with response-time measurement. Never populated; `brand_replies` covers a thin slice of the same idea.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per brand reply (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | nothing - never written |
| **Read by** | _no frontend consumer_ |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | _table is empty_ |  |
| `comment_id` | text | - |  | _table is empty_ |  |
| `post_id` | text | - |  | _table is empty_ |  |
| `reply_comment_id` | text | - |  | _table is empty_ |  |
| `original_comment_text` | text | - |  | _table is empty_ |  |
| `original_username` | text | - |  | _table is empty_ |  |
| `reply_text` | text | - |  | _table is empty_ |  |
| `original_topic` | text | - |  | _table is empty_ |  |
| `reply_type` | text | - |  | _table is empty_ |  |
| `original_comment_at` | timestamp without time zone | - |  | _table is empty_ |  |
| `replied_at` | timestamp without time zone | - |  | _table is empty_ |  |
| `response_time_mins` | integer | - |  | _table is empty_ |  |

#### `joola_ig_generated_posts`

Output of the AI post generator for JOOLA Instagram: topic, theme, tone, caption, hashtags, DALL-E image URL, suggested posting slot, predicted engagement band and the reference posts used. Contains one real draft and one test row.

| | |
|---|---|
| **Rows** | 2 |
| **Grain** | one row per generated post draft |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | AI post generator (manual trigger) - insert |
| **Read by** | _no frontend consumer_ |
| **Date coverage** | `created_at` 2026-04-05 -> 2026-05-09; `posted_at` 2026-05-09 -> 2026-05-09 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 2 distinct; e.g. `a6cdf335-bc73-43f8-8320-c8171b081a98`, `ba7c2e65-3acb-4f03-a9e5-b83b7729b8e1` |  |
| `topic` | text | no |  | 2 distinct; e.g. `New JOOLA Pro IV paddle launch for competitive...`, `TEST_paddle launch` |  |
| `theme` | text | no |  | 1 distinct; e.g. `Product Launch` |  |
| `format` | text | no |  | 1 distinct; e.g. `photo` |  |
| `tone` | text | no |  | 1 distinct; e.g. `Exciting & Hype` |  |
| `caption` | text | no |  | 2 distinct; e.g. `🔥 Unleash your competitive spirit with the NEW...`, `Test caption from automated test` |  |
| `hashtags` | text[] | no |  | 2 distinct; e.g. `["joola", "pickleball", "proiv", "competitivee...`, `["#test1", "#test2"]` |  |
| `image_prompt` | text | 100% |  | **always NULL** in the sampled rows |  |
| `image_url` | text | 50% |  | 1 distinct; e.g. `https://oaidalleapiprodscus.blob.core.windows....` |  |
| `best_day` | text | 50% |  | 1 distinct; e.g. `Tuesday` |  |
| `best_time` | text | 50% |  | 1 distinct; e.g. `12:00 AM` |  |
| `predicted_eng_min` | double precision | 50% |  | 1 distinct; range 6.5 .. 6.5; e.g. `6.5` |  |
| `predicted_eng_max` | double precision | 50% |  | 1 distinct; range 10.3 .. 10.3; e.g. `10.3` |  |
| `why_this_works` | text | 50% |  | 1 distinct; e.g. `This caption effectively captures excitement a...` |  |
| `reference_post_ids` | text[] | no |  | 2 distinct; e.g. `["3824728740806654207", "3697650707051401449",...`, `[]` |  |
| `status` | text <br>`= draft` | no |  | 2 distinct; e.g. `draft`, `posted` |  |
| `created_at` | timestamp without time zone <br>`= now()` | no |  | 2 distinct; e.g. `2026-04-05T14:09:51.248521`, `2026-05-09T10:08:09.188028` |  |
| `posted_at` | timestamp without time zone | 50% |  | 1 distinct; e.g. `2026-05-09T10:08:26.603` |  |

### YouTube

Brand channels, videos, comments, transcripts and GPT video analysis.

#### `yt_videos`

Brand YouTube videos: title, URL, thumbnail, duration, view/like/comment counts and Shorts flag. `description`, `tags` and `video_type` are never populated by the current actor.

| | |
|---|---|
| **Rows** | 855 |
| **Grain** | one row per YouTube video |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | `youtube --source scrape-channels` -> `sources/youtube/scrape_channels.py` - upsert on `youtube_video_id` |
| **Read by** | `/v2/youtube`, `/v2/overview` |
| **Foreign keys out** | `channel_id` -> `yt_channels.id`, `brand_id` -> `brands.id` |
| **Referenced by** | `yt_comments.video_id`, `yt_video_analysis.video_id`, `yt_video_transcripts.video_id` |
| **Date coverage** | `published_at` 2015-09-24 -> 2026-09-04; `first_scraped_at` 2026-04-03 -> 2026-09-07; `last_updated_at` 2026-04-03 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `a10cfc4b-28e5-4f8a-bd10-d39edad4cd9d`, `18015551-79b4-48be-a9e6-a5dfa81bd758`, `54b47f48-22a0-433e-8614-c5dc6631d2e5` |  |
| `youtube_video_id` | text | no |  | 800 distinct+; e.g. `nYbvPhxWhTI`, `HC0GVqcpyLg`, `VZMh7cmwAzQ` |  |
| `channel_id` | uuid | no | FK -> `yt_channels.id` | 9 distinct; e.g. `34cb003c-0050-45c0-8c3e-e17a77349007`, `dbbdba99-6876-445f-8f3d-4eb2d68a1504`, `a5dc05de-097a-4417-9c9c-2ebe01394021` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 9 distinct; e.g. `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `f9acc948-f636-4582-a7eb-c98e630fb5cd`, `0926e8fa-34d4-4aa8-96e6-ec01425f0fb1` |  |
| `region` | text <br>`= USA` | no |  | 1 distinct; e.g. `USA` |  |
| `title` | text | no |  | 792 distinct+; e.g. `Engage Axiom Gen3 Paddle — The Reviews Are In…...`, `Inside the Selkirk Sparta Combine: The Fight f...`, `DAY 1: The Grind Begins at the Selkirk Sparta ...` |  |
| `video_url` | text | no |  | 800 distinct+; e.g. `https://www.youtube.com/shorts/nYbvPhxWhTI`, `https://www.youtube.com/shorts/HC0GVqcpyLg`, `https://www.youtube.com/shorts/VZMh7cmwAzQ` |  |
| `thumbnail_url` | text | 0% |  | 798 distinct+; e.g. `https://i.ytimg.com/vi/nYbvPhxWhTI/maxres2.jpg...`, `https://i.ytimg.com/vi/HC0GVqcpyLg/maxresdefau...`, `https://i.ytimg.com/vi/VZMh7cmwAzQ/maxres2.jpg...` |  |
| `published_at` | timestamp with time zone | 0% |  | 798 distinct+; e.g. `2026-09-03T22:59:11+00:00`, `2026-08-28T17:29:24+00:00`, `2026-06-03T16:00:34+00:00` |  |
| `duration_seconds` | integer | no |  | 260 distinct; range 4 .. 3417; e.g. `30`, `7`, `8` |  |
| `video_type` | text | 100% |  | **always NULL** in the sampled rows |  |
| `description` | text | 100% |  | **always NULL** in the sampled rows | Never populated by the current actor. |
| `hashtags` | text[] | 100% |  | **always NULL** in the sampled rows |  |
| `tags` | text[] | 100% |  | **always NULL** in the sampled rows |  |
| `view_count` | bigint <br>`= 0` | no |  | 747 distinct; range 17 .. 5,345,593; e.g. `162`, `33`, `131` |  |
| `like_count` | integer <br>`= 0` | no |  | 139 distinct; range 0 .. 4100; e.g. `0`, `3`, `1` |  |
| `comment_count` | integer <br>`= 0` | no |  | 37 distinct; range 0 .. 145; e.g. `0`, `1`, `2` |  |
| `is_short` | boolean <br>`= False` | no |  | 2 distinct; e.g. `True`, `False` |  |
| `is_sponsored` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `is_live_recording` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `first_scraped_at` | timestamp with time zone <br>`= now()` | no |  | 42 distinct; e.g. `2026-05-24T19:05:09.929684+00:00`, `2026-05-24T18:46:52.785672+00:00`, `2026-04-03T03:11:40.112908+00:00` |  |
| `last_updated_at` | timestamp with time zone <br>`= now()` | no |  | 42 distinct; e.g. `2026-05-24T19:05:09.929684+00:00`, `2026-05-24T18:46:52.785672+00:00`, `2026-04-03T03:11:40.112908+00:00` |  |

#### `yt_comments`

Comments on brand YouTube videos with the standard inline GPT enrichment block. Note `posted_at` is entirely null - the actor does not return comment timestamps, so only `scraped_at` is usable for time filtering.

| | |
|---|---|
| **Rows** | 3,762 |
| **Grain** | one row per YouTube comment |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | `youtube --source scrape-comments`; enriched by `enrichment/ai_enricher`; `brand_id` repaired by `sources/youtube/backfill_brand_id.py` - upsert on `youtube_comment_id`, then PATCH |
| **Read by** | `/v2/community-intel`, `/v2/overview` |
| **Foreign keys out** | `video_id` -> `yt_videos.id`, `brand_id` -> `brands.id` |
| **Referenced by** | `yt_comment_analysis.comment_id` |
| **Date coverage** | `posted_at` 2026-06-09 -> 2026-09-03; `scraped_at` 2026-05-14 -> 2026-09-07; `enriched_at` 2026-05-19 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `684a8f33-9210-4ed9-934e-69569afdcc2c`, `57f442a4-5759-4f92-9ea8-3946fff0d6af`, `4a042221-bf45-4c5a-93e4-4c5dc0abca1c` |  |
| `youtube_comment_id` | text | 100% |  | 1 distinct; e.g. `Ugz-F9Z10M9OgSu6yTR4AaABAg.A0Rx_wROa6-AP4VtmfY...` | Effectively null (one stray value) - not usable as a dedupe key. |
| `video_id` | uuid | no | FK -> `yt_videos.id` | 4 distinct; e.g. `da39bc98-b2a9-4f45-a0a8-3e8c48320ef3`, `ed6fa8a3-922d-41c4-b1d9-3c3cf959dff0`, `b798b5fb-7826-4d16-8a3b-56d734e896fe` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 4 distinct; e.g. `0926e8fa-34d4-4aa8-96e6-ec01425f0fb1`, `38863e89-6ee4-4838-9992-1cbf61b3f235`, `238c76d9-cd72-4632-adac-42e459beab92` |  |
| `commenter_username` | text | 1% |  | 392 distinct; e.g. `@crbnpickleball`, `@GAMMASports`, `@SelkirkSport` |  |
| `comment_text` | text | 1% |  | 475 distinct; e.g. `😂`, `https://www.youtube.com/watch?v=GfVHIM5AB6E`, `🔥` |  |
| `comment_likes` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `is_brand_reply` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `reply_to_comment_id` | text | 100% |  | **always NULL** in the sampled rows |  |
| `posted_at` | timestamp with time zone | 100% |  | **always NULL** in the sampled rows | Null for every row - the actor does not return comment timestamps. Time-filter on `scraped_at` instead. |
| `scraped_at` | timestamp with time zone <br>`= now()` | no |  | 8 distinct; e.g. `2026-05-14T18:21:50.614819+00:00`, `2026-05-14T16:41:38.806642+00:00`, `2026-05-14T22:07:51.427657+00:00` |  |
| `sentiment_score` | numeric | 2% |  | 14 distinct; range -1 .. 1; e.g. `0.0`, `0.5`, `-0.5` |  |
| `sentiment_label` | text | no |  | 5 distinct; e.g. `neutral`, `positive`, `negative` |  |
| `topics` | jsonb | 2% |  | 234 distinct; e.g. `[]`, `["paddle-review"]`, `["player-praise"]` |  |
| `brands_mentioned` | text[] | 2% |  | 15 distinct; e.g. `[]`, `["gamma"]`, `["joola"]` |  |
| `players_mentioned` | text[] | 2% |  | 13 distinct; e.g. `[]`, `["Ben Johns"]`, `["Jack Sock"]` |  |
| `products_mentioned` | text[] | 2% |  | 17 distinct; e.g. `[]`, `["Agassi Pro"]`, `["TFG4"]` |  |
| `is_crisis` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `is_opportunity` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `purchase_intent_score` | numeric | 2% |  | 5 distinct; range 0 .. 1; e.g. `0.0`, `0.8`, `0.5` |  |
| `crisis_keywords` | text[] | 2% |  | 27 distinct; e.g. `[]`, `["bad"]`, `["junk"]` |  |
| `enriched_at` | timestamp with time zone | no |  | 798 distinct+; e.g. `2026-05-19T05:42:46.361029+00:00`, `2026-05-19T05:43:36.436239+00:00`, `2026-05-19T05:43:34.245948+00:00` |  |
| `like_count` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |

#### `yt_channel_weekly`

Weekly channel-level snapshot: subscribers, lifetime views, total videos, uploads that week.

| | |
|---|---|
| **Rows** | 139 |
| **Grain** | one row per (channel, ISO week) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | `youtube --source scrape-channels` - delete+insert per ISO week |
| **Read by** | `/v2/youtube`, `/v2/overview`, `/v2/data-health` |
| **Foreign keys out** | `channel_id` -> `yt_channels.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `scraped_at` 2026-04-03 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 139 distinct; e.g. `b54a5808-66e5-4e34-b5d6-7818a4bc7dc7`, `c42ed248-0648-4de8-914d-34c58417002f`, `5e755339-c901-4100-8dd4-ce33f24d17b2` |  |
| `channel_id` | uuid | no | FK -> `yt_channels.id` | 9 distinct; e.g. `4bcfa712-9622-4457-b231-20ae81f3d4c3`, `f277978b-c053-453c-bf8b-b39c71ea24ba`, `3f557c39-eda5-469c-bc98-b14e3af3cd37` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 9 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `f15b6f97-2390-49e2-92f5-b3868e31da09`, `38863e89-6ee4-4838-9992-1cbf61b3f235` |  |
| `subscribers` | integer | 1% |  | 83 distinct; range 34 .. 142,000; e.g. `358`, `1560`, `35` |  |
| `total_views` | bigint | 7% |  | 129 distinct; range 5742 .. 61,346,735; e.g. `6252`, `917842`, `762615` |  |
| `total_videos` | integer | 1% |  | 67 distinct; range 7 .. 890; e.g. `38`, `7`, `226` |  |
| `videos_uploaded_this_week` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `avg_views_last_10_videos` | integer | 100% |  | **always NULL** in the sampled rows |  |
| `week_number` | integer | no |  | 19 distinct; range 14 .. 37; e.g. `14`, `26`, `27` |  |
| `year` | integer | no |  | 1 distinct; range 2026 .. 2026; e.g. `2026` |  |
| `scraped_at` | timestamp with time zone <br>`= now()` | no |  | 19 distinct; e.g. `2026-04-03T03:56:25.773244+00:00`, `2026-06-28T10:26:48.259524+00:00`, `2026-06-29T06:33:17.465715+00:00` |  |

#### `yt_video_transcripts`

Transcript fetch attempts via an Apify transcript actor. Almost entirely failures - `fetch_status` is `no_transcript`/`error` and `transcript_text` is null for every row, so the table is useful as a failure log, not as text.

| | |
|---|---|
| **Rows** | 139 |
| **Grain** | one row per transcript fetch attempt |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(youtube_video_id)` |
| **Written by** | `youtube --source scrape-transcripts` -> `sources/youtube/scrape_transcripts.py` - upsert on `youtube_video_id` |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `video_id` -> `yt_videos.id`, `brand_id` -> `brands.id` |
| **Referenced by** | `yt_video_analysis.transcript_id` |
| **Date coverage** | `fetched_at` 2026-05-23 -> 2026-06-22; `created_at` 2026-05-23 -> 2026-06-22 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 139 distinct; e.g. `263dd0c3-9869-479f-aed6-8623659a452a`, `db972009-38db-4693-a5e2-b8d044ab8eaf`, `e2563176-1e94-4777-8cec-05d844580e63` |  |
| `video_id` | uuid | NOT NULL | FK -> `yt_videos.id` | 139 distinct; e.g. `f8af1a85-3a7f-43c6-acb8-bea8f22ea63f`, `2c7cd2b8-f63e-45bb-a9e4-c65b7d7e48d9`, `4c3d82e0-1f07-4f03-a86b-00a979875739` |  |
| `youtube_video_id` | text | NOT NULL |  | 139 distinct; e.g. `GfVHIM5AB6E`, `xGCNl58DkjI`, `JfKYQuJLRlM` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 9 distinct; e.g. `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `f9acc948-f636-4582-a7eb-c98e630fb5cd`, `19f54f73-9eaa-40ad-93ad-305c9bad33ff` |  |
| `language` | text | 100% |  | **always NULL** in the sampled rows |  |
| `is_auto_generated` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `transcript_text` | text | 100% |  | **always NULL** in the sampled rows | Null for every row; `fetch_status` explains why (no_transcript / error). |
| `segments` | jsonb | 100% |  | **always NULL** in the sampled rows |  |
| `word_count` | integer | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `char_count` | integer | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `source_actor` | text | no |  | 1 distinct; e.g. `pintostudio/youtube-transcript-scraper` |  |
| `fetch_status` | text <br>`= ok` | NOT NULL |  | 2 distinct; e.g. `no_transcript`, `error` |  |
| `fetch_error` | text | 87% |  | 18 distinct; e.g. `Actor 'pintostudio/youtube-transcript-scraper'...`, `Actor 'pintostudio/youtube-transcript-scraper'...`, `Actor 'pintostudio/youtube-transcript-scraper'...` |  |
| `fetched_at` | timestamp with time zone <br>`= now()` | no |  | 6 distinct; e.g. `2026-05-23T16:21:56.764056+00:00`, `2026-05-24T19:09:21.202177+00:00`, `2026-05-24T18:49:53.453312+00:00` |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 6 distinct; e.g. `2026-05-23T16:21:56.764056+00:00`, `2026-05-24T19:09:21.202177+00:00`, `2026-05-24T18:49:53.453312+00:00` |  |

#### `yt_video_analysis`

GPT analysis of each video: summary, a performance thesis explaining why it did well, performance signals, content type, paid-promo detection, products/brands/players mentioned (with product IDs resolved against the catalogue) and the engagement counts at analysis time.

| | |
|---|---|
| **Rows** | 288 |
| **Grain** | one row per analysed video |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(video_id)` |
| **Written by** | `enrichment --source analyze-videos` -> `enrichment/analyze_videos.py` - upsert on `video_id` |
| **Read by** | `/v2/youtube` (+ `/brand/[slug]`) |
| **Foreign keys out** | `video_id` -> `yt_videos.id`, `brand_id` -> `brands.id`, `transcript_id` -> `yt_video_transcripts.id` |
| **Date coverage** | `enriched_at` 2026-05-23 -> 2026-09-07; `created_at` 2026-05-23 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 288 distinct; e.g. `cd694686-cc6b-4dc3-b120-57615443474f`, `ec1e8125-bdfe-4097-89af-046848f487ca`, `bc57b5ff-3c36-49e1-a12d-547587021f77` |  |
| `video_id` | uuid | NOT NULL | FK -> `yt_videos.id` | 288 distinct; e.g. `f8af1a85-3a7f-43c6-acb8-bea8f22ea63f`, `671c8afd-7fc3-45c7-9e31-95c47c1a9ed9`, `bb909096-62ae-40aa-9410-69683593ab47` |  |
| `youtube_video_id` | text | NOT NULL |  | 288 distinct; e.g. `GfVHIM5AB6E`, `tWm4gdX3Etw`, `BiXKA734oys` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 9 distinct; e.g. `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `19f54f73-9eaa-40ad-93ad-305c9bad33ff`, `f9acc948-f636-4582-a7eb-c98e630fb5cd` |  |
| `transcript_id` | uuid | 100% | FK -> `yt_video_transcripts.id` | **always NULL** in the sampled rows |  |
| `summary` | text | no |  | 287 distinct; e.g. `This video provides a step-by-step assembly gu...`, `This video showcases highlights from a table t...`, `The video features Rob Barnes, co-founder of S...` |  |
| `performance_thesis` | text | no |  | 275 distinct; e.g. `The video likely performed well due to its str...`, `The video likely performed well due to its inf...`, `The video likely performed well due to its str...` |  |
| `performance_signals` | text[] | no |  | 42 distinct; e.g. `["tutorial"]`, `["hook-strong", "tutorial"]`, `["hook-strong", "review"]` |  |
| `content_type` | text | no |  | 9 distinct; e.g. `tutorial`, `review`, `other` |  |
| `is_paid_promo` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `sentiment_label` | text | no |  | 2 distinct; e.g. `positive`, `neutral` |  |
| `sentiment_score` | numeric | no |  | 3 distinct; range 0 .. 0.8; e.g. `0.8`, `0.7`, `0.0` |  |
| `products_mentioned` | text[] | no |  | 5 distinct; e.g. `[]`, `["Z5"]`, `["Perseus", "Scorpeus"]` |  |
| `products_matched_ids` | uuid[] | no |  | 5 distinct; e.g. `[]`, `["af416f27-0f2b-4e10-a7ef-ebbaca581381"]`, `["dcad7f3e-da50-4908-89a3-f7e44e04e41d", "08d6...` |  |
| `brands_mentioned` | text[] | no |  | 16 distinct; e.g. `[]`, `["gamma"]`, `["selkirk"]` |  |
| `players_mentioned` | text[] | no |  | 35 distinct; e.g. `[]`, `["Ben Johns", "Lily Zhang"]`, `["Jodi Elliott"]` |  |
| `topics` | text[] | no |  | 241 distinct; e.g. `["pickleball", "paddle-review"]`, `["pickleball", "paddle", "review"]`, `["unboxing", "stringing-machine"]` |  |
| `is_crisis` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `is_opportunity` | boolean <br>`= False` | no |  | 2 distinct; e.g. `True`, `False` |  |
| `crisis_keywords` | text[] | no |  | 1 distinct; e.g. `[]` |  |
| `view_count_at_analysis` | bigint | no |  | 276 distinct; range 13 .. 1,324,236; e.g. `2045`, `1967`, `1535` |  |
| `like_count_at_analysis` | integer | no |  | 97 distinct; range 0 .. 891; e.g. `3`, `0`, `1` |  |
| `comment_count_at_analysis` | integer | no |  | 34 distinct; range 0 .. 148; e.g. `0`, `1`, `2` |  |
| `model` | text | no |  | 1 distinct; e.g. `gpt-4o-mini` |  |
| `enriched_at` | timestamp with time zone <br>`= now()` | no |  | 288 distinct; e.g. `2026-05-23T16:53:08.123852+00:00`, `2026-05-23T16:53:08.268479+00:00`, `2026-05-23T16:53:09.068937+00:00` |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 288 distinct; e.g. `2026-05-23T16:53:08.123852+00:00`, `2026-05-23T16:53:08.268479+00:00`, `2026-05-23T16:53:09.068937+00:00` |  |

#### `yt_comment_analysis`

Designed as a normalised per-comment analysis table; never populated (enrichment lives inline on `yt_comments`).

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per analysed comment (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | nothing - never written |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `comment_id` -> `yt_comments.id` |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | _table is empty_ |  |
| `comment_id` | uuid | - | FK -> `yt_comments.id` | _table is empty_ |  |
| `sentiment` | text | - |  | _table is empty_ |  |
| `sentiment_score` | double precision | - |  | _table is empty_ |  |
| `theme` | text | - |  | _table is empty_ |  |
| `is_complaint` | boolean <br>`= False` | - |  | _table is empty_ |  |
| `is_purchase_intent` | boolean <br>`= False` | - |  | _table is empty_ |  |
| `is_hype` | boolean <br>`= False` | - |  | _table is empty_ |  |
| `is_question` | boolean <br>`= False` | - |  | _table is empty_ |  |
| `question_text` | text | - |  | _table is empty_ |  |
| `competitor_mentioned` | text | - |  | _table is empty_ |  |
| `competitor_sentiment` | text | - |  | _table is empty_ |  |
| `commenter_type` | text | - |  | _table is empty_ |  |
| `analyzed_at` | timestamp with time zone <br>`= now()` | - |  | _table is empty_ |  |

### TikTok

Brand TikTok accounts, videos, comments and weekly profile snapshots.

#### `tiktok_videos`

Brand TikTok videos with view/like/comment/share counts, duration, thumbnail and the full inline enrichment block. `account_id` is null for ~59% of rows (resolved by handle instead).

| | |
|---|---|
| **Rows** | 1,427 |
| **Grain** | one row per TikTok video |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(tiktok_video_id)` |
| **Written by** | `tiktok --source scrape-videos` -> `sources/tiktok/scrape_videos.py`; enriched by `enrichment/tiktok_enrichment` - upsert on `tiktok_video_id`, then PATCH |
| **Read by** | `/v2/tiktok` |
| **Foreign keys out** | `account_id` -> `tiktok_accounts.id`, `brand_id` -> `brands.id` |
| **Referenced by** | `tiktok_comments.video_id` |
| **Date coverage** | `posted_at` 2022-09-14 -> 2026-09-06; `created_at` 2026-05-19 -> 2026-09-07; `enriched_at` 2026-05-19 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `2ae82e22-1468-493c-98b9-c49749e7fb06`, `0954c345-96ae-4e5d-a25b-a29487ac59b3`, `96a1b285-ea7c-4ca3-ae7b-cf37c8048e56` |  |
| `account_id` | uuid | 59% | FK -> `tiktok_accounts.id` | 8 distinct; e.g. `bf1ae3f9-226e-4f6f-a01f-34bf36db3a20`, `697431d0-a16f-4e95-a4a7-1feed990f9fc`, `c821951e-287b-4438-8bfa-c3c55fe2c878` | Null for ~59% of rows; `handle` is the reliable account link. |
| `brand_id` | uuid | no | FK -> `brands.id` | 8 distinct; e.g. `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `f9acc948-f636-4582-a7eb-c98e630fb5cd`, `f8cb05a4-4de3-41a5-9c52-1ee7f5443926` |  |
| `handle` | text | no |  | 8 distinct; e.g. `selkirksport`, `crbnpickleball`, `sixzeropickleball` |  |
| `tiktok_video_id` | text | no |  | 800 distinct+; e.g. `7677788727120235789`, `7649955131714293023`, `7675446163943722254` |  |
| `video_url` | text | no |  | 800 distinct+; e.g. `https://www.tiktok.com/@sixzeropickleball/vide...`, `https://www.tiktok.com/@engage_pickleball/vide...`, `https://www.tiktok.com/@joolapickleball/video/...` |  |
| `text` | text | 2% |  | 778 distinct; e.g. `Save this video & send to your drill partner t...`, `Zane always puts on a show 🔥`, `"Pickleball is my therapy"` |  |
| `view_count` | bigint <br>`= 0` | no |  | 750 distinct; range 53 .. 1,100,000; e.g. `1305`, `2077`, `10700` |  |
| `like_count` | integer <br>`= 0` | no |  | 248 distinct; range 0 .. 60,200; e.g. `10`, `25`, `8` |  |
| `comment_count` | integer <br>`= 0` | no |  | 40 distinct; range 0 .. 2062; e.g. `0`, `1`, `2` |  |
| `share_count` | integer <br>`= 0` | no |  | 128 distinct; range 0 .. 26,900; e.g. `0`, `1`, `2` |  |
| `duration_seconds` | integer | 3% |  | 99 distinct; range 0 .. 343; e.g. `7`, `8`, `10` |  |
| `thumbnail_url` | text | 41% |  | 470 distinct; e.g. `https://p16-common-sign.tiktokcdn-us.com/tos-u...`, `https://p16-common-sign.tiktokcdn-us.com/tos-u...`, `https://p19-common-sign.tiktokcdn-us.com/tos-u...` |  |
| `posted_at` | timestamp with time zone | no |  | 800 distinct+; e.g. `2026-08-29T15:40:00+00:00`, `2026-06-11T02:13:17+00:00`, `2026-08-18T18:51:33+00:00` |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 22 distinct; e.g. `2026-05-19T05:22:55.860237+00:00`, `2026-05-19T05:22:55.122575+00:00`, `2026-05-24T13:49:32.779238+00:00` |  |
| `sentiment_score` | numeric | 2% |  | 10 distinct; range -1 .. 1; e.g. `0.0`, `0.8`, `0.5` |  |
| `sentiment_label` | text | no |  | 5 distinct; e.g. `positive`, `neutral`, `very_positive` |  |
| `topics` | jsonb | 2% |  | 498 distinct; e.g. `[]`, `["paddle-review"]`, `["product-launch", "buying-intent"]` |  |
| `brands_mentioned` | text[] | 2% |  | 13 distinct; e.g. `[]`, `["joola"]`, `["selkirk"]` |  |
| `players_mentioned` | text[] | 2% |  | 77 distinct; e.g. `[]`, `["Zane Navratil"]`, `["Jack Sock"]` |  |
| `products_mentioned` | text[] | 2% |  | 76 distinct; e.g. `[]`, `["Boomstik"]`, `["X2"]` |  |
| `is_crisis` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `is_opportunity` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `purchase_intent_score` | numeric | 2% |  | 7 distinct; range 0 .. 1; e.g. `0.0`, `0.7`, `0.9` |  |
| `crisis_keywords` | text[] | 2% |  | 7 distinct; e.g. `[]`, `["cheating"]`, `["built to fail", "outdated technology", "fail...` |  |
| `enriched_at` | timestamp with time zone | no |  | 800 distinct+; e.g. `2026-08-31T07:59:47.565967+00:00`, `2026-06-15T07:28:18.77512+00:00`, `2026-08-24T03:14:29.126584+00:00` |  |

#### `tiktok_comments`

Comments on brand TikTok videos, enriched inline. Feeds `mention_facts` as channel `tiktok_comment`.

| | |
|---|---|
| **Rows** | 1,021 |
| **Grain** | one row per TikTok comment |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(tiktok_comment_id)` |
| **Written by** | `tiktok --source scrape-comments` -> `sources/tiktok/scrape_comments.py`; enriched by `enrichment` - upsert on `tiktok_comment_id`, then PATCH |
| **Read by** | `/v2/tiktok`, `/v2/community-intel`, `/v2/data-health` |
| **Foreign keys out** | `video_id` -> `tiktok_videos.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `posted_at` 2023-06-28 -> 2026-09-07; `scraped_at` 2026-05-25 -> 2026-09-07; `enriched_at` 2026-05-25 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `3df9f259-dc41-44be-8225-1a49f0631e79`, `a50382d8-e769-4737-b3f0-edfa4382a7ce`, `b4054ff5-4bb7-45c4-befa-28523e8b83b4` |  |
| `tiktok_comment_id` | text | no |  | 800 distinct+; e.g. `7648029836196037406`, `7609782935420093197`, `7655868794296058654` |  |
| `video_id` | uuid | no | FK -> `tiktok_videos.id` | 214 distinct; e.g. `90650b94-c484-4455-bdc4-6bc685216791`, `6dc947e1-2473-4fdc-be51-b26347f7d514`, `5c1f8fe7-03a5-4b48-8b19-5a6189b67e27` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 6 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `f9acc948-f636-4582-a7eb-c98e630fb5cd`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec` |  |
| `commenter_username` | text | no |  | 639 distinct; e.g. `pauley_67`, `ewunleashed`, `declan8.1` |  |
| `comment_text` | text | 2% |  | 716 distinct; e.g. `😂😂😂`, `😁😁😁`, `🤣🤣🤣` |  |
| `comment_likes` | integer <br>`= 0` | no |  | 26 distinct; range 0 .. 5751; e.g. `0`, `1`, `2` |  |
| `reply_to_comment_id` | text | 100% |  | **always NULL** in the sampled rows |  |
| `posted_at` | timestamp with time zone | no |  | 800 distinct+; e.g. `2026-06-05T21:42:36+00:00`, `2026-02-22T20:04:47+00:00`, `2026-06-27T00:41:18+00:00` |  |
| `scraped_at` | timestamp with time zone <br>`= now()` | no |  | 77 distinct; e.g. `2026-06-28T06:37:24.000538+00:00`, `2026-05-25T01:27:05.996042+00:00`, `2026-06-01T06:34:42.255961+00:00` |  |
| `sentiment_score` | numeric | 4% |  | 13 distinct; range -1 .. 1; e.g. `0.0`, `0.5`, `0.8` |  |
| `sentiment_label` | text | 0% |  | 5 distinct; e.g. `neutral`, `positive`, `very_positive` |  |
| `topics` | text[] | no |  | 372 distinct; e.g. `[]`, `["community"]`, `["pickleball", "product-request"]` |  |
| `brands_mentioned` | text[] | no |  | 8 distinct; e.g. `[]`, `["joola"]`, `["selkirk"]` |  |
| `players_mentioned` | text[] | no |  | 15 distinct; e.g. `[]`, `["Ben Johns"]`, `["Tyson McGuffin"]` |  |
| `products_mentioned` | text[] | no |  | 28 distinct; e.g. `[]`, `["Perseus"]`, `["Omni"]` |  |
| `is_crisis` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `is_opportunity` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `purchase_intent_score` | numeric <br>`= 0` | no |  | 8 distinct; range 0 .. 1; e.g. `0.0`, `0.7`, `0.8` |  |
| `crisis_keywords` | text[] | no |  | 24 distinct; e.g. `[]`, `["broke"]`, `["failure", "defect"]` |  |
| `enriched_at` | timestamp with time zone | no |  | 799 distinct+; e.g. `2026-05-25T01:27:31.768447+00:00`, `2026-06-08T06:50:37.812922+00:00`, `2026-06-01T07:06:54.597507+00:00` |  |
| `is_brand_reply` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |

#### `tiktok_profiles_weekly`

Weekly TikTok profile snapshot: followers, following, video count and lifetime hearts.

| | |
|---|---|
| **Rows** | 136 |
| **Grain** | one row per (account, ISO week) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | none |
| **Written by** | `tiktok --source scrape-videos` - delete+insert per ISO week |
| **Read by** | `/v2/tiktok`, `/v2/data-health` |
| **Foreign keys out** | `account_id` -> `tiktok_accounts.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `scraped_at` 2026-05-24 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 136 distinct; e.g. `e20efb46-c8c4-48ee-93ff-66c0d189644e`, `8a54f97c-04a7-4aa8-a0d4-930ba3d47fc8`, `a4637108-10a7-4770-a740-7c825ef18225` |  |
| `account_id` | uuid | no | FK -> `tiktok_accounts.id` | 8 distinct; e.g. `f5e5739d-6c0e-46c7-8e86-d834dfa27370`, `afc43b4e-887f-476c-9352-1c904b595d0d`, `906804b3-8b53-4dc0-b5c6-eced305cf1ae` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 8 distinct; e.g. `38863e89-6ee4-4838-9992-1cbf61b3f235`, `f8cb05a4-4de3-41a5-9c52-1ee7f5443926`, `0926e8fa-34d4-4aa8-96e6-ec01425f0fb1` |  |
| `handle` | text | no |  | 8 distinct; e.g. `wilsonsportinggoods`, `sixzeropickleball`, `engage_pickleball` |  |
| `followers` | integer | no |  | 113 distinct; range 1371 .. 20,400; e.g. `1372`, `1933`, `1373` |  |
| `following` | integer | no |  | 15 distinct; range 3 .. 51; e.g. `4`, `5`, `3` |  |
| `video_count` | integer | no |  | 71 distinct; range 3 .. 669; e.g. `3`, `66`, `68` |  |
| `total_hearts` | bigint | no |  | 86 distinct; range 1585 .. 540,800; e.g. `19000`, `44400`, `44500` |  |
| `is_verified` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `week_number` | integer | no |  | 17 distinct; range 21 .. 37; e.g. `26`, `27`, `21` |  |
| `year` | integer | no |  | 1 distinct; range 2026 .. 2026; e.g. `2026` |  |
| `scraped_at` | timestamp with time zone <br>`= now()` | no |  | 17 distinct; e.g. `2026-06-28T06:35:10.623162+00:00`, `2026-06-29T06:21:47.83523+00:00`, `2026-05-24T13:49:31.874592+00:00` |  |

### X / Twitter

Brand X accounts, posts, replies and weekly profile snapshots.

#### `x_posts`

Brand posts on X with like/retweet/reply/view counts and inline enrichment. History reaches back to 2016 because the actor pulls full timelines.

| | |
|---|---|
| **Rows** | 483 |
| **Grain** | one row per tweet |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(tweet_id)` |
| **Written by** | `twitter --source scrape-brand-posts` -> `sources/twitter/scrape_brand_posts.py`; enriched by `enrichment/twitter_enrichment` - upsert on `tweet_id`, then PATCH |
| **Read by** | `/v2/twitter` |
| **Foreign keys out** | `account_id` -> `x_accounts.id`, `brand_id` -> `brands.id` |
| **Referenced by** | `x_replies.post_id` |
| **Date coverage** | `posted_at` 2016-03-05 -> 2026-09-04; `created_at` 2026-05-19 -> 2026-09-07; `enriched_at` 2026-05-19 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 483 distinct; e.g. `dd00fb3f-1b0f-49ed-8a64-d59fe8ad9409`, `be96987b-75f9-4a33-9096-765ce2fa8c23`, `6d67a8cf-b6d3-4889-9331-45e55b380464` |  |
| `account_id` | uuid | 59% | FK -> `x_accounts.id` | 5 distinct; e.g. `716c41b5-5d2c-48c4-949e-6d07ac14b8dc`, `fb5c25ea-30fb-48b2-a808-c08c87291c2b`, `50aa93bf-6e81-40a3-957c-7facad226249` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 6 distinct; e.g. `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `238c76d9-cd72-4632-adac-42e459beab92`, `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `handle` | text | no |  | 8 distinct; e.g. `SelkirkSport`, `OnixPickleball`, `selkirksport` |  |
| `tweet_id` | text | no |  | 483 distinct; e.g. `1984100015690719272`, `1867600617645977901`, `1867606719834058780` |  |
| `post_url` | text | no |  | 483 distinct; e.g. `https://x.com/SelkirkSport/status/198410001569...`, `https://x.com/OnixPickleball/status/1867600617...`, `https://x.com/OnixPickleball/status/1867606719...` |  |
| `text` | text | no |  | 483 distinct; e.g. `"After Christmas, I would get a new racket and...`, `Perfect for pickleball play - our 40 oz. water...`, `Team ONIX pro Erica Gonzalez took home the Gol...` |  |
| `like_count` | integer <br>`= 0` | no |  | 29 distinct; range 0 .. 8547; e.g. `0`, `1`, `2` |  |
| `retweet_count` | integer <br>`= 0` | no |  | 11 distinct; range 0 .. 1457; e.g. `0`, `1`, `2` |  |
| `reply_count` | integer <br>`= 0` | no |  | 10 distinct; range 0 .. 236; e.g. `0`, `1`, `2` |  |
| `view_count` | integer <br>`= 0` | no |  | 326 distinct; range 0 .. 840,646; e.g. `0`, `105`, `86` |  |
| `posted_at` | timestamp with time zone | no |  | 482 distinct; e.g. `2016-10-04T15:39:13+00:00`, `2025-10-31T03:28:01+00:00`, `2024-12-13T16:01:00+00:00` |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 19 distinct; e.g. `2026-05-19T03:16:19.878028+00:00`, `2026-05-21T07:00:01.452198+00:00`, `2026-06-18T11:32:35.679033+00:00` |  |
| `sentiment_score` | numeric | no |  | 9 distinct; range -1 .. 1; e.g. `0.8`, `0.5`, `0.0` |  |
| `sentiment_label` | text | no |  | 5 distinct; e.g. `positive`, `neutral`, `very_positive` |  |
| `topics` | jsonb | no |  | 351 distinct; e.g. `[]`, `["paddle-review", "product-launch"]`, `["tournament-win", "paddle-mention"]` |  |
| `brands_mentioned` | text[] | no |  | 9 distinct; e.g. `[]`, `["onix"]`, `["selkirk"]` |  |
| `players_mentioned` | text[] | no |  | 58 distinct; e.g. `[]`, `["Jack Sock"]`, `["Ben Johns"]` |  |
| `products_mentioned` | text[] | no |  | 49 distinct; e.g. `[]`, `["Evoke"]`, `["Boomstik"]` |  |
| `is_crisis` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `is_opportunity` | boolean <br>`= False` | no |  | 2 distinct; e.g. `True`, `False` |  |
| `purchase_intent_score` | numeric | no |  | 6 distinct; range 0 .. 1; e.g. `0.0`, `0.7`, `0.9` |  |
| `crisis_keywords` | text[] | no |  | 7 distinct; e.g. `[]`, `["overpriced", "won't send back"]`, `["down", "lasted"]` |  |
| `enriched_at` | timestamp with time zone | no |  | 480 distinct; e.g. `2026-05-23T14:30:16.276761+00:00`, `2026-05-19T05:57:36.4663+00:00`, `2026-05-19T05:57:56.41529+00:00` |  |

#### `x_replies`

Replies to brand tweets. Barely populated (4 rows) and not enriched - effectively a stub.

| | |
|---|---|
| **Rows** | 4 |
| **Grain** | one row per reply |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | one-off script (not in the weekly pipeline) - insert |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `post_id` -> `x_posts.id` |
| **Date coverage** | `posted_at` 2023-02-20 -> 2023-08-03; `scraped_at` 2026-05-30 -> 2026-05-30 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 4 distinct; e.g. `b46e2dcc-f552-4ff6-a971-bc7aec2774a9`, `bab46031-09af-408c-a510-b83db670a9e7`, `4b11cce9-402d-472e-94b8-273df0b904b0` |  |
| `tweet_reply_id` | text | NOT NULL |  | 4 distinct; e.g. `1687070203710943233`, `1685332007398576128`, `1662189655519838238` |  |
| `post_id` | uuid | no | FK -> `x_posts.id` | 2 distinct; e.g. `00f79dd0-2454-4ec0-a537-5d35aba4939d`, `777cfe4e-7f9a-41b4-8d73-1ce598e42a12` |  |
| `brand_id` | uuid | NOT NULL |  | 1 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `replier_username` | text | no |  | 3 distinct; e.g. `joolapickleball`, `barretph`, `mje359` |  |
| `reply_text` | text | no |  | 4 distinct; e.g. `@barretph @MajorLeaguePB @BenJohns_pb @Officia...`, `@joolapickleball @MajorLeaguePB @BenJohns_pb @...`, `@joolapickleball @MajorLeaguePB @BenJohns_pb @...` |  |
| `reply_likes` | integer <br>`= 0` | no |  | 2 distinct; range 0 .. 1; e.g. `0`, `1` |  |
| `retweet_count` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `is_brand_reply` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `posted_at` | timestamp with time zone | no |  | 4 distinct; e.g. `2023-08-03T11:57:35+00:00`, `2023-07-29T16:50:37+00:00`, `2023-05-26T20:11:10+00:00` |  |
| `scraped_at` | timestamp with time zone <br>`= now()` | no |  | 2 distinct; e.g. `2026-05-30T07:34:18.171461+00:00`, `2026-05-30T07:35:41.215353+00:00` |  |
| `sentiment_label` | text | 100% |  | **always NULL** in the sampled rows |  |
| `sentiment_score` | numeric | 100% |  | **always NULL** in the sampled rows |  |
| `topics` | text[] | 100% |  | **always NULL** in the sampled rows |  |
| `is_crisis` | boolean | 100% |  | **always NULL** in the sampled rows |  |
| `is_opportunity` | boolean | 100% |  | **always NULL** in the sampled rows |  |

#### `x_profiles_weekly`

Weekly X profile snapshot: followers, following, tweet count.

| | |
|---|---|
| **Rows** | 84 |
| **Grain** | one row per (account, ISO week) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | none |
| **Written by** | `twitter --source scrape-brand-posts` - delete+insert per ISO week |
| **Read by** | `/v2/twitter` |
| **Foreign keys out** | `account_id` -> `x_accounts.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `scraped_at` 2026-05-24 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 84 distinct; e.g. `8918313b-a6c6-4b3d-9631-bc2402daaebc`, `a8f737c8-a2b6-4a8f-8835-605e41a6edc6`, `c96ba0e2-37c2-46c3-b389-e0f7a2a14423` |  |
| `account_id` | uuid | no | FK -> `x_accounts.id` | 5 distinct; e.g. `716c41b5-5d2c-48c4-949e-6d07ac14b8dc`, `50aa93bf-6e81-40a3-957c-7facad226249`, `fb5c25ea-30fb-48b2-a808-c08c87291c2b` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 5 distinct; e.g. `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `19f54f73-9eaa-40ad-93ad-305c9bad33ff`, `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `handle` | text | no |  | 5 distinct; e.g. `selkirksport`, `gammapickleball`, `joolapickleball` |  |
| `followers` | integer | 1% |  | 49 distinct; range 249 .. 9481; e.g. `252`, `1242`, `1239` |  |
| `following` | integer | 1% |  | 7 distinct; range 28 .. 473; e.g. `28`, `43`, `127` |  |
| `tweet_count` | integer | 1% |  | 19 distinct; range 27 .. 4928; e.g. `3279`, `27`, `42` |  |
| `is_verified` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `week_number` | integer | no |  | 17 distinct; range 21 .. 37; e.g. `26`, `27`, `28` |  |
| `year` | integer | no |  | 1 distinct; range 2026 .. 2026; e.g. `2026` |  |
| `scraped_at` | timestamp with time zone <br>`= now()` | no |  | 17 distinct; e.g. `2026-06-28T10:10:56.847606+00:00`, `2026-06-29T06:20:31.279497+00:00`, `2026-07-06T06:07:52.534717+00:00` |  |

### Reddit

Organic brand conversation from r/Pickleball and neighbours - the richest competitor-switch and complaint source in the database.

#### `reddit_mentions`

Reddit posts and comments that mention a tracked brand, found by keyword search using `brands.reddit_keywords`. Carries the full enrichment block plus the explicit `competitor_switch_from`/`competitor_switch_to` extraction that powers the switching analysis.

| | |
|---|---|
| **Rows** | 1,218 |
| **Grain** | one row per Reddit post/comment mentioning a brand |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(reddit_post_id, brand_id)` (added by `004`) |
| **Written by** | `reddit --source scrape-mentions` -> `sources/reddit/scrape_mentions.py`; enriched by `enrichment/ai_enricher` + `reddit_backfill` - upsert on `reddit_post_id,brand_id`, then PATCH |
| **Read by** | `/v2/reddit`, `/v2/overview`, `/v2/community-intel` |
| **Foreign keys out** | `brand_id` -> `brands.id` |
| **Referenced by** | `reddit_comments.parent_post_id` |
| **Date coverage** | `posted_at` 2025-04-11 -> 2026-09-07; `scraped_at` 2026-04-03 -> 2026-09-07; `enriched_at` 2026-05-30 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `fe87612a-ff3b-4b6f-9109-212e2f4667c5`, `eeb8569d-2cff-4734-b3a3-83f658eebb5c`, `184d425f-e156-4ec8-b782-28126aeacf5c` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 11 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `f8cb05a4-4de3-41a5-9c52-1ee7f5443926` |  |
| `reddit_post_id` | text | no |  | 730 distinct; e.g. `t3_1tazrbj`, `t3_1sk8j79`, `t3_t1_ompre01` |  |
| `subreddit` | text | no |  | 47 distinct; e.g. `r/Pickleball`, `pickleball`, `r/PickleballPhilippines` | Mixed formatting ('r/Pickleball' and 'pickleball') - normalise before grouping. |
| `country_code` | text <br>`= US` | no |  | 1 distinct; e.g. `US` |  |
| `post_title` | text | 35% |  | 420 distinct; e.g. `r/Pickleball Community Discounts &amp; Deals`, `/u/masterz13 on JOOLA Patent Lawsuit: Settleme...`, `Pickleball Pasabuys! Refer and earn too :)` |  |
| `post_url` | text | no |  | 730 distinct; e.g. `https://www.reddit.com/r/PickleballEquip/comme...`, `https://www.reddit.com/r/CebuClassifieds/comme...`, `https://www.reddit.com/r/Pickleball/comments/1...` |  |
| `content_type` | text | no |  | 2 distinct; e.g. `Post`, `Comment` |  |
| `content_text` | text | no |  | 709 distinct; e.g. `&#32; submitted by &#32;  /u/thedealsguy_   [l...`, `Transparency Notice  Links or codes in this th...`, `currently in vietnam accepting pickleball pasa...` |  |
| `author` | text | 20% |  | 374 distinct; e.g. `thedealsguy_`, `kabob21`, `johanas25` |  |
| `upvotes` | integer <br>`= 0` | no |  | 32 distinct; range -6 .. 1793; e.g. `0`, `1`, `2` |  |
| `posted_at` | timestamp with time zone | no |  | 728 distinct; e.g. `2026-05-12T12:12:32+00:00`, `2026-04-13T11:52:24+00:00`, `2026-05-19T18:08:21+00:00` |  |
| `sentiment` | text | 44% |  | 3 distinct; e.g. `neutral`, `positive`, `negative` |  |
| `competitor_switch` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `switch_direction` | text | 100% |  | **always NULL** in the sampled rows |  |
| `scraped_at` | timestamp with time zone <br>`= now()` | no |  | 28 distinct; e.g. `2026-04-03T05:57:20.748543+00:00`, `2026-06-01T06:34:26.713366+00:00`, `2026-05-14T15:40:42.334507+00:00` |  |
| `topics` | text[] | no |  | 343 distinct; e.g. `["general"]`, `["purchase_intent"]`, `["product_review"]` |  |
| `brands_mentioned` | text[] | no |  | 110 distinct; e.g. `["selkirk"]`, `["joola"]`, `[]` |  |
| `players_mentioned` | text[] | no |  | 20 distinct; e.g. `[]`, `["Ben Johns"]`, `["ben johns"]` |  |
| `is_crisis` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `is_opportunity` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `sentiment_score` | numeric | no |  | 17 distinct; range -1 .. 1; e.g. `0.0`, `0.5`, `-0.5` |  |
| `sentiment_label` | text | no |  | 5 distinct; e.g. `neutral`, `positive`, `negative` |  |
| `products_mentioned` | text[] | no |  | 179 distinct; e.g. `[]`, `["Scorpeus"]`, `["Perseus"]` |  |
| `purchase_intent_score` | numeric | no |  | 10 distinct; range 0 .. 1; e.g. `0.0`, `0.8`, `0.7` |  |
| `competitor_switch_from` | text | 95% |  | 14 distinct; e.g. `franklin`, `paddletek`, `joola` |  |
| `competitor_switch_to` | text | 92% |  | 20 distinct; e.g. `joola`, `selkirk`, `six-zero` | Free-text brand slug extracted by the enricher; `competitor_switch_events` is the normalised version. |
| `crisis_keywords` | text[] | no |  | 60 distinct; e.g. `[]`, `["fake"]`, `["trustworthy", "bribe", "manipulate", "defect...` |  |
| `enriched_at` | timestamp with time zone | no |  | 353 distinct; e.g. `2026-05-30T05:18:00.987289+00:00`, `2026-05-30T05:32:31.770988+00:00`, `2026-05-30T05:17:14.315292+00:00` |  |
| `upvotes_last_scrape` | integer | 100% |  | **always NULL** in the sampled rows |  |
| `velocity_per_hour` | numeric | 100% |  | **always NULL** in the sampled rows |  |
| `awards` | jsonb | 100% |  | **always NULL** in the sampled rows |  |
| `is_removed` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |

#### `reddit_comments`

Comment-level Reddit capture with thread depth and its own enrichment. `parent_post_id` is almost always null - comments are linked by `reddit_comment_id`/URL rather than FK, so do not rely on the join.

| | |
|---|---|
| **Rows** | 2,849 |
| **Grain** | one row per Reddit comment |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(reddit_comment_id)` |
| **Written by** | `reddit --source scrape-comments` -> `sources/reddit/scrape_comments.py`; enriched by `enrichment` - upsert on `reddit_comment_id`, then PATCH |
| **Read by** | `/v2/reddit`, `/v2/community-intel` |
| **Foreign keys out** | `parent_post_id` -> `reddit_mentions.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `posted_at` 2025-04-11 -> 2026-09-07; `created_at` 2026-05-19 -> 2026-09-07; `enriched_at` 2026-05-19 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `01efc3b2-5e41-4402-831f-a5d76a54a601`, `57506fe3-08de-4e7e-8849-caa2a9506227`, `9d706c6c-f87d-4b0a-b509-073a594729ba` |  |
| `parent_post_id` | uuid | 1% | FK -> `reddit_mentions.id` | 1 distinct; e.g. `ee893558-f4cc-4597-aba2-0006a7c8f959` | Populated for ~1% of rows - do not rely on this FK to rebuild threads. |
| `reddit_comment_id` | text | NOT NULL |  | 800 distinct+; e.g. `t1_nlt8n6u`, `t1_o46txik`, `t1_okph19m` |  |
| `brand_id` | uuid | 1% | FK -> `brands.id` | 1 distinct; e.g. `19f54f73-9eaa-40ad-93ad-305c9bad33ff` |  |
| `subreddit` | text | 1% |  | 1 distinct; e.g. `r/Pickleball` |  |
| `author` | text | 1% |  | 449 distinct; e.g. `[deleted]`, `Erk1024`, `Mojo2090` |  |
| `comment_text` | text | no |  | 773 distinct; e.g. `[deleted]`, `[removed]`, `Posts self promoting or directly advertising f...` |  |
| `upvotes` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `depth` | integer <br>`= 0` | no |  | 2 distinct; range 0 .. 1; e.g. `0`, `1` |  |
| `posted_at` | timestamp with time zone | no |  | 800 distinct+; e.g. `2025-10-28T11:43:08+00:00`, `2026-02-08T02:51:57+00:00`, `2026-05-08T20:31:14+00:00` |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 8 distinct; e.g. `2026-05-19T07:08:56.377754+00:00`, `2026-05-19T07:08:59.050078+00:00`, `2026-05-19T07:09:01.520233+00:00` |  |
| `sentiment_score` | numeric | 3% |  | 17 distinct; range -1 .. 1; e.g. `0.0`, `-0.5`, `0.5` |  |
| `sentiment_label` | text | 3% |  | 5 distinct; e.g. `neutral`, `positive`, `negative` |  |
| `topics` | jsonb | 3% |  | 306 distinct; e.g. `[]`, `["paddle-review"]`, `["paddle-review", "buying-intent"]` |  |
| `brands_mentioned` | text[] | 3% |  | 32 distinct; e.g. `[]`, `["paddletek"]`, `["joola"]` |  |
| `players_mentioned` | text[] | 3% |  | 17 distinct; e.g. `[]`, `["Anna Leigh Waters"]`, `["Ben Johns"]` |  |
| `products_mentioned` | text[] | 3% |  | 58 distinct; e.g. `[]`, `["Bantam TS-5"]`, `["Scorpeus"]` |  |
| `is_crisis` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `is_opportunity` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `purchase_intent_score` | numeric | 3% |  | 7 distinct; range 0 .. 1; e.g. `0.0`, `0.8`, `0.7` |  |
| `competitor_switch_from` | text | 100% |  | **always NULL** in the sampled rows |  |
| `competitor_switch_to` | text | 100% |  | **always NULL** in the sampled rows |  |
| `crisis_keywords` | text[] | 3% |  | 45 distinct; e.g. `[]`, `["core crushing"]`, `["dead spots", "pop dies"]` |  |
| `enriched_at` | timestamp with time zone | no |  | 799 distinct+; e.g. `2026-05-19T07:21:38.213774+00:00`, `2026-05-19T07:16:44.155892+00:00`, `2026-05-19T07:20:52.66975+00:00` |  |

### Influencers & athletes

Sponsored-athlete roster activity on Instagram/TikTok and X, plus weekly follower snapshots.

#### `influencer_posts`

Posts by roster athletes on Instagram/TikTok/X: engagement counts, caption, hashtags, sponsored flag and sentiment. `platform` distinguishes the source.

| | |
|---|---|
| **Rows** | 841 |
| **Grain** | one row per influencer post |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(post_url)` (added by `004`) |
| **Written by** | `instagram --source scrape-influencers` -> `sources/instagram/scrape_influencers.py`; sponsored flag by `enrichment/influencer_sponsored.py` - upsert on `post_url`, then PATCH |
| **Read by** | `/v2/influencers`, `/v2/overview` |
| **Foreign keys out** | `influencer_id` -> `influencers.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `posted_at` 2017-01-17 -> 2026-09-06; `scraped_at` 2026-05-14 -> 2026-09-07; `enriched_at` 2026-05-23 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `89568916-86c7-4608-9a1a-e2de34b3aca4`, `cb9fea03-e540-424a-aef7-b08a9b043760`, `de176a96-dc53-4505-9353-7b7be7d274d0` |  |
| `influencer_id` | uuid | no | FK -> `influencers.id` | 11 distinct; e.g. `db4b18f4-da4b-49fd-a1e8-64b52ea8ae3b`, `1eb20d81-3dff-4fcb-ab0f-be93768af354`, `9a925fc4-d080-4b40-a566-4de9be16f1b9` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 8 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `aa3c414c-9e4b-4925-8732-d19ae5c02a56`, `9f0eb357-eea4-4ab7-9a28-74cbb07940b0` |  |
| `platform` | text | no |  | 3 distinct; e.g. `instagram`, `x`, `tiktok` |  |
| `post_url` | text | no |  | 800 distinct+; e.g. `https://www.instagram.com/p/DaDc6zjRhmS/`, `https://x.com/TysonMcGuffin/status/17883030998...`, `https://www.instagram.com/p/DYBWboEsuvJ/` |  |
| `posted_at` | timestamp with time zone | no |  | 800 distinct+; e.g. `2026-06-26T15:22:38+00:00`, `2024-05-08T20:20:58+00:00`, `2026-05-07T02:45:20+00:00` |  |
| `like_count` | integer <br>`= 0` | no |  | 527 distinct; range -1 .. 92,900; e.g. `0`, `13`, `38` |  |
| `comment_count` | integer <br>`= 0` | no |  | 157 distinct; range 0 .. 843; e.g. `0`, `1`, `2` |  |
| `view_count` | integer <br>`= 0` | 2% |  | 564 distinct; range 0 .. 3,900,000; e.g. `0`, `1446`, `1499` |  |
| `caption` | text | 0% |  | 773 distinct; e.g. `#pickleball #pickleballtiktok #pickleballtourn...`, `#pickleball #pickleballtiktok #pickleballhighl...`, `#pickleballers #pickleballtok #pickleballislif...` |  |
| `hashtags` | text[] | 36% |  | 119 distinct; e.g. `[]`, `["MLPStPete", "MLP2026"]`, `["MLPNewportBeachPlayoffs", "MLP2026"]` |  |
| `is_sponsored` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `sentiment` | text | 2% |  | 5 distinct; e.g. `positive`, `neutral`, `very_positive` |  |
| `scraped_at` | timestamp with time zone <br>`= now()` | no |  | 26 distinct; e.g. `2026-05-21T07:51:34.862844+00:00`, `2026-05-21T07:34:57.586177+00:00`, `2026-05-14T22:15:55.285082+00:00` |  |
| `enriched_at` | timestamp with time zone | no |  | 800 distinct+; e.g. `2026-06-28T06:57:51.744875+00:00`, `2026-05-23T15:42:08.520684+00:00`, `2026-05-23T15:43:52.716068+00:00` |  |

#### `influencer_snapshots`

Weekly follower snapshot per athlete (Instagram; the YouTube column was never filled).

| | |
|---|---|
| **Rows** | 486 |
| **Grain** | one row per (influencer, ISO week) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | `instagram --source scrape-influencers` - delete+insert per ISO week |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `influencer_id` -> `influencers.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `scraped_at` 2026-05-14 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 486 distinct; e.g. `3eb899fd-0ecf-4b6c-8780-db7d99feb462`, `b267c3ed-c3ac-468c-aadf-3cfba183bf85`, `56a40e62-02fe-41a4-81e7-5b3ceeddb269` |  |
| `influencer_id` | uuid | no | FK -> `influencers.id` | 27 distinct; e.g. `5e6d78a0-f0d8-41de-bbe5-401607bdb1c8`, `d72173e1-ea3a-4baf-8f3e-820732b625ea`, `dcb48125-f683-4f1a-8c1c-c7d63551ee13` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 11 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `f9acc948-f636-4582-a7eb-c98e630fb5cd`, `f15b6f97-2390-49e2-92f5-b3868e31da09` |  |
| `follower_count_ig` | integer | 52% |  | 184 distinct; range 0 .. 234,611; e.g. `78`, `0`, `157` |  |
| `follower_count_yt` | integer | 100% |  | **always NULL** in the sampled rows |  |
| `week_number` | integer | no |  | 18 distinct; range 20 .. 37; e.g. `24`, `21`, `22` |  |
| `year` | integer | no |  | 1 distinct; range 2026 .. 2026; e.g. `2026` |  |
| `scraped_at` | timestamp with time zone <br>`= now()` | no |  | 18 distinct; e.g. `2026-06-08T06:23:42.325744+00:00`, `2026-05-23T17:11:03.823813+00:00`, `2026-05-25T06:06:17.244779+00:00` |  |

#### `influencer_x_posts`

Athlete activity on X specifically, with the full enrichment block. Timeline history reaches back to 2009.

| | |
|---|---|
| **Rows** | 749 |
| **Grain** | one row per athlete tweet |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(tweet_id)` |
| **Written by** | `twitter --source scrape-influencer-posts` -> `sources/twitter/scrape_influencer_posts.py`; enriched by `enrichment/ai_enricher` - upsert on `tweet_id`, then PATCH |
| **Read by** | Ask Intel allowlist only - no `.from()` call anywhere |
| **Foreign keys out** | `influencer_id` -> `influencers.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `posted_at` 2009-01-16 -> 2026-05-14; `created_at` 2026-05-19 -> 2026-05-24; `enriched_at` 2026-05-19 -> 2026-05-24 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 749 distinct; e.g. `5769afdc-3aee-426c-8b3c-7a7e8de69368`, `9606e9a6-5c9a-4f31-975d-6c55f3a2e9c6`, `9eccef54-0aac-48a3-9829-7cfd6fd89af9` |  |
| `influencer_id` | uuid | no | FK -> `influencers.id` | 14 distinct; e.g. `db4b18f4-da4b-49fd-a1e8-64b52ea8ae3b`, `d153708c-cc11-41f2-9ae5-1ff626d80d54`, `d2ecfd11-505e-429d-9bf1-aaff1c4dc422` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 8 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `f8cb05a4-4de3-41a5-9c52-1ee7f5443926`, `38863e89-6ee4-4838-9992-1cbf61b3f235` |  |
| `handle` | text | 3% |  | 13 distinct; e.g. `BenJohns_pb`, `JIgnatowich`, `gabejoseph` |  |
| `tweet_id` | text | no |  | 749 distinct; e.g. `290165779603783680`, `160441046986268672`, `1746884185296675210` |  |
| `post_url` | text | 3% |  | 729 distinct; e.g. `https://x.com/AnnaBright/status/29016577960378...`, `https://x.com/AnnaBright/status/16044104698626...`, `https://x.com/AllyceJones/status/1746884185296...` |  |
| `text` | text | no |  | 739 distinct; e.g. `😍 https://t.co/7hJsL94i0p`, `😍 https://t.co/33MMMJGHie`, `😍 https://t.co/EQP0pbu03Z` |  |
| `like_count` | integer <br>`= 0` | no |  | 121 distinct; range 0 .. 218,686; e.g. `0`, `1`, `2` |  |
| `retweet_count` | integer <br>`= 0` | no |  | 44 distinct; range 0 .. 68,612; e.g. `0`, `1`, `2` |  |
| `reply_count` | integer <br>`= 0` | no |  | 41 distinct; range 0 .. 1271; e.g. `0`, `1`, `2` |  |
| `view_count` | integer <br>`= 0` | 9% |  | 402 distinct; range 0 .. 1,583,970; e.g. `0`, `1436`, `1944` |  |
| `posted_at` | timestamp with time zone | no |  | 748 distinct; e.g. `2026-03-09T23:46:56+00:00`, `2013-01-12T18:38:07+00:00`, `2012-01-20T19:18:21+00:00` |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 3 distinct; e.g. `2026-05-19T05:24:06.670252+00:00`, `2026-05-19T05:24:07.394043+00:00`, `2026-05-24T14:18:42.96046+00:00` |  |
| `sentiment_score` | numeric | no |  | 10 distinct; range -1 .. 1; e.g. `0.0`, `0.5`, `0.8` |  |
| `sentiment_label` | text | no |  | 5 distinct; e.g. `neutral`, `positive`, `negative` |  |
| `topics` | jsonb | no |  | 222 distinct; e.g. `[]`, `["paddle-review"]`, `["match-highlights", "player-performance"]` |  |
| `brands_mentioned` | text[] | no |  | 6 distinct; e.g. `[]`, `["joola"]`, `["paddletek"]` |  |
| `products_mentioned` | text[] | no |  | 4 distinct; e.g. `[]`, `["LT 48"]`, `["Double Black Diamond", "DBD"]` |  |
| `is_crisis` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `is_opportunity` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `purchase_intent_score` | numeric | no |  | 4 distinct; range 0 .. 1; e.g. `0.0`, `0.7`, `1.0` |  |
| `enriched_at` | timestamp with time zone | no |  | 744 distinct; e.g. `2026-05-24T18:46:40.139535+00:00`, `2026-05-19T06:07:21.909145+00:00`, `2026-05-19T06:09:48.313825+00:00` |  |

#### `influencer_x_snapshots`

Weekly X follower snapshot per athlete. Captured once (week 21) and not repeated.

| | |
|---|---|
| **Rows** | 13 |
| **Grain** | one row per (influencer, ISO week) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE INDEX only `(influencer_id, week_number, year)` |
| **Written by** | `twitter --source scrape-influencer-posts` - insert (week-keyed) |
| **Read by** | `/v2/influencers` (athlete impact score) |
| **Foreign keys out** | `influencer_id` -> `influencers.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `scraped_at` 2026-05-19 -> 2026-05-19 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 13 distinct; e.g. `a2e0b7ba-65a9-42c1-9e80-0a12b50edad3`, `2a1e0d49-7ad2-41b9-bac1-c747a366e0e7`, `b03e4487-3ab9-49ca-9d61-8ff48d3808e3` |  |
| `influencer_id` | uuid | no | FK -> `influencers.id` | 13 distinct; e.g. `5e8b6d32-263a-4713-9f2a-a0a6ed8de15f`, `c4ddd02b-0206-426e-bd10-a3a57433e470`, `db4b18f4-da4b-49fd-a1e8-64b52ea8ae3b` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 7 distinct; e.g. `f9acc948-f636-4582-a7eb-c98e630fb5cd`, `04db8591-37a3-4634-9d11-536975fa6935`, `9f0eb357-eea4-4ab7-9a28-74cbb07940b0` |  |
| `handle` | text | no |  | 13 distinct; e.g. `AllyceJones`, `AndreiDaescu`, `BenJohns_pb` |  |
| `followers` | integer | no |  | 13 distinct; range 1 .. 12,938; e.g. `810`, `6`, `12938` |  |
| `following` | integer | no |  | 13 distinct; range 0 .. 452; e.g. `55`, `10`, `38` |  |
| `tweet_count` | integer | no |  | 13 distinct; range 1 .. 4296; e.g. `16`, `1`, `685` |  |
| `is_verified` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `week_number` | integer | no |  | 1 distinct; range 21 .. 21; e.g. `21` |  |
| `year` | integer | no |  | 1 distinct; range 2026 .. 2026; e.g. `2026` |  |
| `scraped_at` | timestamp with time zone <br>`= now()` | no |  | 1 distinct; e.g. `2026-05-19T05:24:05.745711+00:00` |  |

### News & market intel

Pickleball trade press and RSS/Google-News ingestion, AI-tagged for JOOLA relevance.

#### `news_articles`

The live news corpus: trade-press and Google-News articles with dedupe hash, JOOLA/competitor mention flags, AI summary, a 'why it matters' line, relevance class, importance score and a suggested action. This is what the news surfaces read.

| | |
|---|---|
| **Rows** | 1,280 |
| **Grain** | one row per article (deduped by `content_hash`) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | `news` -> `sources/news/scrape_news.py` - upsert on `url` |
| **Read by** | _no frontend consumer_ |
| **Referenced by** | `content_drafts.source_article_id` |
| **Date coverage** | `published_at` 2015-07-29 -> 2026-09-06; `scraped_at` 2026-05-16 -> 2026-09-07; `created_at` 2026-05-16 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `ee50f084-173f-45e8-92b3-455aa9e5d642`, `a7eb1b70-92b0-4575-b715-83d6202081c4`, `034fc823-6d9f-478a-8227-a67a0a07924b` |  |
| `url` | text | NOT NULL |  | 800 distinct+; e.g. `https://news.google.com/rss/articles/CBMiogFBV...`, `https://news.google.com/rss/articles/CBMilAFBV...`, `https://pickleball.com/news/breaking-down-the-...` |  |
| `source_site` | text | NOT NULL |  | 267 distinct; e.g. `The Dink Pickleball`, `The Kitchen Pickleball`, `pickleballeffect.com` |  |
| `title` | text | NOT NULL |  | 784 distinct+; e.g. `From pickleball courts to road paving, Frankli...`, `Why Diamond Tough technology changes the game`, `Apollo Sports Capital Leads Landmark $225 Mill...` |  |
| `excerpt` | text <br>`= ` | 2% |  | 771 distinct; e.g. `Major League Pickleball (MLP presented by Door...`, `The Kitchen`, `Alex Lantz` |  |
| `content_text` | text <br>`= ` | 98% |  | 12 distinct; e.g. `Selkirk Sport Men's CourtStrike 2.0 Pickleball...`, `Skip to main content Skip to footer MLP ANNOUN...`, `JOOLA’s First Patent Settlement Could Change T...` |  |
| `author` | text <br>`= ` | 89% |  | 19 distinct; e.g. `k.kocak`, `The Dink Media Team`, `Martin` |  |
| `image_url` | text <br>`= ` | 91% |  | 69 distinct; e.g. `https://images.pickleball.com/news/17788503038...`, `https://cdn.pickleball.com/news/1778727786568/...`, `https://images.pickleball.com/news/17786781694...` |  |
| `published_at` | timestamp with time zone | 8% |  | 548 distinct; e.g. `2026-06-11T07:00:00+00:00`, `2026-05-21T07:00:00+00:00`, `2026-03-23T07:00:00+00:00` |  |
| `scraped_at` | timestamp with time zone | no |  | 162 distinct; e.g. `2026-09-07T06:35:53.519883+00:00`, `2026-08-18T05:09:35.4095+00:00`, `2026-08-31T07:32:14.102332+00:00` |  |
| `is_active` | boolean <br>`= True` | NOT NULL |  | 1 distinct; e.g. `True` |  |
| `is_joola_mention` | boolean <br>`= False` | NOT NULL |  | 2 distinct; e.g. `False`, `True` |  |
| `joola_context` | text <br>`= ` | 99% |  | 5 distinct; e.g. `JOOLA’s First Patent Settlement Could Change T...`, `Draw Reveal: Toys “R” Us PPA Finals The Toys “...`, `For the comprehensive stats of all these gold ...` |  |
| `players_mentioned` | text[] | no |  | 5 distinct; e.g. `[]`, `["Collin Johns"]`, `["Ben Johns", "Anna Bright", "Federico Staksru...` |  |
| `competitors_mentioned` | text[] | no |  | 20 distinct; e.g. `[]`, `["franklin"]`, `["selkirk"]` |  |
| `has_competitor_mention` | boolean <br>`= False` | NOT NULL |  | 2 distinct; e.g. `True`, `False` |  |
| `sentiment` | text <br>`= informative` | no |  | 5 distinct; e.g. `informative`, `positive`, `mixed` |  |
| `sentiment_score` | numeric <br>`= 0` | no |  | 6 distinct; range -1 .. 1; e.g. `0.0`, `1.0`, `-1.0` |  |
| `article_type` | text <br>`= general` | no |  | 3 distinct; e.g. `general`, `product`, `tournament` |  |
| `relevance_type` | text | 80% |  | 5 distinct; e.g. `Industry News`, `Competitive News`, `Direct JOOLA News` |  |
| `importance_score` | numeric <br>`= 0` | no |  | 47 distinct; range 0 .. 93.5; e.g. `0.0`, `16.5`, `17.0` |  |
| `suggested_action` | text <br>`= No action needed` | no |  | 7 distinct; e.g. `No action needed`, `Use for SEO/blog`, `Monitor competitor` |  |
| `ai_summary` | text | 98% |  | 17 distinct; e.g. `Major League Pickleball (MLP) has announced th...`, `Selkirk Sport has launched the Men's CourtStri...`, `Selkirk Sport has launched a limited-edition h...` |  |
| `why_it_matters` | text | 98% |  | 17 distinct; e.g. `This event highlights the growing popularity o...`, `The introduction of a new shoe by a competitor...`, `This development is relevant for JOOLA as it s...` |  |
| `content_hash` | character varying | no |  | 800 distinct+; e.g. `0af07287928a2098427760f0843a1407bb07e01a460e4a...`, `2d20cf5498bb588adc3f1dc9cad2563468dc2f0625acb6...`, `52fa0803bc86cf34221247b2fcb6e41230dbe231da5f1f...` |  |
| `word_count` | integer <br>`= 0` | no |  | 87 distinct; range 2 .. 616; e.g. `9`, `10`, `8` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 165 distinct; e.g. `2026-08-18T05:09:45.294997+00:00`, `2026-08-31T07:32:20.128784+00:00`, `2026-09-07T06:35:58.880118+00:00` |  |

#### `news_mentions`

An earlier, narrower news-mention schema. Superseded by `news_articles` and never populated.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per news mention (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | nothing - never written |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `brand_id` -> `brands.id` |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | _table is empty_ |  |
| `brand_id` | uuid | - | FK -> `brands.id` | _table is empty_ |  |
| `headline` | text | - |  | _table is empty_ |  |
| `source_name` | text | - |  | _table is empty_ |  |
| `source_url` | text | - |  | _table is empty_ |  |
| `article_url` | text | - |  | _table is empty_ |  |
| `published_at` | timestamp with time zone | - |  | _table is empty_ |  |
| `country_code` | text <br>`= US` | - |  | _table is empty_ |  |
| `summary` | text | - |  | _table is empty_ |  |
| `sentiment` | text | - |  | _table is empty_ |  |
| `themes` | text[] | - |  | _table is empty_ |  |
| `is_press_release` | boolean <br>`= False` | - |  | _table is empty_ |  |
| `scraped_at` | timestamp with time zone <br>`= now()` | - |  | _table is empty_ |  |
| `topics` | text[] | - |  | _table is empty_ |  |
| `brands_mentioned` | text[] | - |  | _table is empty_ |  |
| `players_mentioned` | text[] | - |  | _table is empty_ |  |
| `is_crisis` | boolean <br>`= False` | - |  | _table is empty_ |  |
| `is_opportunity` | boolean <br>`= False` | - |  | _table is empty_ |  |
| `thumbnail_url` | text | - |  | _table is empty_ |  |

#### `news_scrape_runs`

Run log for the news scraper: sites attempted vs scraped, articles found/new/with-mentions, per-run success and failure counts.

| | |
|---|---|
| **Rows** | 5 |
| **Grain** | one row per news scrape run |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | `sources/news/scrape_news.py` - insert per run |
| **Read by** | _no frontend consumer_ |
| **Referenced by** | `news_scrape_errors.scrape_run_id` |
| **Date coverage** | `started_at` 2026-05-16 -> 2026-05-17; `finished_at` 2026-05-16 -> 2026-05-17; `created_at` 2026-05-16 -> 2026-05-17 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 5 distinct; e.g. `9b56275a-6321-4511-8504-ab22baf24be3`, `1969fce8-5d8b-49e4-bc77-cba4b9c65007`, `5770276b-eedb-4b0b-89da-457f1c359881` |  |
| `status` | text <br>`= pending` | NOT NULL |  | 1 distinct; e.g. `done` |  |
| `run_type` | text <br>`= manual` | no |  | 2 distinct; e.g. `manual`, `cli` |  |
| `lookback_days` | integer <br>`= 180` | no |  | 1 distinct; range 180 .. 180; e.g. `180` |  |
| `sites_total` | integer <br>`= 0` | NOT NULL |  | 1 distinct; range 20 .. 20; e.g. `20` |  |
| `sites_scraped` | integer <br>`= 0` | NOT NULL |  | 1 distinct; range 20 .. 20; e.g. `20` |  |
| `articles_found` | integer <br>`= 0` | NOT NULL |  | 2 distinct; range 159 .. 160; e.g. `159`, `160` |  |
| `articles_new` | integer <br>`= 0` | NOT NULL |  | 3 distinct; range 7 .. 159; e.g. `17`, `159`, `7` |  |
| `articles_with_mentions` | integer <br>`= 0` | NOT NULL |  | 1 distinct; range 7 .. 7; e.g. `7` |  |
| `joola_related_articles` | integer <br>`= 0` | no |  | 2 distinct; range 7 .. 17; e.g. `7`, `17` |  |
| `successful_sources` | integer <br>`= 0` | no |  | 1 distinct; range 20 .. 20; e.g. `20` |  |
| `failed_sources` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `error_message` | text | 100% |  | **always NULL** in the sampled rows |  |
| `started_at` | timestamp with time zone | no |  | 5 distinct; e.g. `2026-05-17T06:06:53.628553+00:00`, `2026-05-16T13:42:59.552127+00:00`, `2026-05-16T16:06:24.519479+00:00` |  |
| `finished_at` | timestamp with time zone | no |  | 5 distinct; e.g. `2026-05-17T06:09:45.295241+00:00`, `2026-05-16T13:45:26.847427+00:00`, `2026-05-16T16:11:53.55361+00:00` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 5 distinct; e.g. `2026-05-17T06:06:53.119096+00:00`, `2026-05-16T13:42:58.660501+00:00`, `2026-05-16T16:06:23.109136+00:00` |  |

#### `news_scrape_errors`

Per-source error log for news runs. Empty - no news run has failed a source yet.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per source error (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | `sources/news/scrape_news.py` (on failure) - insert |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `scrape_run_id` -> `news_scrape_runs.id` |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | _table is empty_ |  |
| `scrape_run_id` | uuid | - | FK -> `news_scrape_runs.id` | _table is empty_ |  |
| `source_name` | text | NOT NULL |  | _table is empty_ |  |
| `url` | text <br>`= ` | - |  | _table is empty_ |  |
| `error_type` | text <br>`= scrape_error` | - |  | _table is empty_ |  |
| `error_message` | text | - |  | _table is empty_ |  |
| `status_code` | integer | - |  | _table is empty_ |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | _table is empty_ |  |

#### `market_intel_items`

Broader market-intelligence feed (RSS, industry Instagram accounts, websites) AI-tagged for sentiment, topics, brand/player mentions, crisis and opportunity. Older sibling of `news_articles`; frozen since April 2026.

| | |
|---|---|
| **Rows** | 324 |
| **Grain** | one row per intel item |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | market-intel collector (frozen since Apr 2026) - insert |
| **Read by** | `/api/generate-content` route (no UI caller) |
| **Referenced by** | `brand_mentions_external.item_id`, `generated_content.source_item_id` |
| **Date coverage** | `published_at` 2022-11-12 -> 2026-04-05; `scraped_at` 2026-04-05 -> 2026-04-05; `ai_tagged_at` 2026-04-05 -> 2026-04-05 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 324 distinct; e.g. `7efb0a9a-986d-45fb-920e-77d6c9c5db08`, `21efec7a-efcc-4803-9d0f-84b3c6369e11`, `75043080-762f-45f9-8e29-f7190ecd67c2` |  |
| `source_type` | text | NOT NULL |  | 3 distinct; e.g. `rss`, `instagram`, `website` |  |
| `source_name` | text | NOT NULL |  | 27 distinct; e.g. `The Kitchen — News`, `The Kitchen — Gear`, `Google News — Head` |  |
| `source_handle` | text | 56% |  | 12 distinct; e.g. `ppatour`, `pickleballportal`, `pickleballchannel` |  |
| `title` | text | 10% |  | 293 distinct; e.g. `Attention pickleball addicts, here's the paddl...`, `10 Pickleball Tips I Wish I Knew When I First ...`, `A PPA Pro Breaks Down the Backhand Slice Dink` |  |
| `summary` | text | no |  | 321 distinct; e.g. `Major League Pickleball (MLP presented by Door...`, `Attention pickleball addicts, here's the paddl...`, `A 5.0 pickleball player shares 10 game-changin...` |  |
| `original_url` | text | NOT NULL |  | 324 distinct; e.g. `https://www.instagram.com/p/CpJqMbQNPJx/`, `https://www.thedinkpickleball.com/10-picklebal...`, `https://www.thedinkpickleball.com/the-pickleba...` |  |
| `thumbnail_url` | text | 56% |  | 144 distinct; e.g. `https://scontent-ord5-3.cdninstagram.com/v/t51...`, `https://clipping.kinetiq.tv/clipping/download/...`, `https://scontent-ord5-3.cdninstagram.com/v/t51...` |  |
| `author` | text | 56% |  | 12 distinct; e.g. `ppatour`, `pickleballportal`, `pickleballchannel` |  |
| `published_at` | timestamp with time zone | no |  | 285 distinct; e.g. `2026-04-05T08:59:04.843695+00:00`, `2026-03-23T07:00:00+00:00`, `2026-03-24T07:00:00+00:00` |  |
| `scraped_at` | timestamp with time zone <br>`= now()` | no |  | 4 distinct; e.g. `2026-04-05T10:48:14.39064+00:00`, `2026-04-05T08:57:23.159949+00:00`, `2026-04-05T08:59:04.843695+00:00` |  |
| `sentiment` | text | no |  | 3 distinct; e.g. `positive`, `neutral`, `negative` |  |
| `topics` | text[] | 21% |  | 29 distinct; e.g. `["tournament"]`, `["product"]`, `["product", "player"]` |  |
| `brands_mentioned` | text[] | 85% |  | 12 distinct; e.g. `["joola"]`, `["selkirk"]`, `["wilson"]` |  |
| `players_mentioned` | text[] | 91% |  | 17 distinct; e.g. `["Anna Leigh Waters"]`, `["Ben Johns", "Anna Leigh Waters"]`, `["Ben Johns"]` |  |
| `mentions_joola` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `joola_context` | text | 96% |  | 14 distinct; e.g. `The SXY Newport Beach Open presented by Joola ...`, `SXY NEWPORT BEACH OPEN PRESENTED BY JOOLA STOR...`, `SXY Newport Beach Open presented by Joola` |  |
| `joola_sentiment` | text | 95% |  | 2 distinct; e.g. `positive`, `neutral` |  |
| `is_crisis` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `crisis_keywords` | text[] | 94% |  | 13 distinct; e.g. `["dies", "accident"]`, `["bankruptcy"]`, `["dies", "freak accident"]` |  |
| `is_opportunity` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `opportunity_type` | text | 100% |  | **always NULL** in the sampled rows |  |
| `is_trending` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `ai_tagged` | boolean <br>`= False` | no |  | 1 distinct; e.g. `True` |  |
| `ai_tagged_at` | timestamp with time zone | no |  | 3 distinct; e.g. `2026-04-05T09:16:39.961086+00:00`, `2026-04-05T10:48:14.39064+00:00`, `2026-04-05T10:46:48.408769+00:00` |  |

#### `market_trends`

Weekly trending-keyword rollup derived from the intel feed, with associated brands and a content-gap opportunity flag. One week captured only.

| | |
|---|---|
| **Rows** | 8 |
| **Grain** | one row per (keyword, ISO week) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | market-intel collector - insert |
| **Read by** | _no frontend consumer_ |
| **Date coverage** | `created_at` 2026-04-05 -> 2026-04-05; `updated_at` 2026-04-05 -> 2026-04-05 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 8 distinct; e.g. `873b7ab4-b577-46d9-91e9-04b7a9c83157`, `4622da00-e4c3-4698-b84c-6c34e975d646`, `31bd183e-4906-4707-b127-99e8f85f3d6b` |  |
| `week_number` | integer | NOT NULL |  | 1 distinct; range 14 .. 14; e.g. `14` |  |
| `year` | integer | NOT NULL |  | 1 distinct; range 2026 .. 2026; e.g. `2026` |  |
| `keyword` | text | NOT NULL |  | 8 distinct; e.g. `dink`, `selkirk`, `ben johns` |  |
| `mention_count` | integer <br>`= 0` | no |  | 6 distinct; range 2 .. 18; e.g. `7`, `8`, `6` |  |
| `source_count` | integer <br>`= 0` | no |  | 4 distinct; range 1 .. 6; e.g. `2`, `5`, `1` |  |
| `sentiment` | text | no |  | 1 distinct; e.g. `positive` |  |
| `brands_associated` | text[] | 50% |  | 2 distinct; e.g. `["joola"]`, `["selkirk"]` |  |
| `is_joola_relevant` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `opportunity_type` | text | 38% |  | 1 distinct; e.g. `content_gap` |  |
| `sample_urls` | text[] | 100% |  | **always NULL** in the sampled rows |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 1 distinct; e.g. `2026-04-05T09:08:47.260879+00:00` |  |
| `updated_at` | timestamp with time zone <br>`= now()` | no |  | 1 distinct; e.g. `2026-04-05T09:08:47.260879+00:00` |  |

#### `brand_mentions_external`

Brand mentions extracted out of `market_intel_items` into a per-brand grain, with context type (positive_press / neutral / crisis), reach estimate and an action-tracking flag.

| | |
|---|---|
| **Rows** | 46 |
| **Grain** | one row per (intel item, brand) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | market-intel collector (derived from `market_intel_items`) - insert |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `item_id` -> `market_intel_items.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `published_at` 2022-11-12 -> 2026-04-05; `created_at` 2026-04-05 -> 2026-04-05 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 46 distinct; e.g. `8d5be00a-ecdf-49ac-90db-10e55a8f3b26`, `69550961-d8c6-4b3b-b956-7a9d384c0b33`, `be519384-6d1f-455f-90ed-fe34876ed8f3` |  |
| `item_id` | uuid | no | FK -> `market_intel_items.id` | 29 distinct; e.g. `4285e8c0-e766-4a66-989d-e29d9503ac98`, `e2b75d49-c204-4922-b15d-cf9cf48f0620`, `003425ba-3de6-4656-bd7a-c6340dc050f4` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 7 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `38863e89-6ee4-4838-9992-1cbf61b3f235` |  |
| `brand_slug` | text | NOT NULL |  | 7 distinct; e.g. `joola`, `selkirk`, `wilson` |  |
| `brand_name` | text | NOT NULL |  | 7 distinct; e.g. `JOOLA`, `Selkirk Sport`, `Wilson Pickleball` |  |
| `context_snippet` | text | 11% |  | 32 distinct; e.g. `Selkirk Dropped a Fresh New Paddle Color — We'...`, `SXY NEWPORT BEACH OPEN PRESENTED BY JOOLA STOR...`, `Project 006 Giveaway!   To enter, navigate to ...` |  |
| `context_type` | text | no |  | 3 distinct; e.g. `positive_press`, `neutral`, `crisis` |  |
| `sentiment` | text | no |  | 3 distinct; e.g. `positive`, `neutral`, `negative` |  |
| `reach_estimate` | integer | no |  | 6 distinct; range 10,000 .. 208,000; e.g. `10000`, `50000`, `64000` |  |
| `source_name` | text | no |  | 11 distinct; e.g. `Google News — JOOLA`, `Google News — Wilson`, `@pickleballportal` |  |
| `published_at` | timestamp with time zone | no |  | 27 distinct; e.g. `2026-04-05T08:59:04.843695+00:00`, `2026-04-01T22:29:16+00:00`, `2026-03-01T14:47:00+00:00` |  |
| `is_actioned` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `actioned_at` | timestamp with time zone | 100% |  | **always NULL** in the sampled rows |  |
| `action_notes` | text | 100% |  | **always NULL** in the sampled rows |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 2 distinct; e.g. `2026-04-05T09:16:39.961086+00:00`, `2026-04-05T09:08:26.777189+00:00` |  |

### Ads & promotions

Competitive paid-media pressure from Meta + Google ad libraries, and storefront promo banners.

#### `marketing_ads`

Competitor ad creatives scraped from the Meta Ad Library and Google Ads Transparency Center: copy, CTA, creative and landing URLs, first/last seen dates, approximate days shown, placement list, format and the full raw payload. `is_template_ad` flags Google dynamic-template ads whose body is a `{{placeholder}}`.

| | |
|---|---|
| **Rows** | 1,606 |
| **Grain** | one row per ad creative |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE INDEX only `(platform, ad_id)` - not valid as a PostgREST `on_conflict` target |
| **Written by** | `ads --source scrape-meta-ads` + `scrape-google-ads` -> `sources/ads/*.py` - upsert on `platform,ad_id` |
| **Read by** | `/v2/campaign-offer-intel`, `/v2/overview`, `/v2/changepoints`, `/v2/data-health` |
| **Foreign keys out** | `brand_id` -> `brands.id` |
| **Date coverage** | `started_at` 2021-10-25 -> 2026-08-23; `captured_at` 2026-05-14 -> 2026-08-24; `last_shown` 2025-05-21 -> 2026-08-24 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `08f277e6-67fa-4afd-baec-97e1d857827f`, `2b87be23-c558-42ff-af49-6e897de10d70`, `2d734785-5360-4d1e-9b25-f764a158d870` |  |
| `brand_id` | uuid | NOT NULL | FK -> `brands.id` | 11 distinct; e.g. `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `f15b6f97-2390-49e2-92f5-b3868e31da09`, `f9acc948-f636-4582-a7eb-c98e630fb5cd` |  |
| `platform` | text | NOT NULL |  | 2 distinct; e.g. `google`, `meta` |  |
| `ad_id` | text | no |  | 800 distinct+; e.g. `1487153526293443`, `2444353119412690`, `1351982943465694` |  |
| `page_name` | text | no |  | 27 distinct; e.g. `Selkirk Sport, LLC`, `CRBN Pickleball`, `Paddletek` |  |
| `body` | text | 79% |  | 93 distinct; e.g. `The Paddle of Champions.`, `“Not a real sport.” We’ll be here when you cat...`, `Paddles you can count on, every match.` |  |
| `cta` | text | 52% |  | 7 distinct; e.g. `Shop now`, `Learn more`, `Order now` |  |
| `creative_url` | text | 43% |  | 457 distinct; e.g. `https://tpc.googlesyndication.com/archive/simg...`, `https://scontent-lax3-1.xx.fbcdn.net/v/t39.354...`, `https://tpc.googlesyndication.com/archive/simg...` |  |
| `landing_url` | text | 52% |  | 110 distinct; e.g. `https://crbnpickleball.com/products/tfb4`, `https://crbnpickleball.com/products/crbn-3x-po...`, `https://www.paddletek.com/` |  |
| `started_at` | timestamp with time zone | no |  | 331 distinct; e.g. `2025-12-04T00:00:00+00:00`, `2026-06-10T07:00:00+00:00`, `2026-04-27T07:00:00+00:00` |  |
| `is_active` | boolean <br>`= True` | no |  | 2 distinct; e.g. `True`, `False` |  |
| `raw` | jsonb | no |  | 800 distinct+; e.g. `{"adArchiveID": "1487153526293443", "adArchive...`, `{"adArchiveID": "2444353119412690", "adArchive...`, `{"adArchiveID": "1351982943465694", "adArchive...` | Full scraped ad payload; the typed columns above are projections of it. |
| `captured_at` | timestamp with time zone <br>`= now()` | no |  | 52 distinct; e.g. `2026-05-14T16:48:15.755473+00:00`, `2026-05-14T16:43:32.554728+00:00`, `2026-06-15T07:04:41.338684+00:00` |  |
| `ad_title` | text | 58% |  | 48 distinct; e.g. `{{product.name}}`, `Our Response Is On The Court`, `Precision and Power in every swing` |  |
| `publisher_platforms` | text[] | 52% |  | 10 distinct; e.g. `["FACEBOOK", "INSTAGRAM", "AUDIENCE_NETWORK", ...`, `["FACEBOOK", "INSTAGRAM", "MESSENGER", "THREAD...`, `["FACEBOOK", "INSTAGRAM", "AUDIENCE_NETWORK", ...` |  |
| `last_shown` | timestamp with time zone | no |  | 154 distinct; e.g. `2026-08-23T00:00:00+00:00`, `2026-08-23T07:00:00+00:00`, `2026-07-26T07:00:00+00:00` |  |
| `approx_days_shown` | integer | 48% |  | 238 distinct; range 2 .. 1733; e.g. `8`, `36`, `7` | Derived from started_at/last_shown; null for the Meta subset. |
| `ad_format` | text | 48% |  | 3 distinct; e.g. `image`, `text`, `video` |  |
| `archive_url` | text | 48% |  | 417 distinct; e.g. `https://adstransparency.google.com/advertiser/...`, `https://adstransparency.google.com/advertiser/...`, `https://adstransparency.google.com/advertiser/...` |  |
| `is_template_ad` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` | True when the body is a Google dynamic placeholder such as `{{product.name}}` - exclude from copy analysis. |

#### `ad_pressure_daily`

Daily per-brand paid-media pressure mart: active creatives, new creatives, platform count and a 0-100 `ad_pressure_score` computed from them.

| | |
|---|---|
| **Rows** | 1,613 |
| **Grain** | one row per (date, brand) |
| **Primary key** | `metric_date`, `brand_id` |
| **Uniqueness / upsert key** | composite PK `(metric_date, brand_id)` - no surrogate `id` |
| **Written by** | `analytics` -> `analytics_backend/marts/refresh_helpers.py` - upsert on `metric_date,brand_id` |
| **Read by** | `/v2/market` |
| **Foreign keys out** | `brand_id` -> `brands.id` |
| **Date coverage** | `metric_date` 2026-02-23 -> 2026-08-24; `computed_at` 2026-05-24 -> 2026-08-31 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `metric_date` | date | NOT NULL | **PK** | 161 distinct; e.g. `2026-05-14`, `2026-02-24`, `2026-02-25` |  |
| `brand_id` | uuid | NOT NULL | **PK** FK -> `brands.id` | 11 distinct; e.g. `f9acc948-f636-4582-a7eb-c98e630fb5cd`, `04db8591-37a3-4634-9d11-536975fa6935`, `0926e8fa-34d4-4aa8-96e6-ec01425f0fb1` |  |
| `active_creatives` | integer <br>`= 0` | NOT NULL |  | 114 distinct; range 1 .. 196; e.g. `2`, `4`, `43` |  |
| `new_creatives` | integer <br>`= 0` | NOT NULL |  | 18 distinct; range 0 .. 44; e.g. `0`, `1`, `2` |  |
| `platform_count` | integer <br>`= 0` | NOT NULL |  | 2 distinct; range 1 .. 2; e.g. `1`, `2` |  |
| `ad_pressure_score` | numeric <br>`= 0` | NOT NULL |  | 211 distinct; range 11.93 .. 100; e.g. `42.84`, `43.5`, `47.2` |  |
| `source_run_ok` | boolean <br>`= True` | NOT NULL |  | 1 distinct; e.g. `True` |  |
| `computed_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 18 distinct; e.g. `2026-05-24T08:25:58.930567+00:00`, `2026-05-24T08:25:59.344102+00:00`, `2026-06-15T07:32:38.167936+00:00` |  |

#### `promotions`

Promotional banners detected on brand storefronts, with promo type and discount depth parsed out of the banner text.

| | |
|---|---|
| **Rows** | 66 |
| **Grain** | one row per detected promo banner |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE INDEX only `(brand_id, banner_text)` - not valid as a PostgREST `on_conflict` target |
| **Written by** | `products --source scrape-promotions` -> `sources/products/scrape_promotions.py` - upsert on `brand_id,banner_text` |
| **Read by** | `/v2/campaign-offer-intel`, `/v2/overview`, `/v2/changepoints`, `/v2/data-health` |
| **Foreign keys out** | `brand_id` -> `brands.id` |
| **Referenced by** | `promotion_sales_impact.promotion_id` |
| **Date coverage** | `detected_at` 2026-05-14 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 66 distinct; e.g. `564cf3e0-90aa-4855-be9c-b8de0c37b43d`, `66e9aa8d-20b1-4ebf-819e-8e3049995d99`, `cde51b00-f34c-4fb9-b7a8-2d7c015df9c8` |  |
| `brand_id` | uuid | NOT NULL | FK -> `brands.id` | 7 distinct; e.g. `f9acc948-f636-4582-a7eb-c98e630fb5cd`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `9f0eb357-eea4-4ab7-9a28-74cbb07940b0` |  |
| `banner_text` | text | NOT NULL |  | 66 distinct; e.g. `Customer Support                              ...`, `CORAL PRO AVAILABLE NOW`, `International Shipping Now Available!         ...` |  |
| `promo_type` | text | no |  | 6 distinct; e.g. `general`, `other`, `discount` |  |
| `discount_pct` | numeric | 85% |  | 4 distinct; range 0 .. 30; e.g. `30.0`, `10.0`, `20.0` |  |
| `source_url` | text | no |  | 12 distinct; e.g. `https://crbnpickleball.com`, `https://selkirk.com`, `https://franklinsports.com/pickleball` |  |
| `detected_at` | timestamp with time zone <br>`= now()` | no |  | 12 distinct; e.g. `2026-05-14T16:24:32.271623+00:00`, `2026-05-20T11:07:28.59758+00:00`, `2026-09-07T00:00:00+00:00` |  |

#### `promotion_daily`

Daily per-brand promo-intensity mart: whether a promo was live, its depth and how many promos ran.

| | |
|---|---|
| **Rows** | 14 |
| **Grain** | one row per (date, brand) |
| **Primary key** | `metric_date`, `brand_id` |
| **Uniqueness / upsert key** | composite PK `(metric_date, brand_id)` - re-keyed from 3 columns by `023` |
| **Written by** | `analytics` -> `marts/refresh_helpers.py` - upsert on `metric_date,brand_id` |
| **Read by** | `/v2/market` |
| **Foreign keys out** | `brand_id` -> `brands.id`, `product_id` -> `products_catalog.id` |
| **Date coverage** | `metric_date` 2026-06-01 -> 2026-09-07; `computed_at` 2026-08-24 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `metric_date` | date | NOT NULL | **PK** | 8 distinct; e.g. `2026-08-24`, `2026-08-31`, `2026-06-08` |  |
| `brand_id` | uuid | NOT NULL | **PK** FK -> `brands.id` | 6 distinct; e.g. `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `f9acc948-f636-4582-a7eb-c98e630fb5cd`, `f15b6f97-2390-49e2-92f5-b3868e31da09` |  |
| `product_id` | uuid | 100% | FK -> `products_catalog.id` | **always NULL** in the sampled rows |  |
| `promo_active_flag` | smallint <br>`= 0` | NOT NULL |  | 1 distinct; range 1 .. 1; e.g. `1` |  |
| `promo_depth_pct` | numeric | 86% |  | 2 distinct; range 0 .. 30; e.g. `30.0`, `0.0` |  |
| `promo_count` | integer <br>`= 0` | NOT NULL |  | 3 distinct; range 1 .. 3; e.g. `3`, `1`, `2` |  |
| `source_run_ok` | boolean <br>`= True` | NOT NULL |  | 1 distinct; e.g. `True` |  |
| `computed_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 3 distinct; e.g. `2026-08-24T08:35:53.106787+00:00`, `2026-08-31T08:07:00.049353+00:00`, `2026-09-07T07:10:28.287359+00:00` |  |

#### `promotion_sales_impact`

Designed to measure sales lift attributable to a promotion (baseline vs promo velocity). Never populated - needs a longer sales-estimate history.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per (promotion, product/variant) (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | none |
| **Written by** | `sales-intelligence --source correlation` (never produced rows) - upsert on `brand_id,promotion_id` |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `brand_id` -> `brands.id`, `promotion_id` -> `promotions.id`, `product_id` -> `products_catalog.id`, `variant_id` -> `product_variants.id` |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | _table is empty_ |  |
| `brand_id` | uuid | - | FK -> `brands.id` | _table is empty_ |  |
| `promotion_id` | uuid | - | FK -> `promotions.id` | _table is empty_ |  |
| `product_id` | uuid | - | FK -> `products_catalog.id` | _table is empty_ |  |
| `variant_id` | uuid | - | FK -> `product_variants.id` | _table is empty_ |  |
| `campaign_start` | date | - |  | _table is empty_ |  |
| `campaign_end` | date | - |  | _table is empty_ |  |
| `baseline_sales_velocity` | numeric | - |  | _table is empty_ |  |
| `promo_sales_velocity` | numeric | - |  | _table is empty_ |  |
| `estimated_lift_percent` | numeric | - |  | _table is empty_ |  |
| `estimated_lift_units` | numeric | - |  | _table is empty_ |  |
| `estimated_lift_revenue` | numeric | - |  | _table is empty_ |  |
| `confidence_score` | numeric <br>`= 0.3` | - |  | _table is empty_ |  |
| `created_at` | timestamp with time zone <br>`= now()` | - |  | _table is empty_ |  |

### Catalogue, pricing & reviews

What each brand actually sells: storefront products, variants, point-in-time price/stock snapshots, retailer listings and on-site review corpora.

#### `products`

Flat storefront product list as scraped per brand site: name, URL, price (with local-currency and FX columns), review count/rating, stock flag and discount. Distinct from `products_catalog` - this is raw scraped listings, the catalogue is the curated dictionary.

| | |
|---|---|
| **Rows** | 468 |
| **Grain** | one row per scraped storefront product |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(name, brand_id)` (added by `008`) |
| **Written by** | `products --source scrape-catalog` / `scrape-catalog-local` -> `sources/products/scrape_catalog*.py` - upsert on `name,brand_id` |
| **Read by** | `/v2/overview`, `/v2/product-intel`, `/v2/sales-intel` |
| **Foreign keys out** | `brand_id` -> `brands.id` |
| **Referenced by** | `product_price_history.product_id` |
| **Date coverage** | `first_seen_at` 2026-04-03 -> 2026-09-07; `last_scraped_at` 2026-04-03 -> 2026-09-07; `fx_rate_date` 2026-08-26 -> 2026-08-26 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 468 distinct; e.g. `b0114569-21ea-4e70-83ec-4455787cba9f`, `00b711cb-b356-49fc-96a7-081551fda157`, `8c33e677-cdeb-46bb-901c-b821305d82e8` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 11 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `238c76d9-cd72-4632-adac-42e459beab92` |  |
| `name` | text | NOT NULL |  | 468 distinct; e.g. `Selkirk AMPED Pro Air - Epic`, `SLK by Selkirk x Dude Perfect Trickshot`, `JOOLA Vision CGS 16mm Pickleball Paddle` |  |
| `url` | text | no |  | 402 distinct; e.g. `https://gammasports.com/collections/pickleball...`, `https://gammasports.com/pickleball/paddles/`, `https://gammasports.com/collections/pickleball...` |  |
| `category` | text | 0% |  | 5 distinct; e.g. `paddle`, `Mid`, `Entry` |  |
| `price_usd` | double precision | 27% |  | 98 distinct; range 1.51 .. 339; e.g. `199.99`, `279.99`, `89.99` |  |
| `currency` | text <br>`= USD` | no |  | 2 distinct; e.g. `USD`, `AUD` |  |
| `country_code` | text <br>`= US` | no |  | 2 distinct; e.g. `US`, `AU` |  |
| `is_new` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `review_count` | integer <br>`= 0` | 51% |  | 46 distinct; range 0 .. 8029; e.g. `0`, `1`, `3` |  |
| `avg_rating` | double precision | 88% |  | 27 distinct; range 4 .. 5; e.g. `5`, `4.7`, `4.5` |  |
| `in_stock` | boolean <br>`= True` | no |  | 2 distinct; e.g. `True`, `False` |  |
| `first_seen_at` | date <br>`= CURRENT_DATE` | no |  | 19 distinct; e.g. `2026-04-03`, `2026-05-20`, `2026-05-24` |  |
| `last_scraped_at` | timestamp with time zone <br>`= now()` | no |  | 35 distinct; e.g. `2026-04-03T05:51:42.071144+00:00`, `2026-08-26T06:49:41.562638+00:00`, `2026-08-17T17:15:14.003485+00:00` |  |
| `sale_price_usd` | numeric | 97% |  | 7 distinct; range 49.95 .. 179.9; e.g. `149.95`, `84.18`, `99.95` |  |
| `discount_pct` | numeric | 97% |  | 7 distinct; range 21.7 .. 51.8; e.g. `34.8`, `47.4`, `50.0` |  |
| `stock_count` | integer | 100% |  | **always NULL** in the sampled rows |  |
| `discontinued_at` | timestamp with time zone | 100% |  | **always NULL** in the sampled rows |  |
| `ai_category` | text | 100% |  | **always NULL** in the sampled rows |  |
| `image_url` | text | 21% |  | 260 distinct; e.g. `https://cdn.shopify.com/s/files/1/0481/9828/75...`, `https://mcprod.head.com/media/wysiwyg/menu/202...`, `https://mcprod.head.com/media/wysiwyg/head-wis...` |  |
| `price_local` | numeric | 83% |  | 32 distinct; range 14.99 .. 350; e.g. `229.95`, `229.99`, `299.95` | Pre-conversion price; `price_usd` is after applying `fx_rate_used` as of `fx_rate_date`. |
| `price_local_currency` | text | 83% |  | 2 distinct; e.g. `USD`, `AUD` |  |
| `fx_rate_used` | numeric | 97% |  | 1 distinct; range 0.66 .. 0.66; e.g. `0.66` |  |
| `fx_rate_date` | date | 97% |  | 1 distinct; e.g. `2026-08-26` |  |

#### `product_variants`

Shopify/storefront variant level: external variant id, SKU, variant title, price, compare-at price and availability. The unit at which stock-outs and sales estimates are detected. Colour/size/thickness/weight columns exist but were never parsed out of `variant_title`.

| | |
|---|---|
| **Rows** | 9,317 |
| **Grain** | one row per storefront variant |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(brand_id, external_variant_id)` |
| **Written by** | `sales-intelligence` -> `sales_intelligence/scrape_inventory_crawl4ai.py` - upsert on `brand_id,external_variant_id` |
| **Read by** | `/v2/sales-intel` |
| **Foreign keys out** | `brand_id` -> `brands.id`, `product_id` -> `products_catalog.id` |
| **Referenced by** | `inventory_events.variant_id`, `product_snapshots.variant_id`, `promotion_sales_impact.variant_id`, `sales_estimates.variant_id`, `sales_facts_daily.variant_id` |
| **Date coverage** | `first_seen_at` 2026-05-23 -> 2026-08-17; `last_seen_at` 2026-05-23 -> 2026-08-17; `created_at` 2026-05-23 -> 2026-08-17; `updated_at` 2026-05-23 -> 2026-08-17 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `1355ea59-9027-410a-8321-7ccf9fd049f8`, `8287ec9b-0ec1-4e72-8fd5-da99450a1bc8`, `730a9a4d-8140-4ea9-9b2b-ec6ffde71b3b` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 6 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `0926e8fa-34d4-4aa8-96e6-ec01425f0fb1` |  |
| `product_id` | uuid | 94% | FK -> `products_catalog.id` | 12 distinct; e.g. `2ad2f515-3fc6-4df7-acc7-69737fbd5c40`, `3e46b0a3-4f52-4d78-9767-f55cbc6c5fa2`, `3b8a6714-d246-4abe-9be9-1c3a0e718693` |  |
| `external_variant_id` | text | no |  | 800 distinct+; e.g. `44995055419606`, `40096518275149`, `44994494726358` |  |
| `sku` | text | 12% |  | 702 distinct; e.g. `18543`, `49100`, `CRBNIQ0602L` |  |
| `upc` | text | 100% |  | **always NULL** in the sampled rows |  |
| `variant_title` | text | no |  | 554 distinct; e.g. `Default Title`, `S / Black`, `L / Black` |  |
| `color` | text | 100% |  | **always NULL** in the sampled rows | Colour/size/thickness/weight are all null - never parsed out of `variant_title`. |
| `size` | text | 100% |  | **always NULL** in the sampled rows |  |
| `thickness` | text | 100% |  | **always NULL** in the sampled rows |  |
| `weight` | text | 100% |  | **always NULL** in the sampled rows |  |
| `price` | numeric | no |  | 83 distinct; range 0 .. 750; e.g. `179.95`, `14.95`, `25.0` |  |
| `compare_at_price` | numeric | 30% |  | 49 distinct; range 0 .. 750; e.g. `179.95`, `44.95`, `39.95` |  |
| `currency` | text <br>`= USD` | no |  | 1 distinct; e.g. `USD` |  |
| `availability_status` | text <br>`= unknown` | no |  | 2 distinct; e.g. `in_stock`, `out_of_stock` |  |
| `first_seen_at` | timestamp with time zone <br>`= now()` | no |  | 23 distinct; e.g. `2026-05-23T16:57:08.337633+00:00`, `2026-05-23T16:57:11.638295+00:00`, `2026-05-23T16:57:08.828572+00:00` |  |
| `last_seen_at` | timestamp with time zone <br>`= now()` | no |  | 24 distinct; e.g. `2026-05-23T16:57:08.337633+00:00`, `2026-05-23T16:57:11.638295+00:00`, `2026-05-23T16:57:08.828572+00:00` |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 23 distinct; e.g. `2026-05-23T16:57:08.337633+00:00`, `2026-05-23T16:57:11.638295+00:00`, `2026-05-23T16:57:08.828572+00:00` |  |
| `updated_at` | timestamp with time zone <br>`= now()` | no |  | 23 distinct; e.g. `2026-05-23T16:57:08.337633+00:00`, `2026-05-23T16:57:11.638295+00:00`, `2026-05-23T16:57:08.828572+00:00` |  |

#### `product_snapshots`

Point-in-time capture of a product page: price, availability status, visible inventory quantity, the inventory signal type (JSON-LD vs Shopify JSON vs HTML text), a confidence label and the raw payload. The largest table in the catalogue cluster and the evidence trail behind inventory events.

| | |
|---|---|
| **Rows** | 38,058 |
| **Grain** | one row per (product page, snapshot time) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | none (append-only) |
| **Written by** | `sales-intelligence` -> `scrape_inventory_crawl4ai.py`; pruned by `maintenance/cleanup.py` - append-only insert |
| **Read by** | `/v2/sales-intel` (+ `/brand/[slug]`) |
| **Foreign keys out** | `brand_id` -> `brands.id`, `product_id` -> `products_catalog.id`, `variant_id` -> `product_variants.id` |
| **Date coverage** | `snapshot_time` 2026-05-24 -> 2026-08-17; `created_at` 2026-05-24 -> 2026-08-17 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `dc4ebb04-1756-4bd5-98fb-921cf77b3e83`, `d33fdb6a-ec3c-49e7-9662-7b6476def90a`, `6d8a6165-cd67-4ef4-9c79-a143b40d135b` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 11 distinct; e.g. `238c76d9-cd72-4632-adac-42e459beab92`, `04db8591-37a3-4634-9d11-536975fa6935`, `f9acc948-f636-4582-a7eb-c98e630fb5cd` |  |
| `product_id` | uuid | 60% | FK -> `products_catalog.id` | 46 distinct; e.g. `ef185d27-5ca5-46e5-a6dc-2e509bba7504`, `71c5cd17-e483-40b8-9339-88ecc442cfd2`, `08d6fd6f-b415-474e-bdb1-24f0229bf5bc` |  |
| `variant_id` | uuid | 100% | FK -> `product_variants.id` | **always NULL** in the sampled rows |  |
| `snapshot_time` | timestamp with time zone <br>`= now()` | no |  | 3 distinct; e.g. `2026-05-25T06:31:04.607032+00:00`, `2026-05-24T08:58:04.862745+00:00`, `2026-06-01T07:07:51.639674+00:00` |  |
| `product_url` | text | NOT NULL |  | 349 distinct; e.g. `https://gammasports.com/collections/pickleball...`, `https://gammasports.com/pickleball/paddles/`, `https://gammasports.com/collections/pickleball...` |  |
| `price` | numeric | 67% |  | 74 distinct; range 0 .. 350; e.g. `129.99`, `229.95`, `100.0` |  |
| `compare_at_price` | numeric | 100% |  | **always NULL** in the sampled rows |  |
| `currency` | text <br>`= USD` | no |  | 1 distinct; e.g. `USD` |  |
| `discount_percent` | numeric | 100% |  | **always NULL** in the sampled rows |  |
| `availability_status` | text | no |  | 4 distinct; e.g. `unknown`, `in_stock`, `out_of_stock` |  |
| `visible_inventory_qty` | integer | 100% |  | 1 distinct; range 1 .. 1; e.g. `1` |  |
| `estimated_inventory_qty` | integer | 100% |  | **always NULL** in the sampled rows |  |
| `inventory_confidence` | text <br>`= low` | no |  | 3 distinct; e.g. `low`, `high`, `medium` |  |
| `inventory_signal_type` | text | 68% |  | 3 distinct; e.g. `json_ld`, `shopify_json`, `html_text` | How stock was inferred: `shopify_json` > `json_ld` > `html_text`, matching `inventory_confidence`. |
| `stock_message` | text | 100% |  | 1 distinct; e.g. `Only 1 left` |  |
| `raw_payload` | jsonb | 74% |  | 180 distinct; e.g. `{"@context": "http://schema.org/", "@type": "P...`, `{"@context": "http://schema.org/", "@id": "/pr...`, `{"@context": "http://schema.org/", "@type": "P...` |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 3 distinct; e.g. `2026-05-25T06:31:47.248432+00:00`, `2026-05-24T09:02:23.546468+00:00`, `2026-06-01T07:11:08.110924+00:00` |  |

#### `price_daily`

Intended daily price mart with a 90-day price index. Never populated - the price series is still read off `product_snapshots`/`product_variants`.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per (date, product) (empty) |
| **Primary key** | `metric_date`, `product_id` |
| **Uniqueness / upsert key** | composite PK `(metric_date, product_id)` |
| **Written by** | `analytics` -> `marts/refresh_helpers.py` (source table empty, so no rows) - upsert on `metric_date,product_id` |
| **Read by** | `/v2/sales-intel` (`fetchPricePressure`) - returns nothing, table is empty |
| **Foreign keys out** | `product_id` -> `products_catalog.id` |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `metric_date` | date | NOT NULL | **PK** | _table is empty_ |  |
| `product_id` | uuid | NOT NULL | **PK** FK -> `products_catalog.id` | _table is empty_ |  |
| `price_usd` | numeric | - |  | _table is empty_ |  |
| `price_index_90d` | numeric | - |  | _table is empty_ |  |
| `source_run_ok` | boolean <br>`= True` | NOT NULL |  | _table is empty_ |  |
| `computed_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | _table is empty_ |  |

#### `product_price_history`

Earlier price-history design keyed to `products` (not the catalogue). Never populated.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per price capture (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | none |
| **Written by** | nothing - never written |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `product_id` -> `products.id`, `brand_id` -> `brands.id` |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | _table is empty_ |  |
| `product_id` | uuid | NOT NULL | FK -> `products.id` | _table is empty_ |  |
| `brand_id` | uuid | NOT NULL | FK -> `brands.id` | _table is empty_ |  |
| `captured_at` | timestamp with time zone <br>`= now()` | - |  | _table is empty_ |  |
| `price_usd` | numeric | - |  | _table is empty_ |  |
| `sale_price_usd` | numeric | - |  | _table is empty_ |  |
| `discount_pct` | numeric | - |  | _table is empty_ |  |
| `in_stock` | boolean | - |  | _table is empty_ |  |
| `stock_count` | integer | - |  | _table is empty_ |  |

#### `availability_daily`

Daily availability mart: in-stock variant count vs total variants and the resulting 0-1 availability index per product.

| | |
|---|---|
| **Rows** | 359 |
| **Grain** | one row per (date, brand, product) |
| **Primary key** | `metric_date`, `brand_id`, `product_id` |
| **Uniqueness / upsert key** | composite PK `(metric_date, brand_id, product_id)` |
| **Written by** | `analytics` -> `marts/refresh_helpers.py` - upsert on `metric_date,brand_id,product_id` |
| **Read by** | `/v2/sales-intel` - attention-vs-availability quadrant |
| **Foreign keys out** | `brand_id` -> `brands.id`, `product_id` -> `products_catalog.id` |
| **Date coverage** | `metric_date` 2026-05-24 -> 2026-08-17; `computed_at` 2026-08-18 -> 2026-08-18 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `metric_date` | date | NOT NULL | **PK** | 9 distinct; e.g. `2026-06-15`, `2026-06-22`, `2026-06-08` |  |
| `brand_id` | uuid | NOT NULL | **PK** FK -> `brands.id` | 11 distinct; e.g. `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `04db8591-37a3-4634-9d11-536975fa6935`, `f8cb05a4-4de3-41a5-9c52-1ee7f5443926` |  |
| `product_id` | uuid | NOT NULL | **PK** FK -> `products_catalog.id` | 54 distinct; e.g. `2ad2f515-3fc6-4df7-acc7-69737fbd5c40`, `6558f73c-7967-4cda-8eb1-aec4e7d6fc8d`, `08d6fd6f-b415-474e-bdb1-24f0229bf5bc` |  |
| `in_stock_count` | integer <br>`= 0` | NOT NULL |  | 44 distinct; range 0 .. 179; e.g. `0`, `2`, `1` |  |
| `total_variants` | integer <br>`= 0` | NOT NULL |  | 49 distinct; range 1 .. 206; e.g. `1`, `2`, `4` |  |
| `availability_index` | numeric | no |  | 59 distinct; range 0 .. 1; e.g. `0.0`, `1.0`, `0.5` |  |
| `source_run_ok` | boolean <br>`= True` | NOT NULL |  | 1 distinct; e.g. `True` |  |
| `computed_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 1 distinct; e.g. `2026-08-18T05:46:47.948159+00:00` |  |

#### `paddle_products`

Retailer-side and brand-side paddle listings collected for the review-mining pipeline (Dick's Sporting Goods, Pickleball Central, brand Shopify): price, review count, average rating and rating distribution. Brand is held both as text and as a nullable `brand_id`.

| | |
|---|---|
| **Rows** | 702 |
| **Grain** | one row per retailer product listing |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | paddle review/spec harvester (outside `migrations/`) - upsert on `source,source_product_id` |
| **Read by** | `/v2/product-intel` - family / price tiers |
| **Referenced by** | `paddle_reviews.product_id` |
| **Date coverage** | `first_seen_at` 2026-08-20 -> 2026-08-24; `last_seen_at` 2026-08-18 -> 2026-08-26; `created_at` 2026-08-20 -> 2026-08-24 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 702 distinct; e.g. `833f4166-1e9c-498a-8569-ce67443a2970`, `b4636f16-7a14-4f2e-b494-1260e39e1dd9`, `ee254c29-9b7a-436d-afc6-cb960db39a08` |  |
| `brand_id` | uuid | 27% |  | 5 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `f15b6f97-2390-49e2-92f5-b3868e31da09` |  |
| `brand` | text <br>`= other` | NOT NULL |  | 7 distinct; e.g. `JOOLA`, `other`, `Selkirk` |  |
| `source` | text | NOT NULL |  | 7 distinct; e.g. `dicks`, `pickleballcentral_bc`, `joola_shopify` |  |
| `retailer` | text | 32% |  | 2 distinct; e.g. `Dick's Sporting Goods`, `Pickleball Central` |  |
| `source_product_id` | text | NOT NULL |  | 702 distinct; e.g. `26holapickznwhtxxxqac`, `25sixapickrbyprxxxfnw`, `25fraapickc45tmppdnam` |  |
| `family_id` | text | 100% |  | **always NULL** in the sampled rows |  |
| `canonical_name` | text | no |  | 661 distinct; e.g. `Monarch Dragon Slayer Pickleball Paddle`, `Six Zero Ruby Pro 14mm Pickleball Paddle`, `Franklin Fs Tour Dynasty 16mm Pickleball Paddl...` |  |
| `title` | text | no |  | 661 distinct; e.g. `Monarch Dragon Slayer Pickleball Paddle`, `Six Zero Ruby Pro 14mm Pickleball Paddle`, `Franklin Fs Tour Dynasty 16mm Pickleball Paddl...` |  |
| `handle` | text | no |  | 701 distinct; e.g. `joola-ben-johns-perseus-pro-iv-14mm-pickleball...`, `holbrook-pickleball-the-zone-pickleball-paddle...`, `six-zero-ruby-pro-14mm-pickleball-paddle-25six...` |  |
| `product_url` | text | no |  | 702 distinct; e.g. `https://www.dickssportinggoods.com/p/holbrook-...`, `https://www.dickssportinggoods.com/p/six-zero-...`, `https://www.dickssportinggoods.com/p/franklin-...` |  |
| `image_url` | text | 47% |  | 353 distinct; e.g. `https://cdn.shopify.com/s/files/1/0152/5763/28...`, `https://cdn.shopify.com/s/files/1/0152/5763/28...`, `https://cdn.shopify.com/s/files/1/0685/6943/22...` |  |
| `price` | numeric | 43% |  | 78 distinct; range 5 .. 350; e.g. `299.95`, `279.99`, `229.95` |  |
| `currency` | text <br>`= USD` | no |  | 1 distinct; e.g. `USD` |  |
| `review_count` | integer <br>`= 0` | no |  | 116 distinct; range 0 .. 8028; e.g. `0`, `1`, `2` |  |
| `avg_rating` | numeric | 50% |  | 85 distinct; range 0 .. 5; e.g. `5.0`, `0.0`, `4.5` |  |
| `rating_distribution` | jsonb | 80% |  | 53 distinct; e.g. `{}`, `{"1": 0, "2": 0, "3": 0, "4": 0, "5": 0}`, `{"1": 40, "2": 16, "3": 14, "4": 15, "5": 210}` |  |
| `gtin` | text[] | 4% |  | 1 distinct; e.g. `[]` |  |
| `is_paddle` | boolean <br>`= True` | no |  | 1 distinct; e.g. `True` |  |
| `is_active` | boolean <br>`= True` | no |  | 2 distinct; e.g. `True`, `False` |  |
| `first_seen_at` | timestamp with time zone <br>`= now()` | no |  | 9 distinct; e.g. `2026-08-20T03:26:02.095636+00:00`, `2026-08-20T03:26:00.115574+00:00`, `2026-08-20T03:26:01.063304+00:00` |  |
| `last_seen_at` | timestamp with time zone <br>`= now()` | no |  | 35 distinct; e.g. `2026-08-26T12:27:42.415+00:00`, `2026-08-20T06:32:26.142172+00:00`, `2026-08-20T06:32:26.143184+00:00` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 9 distinct; e.g. `2026-08-20T03:26:02.095636+00:00`, `2026-08-20T03:26:00.115574+00:00`, `2026-08-20T03:26:01.063304+00:00` |  |

#### `paddle_reviews`

The on-site review corpus - 26.9k paddle reviews harvested from Okendo, Judge.me, Yotpo and Bazaarvoice widgets, with rating, title/body, secondary ratings, verified/recommended/incentivized flags, brand response, media URLs and GPT enrichment (sentiment, topics, complaint category, competitors named). The single richest voice-of-customer asset in the database.

| | |
|---|---|
| **Rows** | 26,888 |
| **Grain** | one row per review (deduped by source + external id) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | paddle review harvester (Okendo/Judge.me/Yotpo/Bazaarvoice) - upsert on `source,external_review_id` |
| **Read by** | `/v2/product-intel` - Customer Voice panel |
| **Foreign keys out** | `product_id` -> `paddle_products.id` |
| **Date coverage** | `posted_at` 2014-02-08 -> 2026-08-26; `brand_response_at` 2024-04-17 -> 2026-08-19; `scraped_at` 2026-08-18 -> 2026-08-26; `created_at` 2026-08-20 -> 2026-08-26 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `d9edc71e-1cd7-4c16-8907-b2c5431ec0bf`, `0b447fdb-dcb7-40ed-a3d4-cbcff552e439`, `c0ce1b13-768d-4012-bb47-a83ba8507035` |  |
| `brand_id` | uuid | no |  | 5 distinct; e.g. `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `f15b6f97-2390-49e2-92f5-b3868e31da09`, `f8cb05a4-4de3-41a5-9c52-1ee7f5443926` |  |
| `source` | text | NOT NULL |  | 4 distinct; e.g. `okendo`, `judgeme`, `yotpo` | Review widget vendor: okendo, judgeme, yotpo, bazaarvoice. |
| `external_review_id` | text | NOT NULL |  | 800 distinct+; e.g. `817688254`, `5762fd61-3f01-4dff-a458-2fbe14ed4e02`, `6d478230-4fe5-4e9a-81de-0383375b2ec2` |  |
| `product_id` | uuid | 25% | FK -> `paddle_products.id` | 79 distinct; e.g. `e7b830e6-7bad-4c05-be0c-6b58b309a9e8`, `7d8d6d4f-f2b2-4783-9141-481daac6281a`, `350cae91-1aff-4b00-8909-3bee5d3cc698` |  |
| `source_product_id` | text | no |  | 156 distinct; e.g. `7423127584870`, `9027955032318`, `site-reviews-51eb4f5f-5c6e-4e06-9280-1145c4fb7...` |  |
| `family_id` | text | 99% |  | 7 distinct; e.g. `Hyperion CFS 2026`, `Perseus3SDual`, `AgassiV` |  |
| `canonical_name` | text | no |  | 156 distinct; e.g. `Selkirk VANGUARD Pro - Epic - Pickleball Paddl...`, `Bantam TKO-CX`, `Selkirk Sport` |  |
| `brand` | text | no |  | 6 distinct; e.g. `Selkirk Sport`, `Paddletek`, `Selkirk` |  |
| `retailer` | text | 82% |  | 1 distinct; e.g. `Pickleball Central` |  |
| `reviewer_name` | text | 29% |  | 525 distinct; e.g. `Louis J.`, `Jeff L.`, `Michael` |  |
| `reviewer_location` | text | 96% |  | 11 distinct; e.g. `United States`, `Atlanta, GA`, `Virginia` |  |
| `rating` | smallint | no |  | 5 distinct; range 1 .. 5; e.g. `5`, `4`, `3` |  |
| `title` | text | 22% |  | 510 distinct; e.g. `5 Stars`, `Great paddle`, `Great paddle!` |  |
| `body` | text | no |  | 769 distinct; e.g. `Great paddle`, `Love it`, `Love it!` |  |
| `pros` | text | 100% |  | **always NULL** in the sampled rows |  |
| `cons` | text | 100% |  | **always NULL** in the sampled rows |  |
| `secondary_ratings` | jsonb | 90% |  | 51 distinct; e.g. `{"Right amount of power/pop": 0, "Right amount...`, `{"Quality": 5, "Value": 5}`, `{"Right amount of power/pop": 0, "Right amount...` | Vendor-specific sub-scores (Quality, Value, power/control sliders) - shape varies by source. |
| `context_values` | jsonb | 53% |  | 152 distinct; e.g. `{"judgeme_badges": ["review_collected_via_stor...`, `{"judgeme_badges": ["review_written_in_shop_ap...`, `{"judgeme_badges": ["review_collected_via_stor...` |  |
| `posted_at` | timestamp with time zone | no |  | 781 distinct+; e.g. `2025-12-20T00:00:00+00:00`, `2025-12-19T00:00:00+00:00`, `2025-01-07T00:00:00+00:00` |  |
| `is_verified` | boolean | 31% |  | 2 distinct; e.g. `True`, `False` |  |
| `is_recommended` | boolean | 48% |  | 2 distinct; e.g. `True`, `False` |  |
| `is_incentivized` | boolean | 2% |  | 2 distinct; e.g. `False`, `True` |  |
| `is_syndicated` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `helpful_count` | integer <br>`= 0` | no |  | 6 distinct; range 0 .. 6; e.g. `0`, `1`, `2` |  |
| `unhelpful_count` | integer <br>`= 0` | no |  | 4 distinct; range 0 .. 3; e.g. `0`, `1`, `2` |  |
| `brand_response` | text | 99% |  | 6 distinct; e.g. `We appreciate the great feedback! The Hyperion...`, `We appreciate the feedback and are glad you’re...`, `Anything is better than a broomstick ;)  Thank...` |  |
| `brand_response_at` | timestamp with time zone | 99% |  | 6 distinct; e.g. `2026-02-17T17:04:56+00:00`, `2026-02-17T19:19:56+00:00`, `2026-07-16T14:38:52+00:00` |  |
| `media_urls` | text[] | 25% |  | 24 distinct; e.g. `[]`, `["https://review-images.judgeme.com/paddletek-...`, `["https://review-images.judgeme.com/crbn-pickl...` |  |
| `language_code` | text | 48% |  | 4 distinct; e.g. `en`, `en_US`, `es` |  |
| `source_sentiment` | text | 82% |  | 144 distinct; e.g. `0.98712164`, `0.95737344`, `0.96094817` | Vendor's own sentiment value as text; `sentiment_score` is ours. |
| `content_hash` | character varying | 25% |  | 597 distinct; e.g. `86c871c12d46f7f0bec9af3a4a240cbe32677b0507cfe8...`, `618b6d389bb28166d45978abc881ea482ed07482d946ec...`, `6d22f47602c60387769110b373b77363395eba0d59db18...` | Dedupe key across re-harvests. |
| `scraped_at` | timestamp with time zone <br>`= now()` | no |  | 135 distinct; e.g. `2026-08-26T12:27:43.355+00:00`, `2026-08-24T08:57:42.866+00:00`, `2026-08-18T08:41:58.342442+00:00` |  |
| `sentiment_label` | text | 25% |  | 3 distinct; e.g. `positive`, `negative`, `neutral` |  |
| `sentiment_score` | numeric | 25% |  | 14 distinct; range -1 .. 1; e.g. `1.0`, `0.9`, `0.8` |  |
| `topics` | text[] | 25% |  | 217 distinct; e.g. `["general"]`, `["power", "control"]`, `["control", "power"]` |  |
| `is_crisis` | boolean | 25% |  | 2 distinct; e.g. `False`, `True` |  |
| `is_opportunity` | boolean | 25% |  | 2 distinct; e.g. `False`, `True` |  |
| `complaint_category` | text | 25% |  | 10 distinct; e.g. `none`, `durability_other`, `customer_service` |  |
| `mentioned_competitors` | text[] | 25% |  | 11 distinct; e.g. `[]`, `["Selkirk"]`, `["JOOLA"]` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 74 distinct; e.g. `2026-08-20T03:26:31.434205+00:00`, `2026-08-26T12:21:40.840506+00:00`, `2026-08-20T03:26:31.903712+00:00` |  |

#### `paddle_specs`

Technical paddle specifications scraped from brand product pages: shape, thickness, length/width, handle length, weight range, grip, core and face material, swing/twist weight, balance point and USAP approval - plus the raw spec blob and a confidence label saying whether values were labelled, variant-derived or read out of prose.

| | |
|---|---|
| **Rows** | 184 |
| **Grain** | one row per (product page, spec variant) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(brand_id, source_handle, variant_key)`; CHECK `source_confidence in ('labelled','variant','prose')` |
| **Written by** | `product-specs` -> `sources/products/scrape_specs.py` - upsert on `brand_id,source_handle,variant_key` + stale prune |
| **Read by** | `/v2/product-intel` - spec comparison |
| **Foreign keys out** | `brand_id` -> `brands.id` |
| **Date coverage** | `first_seen_at` 2026-08-26 -> 2026-08-26; `scraped_at` 2026-08-26 -> 2026-08-26 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 184 distinct; e.g. `fdfe4586-3a2c-420e-9737-643c543521e5`, `1c8ffd89-e3a5-4548-8f6e-041354d101d7`, `e24746a9-862c-4b69-89c3-39ab395bab3b` |  |
| `brand_id` | uuid | NOT NULL | FK -> `brands.id` | 6 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `f15b6f97-2390-49e2-92f5-b3868e31da09`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec` |  |
| `source_handle` | text | NOT NULL |  | 155 distinct; e.g. `slk-era-power`, `selkirk-labs-project-boomstik`, `coral-pro` |  |
| `source_url` | text | NOT NULL |  | 155 distinct; e.g. `https://www.selkirk.com/products/slk-era-power`, `https://www.selkirk.com/products/selkirk-labs-...`, `https://www.sixzeropickleball.com/products/cor...` |  |
| `product_name` | text | NOT NULL |  | 151 distinct; e.g. `SLK ERA Power`, `Selkirk LABS Project Boomstik®`, `Coral Pro 16mm` |  |
| `family_key` | text | NOT NULL |  | 115 distinct; e.g. `perseus pro iv`, `hyperion pro iv`, `scorpeus pro iv` |  |
| `variant_key` | text | NOT NULL |  | 27 distinct; e.g. `any\|16.0`, `any\|14.0`, `elongated\|16.0` |  |
| `shape` | text | 57% |  | 4 distinct; e.g. `elongated`, `standard`, `widebody` |  |
| `thickness_mm` | numeric | 3% |  | 9 distinct; range 10 .. 19; e.g. `16.0`, `14.0`, `12.7` |  |
| `length_in` | numeric | 21% |  | 12 distinct; range 15 .. 16.6; e.g. `16.5`, `16.0`, `16.3` |  |
| `width_in` | numeric | 11% |  | 16 distinct; range 7.3 .. 16.5; e.g. `7.5`, `8.0`, `7.85` |  |
| `handle_length_in` | numeric | 11% |  | 13 distinct; range 4.75 .. 8; e.g. `5.5`, `5.25`, `5.0` |  |
| `weight_oz_min` | numeric | 12% |  | 13 distinct; range 7 .. 8.4; e.g. `8.0`, `7.8`, `7.9` |  |
| `weight_oz_max` | numeric | 12% |  | 11 distinct; range 7.4 .. 8.7; e.g. `8.1`, `8.0`, `7.8` |  |
| `grip_circum_in` | numeric | 25% |  | 7 distinct; range 4 .. 4.5; e.g. `4.25`, `4.125`, `4.0` |  |
| `core_material` | text | 46% |  | 27 distinct; e.g. `PP core + EVA foam wall`, `PP core`, `Tectonic Core with ProPulsion Foam` |  |
| `face_material` | text | 29% |  | 34 distinct; e.g. `Textured Carbon Fiber`, `Textured CF`, `textured CF` |  |
| `swing_weight` | numeric | 74% |  | 17 distinct; range 103.4 .. 122.5; e.g. `113.0`, `118.0`, `112.0` |  |
| `twist_weight` | numeric | 74% |  | 26 distinct; range 5.21 .. 8.2; e.g. `6.9`, `6.6`, `6.7` |  |
| `balance_point_mm` | numeric | 95% |  | 5 distinct; range 236 .. 245; e.g. `237.0`, `236.0`, `245.0` |  |
| `usap_approved` | boolean | 58% |  | 1 distinct; e.g. `True` |  |
| `raw_specs` | jsonb | NOT NULL |  | 146 distinct; e.g. `{"Average Weight": "8.1oz", "Class": "Paddles ...`, `{"Core Thickness": "14.3 mm"}`, `{"Core Thickness": "16 mm"}` | Original key/value spec blob as found on the page. |
| `source_confidence` | text <br>`= labelled` | NOT NULL |  | 3 distinct; e.g. `labelled`, `variant`, `prose` | `labelled` (from a spec table) > `variant` (inferred from variant title) > `prose` (parsed from marketing copy). Filter on this before comparing specs. |
| `first_seen_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 3 distinct; e.g. `2026-08-26T06:37:33.218577+00:00`, `2026-08-26T06:25:18.569502+00:00`, `2026-08-26T06:17:41.626055+00:00` |  |
| `scraped_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 1 distinct; e.g. `2026-08-26T07:04:28.214664+00:00` |  |

#### `paddle_review_runs`

Run log for the paddle-review harvester: stages, products found/new, reviews found/new/enriched, per-source stats and failures.

| | |
|---|---|
| **Rows** | 10 |
| **Grain** | one row per review-harvest run |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | paddle review harvester - insert per run |
| **Read by** | _no frontend consumer_ |
| **Referenced by** | `paddle_review_errors.run_id` |
| **Date coverage** | `started_at` 2026-08-20 -> 2026-08-26; `finished_at` 2026-08-20 -> 2026-08-26; `created_at` 2026-08-20 -> 2026-08-26 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 10 distinct; e.g. `e4748485-6ca2-4fb2-a15a-77f75b0456d1`, `0d20fe80-ea73-4983-9c54-77a6f7c04a8b`, `aff0d2f0-bee7-475a-a5c9-3400297f65cb` |  |
| `status` | text <br>`= pending` | NOT NULL |  | 1 distinct; e.g. `done` |  |
| `run_type` | text <br>`= manual` | no |  | 2 distinct; e.g. `brand_compare`, `scheduled` |  |
| `stages_total` | integer <br>`= 0` | NOT NULL |  | 3 distinct; range 2 .. 9; e.g. `2`, `9`, `3` |  |
| `stages_done` | integer <br>`= 0` | NOT NULL |  | 3 distinct; range 2 .. 9; e.g. `2`, `9`, `3` |  |
| `products_found` | integer <br>`= 0` | NOT NULL |  | 4 distinct; range 301 .. 986; e.g. `639`, `618`, `986` |  |
| `products_new` | integer <br>`= 0` | NOT NULL |  | 4 distinct; range 0 .. 137; e.g. `137`, `0`, `136` |  |
| `reviews_found` | integer <br>`= 0` | NOT NULL |  | 8 distinct; range 0 .. 21,577; e.g. `19996`, `14694`, `17006` |  |
| `reviews_new` | integer <br>`= 0` | NOT NULL |  | 5 distinct; range 0 .. 21,577; e.g. `4000`, `9000`, `21577` |  |
| `reviews_enriched` | integer <br>`= 0` | NOT NULL |  | 2 distinct; range 0 .. 34; e.g. `0`, `34` |  |
| `sources_ok` | integer <br>`= 0` | NOT NULL |  | 3 distinct; range 1 .. 7; e.g. `2`, `7`, `1` |  |
| `sources_failed` | integer <br>`= 0` | NOT NULL |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `per_source_stats` | jsonb | no |  | 8 distinct; e.g. `{"bazaarvoice": {"errors": [], "ok": true, "pr...`, `{"bazaarvoice": {"errors": [], "ok": true, "pr...`, `{"bazaarvoice": {"errors": [], "ok": true, "pr...` |  |
| `error_message` | text | 100% |  | **always NULL** in the sampled rows |  |
| `started_at` | timestamp with time zone | no |  | 10 distinct; e.g. `2026-08-24T08:55:20.177+00:00`, `2026-08-24T09:02:18.745+00:00`, `2026-08-24T09:05:36.243+00:00` |  |
| `finished_at` | timestamp with time zone | no |  | 10 distinct; e.g. `2026-08-24T08:58:13.672+00:00`, `2026-08-24T09:03:49.535+00:00`, `2026-08-24T09:07:03.042+00:00` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 10 distinct; e.g. `2026-08-24T08:58:14.906376+00:00`, `2026-08-24T09:03:50.777947+00:00`, `2026-08-24T09:07:04.265984+00:00` |  |

#### `paddle_review_errors`

Per-target error log for review harvesting - currently all HTTP 429 rate-limit failures against Selkirk.

| | |
|---|---|
| **Rows** | 16 |
| **Grain** | one row per failed target |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | paddle review harvester (on failure) - insert |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `run_id` -> `paddle_review_runs.id` |
| **Date coverage** | `created_at` 2026-08-24 -> 2026-08-26 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 16 distinct; e.g. `147bd4d5-02f2-45c0-baa1-400dc2ea9b88`, `d1176c4f-a3cf-4bd9-a455-366beecb086b`, `75e93992-b6d1-429d-9a4a-50d7750bd70c` |  |
| `run_id` | uuid | no | FK -> `paddle_review_runs.id` | 2 distinct; e.g. `f5116e30-f61c-471a-85cb-87d8fb112fdd`, `0d20fe80-ea73-4983-9c54-77a6f7c04a8b` |  |
| `source` | text | NOT NULL |  | 1 distinct; e.g. `okendo` |  |
| `stage` | text <br>`= ` | no |  | 1 distinct; e.g. `collect` |  |
| `target` | text <br>`= ` | 100% |  | **always NULL** in the sampled rows |  |
| `error_type` | text <br>`= scrape_error` | no |  | 1 distinct; e.g. `scrape_error` |  |
| `error_message` | text | no |  | 13 distinct; e.g. `7372752322662: HTTP 429 https://www.selkirk.co...`, `7368988754022: HTTP 429 https://www.selkirk.co...`, `7372752683110: HTTP 429 https://www.selkirk.co...` |  |
| `status_code` | integer | 100% |  | **always NULL** in the sampled rows |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 2 distinct; e.g. `2026-08-26T12:21:52.071059+00:00`, `2026-08-24T09:03:51.06849+00:00` |  |

#### `product_reviews`

Earlier generic product-review schema keyed to `products_catalog`. Superseded by `paddle_reviews` and never populated.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per review (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(source_review_id)` |
| **Written by** | `reviews` -> `sources/products/scrape_reviews.py` (never produced rows) - upsert on `source_review_id` |
| **Read by** | `/v2/data-health` probe only |
| **Foreign keys out** | `brand_id` -> `brands.id`, `product_id` -> `products_catalog.id` |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | _table is empty_ |  |
| `brand_id` | uuid | - | FK -> `brands.id` | _table is empty_ |  |
| `product_id` | uuid | - | FK -> `products_catalog.id` | _table is empty_ |  |
| `source_review_id` | text | NOT NULL |  | _table is empty_ |  |
| `review_widget` | text | - |  | _table is empty_ |  |
| `reviewer_name` | text | - |  | _table is empty_ |  |
| `review_title` | text | - |  | _table is empty_ |  |
| `review_text` | text | - |  | _table is empty_ |  |
| `rating` | numeric | - |  | _table is empty_ |  |
| `helpful_count` | integer <br>`= 0` | - |  | _table is empty_ |  |
| `posted_at` | timestamp with time zone | - |  | _table is empty_ |  |
| `scraped_at` | timestamp with time zone <br>`= now()` | - |  | _table is empty_ |  |
| `sentiment_score` | numeric | - |  | _table is empty_ |  |
| `sentiment_label` | text | - |  | _table is empty_ |  |
| `topics` | text[] | - |  | _table is empty_ |  |
| `brands_mentioned` | text[] | - |  | _table is empty_ |  |
| `players_mentioned` | text[] | - |  | _table is empty_ |  |
| `products_mentioned` | text[] | - |  | _table is empty_ |  |
| `is_crisis` | boolean <br>`= False` | - |  | _table is empty_ |  |
| `is_opportunity` | boolean <br>`= False` | - |  | _table is empty_ |  |
| `purchase_intent_score` | numeric <br>`= 0` | - |  | _table is empty_ |  |
| `crisis_keywords` | text[] | - |  | _table is empty_ |  |
| `enriched_at` | timestamp with time zone | - |  | _table is empty_ |  |

### Cross-channel fact layer

The unification layer: every channel's enriched rows normalised into one mention grain, then attributed to products and rolled into attention scores.

#### `mention_facts`

The cross-channel unification table: every enriched row from every channel normalised to one grain with `channel` + `source_table` + `source_id` provenance, sentiment, the intent booleans, a text snippet, an engagement number and resolved brand/product/athlete IDs. 48k rows and the intended single entry point for 'how is this brand being talked about'. Note the live rows currently cover only paddle reviews and TikTok - a rebuild repopulates it from all channels.

| | |
|---|---|
| **Rows** | 48,239 |
| **Grain** | one row per enriched mention from any channel |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE EXPRESSION INDEX `(channel, source_id, brand_id, coalesce(product_id, nil-uuid))` - expression index, so **not** usable as an `on_conflict` target |
| **Written by** | `facts --source mention-facts` -> `facts/mention_facts.py` - DELETE by channel + insert |
| **Read by** | `/v2/community-intel`, `/v2/market`, `/v2/influencers`, `/v2/instagram`, `/v2/ask-intel`, sidebar crisis badge |
| **Foreign keys out** | `brand_id` -> `brands.id`, `product_id` -> `products_catalog.id`, `athlete_id` -> `influencers.id` |
| **Referenced by** | `competitor_switch_events.mention_id` |
| **Date coverage** | `posted_at` 2009-01-16 -> 2026-09-07; `created_at` 2026-09-07 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `42acb8eb-07ad-4934-b069-741588c6ea1c`, `a8739e1e-9cd2-4275-aa52-17fb1f586d99`, `a710eb73-903b-4604-9854-98511dc4537c` |  |
| `channel` | text | NOT NULL |  | 3 distinct; e.g. `product_review`, `tiktok_comment`, `tiktok` |  |
| `source_table` | text | NOT NULL |  | 3 distinct; e.g. `paddle_reviews`, `tiktok_comments`, `tiktok_videos` | Provenance: which raw table the row came from. Currently only `paddle_reviews`, `tiktok_comments`, `tiktok_videos` are present. |
| `source_id` | uuid | NOT NULL |  | 677 distinct; e.g. `7405fee4-17e6-4718-873f-d9d8818c56bc`, `4459977e-adde-42ee-b134-4edb7289d802`, `837dfe80-cf6b-4b74-b142-2c963ba5a21b` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 5 distinct; e.g. `f9acc948-f636-4582-a7eb-c98e630fb5cd`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `f8cb05a4-4de3-41a5-9c52-1ee7f5443926` |  |
| `product_id` | uuid | 27% | FK -> `products_catalog.id` | 26 distinct; e.g. `18f5e252-ffb0-45f3-8e1c-2d35d4d7c1d2`, `3e46b0a3-4f52-4d78-9767-f55cbc6c5fa2`, `9ad23234-4797-4a1e-b99a-459265335825` |  |
| `athlete_id` | uuid | 100% | FK -> `influencers.id` | **always NULL** in the sampled rows | Null for every live row - athlete attribution is not yet wired into the fact builder. |
| `sentiment_score` | numeric | 0% |  | 10 distinct; range 0 .. 1; e.g. `1.0`, `0.9`, `0.8` |  |
| `sentiment_label` | text | no |  | 3 distinct; e.g. `positive`, `neutral`, `very_positive` |  |
| `is_crisis` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `is_opportunity` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `is_purchase_intent` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `is_competitor_switch` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `country_code` | text | 100% |  | **always NULL** in the sampled rows |  |
| `text_snippet` | text | no |  | 661 distinct; e.g. `Great paddle — Great paddle`, `It have me the grit — It have me the grit to m...`, `Been great! — Been great!` |  |
| `posted_at` | timestamp with time zone | no |  | 585 distinct; e.g. `2025-06-02T00:00:00+00:00`, `2025-05-02T00:00:00+00:00`, `2025-05-10T00:00:00+00:00` |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 7 distinct; e.g. `2026-09-07T07:10:14.896071+00:00`, `2026-09-07T07:10:15.037141+00:00`, `2026-09-07T07:10:12.137587+00:00` |  |
| `engagement` | bigint <br>`= 0` | NOT NULL |  | 11 distinct; range 0 .. 2418; e.g. `0`, `1`, `2` | Channel-normalised engagement number so cross-channel comparison is possible. |
| `link_url` | text | 100% |  | 3 distinct; e.g. `https://www.tiktok.com/@selkirksport/video/757...`, `https://www.tiktok.com/@crbnpickleball/video/7...`, `https://www.tiktok.com/@selkirksport/video/750...` |  |

#### `product_mentions`

Product-attributed mentions: which canonical product was named, by which alias, in which source row and channel, with sentiment, intent flags and an engagement score. This is what product-level attention is built from.

| | |
|---|---|
| **Rows** | 1,568 |
| **Grain** | one row per (source row, matched product) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(source_table, source_row_id, product_id)` |
| **Written by** | `facts --source populate-product-mentions` -> `facts/populate_product_mentions.py` - upsert on `source_table,source_row_id,product_id` |
| **Read by** | `/v2/product-intel` (`paddleIntel.ts`) |
| **Foreign keys out** | `product_id` -> `products_catalog.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `occurred_at` 2015-10-20 -> 2026-09-07; `occurred_date` 2015-10-20 -> 2026-09-07; `created_at` 2026-05-23 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `d9b9d8c0-3d46-4ad2-af69-71204a649b25`, `1db71260-0071-4ade-b9bf-d764ffa472f7`, `5696768c-db37-4706-b266-15efb7d556d6` |  |
| `product_id` | uuid | NOT NULL | FK -> `products_catalog.id` | 66 distinct; e.g. `ca93d337-5c15-4bbd-8224-0074788e468c`, `3e46b0a3-4f52-4d78-9767-f55cbc6c5fa2`, `67660154-786a-4f1e-9232-3820e4c47024` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 11 distinct; e.g. `f8cb05a4-4de3-41a5-9c52-1ee7f5443926`, `04db8591-37a3-4634-9d11-536975fa6935`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec` |  |
| `source_table` | text | NOT NULL |  | 13 distinct; e.g. `reddit_mentions`, `ig_posts`, `yt_videos` |  |
| `source_row_id` | uuid | NOT NULL |  | 622 distinct; e.g. `1ff5096f-0e86-44c4-a025-4229e2dac214`, `12dc7cbb-082a-498c-bebc-aa7dd15cfa40`, `23a79a03-a634-44cc-85dc-7b8c7e50be69` |  |
| `channel` | text | NOT NULL |  | 8 distinct; e.g. `reddit`, `instagram`, `youtube` |  |
| `matched_alias` | text | no |  | 84 distinct; e.g. `Rally`, `Boomstik`, `Perseus` |  |
| `matched_alias_norm` | text | no |  | 84 distinct; e.g. `rally`, `boomstik`, `perseus` | The normalised alias that matched; join back to `product_aliases` to audit a match. |
| `match_confidence` | numeric <br>`= 1.0` | no |  | 1 distinct; range 1 .. 1; e.g. `1.0` | 1.0 for every row - exact alias matching only, no fuzzy scoring yet. |
| `is_jl_brand` | boolean | no |  | 2 distinct; e.g. `False`, `True` |  |
| `sentiment_label` | text | 38% |  | 6 distinct; e.g. `positive`, `neutral`, `negative` |  |
| `sentiment_score` | numeric | 42% |  | 14 distinct; range -1 .. 1; e.g. `0.0`, `0.5`, `0.8` |  |
| `is_purchase_intent` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `is_crisis` | boolean <br>`= False` | no |  | 2 distinct; e.g. `False`, `True` |  |
| `engagement_score` | numeric | no |  | 310 distinct; range 0 .. 1.113e+05; e.g. `0.0`, `1.8`, `30.0` |  |
| `raw_engagement` | jsonb | 13% |  | 287 distinct; e.g. `{"upvotes": 0}`, `{"like_count": 0}`, `{"comment_likes": 1}` |  |
| `occurred_at` | timestamp with time zone | 4% |  | 543 distinct; e.g. `2026-08-15T07:00:00+00:00`, `2026-08-26T21:19:06+00:00`, `2026-01-14T13:48:15+00:00` |  |
| `occurred_date` | date | 4% |  | 240 distinct; e.g. `2026-05-23`, `2026-08-15`, `2026-05-24` |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 64 distinct; e.g. `2026-06-28T09:44:47.204651+00:00`, `2026-06-28T09:44:49.838485+00:00`, `2026-06-28T09:44:53.433775+00:00` |  |

#### `topic_lifecycle`

Topic volume tracking per brand and channel per ISO week, with first-seen timestamp - used to see which conversation themes are emerging or dying. 62k rows, currently Reddit-only.

| | |
|---|---|
| **Rows** | 62,453 |
| **Grain** | one row per (brand, topic, channel, week) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(brand_id, topic, channel, week_number, year)` (re-created by `019`) |
| **Written by** | `facts --source topic-lifecycle` -> `facts/topic_lifecycle.py` - upsert on `brand_id,topic,channel,week_number,year` |
| **Read by** | `/v2/community-intel`, `/v2/data-health` |
| **Foreign keys out** | `brand_id` -> `brands.id` |
| **Date coverage** | `first_seen_at` 2016-03-05 -> 2026-09-07; `created_at` 2026-06-28 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `e3cbdfa3-aa61-4936-9b20-4bad7a9a01d2`, `c127855e-7ece-4e23-afd8-0dda57340802`, `f9a30157-2570-48c9-9160-6b72eaf3055a` |  |
| `brand_id` | uuid | NOT NULL | FK -> `brands.id` | 10 distinct; e.g. `19f54f73-9eaa-40ad-93ad-305c9bad33ff`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `topic` | text | NOT NULL |  | 555 distinct; e.g. `product_review`, `purchase_intent`, `tutorial` |  |
| `channel` | text | NOT NULL |  | 1 distinct; e.g. `reddit` |  |
| `mention_count` | integer <br>`= 0` | no |  | 30 distinct; range 1 .. 316; e.g. `1`, `2`, `3` |  |
| `first_seen_at` | timestamp with time zone | no |  | 494 distinct; e.g. `2026-06-01T13:23:41+00:00`, `2026-05-15T12:06:51+00:00`, `2026-06-18T13:09:05+00:00` |  |
| `week_number` | integer | NOT NULL |  | 2 distinct; range 26 .. 27; e.g. `26`, `27` |  |
| `year` | integer | NOT NULL |  | 1 distinct; range 2026 .. 2026; e.g. `2026` |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 4 distinct; e.g. `2026-06-28T09:05:04.705253+00:00`, `2026-06-28T09:05:05.383145+00:00`, `2026-06-29T07:12:11.997229+00:00` |  |

#### `competitor_switch_events`

Detected brand-switching moments ('I moved from Selkirk to JOOLA'), with from/to brand, confidence, the evidence snippet and the source URL. Two generations of columns coexist (`mention_id` vs `source_mention_id`).

| | |
|---|---|
| **Rows** | 114 |
| **Grain** | one row per detected switch |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE INDEX `(source_mention_id)` and UNIQUE INDEX `(posted_at, from_brand_id, to_brand_id)` |
| **Written by** | `facts` - two writers: `facts/mention_facts.py` and `facts/competitor_switch.py` - upsert, two different conflict keys |
| **Read by** | `/v2/community-intel` (defection signals) |
| **Foreign keys out** | `mention_id` -> `mention_facts.id`, `from_brand_id` -> `brands.id`, `to_brand_id` -> `brands.id` |
| **Date coverage** | `posted_at` 2025-11-25 -> 2026-09-05; `created_at` 2026-06-28 -> 2026-09-07; `detected_at` 2025-09-12 -> 2026-09-05 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 114 distinct; e.g. `c3547488-1491-4d49-a60c-4782ba51cabc`, `acd093e4-27ff-4d79-b47a-42c118fbc927`, `b0bc3933-3eef-4ff0-bc48-1ebc001aa81e` |  |
| `mention_id` | uuid | 100% | FK -> `mention_facts.id` | **always NULL** in the sampled rows |  |
| `from_brand_id` | uuid | 10% | FK -> `brands.id` | 9 distinct; e.g. `9f0eb357-eea4-4ab7-9a28-74cbb07940b0`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `to_brand_id` | uuid | 22% | FK -> `brands.id` | 8 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `f9acc948-f636-4582-a7eb-c98e630fb5cd` |  |
| `confidence` | numeric | 71% |  | 1 distinct; range 0.8 .. 0.8; e.g. `0.8` |  |
| `text_snippet` | text | 71% |  | 33 distinct; e.g. ` — There are probably 25 paddle companies that...`, `/u/kabob21 on Breaking up with DISPOSABLE padd...`, `/u/kabob21 on Breaking up with DISPOSABLE padd...` |  |
| `posted_at` | timestamp with time zone | 71% |  | 33 distinct; e.g. `2026-06-15T17:54:06.996+00:00`, `2026-09-05T06:30:42+00:00`, `2026-09-05T07:23:50+00:00` |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 19 distinct; e.g. `2026-06-28T09:27:17.323212+00:00`, `2026-08-17T03:15:36.861885+00:00`, `2026-06-28T09:46:41.673174+00:00` |  |
| `channel` | text | 29% |  | 1 distinct; e.g. `reddit` |  |
| `source_mention_id` | uuid | 29% |  | 81 distinct; e.g. `c05c6e34-5422-4602-aada-a8bf9ce706f4`, `01f52862-fb9a-471e-ab62-1759124cba49`, `acaf2090-b881-4e16-aaf9-a853c75ded5b` |  |
| `detected_at` | timestamp with time zone | 5% |  | 68 distinct; e.g. `2026-06-15T17:54:06.996+00:00`, `2026-06-27T11:42:58.594+00:00`, `2026-08-09T20:56:28+00:00` |  |
| `post_url` | text | 29% |  | 68 distinct; e.g. `https://www.reddit.com/r/Pickleball/comments/1...`, `https://www.reddit.com/r/Pickleball/comments/1...`, `https://www.reddit.com/r/PickleballEquip/comme...` |  |

#### `product_attention_daily`

Daily per-product attention mart: mention counts split by channel (IG, YouTube, Reddit, TikTok, X, influencer, ads, promos, news), an attention score, sentiment split, purchase-intent and crisis counts, plus a `sales_likelihood_score` with its input JSON for auditability.

| | |
|---|---|
| **Rows** | 619 |
| **Grain** | one row per (product, date) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(product_id, attention_date)` |
| **Written by** | `facts --source populate-product-attention` -> `facts/populate_product_attention.py` - upsert on `product_id,attention_date` |
| **Read by** | `/v2/product-intel` (+ brand/product/leaderboard sub-routes) |
| **Foreign keys out** | `product_id` -> `products_catalog.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `attention_date` 2026-01-24 -> 2026-09-07; `created_at` 2026-05-23 -> 2026-09-07; `updated_at` 2026-05-23 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 619 distinct; e.g. `a0ad04f3-9a3f-4d60-bd52-ee2fc0692387`, `4d5fa1c7-fb6f-4542-9328-9729ac218bcf`, `68e771cb-6bb8-4b99-affb-d18529bac96c` |  |
| `product_id` | uuid | NOT NULL | FK -> `products_catalog.id` | 58 distinct; e.g. `ca93d337-5c15-4bbd-8224-0074788e468c`, `3e46b0a3-4f52-4d78-9767-f55cbc6c5fa2`, `dcad7f3e-da50-4908-89a3-f7e44e04e41d` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 11 distinct; e.g. `f8cb05a4-4de3-41a5-9c52-1ee7f5443926`, `04db8591-37a3-4634-9d11-536975fa6935`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec` |  |
| `attention_date` | date | NOT NULL |  | 175 distinct; e.g. `2026-05-23`, `2026-05-24`, `2026-08-27` |  |
| `mentions_total` | integer <br>`= 0` | no |  | 10 distinct; range 1 .. 15; e.g. `1`, `2`, `3` |  |
| `mentions_instagram` | integer <br>`= 0` | no |  | 5 distinct; range 0 .. 4; e.g. `0`, `1`, `2` |  |
| `mentions_youtube` | integer <br>`= 0` | no |  | 4 distinct; range 0 .. 7; e.g. `0`, `1`, `2` |  |
| `mentions_reddit` | integer <br>`= 0` | no |  | 10 distinct; range 0 .. 15; e.g. `0`, `1`, `2` |  |
| `mentions_tiktok` | integer <br>`= 0` | no |  | 2 distinct; range 0 .. 1; e.g. `0`, `1` |  |
| `mentions_twitter` | integer <br>`= 0` | no |  | 2 distinct; range 0 .. 1; e.g. `0`, `1` |  |
| `mentions_influencer` | integer <br>`= 0` | no |  | 3 distinct; range 0 .. 2; e.g. `0`, `1`, `2` |  |
| `mentions_ads` | integer <br>`= 0` | no |  | 5 distinct; range 0 .. 6; e.g. `0`, `1`, `2` |  |
| `mentions_promotions` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `mentions_news` | integer <br>`= 0` | no |  | 2 distinct; range 0 .. 1; e.g. `0`, `1` |  |
| `attention_score` | numeric <br>`= 0` | no |  | 243 distinct; range 0 .. 3.973e+04; e.g. `0.0`, `1.8`, `1.5` |  |
| `positive_mentions` | integer <br>`= 0` | no |  | 8 distinct; range 0 .. 7; e.g. `0`, `1`, `2` |  |
| `neutral_mentions` | integer <br>`= 0` | no |  | 7 distinct; range 0 .. 8; e.g. `0`, `1`, `2` |  |
| `negative_mentions` | integer <br>`= 0` | no |  | 6 distinct; range 0 .. 6; e.g. `0`, `1`, `2` |  |
| `purchase_intent_count` | integer <br>`= 0` | no |  | 7 distinct; range 0 .. 6; e.g. `0`, `1`, `2` |  |
| `crisis_mentions` | integer <br>`= 0` | no |  | 6 distinct; range 0 .. 5; e.g. `0`, `1`, `2` |  |
| `sales_likelihood_score` | numeric <br>`= 0` | no |  | 247 distinct; range 0 .. 100; e.g. `0.0`, `100.0`, `0.6` |  |
| `sales_likelihood_inputs` | jsonb | no |  | 303 distinct; e.g. `{"attention_score": 30.0, "crisis_count": 0, "...`, `{"attention_score": 84.0, "crisis_count": 0, "...`, `{"attention_score": 0.0, "crisis_count": 0, "n...` | The exact inputs behind the score, kept for auditability - read this before trusting the score. |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 16 distinct; e.g. `2026-06-28T09:45:41.037024+00:00`, `2026-05-23T16:57:03.525984+00:00`, `2026-08-31T08:06:37.886707+00:00` |  |
| `updated_at` | timestamp with time zone <br>`= now()` | no |  | 16 distinct; e.g. `2026-06-28T09:45:41.037024+00:00`, `2026-05-23T16:57:03.525984+00:00`, `2026-08-31T08:06:37.886707+00:00` |  |

#### `product_attention_summary`

Period rollups of the same measures (30d / 90d / all_time) with rank within brand, rank overall and a JOOLA-vs-competitor gap - the table behind product leaderboards.

| | |
|---|---|
| **Rows** | 212 |
| **Grain** | one row per (product, period) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(product_id, period)` |
| **Written by** | same file as `product_attention_daily` - upsert on `product_id,period` |
| **Read by** | `/v2/product-intel`, `/v2/market`, `/v2/sales-intel`, `/v2/influencers` |
| **Foreign keys out** | `product_id` -> `products_catalog.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `period_start` 2026-03-30 -> 2026-08-31; `period_end` 2026-06-28 -> 2026-09-07; `computed_at` 2026-05-23 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 212 distinct; e.g. `67b121d4-c33c-45f5-a925-8e2997db8ecb`, `88d10c9c-9e02-4d71-b9ab-663cf65df8fb`, `ac169583-b41b-40b4-ab25-9cfee3b60821` |  |
| `product_id` | uuid | NOT NULL | FK -> `products_catalog.id` | 58 distinct; e.g. `f5c51504-afa7-4959-98dd-b5336aa84d6d`, `32a6266b-3f99-447c-b2dd-cb2ca238a232`, `8d578d8e-55da-4b34-b97a-8276f8ef1784` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 11 distinct; e.g. `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `f8cb05a4-4de3-41a5-9c52-1ee7f5443926`, `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `period` | text | NOT NULL |  | 4 distinct; e.g. `last_90d`, `all_time`, `last_30d` | `last_30d`, `last_90d`, `all_time` (and one `last_7d`). |
| `period_start` | date | 27% |  | 20 distinct; e.g. `2026-06-09`, `2026-08-08`, `2026-08-31` |  |
| `period_end` | date | NOT NULL |  | 11 distinct; e.g. `2026-09-07`, `2026-08-31`, `2026-08-18` |  |
| `mentions_total` | integer <br>`= 0` | no |  | 38 distinct; range 1 .. 96; e.g. `1`, `2`, `3` |  |
| `attention_score` | numeric <br>`= 0` | no |  | 111 distinct; range 0 .. 1.065e+05; e.g. `84.0`, `0.0`, `1.5` |  |
| `positive_mentions` | integer <br>`= 0` | no |  | 22 distinct; range 0 .. 35; e.g. `0`, `1`, `2` |  |
| `negative_mentions` | integer <br>`= 0` | no |  | 8 distinct; range 0 .. 26; e.g. `0`, `1`, `3` |  |
| `purchase_intent_count` | integer <br>`= 0` | no |  | 21 distinct; range 0 .. 38; e.g. `0`, `2`, `1` |  |
| `crisis_mentions` | integer <br>`= 0` | no |  | 8 distinct; range 0 .. 24; e.g. `0`, `1`, `2` |  |
| `sales_likelihood_score` | numeric <br>`= 0` | no |  | 131 distinct; range 0 .. 100; e.g. `1.68`, `28.0`, `16.03` |  |
| `rank_in_brand` | integer | no |  | 11 distinct; range 1 .. 11; e.g. `1`, `2`, `3` |  |
| `rank_overall` | integer | no |  | 56 distinct; range 1 .. 56; e.g. `8`, `17`, `11` |  |
| `joola_vs_competitor_gap` | numeric | 15% |  | 147 distinct; range -8.405e+04 .. 2.455e+04; e.g. `198.21`, `6375.9`, `22466.58` | Signed gap vs the competitor set; negative means JOOLA trails. |
| `computed_at` | timestamp with time zone <br>`= now()` | no |  | 13 distinct; e.g. `2026-06-28T09:45:41.72823+00:00`, `2026-05-23T16:57:04.379851+00:00`, `2026-07-20T05:32:07.74941+00:00` |  |

#### `product_attention_sales_correlation`

Designed to correlate attention against estimated sales with a lag. Never populated - needs a longer sales history.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per (product, window) (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(product_id, window_start, window_end)` |
| **Written by** | nothing - never written |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `product_id` -> `products_catalog.id`, `brand_id` -> `brands.id` |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | _table is empty_ |  |
| `product_id` | uuid | NOT NULL | FK -> `products_catalog.id` | _table is empty_ |  |
| `brand_id` | uuid | - | FK -> `brands.id` | _table is empty_ |  |
| `window_start` | date | NOT NULL |  | _table is empty_ |  |
| `window_end` | date | NOT NULL |  | _table is empty_ |  |
| `attention_score_sum` | numeric | - |  | _table is empty_ |  |
| `estimated_units_sold_sum` | numeric | - |  | _table is empty_ |  |
| `correlation_coefficient` | numeric | - |  | _table is empty_ |  |
| `lag_days` | integer | - |  | _table is empty_ |  |
| `confidence_score` | numeric | - |  | _table is empty_ |  |
| `computed_at` | timestamp with time zone <br>`= now()` | - |  | _table is empty_ |  |

### Sales intelligence (inferred)

Estimated units/revenue derived from inventory movement - no real sales feed exists, these are modelled numbers.

#### `inventory_events`

Inferred inventory movements from consecutive storefront snapshots: sellout, reappearance, sale, new-variant detection - each with a reason code and a confidence score. Quantity columns are mostly null because storefronts rarely expose stock numbers.

| | |
|---|---|
| **Rows** | 10,710 |
| **Grain** | one row per detected inventory event |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | none (append-only) |
| **Written by** | `sales-intelligence` -> `sales_intelligence/estimate.py`, `sellout.py`, `launches.py` - append-only insert |
| **Read by** | `/v2/sales-intel`, `/v2/market`, `/v2/data-health` |
| **Foreign keys out** | `brand_id` -> `brands.id`, `product_id` -> `products_catalog.id`, `variant_id` -> `product_variants.id` |
| **Date coverage** | `event_time` 2026-05-24 -> 2026-09-07; `created_at` 2026-06-05 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `26c9c860-51ee-4f58-9b08-cad6b551090f`, `dbc186dc-2dc8-4741-9c43-125cb49109ca`, `cbaf8934-7ad8-49a4-974e-30ea69ead9b2` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 4 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `19f54f73-9eaa-40ad-93ad-305c9bad33ff` |  |
| `product_id` | uuid | 100% | FK -> `products_catalog.id` | **always NULL** in the sampled rows |  |
| `variant_id` | uuid | 1% | FK -> `product_variants.id` | 719 distinct; e.g. `1355ea59-9027-410a-8321-7ccf9fd049f8`, `cd4406f7-a7e3-4314-9580-f12146aba4b6`, `7040658d-408b-4d0e-b448-d99afb543c09` |  |
| `event_time` | timestamp with time zone <br>`= now()` | no |  | 6 distinct; e.g. `2026-06-05T03:56:48.271841+00:00`, `2026-06-05T04:01:01.711998+00:00`, `2026-06-05T04:01:01.717711+00:00` |  |
| `event_type` | text | NOT NULL |  | 4 distinct; e.g. `sellout`, `reappearance`, `sale` |  |
| `previous_qty` | integer | 100% |  | **always NULL** in the sampled rows |  |
| `current_qty` | integer | 29% |  | 1 distinct; range 0 .. 0; e.g. `0` | Mostly null/zero - storefronts rarely publish stock counts, so events lean on availability flips. |
| `delta_qty` | integer | 100% |  | **always NULL** in the sampled rows |  |
| `confidence_score` | numeric <br>`= 0.5` | no |  | 3 distinct; range 0.25 .. 0.8; e.g. `0.8`, `0.6`, `0.25` |  |
| `reason_code` | text | no |  | 4 distinct; e.g. `zero_stock_detected`, `new_variant_detected`, `availability_flip` |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 5 distinct; e.g. `2026-06-05T03:56:50.234712+00:00`, `2026-06-05T04:01:03.666772+00:00`, `2026-06-05T04:01:03.750507+00:00` |  |

#### `sales_estimates`

Modelled units/revenue per variant per day derived from availability flips, with the price used, an estimation method and a low confidence score (0.25). Not actual sales.

| | |
|---|---|
| **Rows** | 24 |
| **Grain** | one row per (variant, estimate date) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(brand_id, variant_id, estimate_date)` |
| **Written by** | `sales-intelligence --source estimate` -> `sales_intelligence/estimate.py` - upsert on `brand_id,variant_id,estimate_date` |
| **Read by** | `/v2/sales-intel` |
| **Foreign keys out** | `brand_id` -> `brands.id`, `product_id` -> `products_catalog.id`, `variant_id` -> `product_variants.id` |
| **Date coverage** | `estimate_date` 2026-05-24 -> 2026-08-17; `created_at` 2026-06-05 -> 2026-08-17 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 24 distinct; e.g. `edcdf4da-a12c-4dbf-a14b-804bc5d4f4b5`, `a2a91489-3e91-4fb8-a0ba-1c2ca0b277fe`, `8a621a93-7464-4158-be62-bc50c8b409a3` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 1 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `product_id` | uuid | 100% | FK -> `products_catalog.id` | **always NULL** in the sampled rows |  |
| `variant_id` | uuid | 33% | FK -> `product_variants.id` | 16 distinct; e.g. `061312f7-957f-4409-b512-f3810ea47185`, `08245ef9-466b-499a-a45c-0d0b6101ff9f`, `0fbe8a79-e5ae-4989-8f43-49ff83b9f55d` |  |
| `estimate_date` | date | NOT NULL |  | 4 distinct; e.g. `2026-08-17`, `2026-06-01`, `2026-05-24` |  |
| `estimated_units_sold` | numeric | no |  | 1 distinct; range 1 .. 1; e.g. `1.0` |  |
| `estimated_revenue` | numeric | no |  | 13 distinct; range 14.95 .. 249.9; e.g. `229.95`, `14.95`, `139.95` |  |
| `currency` | text <br>`= USD` | no |  | 1 distinct; e.g. `USD` |  |
| `price_used` | numeric | no |  | 13 distinct; range 14.95 .. 249.9; e.g. `229.95`, `14.95`, `139.95` |  |
| `confidence_score` | numeric <br>`= 0.5` | no |  | 1 distinct; range 0.25 .. 0.25; e.g. `0.25` | 0.25 for every row. These are weak inferences, not sales data. |
| `inventory_start` | integer | 100% |  | **always NULL** in the sampled rows |  |
| `inventory_end` | integer | 33% |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `restock_qty` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `adjustment_qty` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `estimation_method` | text | no |  | 1 distinct; e.g. `availability_flip` |  |
| `notes` | text | 100% |  | **always NULL** in the sampled rows |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 4 distinct; e.g. `2026-08-17T18:07:40.065142+00:00`, `2026-06-05T03:53:36.954144+00:00`, `2026-06-05T03:54:58.608374+00:00` |  |

#### `sales_facts_daily`

Daily rollup of the estimates with stockout/restock/promotion flags and an average price. Same caveat: inferred, not booked revenue.

| | |
|---|---|
| **Rows** | 16 |
| **Grain** | one row per (brand/variant, date) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(brand_id, date, variant_id)` |
| **Written by** | `sales-intelligence --source revenue` -> `sales_intelligence/revenue.py` - upsert on `brand_id,date,variant_id` |
| **Read by** | `/v2/sales-intel`, `/v2/data-health` |
| **Foreign keys out** | `brand_id` -> `brands.id`, `product_id` -> `products_catalog.id`, `variant_id` -> `product_variants.id` |
| **Date coverage** | `date` 2026-06-28 -> 2026-08-17; `created_at` 2026-06-28 -> 2026-08-17 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 16 distinct; e.g. `dba983db-fada-4a6a-89b7-6b86a1f626cf`, `37c46ceb-9d52-4733-b1fc-080087d95142`, `dd0ff54b-ee11-4828-9d58-1dbacdde7c46` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 1 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `date` | date | NOT NULL |  | 2 distinct; e.g. `2026-08-17`, `2026-06-28` |  |
| `category` | text | 100% |  | **always NULL** in the sampled rows |  |
| `product_id` | uuid | 100% | FK -> `products_catalog.id` | **always NULL** in the sampled rows |  |
| `variant_id` | uuid | no | FK -> `product_variants.id` | 16 distinct; e.g. `11b0f74e-a5ee-4c29-bce1-5723442b3e23`, `25f1ad1c-ee84-4e68-b11a-b16d8d002662`, `061312f7-957f-4409-b512-f3810ea47185` |  |
| `estimated_units_sold` | numeric | no |  | 1 distinct; range 1 .. 1; e.g. `1.0` |  |
| `estimated_revenue` | numeric | no |  | 10 distinct; range 14.95 .. 179.9; e.g. `14.95`, `139.95`, `17.97` | Modelled: units x price_used. Never present this as booked revenue. |
| `avg_price` | numeric | no |  | 10 distinct; range 14.95 .. 179.9; e.g. `14.95`, `139.95`, `17.97` |  |
| `discount_percent` | numeric | 100% |  | **always NULL** in the sampled rows |  |
| `stockout_flag` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `restock_flag` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `promotion_flag` | boolean <br>`= False` | no |  | 1 distinct; e.g. `False` |  |
| `confidence_score` | numeric <br>`= 0.5` | no |  | 1 distinct; range 0.25 .. 0.25; e.g. `0.25` |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 2 distinct; e.g. `2026-08-17T18:07:43.069904+00:00`, `2026-06-28T07:55:21.847426+00:00` |  |

### Analytics & statistics marts

Weekly/daily timeseries marts plus the statistical layer (correlation, Granger, changepoint, ITS, forecast) and AI narratives.

#### `joola_timeseries_daily`

Daily analytics mart joining attention, ad pressure, promo, price, availability and sales-estimate measures per brand (and optionally per canonical product). The economics columns (price, availability, units, revenue) are entirely null today - only the attention/engagement side is populated.

| | |
|---|---|
| **Rows** | 5,619 |
| **Grain** | one row per (brand, product, date) |
| **Kind** | **materialized view** - refreshed, not written |
| **Primary key** | `brand_id` |
| **Uniqueness / upsert key** | UNIQUE INDEX `(metric_date, brand_id, coalesce(canonical_product_id, nil-uuid))` |
| **Written by** | `analytics` -> `marts/refresh_timeseries.py` - REFRESH MATERIALIZED VIEW |
| **Read by** | `/v2/changepoints`, `/v2/product-intel` |
| **Foreign keys out** | `canonical_product_id` -> `products_catalog.id` |
| **Date coverage** | `metric_date` 2025-01-01 -> 2026-05-24 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `metric_date` | date | no |  | 509 distinct; e.g. `2026-03-06`, `2026-05-14`, `2026-05-23` |  |
| `brand_id` | uuid | no | **PK** | 2 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `0926e8fa-34d4-4aa8-96e6-ec01425f0fb1` |  |
| `canonical_product_id` | uuid | 95% | FK -> `products_catalog.id` | 6 distinct; e.g. `dcad7f3e-da50-4908-89a3-f7e44e04e41d`, `3b8a6714-d246-4abe-9be9-1c3a0e718693`, `2ad2f515-3fc6-4df7-acc7-69737fbd5c40` |  |
| `canonical_product_name` | text | 95% |  | 6 distinct; e.g. `Perseus IV`, `Hyperion CFS`, `Agassi Pro` |  |
| `mention_count` | integer | no |  | 5 distinct; range 0 .. 4; e.g. `0`, `1`, `2` |  |
| `total_engagement` | numeric | no |  | 13 distinct; range 0 .. 411.4; e.g. `0`, `1.8`, `411.45` |  |
| `attention_score` | numeric | no |  | 13 distinct; range 0 .. 411.4; e.g. `0`, `1.8`, `411.45` |  |
| `sales_likelihood_score` | numeric | no |  | 19 distinct; range 0 .. 44; e.g. `0`, `28.0`, `20.0` |  |
| `ad_pressure_score` | numeric | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `promo_active_flag` | integer | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `promo_depth_pct` | numeric | 100% |  | **always NULL** in the sampled rows |  |
| `price_usd` | numeric | 100% |  | **always NULL** in the sampled rows | Entire economics block (price, index, availability, units, revenue) is null - the mart is attention-only today. |
| `price_index_90d` | numeric | 100% |  | **always NULL** in the sampled rows |  |
| `availability_index` | numeric | 100% |  | **always NULL** in the sampled rows |  |
| `estimated_units_sold` | numeric | 100% |  | **always NULL** in the sampled rows |  |
| `estimated_revenue` | numeric | 100% |  | **always NULL** in the sampled rows |  |
| `sales_estimate_confidence` | numeric | 100% |  | **always NULL** in the sampled rows |  |

#### `joola_timeseries_weekly`

Weekly aggregation of the same mart (avg/max attention, any-promo flag, averages of the economics columns). Same caveat about null economics.

| | |
|---|---|
| **Rows** | 870 |
| **Grain** | one row per (brand, product, ISO week) |
| **Kind** | **materialized view** - refreshed, not written |
| **Primary key** | `brand_id` |
| **Uniqueness / upsert key** | UNIQUE INDEX `(week_start, brand_id, coalesce(canonical_product_id, nil-uuid))` |
| **Written by** | `analytics` -> `marts/refresh_timeseries.py` - REFRESH MATERIALIZED VIEW |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `canonical_product_id` -> `products_catalog.id` |
| **Date coverage** | `week_start` 2024-12-30 -> 2026-05-18 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `week_start` | date | no |  | 73 distinct; e.g. `2026-05-18`, `2026-04-27`, `2026-05-04` |  |
| `brand_id` | uuid | no | **PK** | 11 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec`, `f8cb05a4-4de3-41a5-9c52-1ee7f5443926` |  |
| `canonical_product_id` | uuid | 92% | FK -> `products_catalog.id` | 17 distinct; e.g. `dcad7f3e-da50-4908-89a3-f7e44e04e41d`, `3b8a6714-d246-4abe-9be9-1c3a0e718693`, `67660154-786a-4f1e-9232-3820e4c47024` |  |
| `canonical_product_name` | text | 92% |  | 17 distinct; e.g. `Perseus IV`, `Hyperion CFS`, `Signature Pro` |  |
| `mention_count` | bigint | no |  | 8 distinct; range 0 .. 7; e.g. `0`, `1`, `2` |  |
| `total_engagement` | numeric | no |  | 31 distinct; range 0 .. 3277; e.g. `0`, `1.8`, `3.6` |  |
| `attention_score_avg` | numeric | no |  | 32 distinct; range 0 .. 3277; e.g. `0.0`, `1.8`, `3.6` |  |
| `attention_score_max` | numeric | no |  | 30 distinct; range 0 .. 3277; e.g. `0`, `1.8`, `3.6` |  |
| `ad_pressure_score_avg` | numeric | no |  | 1 distinct; range 0 .. 0; e.g. `0.0` |  |
| `promo_active_any` | integer | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `promo_depth_pct_avg` | numeric | 100% |  | **always NULL** in the sampled rows |  |
| `price_usd_avg` | numeric | 100% |  | **always NULL** in the sampled rows |  |
| `price_index_90d_avg` | numeric | 100% |  | **always NULL** in the sampled rows |  |
| `availability_index_avg` | numeric | 100% |  | **always NULL** in the sampled rows |  |
| `estimated_units_sold` | numeric | 100% |  | **always NULL** in the sampled rows |  |
| `estimated_revenue` | numeric | 100% |  | **always NULL** in the sampled rows |  |

#### `composite_scores_weekly`

Weekly composite attention and sales-likelihood scores for JOOLA with the component breakdown kept as JSON, plus an AI narrative explaining the week.

| | |
|---|---|
| **Rows** | 26 |
| **Grain** | one row per (brand, ISO week) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | analytics statistics layer - insert |
| **Read by** | _no frontend consumer_ |
| **Date coverage** | `week_start` 2025-11-24 -> 2026-05-18; `created_at` 2026-05-24 -> 2026-05-24 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 26 distinct; e.g. `55c1b0e6-a64b-41cc-a24e-7fe71aba24da`, `0adc4ef0-d96a-44d0-9b00-514c6d579059`, `52c1ca2b-ed62-4e28-b36e-f03b001b81d3` |  |
| `brand_id` | uuid | NOT NULL |  | 1 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `week_start` | date | NOT NULL |  | 26 distinct; e.g. `2025-11-24`, `2025-12-01`, `2025-12-08` |  |
| `attention_score` | double precision <br>`= 0` | NOT NULL |  | 26 distinct; range 1.27 .. 32.04; e.g. `6.31`, `15.16`, `20.68` |  |
| `sales_likelihood_score` | double precision <br>`= 0` | NOT NULL |  | 25 distinct; range 0 .. 70; e.g. `10`, `18.64`, `11.75` |  |
| `attention_components` | jsonb | no |  | 26 distinct; e.g. `{"ig_views": 14.7, "rd_mentions": 11.4, "rd_up...`, `{"ig_views": 60.6, "rd_mentions": 0.0, "rd_upv...`, `{"ig_views": 76.9, "rd_mentions": 5.7, "rd_upv...` |  |
| `sales_components` | jsonb | no |  | 25 distinct; e.g. `{"ig_engagement_rate": 0.0, "ig_purchase_inten...`, `{"ig_engagement_rate": 51.0, "ig_purchase_inte...`, `{"ig_engagement_rate": 39.2, "ig_purchase_inte...` |  |
| `ai_narrative` | text | 85% |  | 4 distinct; e.g. `The current low attention and sales likelihood...`, `The low attention and sales likelihood scores ...`, `This week, JOOLA's attention score of 32.0 is ...` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 1 distinct; e.g. `2026-05-24T04:59:06.337558+00:00` |  |

#### `analysis_results`

Generic statistical-result store for lag scans and changepoint detection: driver/target metric pair, sample size, best lag, score and p-value, with the full model payload in JSONB.

| | |
|---|---|
| **Rows** | 645 |
| **Grain** | one row per analysis |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(kind, brand_id, product_id, driver, target, metric_date)` - nullable members mean NULLs dedupe as distinct |
| **Written by** | `analytics` statistics -> `correlation_scan.py`, `cross_correlation.py`, `changepoints.py`, `granger.py` - upsert on `kind,brand_id,product_id,driver,target,metric_date` |
| **Read by** | `/v2/correlations`, `/v2/changepoints`, `/v2/data-health` |
| **Foreign keys out** | `brand_id` -> `brands.id`, `product_id` -> `products_catalog.id` |
| **Date coverage** | `metric_date` 2026-05-24 -> 2026-09-07; `computed_at` 2026-05-24 -> 2026-09-07 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 645 distinct; e.g. `de78a9d4-0dca-4771-a496-6ef6e9179652`, `16dc8ce0-321f-4d01-99d4-f92c500678d1`, `7907fa96-5c6c-4697-b966-26c2f312fe37` |  |
| `kind` | text | NOT NULL |  | 2 distinct; e.g. `lag_scan`, `changepoint` |  |
| `brand_id` | uuid | NOT NULL | FK -> `brands.id` | 8 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `f8cb05a4-4de3-41a5-9c52-1ee7f5443926`, `9f0eb357-eea4-4ab7-9a28-74cbb07940b0` |  |
| `product_id` | uuid | 27% | FK -> `products_catalog.id` | 11 distinct; e.g. `dcad7f3e-da50-4908-89a3-f7e44e04e41d`, `2ad2f515-3fc6-4df7-acc7-69737fbd5c40`, `3b8a6714-d246-4abe-9be9-1c3a0e718693` |  |
| `driver` | text | no |  | 2 distinct; e.g. `attention_score`, `total_engagement` |  |
| `target` | text | no |  | 2 distinct; e.g. `mention_count`, `attention_score` |  |
| `metric_date` | date | NOT NULL |  | 19 distinct; e.g. `2026-05-24`, `2026-06-05`, `2026-08-18` |  |
| `payload` | jsonb | NOT NULL |  | 69 distinct; e.g. `{"changepoint_dates": [], "model": "rbf", "n_c...`, `{"lags": [-1, 0, 1], "n": [7, 10, 7], "pearson...`, `{"lags": [-18, -13, -12, -11, -10, -8, -7, -6,...` |  |
| `n_samples` | integer | no |  | 28 distinct; range 5 .. 180; e.g. `180`, `5`, `179` |  |
| `best_lag` | integer | 40% |  | 8 distinct; range -23 .. 12; e.g. `-1`, `1`, `0` |  |
| `best_score` | numeric | no |  | 39 distinct; range -1 .. 1; e.g. `0.0`, `-0.6655542095044182`, `0.9903387290509738` |  |
| `best_pvalue` | numeric | 40% |  | 43 distinct; range 0 .. 0.6033; e.g. `1.7530246063650314e-05`, `0.0`, `0.10272307457393848` |  |
| `computed_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 41 distinct; e.g. `2026-05-24T08:48:53.478472+00:00`, `2026-05-25T06:32:03.55882+00:00`, `2026-06-01T07:11:21.94021+00:00` |  |

#### `analytics_runs`

Run log for the analytics backend: type, timing, rows processed, status and trigger source.

| | |
|---|---|
| **Rows** | 25 |
| **Grain** | one row per analytics run |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | `analytics_backend/run.py` - insert per run |
| **Read by** | _no frontend consumer_ |
| **Referenced by** | `changepoint_results.run_id`, `correlation_results.run_id`, `forecast_results.run_id`, `granger_results.run_id`, `its_results.run_id` |
| **Date coverage** | `started_at` 2026-05-24 -> 2026-05-27; `completed_at` 2026-05-24 -> 2026-05-27 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 25 distinct; e.g. `15cc72bf-d93c-4833-9154-4c3c296642ca`, `7054f553-d842-42f4-8157-16d3c78cef6d`, `78d06b51-bfc0-4752-8714-15221ddfc0da` |  |
| `run_type` | text | NOT NULL |  | 1 distinct; e.g. `etl` |  |
| `started_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 25 distinct; e.g. `2026-05-24T04:54:59.225244+00:00`, `2026-05-24T04:56:33.783915+00:00`, `2026-05-24T04:58:19.021841+00:00` |  |
| `completed_at` | timestamp with time zone | no |  | 25 distinct; e.g. `2026-05-24T04:55:02.490939+00:00`, `2026-05-24T04:56:37.200927+00:00`, `2026-05-24T04:58:22.159225+00:00` |  |
| `status` | text <br>`= running` | NOT NULL |  | 2 distinct; e.g. `failed`, `completed` |  |
| `rows_processed` | integer <br>`= 0` | NOT NULL |  | 2 distinct; range 0 .. 472; e.g. `0`, `472` |  |
| `error_message` | text | 12% |  | 1 distinct; e.g. `{'message': "Could not find the 'metric_name' ...` |  |
| `triggered_by` | text <br>`= scheduler` | NOT NULL |  | 2 distinct; e.g. `scheduler`, `manual` |  |

#### `correlation_results`

Pairwise Pearson/Spearman correlation between brand metrics over a rolling window, with p-value and an optional AI narrative.

| | |
|---|---|
| **Rows** | 45 |
| **Grain** | one row per (metric A, metric B, run) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | analytics statistics layer - insert |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `run_id` -> `analytics_runs.id` |
| **Date coverage** | `created_at` 2026-05-24 -> 2026-05-24 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 45 distinct; e.g. `7a0f05d3-f96e-4b47-808b-1e6e740f61e6`, `bc878248-d52f-44ac-bde2-f7c68055cadf`, `cc6ed59c-682e-4bc9-ba2a-fe1de5818aa0` |  |
| `run_id` | uuid | no | FK -> `analytics_runs.id` | 1 distinct; e.g. `78d06b51-bfc0-4752-8714-15221ddfc0da` |  |
| `brand_id` | uuid | NOT NULL |  | 1 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `metric_a` | text | NOT NULL |  | 9 distinct; e.g. `ig_complaints`, `ig_engagement_rate`, `ig_posts` |  |
| `metric_b` | text | NOT NULL |  | 9 distinct; e.g. `tt_views`, `tt_videos`, `rd_upvotes` |  |
| `pearson_r` | double precision | no |  | 45 distinct; range -0.4657 .. 0.9725; e.g. `-0.320376211382333`, `-0.104941667021712`, `-0.158220728778686` |  |
| `spearman_r` | double precision | no |  | 45 distinct; range -0.4689 .. 0.943; e.g. `-0.234055219891721`, `-0.0845129174106663`, `-0.374905651238632` |  |
| `p_value` | double precision | no |  | 45 distinct; range 1.061e-16 .. 0.9755; e.g. `0.110567276393748`, `0.609914637753509`, `0.440129534122347` |  |
| `n_weeks` | integer | NOT NULL |  | 1 distinct; range 26 .. 26; e.g. `26` |  |
| `window_weeks` | integer | NOT NULL |  | 1 distinct; range 26 .. 26; e.g. `26` |  |
| `ai_narrative` | text | 98% |  | 1 distinct; e.g. `The strongest relationship we see is between r...` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 1 distinct; e.g. `2026-05-24T04:58:27.050535+00:00` |  |

#### `granger_results`

Granger-causality tests between metric pairs: optimal lag, F statistic, p-value, significance flag and narrative.

| | |
|---|---|
| **Rows** | 36 |
| **Grain** | one row per (cause, effect, run) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | analytics statistics layer - insert |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `run_id` -> `analytics_runs.id` |
| **Date coverage** | `created_at` 2026-05-24 -> 2026-05-24 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 36 distinct; e.g. `a9770dd8-f290-41c5-a4f7-a43ba37ef48f`, `d2219a5c-fe87-42bb-9b26-5b300faea9ad`, `6573dedd-536a-4a95-9ab9-7346b8b8abed` |  |
| `run_id` | uuid | no | FK -> `analytics_runs.id` | 1 distinct; e.g. `78d06b51-bfc0-4752-8714-15221ddfc0da` |  |
| `brand_id` | uuid | NOT NULL |  | 1 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `cause_metric` | text | NOT NULL |  | 10 distinct; e.g. `ig_engagement_rate`, `ig_views`, `ig_posts` |  |
| `effect_metric` | text | NOT NULL |  | 10 distinct; e.g. `ig_engagement_rate`, `ig_posts`, `ig_views` |  |
| `max_lag_weeks` | integer | NOT NULL |  | 1 distinct; range 4 .. 4; e.g. `4` |  |
| `optimal_lag` | integer | no |  | 4 distinct; range 1 .. 4; e.g. `1`, `2`, `3` |  |
| `f_stat` | double precision | no |  | 36 distinct; range 0.04677 .. 7.743; e.g. `1.37724634006878`, `3.65857791055058`, `1.34170885823242` |  |
| `p_value` | double precision | no |  | 36 distinct; range 0.002041 .. 0.8308; e.g. `0.295257607125844`, `0.035096406292361`, `0.306693247846234` |  |
| `is_significant` | boolean <br>`= False` | NOT NULL |  | 2 distinct; e.g. `False`, `True` |  |
| `ai_narrative` | text | 89% |  | 4 distinct; e.g. `The Granger causality test indicates that incr...`, `The Granger causality test indicates that an i...`, `The Granger causality test indicates that a hi...` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 1 distinct; e.g. `2026-05-24T04:58:34.870292+00:00` |  |

#### `changepoint_results`

Detected structural breaks in weekly metrics: changepoint week, pre/post means, percent change, direction and an AI-generated label for what likely caused it.

| | |
|---|---|
| **Rows** | 29 |
| **Grain** | one row per detected changepoint |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | analytics statistics layer - insert |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `run_id` -> `analytics_runs.id` |
| **Date coverage** | `changepoint_week` 2025-12-29 -> 2026-04-13; `created_at` 2026-05-24 -> 2026-05-24 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 29 distinct; e.g. `d74bfecf-b3e9-4430-a679-adcea15a76d9`, `0132fa26-6f47-4a2b-afe8-e7c5e27342df`, `67e3d62f-587c-445b-b2e6-aa754e693fe1` |  |
| `run_id` | uuid | no | FK -> `analytics_runs.id` | 1 distinct; e.g. `78d06b51-bfc0-4752-8714-15221ddfc0da` |  |
| `brand_id` | uuid | NOT NULL |  | 1 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `metric` | text | NOT NULL |  | 9 distinct; e.g. `ig_views`, `ig_posts`, `ig_engagement_rate` |  |
| `changepoint_week` | date | NOT NULL |  | 4 distinct; e.g. `2026-03-09`, `2026-04-13`, `2026-02-02` |  |
| `confidence` | double precision | 100% |  | **always NULL** in the sampled rows |  |
| `pre_mean` | double precision | no |  | 27 distinct; range 0 .. 1.253e+05; e.g. `0`, `0.2`, `71297` |  |
| `post_mean` | double precision | no |  | 29 distinct; range 0 .. 6.18e+04; e.g. `57938.9047619048`, `61801.3125`, `32959.2727272727` |  |
| `pct_change` | double precision | no |  | 28 distinct; range -100 .. 6983; e.g. `0`, `-18.7358447593801`, `35.591042624706` |  |
| `direction` | text | no |  | 2 distinct; e.g. `decrease`, `increase` |  |
| `ai_label` | text | no |  | 22 distinct; e.g. `"Post-tournament engagement drop"`, `"Influencer partnership impact"`, `"Post-holiday engagement drop"` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 1 distinct; e.g. `2026-05-24T04:58:57.811966+00:00` |  |

#### `forecast_results`

Designed for weekly metric forecasts with prediction intervals. Never populated.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per (metric, forecast week) (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | nothing - never written |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `run_id` -> `analytics_runs.id` |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | _table is empty_ |  |
| `run_id` | uuid | - | FK -> `analytics_runs.id` | _table is empty_ |  |
| `brand_id` | uuid | NOT NULL |  | _table is empty_ |  |
| `metric` | text | NOT NULL |  | _table is empty_ |  |
| `forecast_week` | date | NOT NULL |  | _table is empty_ |  |
| `yhat` | double precision | - |  | _table is empty_ |  |
| `yhat_lower` | double precision | - |  | _table is empty_ |  |
| `yhat_upper` | double precision | - |  | _table is empty_ |  |
| `model` | text <br>`= linear` | NOT NULL |  | _table is empty_ |  |
| `horizon_weeks` | integer | NOT NULL |  | _table is empty_ |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | _table is empty_ |  |

#### `its_results`

Designed for interrupted-time-series evaluation of `causal_events` (level and trend change around an event). Never populated.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per (event, metric) (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | nothing - never written |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `run_id` -> `analytics_runs.id`, `event_id` -> `causal_events.id` |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | _table is empty_ |  |
| `run_id` | uuid | - | FK -> `analytics_runs.id` | _table is empty_ |  |
| `brand_id` | uuid | NOT NULL |  | _table is empty_ |  |
| `event_id` | uuid | - | FK -> `causal_events.id` | _table is empty_ |  |
| `metric` | text | NOT NULL |  | _table is empty_ |  |
| `pre_slope` | double precision | - |  | _table is empty_ |  |
| `post_slope` | double precision | - |  | _table is empty_ |  |
| `level_change` | double precision | - |  | _table is empty_ |  |
| `trend_change` | double precision | - |  | _table is empty_ |  |
| `p_value` | double precision | - |  | _table is empty_ |  |
| `is_significant` | boolean <br>`= False` | NOT NULL |  | _table is empty_ |  |
| `r_squared` | double precision | - |  | _table is empty_ |  |
| `ai_narrative` | text | - |  | _table is empty_ |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | _table is empty_ |  |

#### `causal_events`

Hand-curated marketing/business events (campaign starts, partnership renewals, product launches) used as intervention points for causal analysis.

| | |
|---|---|
| **Rows** | 4 |
| **Grain** | one row per known event |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | manual curation - manual |
| **Read by** | _no frontend consumer_ |
| **Referenced by** | `its_results.event_id` |
| **Date coverage** | `event_date` 2024-10-01 -> 2025-06-01; `created_at` 2026-05-24 -> 2026-05-24 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 4 distinct; e.g. `9612b75e-4cf4-431f-a134-f1d2f2993de7`, `649b843d-5b6c-49ae-bd9f-1a6a42614b55`, `7ba9d45a-76cc-4d6b-940c-319a58d72116` |  |
| `event_date` | date | NOT NULL |  | 4 distinct; e.g. `2025-01-01`, `2025-03-01`, `2025-06-01` |  |
| `event_name` | text | NOT NULL |  | 4 distinct; e.g. `Q1 2025 Campaign Start`, `Ben Johns Partnership Renewed`, `Hyperion CFS Launch` |  |
| `event_type` | text | NOT NULL |  | 4 distinct; e.g. `campaign`, `partnership`, `product_launch` |  |
| `description` | text | no |  | 4 distinct; e.g. `New year marketing push`, `Multi-year contract extension announcement`, `Hyperion Carbon Fiber Surface paddle launch` |  |
| `platform` | text <br>`= all` | NOT NULL |  | 1 distinct; e.g. `all` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 1 distinct; e.g. `2026-05-24T04:35:31.297468+00:00` |  |

#### `ai_narratives`

Generated weekly narrative summaries per brand. One row only; the body still contains the raw fenced JSON the model returned, so it needs parsing before display.

| | |
|---|---|
| **Rows** | 1 |
| **Grain** | one row per (brand, week, narrative type) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | analytics narrative step - insert |
| **Read by** | _no frontend consumer_ |
| **Date coverage** | `week_start` 2026-05-18 -> 2026-05-18; `created_at` 2026-05-24 -> 2026-05-24 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 1 distinct; e.g. `61618994-b40f-4402-b105-53a2eab50a2d` |  |
| `brand_id` | uuid | NOT NULL |  | 1 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `week_start` | date | NOT NULL |  | 1 distinct; e.g. `2026-05-18` |  |
| `narrative_type` | text <br>`= weekly_summary` | NOT NULL |  | 1 distinct; e.g. `weekly_summary` |  |
| `title` | text | NOT NULL |  | 1 distinct; e.g. `Weekly Insights` |  |
| `body` | text | NOT NULL |  | 1 distinct; e.g. `'''json {   "title": "JOOLA Pickleball: Social...` |  |
| `key_points` | jsonb | no |  | 1 distinct; e.g. `[]` |  |
| `model_used` | text | no |  | 1 distinct; e.g. `gpt-4o` |  |
| `tokens_used` | integer | 100% |  | **always NULL** in the sampled rows |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 1 distinct; e.g. `2026-05-24T04:59:08.242179+00:00` |  |

### Brand comparison runs

On-demand JOOLA-vs-one-rival scorecard: live storefront re-collection, weighted metric families, composite score and warehouse/live discrepancy log.

#### `brand_comparison_runs`

Header for a head-to-head comparison run (always JOOLA vs one rival): status/stage/progress, both composite scores, the metric-family weights used, data-as-of, per-source collection stats, source row counts, duration and trigger.

| | |
|---|---|
| **Rows** | 8 |
| **Grain** | one row per comparison run |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | brand-comparison API route (UI-triggered) - insert + progress updates |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `brand_a_id` -> `brands.id`, `brand_b_id` -> `brands.id` |
| **Referenced by** | `brand_comparison_discrepancies.run_id`, `brand_comparison_metrics.run_id`, `brand_comparison_products.run_id` |
| **Date coverage** | `data_as_of` 2026-08-23 -> 2026-08-26; `created_at` 2026-08-24 -> 2026-08-26; `finished_at` 2026-08-24 -> 2026-08-26 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 8 distinct; e.g. `2555b696-8874-4d54-be15-22a2654cfc3b`, `1e43dc01-17cb-4087-b23b-6b275398e393`, `360b063e-f521-4ba4-a970-cb60f30b5ab7` |  |
| `brand_a_id` | uuid | NOT NULL | FK -> `brands.id` | 1 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `brand_b_id` | uuid | NOT NULL | FK -> `brands.id` | 1 distinct; e.g. `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec` |  |
| `brand_a_slug` | text | NOT NULL |  | 1 distinct; e.g. `joola` |  |
| `brand_b_slug` | text | NOT NULL |  | 1 distinct; e.g. `selkirk` |  |
| `status` | text <br>`= pending` | NOT NULL |  | 1 distinct; e.g. `done` |  |
| `stage` | text | no |  | 1 distinct; e.g. `complete` |  |
| `progress` | integer <br>`= 0` | NOT NULL |  | 1 distinct; range 100 .. 100; e.g. `100` |  |
| `score_a` | numeric | no |  | 6 distinct; range 35.95 .. 45.7; e.g. `41.04`, `35.95`, `45.7` |  |
| `score_b` | numeric | no |  | 6 distinct; range 54.3 .. 64.05; e.g. `58.96`, `64.05`, `54.3` |  |
| `weights` | jsonb | NOT NULL |  | 1 distinct; e.g. `{"catalogue": 0.25, "community": 0.25, "price_...` | Metric-family weights used for this run; changing them changes the score, so it is stored per run. |
| `method_version` | text <br>`= v1` | NOT NULL |  | 1 distinct; e.g. `v1` |  |
| `data_as_of` | timestamp with time zone | no |  | 2 distinct; e.g. `2026-08-23T18:42:12.125+00:00`, `2026-08-26T12:19:37.328+00:00` |  |
| `collection_stats` | jsonb | no |  | 6 distinct; e.g. `{"joola": {"errors": [], "ok": true, "products...`, `{"joola": {"errors": [], "ok": true, "products...`, `{"joola": {"errors": [], "ok": true, "products...` |  |
| `source_row_counts` | jsonb | no |  | 3 distinct; e.g. `{"joola": {"live_paddles": 98, "paddle_reviews...`, `{"joola": {"live_paddles": 97, "paddle_reviews...`, `{"joola": {"live_paddles": 1, "paddle_reviews"...` |  |
| `error_message` | text | 100% |  | **always NULL** in the sampled rows |  |
| `duration_ms` | integer | no |  | 8 distinct; range 72,153 .. 573,063; e.g. `72153`, `115846`, `183070` |  |
| `triggered_by` | text <br>`= ui` | no |  | 1 distinct; e.g. `ui` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 8 distinct; e.g. `2026-08-24T08:42:09.020889+00:00`, `2026-08-24T09:28:40.366663+00:00`, `2026-08-24T08:55:21.054839+00:00` |  |
| `finished_at` | timestamp with time zone | no |  | 8 distinct; e.g. `2026-08-24T08:43:20.308+00:00`, `2026-08-24T09:30:35.27+00:00`, `2026-08-24T08:58:23.247+00:00` |  |

#### `brand_comparison_metrics`

Per-brand metric rows for a comparison run: metric family and key, raw value, unit, direction, the 0-100 normalised value, its weight, whether it counts toward the composite, sample size and which source tables produced it.

| | |
|---|---|
| **Rows** | 400 |
| **Grain** | one row per (run, brand, metric) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | brand-comparison API route - insert per run |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `run_id` -> `brand_comparison_runs.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `created_at` 2026-08-24 -> 2026-08-26 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 400 distinct; e.g. `83a03986-2641-443d-bff9-94a0470adfd2`, `b44f757d-1186-4730-8d89-28d57555cf5c`, `24b29d02-c6d9-4275-9bb3-50e720b49a2b` |  |
| `run_id` | uuid | NOT NULL | FK -> `brand_comparison_runs.id` | 8 distinct; e.g. `2555b696-8874-4d54-be15-22a2654cfc3b`, `360b063e-f521-4ba4-a970-cb60f30b5ab7`, `d82b2931-53f4-48fe-b85d-102d2379e3ed` |  |
| `brand_id` | uuid | NOT NULL | FK -> `brands.id` | 2 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec` |  |
| `family` | text | NOT NULL |  | 4 distinct; e.g. `reviews`, `catalogue`, `community` |  |
| `metric_key` | text | NOT NULL |  | 25 distinct; e.g. `reviews_total_live`, `reviews_avg_rating_live`, `reviews_coverage_pct` |  |
| `metric_label` | text | NOT NULL |  | 25 distinct; e.g. `Published paddle reviews (live)`, `Mean star rating (live)`, `Paddles carrying reviews` |  |
| `value` | numeric | 8% |  | 77 distinct; range 0 .. 14,344; e.g. `0`, `310`, `12` |  |
| `value_text` | text | 100% |  | **always NULL** in the sampled rows |  |
| `unit` | text | 44% |  | 3 distinct; e.g. `%`, `$`, `★` |  |
| `higher_is_better` | boolean <br>`= True` | NOT NULL |  | 2 distinct; e.g. `True`, `False` |  |
| `normalized` | numeric | 8% |  | 99 distinct; range 0 .. 100; e.g. `50.0`, `34.32`, `65.68` | 0-100 rescaled value; the composite is the weighted sum of these, not of `value`. |
| `weight` | numeric | 12% |  | 3 distinct; range 0.15 .. 0.35; e.g. `0.25`, `0.35`, `0.15` |  |
| `in_composite` | boolean <br>`= True` | NOT NULL |  | 2 distinct; e.g. `True`, `False` |  |
| `sample_n` | integer | no |  | 23 distinct; range 0 .. 14,344; e.g. `39`, `1987`, `98` |  |
| `source_tables` | text[] | no |  | 6 distinct; e.g. `["paddle_reviews"]`, `["live:shopify"]`, `["live:bazaarvoice", "live:okendo"]` | Which tables (or live sources, e.g. `live:shopify`) produced the value - the provenance the discrepancy log compares against. |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 8 distinct; e.g. `2026-08-24T08:43:20.511943+00:00`, `2026-08-24T08:58:23.402959+00:00`, `2026-08-24T09:03:59.384227+00:00` |  |

#### `brand_comparison_products`

The supporting product lists behind specific comparison metrics (cheapest paddles, most-reviewed paddles), ranked, with product name/URL and the value shown.

| | |
|---|---|
| **Rows** | 405 |
| **Grain** | one row per (run, brand, metric, ranked product) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | brand-comparison API route - insert per run |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `run_id` -> `brand_comparison_runs.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `created_at` 2026-08-24 -> 2026-08-26 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 405 distinct; e.g. `2489c4e1-94f3-4d61-8468-9d4d7890163a`, `ccd15b2b-a8a6-4252-8bce-97e795bce17a`, `cd4447ce-aa76-4d6c-98f4-22d5d99d2e3b` |  |
| `run_id` | uuid | NOT NULL | FK -> `brand_comparison_runs.id` | 8 distinct; e.g. `89b045e6-1940-4f5c-ad09-1652d5a19951`, `d82b2931-53f4-48fe-b85d-102d2379e3ed`, `360b063e-f521-4ba4-a970-cb60f30b5ab7` |  |
| `brand_id` | uuid | NOT NULL | FK -> `brands.id` | 2 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec` |  |
| `metric_key` | text | NOT NULL |  | 3 distinct; e.g. `catalogue_price_floor`, `reviews_total_live`, `reviews_coverage_pct` |  |
| `product_id` | uuid | 100% |  | **always NULL** in the sampled rows |  |
| `product_name` | text | no |  | 71 distinct; e.g. `SLK Helix Pro - Pickleball Paddle`, `SLK Atlas`, `SLK EVO Power` |  |
| `product_url` | text | no |  | 71 distinct; e.g. `https://www.selkirk.com/products/slk-helix-pro`, `https://www.selkirk.com/products/slk-atlas`, `https://www.selkirk.com/products/slk-evo-power` |  |
| `value` | numeric | no |  | 48 distinct; range 0 .. 2639; e.g. `0`, `80`, `295` |  |
| `secondary_value` | numeric | 3% |  | 51 distinct; range 0 .. 333; e.g. `4.7`, `4.15`, `279.95` |  |
| `rank` | integer | no |  | 10 distinct; range 1 .. 10; e.g. `1`, `2`, `3` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 8 distinct; e.g. `2026-08-26T12:22:00.467971+00:00`, `2026-08-24T09:03:59.744804+00:00`, `2026-08-24T08:58:23.801117+00:00` |  |

#### `brand_comparison_discrepancies`

Reconciliation log flagging where the warehouse number disagrees with the live storefront number (e.g. review counts), with severity, both values, the delta and a human-readable explanation.

| | |
|---|---|
| **Rows** | 10 |
| **Grain** | one row per detected discrepancy |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | brand-comparison API route - insert per run |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `run_id` -> `brand_comparison_runs.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `created_at` 2026-08-24 -> 2026-08-26 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 10 distinct; e.g. `c5480b0c-05cb-46df-87bb-4e9fe933cd8e`, `123ea748-54b6-4a30-b250-9291f7b54062`, `5d6b7204-74bd-4382-a98c-b32415ac7804` |  |
| `run_id` | uuid | NOT NULL | FK -> `brand_comparison_runs.id` | 8 distinct; e.g. `360b063e-f521-4ba4-a970-cb60f30b5ab7`, `89b045e6-1940-4f5c-ad09-1652d5a19951`, `2555b696-8874-4d54-be15-22a2654cfc3b` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 2 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935`, `0cc35e7c-593b-4d7e-8bb2-6cdcad8ca4ec` |  |
| `severity` | text <br>`= info` | NOT NULL |  | 2 distinct; e.g. `critical`, `info` |  |
| `kind` | text | NOT NULL |  | 1 distinct; e.g. `review_count_mismatch` |  |
| `entity` | text | no |  | 2 distinct; e.g. `JOOLA — all paddles`, `Selkirk Sport — all paddles` |  |
| `warehouse_value` | text | no |  | 4 distinct; e.g. `1987`, `8770`, `11794` |  |
| `live_value` | text | no |  | 5 distinct; e.g. `5694`, `5699`, `716` |  |
| `delta` | numeric | no |  | 5 distinct; range -10,343 .. 3712; e.g. `3707`, `3712`, `-8054` |  |
| `detail` | text | no |  | 5 distinct; e.g. `The storefront shows 3,707 more paddle reviews...`, `The storefront shows 3,712 more paddle reviews...`, `The warehouse holds 8,054 more reviews than th...` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 8 distinct; e.g. `2026-08-24T08:58:24.14074+00:00`, `2026-08-26T12:22:00.823752+00:00`, `2026-08-24T08:43:21.177032+00:00` |  |

### SEO & site audit

DataForSEO/Semrush sweeps: crawled pages, rule-based issues, keyword universe, SERP and competitor-domain overlap.

#### `runs`

Header for an SEO/site-audit run: target site, market/language, crawl mode, page counts, status, provider, seed keywords, AI recommendations and a link to the parent sweep.

| | |
|---|---|
| **Rows** | 8 |
| **Grain** | one row per SEO run |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | `seo` module / SEO worker - insert per run |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `previous_run_id` -> `runs.id`, `brand_id` -> `brands.id`, `sweep_id` -> `seo_sweeps.id` |
| **Referenced by** | `backlinks_summary.run_id`, `competitor_domains.run_id`, `content_calendar.run_id`, `domain_ranked_keywords.run_id`, `entities.run_id`, `gap_analyses.previous_run_id`, `gap_analyses.run_id`, `issues.run_id`, `jobs.run_id`, `keywords.run_id`, `pages.run_id`, `runs.previous_run_id`, `serp_results.run_id` |
| **Date coverage** | `started_at` 2026-05-09 -> 2026-08-26; `finished_at` 2026-05-09 -> 2026-08-26; `created_at` 2026-05-09 -> 2026-08-26; `updated_at` 2026-08-26 -> 2026-08-26 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 8 distinct; e.g. `0a59d89d-3a57-4b15-9772-da063a1d8faf`, `7665dce0-a0e3-4c36-bdcf-4519a5b20f95`, `1872c735-8140-44f5-9832-b8454b56f6e6` |  |
| `website_url` | text | NOT NULL |  | 2 distinct; e.g. `https://joola.com`, `https://joola.com/` |  |
| `canonical_domain` | text | 25% |  | 1 distinct; e.g. `joola.com` |  |
| `market` | text <br>`= US` | NOT NULL |  | 1 distinct; e.g. `US` |  |
| `language` | text <br>`= en` | NOT NULL |  | 1 distinct; e.g. `en` |  |
| `crawl_mode` | text <br>`= full_site` | NOT NULL |  | 2 distinct; e.g. `full_site`, `single_url` |  |
| `max_pages` | integer <br>`= 300` | NOT NULL |  | 2 distinct; range 1 .. 300; e.g. `300`, `1` |  |
| `apify_enabled` | boolean <br>`= False` | NOT NULL |  | 1 distinct; e.g. `False` |  |
| `status` | text <br>`= pending` | NOT NULL |  | 1 distinct; e.g. `done` |  |
| `current_agent` | text | 100% |  | **always NULL** in the sampled rows |  |
| `pages_crawled` | integer <br>`= 0` | NOT NULL |  | 2 distinct; range 0 .. 1; e.g. `0`, `1` |  |
| `pages_failed` | integer <br>`= 0` | NOT NULL |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `error_message` | text | 100% |  | **always NULL** in the sampled rows |  |
| `started_at` | timestamp with time zone | no |  | 8 distinct; e.g. `2026-05-09T09:57:48.50253+00:00`, `2026-05-09T09:58:51.502491+00:00`, `2026-08-11T20:23:56.661289+00:00` |  |
| `finished_at` | timestamp with time zone | no |  | 8 distinct; e.g. `2026-05-09T09:59:19.879251+00:00`, `2026-05-09T10:00:01.706593+00:00`, `2026-08-11T20:23:56.661289+00:00` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 8 distinct; e.g. `2026-05-09T09:57:48.817312+00:00`, `2026-05-09T09:58:51.615316+00:00`, `2026-08-11T20:23:56.661289+00:00` |  |
| `updated_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 3 distinct; e.g. `2026-08-26T10:52:34.64648+00:00`, `2026-08-26T11:53:21.352497+00:00`, `2026-08-26T12:13:34.498606+00:00` |  |
| `previous_run_id` | uuid | 100% | FK -> `runs.id` | **always NULL** in the sampled rows |  |
| `recommendations` | jsonb | 75% |  | 2 distinct; e.g. `{"executive_summary": "The JOOLA homepage is w...`, `{"executive_summary": "The JOOLA homepage effe...` |  |
| `seed_keywords` | text[] | 75% |  | 1 distinct; e.g. `["joola pickleball", "joola pickleball paddle"...` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 1 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `provider` | text | no |  | 2 distinct; e.g. `dataforseo`, `semrush` |  |
| `sweep_id` | uuid | 75% | FK -> `seo_sweeps.id` | 2 distinct; e.g. `b142d6ad-38fa-4ae1-994d-b9ae7aed83ba`, `569a6fc5-8823-461f-a1d6-ad75130130cb` |  |

#### `seo_sweeps`

Multi-brand SEO sweep header: which brand IDs were in scope, which failed, provider, market, provider units estimated vs spent, timing.

| | |
|---|---|
| **Rows** | 2 |
| **Grain** | one row per sweep |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | SEO sweep worker - insert per sweep |
| **Read by** | _no frontend consumer_ |
| **Referenced by** | `runs.sweep_id`, `seo_brand_metrics.sweep_id`, `seo_provider_calls.sweep_id` |
| **Date coverage** | `started_at` 2026-08-26 -> 2026-08-26; `finished_at` 2026-08-26 -> 2026-08-26; `created_at` 2026-08-26 -> 2026-08-26 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 2 distinct; e.g. `b142d6ad-38fa-4ae1-994d-b9ae7aed83ba`, `569a6fc5-8823-461f-a1d6-ad75130130cb` |  |
| `status` | text <br>`= pending` | NOT NULL |  | 1 distinct; e.g. `done` |  |
| `stage` | text | no |  | 1 distinct; e.g. `complete` |  |
| `progress` | integer <br>`= 0` | NOT NULL |  | 1 distinct; range 100 .. 100; e.g. `100` |  |
| `brand_ids` | uuid[] | NOT NULL |  | 1 distinct; e.g. `["04db8591-37a3-4634-9d11-536975fa6935"]` |  |
| `failed_brand_ids` | uuid[] | NOT NULL |  | 1 distinct; e.g. `[]` |  |
| `provider` | text <br>`= semrush` | NOT NULL |  | 1 distinct; e.g. `dataforseo` |  |
| `market` | text <br>`= us` | NOT NULL |  | 1 distinct; e.g. `us` |  |
| `units_estimated` | integer | no |  | 1 distinct; range 926 .. 926; e.g. `926` |  |
| `units_spent` | integer <br>`= 0` | NOT NULL |  | 1 distinct; range 926 .. 926; e.g. `926` |  |
| `error_message` | text | 100% |  | **always NULL** in the sampled rows |  |
| `duration_ms` | integer | no |  | 2 distinct; range 5708 .. 9495; e.g. `9495`, `5708` |  |
| `started_at` | timestamp with time zone | no |  | 2 distinct; e.g. `2026-08-26T11:53:12.248+00:00`, `2026-08-26T12:13:29.148+00:00` |  |
| `finished_at` | timestamp with time zone | no |  | 2 distinct; e.g. `2026-08-26T11:53:22.18+00:00`, `2026-08-26T12:13:35.173+00:00` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 2 distinct; e.g. `2026-08-26T11:53:12.470535+00:00`, `2026-08-26T12:13:29.350561+00:00` |  |

#### `seo_brand_metrics`

Per-brand SEO metrics for a sweep, in the same family/metric_key/value shape as the brand-comparison metrics (organic keywords, organic traffic, traffic value ...).

| | |
|---|---|
| **Rows** | 24 |
| **Grain** | one row per (sweep, brand, metric) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | SEO sweep worker - insert per sweep |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `sweep_id` -> `seo_sweeps.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `created_at` 2026-08-26 -> 2026-08-26 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 24 distinct; e.g. `a9087d69-ba56-47bb-b573-05066e683565`, `bf13041c-0454-475b-8ca7-88f0abac6ef9`, `3808bdc3-229e-45d8-afc4-309b07104649` |  |
| `sweep_id` | uuid | NOT NULL | FK -> `seo_sweeps.id` | 2 distinct; e.g. `b142d6ad-38fa-4ae1-994d-b9ae7aed83ba`, `569a6fc5-8823-461f-a1d6-ad75130130cb` |  |
| `brand_id` | uuid | NOT NULL | FK -> `brands.id` | 1 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `family` | text | NOT NULL |  | 4 distinct; e.g. `ranking`, `visibility`, `authority` |  |
| `metric_key` | text | NOT NULL |  | 12 distinct; e.g. `seo_organic_keywords`, `seo_organic_traffic`, `seo_traffic_value` |  |
| `value` | numeric | 8% |  | 11 distinct; range 0 .. 1.483e+05; e.g. `4312`, `116948.66117690504`, `148274.8009555185` |  |
| `unit` | text | 83% |  | 2 distinct; e.g. `USD`, `%` |  |
| `sample_n` | integer | no |  | 1 distinct; range 250 .. 250; e.g. `250` |  |
| `provider` | text <br>`= semrush` | NOT NULL |  | 1 distinct; e.g. `semrush` |  |
| `path_scoped` | boolean <br>`= False` | NOT NULL |  | 1 distinct; e.g. `False` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 2 distinct; e.g. `2026-08-26T11:53:19.016803+00:00`, `2026-08-26T12:13:33.11011+00:00` |  |

#### `seo_provider_calls`

Provider API call log for a sweep: endpoint, HTTP/error status, units consumed, rows returned and duration - the cost audit trail for DataForSEO/Semrush.

| | |
|---|---|
| **Rows** | 2 |
| **Grain** | one row per provider call |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | SEO sweep worker - insert per provider call |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `sweep_id` -> `seo_sweeps.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `created_at` 2026-08-26 -> 2026-08-26 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 2 distinct; e.g. `2449ae4c-de64-4974-ad11-d6938e820685`, `cc53b738-ebc4-4e32-907c-4a3bd7b91055` |  |
| `sweep_id` | uuid | no | FK -> `seo_sweeps.id` | 2 distinct; e.g. `b142d6ad-38fa-4ae1-994d-b9ae7aed83ba`, `569a6fc5-8823-461f-a1d6-ad75130130cb` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 1 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `provider` | text | NOT NULL |  | 1 distinct; e.g. `dataforseo` |  |
| `endpoint` | text | NOT NULL |  | 1 distinct; e.g. `collect` |  |
| `http_status` | integer | 100% |  | **always NULL** in the sampled rows |  |
| `error_code` | integer | 100% |  | **always NULL** in the sampled rows |  |
| `error_message` | text | 100% |  | **always NULL** in the sampled rows |  |
| `units` | integer | 100% |  | **always NULL** in the sampled rows |  |
| `rows_returned` | integer | no |  | 1 distinct; range 250 .. 250; e.g. `250` |  |
| `duration_ms` | integer | 100% |  | **always NULL** in the sampled rows |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 2 distinct; e.g. `2026-08-26T11:53:21.690396+00:00`, `2026-08-26T12:13:34.78265+00:00` |  |

#### `pages`

Crawled page record with the full on-page SEO picture: status and redirect chain, title, meta description, H1/H2/H3 arrays, canonical, robots, indexability, word count, full text, internal/external link arrays, image URLs, missing-alt count, schema.org types and raw blob, Open Graph, hreflang, page type and a content hash. Only the JOOLA homepage has been crawled.

| | |
|---|---|
| **Rows** | 2 |
| **Grain** | one row per crawled URL per run |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | SEO crawler - insert per crawled URL |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `run_id` -> `runs.id`, `brand_id` -> `brands.id` |
| **Referenced by** | `issues.page_id`, `keywords.suggested_page_id` |
| **Date coverage** | `fetched_at` 2026-05-09 -> 2026-05-09; `created_at` 2026-05-09 -> 2026-05-09 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 2 distinct; e.g. `5b16f268-47c8-43e1-8495-a40f84fa6c63`, `ec5cc33c-65c0-45b9-8e10-7b38c9e0921f` |  |
| `run_id` | uuid | NOT NULL | FK -> `runs.id` | 2 distinct; e.g. `0a59d89d-3a57-4b15-9772-da063a1d8faf`, `7665dce0-a0e3-4c36-bdcf-4519a5b20f95` |  |
| `url` | text | NOT NULL |  | 1 distinct; e.g. `https://joola.com/` |  |
| `final_url` | text | no |  | 1 distinct; e.g. `https://joola.com/` |  |
| `http_status` | integer | no |  | 1 distinct; range 200 .. 200; e.g. `200` |  |
| `redirect_chain` | jsonb | no |  | 1 distinct; e.g. `[]` |  |
| `fetched_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 2 distinct; e.g. `2026-05-09T09:57:51.022975+00:00`, `2026-05-09T09:59:01.999157+00:00` |  |
| `fetcher` | text | NOT NULL |  | 1 distinct; e.g. `httpx` |  |
| `title` | text | no |  | 1 distinct; e.g. `JOOLA \| Shop Pickleball & Table Tennis Product...` |  |
| `meta_description` | text | no |  | 1 distinct; e.g. `JOOLA is an innovative leading brand, represen...` |  |
| `h1` | text[] | no |  | 1 distinct; e.g. `["JOOLA", "Table Tennis"]` |  |
| `h2` | text[] | no |  | 1 distinct; e.g. `["Made for This", "R4LLy: A JOOLA Story", "PRO...` |  |
| `h3` | text[] | no |  | 1 distinct; e.g. `["Footwear", "Bags", "Apparel", "Headwear"]` |  |
| `canonical` | text | no |  | 1 distinct; e.g. `https://joola.com/` |  |
| `robots_meta` | text | no |  | 1 distinct; e.g. `index` |  |
| `is_indexable` | boolean | no |  | 1 distinct; e.g. `True` |  |
| `word_count` | integer | no |  | 1 distinct; range 1597 .. 1597; e.g. `1597` |  |
| `text_content` | text | no |  | 1 distinct; e.g. `Now Available: Pickleball Footwear Just Announ...` | Full extracted page text - the largest single text column in the schema. |
| `internal_links` | text[] | no |  | 1 distinct; e.g. `["https://joola.com/", "https://joola.com/acco...` |  |
| `external_links` | text[] | no |  | 1 distinct; e.g. `["https://joola-usa.myshopify.com/blogs/update...` |  |
| `image_urls` | text[] | no |  | 1 distinct; e.g. `["https://joola.com/cdn/shop/files/Joola_Logo....` |  |
| `images_missing_alt` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `schema_types` | text[] | no |  | 1 distinct; e.g. `[]` |  |
| `schema_raw` | jsonb | no |  | 1 distinct; e.g. `[]` |  |
| `open_graph` | jsonb | no |  | 1 distinct; e.g. `{"og:description": "JOOLA is an innovative lea...` |  |
| `hreflang` | jsonb | no |  | 1 distinct; e.g. `[]` |  |
| `page_type` | text | no |  | 1 distinct; e.g. `home` |  |
| `page_type_source` | text <br>`= rule` | no |  | 1 distinct; e.g. `rule` |  |
| `content_hash` | text | no |  | 1 distinct; e.g. `3b1a9f3bef78ceb62b8bcb14cc1cad1a3a1cf2af491fe8...` |  |
| `template_hint` | text | no |  | 1 distinct; e.g. `/` |  |
| `html_storage_path` | text | 100% |  | **always NULL** in the sampled rows |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 2 distinct; e.g. `2026-05-09T09:57:51.022975+00:00`, `2026-05-09T09:59:01.999157+00:00` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 1 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `provider` | text | no |  | 1 distinct; e.g. `dataforseo` |  |

#### `issues`

Rule-based SEO issues found on a crawled page: issue code, severity, details JSON and a remediation recommendation.

| | |
|---|---|
| **Rows** | 4 |
| **Grain** | one row per (page, issue) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | SEO rule engine - insert |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `run_id` -> `runs.id`, `page_id` -> `pages.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `created_at` 2026-05-09 -> 2026-05-09 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 4 distinct; e.g. `07ad0cba-cdf7-4b2d-a766-d788df457a1d`, `0eae4e74-c31a-4d1e-aefe-af9ec1f72c8d`, `7a6ae137-f7fb-43b0-bf46-bfe92cac8b04` |  |
| `run_id` | uuid | NOT NULL | FK -> `runs.id` | 2 distinct; e.g. `0a59d89d-3a57-4b15-9772-da063a1d8faf`, `7665dce0-a0e3-4c36-bdcf-4519a5b20f95` |  |
| `page_id` | uuid | no | FK -> `pages.id` | 2 distinct; e.g. `5b16f268-47c8-43e1-8495-a40f84fa6c63`, `ec5cc33c-65c0-45b9-8e10-7b38c9e0921f` |  |
| `issue_code` | text | NOT NULL |  | 2 distinct; e.g. `META_DESC_TOO_LONG`, `MULTIPLE_H1` |  |
| `severity` | text | NOT NULL |  | 2 distinct; e.g. `low`, `medium` |  |
| `source` | text <br>`= rule` | NOT NULL |  | 1 distinct; e.g. `rule` |  |
| `details` | jsonb | no |  | 2 distinct; e.g. `{"length": 317, "max": 160}`, `{"count": 2}` |  |
| `recommendation` | text | no |  | 2 distinct; e.g. `Trim meta description to under 160 chars.`, `Use only one <h1> per page; demote the rest to...` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 2 distinct; e.g. `2026-05-09T09:57:51.789483+00:00`, `2026-05-09T09:59:02.515597+00:00` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 1 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `provider` | text | no |  | 1 distinct; e.g. `dataforseo` |  |

#### `keywords`

Keyword universe from the provider's keyword-ideas endpoint: volume, CPC, competition, difficulty, intent, head-vs-long-tail class and the raw provider payload.

| | |
|---|---|
| **Rows** | 144 |
| **Grain** | one row per (run, keyword) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | SEO keyword worker (DataForSEO) - insert |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `run_id` -> `runs.id`, `seed_entity_id` -> `entities.id`, `suggested_page_id` -> `pages.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `created_at` 2026-05-09 -> 2026-05-09 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 144 distinct; e.g. `2279f93b-87ac-4e71-af36-faa239c4f2fb`, `4f2a463d-932a-48cf-aad6-f456b2883768`, `c93689e6-7dc0-440f-896d-121e033bd154` |  |
| `run_id` | uuid | NOT NULL | FK -> `runs.id` | 2 distinct; e.g. `0a59d89d-3a57-4b15-9772-da063a1d8faf`, `7665dce0-a0e3-4c36-bdcf-4519a5b20f95` |  |
| `keyword` | text | NOT NULL |  | 72 distinct; e.g. `pickleball`, `joola pickleball paddles`, `pickleball court` |  |
| `keyword_normalized` | text | NOT NULL |  | 72 distinct; e.g. `pickleball`, `joola pickleball paddles`, `pickleball court` |  |
| `market` | text | NOT NULL |  | 1 distinct; e.g. `US` |  |
| `language` | text | NOT NULL |  | 1 distinct; e.g. `en` |  |
| `search_volume` | integer | no |  | 28 distinct; range 70 .. 673,000; e.g. `2900`, `2400`, `1900` |  |
| `cpc` | numeric | 3% |  | 58 distinct; range 0.12 .. 4.42; e.g. `0.99`, `1.72`, `1.27` |  |
| `competition` | numeric | no |  | 27 distinct; range 0 .. 1; e.g. `1.0`, `0.03`, `0.0` |  |
| `keyword_difficulty` | integer | no |  | 17 distinct; range 0 .. 89; e.g. `0`, `10`, `79` |  |
| `intent` | text | no |  | 2 distinct; e.g. `commercial`, `transactional` |  |
| `keyword_type` | text | no |  | 2 distinct; e.g. `head`, `long_tail` |  |
| `seed_entity_id` | uuid | 100% | FK -> `entities.id` | **always NULL** in the sampled rows |  |
| `source` | text | NOT NULL |  | 1 distinct; e.g. `dfs_keyword_ideas` |  |
| `raw_payload` | jsonb | no |  | 72 distinct; e.g. `{"avg_backlinks_info": {"backlinks": 6178.8, "...`, `{"avg_backlinks_info": {"backlinks": 0.8, "dof...`, `{"avg_backlinks_info": {"backlinks": 850.3, "d...` |  |
| `suggested_page_id` | uuid | 100% | FK -> `pages.id` | **always NULL** in the sampled rows |  |
| `suggested_action` | text | 100% |  | **always NULL** in the sampled rows |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 2 distinct; e.g. `2026-05-09T09:58:26.395821+00:00`, `2026-05-09T09:59:24.977011+00:00` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 1 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `provider` | text | no |  | 1 distinct; e.g. `dataforseo` |  |

#### `domain_ranked_keywords`

Keywords a domain actually ranks for, with position, ranking URL, search volume, CPC and estimated traffic. Note 2,000 rows but only ~800 distinct ids in the sample - the same keyword set is re-inserted per run rather than upserted.

| | |
|---|---|
| **Rows** | 2,000 |
| **Grain** | one row per (run, keyword, ranking URL) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | SEO worker (Semrush / DataForSEO) - insert per run (not upserted) |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `run_id` -> `runs.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `created_at` 2026-05-09 -> 2026-08-26 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 800 distinct+; e.g. `c934df77-9d32-433a-818b-b99ddebfceac`, `6246aa29-da62-4aff-b581-b76e95a9631e`, `19da9043-e446-429d-8aca-9e4e08cdd1f8` | 2,000 rows but ~800 distinct ids in the sample: rows are re-inserted per run rather than upserted. |
| `run_id` | uuid | NOT NULL | FK -> `runs.id` | 8 distinct; e.g. `dfc9242b-ea44-4828-b0bb-aa82f2b50d38`, `4ec70dc2-bd7b-4d28-93db-2db80add2014`, `0a59d89d-3a57-4b15-9772-da063a1d8faf` |  |
| `keyword` | text | NOT NULL |  | 353 distinct; e.g. `joola pickleball`, `joola`, `joola pickleball paddle` |  |
| `keyword_normalized` | text | NOT NULL |  | 353 distinct; e.g. `joola pickleball`, `joola`, `joola pickleball paddle` |  |
| `position` | integer | no |  | 67 distinct; range 1 .. 100; e.g. `1`, `2`, `3` |  |
| `url` | text | no |  | 94 distinct; e.g. `https://joola.com/collections/table-tennis-tab...`, `https://joola.com/collections/perseus`, `https://joola.com/collections/table-tennis-rac...` |  |
| `search_volume` | integer | no |  | 33 distinct; range 140 .. 301,000; e.g. `9900`, `5400`, `8100` |  |
| `cpc` | numeric | 63% |  | 80 distinct; range 0.02 .. 7.71; e.g. `0.74`, `0.8`, `0.84` |  |
| `traffic` | numeric | no |  | 137 distinct; range 1.51 .. 1.231e+04; e.g. `51.68`, `63.84`, `118.56` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 10 distinct; e.g. `2026-08-26T11:53:20.765444+00:00`, `2026-08-26T12:13:33.863799+00:00`, `2026-05-09T09:59:14.354663+00:00` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 1 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `provider` | text | no |  | 2 distinct; e.g. `semrush`, `dataforseo` |  |

#### `competitor_domains`

Domains that compete for the same SERPs as the tracked brand: average/sum position, intersection count and the full provider metric blob.

| | |
|---|---|
| **Rows** | 70 |
| **Grain** | one row per (run, competing domain) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | SEO worker - insert per run |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `run_id` -> `runs.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `created_at` 2026-05-09 -> 2026-08-26 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 70 distinct; e.g. `40ccb66b-f8c7-48c2-bada-9ea3ac17283e`, `dc3970b7-659d-418f-9fc8-fa4f2809532c`, `7b2b3d6a-7f59-4383-9c5d-3cde332b96e1` |  |
| `run_id` | uuid | NOT NULL | FK -> `runs.id` | 4 distinct; e.g. `dfc9242b-ea44-4828-b0bb-aa82f2b50d38`, `4ec70dc2-bd7b-4d28-93db-2db80add2014`, `0a59d89d-3a57-4b15-9772-da063a1d8faf` |  |
| `domain` | text | NOT NULL |  | 21 distinct; e.g. `joola.com`, `youtube.com`, `amazon.com` |  |
| `avg_position` | numeric | 57% |  | 15 distinct; range 11.21 .. 38.12; e.g. `26.57`, `18.07`, `11.21` |  |
| `sum_position` | bigint | 57% |  | 15 distinct; range 30,016 .. 158,294; e.g. `158294`, `101185`, `49891` |  |
| `intersections` | integer | no |  | 35 distinct; range 935 .. 5957; e.g. `4313`, `3957`, `3142` |  |
| `full_domain_metrics` | jsonb | 57% |  | 15 distinct; e.g. `{"avg_position": 26.57277152929327, "competito...`, `{"avg_position": 18.065524013569007, "competit...`, `{"avg_position": 11.208941810829026, "competit...` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 4 distinct; e.g. `2026-08-26T11:53:21.063108+00:00`, `2026-08-26T12:13:34.190483+00:00`, `2026-05-09T09:59:18.505229+00:00` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 1 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `provider` | text | no |  | 2 distinct; e.g. `semrush`, `dataforseo` |  |

#### `serp_results`

Captured SERP for a tracked keyword: our rank and URL, the full organic result array, people-also-ask and related searches.

| | |
|---|---|
| **Rows** | 10 |
| **Grain** | one row per (run, keyword) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | DataForSEO worker (external) - insert |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `run_id` -> `runs.id`, `brand_id` -> `brands.id` |
| **Date coverage** | `created_at` 2026-05-09 -> 2026-05-09 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 10 distinct; e.g. `5144064a-aa14-47fb-8da8-8fff564e3ef0`, `d31c562b-d54c-4800-bc9f-cea510294c27`, `60f2a548-8b04-4e25-a178-17a6830910b9` |  |
| `run_id` | uuid | NOT NULL | FK -> `runs.id` | 2 distinct; e.g. `0a59d89d-3a57-4b15-9772-da063a1d8faf`, `7665dce0-a0e3-4c36-bdcf-4519a5b20f95` |  |
| `keyword` | text | NOT NULL |  | 5 distinct; e.g. `joola pickleball paddles`, `pickleball rules`, `pickleball` |  |
| `search_volume` | integer | no |  | 5 distinct; range 33,100 .. 673,000; e.g. `40500`, `74000`, `673000` |  |
| `our_rank` | integer | 80% |  | 1 distinct; range 1 .. 1; e.g. `1` |  |
| `our_url` | text | 80% |  | 2 distinct; e.g. `https://joola.com/collections/pickleball-paddl...`, `https://joola.com/collections/pickleball-paddl...` |  |
| `organic` | jsonb | no |  | 10 distinct; e.g. `[{"rank": 1, "title": "JOOLA Pickleball Paddle...`, `[{"rank": 2, "title": "Official USA Pickleball...`, `[{"rank": 2, "title": "Official USA Pickleball...` |  |
| `people_also_ask` | text[] | no |  | 1 distinct; e.g. `[]` |  |
| `related_searches` | text[] | no |  | 1 distinct; e.g. `[]` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 10 distinct; e.g. `2026-05-09T09:58:48.777793+00:00`, `2026-05-09T09:58:41.584985+00:00`, `2026-05-09T09:59:38.706645+00:00` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 1 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `provider` | text | no |  | 1 distinct; e.g. `dataforseo` |  |

#### `entities`

Entities (products, categories, personas) extracted by AI from crawled pages, with a canonical name, confidence and the source page IDs - the bridge between crawled content and keyword strategy.

| | |
|---|---|
| **Rows** | 24 |
| **Grain** | one row per extracted entity |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | SEO AI entity extraction - insert |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `run_id` -> `runs.id`, `brand_id` -> `brands.id` |
| **Referenced by** | `keywords.seed_entity_id` |
| **Date coverage** | `created_at` 2026-05-09 -> 2026-05-09 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 24 distinct; e.g. `4b8dcdcd-ee12-46f0-a873-9d4c5086a641`, `74230545-f158-4be9-a9c7-eaf9d6b84e7e`, `ba1305ca-1ff5-4603-94ef-ef8abeec9394` |  |
| `run_id` | uuid | NOT NULL | FK -> `runs.id` | 2 distinct; e.g. `0a59d89d-3a57-4b15-9772-da063a1d8faf`, `7665dce0-a0e3-4c36-bdcf-4519a5b20f95` |  |
| `entity_type` | text | NOT NULL |  | 5 distinct; e.g. `product`, `category`, `persona` |  |
| `name` | text | NOT NULL |  | 16 distinct; e.g. `JOOLA`, `Perseus Pro V Pickleball Paddle`, `Hyperion Pro V Pickleball Paddle` |  |
| `canonical_name` | text | NOT NULL |  | 16 distinct; e.g. `joola`, `perseus pro v pickleball paddle`, `hyperion pro v pickleball paddle` |  |
| `confidence` | numeric | NOT NULL |  | 5 distinct; range 0.8 .. 1; e.g. `0.9`, `0.8`, `0.85` |  |
| `attributes` | jsonb | no |  | 1 distinct; e.g. `{}` |  |
| `source_page_ids` | uuid[] | no |  | 2 distinct; e.g. `["5b16f268-47c8-43e1-8495-a40f84fa6c63"]`, `["ec5cc33c-65c0-45b9-8e10-7b38c9e0921f"]` |  |
| `source` | text <br>`= ai` | NOT NULL |  | 1 distinct; e.g. `ai` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 24 distinct; e.g. `2026-05-09T09:58:05.842941+00:00`, `2026-05-09T09:58:06.236572+00:00`, `2026-05-09T09:58:06.543062+00:00` |  |
| `brand_id` | uuid | no | FK -> `brands.id` | 1 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `provider` | text | no |  | 1 distinct; e.g. `dataforseo` |  |

#### `backlinks_summary`

Designed for backlink/domain-authority metrics per run. Never populated - no backlink provider is wired up.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per (run, domain) (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | nothing - never written |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `run_id` -> `runs.id`, `brand_id` -> `brands.id` |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | _table is empty_ |  |
| `run_id` | uuid | NOT NULL | FK -> `runs.id` | _table is empty_ |  |
| `domain` | text | NOT NULL |  | _table is empty_ |  |
| `total_backlinks` | integer | - |  | _table is empty_ |  |
| `total_referring_domains` | integer | - |  | _table is empty_ |  |
| `total_referring_ips` | integer | - |  | _table is empty_ |  |
| `domain_rank` | integer | - |  | _table is empty_ |  |
| `broken_backlinks` | integer | - |  | _table is empty_ |  |
| `referring_domains_nofollow` | integer | - |  | _table is empty_ |  |
| `raw_data` | jsonb | - |  | _table is empty_ |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | _table is empty_ |  |
| `brand_id` | uuid | - | FK -> `brands.id` | _table is empty_ |  |
| `provider` | text | - |  | _table is empty_ |  |

#### `gap_analyses`

Designed for run-over-run SEO diffing (new vs fixed issues, keyword gains/losses, rank moves). Never populated.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per (run, previous run) (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | nothing - never written |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `run_id` -> `runs.id`, `previous_run_id` -> `runs.id`, `brand_id` -> `brands.id` |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | _table is empty_ |  |
| `run_id` | uuid | NOT NULL | FK -> `runs.id` | _table is empty_ |  |
| `previous_run_id` | uuid | - | FK -> `runs.id` | _table is empty_ |  |
| `summary` | text | - |  | _table is empty_ |  |
| `new_issues` | jsonb | - |  | _table is empty_ |  |
| `fixed_issues` | jsonb | - |  | _table is empty_ |  |
| `new_ranked_keywords` | jsonb | - |  | _table is empty_ |  |
| `lost_ranked_keywords` | jsonb | - |  | _table is empty_ |  |
| `rank_improvements` | jsonb | - |  | _table is empty_ |  |
| `rank_declines` | jsonb | - |  | _table is empty_ |  |
| `keyword_volume_gained` | integer <br>`= 0` | - |  | _table is empty_ |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | _table is empty_ |  |
| `brand_id` | uuid | - | FK -> `brands.id` | _table is empty_ |  |
| `provider` | text | - |  | _table is empty_ |  |

#### `performance_cache`

Generic provider-response cache keyed by domain + provider + date range. Never populated.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per cached response (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | nothing - never written |
| **Read by** | _no frontend consumer_ |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | _table is empty_ |  |
| `domain` | text | NOT NULL |  | _table is empty_ |  |
| `provider` | text | NOT NULL |  | _table is empty_ |  |
| `date_range` | text | NOT NULL |  | _table is empty_ |  |
| `data` | jsonb | NOT NULL |  | _table is empty_ |  |
| `fetched_at` | timestamp with time zone <br>`= now()` | - |  | _table is empty_ |  |

#### `jobs`

Designed as a work queue for SEO run stages (type, status, progress, attempts, payload, result). Never populated - stages run inline instead.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per queued job (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | nothing - never written |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `run_id` -> `runs.id`, `brand_id` -> `brands.id` |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | _table is empty_ |  |
| `run_id` | uuid | NOT NULL | FK -> `runs.id` | _table is empty_ |  |
| `job_type` | text | NOT NULL |  | _table is empty_ |  |
| `status` | text <br>`= queued` | NOT NULL |  | _table is empty_ |  |
| `progress` | integer <br>`= 0` | NOT NULL |  | _table is empty_ |  |
| `message` | text | - |  | _table is empty_ |  |
| `attempts` | integer <br>`= 0` | NOT NULL |  | _table is empty_ |  |
| `payload` | jsonb | - |  | _table is empty_ |  |
| `result` | jsonb | - |  | _table is empty_ |  |
| `error` | text | - |  | _table is empty_ |  |
| `started_at` | timestamp with time zone | - |  | _table is empty_ |  |
| `finished_at` | timestamp with time zone | - |  | _table is empty_ |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | _table is empty_ |  |
| `updated_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | _table is empty_ |  |
| `brand_id` | uuid | - | FK -> `brands.id` | _table is empty_ |  |
| `provider` | text | - |  | _table is empty_ |  |

#### `integrations`

Designed to hold per-domain OAuth credentials for third-party providers (`access_token`, `refresh_token`, expiry). Empty - and it should stay that way unless the columns are encrypted; plaintext provider tokens in an anon-readable database would be a serious exposure.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per (domain, provider) (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | nothing - never written |
| **Read by** | _no frontend consumer_ |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | _table is empty_ |  |
| `domain` | text | NOT NULL |  | _table is empty_ |  |
| `provider` | text | NOT NULL |  | _table is empty_ |  |
| `access_token` | text | - |  | _table is empty_ | Plaintext OAuth token column. Empty today; encrypt or drop before anything writes here. |
| `refresh_token` | text | - |  | _table is empty_ |  |
| `token_expiry` | timestamp with time zone | - |  | _table is empty_ |  |
| `extra` | jsonb | - |  | _table is empty_ |  |
| `created_at` | timestamp with time zone <br>`= now()` | - |  | _table is empty_ |  |

### Content studio

GPT content generation for JOOLA marketing: brand-voice guardrails, templates, drafts, cost/latency telemetry and scraped house-style examples.

#### `content_drafts`

Generated marketing content: type, status, title, body, hashtags, metadata including the critic's verdict, the exact signal snapshot used as context, a link to the generation run, and parent/version for revisions. `created_by` holds the requesting user's email.

| | |
|---|---|
| **Rows** | 409 |
| **Grain** | one row per draft (versioned) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | content-studio API route (OpenAI) - insert (versioned) |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `source_article_id` -> `news_articles.id`, `parent_draft_id` -> `content_drafts.id` |
| **Referenced by** | `content_drafts.parent_draft_id` |
| **Date coverage** | `created_at` 2026-05-19 -> 2026-08-21; `updated_at` 2026-05-19 -> 2026-08-21 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= extensions.uuid_generate_v4(` | NOT NULL | **PK** | 409 distinct; e.g. `ed34a490-262b-4d8b-ba4e-a00b28784e5c`, `fbdfdcee-4077-41ef-84f1-ff2d22a05b79`, `4b0f8c4b-ba44-4d7a-98f0-91dd9aafeded` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 409 distinct; e.g. `2026-05-19T13:51:51.646629+00:00`, `2026-05-19T13:52:20.589933+00:00`, `2026-05-19T13:53:02.602267+00:00` |  |
| `updated_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 409 distinct; e.g. `2026-05-19T13:51:51.646629+00:00`, `2026-05-19T13:52:20.589933+00:00`, `2026-05-19T13:53:02.602267+00:00` |  |
| `created_by` | text | NOT NULL |  | 68 distinct; e.g. `anon@joola.com`, `arjunreddykadari89@gmail.com`, `kreddy@joola.com` | Email of the requesting user - personal data. |
| `content_type` | text | NOT NULL |  | 5 distinct; e.g. `ig_post`, `blog`, `twitter_response` |  |
| `status` | text <br>`= draft` | NOT NULL |  | 3 distinct; e.g. `draft`, `archived`, `approved` |  |
| `title` | text | 6% |  | 313 distinct; e.g. `🔥 The JOOLA Perseus Pro IV is back in stock!`, `How JOOLA's KineticFrame Technology Reduces Vi...`, `What to Look for in Your First JOOLA Picklebal...` |  |
| `body` | text | NOT NULL |  | 409 distinct; e.g. `HOOK: Ben Johns wins the PPA Championship! 🎉  ...`, `# Choosing the Right Pickle Ball Paddle for Re...`, `# Celebrating JOOLA Athletes at the MLP Season...` |  |
| `hashtags` | text[] | 51% |  | 200 distinct; e.g. `["#JOOLA", "#Hyperion2", "#Pickleball", "#Elev...`, `["#JOOLA", "#BenJohns", "#PPAChampionship", "#...`, `["#JOOLA", "#Pickleball", "#PaddleTech", "#Spo...` |  |
| `metadata` | jsonb | no |  | 409 distinct; e.g. `{"audience": "general_fans", "critic": {"passe...`, `{"audience": "recreational", "critic": {"passe...`, `{"audience": "general_fans", "critic": {"passe...` |  |
| `source_article_id` | uuid | 99% | FK -> `news_articles.id` | 1 distinct; e.g. `d728f73c-f330-49bb-b045-cf7403c24ce4` |  |
| `source_signal_snapshot` | jsonb | NOT NULL |  | 59 distinct; e.g. `{"brand_voice": {"banned_words": ["crush", "de...`, `{"brand_voice": {"banned_words": ["crush", "de...`, `{"brand_voice": {"banned_words": ["crush", "de...` | Frozen copy of the signals used for this draft, so a draft can be explained months later. |
| `generation_run_id` | uuid | no |  | 409 distinct; e.g. `91e5fa99-b038-4412-9ea0-a22c98a213a3`, `98120afc-2d36-419b-b302-8012f1f99226`, `4a2f662b-0c4b-4e5c-881d-7174385775fe` |  |
| `parent_draft_id` | uuid | 100% | FK -> `content_drafts.id` | 2 distinct; e.g. `d0ad06af-1aa4-44d4-b6eb-1103693cea1e`, `71931461-3ba4-4d70-aed0-02e3c31496eb` |  |
| `version` | integer <br>`= 1` | NOT NULL |  | 2 distinct; range 1 .. 2; e.g. `1`, `2` |  |

#### `content_generation_runs`

Telemetry for every generation attempt: model, prompt/completion tokens, USD cost, latency, status, error message, which input signals were switched on, and a prompt hash for cache detection. The cost ledger for the content studio.

| | |
|---|---|
| **Rows** | 661 |
| **Grain** | one row per generation attempt |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | content-studio API route - insert per attempt |
| **Read by** | _no frontend consumer_ |
| **Date coverage** | `created_at` 2026-05-19 -> 2026-08-21 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= extensions.uuid_generate_v4(` | NOT NULL | **PK** | 661 distinct; e.g. `91e5fa99-b038-4412-9ea0-a22c98a213a3`, `98120afc-2d36-419b-b302-8012f1f99226`, `4a2f662b-0c4b-4e5c-881d-7174385775fe` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 661 distinct; e.g. `2026-05-19T13:51:51.340529+00:00`, `2026-05-19T13:52:20.234275+00:00`, `2026-05-19T13:53:02.22266+00:00` |  |
| `created_by` | text | NOT NULL |  | 230 distinct; e.g. `anon@joola.com`, `arjunreddykadari89@gmail.com`, `kreddy@joola.com` |  |
| `content_type` | text | NOT NULL |  | 5 distinct; e.g. `blog`, `ig_post`, `email` |  |
| `model` | text | NOT NULL |  | 2 distinct; e.g. `gpt-4o-mini`, `gpt-4o` |  |
| `prompt_tokens` | integer | no |  | 556 distinct; range 0 .. 9766; e.g. `0`, `594`, `2501` |  |
| `completion_tokens` | integer | no |  | 417 distinct; range 0 .. 1787; e.g. `0`, `210`, `188` |  |
| `cost_usd` | numeric | no |  | 229 distinct; range 0 .. 0.04273; e.g. `0.0`, `0.00046`, `0.00047` | Per-call OpenAI cost; sum this for content-studio spend. |
| `latency_ms` | integer | no |  | 634 distinct; range 0 .. 265,847; e.g. `0`, `1`, `2` |  |
| `status` | text | no |  | 2 distinct; e.g. `success`, `error` |  |
| `error_message` | text | 95% |  | 6 distinct; e.g. `429: {'error': 'rate_limited', 'scope': 'user'...`, `Unknown content_type: email`, `429: {'error': 'rate_limited', 'scope': 'user'...` |  |
| `input_signals` | jsonb | no |  | 42 distinct; e.g. `{"loyal_fans": false, "news": false, "player_r...`, `{"loyal_fans": false, "news": true, "player_ro...`, `{"loyal_fans": true, "news": false, "player_ro...` |  |
| `prompt_hash` | text | 5% |  | 455 distinct; e.g. `f882cbb2985e72d2`, `b68bc6e23b871e21`, `e815b55b244f5e2b` |  |

#### `content_templates`

The prompt library: per content type a system prompt and a user-prompt template with placeholders (product launch teaser, athlete spotlight, crisis response, news reaction, tournament recap, SEO gap fill).

| | |
|---|---|
| **Rows** | 6 |
| **Grain** | one row per template |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | manual seed - manual |
| **Read by** | _no frontend consumer_ |
| **Date coverage** | `created_at` 2026-05-19 -> 2026-05-19 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= extensions.uuid_generate_v4(` | NOT NULL | **PK** | 6 distinct; e.g. `486aedb3-f60b-463e-99ff-36e6952d2e61`, `1aa4ea55-20a2-4808-990b-d43593db4be8`, `47d9620f-1cd8-4722-863a-6ec48952da4c` |  |
| `name` | text | NOT NULL |  | 6 distinct; e.g. `Product launch teaser`, `Athlete spotlight`, `Crisis response` |  |
| `content_type` | text | NOT NULL |  | 3 distinct; e.g. `ig_post`, `blog`, `twitter_response` |  |
| `system_prompt` | text | NOT NULL |  | 6 distinct; e.g. `You are the JOOLA Pulse content writer. Tease ...`, `You are the JOOLA Pulse content writer profili...`, `You are the JOOLA Pulse content writer respond...` |  |
| `user_prompt_template` | text | NOT NULL |  | 6 distinct; e.g. `Write a teaser Instagram caption for an upcomi...`, `Write an athlete spotlight Instagram caption.\...`, `Draft a crisis Twitter/X reply.\n\nINPUTS\n- O...` |  |
| `is_active` | boolean <br>`= True` | no |  | 1 distinct; e.g. `True` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 1 distinct; e.g. `2026-05-19T13:44:16.060819+00:00` |  |

#### `content_brand_voice`

Single-row brand-voice guardrail used in every prompt: allowed tones, banned words, signature phrases, default CTAs and forbidden patterns.

| | |
|---|---|
| **Rows** | 1 |
| **Grain** | singleton configuration row |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | manual seed - manual |
| **Read by** | _no frontend consumer_ |
| **Date coverage** | `updated_at` 2026-05-19 -> 2026-05-19 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= extensions.uuid_generate_v4(` | NOT NULL | **PK** | 1 distinct; e.g. `86adacd1-ba0c-4669-bff2-853bc8a35993` |  |
| `tone` | text[] | no |  | 1 distinct; e.g. `["informative", "hype", "celebratory", "defens...` |  |
| `banned_words` | text[] | no |  | 1 distinct; e.g. `["crush", "destroy", "kill", "annihilate", "sm...` |  |
| `signature_phrases` | text[] | no |  | 1 distinct; e.g. `["Athlete-first.", "Real players, real wins.",...` |  |
| `default_ctas` | text[] | no |  | 1 distinct; e.g. `["Shop the lineup", "Sign up for news", "Reply...` |  |
| `forbidden_patterns` | text[] | no |  | 1 distinct; e.g. `["Unsubstantiated superlatives (\"best\", \"fa...` |  |
| `updated_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 1 distinct; e.g. `2026-05-19T13:44:16.060819+00:00` |  |

#### `content_calendar`

Designed as a publishing schedule linking planned slots to generated content. Never populated.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per scheduled slot (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | nothing - never written |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `run_id` -> `runs.id`, `content_id` -> `generated_content.id` |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | _table is empty_ |  |
| `run_id` | uuid | NOT NULL | FK -> `runs.id` | _table is empty_ |  |
| `scheduled_date` | date | - |  | _table is empty_ |  |
| `channel` | text | NOT NULL |  | _table is empty_ |  |
| `title` | text | NOT NULL |  | _table is empty_ |  |
| `description` | text | - |  | _table is empty_ |  |
| `keyword` | text | - |  | _table is empty_ |  |
| `status` | text <br>`= planned` | - |  | _table is empty_ |  |
| `content_id` | uuid | - | FK -> `generated_content.id` | _table is empty_ |  |
| `created_at` | timestamp with time zone <br>`= now()` | - |  | _table is empty_ |  |

#### `generated_content`

Earlier generation table tied to `market_intel_items`: blog/IG output with meta description, SEO keywords, hashtags, image prompt and a suggested posting time. Superseded by `content_drafts`.

| | |
|---|---|
| **Rows** | 4 |
| **Grain** | one row per generated asset |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | `frontend/app/api/generate-content/route.ts` - insert |
| **Read by** | `/api/generate-content` route (write only) |
| **Foreign keys out** | `source_item_id` -> `market_intel_items.id` |
| **Referenced by** | `content_calendar.content_id` |
| **Date coverage** | `created_at` 2026-04-05 -> 2026-04-05 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 4 distinct; e.g. `b4b16033-75b2-41ff-9565-93a55a86bd59`, `2364ccb8-0785-4d74-bac9-2669fa4fdcbc`, `7b5291c5-4f62-4bde-935f-1725a60bc06d` |  |
| `source_item_id` | uuid | no | FK -> `market_intel_items.id` | 3 distinct; e.g. `b9eb895c-3c57-4471-ac81-f1922b71ff97`, `49e50109-e8bd-46f8-a4bd-109ca346766b`, `6f07cc89-fede-408f-a5fa-975e3d34ba07` |  |
| `content_type` | text | NOT NULL |  | 2 distinct; e.g. `blog_post`, `instagram_post` |  |
| `title` | text | 50% |  | 2 distinct; e.g. `Pickleball Industry Update: The Unstoppable Ri...`, `CẢM ƠN ZANE NAVRATIL – PHÚT GIÂY KHÔNG THỂ QUÊ...` |  |
| `body` | text | no |  | 4 distinct; e.g. `<h2>The Meteoric Rise of Pickleball in America...`, `Pickleball is booming! 🌟 Discover the latest g...`, `<h2>Zane Navratil: Gương Mặt Sáng Giá của Pick...` |  |
| `meta_description` | text | 50% |  | 2 distinct; e.g. `Discover why pickleball is America's fastest-g...`, `Cảm ơn Zane Navratil vì những khoảnh khắc tuyệ...` |  |
| `seo_keywords` | text[] | 50% |  | 2 distinct; e.g. `["pickleball", "pickleball growth", "JOOLA", "...`, `["Zane Navratil", "pickleball", "PPA Asia 1000...` |  |
| `hashtags` | text[] | 50% |  | 2 distinct; e.g. `["#PickleballBoom", "#JOOLA", "#PickleballComm...`, `["#ZaneNavratil", "#Pickleball", "#JOOLAPickle...` |  |
| `image_prompt` | text | 50% |  | 2 distinct; e.g. `A vibrant graphic showing a pickleball court f...`, `A vibrant photo of Zane Navratil interacting w...` |  |
| `best_posting_time` | text | 50% |  | 2 distinct; e.g. `Tuesday 7–9 PM EST`, `Wednesday 6–8 PM EST` |  |
| `predicted_engagement` | text | 100% |  | **always NULL** in the sampled rows |  |
| `status` | text <br>`= draft` | no |  | 1 distinct; e.g. `draft` |  |
| `published_url` | text | 100% |  | **always NULL** in the sampled rows |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 4 distinct; e.g. `2026-04-05T09:43:09.671877+00:00`, `2026-04-05T09:44:02.257039+00:00`, `2026-04-05T13:32:26.546356+00:00` |  |
| `published_at` | timestamp with time zone | 100% |  | **always NULL** in the sampled rows |  |

#### `writer_examples`

Scraped JOOLA blog posts by named in-house writers, tagged casual vs press_release - the few-shot house-style corpus for the content generator.

| | |
|---|---|
| **Rows** | 104 |
| **Grain** | one row per blog post |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | blog scraper (manual cadence) - insert |
| **Read by** | _no frontend consumer_ |
| **Date coverage** | `published_at` 2023-07-17 -> 2026-08-13; `scraped_at` 2026-06-11 -> 2026-08-13 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 104 distinct; e.g. `5980fc66-966c-4012-a75c-cdaca41411f4`, `1b585550-24d8-4f0c-81b9-e28fcbbc5377`, `d865144a-0ef6-403a-9fe2-9f3e7dc10d93` |  |
| `writer_id` | text | NOT NULL |  | 2 distinct; e.g. `corey`, `matt` |  |
| `writer_name` | text | NOT NULL |  | 2 distinct; e.g. `Corey Bockhaus`, `Matt Hetherington` |  |
| `title` | text | NOT NULL |  | 104 distinct; e.g. `Paddles Down, Flags Up — JOOLA's World Cup Pic...`, `The 2026 JOOLA Pops Summer Tour Is Rolling In,...`, `We Gave a Pickleball Addict 30 Days with the R...` |  |
| `url` | text | no |  | 104 distinct; e.g. `https://joola.com/blogs/updates/joolas-caught-...`, `https://joola.com/blogs/updates/the-2026-joola...`, `https://joola.com/blogs/updates/we-gave-a-pick...` |  |
| `content` | text | NOT NULL |  | 104 distinct; e.g. `The world's game has a special way of bringing...`, `North Bethesda, MD (05/20/26) — Get ready, som...`, `JOOLA’s mission to create the game’s first top...` |  |
| `content_mode` | text | no |  | 2 distinct; e.g. `casual`, `press_release` |  |
| `published_at` | timestamp with time zone | no |  | 104 distinct; e.g. `2026-06-11T13:00:07+00:00`, `2026-05-20T12:50:00+00:00`, `2026-05-18T15:00:00+00:00` |  |
| `scraped_at` | timestamp with time zone <br>`= now()` | no |  | 93 distinct; e.g. `2026-06-11T23:46:54.563071+00:00`, `2026-08-13T19:29:40.229634+00:00`, `2026-08-13T19:29:39.368665+00:00` |  |

#### `brand_replies`

Detected replies by a brand to a social comment, with response time and which source table the original came from. Only 4 rows from `ig_comments`; the detector is not in the weekly schedule.

| | |
|---|---|
| **Rows** | 4 |
| **Grain** | one row per detected brand reply |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | UNIQUE `(source_table, source_row_id)` |
| **Written by** | `instagram --source detect-brand-replies` -> `sources/instagram/detect_brand_replies.py` - upsert on `source_table,source_row_id` |
| **Read by** | `/v2/community-intel`, `/v2/data-health` |
| **Foreign keys out** | `replying_brand_id` -> `brands.id` |
| **Date coverage** | `replied_at` 2026-05-18 -> 2026-05-29; `created_at` 2026-05-23 -> 2026-06-05 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 4 distinct; e.g. `84d53225-5d1f-471d-9f0e-ae89a0a9b195`, `6cb7cbcd-b7c0-4a90-a5f3-3cf52b437c34`, `3982c8f9-a432-41ed-a354-82c716066f6d` |  |
| `replying_brand_id` | uuid | no | FK -> `brands.id` | 1 distinct; e.g. `04db8591-37a3-4634-9d11-536975fa6935` |  |
| `source_table` | text | NOT NULL |  | 1 distinct; e.g. `ig_comments` |  |
| `source_row_id` | uuid | NOT NULL |  | 4 distinct; e.g. `a256b68f-9415-4dbc-b5f8-814179f14a57`, `db5d5e14-c40f-4d21-a992-74a1c58d0107`, `2421e0d9-2727-4772-9571-c81657452032` |  |
| `original_text` | text | 100% |  | **always NULL** in the sampled rows |  |
| `reply_text` | text | no |  | 4 distinct; e.g. `Like mother like daughter 🏆`, `Ms Twinkle Toes ✨`, `It’s been a lot of fun! 🥹🫶` |  |
| `replied_at` | timestamp with time zone | no |  | 4 distinct; e.g. `2026-05-18T17:51:13+00:00`, `2026-05-18T17:10:24+00:00`, `2026-05-29T17:59:16+00:00` |  |
| `response_time_mins` | integer | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `joola_responded` | boolean <br>`= False` | no |  | 1 distinct; e.g. `True` |  |
| `sentiment` | text | 100% |  | **always NULL** in the sampled rows |  |
| `created_at` | timestamp with time zone <br>`= now()` | no |  | 2 distinct; e.g. `2026-05-23T14:35:45.794979+00:00`, `2026-06-05T07:56:04.920525+00:00` |  |

### KPI & people app

A separate product surface sharing the same Postgres: employee directory, RBAC, KPI tree, approvals and notifications. No link to the brand-intelligence tables.

#### `users`

Employee directory for the KPI application: employee code, name, email, designation, department, region, manager, RBAC role and an `auth_id` linking to Supabase Auth. Contains real staff emails - treat as personal data.

| | |
|---|---|
| **Rows** | 6 |
| **Grain** | one row per employee |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | KPI app (Supabase Auth + admin UI) - insert/update |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `region_id` -> `regions.id`, `manager_id` -> `users.id`, `role_id` -> `roles.id` |
| **Referenced by** | `approvals.requested_by`, `approvals.reviewed_by`, `audit_log.actor_id`, `kpi_contributors.assigned_by`, `kpi_contributors.user_id`, `kpi_templates.created_by`, `kpis.created_by`, `kpis.owner_id`, `notifications.user_id`, `users.manager_id` |
| **Date coverage** | `joined_at` 2026-02-01 -> 2026-03-01; `created_at` 2026-05-20 -> 2026-05-26; `updated_at` 2026-05-26 -> 2026-05-28 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= extensions.uuid_generate_v4(` | NOT NULL | **PK** | 6 distinct; e.g. `60cdfe76-f56b-45d1-8a8e-29b20d13a5ed`, `c7fbde2b-21b9-4fc9-a46e-c6a0bea28115`, `84d1bea7-4a93-46d4-85a6-5da80aa43f67` |  |
| `auth_id` | uuid | no |  | 6 distinct; e.g. `0a79f92c-3168-4d67-a16b-b697f2dccd6e`, `21b57f4f-c140-46a1-b788-d1dbcbf1992f`, `fec7c567-7848-4b9f-930e-dcc7077d8b6d` | Link to Supabase Auth; the join key for RLS policies if they are ever enabled. |
| `employee_code` | character varying | NOT NULL |  | 6 distinct; e.g. `EMP-003`, `EMP-005`, `EMP-001` |  |
| `full_name` | character varying | NOT NULL |  | 6 distinct; e.g. `Priya Sharma`, `Sara Kim`, `Yash Jethava` |  |
| `email` | character varying | NOT NULL |  | 6 distinct; e.g. `priya.sharma@joola.com`, `sara.kim@joola.com`, `yash.j@joola.in` | Real employee addresses. Any anon-key read path over this table exposes staff PII. |
| `phone` | character varying | 17% |  | 3 distinct; e.g. `Joola@2026!`, `1234567891`, `123456789` | One row holds what looks like a password (`Joola@2026!`) rather than a phone number - see the risk section. |
| `designation` | character varying | no |  | 5 distinct; e.g. `Founder`, `Marketing Manager`, `Regional Marketing Lead` |  |
| `department` | character varying | 17% |  | 2 distinct; e.g. `Marketing`, `HR` |  |
| `region_id` | uuid | 33% | FK -> `regions.id` | 4 distinct; e.g. `e4783764-d2ac-4749-8c12-a8e659852101`, `244c1d26-7c8c-402f-ab15-7b1ae125c9b8`, `443e7c4a-3eda-4150-8768-98c906fee4f9` |  |
| `manager_id` | uuid | 17% | FK -> `users.id` | 3 distinct; e.g. `8b73a1b9-435a-4d1a-b282-903454ce94a0`, `84d1bea7-4a93-46d4-85a6-5da80aa43f67`, `ae60e6c1-0cfa-43a6-bf1f-3f50b25ec802` |  |
| `is_admin` | boolean <br>`= False` | NOT NULL |  | 2 distinct; e.g. `False`, `True` |  |
| `status` | public.user_status <br>`= active` | NOT NULL |  | 1 distinct; e.g. `active` |  |
| `profile_image` | text | 100% |  | **always NULL** in the sampled rows |  |
| `joined_at` | date | 50% |  | 3 distinct; e.g. `2026-02-01`, `2026-03-01`, `2026-02-15` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 4 distinct; e.g. `2026-05-20T11:11:52.772169+00:00`, `2026-05-20T10:40:47.257099+00:00`, `2026-05-20T10:43:25.09703+00:00` |  |
| `updated_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 6 distinct; e.g. `2026-05-26T11:31:43.209105+00:00`, `2026-05-26T11:36:49.157283+00:00`, `2026-05-26T11:37:02.525513+00:00` |  |
| `sys_role` | public.sys_role <br>`= individual` | NOT NULL |  | 3 distinct; e.g. `individual`, `global`, `manager` |  |
| `color` | character varying | 50% |  | 3 distinct; e.g. `#10B981`, `#F59E0B`, `#3B82F6` |  |
| `role_id` | uuid | no | FK -> `roles.id` | 2 distinct; e.g. `8d01f7e6-72a4-4aaa-a20f-6849dab22bea`, `f22a46b9-5084-4a24-b91d-ca1644b7acd8` |  |

#### `roles`

RBAC role definitions (Admin, Global, Regional, Manager, Individual) with a JSONB permission matrix over pages and actions.

| | |
|---|---|
| **Rows** | 5 |
| **Grain** | one row per role |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | KPI app seed - manual |
| **Read by** | _no frontend consumer_ |
| **Referenced by** | `users.role_id` |
| **Date coverage** | `created_at` 2026-05-26 -> 2026-05-26; `updated_at` 2026-05-26 -> 2026-05-26 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 5 distinct; e.g. `f22a46b9-5084-4a24-b91d-ca1644b7acd8`, `7a1f75c0-1406-4ecf-ac3d-7de3b6f8a3bf`, `7ecfef2c-0335-4685-87f5-c09c5db61243` |  |
| `name` | text | NOT NULL |  | 5 distinct; e.g. `Admin`, `Global`, `Regional` |  |
| `tier` | text | NOT NULL |  | 5 distinct; e.g. `admin`, `global`, `regional` |  |
| `description` | text | no |  | 5 distinct; e.g. `Full system access`, `All regions - all screens except permissions m...`, `Own region only - GM and Regional Heads` |  |
| `permissions` | jsonb | NOT NULL |  | 5 distinct; e.g. `{"actions": {"audit_view": true, "kpi_approve"...`, `{"actions": {"audit_view": true, "kpi_approve"...`, `{"actions": {"audit_view": false, "kpi_approve...` |  |
| `is_system` | boolean <br>`= False` | NOT NULL |  | 1 distinct; e.g. `True` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 1 distinct; e.g. `2026-05-26T07:12:37.272208+00:00` |  |
| `updated_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 1 distinct; e.g. `2026-05-26T07:12:37.272208+00:00` |  |

#### `regions`

Commercial regions (NA, EMEA, APAC, LATAM, SASIA) with display flag, colour and description.

| | |
|---|---|
| **Rows** | 5 |
| **Grain** | one row per region |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | KPI app seed - manual |
| **Read by** | _no frontend consumer_ |
| **Referenced by** | `kpis.region_id`, `users.region_id` |
| **Date coverage** | `created_at` 2026-05-20 -> 2026-05-20; `updated_at` 2026-05-20 -> 2026-05-20 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= extensions.uuid_generate_v4(` | NOT NULL | **PK** | 5 distinct; e.g. `443e7c4a-3eda-4150-8768-98c906fee4f9`, `244c1d26-7c8c-402f-ab15-7b1ae125c9b8`, `e4783764-d2ac-4749-8c12-a8e659852101` |  |
| `name` | character varying | NOT NULL |  | 5 distinct; e.g. `North America`, `Europe, Middle East & Africa`, `Asia Pacific` |  |
| `code` | character varying | NOT NULL |  | 5 distinct; e.g. `NA`, `EMEA`, `APAC` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 1 distinct; e.g. `2026-05-20T11:02:31.699366+00:00` |  |
| `updated_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 1 distinct; e.g. `2026-05-20T11:02:31.699366+00:00` |  |
| `flag` | text | no |  | 3 distinct; e.g. `🌎`, `🌏`, `🌍` |  |
| `color` | character varying | no |  | 5 distinct; e.g. `#3B82F6`, `#10B981`, `#F59E0B` |  |
| `description` | text | no |  | 5 distinct; e.g. `Covers the United States, Canada, and Mexico m...`, `Encompasses Western and Eastern Europe, the Mi...`, `Covers Southeast Asia, Australia, New Zealand,...` |  |

#### `kpis`

The KPI tree: number, name, description, type (quantitative/qualitative), period, update frequency, target vs current value, unit, date range, next due date, owner, parent KPI for cascading, level and approval status.

| | |
|---|---|
| **Rows** | 19 |
| **Grain** | one row per KPI |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | KPI app - insert/update |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `region_id` -> `regions.id`, `owner_id` -> `users.id`, `parent_id` -> `kpis.id`, `created_by` -> `users.id` |
| **Referenced by** | `approvals.kpi_id`, `kpi_contributors.kpi_id`, `kpis.parent_id` |
| **Date coverage** | `start_date` 2026-01-01 -> 2026-01-01; `end_date` 2026-12-31 -> 2026-12-31; `next_due_date` 2026-01-31 -> 2026-08-18; `created_at` 2026-05-20 -> 2026-05-26; `updated_at` 2026-05-20 -> 2026-05-26 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= extensions.uuid_generate_v4(` | NOT NULL | **PK** | 19 distinct; e.g. `34eea08c-17e2-4411-9bd9-57444a99c690`, `9f218cfe-15c2-4371-a358-1a0657d17698`, `39d18266-8bb0-4e01-b794-b456dca01b57` |  |
| `kpi_number` | character varying | NOT NULL |  | 19 distinct; e.g. `KPI-004`, `KPI-006`, `KPI-007` |  |
| `name` | character varying | NOT NULL |  | 18 distinct; e.g. `yash`, `SEO Organic Ranking Score`, `Social Media Follower Growth` |  |
| `description` | text | no |  | 15 distinct; e.g. `Measurement Method: 100 Baseline Score: 10 Sur...`, `Composite score measuring average keyword rank...`, `Net new followers gained across LinkedIn, Inst...` |  |
| `type` | public.kpi_type <br>`= quantitative` | NOT NULL |  | 2 distinct; e.g. `quantitative`, `qualitative` |  |
| `period` | public.kpi_period <br>`= quarterly` | NOT NULL |  | 3 distinct; e.g. `quarterly`, `monthly`, `annual` |  |
| `update_frequency` | public.update_frequency <br>`= monthly` | NOT NULL |  | 3 distinct; e.g. `quarterly`, `monthly`, `weekly` |  |
| `target_value` | numeric | no |  | 13 distinct; range 5.5 .. 5e+04; e.g. `100.0`, `75.0`, `2500.0` |  |
| `current_value` | numeric <br>`= 0` | no |  | 11 distinct; range 0 .. 3.842e+04; e.g. `0.0`, `62.0`, `1870.0` |  |
| `unit` | character varying | 47% |  | 6 distinct; e.g. `%`, `score`, `followers` |  |
| `start_date` | date | 47% |  | 1 distinct; e.g. `2026-01-01` |  |
| `end_date` | date | 47% |  | 1 distinct; e.g. `2026-12-31` |  |
| `next_due_date` | date | no |  | 7 distinct; e.g. `2026-06-30`, `2026-08-18`, `2026-05-25` |  |
| `allocation_pct` | numeric <br>`= 100.0` | no |  | 2 distinct; range 50 .. 100; e.g. `100.0`, `50.0` |  |
| `status` | public.kpi_status <br>`= draft` | NOT NULL |  | 4 distinct; e.g. `active`, `draft`, `cancelled` |  |
| `region_id` | uuid | 53% | FK -> `regions.id` | 1 distinct; e.g. `e4783764-d2ac-4749-8c12-a8e659852101` |  |
| `owner_id` | uuid | no | FK -> `users.id` | 5 distinct; e.g. `84d1bea7-4a93-46d4-85a6-5da80aa43f67`, `c7fbde2b-21b9-4fc9-a46e-c6a0bea28115`, `8b73a1b9-435a-4d1a-b282-903454ce94a0` |  |
| `parent_id` | uuid | 89% | FK -> `kpis.id` | 1 distinct; e.g. `db8ba253-1593-44c5-a0f6-c2d0fae83b21` |  |
| `level` | smallint <br>`= 0` | NOT NULL |  | 2 distinct; range 0 .. 1; e.g. `0`, `1` |  |
| `created_by` | uuid | no | FK -> `users.id` | 3 distinct; e.g. `84d1bea7-4a93-46d4-85a6-5da80aa43f67`, `8b73a1b9-435a-4d1a-b282-903454ce94a0`, `60cdfe76-f56b-45d1-8a8e-29b20d13a5ed` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 10 distinct; e.g. `2026-05-20T11:03:33.891096+00:00`, `2026-05-20T12:08:32.085802+00:00`, `2026-05-20T12:10:42.543065+00:00` |  |
| `updated_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 14 distinct; e.g. `2026-05-20T11:03:33.891096+00:00`, `2026-05-20T12:08:32.085802+00:00`, `2026-05-20T12:10:42.543065+00:00` |  |
| `approval_status` | public.approval_status <br>`= draft` | NOT NULL |  | 3 distinct; e.g. `draft`, `approved`, `pending` |  |

#### `kpi_templates`

Reusable KPI definitions with a JSONB field schema used to drive the creation form, plus a usage counter.

| | |
|---|---|
| **Rows** | 3 |
| **Grain** | one row per template |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | KPI app - insert |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `created_by` -> `users.id` |
| **Date coverage** | `created_at` 2026-05-20 -> 2026-05-20; `updated_at` 2026-05-20 -> 2026-05-20 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 3 distinct; e.g. `774a93f7-aab1-4b16-9fac-aca2a31e0795`, `9b0eede0-2bb0-495e-a4b7-bce3bf054b81`, `67927406-3ff7-49df-bb7b-fa113c1771ed` |  |
| `name` | text | NOT NULL |  | 3 distinct; e.g. `Digital Marketing Performance`, `Revenue & Pipeline KPI`, `Content & SEO Performance` |  |
| `category` | text <br>`= Custom` | NOT NULL |  | 3 distinct; e.g. `Marketing`, `Sales`, `Content` |  |
| `icon` | text <br>`= 📋` | NOT NULL |  | 3 distinct; e.g. `📊`, `💰`, `✍️` |  |
| `fields` | jsonb | NOT NULL |  | 3 distinct; e.g. `[{"key": "channel", "label": "Marketing Channe...`, `[{"key": "revenue_type", "label": "Revenue Typ...`, `[{"key": "content_type", "label": "Content Typ...` |  |
| `used_in` | integer <br>`= 0` | NOT NULL |  | 3 distinct; range 1 .. 4; e.g. `3`, `1`, `4` |  |
| `is_default` | boolean <br>`= False` | NOT NULL |  | 2 distinct; e.g. `True`, `False` |  |
| `created_by` | uuid | no | FK -> `users.id` | 2 distinct; e.g. `84d1bea7-4a93-46d4-85a6-5da80aa43f67`, `8b73a1b9-435a-4d1a-b282-903454ce94a0` |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 1 distinct; e.g. `2026-05-20T11:12:24.499997+00:00` |  |
| `updated_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | 1 distinct; e.g. `2026-05-20T11:12:24.499997+00:00` |  |

#### `kpi_contributors`

Join table assigning users to a KPI as owner or contributor with an allocation percentage. Empty.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per (KPI, user) (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | KPI app (unused) - never written |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `kpi_id` -> `kpis.id`, `user_id` -> `users.id`, `assigned_by` -> `users.id` |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= extensions.uuid_generate_v4(` | NOT NULL | **PK** | _table is empty_ |  |
| `kpi_id` | uuid | NOT NULL | FK -> `kpis.id` | _table is empty_ |  |
| `user_id` | uuid | NOT NULL | FK -> `users.id` | _table is empty_ |  |
| `role` | public.contributor_role <br>`= contributor` | NOT NULL |  | _table is empty_ |  |
| `allocation_pct` | numeric <br>`= 0` | - |  | _table is empty_ |  |
| `assigned_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | _table is empty_ |  |
| `assigned_by` | uuid | - | FK -> `users.id` | _table is empty_ |  |

#### `kpi_number_sequences`

Per-region counter that issues sequential KPI numbers. Contains one malformed key (`56387`) alongside real region codes, and both `SA`/`IN`/`IND` variants - the sequence keys are not validated against `regions.code`.

| | |
|---|---|
| **Rows** | 6 |
| **Grain** | one row per region code |
| **Primary key** | `region_code` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | KPI app number allocator - update |
| **Read by** | _no frontend consumer_ |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `region_code` | character varying | NOT NULL | **PK** | 6 distinct; e.g. `APAC`, `SA`, `US` | Unvalidated: contains `56387` plus both `IN` and `IND`. |
| `last_seq` | bigint <br>`= 0` | NOT NULL |  | 6 distinct; range 5 .. 17; e.g. `9`, `5`, `6` |  |

#### `approvals`

Approval workflow rows for KPI changes (requested by / reviewed by, status, notes). Empty - approvals are still tracked on `kpis.approval_status`.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per approval request (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | KPI app (unused) - never written |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `kpi_id` -> `kpis.id`, `requested_by` -> `users.id`, `reviewed_by` -> `users.id` |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= extensions.uuid_generate_v4(` | NOT NULL | **PK** | _table is empty_ |  |
| `kpi_id` | uuid | NOT NULL | FK -> `kpis.id` | _table is empty_ |  |
| `requested_by` | uuid | NOT NULL | FK -> `users.id` | _table is empty_ |  |
| `reviewed_by` | uuid | - | FK -> `users.id` | _table is empty_ |  |
| `status` | public.approval_status <br>`= pending` | NOT NULL |  | _table is empty_ |  |
| `note` | text | - |  | _table is empty_ |  |
| `reviewer_note` | text | - |  | _table is empty_ |  |
| `requested_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | _table is empty_ |  |
| `reviewed_at` | timestamp with time zone | - |  | _table is empty_ |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | _table is empty_ |  |
| `updated_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | _table is empty_ |  |

#### `notifications`

In-app notification queue for the KPI app. Empty.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per notification (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | KPI app (unused) - never written |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `user_id` -> `users.id` |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= extensions.uuid_generate_v4(` | NOT NULL | **PK** | _table is empty_ |  |
| `user_id` | uuid | NOT NULL | FK -> `users.id` | _table is empty_ |  |
| `type` | public.notif_type <br>`= system` | NOT NULL |  | _table is empty_ |  |
| `title` | character varying | NOT NULL |  | _table is empty_ |  |
| `body` | text | - |  | _table is empty_ |  |
| `link_type` | character varying | - |  | _table is empty_ |  |
| `link_id` | uuid | - |  | _table is empty_ |  |
| `is_read` | boolean <br>`= False` | NOT NULL |  | _table is empty_ |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | _table is empty_ |  |

#### `audit_log`

Designed as the change-audit trail (actor, action, entity, old/new JSON, IP). Empty - nothing is writing audit rows, which means KPI edits are currently untraceable.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per audited change (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | nothing - never written |
| **Read by** | _no frontend consumer_ |
| **Foreign keys out** | `actor_id` -> `users.id` |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= extensions.uuid_generate_v4(` | NOT NULL | **PK** | _table is empty_ |  |
| `actor_id` | uuid | - | FK -> `users.id` | _table is empty_ |  |
| `action` | character varying | NOT NULL |  | _table is empty_ |  |
| `entity_type` | character varying | NOT NULL |  | _table is empty_ |  |
| `entity_id` | uuid | - |  | _table is empty_ |  |
| `old_data` | jsonb | - |  | _table is empty_ |  |
| `new_data` | jsonb | - |  | _table is empty_ |  |
| `ip_address` | character varying | - |  | _table is empty_ |  |
| `created_at` | timestamp with time zone <br>`= now()` | NOT NULL |  | _table is empty_ |  |

### Ops, logs & archives

Pipeline run logs, Ask-Intel Q&A telemetry and JSONB archives of rows removed by de-duplication migrations.

#### `weekly_run_log`

Summary log of the weekly pipeline: per-source fetch counts, AI analyses run, Apify spend and status. Only 2 rows from April 2026 - the current runner does not write here any more, so `scripts/db_verify.py` freshness checks are the real run record.

| | |
|---|---|
| **Rows** | 2 |
| **Grain** | one row per weekly pipeline run |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | _not defined in `migrations/` - this relation's DDL is untracked_ |
| **Written by** | legacy weekly runner (stopped writing after Apr 2026) - insert per run |
| **Read by** | _no frontend consumer_ |
| **Date coverage** | `run_at` 2026-04-03 -> 2026-04-03; `completed_at` 2026-04-03 -> 2026-04-03 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | 2 distinct; e.g. `de157bf1-7812-4ef2-ab97-a9fb01241cc2`, `15831d3b-9107-4b20-bd7b-d395b264151c` |  |
| `run_at` | timestamp with time zone <br>`= now()` | no |  | 1 distinct; e.g. `2026-04-03T02:30:00+00:00` |  |
| `completed_at` | timestamp with time zone | no |  | 2 distinct; e.g. `2026-04-03T03:11:57.37351+00:00`, `2026-04-03T03:11:59.645169+00:00` |  |
| `country_scope` | text[] | no |  | 1 distinct; e.g. `["US"]` |  |
| `ig_posts_fetched` | integer <br>`= 0` | no |  | 1 distinct; range 93 .. 93; e.g. `93` |  |
| `comments_fetched` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `yt_videos_fetched` | integer <br>`= 0` | no |  | 1 distinct; range 387 .. 387; e.g. `387` |  |
| `yt_comments_fetched` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `reviews_fetched` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `reddit_mentions_fetched` | integer <br>`= 0` | no |  | 1 distinct; range 38 .. 38; e.g. `38` |  |
| `news_mentions_fetched` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `influencer_posts_fetched` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `ai_analyses_run` | integer <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `errors` | text[] | 100% |  | **always NULL** in the sampled rows |  |
| `apify_cost_usd` | double precision <br>`= 0` | no |  | 1 distinct; range 0 .. 0; e.g. `0` |  |
| `status` | text <br>`= running` | no |  | 1 distinct; e.g. `completed` |  |

#### `ask_intel_qa_log`

Telemetry for the Ask Intel natural-language surface: question, answer summary, data sources used, visual count, latency, confidence, warnings and thumbs-up/down feedback. Empty - the logging call is not wired up, so there is no feedback loop on answer quality.

| | |
|---|---|
| **Rows** | 0 |
| **Grain** | one row per Ask Intel question (empty) |
| **Primary key** | `id` |
| **Uniqueness / upsert key** | none; CHECK `feedback in ('up','down','none')` |
| **Written by** | `frontend/app/api/v2/ask-intel/route.ts` (insert) + `.../feedback/route.ts` (update) - insert + update |
| **Read by** | `/v2/ask-intel`, `/v2/ask-intel/feedback` |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `id` | uuid <br>`= gen_random_uuid()` | NOT NULL | **PK** | _table is empty_ |  |
| `session_id` | text | - |  | _table is empty_ |  |
| `question` | text | NOT NULL |  | _table is empty_ |  |
| `answer_summary` | text | - |  | _table is empty_ |  |
| `visuals_count` | integer <br>`= 0` | - |  | _table is empty_ |  |
| `data_sources` | text[] | - |  | _table is empty_ |  |
| `feedback` | text <br>`= none` | - |  | _table is empty_ |  |
| `feedback_notes` | text | - |  | _table is empty_ |  |
| `user_followup` | text | - |  | _table is empty_ |  |
| `latency_ms` | integer | - |  | _table is empty_ |  |
| `confidence` | numeric | - |  | _table is empty_ |  |
| `warnings` | text[] | - |  | _table is empty_ |  |
| `error_message` | text | - |  | _table is empty_ |  |
| `created_at` | timestamp with time zone <br>`= now()` | - |  | _table is empty_ |  |

#### `products_dupe_archive`

JSONB archive of `products` rows deleted by the de-duplication migration, kept for rollback. No primary key.

| | |
|---|---|
| **Rows** | 13 |
| **Grain** | one row per archived duplicate |
| **Primary key** | _none_ |
| **Uniqueness / upsert key** | none - no primary key at all |
| **Written by** | `migrations/008` - one-off archive |
| **Read by** | _no frontend consumer_ |
| **Date coverage** | `archived_at` 2026-05-19 -> 2026-05-19 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `archived_at` | timestamp with time zone <br>`= now()` | no |  | 1 distinct; e.g. `2026-05-19T07:02:04.306291+00:00` |  |
| `row_data` | jsonb | no |  | 13 distinct; e.g. `{"ai_category": null, "avg_rating": null, "bra...`, `{"ai_category": null, "avg_rating": null, "bra...`, `{"ai_category": null, "avg_rating": null, "bra...` |  |

#### `influencer_posts_dupe_archive`

JSONB archive of duplicate `influencer_posts` rows removed before the unique constraint was added.

| | |
|---|---|
| **Rows** | 327 |
| **Grain** | one row per archived duplicate |
| **Primary key** | _none_ |
| **Uniqueness / upsert key** | none - no primary key at all |
| **Written by** | `migrations/004` - one-off archive |
| **Read by** | _no frontend consumer_ |
| **Date coverage** | `archived_at` 2026-05-19 -> 2026-05-19 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `archived_at` | timestamp with time zone <br>`= now()` | no |  | 1 distinct; e.g. `2026-05-19T03:56:50.296598+00:00` |  |
| `row_data` | jsonb | no |  | 327 distinct; e.g. `{"brand_id": "0926e8fa-34d4-4aa8-96e6-ec01425f...`, `{"brand_id": "0926e8fa-34d4-4aa8-96e6-ec01425f...`, `{"brand_id": "0926e8fa-34d4-4aa8-96e6-ec01425f...` |  |

#### `reddit_mentions_dupe_archive`

JSONB archive of duplicate `reddit_mentions` rows removed before the unique constraint was added.

| | |
|---|---|
| **Rows** | 59 |
| **Grain** | one row per archived duplicate |
| **Primary key** | _none_ |
| **Uniqueness / upsert key** | none - no primary key at all |
| **Written by** | `migrations/004` - one-off archive |
| **Read by** | _no frontend consumer_ |
| **Date coverage** | `archived_at` 2026-05-19 -> 2026-05-19 |

| Column | Type | Null | Key | What's in it | Notes |
|---|---|---|---|---|---|
| `archived_at` | timestamp with time zone <br>`= now()` | no |  | 1 distinct; e.g. `2026-05-19T03:56:50.296598+00:00` |  |
| `row_data` | jsonb | no |  | 59 distinct; e.g. `{"author": "Boring_Buy_9088", "brand_id": "04d...`, `{"author": "omfghi2u", "brand_id": "f9acc948-f...`, `{"author": "CainFire", "brand_id": "f9acc948-f...` |  |

---

## 6. Freshness audit

Most recent timestamp found in any temporal column of each relation, measured live. Today is 2026-09-12 and the pipeline is weekly, so **2026-09-07 is current**.

| Cluster | Last data | Verdict |
|---|---|---|
| Scrape layer — `ig_*`, `yt_*`, `tiktok_*`, `x_*`, `reddit_*`, `influencer_posts`, `news_articles`, `products`, `promotions` | 2026-09-07 | **current** |
| Fact layer — `mention_facts`, `product_mentions`, `topic_lifecycle`, `product_attention_*`, `competitor_switch_events` | 2026-09-07 | **current** |
| `ad_pressure_daily` | 2026-08-31 | 1 cycle behind |
| `marketing_ads` | 2026-08-24 | ~3 weeks |
| SEO sweep (`seo_sweeps`, `runs`, `seo_brand_metrics`, `domain_ranked_keywords`, `competitor_domains`), paddle review + spec harvest, brand comparison | 2026-08-26 | ~2.5 weeks — manual-cadence modules, expected |
| Sales intelligence — `product_snapshots`, `product_variants`, `sales_estimates`, `sales_facts_daily`, `availability_daily` | 2026-08-17 / 08-18 | **~4 weeks stale** — the inventory scrape has not run since |
| `content_drafts`, `content_generation_runs` | 2026-08-21 | on-demand, fine |
| JOOLA-IG capture — `joola_ig_posts`, `joola_ig_comments` | 2026-08-12 | ~1 month |
| JOOLA-IG analysis — `joola_ig_comment_analysis`, `joola_ig_loyal_users`, `joola_ig_post_analysis`, `joola_ig_weekly_snapshot` | 2026-06-28 | **~2.5 months stale** — comments are newer than their own analysis |
| **Analytics statistics + timeseries marts** — `joola_timeseries_daily` / `_weekly`, `dim_brand_calendar`, `composite_scores_weekly`, `correlation_results`, `granger_results`, `changepoint_results`, `ai_narratives` | **2026-05-24** | **~3.5 months stale** — see finding 4 |
| SEO crawl detail — `pages`, `issues`, `keywords`, `serp_results`, `entities` | 2026-05-09 | paused |
| Market intel — `market_intel_items`, `market_trends`, `brand_mentions_external`, `generated_content` | 2026-04-05 | frozen |
| `joola_ig_athlete_mentions`, `joola_ig_competitor_mentions`, `joola_ig_product_mentions`, `joola_ig_hashtag_performance`, `joola_ig_user_post_activity` | 2026-03-28 … 04-03 | frozen |

`kpis` appears to reach 2026-12-31 only because that is a planned `end_date`, not a write time.

---

## 7. Query rules and traps

These are the things that silently produce wrong numbers.

### Product invariants (also in [CLAUDE.md](../CLAUDE.md))

1. **Share of Voice must be recomputed under a brand filter.** The precomputed `share` field is calculated across all 11 brands and is wrong whenever a filter is active — derive it from the filtered list.
2. **Filter `followers >= 50` before any engagement-rate ranking.** Scraping artifacts with 1 follower produce ~69,000% ER and destroy every axis.
3. **Render brand labels through `pgName(slug, brands)`**, which applies the Franklin → Franklin Pickleball rename. `productIntel.ts` and `campaignOfferIntel.ts` bypass it.

### Sentinels and always-null columns

| Trap | Where | What to do |
|---|---|---|
| `like_count = -1` means "hidden by the account", not zero | `ig_posts`, `joola_ig_posts`, `influencer_posts` | filter `like_count >= 0` before averaging |
| `posted_at` NULL for **every** row | `yt_comments` | time-filter on `scraped_at` |
| `transcript_text` NULL for every row | `yt_video_transcripts` | the table is a failure log — read `fetch_status` |
| whole enrichment block NULL | `ig_posts` | post-level sentiment does not exist; use `ig_comments` |
| economics block NULL (price, index, availability, units, revenue) | `joola_timeseries_daily`, `joola_timeseries_weekly` | the marts are attention-only today |
| `follower_count` NULL for every row | `joola_ig_loyal_users` | ambassador ranking rests on comment behaviour alone |
| colour / size / thickness / weight NULL | `product_variants` | parse `variant_title` yourself |
| `channel_id` NULL for every row | `yt_channels` | join on `channel_url` |
| `account_id` NULL for ~59% | `tiktok_videos`, `x_posts` | join on `handle` |
| `parent_post_id` populated for ~1% | `reddit_comments` | the FK will not rebuild threads |
| `athlete_id` NULL for every row | `mention_facts` | athlete attribution is not wired into the fact builder |

### Timezone hazard

The entire `joola_ig_*` cluster stores `timestamp without time zone`; everything else is `timestamptz`. Comparing `joola_ig_posts.posted_at` against `ig_posts.posted_at` shifts silently by the session offset. Cast explicitly.

### `topics` type inconsistency

`topics` is `jsonb` on `ig_comments`, `reddit_comments`, `x_posts`, `tiktok_videos`, `yt_comments` and `influencer_x_posts` — and `text[]` on `reddit_mentions`, `tiktok_comments`, `paddle_reviews`, `market_intel_items` and `yt_video_analysis`. Check the column type before writing a containment filter.

### Duplicate-prone tables

- `domain_ranked_keywords` — inserted, not upserted: 2,000 rows but ~800 distinct ids in the sample. De-duplicate on `(run_id, keyword, url)` before analysing.
- `competitor_switch_events` — two writers with two different conflict keys (`posted_at,from_brand_id,to_brand_id` vs `source_mention_id`). Rows can land twice.
- `subreddit` — both `r/Pickleball` and `pickleball` appear in `reddit_mentions`. Normalise before grouping.

### `mention_facts` rebuild semantics

`facts/mention_facts.py` does `DELETE … WHERE channel = <ch>` then `INSERT`, **per channel**. A partial run therefore leaves the table covering only the channels that ran. Right now `source_table` holds only `paddle_reviews`, `tiktok_comments` and `tiktok_videos`, even though the builder supports nine sources — so everything reading `mention_facts` (the sidebar crisis badge, `/v2/community-intel`, `/v2/market`, the Ask Intel coverage panel) is under-reporting. Re-run `--module facts --source mention-facts` before trusting cross-channel volume.

---

## 8. Review findings

Ranked by severity. Each was verified against the live database or the code, not inferred.

### 1. CRITICAL — 110 of 138 relations are world-readable with the public anon key

The browser client (`frontend/lib/shared/supabase.ts`) reads with `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which ships inside the client bundle of any deployed build. Reading with that key returns **full row counts** on 110 non-empty relations: every scrape table, the whole fact layer, `paddle_reviews` (26,888 rows), `content_drafts`, `content_generation_runs` (including `cost_usd`), `roles` (the complete permission matrix) and every `joola_ig_*` community table — including `joola_ig_loyal_users`, 7,054 named Instagram users with sentiment and ambassador scores.

Only four relations are actually protected: `users`, `kpis`, `regions`, `kpi_templates` (anon count 0 against service counts 6 / 19 / 5 / 3).

Two distinct consequences:

- **The competitive intelligence is public.** Anyone who loads the dashboard can extract the entire competitor corpus — the thing the product exists to produce.
- **Personal data is public.** `content_drafts.created_by` and `content_generation_runs.created_by` hold real employee and contractor email addresses (`@joola.com` plus personal Gmail addresses), and `joola_ig_loyal_users` profiles members of the public by username with behavioural scores. That is a GDPR-relevant exposure, not only a business-data leak.

`migrations/` contains **zero** `ENABLE ROW LEVEL SECURITY` and **zero** `CREATE POLICY` statements, so whatever protects those four tables was applied outside version control.

**Fix:** enable RLS on every relation with explicit authenticated-only read policies, and move reads that must stay private behind API routes using the service key. At minimum revoke anon `select` on `content_drafts`, `content_generation_runs`, `joola_ig_loyal_users` and `roles` now.

### 2. CRITICAL — the anon key can insert into `ask_intel_qa_log`

An unauthenticated `POST /rest/v1/ask_intel_qa_log` with the anon key succeeds. I verified this by inserting one probe row and **deleting it immediately afterwards** — the table is back to 0 rows. Select is blocked on that table, insert is not, so anyone holding the public key can write unbounded rows into it.

**Fix:** drop the anon insert policy; let the Ask Intel route write with the service key it already has.

### 3. HIGH — `NEXT_PUBLIC_OPENAI_KEY` holds a live OpenAI project key

`frontend/.env.local` defines `NEXT_PUBLIC_OPENAI_KEY=sk-proj-…` (164 chars). Every current reference is server-side (`app/api/generate-content/route.ts`, `app/api/v2/ask-intel/route.ts:47` as a fallback, `lib/shared/content-brief/agent.ts`, `lib/shared/keyword-research/agent.ts`), so it is probably not in today's client bundle — but the `NEXT_PUBLIC_` prefix means a single client-side reference inlines it into the browser permanently. The repo's own `frontend/public/architecture.html` already states it "Currently leaks to browser".

**Fix:** rotate the key, rename the variable to `OPENAI_API_KEY`, and delete the fallback at `ask-intel/route.ts:47`.

### 4. HIGH — the analytics layer has not run since 2026-05-24

`joola_timeseries_daily`, `joola_timeseries_weekly`, `dim_brand_calendar`, `composite_scores_weekly`, `correlation_results`, `granger_results`, `changepoint_results` and `ai_narratives` all stop at **2026-05-24**, while the scrape and fact layers are current to 2026-09-07. `/v2/correlations` and `/v2/changepoints` are therefore rendering 3.5-month-old statistics with no staleness indicator.

**Root cause (confirmed 2026-09-12, corrected):** `REFRESH MATERIALIZED VIEW` is issued through the `exec_sql` Postgres RPC, and **that function does not exist in this project** — `POST /rest/v1/rpc/exec_sql` returns PGRST202, and no migration defines it (`analytics_backend/core/exec_sql.py` documents it as optional). When the RPC is missing, `exec_sql()` returns `{"executed": False}` instead of raising; `_refresh_mv` logged a warning and then returned the **stale** view's row count, so the runner logged `OK … rows=5619`. Every refresh since 2026-05-24 has been a silent no-op reported as success.

My earlier attribution to the `analytics_runs` error `Could not find the 'metric_name' column of 'joola_timeseries_daily'` was **wrong**. `metric_name` appears nowhere in the repo or in any commit, and `analytics_runs` is written by no current code — it and its FK children (`correlation_results`, `granger_results`, `changepoint_results`, `forecast_results`, `its_results`) are a legacy long-format stack replaced by the wide-format `analysis_results` writers. That 2026-05 message is a dead artifact of deleted code. Note also that `analysis_results` itself **is** current to 2026-09-07 — the statistics modules do run; it is the two materialized views and the legacy result tables that are frozen.

**Second defect, fixed 2026-09-12:** three of the five statistics modules could never emit a row. `cross_correlation.py`, `granger.py` and `seasonality.py` targeted `estimated_units_sold`, which is 100% NULL in the view, and built only product-level tasks whose series are shorter than their own `_MIN_OBS = 30`. `correlation_scan.py` and `changepoints.py` had already been fixed for exactly this (switch to the dense `mention_count`, add a brand-level rollup) and the fix was never propagated; `seasonality.py` was also missing from `MODULE_STEPS`, so `kind='stl'` never existed. That is why `analysis_results.kind` holds only `lag_scan` and `changepoint` instead of five kinds.

**Fix:**
1. Install `exec_sql(query text)` in Supabase, or refresh the three views manually — this cannot be fixed from application code. Until then the views stay frozen.
2. Propagate the dense-metric + brand-rollup fix to the three dead statistics modules and register `seasonality` (done).
3. Make the no-op refresh hard-fail instead of logging success, so this cannot hide again.
4. Add a freshness badge to `/v2/correlations` and `/v2/changepoints`.

**Deadline:** the statistics window is `metric_date >= today - 180` (2026-03-16), which still overlaps the frozen views by ~70 days. After roughly **2026-11-20** that overlap reaches zero and all five modules will silently return 0 rows.

### 5. HIGH — the frontend queries four tables that do not exist

`keyword_rankings`, `crawl_pages`, `content_briefs` and `keyword_research_results` all return **HTTP 404 / PGRST205** from the live database. They are created by `migrations/002_keyword_research.sql` and `migrations/002_seo_reporting.sql`, which were evidently never applied (or were dropped afterwards).

Code targeting them: `frontend/lib/v2/data.ts` (`fetchKeywordRankings`, `fetchCrawlSummary`, `fetchOnPageScoreTrend`, `fetchContentBriefStats`) plus two write routes, `frontend/app/api/content-brief/route.ts` and `frontend/app/api/keyword-research/route.ts`. None has a live caller, so there is no user-visible breakage today — but both API routes would fail on first use, and `docs/DATABASE.md` still lists all four as real tables.

**Fix:** either apply the two `002_*` migrations or delete the dead readers and routes. Do not leave both in place.

### 6. HIGH — 78 of 138 relations have no DDL in `migrations/`

Only 60 live relations are referenced anywhere in `migrations/*.sql`. The other 78 include whole product areas: all 15 `joola_ig_*` tables, all 10 KPI-app tables, the 4 `brand_comparison_*` tables, the `paddle_reviews` / `paddle_products` / `paddle_review_runs` / `paddle_review_errors` cluster, the `news_*` and `seo_*` families, `content_*`, `writer_examples`, `market_intel_items`, `yt_channels`, `yt_channel_weekly` and `ig_accounts`.

**This database cannot be rebuilt from the repository**, which means `docs/DATABASE_RECOVERY.md` cannot be correct either.

**Fix:** dump the live schema (`pg_dump --schema-only`) into a committed baseline migration, then require all future DDL to go through `migrations/`.

### 7. MEDIUM — a password-shaped value is stored in `users.phone`

One `users` row has `phone = 'Joola@2026!'`. The table has no password column, so this is almost certainly a credential typed into the wrong form field. Treat it as exposed: rotate whatever it unlocks, clear the field, add validation on that input. (`users` is one of the four tables anon cannot read, which is the only reason this is MEDIUM.)

### 8. MEDIUM — `audit_log` is empty, so KPI changes are untraceable

The table exists with actor / action / entity / old_data / new_data / ip_address columns and has never received a row. `approvals`, `notifications` and `kpi_contributors` are likewise empty while `kpis.approval_status` is in active use — so approval decisions are a single enum value with no history and no actor. For a KPI system with five RBAC tiers, that is a governance gap.

### 9. MEDIUM — six uniqueness rules cannot be used as upsert targets

`promotions(brand_id, banner_text)`, `marketing_ads(platform, ad_id)`, `influencer_x_snapshots(influencer_id, week_number, year)`, `mention_facts_uniq(…)` (also an expression index), `competitor_switch_source_idx` and `competitor_switch_time_brands_idx` are **unique indexes, not unique constraints**. PostgREST rejects them as `on_conflict` targets — migrations 008, 023, 024 and 025 each record this as a past cause of silent write failures.

**Fix:** promote them with `ALTER TABLE … ADD CONSTRAINT … UNIQUE`.

### 10. MEDIUM — Ask Intel telemetry is not being recorded

`frontend/app/api/v2/ask-intel/route.ts:928` inserts into `ask_intel_qa_log` on every question, and the table has 0 rows. Either the surface has never been used in production, or the insert fails and the error is caught and only logged (line 932). Either way there is no feedback loop on answer quality — exactly what `migrations/017` was added to provide. Check the route's server logs.

### 11. LOW — `availability_daily` still carries the bug that `023` fixed for `promotion_daily`

`product_id` is declared nullable but is part of the composite primary key, so a NULL product silently fails to insert. `023_promotion_daily_brand_grain.sql` fixed exactly this on the sibling table and left this one alone.

### 12. LOW — unvalidated enum columns

Only 5 CHECK constraints exist database-wide. Visible consequences: `kpi_number_sequences.region_code` contains `56387` alongside both `IN` and `IND`; `reddit_mentions.subreddit` mixes `r/Pickleball` with `pickleball`; `products.category` mixes `paddle` with `Mid` and `Entry`. Add CHECKs or lookup FKs on the columns that drive grouping.

### 13. LOW — `integrations.access_token` / `refresh_token` are plaintext columns

Empty today, and its anon exposure is undetermined precisely because it is empty. Encrypt (pgsodium / Vault) or drop the table before anything writes a provider token into it.

### 14. LOW — dead code around the data layer

`analytics_backend/statistics/seasonality.py` writes `analysis_results` with `kind='stl'` but is absent from `MODULE_STEPS`, so it never runs. `frontend/lib/v2/crisis.ts` is imported by nothing. `campaignOfferIntel.fetchCampaignStrategyMatrix`, `analytics.fetchGrangerResults` and `data.ts probeTable` have no callers.

---


## Appendix A - every foreign key

All 183 foreign keys, grouped by parent table.

**-> `brands`** (71 references)

- `ad_pressure_daily.brand_id` -> `brands.id`
- `analysis_results.brand_id` -> `brands.id`
- `availability_daily.brand_id` -> `brands.id`
- `backlinks_summary.brand_id` -> `brands.id`
- `brand_comparison_discrepancies.brand_id` -> `brands.id`
- `brand_comparison_metrics.brand_id` -> `brands.id`
- `brand_comparison_products.brand_id` -> `brands.id`
- `brand_comparison_runs.brand_a_id` -> `brands.id`
- `brand_comparison_runs.brand_b_id` -> `brands.id`
- `brand_mentions_external.brand_id` -> `brands.id`
- `brand_replies.replying_brand_id` -> `brands.id`
- `competitor_domains.brand_id` -> `brands.id`
- `competitor_switch_events.from_brand_id` -> `brands.id`
- `competitor_switch_events.to_brand_id` -> `brands.id`
- `domain_ranked_keywords.brand_id` -> `brands.id`
- `entities.brand_id` -> `brands.id`
- `gap_analyses.brand_id` -> `brands.id`
- `ig_accounts.brand_id` -> `brands.id`
- `ig_comments.brand_id` -> `brands.id`
- `ig_posts.brand_id` -> `brands.id`
- `ig_profiles_weekly.brand_id` -> `brands.id`
- `influencer_posts.brand_id` -> `brands.id`
- `influencer_snapshots.brand_id` -> `brands.id`
- `influencer_x_posts.brand_id` -> `brands.id`
- `influencer_x_snapshots.brand_id` -> `brands.id`
- `influencers.brand_id` -> `brands.id`
- `inventory_events.brand_id` -> `brands.id`
- `issues.brand_id` -> `brands.id`
- `jobs.brand_id` -> `brands.id`
- `keywords.brand_id` -> `brands.id`
- `marketing_ads.brand_id` -> `brands.id`
- `mention_facts.brand_id` -> `brands.id`
- `news_mentions.brand_id` -> `brands.id`
- `paddle_specs.brand_id` -> `brands.id`
- `pages.brand_id` -> `brands.id`
- `product_aliases.brand_id` -> `brands.id`
- `product_attention_daily.brand_id` -> `brands.id`
- `product_attention_sales_correlation.brand_id` -> `brands.id`
- `product_attention_summary.brand_id` -> `brands.id`
- `product_mentions.brand_id` -> `brands.id`
- `product_price_history.brand_id` -> `brands.id`
- `product_reviews.brand_id` -> `brands.id`
- `product_snapshots.brand_id` -> `brands.id`
- `product_variants.brand_id` -> `brands.id`
- `products.brand_id` -> `brands.id`
- `products_catalog.brand_id` -> `brands.id`
- `promotion_daily.brand_id` -> `brands.id`
- `promotion_sales_impact.brand_id` -> `brands.id`
- `promotions.brand_id` -> `brands.id`
- `reddit_comments.brand_id` -> `brands.id`
- `reddit_mentions.brand_id` -> `brands.id`
- `runs.brand_id` -> `brands.id`
- `sales_estimates.brand_id` -> `brands.id`
- `sales_facts_daily.brand_id` -> `brands.id`
- `seo_brand_metrics.brand_id` -> `brands.id`
- `seo_provider_calls.brand_id` -> `brands.id`
- `serp_results.brand_id` -> `brands.id`
- `tiktok_accounts.brand_id` -> `brands.id`
- `tiktok_comments.brand_id` -> `brands.id`
- `tiktok_profiles_weekly.brand_id` -> `brands.id`
- `tiktok_videos.brand_id` -> `brands.id`
- `topic_lifecycle.brand_id` -> `brands.id`
- `x_accounts.brand_id` -> `brands.id`
- `x_posts.brand_id` -> `brands.id`
- `x_profiles_weekly.brand_id` -> `brands.id`
- `yt_channel_weekly.brand_id` -> `brands.id`
- `yt_channels.brand_id` -> `brands.id`
- `yt_comments.brand_id` -> `brands.id`
- `yt_video_analysis.brand_id` -> `brands.id`
- `yt_video_transcripts.brand_id` -> `brands.id`
- `yt_videos.brand_id` -> `brands.id`

**-> `products_catalog`** (19 references)

- `analysis_results.product_id` -> `products_catalog.id`
- `availability_daily.product_id` -> `products_catalog.id`
- `inventory_events.product_id` -> `products_catalog.id`
- `joola_timeseries_daily.canonical_product_id` -> `products_catalog.id`
- `joola_timeseries_weekly.canonical_product_id` -> `products_catalog.id`
- `mention_facts.product_id` -> `products_catalog.id`
- `price_daily.product_id` -> `products_catalog.id`
- `product_aliases.product_id` -> `products_catalog.id`
- `product_attention_daily.product_id` -> `products_catalog.id`
- `product_attention_sales_correlation.product_id` -> `products_catalog.id`
- `product_attention_summary.product_id` -> `products_catalog.id`
- `product_mentions.product_id` -> `products_catalog.id`
- `product_reviews.product_id` -> `products_catalog.id`
- `product_snapshots.product_id` -> `products_catalog.id`
- `product_variants.product_id` -> `products_catalog.id`
- `promotion_daily.product_id` -> `products_catalog.id`
- `promotion_sales_impact.product_id` -> `products_catalog.id`
- `sales_estimates.product_id` -> `products_catalog.id`
- `sales_facts_daily.product_id` -> `products_catalog.id`

**-> `runs`** (13 references)

- `backlinks_summary.run_id` -> `runs.id`
- `competitor_domains.run_id` -> `runs.id`
- `content_calendar.run_id` -> `runs.id`
- `domain_ranked_keywords.run_id` -> `runs.id`
- `entities.run_id` -> `runs.id`
- `gap_analyses.previous_run_id` -> `runs.id`
- `gap_analyses.run_id` -> `runs.id`
- `issues.run_id` -> `runs.id`
- `jobs.run_id` -> `runs.id`
- `keywords.run_id` -> `runs.id`
- `pages.run_id` -> `runs.id`
- `runs.previous_run_id` -> `runs.id`
- `serp_results.run_id` -> `runs.id`

**-> `users`** (10 references)

- `approvals.requested_by` -> `users.id`
- `approvals.reviewed_by` -> `users.id`
- `audit_log.actor_id` -> `users.id`
- `kpi_contributors.assigned_by` -> `users.id`
- `kpi_contributors.user_id` -> `users.id`
- `kpi_templates.created_by` -> `users.id`
- `kpis.created_by` -> `users.id`
- `kpis.owner_id` -> `users.id`
- `notifications.user_id` -> `users.id`
- `users.manager_id` -> `users.id`

**-> `analytics_runs`** (5 references)

- `changepoint_results.run_id` -> `analytics_runs.id`
- `correlation_results.run_id` -> `analytics_runs.id`
- `forecast_results.run_id` -> `analytics_runs.id`
- `granger_results.run_id` -> `analytics_runs.id`
- `its_results.run_id` -> `analytics_runs.id`

**-> `influencers`** (5 references)

- `influencer_posts.influencer_id` -> `influencers.id`
- `influencer_snapshots.influencer_id` -> `influencers.id`
- `influencer_x_posts.influencer_id` -> `influencers.id`
- `influencer_x_snapshots.influencer_id` -> `influencers.id`
- `mention_facts.athlete_id` -> `influencers.id`

**-> `joola_ig_posts`** (5 references)

- `joola_ig_athlete_mentions.post_id` -> `joola_ig_posts.post_id`
- `joola_ig_comments.post_id` -> `joola_ig_posts.post_id`
- `joola_ig_post_analysis.post_id` -> `joola_ig_posts.post_id`
- `joola_ig_product_mentions.post_id` -> `joola_ig_posts.post_id`
- `joola_ig_user_post_activity.post_id` -> `joola_ig_posts.post_id`

**-> `product_variants`** (5 references)

- `inventory_events.variant_id` -> `product_variants.id`
- `product_snapshots.variant_id` -> `product_variants.id`
- `promotion_sales_impact.variant_id` -> `product_variants.id`
- `sales_estimates.variant_id` -> `product_variants.id`
- `sales_facts_daily.variant_id` -> `product_variants.id`

**-> `joola_ig_comments`** (4 references)

- `joola_ig_comment_analysis.comment_id` -> `joola_ig_comments.comment_id`
- `joola_ig_competitor_mentions.comment_id` -> `joola_ig_comments.comment_id`
- `joola_ig_complaint_log.comment_id` -> `joola_ig_comments.comment_id`
- `joola_ig_wishlist_items.comment_id` -> `joola_ig_comments.comment_id`

**-> `brand_comparison_runs`** (3 references)

- `brand_comparison_discrepancies.run_id` -> `brand_comparison_runs.id`
- `brand_comparison_metrics.run_id` -> `brand_comparison_runs.id`
- `brand_comparison_products.run_id` -> `brand_comparison_runs.id`

**-> `kpis`** (3 references)

- `approvals.kpi_id` -> `kpis.id`
- `kpi_contributors.kpi_id` -> `kpis.id`
- `kpis.parent_id` -> `kpis.id`

**-> `seo_sweeps`** (3 references)

- `runs.sweep_id` -> `seo_sweeps.id`
- `seo_brand_metrics.sweep_id` -> `seo_sweeps.id`
- `seo_provider_calls.sweep_id` -> `seo_sweeps.id`

**-> `yt_videos`** (3 references)

- `yt_comments.video_id` -> `yt_videos.id`
- `yt_video_analysis.video_id` -> `yt_videos.id`
- `yt_video_transcripts.video_id` -> `yt_videos.id`

**-> `ig_accounts`** (2 references)

- `ig_posts.account_id` -> `ig_accounts.id`
- `ig_profiles_weekly.account_id` -> `ig_accounts.id`

**-> `ig_posts`** (2 references)

- `ig_comments.post_id` -> `ig_posts.id`
- `ig_post_analysis.post_id` -> `ig_posts.id`

**-> `market_intel_items`** (2 references)

- `brand_mentions_external.item_id` -> `market_intel_items.id`
- `generated_content.source_item_id` -> `market_intel_items.id`

**-> `pages`** (2 references)

- `issues.page_id` -> `pages.id`
- `keywords.suggested_page_id` -> `pages.id`

**-> `regions`** (2 references)

- `kpis.region_id` -> `regions.id`
- `users.region_id` -> `regions.id`

**-> `tiktok_accounts`** (2 references)

- `tiktok_profiles_weekly.account_id` -> `tiktok_accounts.id`
- `tiktok_videos.account_id` -> `tiktok_accounts.id`

**-> `x_accounts`** (2 references)

- `x_posts.account_id` -> `x_accounts.id`
- `x_profiles_weekly.account_id` -> `x_accounts.id`

**-> `yt_channels`** (2 references)

- `yt_channel_weekly.channel_id` -> `yt_channels.id`
- `yt_videos.channel_id` -> `yt_channels.id`

**-> `causal_events`** (1 references)

- `its_results.event_id` -> `causal_events.id`

**-> `content_drafts`** (1 references)

- `content_drafts.parent_draft_id` -> `content_drafts.id`

**-> `entities`** (1 references)

- `keywords.seed_entity_id` -> `entities.id`

**-> `generated_content`** (1 references)

- `content_calendar.content_id` -> `generated_content.id`

**-> `ig_comments`** (1 references)

- `ig_comment_analysis.comment_id` -> `ig_comments.id`

**-> `mention_facts`** (1 references)

- `competitor_switch_events.mention_id` -> `mention_facts.id`

**-> `news_articles`** (1 references)

- `content_drafts.source_article_id` -> `news_articles.id`

**-> `news_scrape_runs`** (1 references)

- `news_scrape_errors.scrape_run_id` -> `news_scrape_runs.id`

**-> `paddle_products`** (1 references)

- `paddle_reviews.product_id` -> `paddle_products.id`

**-> `paddle_review_runs`** (1 references)

- `paddle_review_errors.run_id` -> `paddle_review_runs.id`

**-> `products`** (1 references)

- `product_price_history.product_id` -> `products.id`

**-> `promotions`** (1 references)

- `promotion_sales_impact.promotion_id` -> `promotions.id`

**-> `reddit_mentions`** (1 references)

- `reddit_comments.parent_post_id` -> `reddit_mentions.id`

**-> `roles`** (1 references)

- `users.role_id` -> `roles.id`

**-> `tiktok_videos`** (1 references)

- `tiktok_comments.video_id` -> `tiktok_videos.id`

**-> `x_posts`** (1 references)

- `x_replies.post_id` -> `x_posts.id`

**-> `yt_comments`** (1 references)

- `yt_comment_analysis.comment_id` -> `yt_comments.id`

**-> `yt_video_transcripts`** (1 references)

- `yt_video_analysis.transcript_id` -> `yt_video_transcripts.id`

---

## Appendix B — querying this database

There is no `psql` path and no arbitrary-SQL RPC. Everything goes through PostgREST.

```bash
# exact row count
curl -s -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Prefer: count=exact" -H "Range: 0-0" \
     "$SUPABASE_URL/rest/v1/mention_facts?select=*&limit=0" -D - -o /dev/null | grep -i content-range

# brand-filtered read with an embedded join
"$SUPABASE_URL/rest/v1/ig_comments?select=comment_text,sentiment_label,brands(slug)&brand_id=eq.<uuid>&limit=20"

# date window, ordered
"$SUPABASE_URL/rest/v1/product_attention_daily?attention_date=gte.2026-08-01&order=attention_score.desc&limit=50"

# array containment (text[] columns only)
"$SUPABASE_URL/rest/v1/reddit_mentions?brands_mentioned=cs.%7Bjoola%7D"
```

PostgREST caps responses at 1,000 rows — page with `Range` headers or `limit`/`offset`, which is what `frontend/lib/v2/productIntel.ts` does for its 10k-row stockout query.

Freshness check from the repo: `python scripts/db_verify.py`.

## Appendix C — regenerating this document

Produced by introspecting the live project: the PostgREST OpenAPI document for structure, `Prefer: count=exact` for row counts, per-column `order=<col>.asc/desc&limit=1` for date ranges, and an 800-row sample per table for null rates, distinct counts and example values. Relation kinds, keys, indexes and seeds came from `migrations/*.sql`; writers from `backend/scraping/**` and `analytics_backend/**`; readers from `frontend/**`.

Re-run those four introspection steps against `$SUPABASE_URL` to refresh. Re-verify any number older than one pipeline cycle before relying on it.
