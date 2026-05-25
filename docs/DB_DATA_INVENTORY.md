# JOOLA Intel — Supabase Database Inventory

> **Snapshot date**: 2026-05-25
> **Supabase project**: `loecyghnkkxyymelgexz`
> **Source of truth**: `migrations/001-016*.sql` + `backend/scraping/sources/**/scrape_*.py` (writers) + `frontend/lib/v2/data.ts` (readers)
> **Probe status**: Schema & writer/reader mapping enumerated from repository artifacts. Live row counts and freshness timestamps must be confirmed by running `python backend/scraping/maintenance/count_rows.py` (the probe-by-REST script could not be executed in this session because shell access was sandboxed). Where this document lists a row count, it is the value last reported in session-memory observations (the most recent dates are noted inline). All schemas, columns, types and source/reader assignments are authoritative.

---

## Section 1 — Executive summary

| Metric | Value |
|---|---|
| Migration files applied | 16 (001-016, plus 4 rollback pairs) |
| Tables enumerated from migrations + writers | **56** |
| Materialized views | 3 (`dim_brand_calendar`, `joola_timeseries_daily`, `joola_timeseries_weekly`) |
| Confirmed-empty / deferred tables | `product_attention_sales_correlation` (schema only, deferred), `news_articles` (writer wired, table seed unknown), `crawl_pages` (SEO ingestion paused), `content_briefs` (manual SEO workflow, low volume), `keyword_research_results`, `keyword_rankings` (SEO ingestion paused) |
| Tables seeded by migration | `brands` (11), `influencers` (27), `products_catalog` (~85 after mig 015), `x_accounts` (8), `tiktok_accounts` (10) |
| Largest tables (by typical row volume per session memory) | `ig_comments`, `yt_comments`, `reddit_comments`, `product_mentions`, `product_attention_daily`, `mention_facts` |
| Pipeline cadence | Weekly Mon 07:00 IST (manual today) |
| Most recently shipped tables | `tiktok_comments` (mig 014, 2026-05-24), `product_reviews` (mig 016, 2026-05-25) |

### Tables with zero rows (verified or expected)

- `product_attention_sales_correlation` — schema only, population deferred until 60+ days of sales_facts_daily accumulate.
- `product_reviews` — table re-created 2026-05-25; awaiting review-widget credentials (Bazaarvoice / Judge.me / Okendo / Yotpo / SPR), so ingestion not yet running.
- `news_articles` — scraper exists (`backend/scraping/sources/news/scrape_news.py`) but cadence/coverage of source seeds is unconfirmed in the current pipeline schedule.
- `crawl_pages`, `content_briefs`, `keyword_rankings`, `keyword_research_results` — created for the SEO sub-project; ingestion is on pause (no scraper currently scheduled into them via the main weekly pipeline).
- `*_dupe_archive` tables — non-zero after migration 004/008 but only carry historical duplicates; not part of analytical surface.

### Tables with likely-stale data (>30 d) — verify via live probe

Frozen / paused signals where the writer has not been triggered recently (per repo state):

- All four SEO marts (`crawl_pages`, `keyword_rankings`, `keyword_research_results`, `content_briefs`).
- `brand_replies` — `detect_brand_replies.py` exists but is not in the default weekly scheduler.
- `inventory_events`, `sales_estimates`, `sales_facts_daily`, `promotion_sales_impact` — sales-intelligence writers exist (`backend/scraping/sales_intelligence/*`), but coverage depends on which brands have working Shopify/SPR JSON probes (currently JOOLA + Six-Zero + Onix + Franklin + HEAD confirmed; commit `21d0c0b`).

---

## Section 2 — Per-table inventory

Tables are grouped by domain. Every table has:
- **Defined in** — migration file or "base schema (pre-migration)" if it was inherited.
- **Source** — Python writer module.
- **Reader** — frontend function in `frontend/lib/v2/data.ts`.
- **Columns** — full list with types and brief description.
- **Notes / known gaps**.

### 2.1 Core taxonomy

#### `brands`
- **Purpose**: 11 tracked competitor brands; central FK target.
- **Defined in**: Base schema (pre-migration); altered by migration 013 to add `timezone TEXT`.
- **Source**: Manual seed at project initialization. Not modified by any scraper.
- **Reader**: `fetchBrands()` (`frontend/lib/v2/data.ts:47`).
- **Row count**: 11 (seeded — joola, selkirk, paddletek, crbn, six-zero, engage, onix, franklin, head, wilson, gamma).
- **Columns**:

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Primary key. |
| `slug` | text UNIQUE | URL-safe brand slug (e.g. `six-zero`). FK target across the schema. |
| `name` | text | Display name. |
| `is_joola` | bool | True only for the JOOLA row — drives dashboard color/role logic. |
| `timezone` | text | Added mig 013. `America/New_York` for US brands; `Australia/Sydney` for six-zero. Defaults `UTC`. |

- **Analytical potential**:
  - JOIN anchor for every per-brand metric.
  - Timezone enables brand-local "yesterday/last 7d" computations (`dim_brand_calendar`).

---

#### `influencers`
- **Purpose**: 27 tracked pro pickleball athletes for sponsorship + cross-channel ROI tracking.
- **Defined in**: Base schema; `x_handle` column added in migration 005.
- **Source**: Manual seed; `x_handle` corrected/nulled by migration 005.
- **Reader**: `fetchInfluencers()` (data.ts:313).
- **Row count**: 27 (seeded).
- **Columns** (inferred from migration 005 + reader selectlist):

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Primary key. |
| `name` | text | Athlete display name. |
| `brand_id` | uuid FK→brands | Sponsoring brand (one per athlete in current data). |
| `instagram_handle` | text UNIQUE | IG username (no `@`). |
| `x_handle` | text | X/Twitter username (no `@`); NULL for unverified guesses. Migration 005 set 17 verified + nulled 10 guesses. |
| `follower_count_ig` | int | Latest IG follower count snapshot. |

- **Per-brand breakdown** (from seed): athletes distributed across all 11 sponsored brands.
- **Known gaps**: TikTok handle column not present; only IG + X tracked structurally. PPA / MLP ranking column not captured.

---

#### `products_catalog`
- **Purpose**: Canonical SKU list. AI enricher resolves free-text mentions to a `products_catalog.id` via `aliases[]` matching.
- **Defined in**: Migration 007 (initial 25 paddles); expanded by migration 015 to ~85 across all brands.
- **Source**: Manual seed via migration. AI enricher does NOT insert here.
- **Reader**: `fetchIGCommentMentions()` (resolves entity_id → name); product pages cross-reference.
- **Row count**: ~85 (per migration 015 verification block: crbn=6, engage=7, franklin=6, gamma=7, head=6, joola=10, onix=8, paddletek=7, selkirk=11, six-zero=10, wilson=7).
- **Columns**:

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Primary key. |
| `brand_id` | uuid FK→brands | Owning brand. |
| `sku` | text | Brand-unique SKU (e.g. `PERSEUS_IV`). UNIQUE(brand_id, sku). |
| `display_name` | text | Human-readable name. |
| `aliases` | text[] | Alternate names AI enricher matches against. Heart of the recognition pipeline. |
| `category` | text | Currently `paddle` for all seeded rows. |
| `is_active` | bool | False would exclude from active matching. |
| `launched_at` | date | Launch date (mostly NULL — not populated). |
| `created_at` | timestamptz | Row insertion time. |

- **Analytical potential**:
  - "Which JOOLA paddle is gaining attention fastest?" via JOIN to `product_attention_daily`.
  - "Which competitor product has no entry in our catalog yet?" via NER pass-through analysis.
- **Known gaps**: `launched_at` mostly empty; category is monolithic ("paddle"); no MSRP/MAP column (relies on `products.price_usd`).

---

#### `product_aliases`
- **Purpose**: Many-aliases-to-one-product lookup. Seeded by migration 012 from `products_catalog.aliases`.
- **Defined in**: Migration 012.
- **Source**: Migration seed + future learned-alias additions; `backend/scraping/sources/products/product_alias_matcher.py` loads into in-memory cache.
- **Reader**: `populate_product_mentions.py` (matcher input).
- **Row count**: 1 per (alias_norm × product_id); seeded from `products_catalog.aliases` + `display_name`. Roughly 200-300 rows expected after migration 015 expansion.
- **Columns**:

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `product_id` | uuid FK→products_catalog | |
| `brand_id` | uuid FK→brands | |
| `alias` | text | Raw alias (case preserved). |
| `alias_norm` | text | Lowercase, ASCII, no punctuation. UNIQUE(alias_norm, product_id). |
| `alias_type` | text | `catalog` (seeded), `manual`, `pattern`, `learned`. |
| `confidence` | numeric(3,2) | Default 1.0. |
| `is_ambiguous` | bool | TRUE if alias_norm spans multiple brands (e.g. "Pro"). |
| `created_at` | timestamptz | |

- **Analytical potential**:
  - Ambiguity audit: `SELECT alias_norm, count(DISTINCT brand_id) FROM product_aliases GROUP BY 1 HAVING count > 1` for terms that need brand-context guards.

---

#### `products`
- **Purpose**: Per-brand scraped paddle catalog from brand websites (richer than `products_catalog` — has price, rating, review count, stock).
- **Defined in**: Base schema; columns added by mig 001 (`sale_price_usd`, `discount_pct`, `stock_count`, `discontinued_at`, `ai_category`); unique (name, brand_id) added by mig 008.
- **Source**: `backend/scraping/sources/products/scrape_catalog.py` (Apify) + `scrape_catalog_local.py` (Playwright stealth fallback for brands that block Apify, per commit `c51882d`).
- **Reader**: `fetchProductsList()`, `fetchProductStats()` (data.ts).
- **Row count**: Driven by per-brand catalog size; varies week to week.
- **Columns** (inferred from migration 001 + reader selectlist):

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `brand_id` | uuid FK→brands | |
| `name` | text | Paddle name as scraped. UNIQUE(name, brand_id). |
| `price_usd` | numeric | MSRP or listed price. |
| `sale_price_usd` | numeric | Active sale price if present. |
| `discount_pct` | numeric | Implied discount. |
| `stock_count` | int | Reported stock (rarely exposed). |
| `discontinued_at` | timestamptz | Set when product disappears from catalog. |
| `ai_category` | text | LLM-classified category (control / power / hybrid). |
| `avg_rating` | numeric | Aggregate star rating (where widget exposes one). |
| `review_count` | int | Aggregate review count. |
| `category` | text | Site-side category. |
| `in_stock` | bool | |
| `last_scraped_at` | timestamptz | |

- **Analytical potential**:
  - Price distribution per brand (already shown on `/v2/products`).
  - Stock disappearances → sellout signal (alternative to inventory_events).
  - Aggregate rating divergence between own product page and external reviews.
- **Known gaps**: `avg_rating`/`review_count` are fetched but currently not rendered in any UI page (per session memory 3961). Some scraped rows have implausible `price_usd > $500` (defensive filter in `fetchProductStats`).

---

### 2.2 Instagram channel

#### `ig_profiles_weekly`
- **Purpose**: Weekly brand IG follower/engagement snapshot.
- **Defined in**: Base schema; `dominant_content_theme` added in mig 011.
- **Source**: `backend/scraping/sources/instagram/scrape_profiles.py`.
- **Reader**: `fetchIG()` (data.ts:77).
- **Columns** (inferred):

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `brand_id` | uuid FK→brands | |
| `handle` | text | |
| `followers` | int | |
| `following` | int | |
| `posts_count` | int | |
| `dominant_content_theme` | text | mig 011; from analyzing last 30 posts. |
| `week_number` | int | ISO week. |
| `year` | int | |
| `scraped_at` | timestamptz | |

---

#### `ig_posts`
- **Purpose**: Individual IG posts per brand handle.
- **Defined in**: Base schema.
- **Source**: `scrape_profiles.py` (`sb.upsert("ig_posts", posts, "instagram_post_id")`).
- **Reader**: `fetchTopIGPosts()`, `fetchPostFrequency()`.
- **Columns** (inferred from reader selectlist):

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `brand_id` | uuid FK→brands | |
| `handle` | text | |
| `instagram_post_id` | text UNIQUE | Shortcode. |
| `post_url` | text | |
| `caption` | text | |
| `like_count` | int | |
| `comment_count` | int | |
| `view_count` | int | |
| `post_format` | text | `Image` / `Reel` / `Carousel`. |
| `posted_at` | timestamptz | |

- **Known gaps**: Frontend dedupes by `instagram_post_id || post_url || (brand, caption[0:80])` because the table is known to carry re-scrape duplicates.

---

#### `ig_comments`
- **Purpose**: Per-post IG comments with AI-enriched sentiment / NER.
- **Defined in**: Base schema; enrichment columns added by mig 006.
- **Source**: `backend/scraping/sources/instagram/scrape_comments.py` (`sb.upsert("ig_comments", rows, "instagram_comment_id")`); enriched by `backend/scraping/enrichment/ai_enricher.py`.
- **Reader**: `fetchTopComments()`, `fetchCommentCounts()`.
- **Columns**:

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `instagram_comment_id` | text UNIQUE | |
| `post_id` | uuid FK→ig_posts | |
| `brand_id` | uuid FK→brands | |
| `commenter_username` | text | |
| `comment_text` | text | |
| `comment_likes` | int | |
| `posted_at` | timestamptz | |
| **Enrichment (mig 006)** | | |
| `sentiment_score` | numeric | -1.0 to +1.0. |
| `sentiment_label` | text | `positive` / `neutral` / `negative`. |
| `topics` | jsonb | Extracted topic tags. |
| `brands_mentioned` | text[] | NER brands. |
| `players_mentioned` | text[] | NER athletes. |
| `products_mentioned` | text[] | NER paddle names. |
| `is_crisis` | bool | LLM flag. |
| `is_opportunity` | bool | |
| `purchase_intent_score` | numeric | |
| `crisis_keywords` | text[] | |
| `enriched_at` | timestamptz | NULL while pending. |

---

### 2.3 YouTube channel

#### `yt_channel_weekly`
- **Purpose**: Weekly brand YT subscriber/views snapshot.
- **Defined in**: Base schema.
- **Source**: `backend/scraping/sources/youtube/scrape_channels.py`.
- **Reader**: `fetchYT()`, `fetchYTTrend()`.
- **Columns** (inferred):

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `brand_id` | uuid FK→brands | |
| `subscribers` | int | |
| `total_videos` | int | |
| `total_views` | bigint | |
| `week_number`, `year` | int, int | |
| `scraped_at` | timestamptz | |

---

#### `yt_videos`
- **Purpose**: Per-brand YT videos (Shorts + long-form).
- **Defined in**: Base schema; `is_short` added by mig 011.
- **Source**: `scrape_channels.py` (`sb.upsert("yt_videos", videos, "youtube_video_id")`).
- **Reader**: `fetchTopYTVideos()` (note: column is `youtube_video_id`, NOT `video_id`).
- **Columns**:

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `brand_id` | uuid FK→brands | |
| `youtube_video_id` | text UNIQUE | Public YT id. |
| `video_url` | text | |
| `title` | text | |
| `view_count` | bigint | |
| `like_count` | int | |
| `comment_count` | int | |
| `duration_seconds` | int | |
| `is_short` | bool | `true` if duration ≤ 60s or url contains `/shorts/`. |
| `published_at` | timestamptz | |

---

#### `yt_comments`
- **Purpose**: Per-video YT comments with AI enrichment.
- **Defined in**: Base schema (no local migration — schema lives only in Supabase); enrichment columns added by mig 006.
- **Source**: `backend/scraping/sources/youtube/scrape_comments.py` (`sb.upsert("yt_comments", rows, "youtube_comment_id")`).
- **Reader**: `fetchTopComments()`, `fetchCommentCounts()`.
- **Columns**:

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `youtube_comment_id` | text UNIQUE | |
| `video_id` | uuid FK→yt_videos | |
| `brand_id` | uuid FK→brands | |
| `commenter_username` | text | |
| `comment_text` | text | |
| `comment_likes` | int | |
| `posted_at` | timestamptz | |
| **Enrichment (mig 006)** | | Same set as `ig_comments`. |

---

#### `yt_video_transcripts`
- **Purpose**: YT captions per video. Missing transcripts written with `fetch_status='no_transcript'`.
- **Defined in**: Migration 012.
- **Source**: `backend/scraping/sources/youtube/scrape_transcripts.py`.
- **Reader**: `yt_video_analysis` (downstream LLM analysis).
- **Columns**:

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `video_id` | uuid FK→yt_videos | |
| `youtube_video_id` | text UNIQUE | |
| `brand_id` | uuid FK→brands | |
| `language` | text | |
| `is_auto_generated` | bool | |
| `transcript_text` | text | Concatenated, no timestamps. |
| `segments` | jsonb | Optional `[{start,dur,text}, …]`. |
| `word_count`, `char_count` | int, int | |
| `source_actor` | text | Apify actor name. |
| `fetch_status` | text NOT NULL | `ok` / `no_transcript` / `private` / `rate_limited` / `error`. |
| `fetch_error` | text | |
| `fetched_at`, `created_at` | timestamptz, timestamptz | |

---

#### `yt_video_analysis`
- **Purpose**: One LLM analysis per video — performance thesis, content type, product/brand/athlete NER, crisis flag.
- **Defined in**: Migration 012.
- **Source**: `backend/scraping/enrichment/analyze_videos.py`.
- **Reader**: Frontend YouTube page can surface `performance_thesis`, `content_type`, `is_paid_promo`.
- **Columns**:

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `video_id` | uuid FK→yt_videos UNIQUE | |
| `youtube_video_id` | text | |
| `brand_id` | uuid FK→brands | |
| `transcript_id` | uuid FK→yt_video_transcripts | |
| `summary` | text | |
| `performance_thesis` | text | |
| `performance_signals` | text[] | E.g. `['hook-strong','celebrity-cameo']`. |
| `content_type` | text | `review` / `tutorial` / `highlight` / `unboxing` / `announcement` / `news` / `other`. |
| `is_paid_promo` | bool | |
| `sentiment_label`, `sentiment_score` | text, numeric | |
| `products_mentioned` | text[] | |
| `products_matched_ids` | uuid[] | Resolved `products_catalog.id` list. |
| `brands_mentioned`, `players_mentioned`, `topics` | text[], text[], text[] | |
| `is_crisis`, `is_opportunity` | bool, bool | |
| `crisis_keywords` | text[] | |
| `view_count_at_analysis` | bigint | Snapshot for drift detection. |
| `like_count_at_analysis`, `comment_count_at_analysis` | int, int | |
| `model` | text | E.g. `gpt-4o-mini`. |
| `enriched_at`, `created_at` | timestamptz, timestamptz | |

---

### 2.4 X (Twitter) channel

#### `x_accounts`
- **Purpose**: Per-brand X handle dictionary (8 verified brands).
- **Defined in**: Migration 003 (seeded 8 handles); JOOLA corrected by mig 004.
- **Row count**: 8 (joola, selkirk, franklin, paddletek, onix, wilson, gamma, head).
- **Columns**: `id uuid PK`, `brand_id uuid UNIQUE → brands`, `handle text NOT NULL`, `profile_url text`, `created_at timestamptz`.

#### `x_profiles_weekly`
- **Purpose**: Weekly snapshot of brand X follower count.
- **Defined in**: Migration 003.
- **Source**: `backend/scraping/sources/twitter/scrape_brand_posts.py`.
- **Reader**: `fetchX()`, `fetchXTrend()`.
- **Columns**: `id`, `account_id` FK→x_accounts, `brand_id`, `handle`, `followers`, `following`, `tweet_count`, `is_verified bool`, `week_number int`, `year int`, `scraped_at timestamptz`.

#### `x_posts`
- **Purpose**: Per-brand tweets + replies with enrichment.
- **Defined in**: Migration 003; enrichment columns mig 006.
- **Source**: `scrape_brand_posts.py` (`sb.upsert("x_posts", posts, "tweet_id")`).
- **Columns**:

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `account_id` | uuid FK→x_accounts | |
| `brand_id` | uuid FK→brands | |
| `handle` | text | |
| `tweet_id` | text UNIQUE | |
| `post_url` | text | |
| `text` | text | |
| `like_count`, `retweet_count`, `reply_count`, `view_count` | int×4 | |
| `posted_at`, `created_at` | timestamptz, timestamptz | |
| **Enrichment (mig 006)** | | Same set as `ig_comments`. |

---

### 2.5 TikTok channel

#### `tiktok_accounts`
- **Purpose**: Per-brand TikTok handle dictionary (10 brands).
- **Defined in**: Migration 003.
- **Row count**: 10 seeded.
- **Columns**: `id`, `brand_id uuid UNIQUE`, `handle text`, `profile_url`, `created_at`.

#### `tiktok_profiles_weekly`
- **Purpose**: Weekly snapshot per brand handle.
- **Defined in**: Migration 003.
- **Source**: `backend/scraping/sources/tiktok/scrape_videos.py`.
- **Columns**: `id`, `account_id`, `brand_id`, `handle`, `followers int`, `following int`, `video_count int`, `total_hearts bigint`, `is_verified bool`, `week_number`, `year`, `scraped_at`.

#### `tiktok_videos`
- **Purpose**: Per-brand TikTok videos with enrichment.
- **Defined in**: Migration 003; enrichment mig 006.
- **Source**: `scrape_videos.py`.
- **Columns**:

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `account_id`, `brand_id` | uuid×2 | |
| `handle` | text | |
| `tiktok_video_id` | text UNIQUE | |
| `video_url`, `text`, `thumbnail_url` | text×3 | |
| `view_count` | bigint | |
| `like_count`, `comment_count`, `share_count`, `duration_seconds` | int×4 | |
| `posted_at`, `created_at` | timestamptz, timestamptz | |
| **Enrichment (mig 006)** | | Same set as `ig_comments`. |

#### `tiktok_comments`
- **Purpose**: Per-video TikTok comments (added 2026-05-24).
- **Defined in**: Migration 014.
- **Source**: `backend/scraping/sources/tiktok/scrape_comments.py` (`sb.upsert("tiktok_comments", rows, on_conflict="tiktok_comment_id")`).
- **Columns**:

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `tiktok_comment_id` | text UNIQUE | |
| `video_id` | uuid FK→tiktok_videos | |
| `brand_id` | uuid FK→brands | |
| `commenter_username`, `comment_text`, `reply_to_comment_id` | text×3 | |
| `comment_likes` | int | |
| `posted_at`, `scraped_at` | timestamptz, timestamptz | |
| **Enrichment** | | Same as `ig_comments`; `topics`, `brands_mentioned`, `players_mentioned`, `products_mentioned`, `crisis_keywords` are `text[]` (not jsonb). |

---

### 2.6 Reddit channel

#### `reddit_mentions`
- **Purpose**: Top-level Reddit posts (OPs) that mention a tracked brand.
- **Defined in**: Base schema; enrichment mig 006; velocity columns mig 009; unique constraint mig 004.
- **Source**: `backend/scraping/sources/reddit/scrape_mentions.py` (`sb.upsert("reddit_mentions", rows, "reddit_post_id,brand_id")`).
- **Reader**: `fetchReddit()`, `fetchRedditTrend()`, `fetchTopRedditMentions()`, `fetchRedditSubreddits()`.
- **Row count**: ~321 post-mig-004 dedup; grows weekly. Live count required for current value.
- **Columns** (inferred):

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `reddit_post_id` | text | UNIQUE(reddit_post_id, brand_id). |
| `brand_id` | uuid FK→brands | |
| `subreddit` | text | E.g. `pickleball`, `JOOLA`. |
| `title`, `body`, `url` | text×3 | |
| `score` | int | Upvotes. |
| `num_comments` | int | |
| `author`, `country_code` | text, text | |
| `posted_at` | timestamptz | |
| **Velocity (mig 009)** | | |
| `upvotes_last_scrape` | int | |
| `velocity_per_hour` | numeric | Computed delta / hours-since-prior-scrape. |
| `awards` | jsonb | |
| `is_removed` | bool | True when post is deleted/removed between scrapes. |
| **Enrichment (mig 006)** | | Includes `competitor_switch_from`, `competitor_switch_to` text columns. |

- **Analytical potential**:
  - Crisis early-warning via velocity_per_hour spikes.
  - Defection NER via competitor_switch_from/to → feeds `competitor_switch_events`.

---

#### `reddit_comments`
- **Purpose**: Reply trees under Reddit OPs. Often carries the real buying intent + crisis context.
- **Defined in**: Migration 009.
- **Source**: `backend/scraping/sources/reddit/scrape_comments.py` (`sb.upsert("reddit_comments", rows, "reddit_comment_id")`).
- **Reader**: `fetchTopRedditComments()`.
- **Columns**:

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `parent_post_id` | uuid FK→reddit_mentions | |
| `reddit_comment_id` | text UNIQUE | |
| `brand_id` | uuid FK→brands | |
| `subreddit`, `author`, `comment_text` | text×3 | |
| `upvotes` | int | |
| `depth` | int | Reply depth (0 = top-level reply). |
| `posted_at`, `created_at` | timestamptz, timestamptz | |
| **Enrichment** | | Same as `reddit_mentions` + `competitor_switch_*`. |

---

#### `reddit_mentions_dupe_archive`
- **Purpose**: Safety archive of duplicate rows removed by migration 004 (jsonb dump of full row).
- **Row count**: ~59 (per mig 004 verification block).
- **Columns**: `archived_at timestamptz`, `row_data jsonb`.

---

### 2.7 Influencer cross-channel

#### `influencer_posts`
- **Purpose**: IG posts authored by tracked pro athletes.
- **Defined in**: Base schema; columns added by mig 011 (`sentiment text`, `is_sponsored bool`, `enriched_at`); unique constraint mig 004.
- **Source**: `backend/scraping/sources/instagram/scrape_influencers.py` (`sb.upsert("influencer_posts", posts, "post_url")`).
- **Reader**: `fetchInfluencers()` aggregates engagement.
- **Row count**: ~135 post-mig-004 dedup (327 dupes archived). Live count needed.
- **Columns** (inferred):

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `influencer_id` | uuid FK→influencers | |
| `brand_id` | uuid FK→brands | |
| `post_url` | text UNIQUE | |
| `caption` | text | |
| `like_count`, `comment_count`, `view_count` | int×3 | |
| `posted_at` | timestamptz | |
| `sentiment` | text | mig 011 — note: `text`, not the structured `sentiment_label`. |
| `is_sponsored` | bool | mig 011 — true if `#ad`/`#sponsored`/paid-partnership disclosure. |
| `enriched_at` | timestamptz | |

#### `influencer_posts_dupe_archive`
- **Purpose**: Archive of 327 dupes from mig 004.
- **Columns**: `archived_at`, `row_data jsonb`.

#### `influencer_x_snapshots`
- **Purpose**: Weekly snapshot of athlete X follower / tweet counts.
- **Defined in**: Migration 005.
- **Source**: `backend/scraping/sources/twitter/scrape_influencer_posts.py`.
- **Columns**: `id`, `influencer_id`, `brand_id`, `handle`, `followers`, `following`, `tweet_count`, `is_verified`, `week_number`, `year`, `scraped_at`. UNIQUE(influencer_id, week_number, year).

#### `influencer_x_posts`
- **Purpose**: Per-athlete tweets with enrichment.
- **Defined in**: Migration 005; enrichment added conditionally by mig 006.
- **Source**: `scrape_influencer_posts.py` (`sb.upsert("influencer_x_posts", rows, "tweet_id")`).
- **Columns**: As `x_posts` but `influencer_id` FK; enrichment subset (no `crisis_keywords`).

---

### 2.8 Cross-channel facts (mention layer)

#### `mention_facts`
- **Purpose**: One row per enriched channel mention. The fact table that EVERY cross-channel dashboard joins to.
- **Defined in**: Migration 007.
- **Source**: `backend/scraping/facts/mention_facts.py` (populated from every enriched channel table).
- **Reader**: `fetchIGCommentMentions()` (paddle/player pivot); cross-channel pages.
- **Columns**:

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `channel` | text NOT NULL | `reddit` / `ig_comment` / `yt_comment` / `x` / `tiktok` / `x_influencer`. |
| `source_table` | text NOT NULL | Origin table name. |
| `source_id` | uuid NOT NULL | Origin row id. |
| `brand_id` | uuid FK→brands | Brand referenced in the mention. |
| `product_id` | uuid FK→products_catalog | Paddle if recognized. |
| `athlete_id` | uuid FK→influencers | Athlete if recognized. |
| `sentiment_score`, `sentiment_label` | numeric, text | |
| `is_crisis`, `is_opportunity`, `is_purchase_intent`, `is_competitor_switch` | bool×4 | |
| `country_code` | text | |
| `text_snippet` | text | First N chars for tooltip use. |
| `posted_at`, `created_at` | timestamptz×2 | |

UNIQUE(channel, source_id, brand_id, COALESCE(product_id, nil-uuid)).

- **Analytical potential**: Single source of truth for cross-channel SoV, sentiment, intent funnel.

#### `competitor_switch_events`
- **Purpose**: Defection signals — user says "I switched from X to Y".
- **Defined in**: Migration 007.
- **Source**: `backend/scraping/facts/competitor_switch.py`.
- **Columns**: `id`, `mention_id` FK→mention_facts, `from_brand_id`, `to_brand_id`, `confidence numeric`, `text_snippet`, `posted_at`, `created_at`.

#### `topic_lifecycle`
- **Purpose**: Track which topics emerge, peak, decay; which channel first carried them.
- **Defined in**: Migration 007.
- **Source**: `backend/scraping/facts/topic_lifecycle.py`.
- **Columns**: `id`, `topic_slug UNIQUE`, `display_label`, `first_seen_at`, `first_seen_channel`, `peak_at`, `peak_mentions_24h`, `decayed_at`, `total_mentions`, `channels_touched text[]`, `is_crisis bool`, `created_at`.

#### `instagram_themes`
- **Purpose**: Per-brand dominant IG content theme (computed weekly).
- **Defined in**: Not in migrations — created by `backend/scraping/facts/instagram_themes.py`.
- **Source**: `instagram_themes.py`. Writes `ig_profiles_weekly.dominant_content_theme` too.
- **Columns**: TBD — verify live; populated by analysis of last 30 IG posts per (brand, week).

---

### 2.9 Product intelligence (mention + attention rollups)

#### `product_mentions`
- **Purpose**: Unified per-channel product mention store. One row per (source_row × matched product).
- **Defined in**: Migration 012.
- **Source**: `backend/scraping/facts/populate_product_mentions.py`.
- **Columns**:

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `product_id` | uuid FK→products_catalog | |
| `brand_id` | uuid FK→brands | |
| `source_table`, `source_row_id` | text, uuid | UNIQUE(source_table, source_row_id, product_id). |
| `channel` | text | `instagram`/`youtube`/`reddit`/`tiktok`/`twitter`/`influencer`/`ads`/`promotions`/`news`. |
| `matched_alias`, `matched_alias_norm` | text×2 | |
| `match_confidence` | numeric(3,2) | |
| `is_jl_brand` | bool GENERATED | Computed from JOOLA brand_id. |
| `sentiment_label`, `sentiment_score` | text, numeric | Denormalized. |
| `is_purchase_intent`, `is_crisis` | bool×2 | |
| `engagement_score` | numeric(12,2) | Channel weight × engagement metric. |
| `raw_engagement` | jsonb | `{likes, views, upvotes, …}` audit trail. |
| `occurred_at`, `occurred_date` | timestamptz, date GENERATED (UTC) | |
| `created_at` | timestamptz | |

#### `product_attention_daily`
- **Purpose**: Daily rollup per (product, date) with weighted attention.
- **Defined in**: Migration 012.
- **Source**: `backend/scraping/facts/populate_product_attention.py`.
- **Columns**:

| Column | Type | Description |
|---|---|---|
| `id`, `product_id`, `brand_id`, `attention_date` | uuid, uuid, uuid, date | UNIQUE(product_id, attention_date). |
| `mentions_total` | int | |
| `mentions_instagram` `mentions_youtube` `mentions_reddit` `mentions_tiktok` `mentions_twitter` `mentions_influencer` `mentions_ads` `mentions_promotions` `mentions_news` | int×9 | Per-channel breakdown. |
| `attention_score` | numeric(14,2) | Channel-weighted aggregate. |
| `positive_mentions`, `neutral_mentions`, `negative_mentions` | int×3 | |
| `purchase_intent_count`, `crisis_mentions` | int×2 | |
| `sales_likelihood_score` | numeric(6,3) | 0..100 — modelled, NOT confirmed sales. |
| `sales_likelihood_inputs` | jsonb | Audit. |
| `created_at`, `updated_at` | timestamptz×2 | |

#### `product_attention_summary`
- **Purpose**: Period buckets (`last_7d` / `last_30d` / `last_90d` / `all_time`) for dashboard cards.
- **Defined in**: Migration 012.
- **Columns**: `id`, `product_id`, `brand_id`, `period text`, `period_start date`, `period_end date NOT NULL`, `mentions_total`, `attention_score`, `positive_mentions`, `negative_mentions`, `purchase_intent_count`, `crisis_mentions`, `sales_likelihood_score`, `rank_in_brand`, `rank_overall`, `joola_vs_competitor_gap numeric(14,2)`, `computed_at`. UNIQUE(product_id, period).

#### `product_attention_sales_correlation`
- **Purpose**: Pearson r of attention vs sales over a window, with best-fit lag. **DEFERRED** — schema only; population waits on 60+ days of sales_facts_daily.
- **Defined in**: Migration 012.
- **Columns**: `id`, `product_id`, `brand_id`, `window_start`, `window_end`, `attention_score_sum`, `estimated_units_sold_sum`, `correlation_coefficient numeric(5,4)`, `lag_days`, `confidence_score`, `computed_at`. UNIQUE(product_id, window_start, window_end).
- **Status**: Zero rows.

#### `product_reviews`
- **Purpose**: Customer review prose from brand product pages (Bazaarvoice / Judge.me / Okendo / Yotpo / SPR). Unlocks per-paddle sentiment + topic NER.
- **Defined in**: Migration 016 (2026-05-25). Legacy stub dropped+recreated.
- **Source**: `backend/scraping/sources/products/scrape_reviews.py` (`sb.upsert("product_reviews", all_rows, on_conflict="source_review_id")`).
- **Status**: Empty pending review-widget credentials.
- **Columns**: `id`, `brand_id`, `product_id` FK→products_catalog, `source_review_id UNIQUE`, `review_widget text`, `reviewer_name`, `review_title`, `review_text`, `rating numeric`, `helpful_count int`, `posted_at`, `scraped_at`. Plus full enrichment set (same as `tiktok_comments`).

---

### 2.10 Sales intelligence (Particl-style inventory tracking)

All defined in **Migration 010**.

#### `product_variants`
- **Purpose**: SKU-level granularity (color, size, thickness, weight, price). 1 paddle → many variants.
- **Source**: `backend/scraping/sales_intelligence/discover.py`.
- **Columns**: `id`, `brand_id`, `product_id` FK→products_catalog (nullable on delete), `external_variant_id`, `sku`, `upc`, `variant_title`, `color`, `size`, `thickness`, `weight`, `price numeric(10,2)`, `compare_at_price`, `currency`, `availability_status` (in_stock/out_of_stock/limited/unknown), `first_seen_at`, `last_seen_at`, `created_at`, `updated_at`. UNIQUE(brand_id, external_variant_id).

#### `product_snapshots`
- **Purpose**: Point-in-time inventory readings.
- **Source**: `backend/scraping/sales_intelligence/scrape_inventory.py`.
- **Columns**: `id`, `brand_id`, `product_id`, `variant_id` FK→product_variants, `snapshot_time`, `product_url NOT NULL`, `price`, `compare_at_price`, `currency`, `discount_percent`, `availability_status`, `visible_inventory_qty`, `estimated_inventory_qty`, `inventory_confidence` (high/medium/low), `inventory_signal_type` (json_ld / shopify_json / cart_signal / html_text), `stock_message text`, `raw_payload jsonb`, `created_at`.

#### `inventory_events`
- **Purpose**: Delta stream — sales, restocks, adjustments, sellouts.
- **Source**: `backend/scraping/sales_intelligence/restock.py`, `sellout.py`.
- **Columns**: `id`, `brand_id`, `product_id`, `variant_id`, `event_time`, `event_type` (sale/restock/adjustment/sellout/reappearance), `previous_qty`, `current_qty`, `delta_qty`, `confidence_score numeric(3,2)`, `reason_code`, `created_at`.

#### `sales_estimates`
- **Purpose**: Daily estimated units sold computed from inventory deltas.
- **Source**: `backend/scraping/sales_intelligence/estimate.py`, `revenue.py`.
- **Columns**: `id`, `brand_id`, `product_id`, `variant_id`, `estimate_date date NOT NULL`, `estimated_units_sold`, `estimated_revenue`, `currency`, `price_used`, `confidence_score`, `inventory_start`, `inventory_end`, `restock_qty`, `adjustment_qty`, `estimation_method` (inventory_delta / velocity_model / hybrid), `notes`, `created_at`. UNIQUE(brand_id, variant_id, estimate_date).

#### `promotion_sales_impact`
- **Purpose**: Correlate promotions → sales lift.
- **Columns**: `id`, `brand_id`, `promotion_id` FK→promotions, `product_id`, `variant_id`, `campaign_start`, `campaign_end`, `baseline_sales_velocity`, `promo_sales_velocity`, `estimated_lift_percent`, `estimated_lift_units`, `estimated_lift_revenue`, `confidence_score`, `created_at`.

#### `sales_facts_daily`
- **Purpose**: Denormalized daily roll-up for dashboard reads.
- **Columns**: `id`, `brand_id`, `date NOT NULL`, `category` (control / power / composite), `product_id`, `variant_id`, `estimated_units_sold`, `estimated_revenue`, `avg_price`, `discount_percent`, `stockout_flag bool`, `restock_flag bool`, `promotion_flag bool`, `confidence_score`, `created_at`. UNIQUE(brand_id, date, variant_id).

#### `product_price_history`
- **Purpose**: Price/inventory snapshots captured each scrape run (predates mig 010 — simpler structure).
- **Defined in**: Migration 001.
- **Source**: `scrape_catalog.py` (writes alongside `products` upsert).
- **Reader**: `price_daily` mart reads from here.
- **Columns**: `id`, `product_id` FK→products, `brand_id`, `captured_at`, `price_usd numeric(10,2)`, `sale_price_usd`, `discount_pct`, `in_stock bool`, `stock_count int`.

---

### 2.11 Marketing & promotions

#### `marketing_ads`
- **Purpose**: Active Meta + Google Ads creatives per brand.
- **Defined in**: Migration 001.
- **Source**: `backend/scraping/sources/ads/scrape_meta_ads.py` + `scrape_google_ads.py` (both upsert on `platform,ad_id`).
- **Reader**: `fetchAds()`, `fetchAdSample()`.
- **Columns**: `id`, `brand_id`, `platform text NOT NULL` (`meta`/`google`), `ad_id text`, `page_name`, `body`, `cta`, `creative_url`, `landing_url`, `started_at timestamptz`, `is_active bool default true`, `raw jsonb`, `captured_at`. UNIQUE(platform, ad_id).

#### `promotions`
- **Purpose**: Brand-homepage banner promotions.
- **Defined in**: Migration 001.
- **Source**: `backend/scraping/sources/products/scrape_promotions.py` (upsert on `brand_id,banner_text`).
- **Reader**: `fetchPromos()`, `fetchPromoDetails()`.
- **Columns**: `id`, `brand_id`, `banner_text NOT NULL`, `promo_type` (sitewide/category/product/flash/seasonal), `discount_pct numeric(5,2)`, `source_url`, `detected_at timestamptz`.
- **Known gap**: No `start_date`/`end_date` — `promotion_daily` mart has to infer windows from `detected_at` only (per session memory 3394, this column never landed despite spec).

---

#### `brand_replies`
- **Purpose**: Tracks when brands (esp. JOOLA) reply to user comments/posts. Surface response-time and joola_responded coverage.
- **Defined in**: Migration 011.
- **Source**: `backend/scraping/sources/instagram/detect_brand_replies.py` (upsert on `source_table,source_row_id`). Not in default weekly scheduler.
- **Columns**: `id`, `replying_brand_id`, `source_table` (`ig_comments`/`yt_comments`/`reddit_comments`), `source_row_id`, `original_text`, `reply_text`, `replied_at`, `response_time_mins int`, `joola_responded bool`, `sentiment`, `created_at`. UNIQUE(source_table, source_row_id).

---

### 2.12 Analytics foundation (Scope B MVP)

All defined in **Migration 013** (refreshed daily via `scripts/analytics_backend/marts/refresh_helpers.py`).

#### `ad_pressure_daily`
- **Purpose**: Daily rolling proxy for unobservable ad spend.
- **Columns**: `metric_date date NOT NULL`, `brand_id NOT NULL`, `active_creatives int`, `new_creatives int`, `platform_count int`, `ad_pressure_score numeric(6,2)`, `source_run_ok bool`, `computed_at`. PK(metric_date, brand_id).

#### `promotion_daily`
- **Purpose**: One row per (brand × product × day) when a promo is in flight.
- **Columns**: `metric_date`, `brand_id NOT NULL`, `product_id NULL`, `promo_active_flag smallint`, `promo_depth_pct numeric(5,2)`, `promo_count int`, `source_run_ok bool`, `computed_at`. PK(metric_date, brand_id, product_id).

#### `price_daily`
- **Purpose**: Last-known daily price + 90d rolling index.
- **Columns**: `metric_date`, `product_id NOT NULL`, `price_usd numeric(10,2)`, `price_index_90d numeric(6,3)` (price ÷ trailing 90d baseline), `source_run_ok`, `computed_at`. PK(metric_date, product_id).

#### `availability_daily`
- **Purpose**: Daily in-stock ratio per (brand × product).
- **Columns**: `metric_date`, `brand_id NOT NULL`, `product_id NULL`, `in_stock_count int`, `total_variants int`, `availability_index numeric(5,4)` (in_stock ÷ total), `source_run_ok`, `computed_at`. PK(metric_date, brand_id, product_id).

#### `dim_brand_calendar` (materialized view)
- **Purpose**: Dense (brand × day) spine from 2025-01-01 → today, in each brand's local timezone. Every downstream mart left-joins to this so empty days still appear.
- **Refresh**: REFRESH MATERIALIZED VIEW after timezone changes.

#### `joola_timeseries_daily` (materialized view)
- **Purpose**: Unified daily mart — one row per (brand × day × product). Joins attention + ad_pressure + promo + price + availability + sales_estimates.
- **Refresh**: `REFRESH MATERIALIZED VIEW CONCURRENTLY joola_timeseries_daily;` after helper marts populate.
- **Aliased column**: `att.product_id AS canonical_product_id` so downstream code matches the spec vocabulary.

#### `joola_timeseries_weekly` (materialized view)
- **Purpose**: ISO-week rollup of `joola_timeseries_daily`.

#### `analysis_results`
- **Purpose**: One row per (kind × brand × product × driver × target × date) statistical result. Read by `/v2/correlations`, `/v2/changepoints`, `/v2/leaderboard`.
- **Source**: `scripts/analytics_backend/statistics/*.py`.
- **Columns**: `id`, `kind text NOT NULL` (lag_scan/ccf/granger/changepoint/stl), `brand_id NOT NULL`, `product_id NULL`, `driver text` (e.g. `attention_score`), `target text` (e.g. `estimated_units_sold`), `metric_date date NOT NULL`, `payload jsonb NOT NULL`, `n_samples int`, `best_lag int`, `best_score numeric`, `best_pvalue numeric`, `computed_at`. UNIQUE(kind, brand_id, product_id, driver, target, metric_date).

---

### 2.13 SEO sub-project (paused)

#### `keyword_research_results` (mig 002a)
- One row per agent run. JSON payload of full keyword cluster. `seed`, `seed_type`, `generated_at`, `total_keywords`, `total_volume`, `avg_difficulty`, `cluster_count`, `result_json jsonb`.

#### `keyword_rankings` (mig 002b)
- SERP rank tracking. `brand_id`, `keyword NOT NULL`, `position`, `url`, `search_volume`, `difficulty`, `recorded_at`. Reader: `fetchKeywordRankings()`.

#### `crawl_pages` (mig 002b)
- Per-page crawl results. `brand_id`, `url NOT NULL`, `http_status`, `on_page_score`, `word_count`, `has_title bool`, `has_meta_desc bool`, `has_h1 bool`, `issues jsonb`, `crawl_date date`, `crawled_at`. Reader: `fetchCrawlSummary()`, `fetchOnPageScoreTrend()`.

#### `content_briefs` (mig 002b)
- Content pipeline state. `brand_id`, `keyword NOT NULL`, `target_url`, `status text default 'pending'` (pending/drafted/published/cancelled), `created_at`, `completed_at`. Reader: `fetchContentBriefStats()`.

---

### 2.14 Misc / archives

- `products_dupe_archive` — Migration 008 archive (jsonb dump of duplicates).
- `news_articles` — Created by `backend/scraping/sources/news/scrape_news.py` (upsert on `url`). Schema not in migrations — verify live. Designed to be enriched and feed `mention_facts` with channel `news`.

---

## Section 3 — Cross-table relationships

### ER diagram (ASCII)

```
                                  ┌─────────┐
                       ┌─────────►│ brands  │◄─────────────────────────────┐
                       │          │ slug PK │                              │
                       │          └────┬────┘                              │
                       │               │                                   │
        ┌──────────────┴────┐    ┌─────┴─────────┐         ┌──────────────┴──┐
        │ influencers       │    │ ig_accounts*  │         │ products_catalog │
        │ (27 athletes)     │    │ yt_channels*  │         │ (~85 paddles)   │
        │ instagram_handle  │    │ x_accounts    │         │ aliases[]       │
        │ x_handle          │    │ tiktok_accts  │         └────┬────────┬────┘
        └────┬────────┬─────┘    └───────┬───────┘              │        │
             │        │                  │                       │        │
             │        ▼                  ▼                       ▼        │
             │  ┌────────────┐    ┌──────────────┐   ┌─────────────────┐ │
             │  │influencer_ │    │ ig_posts     │   │ product_aliases │ │
             │  │posts       │    │ yt_videos    │   │ product_variants│ │
             │  │influencer_ │    │ x_posts      │   │ product_snapshots│ │
             │  │x_posts     │    │ tiktok_videos│   └────────┬────────┘ │
             │  └────────────┘    └──────┬───────┘            │          │
             │                            │                    ▼          │
             │                    ┌──────▼────────┐   ┌─────────────────┐ │
             │                    │ ig_comments   │   │ inventory_events│ │
             │                    │ yt_comments   │   │ sales_estimates │ │
             │                    │ tiktok_       │   │ sales_facts_    │ │
             │                    │  comments     │   │  daily          │ │
             │                    └──────┬────────┘   └─────────────────┘ │
             │                            │                                │
             ▼                            ▼                                ▼
     ┌──────────────────────────────────────────────────────────────────────┐
     │  reddit_mentions ──► reddit_comments                                 │
     │  yt_video_transcripts ──► yt_video_analysis                          │
     │                                                                      │
     │  ENRICHMENT LAYER (ai_enricher.py)                                   │
     │      ↓                                                               │
     │  mention_facts ◄─── populated from every enriched channel table     │
     │      │                                                               │
     │      ├──► competitor_switch_events                                  │
     │      └──► topic_lifecycle                                            │
     │                                                                      │
     │  product_mentions ◄── populate_product_mentions.py                  │
     │      ↓                                                               │
     │  product_attention_daily ──► product_attention_summary               │
     │                                                                      │
     │  ANALYTICS FOUNDATION (mig 013)                                      │
     │  ad_pressure_daily + promotion_daily + price_daily + availability_   │
     │      ↓                                                               │
     │  dim_brand_calendar ⨯ JOIN → joola_timeseries_daily (MV)            │
     │      ↓                                                               │
     │  joola_timeseries_weekly (MV)                                        │
     │                                                                      │
     │  analysis_results ◄── scripts/analytics_backend/statistics/*         │
     └──────────────────────────────────────────────────────────────────────┘

* ig_accounts and yt_channels are inferred from scraper code; schema lives in
  Supabase but not in local migrations.
```

### Foreign-key map

| Child | FK column | Parent |
|---|---|---|
| `influencers` | `brand_id` | `brands` |
| `products`, `products_catalog`, `product_aliases`, `product_mentions`, `product_attention_*`, `product_variants`, `product_snapshots`, `inventory_events`, `sales_estimates`, `promotion_sales_impact`, `sales_facts_daily`, `marketing_ads`, `promotions`, `product_price_history`, `ig_*`, `yt_*`, `x_*`, `tiktok_*`, `reddit_*`, `influencer_*`, `mention_facts`, `competitor_switch_events`, `brand_replies`, `ad_pressure_daily`, `promotion_daily`, `availability_daily`, `analysis_results` | `brand_id` | `brands` |
| `ig_posts`, `ig_comments` | `post_id` (comments→posts) | `ig_posts` |
| `yt_videos`, `yt_comments`, `yt_video_transcripts`, `yt_video_analysis` | `video_id` | `yt_videos` |
| `tiktok_videos`, `tiktok_comments` | `video_id` | `tiktok_videos` |
| `reddit_comments` | `parent_post_id` | `reddit_mentions` |
| `x_posts`, `x_profiles_weekly` | `account_id` | `x_accounts` |
| `tiktok_videos`, `tiktok_profiles_weekly` | `account_id` | `tiktok_accounts` |
| `influencer_posts`, `influencer_x_posts`, `influencer_x_snapshots` | `influencer_id` | `influencers` |
| `mention_facts.athlete_id` | `athlete_id` | `influencers` |
| `mention_facts.product_id`, `product_mentions.product_id`, `product_aliases.product_id`, `product_attention_*.product_id`, `product_variants.product_id`, `product_snapshots.product_id`, `inventory_events.product_id`, `sales_estimates.product_id`, `promotion_sales_impact.product_id`, `sales_facts_daily.product_id`, `promotion_daily.product_id`, `price_daily.product_id`, `availability_daily.product_id`, `analysis_results.product_id`, `product_reviews.product_id` | `product_id` | `products_catalog` |
| `competitor_switch_events.mention_id` | `mention_id` | `mention_facts` |
| `competitor_switch_events.from_brand_id`/`to_brand_id` | brand FKs | `brands` |
| `product_snapshots.variant_id`, `inventory_events.variant_id`, `sales_estimates.variant_id`, `promotion_sales_impact.variant_id`, `sales_facts_daily.variant_id` | `variant_id` | `product_variants` |
| `yt_video_analysis.transcript_id` | `transcript_id` | `yt_video_transcripts` |
| `promotion_sales_impact.promotion_id` | `promotion_id` | `promotions` |

### Common JOIN patterns (from frontend + backend)

1. **Brand-anchored social rollup**:
   `<channel_table>` JOIN `brands` ON brand_id, GROUP BY brand.slug.

2. **Cross-channel SoV** (used by `/v2`):
   `mention_facts` GROUP BY (`brand_id`, `channel`) over `posted_at`.

3. **Paddle attention**:
   `product_attention_daily` JOIN `products_catalog` ON product_id JOIN `brands`.

4. **Subreddit context guard** (custom — see `redditRowPassesBrandContext` in data.ts:272): for `gamma`/`head` brands only count rows whose `subreddit+title+body` contains a pickleball token.

5. **Influencer engagement**:
   `influencer_posts` JOIN `influencers`; ER computed in TS (avg(likes+comments)/followers).

6. **Mention-to-source resolution** (used by `mention_facts`):
   Look up `source_table` + `source_id` to retrieve raw row for tooltip drill-down.

---

## Section 4 — Available metrics dictionary

| Metric | Definition / formula | Source tables | Update cadence | Known limitations |
|---|---|---|---|---|
| **Followers / subs** | Latest snapshot in `*_profiles_weekly` / `yt_channel_weekly`. | `ig_profiles_weekly`, `yt_channel_weekly`, `x_profiles_weekly`, `tiktok_profiles_weekly`, `influencer_x_snapshots` | Weekly | One snapshot per ISO week; intra-week deltas not tracked. |
| **Engagement rate (ER)** | `avg(like + comment per post) / followers × 100` capped at 100%. | `ig_posts`, `influencer_posts`, `x_posts`, `tiktok_videos` | Weekly | Tiny-follower accounts (<50) produce implausible ER — frontend filters them out. |
| **Share of voice (SoV)** | `brand_X_ads / SUM(all brand ads)` recomputed dynamically from current filter set. | `marketing_ads` | Weekly | DB `share` field is global — `data.ts` always recomputes when a brand filter is active. |
| **Sentiment label** | LLM-assigned `positive`/`neutral`/`negative`; numeric score in [-1, +1]. | All enriched comment/post tables; `mention_facts.sentiment_label` for cross-channel rollup. | Per-enrichment-run (~weekly). | LLM accuracy limits; some brands (gamma/head) require context guards before counting. |
| **Crisis count** | `count(*) WHERE is_crisis = true`. | Any enriched table; `mention_facts`, `topic_lifecycle.is_crisis`. | Per enrichment. | False positives from sarcasm — `crisis_keywords` array helps drill in. |
| **Purchase intent count** | `count(*) WHERE is_purchase_intent = true OR purchase_intent_score >= threshold`. | Enriched comments/posts; `mention_facts.is_purchase_intent`. | Per enrichment. | Score threshold not formally fixed. |
| **Competitor switch / defection** | One row per detected switch in `competitor_switch_events`, with `from→to` brand + confidence. | `competitor_switch_events`. | Per enrichment. | Confidence is LLM-side, not validated. |
| **Topic lifecycle** | First-seen channel + decay window per topic. | `topic_lifecycle`. | Per enrichment. | Topic deduplication is by `topic_slug` only. |
| **Velocity / virality (Reddit)** | `(current_upvotes - upvotes_last_scrape) / hours_since_prior_scrape`. | `reddit_mentions.velocity_per_hour`. | Per scrape run. | Needs at least 2 scrapes to compute. |
| **Attention score** | Channel-weighted sum of per-mention engagement_score. | `product_mentions.engagement_score` → `product_attention_daily.attention_score`. | Daily roll-up. | Channel weights live in `populate_product_attention.py`. |
| **Sales likelihood score** | 0..100 modelled from purchase_intent + attention. | `product_attention_daily.sales_likelihood_score`. | Daily roll-up. | NOT confirmed sales — see `sales_facts_daily` for the inventory-derived units sold. |
| **Estimated units sold** | Inventory-delta-derived; one row per (variant × day). | `sales_estimates` → `sales_facts_daily`. | Daily roll-up. | Depends on Shopify/SPR JSON-LD visibility; coverage is brand-dependent (JOOLA, Six-Zero, Onix, Franklin, HEAD confirmed). |
| **Ad pressure score** | Proxy for unobservable ad spend: f(active_creatives, new_creatives, platform_count). | `marketing_ads` → `ad_pressure_daily`. | Daily mart refresh. | Not real spend — pressure proxy only. |
| **Promotion pressure** | `promo_active_flag` × `promo_depth_pct`. | `promotions` → `promotion_daily`. | Daily mart refresh. | `promotions` table lacks `start_date`/`end_date` so windows are inferred from `detected_at`. |
| **Price index 90d** | `price ÷ trailing-90d baseline` per product. | `product_price_history` → `price_daily.price_index_90d`. | Daily mart. | Needs 90 days of history to mean anything. |
| **Availability index** | `in_stock_count / total_variants`. | `product_snapshots` → `availability_daily`. | Daily mart. | Depends on variant discovery coverage. |
| **Product gap** | JOOLA top score - competitor score within period. | `product_attention_summary.joola_vs_competitor_gap`. | Period rollup. | NULL for JOOLA rows by design. |
| **Statistical correlation / lag / changepoint** | Pearson r / CCF / Granger / STL / changepoint output as jsonb payload. | `analysis_results`. | On demand via analytics_backend scripts. | Bound to days where both driver + target have data. |

---

## Section 5 — Analytical opportunities

Each question maps to specific table(s) the user can hand off as a concrete ask.

### Product intelligence

1. **Which JOOLA paddle is gaining attention fastest?** → `product_attention_daily` JOIN `products_catalog`, GROUP BY product, ORDER BY `attention_score` Δ week-over-week DESC.
2. **Which competitor product is most-mentioned but missing from `products_catalog`?** → Mine `products_mentioned text[]` arrays in `ig_comments` / `reddit_mentions` / `tiktok_videos` and antijoin against `product_aliases.alias_norm`. Drives next migration's expansion.
3. **Which products have the highest review-to-mention ratio?** → `product_reviews` count vs `product_attention_summary.mentions_total` per product (once mig 016 ingestion runs).
4. **Where is JOOLA losing share within the catalog?** → `product_attention_summary.rank_in_brand` over time; flag products that fell ≥3 positions.
5. **Which paddle launches generated the most pre/post buzz?** → JOIN `products_catalog.launched_at` to `product_attention_daily` ±14d window.
6. **Which paddle has the highest purchase-intent rate?** → `product_attention_summary.purchase_intent_count ÷ mentions_total`.
7. **Per-channel attention split per product** — which paddles win on Reddit vs IG? → `product_attention_daily.mentions_{instagram,youtube,reddit,tiktok,twitter,…}`.
8. **YouTube "performance thesis" for top videos** — content patterns that drive engagement. → `yt_video_analysis.performance_thesis`, `performance_signals` GROUP BY thesis tag.

### Community intelligence

9. **Which subreddit drives the most JOOLA mentions?** → `reddit_mentions` GROUP BY subreddit WHERE brand=JOOLA.
10. **Crisis signal trend over last 90 days** — counts + topics. → `topic_lifecycle WHERE is_crisis=true`, ORDER BY `peak_mentions_24h DESC`.
11. **Which Reddit threads went viral fastest?** → `reddit_mentions.velocity_per_hour` top N.
12. **Reply-tree intent vs OP intent gap** — does the parent post sentiment match its replies? → JOIN `reddit_mentions ↔ reddit_comments` by `parent_post_id`, diff sentiment_score.
13. **Which removed Reddit posts mentioned a JOOLA paddle?** — moderation / censorship watch. → `reddit_mentions WHERE is_removed=true AND brand_id=JOOLA`.
14. **Crisis ↔ first-channel attribution** — does crisis usually start on Reddit, TikTok, or IG? → `topic_lifecycle.first_seen_channel` WHERE `is_crisis=true`.
15. **Which TikTok comment threads are negative on a specific paddle?** → `tiktok_comments` WHERE `products_mentioned @> ARRAY['Perseus']` AND `sentiment_label='negative'`.

### Influencer intelligence

16. **Which sponsored athlete generates the most cross-platform mentions?** → `mention_facts WHERE athlete_id IS NOT NULL` GROUP BY athlete_id, channel.
17. **Sponsored vs organic post ER for athletes** → `influencer_posts WHERE is_sponsored=true` vs `false`.
18. **Athlete X follower growth WoW** → `influencer_x_snapshots` LAG.
19. **Athletes whose posts most often mention a competitor paddle** (defection risk) → `mention_facts WHERE source_table='influencer_posts' AND brand_id != athlete.brand_id`.
20. **Which athletes' content most often goes viral on YT** (via comments referencing athlete name) → `yt_video_analysis.players_mentioned`.

### Competitive intelligence

21. **Which brand has the highest YoY follower growth?** → Compare current `*_profiles_weekly.followers` to 52-week-prior snapshot.
22. **Which competitor's ad volume is rising fastest?** → `ad_pressure_daily.new_creatives` per brand, rolling slope.
23. **Defection net score: into vs out of each brand** → `competitor_switch_events` GROUP BY (`to_brand_id` - `from_brand_id`).
24. **Brand-reply latency** — how fast does each brand respond to complaints? → `brand_replies.response_time_mins` per `replying_brand_id`.
25. **Topic spread time** — channels-touched per topic, time from first_seen to peak. → `topic_lifecycle`.
26. **Brand homepage promo cadence** — who runs flash sales most often? → `promotions` GROUP BY brand, promo_type='flash'.
27. **Crisis comparison across brands** — `is_crisis=true` counts per brand normalized by mention volume.
28. **Which brand is best at "evergreen" vs "trending" content?** → YT video views distribution per brand from `yt_videos` (variance of view_count).

### Sales / inventory

29. **Which products go out of stock most often?** → `inventory_events WHERE event_type='sellout'` GROUP BY variant_id.
30. **Which paddle has the highest discount frequency?** → `promotion_daily` GROUP BY product_id, count(promo_active_flag).
31. **Restock cadence per brand** — how fast does each brand replenish? → `inventory_events WHERE event_type='restock'`.
32. **Estimated revenue per brand last 30d** → `sales_facts_daily` GROUP BY brand_id over a 30d window.
33. **Sales lift from a specific promotion** → `promotion_sales_impact.estimated_lift_units` per promotion_id.
34. **Price elasticity proxy** — units sold vs `price_daily.price_index_90d`. → JOIN `sales_facts_daily ↔ price_daily`.
35. **Variant-level sellout cluster** — which colors/sizes sell out first? → `inventory_events` JOIN `product_variants` GROUP BY color, size.

### Cross-channel

36. **Which paddles get talked about on Reddit but not TikTok?** → `mention_facts` antijoin per channel.
37. **Topic spread: how fast does a meme travel from IG → Reddit → YT?** → `topic_lifecycle.channels_touched` + time diff.
38. **Attention vs sales correlation** — best-fit lag from `analysis_results.kind='lag_scan'`.
39. **Which channels predict which outcomes?** — `analysis_results.kind='granger'` p-values per (driver, target).
40. **Changepoint detection on JOOLA attention** — `analysis_results.kind='changepoint'`.

### Operational

41. **Pipeline freshness audit** — most recent `scraped_at` / `enriched_at` per table; flag any table > N days stale.
42. **Enrichment coverage** — `count(*) WHERE enriched_at IS NULL` per enriched table; alert when coverage drops below ~95%.
43. **Apify actor failure attribution** — historical row deltas per scraper to spot consistent yields of zero (e.g. broken Apify actor schema).
44. **Brand handle health** — `count(*)` per `*_profiles_weekly` per brand vs expected (12 weeks of snapshots).

---

## Section 6 — Data gaps + recommended fixes

| Gap | Impact | Recommended fix |
|---|---|---|
| **`product_reviews` empty** | Per-paddle review prose unavailable for sentiment / topic mining despite migration 016 being live. | Acquire Bazaarvoice / Judge.me / Okendo / Yotpo / SPR widget access; populate via `scrape_reviews.py`. |
| **Sales transactions inferred only** | No first-party sales feed. `sales_facts_daily` is delta-from-inventory only. | Direct-API integration with at least JOOLA Shopify admin would be the cleanest unblock. |
| **No brand website traffic data** | Cannot compare social→site conversion. | Add SimilarWeb API or owned-Google-Analytics ingestion for JOOLA. |
| **No Google Trends ingestion** | Cannot measure "search demand" per paddle/brand. | Add `pytrends`-backed daily scraper into a new `search_demand_daily` table. |
| **No tournament / pro ranking feed** | Cannot answer "is this paddle winning?" or "does PPA rank correlate with mentions?". | Scrape PPA Tour + MLP pages weekly into a new `tournament_results` table. |
| **`promotions` lacks `start_date`/`end_date`** | `promotion_daily` mart infers windows from `detected_at`, so a promo banner that ran on day 1 but was scraped on day 5 has 4 missing days. | Either schedule daily promo scrapes or add explicit date parsing from banner text + LLM extraction. |
| **Competitor pricing history sparse** | `price_daily` coverage is brand-dependent. | Extend `scrape_catalog_local.py` (stealth Playwright) to remaining brands (Engage, Wilson, Gamma, Paddletek, CRBN). |
| **No structured Shipping/Lead-time data** | Cannot detect supply-chain stress. | Scrape product-page "Ships in X days" text into `product_snapshots.stock_message` (already a column — populate it). |
| **No customer service / support data** | Sentiment around CS is buried in comments. | Add a tag layer to `ig_comments` / `reddit_comments` for `is_support_complaint` flag in the enricher. |
| **Newsletter / email cadence not tracked** | Marketing pressure incomplete. | Add email-newsletter scraping (e.g. via Milled / Really Good Emails) into a new `email_campaigns` table. |
| **TikTok comment NER on `text[]` arrays** | Hard to JOIN. Other tables use `jsonb` for `topics`. | Standardize on `text[]` or `jsonb`; either way add `mention_facts` population from `tiktok_comments` (already done in mig 014 plan — verify live). |
| **`yt_channels` schema not in migrations** | Recovery doc explicitly TODO. | Snapshot live schema into a new migration. |
| **`news_articles` schema not in migrations** | Same. | Snapshot live schema. |
| **`instagram_themes` source-of-truth split** | `dominant_content_theme` lives on `ig_profiles_weekly` AND in a separate `instagram_themes` aggregator. | Pick one source; if both, document the contract. |
| **`avg_rating` / `review_count` on `products`** | Scraped + selected by frontend lib but never rendered. | Either surface them in `/v2/products` (recommended — most useful product-level signal we already have) or remove from the select. |
| **No retention / row-aging job** | Old data accumulates forever in Supabase. | Add a maintenance job to roll up + delete `*_comments` / `reddit_mentions` older than 12 months once their `mention_facts` rows are persisted. |
| **`product_attention_sales_correlation` deferred** | The headline metric "Does attention drive sales?" is unanswered. | Once `sales_facts_daily` has 60 days of coverage, run `backend/scraping/sales_intelligence/correlation.py` to populate. |
| **`NEXT_PUBLIC_OPENAI_KEY` leaks to browser** | Security gap (POC-acceptable). | Rename to server-only `OPENAI_API_KEY` in `app/api/generate-content/route.ts`. |
| **No RLS on any table** | Anon key has full read of every table. | Enable RLS + per-table `public_read` policies after auth model is decided. |

---

*End of inventory. Run `python backend/scraping/maintenance/count_rows.py` to materialize live row counts and replace the "live count required" placeholders in Section 2.*
