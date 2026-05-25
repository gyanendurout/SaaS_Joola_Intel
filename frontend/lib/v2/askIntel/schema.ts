/**
 * Ask Intel — Schema Metadata
 *
 * Source of truth for both:
 *   1. The OpenAI planner prompt (so the model only emits queries against
 *      tables/columns that actually exist), and
 *   2. The structured-plan validator in `./sqlSafety.ts` (so any unsafe
 *      table/column is rejected before it touches Supabase).
 *
 * If a table does NOT appear in WHITELISTED_TABLES it cannot be queried
 * from this endpoint. Add a new entry below to expand coverage.
 *
 * IMPORTANT — when adding a table:
 *   • Confirm the table actually exists in the live DB (via REST probe
 *     `GET <SUPABASE_URL>/rest/v1/<table>?select=*&limit=1`).
 *   • Include only columns that exist in the live schema (cross-reference
 *     migrations/*.sql).
 *   • Set `availability` to 'live' once you've seen rows; 'partial' if the
 *     table exists but is sparsely populated; 'unavailable' if the table
 *     is not yet created in prod.
 */

export type ColumnType =
  | 'uuid'
  | 'text'
  | 'integer'
  | 'numeric'
  | 'boolean'
  | 'timestamptz'
  | 'date'
  | 'text[]'
  | 'jsonb'

export type Availability = 'live' | 'partial' | 'unavailable'

export type ColumnSpec = {
  name: string
  type: ColumnType
  description: string
  /** Foreign-key hint: table the column joins to (column inferred as `id`). */
  fk?: string
}

export type TableSpec = {
  name: string
  description: string
  /** Column name that carries the row's primary timestamp (used for date filters). */
  dateField: string | null
  /** Approximate row volume order-of-magnitude; helps planner pick aggregations vs row reads. */
  rowMagnitude: 'small' | 'medium' | 'large'
  availability: Availability
  columns: ColumnSpec[]
  /** Allowed filter operators per column. If a column is absent, filtering is forbidden. */
  allowedFilters: Record<string, FilterOperator[]>
  /** Human-friendly notes — surfaced to the planner verbatim. */
  notes?: string
}

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'ilike'
  | 'in'
  | 'is'
  | 'not.is'

// ─── Tables ──────────────────────────────────────────────────────────

export const WHITELISTED_TABLES: Record<string, TableSpec> = {
  brands: {
    name: 'brands',
    description:
      '11 tracked pickleball brands. Master dimension; every other table joins to this via brand_id.',
    dateField: null,
    rowMagnitude: 'small',
    availability: 'live',
    columns: [
      { name: 'id', type: 'uuid', description: 'Primary key (UUID).' },
      { name: 'slug', type: 'text', description: 'Stable slug, e.g. "joola", "selkirk", "six-zero".' },
      { name: 'name', type: 'text', description: 'Display name, e.g. "JOOLA", "Selkirk".' },
      { name: 'is_joola', type: 'boolean', description: 'True only for JOOLA.' },
      { name: 'timezone', type: 'text', description: 'IANA timezone, e.g. "America/New_York".' },
    ],
    allowedFilters: {
      slug: ['eq', 'in', 'ilike'],
      name: ['eq', 'ilike'],
      is_joola: ['eq', 'is'],
    },
    notes:
      'Always JOIN through this table when surfacing brand names. JOOLA gets color #22c55e in the UI.',
  },

  products_catalog: {
    name: 'products_catalog',
    description:
      'Canonical paddle / SKU dimension. 86 rows after migration 015. Every product_id elsewhere FKs here.',
    dateField: null,
    rowMagnitude: 'small',
    availability: 'live',
    columns: [
      { name: 'id', type: 'uuid', description: 'Primary key.' },
      { name: 'brand_id', type: 'uuid', description: 'Owning brand.', fk: 'brands' },
      { name: 'sku', type: 'text', description: 'Internal SKU key.' },
      { name: 'display_name', type: 'text', description: 'Human-friendly product name, e.g. "Perseus IV".' },
      { name: 'category', type: 'text', description: 'e.g. "paddle", "bag", "accessory".' },
      { name: 'is_active', type: 'boolean', description: 'False when the SKU is discontinued.' },
      { name: 'launched_at', type: 'date', description: 'Launch date if known.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      sku: ['eq', 'ilike', 'in'],
      display_name: ['eq', 'ilike'],
      category: ['eq', 'in'],
      is_active: ['eq', 'is'],
    },
  },

  products: {
    name: 'products',
    description:
      'Scraped catalog rows from each brand website. One row per (brand × product variant) per scrape. Includes price, sale price, discount %, avg_rating, review_count, in_stock.',
    dateField: 'last_scraped_at',
    rowMagnitude: 'medium',
    availability: 'live',
    columns: [
      { name: 'id', type: 'uuid', description: 'Row id.' },
      { name: 'brand_id', type: 'uuid', description: 'Brand FK.', fk: 'brands' },
      { name: 'name', type: 'text', description: 'Product name as shown on brand site.' },
      { name: 'category', type: 'text', description: 'Category bucket.' },
      { name: 'price_usd', type: 'numeric', description: 'List price in USD. Pickleball paddles are typically $50-$500 — values outside that range are likely scrape artifacts and should be filtered out.' },
      { name: 'sale_price_usd', type: 'numeric', description: 'Current sale price if on sale.' },
      { name: 'discount_pct', type: 'numeric', description: 'Discount percent off list price.' },
      { name: 'avg_rating', type: 'numeric', description: 'Average star rating (0–5) from on-site reviews.' },
      { name: 'review_count', type: 'integer', description: 'Number of customer reviews on brand site.' },
      { name: 'in_stock', type: 'boolean', description: 'True if currently in stock.' },
      { name: 'last_scraped_at', type: 'timestamptz', description: 'When the row was last refreshed.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      category: ['eq', 'ilike', 'in'],
      price_usd: ['gt', 'gte', 'lt', 'lte'],
      avg_rating: ['gt', 'gte', 'lt', 'lte'],
      in_stock: ['eq', 'is'],
      last_scraped_at: ['gt', 'gte', 'lt', 'lte'],
    },
  },

  product_attention_daily: {
    name: 'product_attention_daily',
    description:
      'Daily roll-up per (product × date) of mentions, attention score, and sentiment from product_mentions.',
    dateField: 'attention_date',
    rowMagnitude: 'medium',
    availability: 'live',
    columns: [
      { name: 'id', type: 'uuid', description: 'Row id.' },
      { name: 'product_id', type: 'uuid', description: 'Product FK.', fk: 'products_catalog' },
      { name: 'brand_id', type: 'uuid', description: 'Brand FK.', fk: 'brands' },
      { name: 'attention_date', type: 'date', description: 'Date (DB-local).' },
      { name: 'mentions_total', type: 'integer', description: 'Total mentions across channels for that day.' },
      { name: 'mentions_instagram', type: 'integer', description: 'IG mention count.' },
      { name: 'mentions_youtube', type: 'integer', description: 'YT mention count.' },
      { name: 'mentions_reddit', type: 'integer', description: 'Reddit mention count.' },
      { name: 'mentions_tiktok', type: 'integer', description: 'TikTok mention count.' },
      { name: 'mentions_twitter', type: 'integer', description: 'X / Twitter mention count.' },
      { name: 'attention_score', type: 'numeric', description: 'Weighted attention score (sum of channel × engagement).' },
      { name: 'positive_mentions', type: 'integer', description: 'Mentions whose sentiment_label = positive.' },
      { name: 'negative_mentions', type: 'integer', description: 'Mentions whose sentiment_label = negative.' },
      { name: 'purchase_intent_count', type: 'integer', description: 'Count flagged as purchase intent.' },
      { name: 'crisis_mentions', type: 'integer', description: 'Count flagged is_crisis = true.' },
      { name: 'sales_likelihood_score', type: 'numeric', description: '0–100 modelled likelihood of generating sales (NOT confirmed sales).' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      product_id: ['eq', 'in'],
      attention_date: ['gt', 'gte', 'lt', 'lte', 'eq'],
    },
  },

  product_attention_summary: {
    name: 'product_attention_summary',
    description:
      'Period-bucket rollup per (product, period). period ∈ {last_7d, last_30d, last_90d, all_time}.',
    dateField: 'period_end',
    rowMagnitude: 'small',
    availability: 'live',
    columns: [
      { name: 'product_id', type: 'uuid', description: 'Product FK.', fk: 'products_catalog' },
      { name: 'brand_id', type: 'uuid', description: 'Brand FK.', fk: 'brands' },
      { name: 'period', type: 'text', description: 'One of last_7d / last_30d / last_90d / all_time.' },
      { name: 'period_start', type: 'date', description: 'Window start.' },
      { name: 'period_end', type: 'date', description: 'Window end.' },
      { name: 'mentions_total', type: 'integer', description: 'Total mentions in window.' },
      { name: 'attention_score', type: 'numeric', description: 'Weighted attention in window.' },
      { name: 'positive_mentions', type: 'integer', description: 'Positive sentiment count.' },
      { name: 'negative_mentions', type: 'integer', description: 'Negative sentiment count.' },
      { name: 'purchase_intent_count', type: 'integer', description: 'Purchase-intent count.' },
      { name: 'crisis_mentions', type: 'integer', description: 'Crisis count.' },
      { name: 'sales_likelihood_score', type: 'numeric', description: '0–100 sales likelihood.' },
      { name: 'rank_in_brand', type: 'integer', description: '1 = top product within brand.' },
      { name: 'rank_overall', type: 'integer', description: '1 = top product across all brands.' },
      { name: 'joola_vs_competitor_gap', type: 'numeric', description: 'Top JOOLA score − this score; null for JOOLA rows.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      product_id: ['eq', 'in'],
      period: ['eq', 'in'],
    },
  },

  mention_facts: {
    name: 'mention_facts',
    description:
      'Unified fact table. One row per enriched mention. Channels: reddit, reddit_comment, ig_comment, yt_comment, yt_video, x, x_influencer, tiktok, tiktok_comment, product_review.',
    dateField: 'posted_at',
    rowMagnitude: 'large',
    availability: 'live',
    columns: [
      { name: 'id', type: 'uuid', description: 'Row id.' },
      { name: 'channel', type: 'text', description: 'Source channel name.' },
      { name: 'source_table', type: 'text', description: 'Source table the fact was derived from.' },
      { name: 'source_id', type: 'uuid', description: 'Source row id.' },
      { name: 'brand_id', type: 'uuid', description: 'Brand being talked about.', fk: 'brands' },
      { name: 'product_id', type: 'uuid', description: 'Product mentioned (nullable).', fk: 'products_catalog' },
      { name: 'athlete_id', type: 'uuid', description: 'Athlete mentioned (nullable).', fk: 'influencers' },
      { name: 'sentiment_score', type: 'numeric', description: '-1 to +1.' },
      { name: 'sentiment_label', type: 'text', description: 'positive / neutral / negative (still calibrating — trust crisis flag over raw label).' },
      { name: 'is_crisis', type: 'boolean', description: 'True when the row indicates a crisis.' },
      { name: 'is_opportunity', type: 'boolean', description: 'True when the row flags an opportunity.' },
      { name: 'is_purchase_intent', type: 'boolean', description: 'True when the row signals a buying intent.' },
      { name: 'is_competitor_switch', type: 'boolean', description: 'True when row signals a brand switch.' },
      { name: 'text_snippet', type: 'text', description: 'Short snippet of the source text.' },
      { name: 'posted_at', type: 'timestamptz', description: 'Original post time.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      product_id: ['eq', 'in', 'is', 'not.is'],
      athlete_id: ['eq', 'in', 'is', 'not.is'],
      channel: ['eq', 'in'],
      sentiment_label: ['eq', 'in'],
      is_crisis: ['eq', 'is'],
      is_opportunity: ['eq', 'is'],
      is_purchase_intent: ['eq', 'is'],
      is_competitor_switch: ['eq', 'is'],
      posted_at: ['gt', 'gte', 'lt', 'lte'],
    },
    notes:
      'For sentiment-related analysis prefer is_crisis / is_opportunity / is_purchase_intent flags. Raw sentiment_label coverage is partial today.',
  },

  reddit_mentions: {
    name: 'reddit_mentions',
    description: 'Reddit posts that mention a tracked brand.',
    dateField: 'posted_at',
    rowMagnitude: 'medium',
    availability: 'live',
    columns: [
      { name: 'id', type: 'uuid', description: 'Row id.' },
      { name: 'brand_id', type: 'uuid', description: 'Brand FK.', fk: 'brands' },
      { name: 'subreddit', type: 'text', description: 'Subreddit name (no r/ prefix).' },
      { name: 'title', type: 'text', description: 'Post title.' },
      { name: 'body', type: 'text', description: 'Post body.' },
      { name: 'score', type: 'integer', description: 'Reddit score (upvotes − downvotes).' },
      { name: 'num_comments', type: 'integer', description: 'Comment count.' },
      { name: 'url', type: 'text', description: 'Permalink.' },
      { name: 'posted_at', type: 'timestamptz', description: 'When the post was created on Reddit.' },
      { name: 'sentiment_label', type: 'text', description: 'positive / neutral / negative.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      subreddit: ['eq', 'in', 'ilike'],
      score: ['gt', 'gte'],
      posted_at: ['gt', 'gte', 'lt', 'lte'],
      sentiment_label: ['eq', 'in'],
    },
    notes: 'Generic-name brands (gamma, head) must require a pickleball-context token for accuracy — recommend filtering by subreddit or text contains "pickleball".',
  },

  reddit_comments: {
    name: 'reddit_comments',
    description: 'Comment threads under reddit_mentions posts.',
    dateField: 'posted_at',
    rowMagnitude: 'medium',
    availability: 'live',
    columns: [
      { name: 'id', type: 'uuid', description: 'Row id.' },
      { name: 'brand_id', type: 'uuid', description: 'Brand FK.', fk: 'brands' },
      { name: 'parent_post_id', type: 'uuid', description: 'FK to reddit_mentions.id.', fk: 'reddit_mentions' },
      { name: 'subreddit', type: 'text', description: 'Subreddit.' },
      { name: 'author', type: 'text', description: 'Reddit username.' },
      { name: 'comment_text', type: 'text', description: 'Comment body.' },
      { name: 'upvotes', type: 'integer', description: 'Comment upvotes.' },
      { name: 'posted_at', type: 'timestamptz', description: 'Comment timestamp.' },
      { name: 'sentiment_label', type: 'text', description: 'Sentiment label.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      subreddit: ['eq', 'in', 'ilike'],
      upvotes: ['gt', 'gte'],
      posted_at: ['gt', 'gte', 'lt', 'lte'],
      sentiment_label: ['eq', 'in'],
    },
  },

  ig_comments: {
    name: 'ig_comments',
    description: 'Instagram comments attached to brand posts.',
    dateField: 'posted_at',
    rowMagnitude: 'medium',
    availability: 'live',
    columns: [
      { name: 'id', type: 'uuid', description: 'Row id.' },
      { name: 'brand_id', type: 'uuid', description: 'Brand FK.', fk: 'brands' },
      { name: 'post_id', type: 'uuid', description: 'FK to ig_posts.id.', fk: 'ig_posts' },
      { name: 'commenter_username', type: 'text', description: 'IG handle.' },
      { name: 'comment_text', type: 'text', description: 'Comment body.' },
      { name: 'comment_likes', type: 'integer', description: 'Likes on the comment.' },
      { name: 'posted_at', type: 'timestamptz', description: 'When the comment was posted.' },
      { name: 'sentiment_label', type: 'text', description: 'Sentiment label.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      comment_likes: ['gt', 'gte'],
      posted_at: ['gt', 'gte', 'lt', 'lte'],
      sentiment_label: ['eq', 'in'],
    },
  },

  yt_comments: {
    name: 'yt_comments',
    description: 'YouTube comments under brand-channel videos.',
    dateField: 'posted_at',
    rowMagnitude: 'medium',
    availability: 'live',
    columns: [
      { name: 'id', type: 'uuid', description: 'Row id.' },
      { name: 'brand_id', type: 'uuid', description: 'Brand FK.', fk: 'brands' },
      { name: 'video_id', type: 'uuid', description: 'FK to yt_videos.id.', fk: 'yt_videos' },
      { name: 'commenter_username', type: 'text', description: 'YT handle.' },
      { name: 'comment_text', type: 'text', description: 'Comment body.' },
      { name: 'comment_likes', type: 'integer', description: 'Likes on the comment.' },
      { name: 'posted_at', type: 'timestamptz', description: 'Posted timestamp.' },
      { name: 'sentiment_label', type: 'text', description: 'Sentiment label.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      comment_likes: ['gt', 'gte'],
      posted_at: ['gt', 'gte', 'lt', 'lte'],
      sentiment_label: ['eq', 'in'],
    },
  },

  tiktok_videos: {
    name: 'tiktok_videos',
    description: 'TikTok videos posted by brand or athlete handles.',
    dateField: 'posted_at',
    rowMagnitude: 'medium',
    availability: 'live',
    columns: [
      { name: 'id', type: 'uuid', description: 'Row id.' },
      { name: 'brand_id', type: 'uuid', description: 'Brand FK.', fk: 'brands' },
      { name: 'video_url', type: 'text', description: 'Direct TikTok URL.' },
      { name: 'caption', type: 'text', description: 'Caption text.' },
      { name: 'play_count', type: 'integer', description: 'Views.' },
      { name: 'like_count', type: 'integer', description: 'Likes.' },
      { name: 'comment_count', type: 'integer', description: 'Comment count.' },
      { name: 'posted_at', type: 'timestamptz', description: 'Posted timestamp.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      play_count: ['gt', 'gte'],
      like_count: ['gt', 'gte'],
      posted_at: ['gt', 'gte', 'lt', 'lte'],
    },
  },

  tiktok_comments: {
    name: 'tiktok_comments',
    description: 'TikTok comments on tracked videos (added in migration 014).',
    dateField: 'posted_at',
    rowMagnitude: 'medium',
    availability: 'partial',
    columns: [
      { name: 'id', type: 'uuid', description: 'Row id.' },
      { name: 'brand_id', type: 'uuid', description: 'Brand FK.', fk: 'brands' },
      { name: 'video_id', type: 'uuid', description: 'FK to tiktok_videos.id.', fk: 'tiktok_videos' },
      { name: 'comment_text', type: 'text', description: 'Comment body.' },
      { name: 'like_count', type: 'integer', description: 'Likes on the comment.' },
      { name: 'posted_at', type: 'timestamptz', description: 'Posted timestamp.' },
      { name: 'sentiment_label', type: 'text', description: 'Sentiment label.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      like_count: ['gt', 'gte'],
      posted_at: ['gt', 'gte', 'lt', 'lte'],
      sentiment_label: ['eq', 'in'],
    },
  },

  x_posts: {
    name: 'x_posts',
    description: 'X / Twitter posts from brand accounts.',
    dateField: 'posted_at',
    rowMagnitude: 'medium',
    availability: 'live',
    columns: [
      { name: 'id', type: 'uuid', description: 'Row id.' },
      { name: 'brand_id', type: 'uuid', description: 'Brand FK.', fk: 'brands' },
      { name: 'text', type: 'text', description: 'Tweet text.' },
      { name: 'like_count', type: 'integer', description: 'Likes.' },
      { name: 'retweet_count', type: 'integer', description: 'Retweets.' },
      { name: 'reply_count', type: 'integer', description: 'Replies.' },
      { name: 'view_count', type: 'integer', description: 'Impressions.' },
      { name: 'posted_at', type: 'timestamptz', description: 'When posted.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      like_count: ['gt', 'gte'],
      posted_at: ['gt', 'gte', 'lt', 'lte'],
    },
  },

  influencer_x_posts: {
    name: 'influencer_x_posts',
    description: 'X / Twitter posts by tracked athletes (influencers).',
    dateField: 'posted_at',
    rowMagnitude: 'medium',
    availability: 'live',
    columns: [
      { name: 'id', type: 'uuid', description: 'Row id.' },
      { name: 'influencer_id', type: 'uuid', description: 'Athlete FK.', fk: 'influencers' },
      { name: 'text', type: 'text', description: 'Tweet text.' },
      { name: 'like_count', type: 'integer', description: 'Likes.' },
      { name: 'retweet_count', type: 'integer', description: 'Retweets.' },
      { name: 'posted_at', type: 'timestamptz', description: 'When posted.' },
    ],
    allowedFilters: {
      influencer_id: ['eq', 'in'],
      like_count: ['gt', 'gte'],
      posted_at: ['gt', 'gte', 'lt', 'lte'],
    },
  },

  product_reviews: {
    name: 'product_reviews',
    description:
      'Customer review prose scraped from brand product detail pages (Bazaarvoice / Judge.me / Okendo / Yotpo). Created by migration 016 — may be empty until the review pipeline runs.',
    dateField: 'posted_at',
    rowMagnitude: 'medium',
    availability: 'partial',
    columns: [
      { name: 'id', type: 'uuid', description: 'Row id.' },
      { name: 'brand_id', type: 'uuid', description: 'Brand FK.', fk: 'brands' },
      { name: 'product_id', type: 'uuid', description: 'Product FK.', fk: 'products_catalog' },
      { name: 'review_widget', type: 'text', description: 'bazaarvoice / judgeme / okendo / yotpo / spr.' },
      { name: 'reviewer_name', type: 'text', description: 'Reviewer display name.' },
      { name: 'review_title', type: 'text', description: 'Review headline.' },
      { name: 'review_text', type: 'text', description: 'Review body.' },
      { name: 'rating', type: 'numeric', description: '1–5 stars (null when widget does not expose).' },
      { name: 'helpful_count', type: 'integer', description: 'Helpful votes on the review.' },
      { name: 'posted_at', type: 'timestamptz', description: 'When the customer posted the review.' },
      { name: 'sentiment_label', type: 'text', description: 'Sentiment label (post-enrichment).' },
      { name: 'is_crisis', type: 'boolean', description: 'Crisis flag.' },
      { name: 'purchase_intent_score', type: 'numeric', description: 'Purchase-intent score.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      product_id: ['eq', 'in'],
      rating: ['gt', 'gte', 'lt', 'lte', 'eq'],
      posted_at: ['gt', 'gte', 'lt', 'lte'],
      sentiment_label: ['eq', 'in'],
      is_crisis: ['eq', 'is'],
    },
    notes: 'Table will likely be empty until the review scraper has been run end-to-end.',
  },

  ig_profiles_weekly: {
    name: 'ig_profiles_weekly',
    description: 'Weekly snapshot of brand Instagram profile metrics.',
    dateField: 'scraped_at',
    rowMagnitude: 'small',
    availability: 'live',
    columns: [
      { name: 'brand_id', type: 'uuid', description: 'Brand FK.', fk: 'brands' },
      { name: 'followers', type: 'integer', description: 'Follower count at snapshot.' },
      { name: 'week_number', type: 'integer', description: 'ISO week number.' },
      { name: 'year', type: 'integer', description: 'ISO year.' },
      { name: 'scraped_at', type: 'timestamptz', description: 'Snapshot time.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      year: ['eq', 'in', 'gte'],
      scraped_at: ['gt', 'gte', 'lt', 'lte'],
    },
  },

  ig_posts: {
    name: 'ig_posts',
    description: 'Individual Instagram posts from brand accounts.',
    dateField: 'posted_at',
    rowMagnitude: 'large',
    availability: 'live',
    columns: [
      { name: 'id', type: 'uuid', description: 'Row id.' },
      { name: 'brand_id', type: 'uuid', description: 'Brand FK.', fk: 'brands' },
      { name: 'handle', type: 'text', description: 'IG handle without @.' },
      { name: 'caption', type: 'text', description: 'Post caption.' },
      { name: 'like_count', type: 'integer', description: 'Likes.' },
      { name: 'comment_count', type: 'integer', description: 'Comments.' },
      { name: 'view_count', type: 'integer', description: 'Views (for video posts).' },
      { name: 'post_format', type: 'text', description: 'Image / Reel / Carousel.' },
      { name: 'posted_at', type: 'timestamptz', description: 'When posted.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      like_count: ['gt', 'gte'],
      posted_at: ['gt', 'gte', 'lt', 'lte'],
      post_format: ['eq', 'in'],
    },
  },

  yt_channel_weekly: {
    name: 'yt_channel_weekly',
    description: 'Weekly YouTube channel metric snapshot per brand.',
    dateField: null,
    rowMagnitude: 'small',
    availability: 'live',
    columns: [
      { name: 'brand_id', type: 'uuid', description: 'Brand FK.', fk: 'brands' },
      { name: 'subscribers', type: 'integer', description: 'Subscriber count.' },
      { name: 'total_videos', type: 'integer', description: 'Video count.' },
      { name: 'total_views', type: 'integer', description: 'Channel view count.' },
      { name: 'year', type: 'integer', description: 'ISO year.' },
      { name: 'week_number', type: 'integer', description: 'ISO week.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      year: ['eq', 'in', 'gte'],
    },
  },

  yt_videos: {
    name: 'yt_videos',
    description: 'YouTube videos posted on brand channels.',
    dateField: 'published_at',
    rowMagnitude: 'large',
    availability: 'live',
    columns: [
      { name: 'id', type: 'uuid', description: 'Row id.' },
      { name: 'brand_id', type: 'uuid', description: 'Brand FK.', fk: 'brands' },
      { name: 'youtube_video_id', type: 'text', description: 'YouTube public video id (use this for links, NOT id).' },
      { name: 'title', type: 'text', description: 'Video title.' },
      { name: 'view_count', type: 'integer', description: 'Views.' },
      { name: 'like_count', type: 'integer', description: 'Likes.' },
      { name: 'comment_count', type: 'integer', description: 'Comment count.' },
      { name: 'duration_seconds', type: 'integer', description: 'Length in seconds.' },
      { name: 'is_short', type: 'boolean', description: 'True for Shorts.' },
      { name: 'published_at', type: 'timestamptz', description: 'Publication time.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      view_count: ['gt', 'gte'],
      is_short: ['eq', 'is'],
      published_at: ['gt', 'gte', 'lt', 'lte'],
    },
  },

  tiktok_profiles_weekly: {
    name: 'tiktok_profiles_weekly',
    description: 'Weekly TikTok profile snapshots.',
    dateField: 'scraped_at',
    rowMagnitude: 'small',
    availability: 'live',
    columns: [
      { name: 'brand_id', type: 'uuid', description: 'Brand FK.', fk: 'brands' },
      { name: 'followers', type: 'integer', description: 'Follower count.' },
      { name: 'video_count', type: 'integer', description: 'Total videos.' },
      { name: 'like_count', type: 'integer', description: 'Total likes received.' },
      { name: 'year', type: 'integer', description: 'ISO year.' },
      { name: 'week_number', type: 'integer', description: 'ISO week.' },
      { name: 'scraped_at', type: 'timestamptz', description: 'Snapshot time.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      year: ['eq', 'in', 'gte'],
      scraped_at: ['gt', 'gte', 'lt', 'lte'],
    },
  },

  x_profiles_weekly: {
    name: 'x_profiles_weekly',
    description: 'Weekly X / Twitter profile snapshots.',
    dateField: 'scraped_at',
    rowMagnitude: 'small',
    availability: 'live',
    columns: [
      { name: 'brand_id', type: 'uuid', description: 'Brand FK.', fk: 'brands' },
      { name: 'handle', type: 'text', description: 'X handle.' },
      { name: 'followers', type: 'integer', description: 'Followers.' },
      { name: 'following', type: 'integer', description: 'Following.' },
      { name: 'tweet_count', type: 'integer', description: 'Tweet count.' },
      { name: 'year', type: 'integer', description: 'ISO year.' },
      { name: 'week_number', type: 'integer', description: 'ISO week.' },
      { name: 'scraped_at', type: 'timestamptz', description: 'Snapshot time.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      scraped_at: ['gt', 'gte', 'lt', 'lte'],
    },
  },

  marketing_ads: {
    name: 'marketing_ads',
    description: 'Meta + Google ads captured from public ad libraries.',
    dateField: 'captured_at',
    rowMagnitude: 'medium',
    availability: 'live',
    columns: [
      { name: 'id', type: 'uuid', description: 'Row id.' },
      { name: 'brand_id', type: 'uuid', description: 'Brand FK.', fk: 'brands' },
      { name: 'platform', type: 'text', description: 'meta or google.' },
      { name: 'body', type: 'text', description: 'Ad copy.' },
      { name: 'cta', type: 'text', description: 'CTA text.' },
      { name: 'is_active', type: 'boolean', description: 'Currently running.' },
      { name: 'started_at', type: 'timestamptz', description: 'First seen.' },
      { name: 'captured_at', type: 'timestamptz', description: 'Last refresh.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      platform: ['eq', 'in'],
      is_active: ['eq', 'is'],
      captured_at: ['gt', 'gte', 'lt', 'lte'],
    },
  },

  promotions: {
    name: 'promotions',
    description: 'Promotional banners detected on brand homepages.',
    dateField: 'detected_at',
    rowMagnitude: 'small',
    availability: 'live',
    columns: [
      { name: 'id', type: 'uuid', description: 'Row id.' },
      { name: 'brand_id', type: 'uuid', description: 'Brand FK.', fk: 'brands' },
      { name: 'banner_text', type: 'text', description: 'Banner / promo copy.' },
      { name: 'promo_type', type: 'text', description: 'sitewide / category / product / shipping / etc.' },
      { name: 'discount_pct', type: 'numeric', description: 'Discount percent if parseable.' },
      { name: 'detected_at', type: 'timestamptz', description: 'First detection.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      promo_type: ['eq', 'in', 'ilike'],
      discount_pct: ['gt', 'gte', 'lt', 'lte'],
      detected_at: ['gt', 'gte', 'lt', 'lte'],
    },
  },

  promotion_daily: {
    name: 'promotion_daily',
    description: 'Daily promotion presence per brand (and optional product).',
    dateField: 'metric_date',
    rowMagnitude: 'medium',
    availability: 'live',
    columns: [
      { name: 'metric_date', type: 'date', description: 'Calendar date.' },
      { name: 'brand_id', type: 'uuid', description: 'Brand FK.', fk: 'brands' },
      { name: 'product_id', type: 'uuid', description: 'Product FK (nullable).', fk: 'products_catalog' },
      { name: 'promo_active_flag', type: 'integer', description: '1 when a promotion was live that day.' },
      { name: 'promo_depth_pct', type: 'numeric', description: 'Average discount depth %.' },
      { name: 'promo_count', type: 'integer', description: 'How many promos overlapped that day.' },
    ],
    allowedFilters: {
      metric_date: ['eq', 'gt', 'gte', 'lt', 'lte'],
      brand_id: ['eq', 'in'],
      product_id: ['eq', 'in', 'is', 'not.is'],
      promo_active_flag: ['eq'],
    },
  },

  influencers: {
    name: 'influencers',
    description: 'Tracked athletes / influencers (27 seeded).',
    dateField: null,
    rowMagnitude: 'small',
    availability: 'live',
    columns: [
      { name: 'id', type: 'uuid', description: 'Row id.' },
      { name: 'name', type: 'text', description: 'Athlete full name.' },
      { name: 'brand_id', type: 'uuid', description: 'Primary sponsor brand.', fk: 'brands' },
      { name: 'follower_count_ig', type: 'integer', description: 'Instagram followers (latest known).' },
      { name: 'instagram_handle', type: 'text', description: 'IG handle.' },
      { name: 'x_handle', type: 'text', description: 'X handle.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      name: ['eq', 'ilike'],
      follower_count_ig: ['gt', 'gte'],
    },
  },

  influencer_posts: {
    name: 'influencer_posts',
    description: 'Per-athlete post snapshots (IG primary).',
    dateField: 'posted_at',
    rowMagnitude: 'large',
    availability: 'live',
    columns: [
      { name: 'id', type: 'uuid', description: 'Row id.' },
      { name: 'influencer_id', type: 'uuid', description: 'Athlete FK.', fk: 'influencers' },
      { name: 'like_count', type: 'integer', description: 'Likes.' },
      { name: 'comment_count', type: 'integer', description: 'Comments.' },
      { name: 'posted_at', type: 'timestamptz', description: 'When posted.' },
    ],
    allowedFilters: {
      influencer_id: ['eq', 'in'],
      like_count: ['gt', 'gte'],
      posted_at: ['gt', 'gte', 'lt', 'lte'],
    },
  },

  joola_timeseries_daily: {
    name: 'joola_timeseries_daily',
    description:
      'Materialized view: daily JOOLA-centric brand × metric timeseries (attention_score + helper marts).',
    dateField: 'metric_date_brand_local',
    rowMagnitude: 'medium',
    availability: 'live',
    columns: [
      { name: 'brand_id', type: 'uuid', description: 'Brand FK.', fk: 'brands' },
      { name: 'brand_slug', type: 'text', description: 'Brand slug for display.' },
      { name: 'metric_date_brand_local', type: 'date', description: 'Date in brand-local timezone.' },
      { name: 'attention_score', type: 'numeric', description: 'Daily attention score.' },
      { name: 'mentions_total', type: 'integer', description: 'Total mentions.' },
      { name: 'ad_pressure_score', type: 'numeric', description: 'Ad pressure proxy score (helper mart).' },
      { name: 'promo_active_flag', type: 'integer', description: '1 when any promo live.' },
    ],
    allowedFilters: {
      brand_id: ['eq', 'in'],
      brand_slug: ['eq', 'in'],
      metric_date_brand_local: ['eq', 'gt', 'gte', 'lt', 'lte'],
    },
    notes: 'Some columns may be NULL on early dates (before scraping started).',
  },

  analysis_results: {
    name: 'analysis_results',
    description:
      'Analytics outputs (correlations, changepoints, granger, lag scans) stored as denormalised rows.',
    dateField: 'computed_at',
    rowMagnitude: 'small',
    availability: 'live',
    columns: [
      { name: 'id', type: 'uuid', description: 'Row id.' },
      { name: 'kind', type: 'text', description: 'Analysis kind: correlation / changepoint / granger / lag_scan.' },
      { name: 'brand_id', type: 'uuid', description: 'Optional brand scope.', fk: 'brands' },
      { name: 'product_id', type: 'uuid', description: 'Optional product scope.', fk: 'products_catalog' },
      { name: 'metric_a', type: 'text', description: 'First metric name.' },
      { name: 'metric_b', type: 'text', description: 'Second metric name.' },
      { name: 'score', type: 'numeric', description: 'Test statistic / correlation coefficient.' },
      { name: 'p_value', type: 'numeric', description: 'p-value where applicable.' },
      { name: 'computed_at', type: 'timestamptz', description: 'When the result was produced.' },
    ],
    allowedFilters: {
      kind: ['eq', 'in'],
      brand_id: ['eq', 'in'],
      product_id: ['eq', 'in'],
      computed_at: ['gt', 'gte', 'lt', 'lte'],
    },
  },
}

// ─── Business metric definitions ─────────────────────────────────────

export type MetricSpec = {
  name: string
  description: string
  sources: string[]
  gotchas?: string[]
}

export const METRICS: Record<string, MetricSpec> = {
  attention_score: {
    name: 'attention_score',
    description:
      'Channel-weighted sum of engagement on every mention of a product. Computed by the AI enrichment pipeline.',
    sources: ['product_attention_daily.attention_score', 'product_attention_summary.attention_score'],
  },
  mentions: {
    name: 'mentions',
    description:
      'Count of times a brand or product was mentioned in the source channels. Use mention_facts for cross-channel totals.',
    sources: [
      'mention_facts',
      'product_attention_daily.mentions_total',
      'product_attention_summary.mentions_total',
    ],
  },
  sentiment_label: {
    name: 'sentiment_label',
    description:
      'GPT-4o-mini classification of a row as positive / neutral / negative. Coverage is partial today — trust the is_crisis flag over the raw label for risk decisions.',
    sources: ['mention_facts.sentiment_label', 'reddit_mentions.sentiment_label', 'ig_comments.sentiment_label', 'yt_comments.sentiment_label'],
    gotchas: ['Sentiment classifier coverage is still calibrating; sample size matters.'],
  },
  crisis_signals: {
    name: 'crisis_signals',
    description:
      'Mention rows the enricher flagged as is_crisis=true (warranty, defect, refund, dishonest practice, etc.).',
    sources: ['mention_facts.is_crisis'],
  },
  engagement_rate: {
    name: 'engagement_rate',
    description:
      'Per-platform engagement rate computed from posts ÷ followers. Capped at 100% — values higher than that are scraping artifacts.',
    sources: ['Derived in app from ig_posts, yt_videos, tiktok_videos, x_posts vs profile snapshots'],
    gotchas: ['Brands with < 50 followers are excluded from outlier views — usually a misconfigured handle.'],
  },
  campaign_pressure: {
    name: 'campaign_pressure',
    description:
      'Daily count of active ad creatives a brand was running, proxy for media spend pressure.',
    sources: ['joola_timeseries_daily.ad_pressure_score', 'marketing_ads (raw)'],
  },
  product_gap: {
    name: 'product_gap',
    description:
      'For each curated product, the attention-score difference vs. the top competitor product in the same category. Positive = leading, negative = trailing.',
    sources: ['product_attention_summary.joola_vs_competitor_gap'],
  },
  sales_likelihood: {
    name: 'sales_likelihood',
    description:
      '0-100 modelled likelihood of a product generating sales based on attention + purchase-intent + sentiment. NOT confirmed sales.',
    sources: ['product_attention_daily.sales_likelihood_score', 'product_attention_summary.sales_likelihood_score'],
    gotchas: ['Not a sales figure. Real sales (when available) live in sales_facts_daily / sales_estimates.'],
  },
}

// ─── Tracked brand slugs (single source of truth) ────────────────────

export const TRACKED_BRAND_SLUGS = [
  'joola',
  'selkirk',
  'paddletek',
  'crbn',
  'six-zero',
  'engage',
  'onix',
  'franklin',
  'head',
  'wilson',
  'gamma',
] as const

// ─── Compact summary for prompt injection ────────────────────────────

/**
 * Returns a compressed schema summary suitable for inlining into the
 * OpenAI planner system prompt. Skips `unavailable` tables entirely and
 * marks `partial` tables so the model sets reasonable expectations.
 */
export function buildSchemaPrompt(): string {
  const out: string[] = []
  out.push('# Available tables')
  for (const t of Object.values(WHITELISTED_TABLES)) {
    if (t.availability === 'unavailable') continue
    const marker = t.availability === 'partial' ? ' [PARTIAL]' : ''
    out.push(`\n## ${t.name}${marker}`)
    out.push(t.description)
    if (t.dateField) out.push(`Date column: ${t.dateField}`)
    out.push('Columns:')
    for (const c of t.columns) {
      out.push(`  - ${c.name} (${c.type})${c.fk ? ` → ${c.fk}` : ''}: ${c.description}`)
    }
    out.push(`Allowed filter operators: ${JSON.stringify(t.allowedFilters)}`)
    if (t.notes) out.push(`Notes: ${t.notes}`)
  }
  out.push('\n# Business metrics')
  for (const m of Object.values(METRICS)) {
    out.push(`- ${m.name}: ${m.description} (sources: ${m.sources.join(', ')})`)
    if (m.gotchas) out.push(`  gotchas: ${m.gotchas.join(' · ')}`)
  }
  out.push('\n# Brand slugs')
  out.push(TRACKED_BRAND_SLUGS.join(', '))
  return out.join('\n')
}

/** Public-facing JSON shape for /api/v2/ask-intel/schema. */
export function buildSchemaSummary() {
  return {
    tables: Object.values(WHITELISTED_TABLES).map((t) => ({
      name: t.name,
      availability: t.availability,
      description: t.description,
      dateField: t.dateField,
      columns: t.columns.map((c) => ({
        name: c.name,
        type: c.type,
        description: c.description,
        fk: c.fk,
      })),
      allowedFilters: t.allowedFilters,
      notes: t.notes,
    })),
    metrics: Object.values(METRICS),
    brands: TRACKED_BRAND_SLUGS,
  }
}
