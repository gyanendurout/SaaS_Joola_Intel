export interface MarketIntelItem {
  id: string
  source_type: 'rss' | 'reddit' | 'instagram' | 'website'
  source_name: string
  source_handle?: string
  title?: string
  summary?: string
  original_url: string
  thumbnail_url?: string
  author?: string
  published_at?: string
  scraped_at: string
  sentiment?: 'positive' | 'negative' | 'neutral'
  topics?: string[]
  brands_mentioned?: string[]
  players_mentioned?: string[]
  mentions_joola?: boolean
  joola_context?: string
  joola_sentiment?: 'positive' | 'negative' | 'neutral'
  is_crisis?: boolean
  crisis_keywords?: string[]
  is_opportunity?: boolean
  opportunity_type?: string
  is_trending?: boolean
  ai_tagged?: boolean
  ai_tagged_at?: string
}

export interface BrandMentionExternal {
  id: string
  item_id: string
  brand_id: string
  brand_slug: string
  brand_name: string
  context_snippet?: string
  context_type?: 'positive_press' | 'neutral' | 'negative' | 'crisis'
  sentiment?: string
  reach_estimate?: number
  source_name?: string
  source_type?: string
  source_url?: string
  published_at?: string
  is_actioned?: boolean
  actioned_at?: string
  action_notes?: string
  created_at: string
}

export interface MarketTrend {
  id: string
  week_number: number
  year: number
  keyword: string
  mention_count: number
  source_count: number
  sentiment?: string
  brands_associated?: string[]
  is_joola_relevant?: boolean
  opportunity_type?: string
  created_at: string
}

export interface GeneratedContent {
  id: string
  source_item_id?: string
  content_type: 'blog_post' | 'instagram_post'
  title?: string
  body?: string
  meta_description?: string
  seo_keywords?: string[]
  hashtags?: string[]
  image_prompt?: string
  best_posting_time?: string
  predicted_engagement?: string
  status: 'draft' | 'approved' | 'published'
  published_url?: string
  created_at: string
  published_at?: string
}

export interface InfluencerSnapshot {
  id: string
  influencer_id: string
  brand_id: string
  follower_count_ig?: number
  follower_count_yt?: number
  week_number: number
  year: number
  scraped_at: string
}
