'use client'

/**
 * v2 data adapter — reshapes Supabase rows into the structure the
 * design's mock data exposes via `window.JOOLA_DATA`. Each fetcher
 * is independent so pages can request only what they need.
 *
 * Mirrors keys from design/data.js: BRANDS, ig, ads, promos, products,
 * yt, reddit, trends, influencers, adSample, signals, calendar,
 * topIGPosts, topYTVideos, topComments, subreddits, redditTrend, ytTrend.
 *
 * Brand id == brands.slug to match design conventions.
 */

import { supabase } from '@/lib/shared/supabase'

export type V2Brand = {
  id: string          // slug
  brand_id: string    // uuid
  name: string
  color: string
  joola?: boolean
}

export const BRAND_COLORS: Record<string, string> = {
  joola: '#22c55e',
  selkirk: '#F5E625',
  crbn: '#818cf8',
  franklin: '#ec4899',
  engage: '#06b6d4',
  paddletek: '#f59e0b',
  'six-zero': '#a855f7',
  onix: '#ef4444',
  wilson: '#14b8a6',
  gamma: '#60a5fa',
  prokennex: '#fb923c',
  head: '#0ea5e9',
}

// Module-level Promise cache for fetchBrands(). The brands table is essentially
// static (11 rows, updated only via migration), and nearly every v2 page calls
// fetchBrands() on mount. Caching the in-flight Promise both deduplicates concurrent
// callers and skips redundant network round-trips when navigating between pages
// within the same SPA session.
let brandsCache: Promise<V2Brand[]> | null = null

export async function fetchBrands(): Promise<V2Brand[]> {
  if (brandsCache) return brandsCache
  brandsCache = (async (): Promise<V2Brand[]> => {
    try {
      const { data } = await supabase.from('brands').select('id,name,slug,is_joola').order('name')
      return (data || []).map((b: any) => ({
        id: b.slug,
        brand_id: b.id,
        name: b.name,
        color: BRAND_COLORS[b.slug] || '#888',
        joola: !!b.is_joola,
      }))
    } catch (err) {
      brandsCache = null // allow retry on next call after failure
      throw err
    }
  })()
  return brandsCache
}

// ─── IG followers + engagement ────────────────────────────────────────
export type V2IGRow = {
  brand: string
  followers: number
  delta: number | null
  deltaPct: number | null
  engRate: number
  trend: number[]
}

export async function fetchIG(brands: V2Brand[]): Promise<V2IGRow[]> {
  const slugByBid: Record<string, string> = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))

  const [{ data: profiles }, { data: posts }] = await Promise.all([
    supabase.from('ig_profiles_weekly').select('brand_id,followers,week_number,year,scraped_at').order('scraped_at', { ascending: false }),
    supabase.from('ig_posts').select('brand_id,like_count,comment_count').limit(2000),
  ])

  // Most-recent snapshot per brand
  const byBrand: Record<string, { current: number; trend: number[] }> = {}
  ;(profiles || []).forEach((p: any) => {
    const slug = slugByBid[p.brand_id]
    if (!slug) return
    if (!byBrand[slug]) byBrand[slug] = { current: 0, trend: [] }
    if (byBrand[slug].current === 0) byBrand[slug].current = p.followers || 0
    if (byBrand[slug].trend.length < 8) byBrand[slug].trend.push(p.followers || 0)
  })

  // Engagement rate per brand (avg likes+comments per post / followers)
  const engAcc: Record<string, { likes: number; comments: number; n: number }> = {}
  ;(posts || []).forEach((p: any) => {
    const slug = slugByBid[p.brand_id]
    if (!slug) return
    if (!engAcc[slug]) engAcc[slug] = { likes: 0, comments: 0, n: 0 }
    engAcc[slug].likes += p.like_count || 0
    engAcc[slug].comments += p.comment_count || 0
    engAcc[slug].n++
  })

  return brands
    .map((b) => {
      const f = byBrand[b.id]?.current || 0
      const trendRaw = (byBrand[b.id]?.trend || []).slice().reverse() // chronological
      const trend = trendRaw.length ? trendRaw : [f]
      const e = engAcc[b.id]
      const avgLikes = e?.n ? e.likes / e.n : 0
      const avgComments = e?.n ? e.comments / e.n : 0
      const rawER = f > 0 ? ((avgLikes + avgComments) / f) * 100 : 0
      // Cap ER display at 100% — anything higher means follower count is bad data
      // (scraping artifact, locked account, mis-mapped handle). Brands with
      // < 50 followers are filtered out by consumers via ER_MIN_FOLLOWERS.
      if (rawER > 100 && f > 0) {
        // eslint-disable-next-line no-console
        console.warn(`[fetchIG] Implausible engagement rate for ${b.id}: ${rawER.toFixed(1)}% (followers=${f}). Capping at 100%.`)
      }
      const engRate = Math.min(100, rawER)
      const prev = trend.length > 1 ? trend[trend.length - 2] : null
      const delta = prev !== null ? f - prev : null
      const deltaPct = prev && prev > 0 ? ((f - prev) / prev) * 100 : null
      return { brand: b.id, followers: f, delta, deltaPct, engRate, trend }
    })
    .sort((a, b) => b.followers - a.followers)
}

// ─── Marketing ads (Meta + Google) ───────────────────────────────────
export type V2AdRow = {
  brand: string
  total: number
  meta: number
  google: number
  active: number
  share: number
}

export async function fetchAds(brands: V2Brand[]): Promise<V2AdRow[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const { data } = await supabase.from('marketing_ads').select('brand_id,platform,is_active').limit(5000)
  const agg: Record<string, V2AdRow> = {}
  ;(data || []).forEach((a: any) => {
    const slug = slugByBid[a.brand_id]
    if (!slug) return
    if (!agg[slug]) agg[slug] = { brand: slug, total: 0, meta: 0, google: 0, active: 0, share: 0 }
    agg[slug].total++
    if (a.platform === 'meta') agg[slug].meta++
    if (a.platform === 'google') agg[slug].google++
    if (a.is_active) agg[slug].active++
  })
  const rows = brands.map((b) => agg[b.id] || { brand: b.id, total: 0, meta: 0, google: 0, active: 0, share: 0 })
  const totalAll = rows.reduce((s, r) => s + r.total, 0) || 1
  rows.forEach((r) => (r.share = (r.total / totalAll) * 100))
  return rows.sort((a, b) => b.total - a.total)
}

// ─── Promotions ──────────────────────────────────────────────────────
export type V2PromoRow = { brand: string; count: number; types: string[]; pct: number }

export async function fetchPromos(brands: V2Brand[]): Promise<V2PromoRow[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const { data } = await supabase.from('promotions').select('brand_id,promo_type').limit(1000)
  const agg: Record<string, V2PromoRow> = {}
  ;(data || []).forEach((p: any) => {
    const slug = slugByBid[p.brand_id]
    if (!slug) return
    if (!agg[slug]) agg[slug] = { brand: slug, count: 0, types: [], pct: 0 }
    agg[slug].count++
    if (p.promo_type && !agg[slug].types.includes(p.promo_type)) agg[slug].types.push(p.promo_type)
  })
  const rows = brands.map((b) => agg[b.id] || { brand: b.id, count: 0, types: [], pct: 0 })
  const totalAll = rows.reduce((s, r) => s + r.count, 0) || 1
  rows.forEach((r) => (r.pct = (r.count / totalAll) * 100))
  return rows.sort((a, b) => b.count - a.count)
}

// ─── Products (price distribution per brand) ─────────────────────────
export type V2ProductRow = { brand: string; count: number; avg: number; min: number; med: number; max: number }

export async function fetchProductStats(brands: V2Brand[]): Promise<V2ProductRow[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const { data } = await supabase.from('products').select('brand_id,price_usd').limit(2000)
  const buckets: Record<string, number[]> = {}
  const counts: Record<string, number> = {}
  ;(data || []).forEach((p: any) => {
    const slug = slugByBid[p.brand_id]
    if (!slug) return
    counts[slug] = (counts[slug] || 0) + 1
    if (p.price_usd != null) {
      // Defensive guard: drop scraping artifacts. Pickleball paddles are $50-$500.
      // Outliers like $52,598 (Selkirk row) come from scrape misalignment (size code parsed as price).
      if (p.price_usd > 500 || p.price_usd <= 0) return
      if (!buckets[slug]) buckets[slug] = []
      buckets[slug].push(p.price_usd)
    }
  })
  return brands
    .map((b) => {
      const prices = (buckets[b.id] || []).slice().sort((a, c) => a - c)
      const count = counts[b.id] || 0
      const avg = prices.length ? prices.reduce((s, x) => s + x, 0) / prices.length : 0
      const min = prices[0] ?? 0
      const max = prices[prices.length - 1] ?? 0
      const med = prices.length ? prices[Math.floor(prices.length / 2)] : 0
      return { brand: b.id, count, avg: Math.round(avg), min: Math.round(min), med: Math.round(med), max: Math.round(max) }
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
}

// ─── YouTube (channel + videos) ──────────────────────────────────────
export type V2YTRow = { brand: string; subs: number; videos: number; views: number; delta: number | null }

export async function fetchYT(brands: V2Brand[]): Promise<V2YTRow[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const [{ data: ch }, { data: vids }] = await Promise.all([
    supabase.from('yt_channel_weekly').select('brand_id,subscribers,total_videos,total_views,year,week_number').order('year', { ascending: false }).order('week_number', { ascending: false }),
    supabase.from('yt_videos').select('brand_id,view_count').limit(2000),
  ])
  const latestByBrand: Record<string, any> = {}
  ;(ch || []).forEach((c: any) => {
    const slug = slugByBid[c.brand_id]
    if (!slug) return
    if (!latestByBrand[slug]) latestByBrand[slug] = c
  })
  const videosByBrand: Record<string, { n: number; views: number }> = {}
  ;(vids || []).forEach((v: any) => {
    const slug = slugByBid[v.brand_id]
    if (!slug) return
    if (!videosByBrand[slug]) videosByBrand[slug] = { n: 0, views: 0 }
    videosByBrand[slug].n++
    videosByBrand[slug].views += v.view_count || 0
  })
  return brands
    .map((b) => ({
      brand: b.id,
      subs: latestByBrand[b.id]?.subscribers || 0,
      videos: videosByBrand[b.id]?.n || latestByBrand[b.id]?.total_videos || 0,
      views: videosByBrand[b.id]?.views || latestByBrand[b.id]?.total_views || 0,
      delta: null,
    }))
    .sort((a, b) => b.subs - a.subs)
}

// ─── Reddit mentions ─────────────────────────────────────────────────
export type V2RedditRow = { brand: string; mentions: number; positive: number; neutral: number; negative: number; delta: number | null }

// ─── Contextual guard for generic-name brands ────────────────────────
// Some brand slugs collide with common English / non-pickleball terms
// (e.g. "gamma" → r/spain, r/lasplamas; "head" → tennis racquets, hair).
// For these brands we only count a mention if its text/subreddit ALSO
// carries a pickleball-context token. Brands NOT in this map pass through.
const PICKLEBALL_CONTEXT_TOKENS = [
  'pickleball', 'paddle', 'pickle ball', 'pickleballer', 'pickler',
]
const REDDIT_BRAND_CONTEXT_REQUIRED: Record<string, string[]> = {
  // Gamma Sports paddle line ("rzr", "needle", "compass") + general gamma sports refs
  gamma: [...PICKLEBALL_CONTEXT_TOKENS, 'gamma sports', 'rzr', 'needle', 'compass'],
  // HEAD has tennis + hair + generic-word collisions; require pickleball context
  // OR an explicit HEAD paddle line name.
  head: [...PICKLEBALL_CONTEXT_TOKENS, 'head pickleball', 'radical', 'gravity', 'extreme tour'],
}

/**
 * Returns true if this reddit row should be counted for the given brand slug.
 * For generic-name brands we require a pickleball-context token in the
 * combined text (subreddit + title + body). Other brands always pass.
 */
function redditRowPassesBrandContext(slug: string, row: any): boolean {
  const required = REDDIT_BRAND_CONTEXT_REQUIRED[slug]
  if (!required) return true
  const blob = `${row.subreddit || ''} ${row.title || ''} ${row.body || ''}`.toLowerCase()
  return required.some((tok) => blob.includes(tok))
}

export async function fetchReddit(brands: V2Brand[]): Promise<V2RedditRow[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  // Pull title/body/subreddit so we can apply the generic-name brand context guard.
  // Schema (migration 006_enrichment_columns.sql) renamed sentiment → sentiment_label;
  // use PostgREST alias `sentiment:sentiment_label` so downstream code keeps reading `r.sentiment`.
  const { data } = await supabase
    .from('reddit_mentions')
    .select('brand_id,sentiment:sentiment_label,subreddit,title,body')
    .limit(3000)
  const agg: Record<string, V2RedditRow> = {}
  ;(data || []).forEach((r: any) => {
    const slug = slugByBid[r.brand_id]
    if (!slug) return
    if (!redditRowPassesBrandContext(slug, r)) return
    if (!agg[slug]) agg[slug] = { brand: slug, mentions: 0, positive: 0, neutral: 0, negative: 0, delta: null }
    agg[slug].mentions++
    if (r.sentiment === 'positive') agg[slug].positive++
    else if (r.sentiment === 'negative') agg[slug].negative++
    else agg[slug].neutral++
  })
  return Object.values(agg).sort((a, b) => b.mentions - a.mentions)
}

// ─── Influencers ─────────────────────────────────────────────────────
export type V2InfluencerRow = {
  id: string;
  name: string; brand: string; followers: number; posts: number;
  avgLikes: number; engRate: number; init: string;
  /** Instagram handle (no @ prefix) — present when the athlete row has one. */
  igHandle?: string;
  /** X / Twitter handle (no @ prefix) — present when the athlete row has one. */
  xHandle?: string;
}

export async function fetchInfluencers(brands: V2Brand[]): Promise<V2InfluencerRow[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const [{ data: infs }, { data: posts }] = await Promise.all([
    supabase.from('influencers').select('id,name,brand_id,follower_count_ig,instagram_handle,x_handle').order('follower_count_ig', { ascending: false }),
    supabase.from('influencer_posts').select('influencer_id,like_count,comment_count').limit(2000),
  ])
  const eng: Record<string, { likes: number; comments: number; n: number }> = {}
  ;(posts || []).forEach((p: any) => {
    if (!eng[p.influencer_id]) eng[p.influencer_id] = { likes: 0, comments: 0, n: 0 }
    eng[p.influencer_id].likes += p.like_count || 0
    eng[p.influencer_id].comments += p.comment_count || 0
    eng[p.influencer_id].n++
  })
  return (infs || [])
    .map((i: any) => {
      const e = eng[i.id] || { likes: 0, comments: 0, n: 0 }
      const avgLikes = e.n ? e.likes / e.n : 0
      const avgComments = e.n ? e.comments / e.n : 0
      const engRate = (i.follower_count_ig || 0) > 0
        ? ((avgLikes + avgComments) / (i.follower_count_ig as number)) * 100
        : 0
      const init = (i.name || '?').split(' ').map((s: string) => s[0]).slice(0, 2).join('').toUpperCase()
      return {
        id: i.id,
        name: i.name,
        brand: slugByBid[i.brand_id] || 'unknown',
        followers: i.follower_count_ig || 0,
        posts: e.n,
        avgLikes: Math.round(avgLikes),
        engRate: Number(engRate.toFixed(2)),
        init,
        igHandle: i.instagram_handle || undefined,
        xHandle: i.x_handle || undefined,
      }
    })
    .filter((r) => r.followers > 0)
    .sort((a, b) => b.engRate - a.engRate)
}

// ─── Ad sample (latest creatives) ────────────────────────────────────
export type V2AdSample = {
  brand: string; platform: 'Meta' | 'Google'; copy: string; cta: string; started: string; active: boolean
}

export async function fetchAdSample(brands: V2Brand[], limit = 12): Promise<V2AdSample[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const { data } = await supabase
    .from('marketing_ads')
    .select('brand_id,platform,body,cta,started_at,is_active,captured_at')
    .order('captured_at', { ascending: false })
    .limit(limit * 4)
  return (data || []).slice(0, limit).map((a: any) => ({
    brand: slugByBid[a.brand_id] || 'unknown',
    platform: a.platform === 'meta' ? 'Meta' : 'Google',
    copy: a.body || '',
    cta: a.cta || '',
    started: a.started_at ? new Date(a.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—',
    active: !!a.is_active,
  }))
}

// ─── Top IG posts (engagement-sorted) ────────────────────────────────
export type V2TopIGPost = {
  brand: string; handle: string; caption: string; likes: number; comments: number;
  views: number; format: string; days: number; engRate: number; url: string
}

export async function fetchTopIGPosts(brands: V2Brand[], limit = 200): Promise<V2TopIGPost[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  // Pull a wider pool so de-duplication (shortcode first, then post_id,
  // then permalink) still leaves us with the requested `limit` after
  // collapsing duplicate IG posts that snuck in over multiple scrapes.
  const { data } = await supabase
    .from('ig_posts')
    .select('brand_id,handle,caption,like_count,comment_count,view_count,post_format,posted_at,post_url,instagram_post_id')
    .order('like_count', { ascending: false })
    .limit(Math.max(limit * 3, 600))

  // Frontend dedupe — schema has no unique index on shortcode, so the
  // table is known to carry duplicates from re-scrapes. First-seen wins.
  const seen = new Map<string, V2TopIGPost>()
  ;(data || []).forEach((p: any) => {
    const key = (p.instagram_post_id || p.post_url || `${p.brand_id}::${(p.caption || '').slice(0, 80)}`).trim()
    if (!key || seen.has(key)) return
    const days = p.posted_at
      ? Math.max(0, Math.floor((Date.now() - new Date(p.posted_at).getTime()) / 86400000))
      : 0
    const url = p.post_url
      ? p.post_url
      : p.instagram_post_id
        ? `https://www.instagram.com/p/${p.instagram_post_id}/`
        : p.handle
          ? `https://www.instagram.com/${p.handle}/`
          : ''
    seen.set(key, {
      brand: slugByBid[p.brand_id] || 'unknown',
      handle: '@' + (p.handle || ''),
      caption: p.caption || '',
      likes: p.like_count || 0,
      comments: p.comment_count || 0,
      views: p.view_count || 0,
      format: p.post_format || 'Image',
      days,
      engRate: 0,
      url,
    })
  })
  return Array.from(seen.values()).slice(0, limit)
}

// ─── Top YT videos ───────────────────────────────────────────────────
export type V2TopYTVideo = {
  brand: string; title: string; views: number; likes: number; comments: number;
  duration: string; days: number; video_id: string; url: string; is_short: boolean
}

export async function fetchTopYTVideos(brands: V2Brand[], limit = 200): Promise<V2TopYTVideo[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  // `yt_videos.video_id` does NOT exist — the column is `youtube_video_id` (see
  // migration 011/012 + scrape_channels.py). The previous select silently
  // returned null video_ids which collapsed the watch link to a search query.
  const { data } = await supabase
    .from('yt_videos')
    .select('brand_id,youtube_video_id,video_url,title,view_count,like_count,comment_count,duration_seconds,published_at,is_short')
    .order('view_count', { ascending: false })
    .limit(limit)
  return (data || []).map((v: any) => {
    const sec = v.duration_seconds || 0
    const mm = Math.floor(sec / 60).toString().padStart(2, '0')
    const ss = (sec % 60).toString().padStart(2, '0')
    const days = v.published_at ? Math.max(0, Math.floor((Date.now() - new Date(v.published_at).getTime()) / 86400000)) : 0
    const vid = v.youtube_video_id || ''
    return {
      brand: slugByBid[v.brand_id] || 'unknown',
      title: v.title || '',
      views: v.view_count || 0,
      likes: v.like_count || 0,
      comments: v.comment_count || 0,
      duration: `${mm}:${ss}`,
      days,
      video_id: vid,
      url: v.video_url || (vid ? `https://www.youtube.com/watch?v=${vid}` : ''),
      is_short: !!v.is_short,
    }
  })
}

// ─── Top comments (cross-platform, top by likes) ────────────────────
//
// Platform enum is broad on purpose: 'ig' / 'yt' have full per-comment data
// in ig_comments / yt_comments; 'reddit' pulls from reddit_comments;
// 'tiktok' / 'x' currently surface POST-level commentary because we don't
// yet collect per-comment text for those sources. The page should reflect
// that honestly rather than pretend the platforms don't exist.
export type V2TopComment = {
  user: string; text: string; platform: 'ig' | 'yt' | 'reddit' | 'tiktok' | 'x'; brand: string; likes: number;
  sentiment: 'positive' | 'neutral' | 'negative'; days: number;
  /** Direct link to the original post the comment is attached to (preferred over commenter profile). */
  postUrl?: string;
  /** Fallback link — typically the commenter's profile or the parent post permalink. */
  profileUrl?: string;
}

const sentimentFromLabel = (label: unknown): 'positive' | 'neutral' | 'negative' => {
  const s = String(label || '').toLowerCase()
  if (s === 'positive' || s === 'pos') return 'positive'
  if (s === 'negative' || s === 'neg') return 'negative'
  return 'neutral'
}

export async function fetchTopComments(brands: V2Brand[], limit = 12): Promise<V2TopComment[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  // IG/YT comments include post FK so we can join up to the post URL.
  // We pull post_id then resolve post_url / video_id in parallel.
  const [{ data: ig }, { data: yt }] = await Promise.all([
    supabase.from('ig_comments').select('brand_id,post_id,commenter_username,comment_text,comment_likes,posted_at,sentiment_label').order('comment_likes', { ascending: false }).limit(limit * 4),
    supabase.from('yt_comments').select('brand_id,video_id,commenter_username,comment_text,comment_likes,posted_at,sentiment_label').order('comment_likes', { ascending: false }).limit(limit * 4),
  ])

  // Resolve IG post → post_url + shortcode; YT video → video_id (public string)
  const igPostIds = Array.from(new Set((ig || []).map((c: any) => c.post_id).filter(Boolean)))
  const ytVideoFkIds = Array.from(new Set((yt || []).map((c: any) => c.video_id).filter(Boolean)))

  const [{ data: igPosts }, { data: ytVids }] = await Promise.all([
    igPostIds.length
      ? supabase.from('ig_posts').select('id,post_url,instagram_post_id,handle').in('id', igPostIds)
      : Promise.resolve({ data: [] as any[] }),
    ytVideoFkIds.length
      ? supabase.from('yt_videos').select('id,youtube_video_id,video_url').in('id', ytVideoFkIds)
      : Promise.resolve({ data: [] as any[] }),
  ])

  const igPostMap: Record<string, { post_url: string; shortcode: string; handle: string }> = {}
  ;(igPosts || []).forEach((p: any) => {
    igPostMap[p.id] = {
      post_url: p.post_url || (p.instagram_post_id ? `https://www.instagram.com/p/${p.instagram_post_id}/` : ''),
      shortcode: p.instagram_post_id || '',
      handle: p.handle || '',
    }
  })
  const ytVideoMap: Record<string, { url: string; vid: string }> = {}
  ;(ytVids || []).forEach((v: any) => {
    ytVideoMap[v.id] = {
      url: v.video_url || (v.youtube_video_id ? `https://www.youtube.com/watch?v=${v.youtube_video_id}` : ''),
      vid: v.youtube_video_id || '',
    }
  })

  const dayDiff = (ts: string | null) => ts ? Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)) : 0
  const merged: V2TopComment[] = [
    ...(ig || []).map((c: any): V2TopComment => {
      const post = igPostMap[c.post_id] || { post_url: '', shortcode: '', handle: '' }
      const user = (c.commenter_username || 'anon')
      return {
        user: '@' + user,
        text: c.comment_text || '',
        platform: 'ig',
        brand: slugByBid[c.brand_id] || 'unknown',
        likes: c.comment_likes || 0,
        sentiment: sentimentFromLabel(c.sentiment_label),
        days: dayDiff(c.posted_at),
        postUrl: post.post_url || undefined,
        profileUrl: user && user !== 'anon' ? `https://www.instagram.com/${user.replace(/^@/, '')}/` : undefined,
      }
    }),
    ...(yt || []).map((c: any): V2TopComment => {
      const video = ytVideoMap[c.video_id] || { url: '', vid: '' }
      const user = (c.commenter_username || 'anon')
      return {
        user: '@' + user,
        text: c.comment_text || '',
        platform: 'yt',
        brand: slugByBid[c.brand_id] || 'unknown',
        likes: c.comment_likes || 0,
        sentiment: sentimentFromLabel(c.sentiment_label),
        days: dayDiff(c.posted_at),
        postUrl: video.url || undefined,
        profileUrl: user && user !== 'anon' ? `https://www.youtube.com/@${user.replace(/^@/, '')}` : undefined,
      }
    }),
  ]
  return merged
    .filter((c) => c.text && c.text.trim() !== '' && c.text.trim() !== '—')
    .sort((a, b) => b.likes - a.likes)
    .slice(0, limit)
}

/** Top Reddit comments (per-comment text from reddit_comments table). */
export async function fetchTopRedditComments(brands: V2Brand[], limit = 30): Promise<V2TopComment[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const { data } = await supabase
    .from('reddit_comments')
    .select('brand_id,parent_post_id,subreddit,author,comment_text,upvotes,posted_at,sentiment_label')
    .order('upvotes', { ascending: false })
    .limit(limit * 2)

  // Resolve parent_post_id → url so we can link comments back to their thread.
  const parentIds = Array.from(new Set((data || []).map((c: any) => c.parent_post_id).filter(Boolean)))
  const { data: parents } = parentIds.length
    ? await supabase.from('reddit_mentions').select('id,url,subreddit').in('id', parentIds)
    : { data: [] as any[] }
  const parentMap: Record<string, { url: string }> = {}
  ;(parents || []).forEach((p: any) => { parentMap[p.id] = { url: p.url || '' } })

  const dayDiff = (ts: string | null) => ts ? Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)) : 0
  return (data || [])
    .filter((c: any) => c.comment_text && String(c.comment_text).trim() !== '' && String(c.comment_text).trim() !== '—')
    .map((c: any): V2TopComment => ({
      user: c.author ? 'u/' + String(c.author).replace(/^u\//, '') : 'u/anon',
      text: c.comment_text || '',
      platform: 'reddit',
      brand: slugByBid[c.brand_id] || 'unknown',
      likes: c.upvotes || 0,
      sentiment: sentimentFromLabel(c.sentiment_label),
      days: dayDiff(c.posted_at),
      postUrl: parentMap[c.parent_post_id]?.url || undefined,
      profileUrl: c.author ? `https://www.reddit.com/user/${String(c.author).replace(/^u\//, '')}/` : undefined,
    }))
    .slice(0, limit)
}

// ─── Cached overview bundle ──────────────────────────────────────────
export type V2Overview = {
  brands: V2Brand[]
  ig: V2IGRow[]
  ads: V2AdRow[]
  promos: V2PromoRow[]
  products: V2ProductRow[]
  yt: V2YTRow[]
  reddit: V2RedditRow[]
  influencers: V2InfluencerRow[]
  adSample: V2AdSample[]
  topIGPosts: V2TopIGPost[]
  topYTVideos: V2TopYTVideo[]
  topComments: V2TopComment[]
}

// ─── YT subscriber trend (per brand, chronological) ─────────────────
export async function fetchYTTrend(brands: V2Brand[]): Promise<Record<string, number[]>> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const { data } = await supabase
    .from('yt_channel_weekly')
    .select('brand_id,subscribers,year,week_number')
    .order('year', { ascending: true })
    .order('week_number', { ascending: true })
  const trend: Record<string, number[]> = {}
  ;(data || []).forEach((c: any) => {
    const slug = slugByBid[c.brand_id]
    if (!slug) return
    if (!trend[slug]) trend[slug] = []
    trend[slug].push(c.subscribers || 0)
  })
  return trend
}

// ─── Reddit weekly mention trend (binned from posted_at) ─────────────
export async function fetchRedditTrend(brands: V2Brand[]): Promise<Record<string, number[]>> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const { data } = await supabase
    .from('reddit_mentions')
    .select('brand_id,posted_at,subreddit,title,body')
    .limit(5000)
  const now = Date.now()
  const buckets: Record<string, number[]> = {}
  ;(data || []).forEach((r: any) => {
    const slug = slugByBid[r.brand_id]
    if (!slug || !r.posted_at) return
    if (!redditRowPassesBrandContext(slug, r)) return
    const daysAgo = Math.floor((now - new Date(r.posted_at).getTime()) / 86400000)
    const weekIdx = Math.min(7, Math.floor(daysAgo / 7))
    if (!buckets[slug]) buckets[slug] = Array(8).fill(0)
    if (weekIdx < 8) buckets[slug][7 - weekIdx]++
  })
  return buckets
}

// ─── Reddit subreddit distribution ───────────────────────────────────
export type V2Subreddit = { name: string; mentions: number; joolaShare: number }

export async function fetchRedditSubreddits(brands: V2Brand[]): Promise<V2Subreddit[]> {
  const joolaIds = new Set(brands.filter((b) => b.joola).map((b) => b.brand_id))
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const { data } = await supabase
    .from('reddit_mentions')
    .select('brand_id,subreddit,title,body')
    .limit(5000)
  const bySubreddit: Record<string, { total: number; joola: number }> = {}
  ;(data || []).forEach((r: any) => {
    const slug = slugByBid[r.brand_id]
    if (slug && !redditRowPassesBrandContext(slug, r)) return
    const sub = r.subreddit || 'other'
    if (!bySubreddit[sub]) bySubreddit[sub] = { total: 0, joola: 0 }
    bySubreddit[sub].total++
    if (joolaIds.has(r.brand_id)) bySubreddit[sub].joola++
  })
  return Object.entries(bySubreddit)
    .map(([name, v]) => ({
      name: name.startsWith('r/') ? name : 'r/' + name,
      mentions: v.total,
      joolaShare: Math.round((v.joola / Math.max(1, v.total)) * 100),
    }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 6)
}

// ─── Top Reddit mentions (drill-down table) ──────────────────────────
export type V2RedditMention = {
  brand: string; subreddit: string; title: string; body: string;
  score: number; comments: number; url: string; days: number
}

export async function fetchTopRedditMentions(brands: V2Brand[], limit = 20): Promise<V2RedditMention[]> {
  const slugByBid: Record<string, string> = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  // Over-fetch so the post-filter still returns ~limit rows after dropping
  // generic-name brand false positives (gamma in r/spain, head/tennis, etc.)
  const { data } = await supabase
    .from('reddit_mentions')
    .select('brand_id,subreddit,title,body,score,num_comments,url,posted_at')
    .order('score', { ascending: false })
    .limit(Math.max(limit * 3, 60))
  return (data || [])
    .filter((m: any) => {
      const slug = slugByBid[m.brand_id]
      return !slug || redditRowPassesBrandContext(slug, m)
    })
    .slice(0, limit)
    .map((m: any) => ({
      brand: slugByBid[m.brand_id] || 'unknown',
      subreddit: m.subreddit || '',
      title: m.title || '',
      body: m.body || '',
      score: m.score || 0,
      comments: m.num_comments || 0,
      url: m.url || '',
      days: m.posted_at
        ? Math.max(0, Math.floor((Date.now() - new Date(m.posted_at).getTime()) / 86400000))
        : 0,
    }))
}

// ─── IG comment mentions (paddle/player NER from mention_facts) ──────
// mention_facts is fully populated for IG comments (channel='ig_comment').
// Each row carries an optional product_id (paddle) and/or athlete_id
// (player) extracted by the AI enrichment step. We aggregate by brand
// (mention target) for the two-column "Paddle mentions / Player mentions"
// section at the bottom of the Instagram page.
export type V2IGMentionRow = {
  brand: string        // brand being talked ABOUT
  entityName: string   // paddle name or athlete name
  mentions: number     // raw count of comments referencing the entity
  positive: number     // sentiment_label='positive'
  negative: number     // sentiment_label='negative'
}

export async function fetchIGCommentMentions(
  brands: V2Brand[],
  kind: 'paddle' | 'player',
  limit = 200,
): Promise<V2IGMentionRow[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const entityCol = kind === 'paddle' ? 'product_id' : 'athlete_id'

  const { data, error } = await supabase
    .from('mention_facts')
    .select(`brand_id,${entityCol},sentiment_label`)
    .eq('channel', 'ig_comment')
    .not(entityCol, 'is', null)
    .limit(10_000)

  if (error || !data) return []

  // Resolve entity_id → display name (paddles via products_catalog, players via influencers)
  const ids = Array.from(new Set(data.map((r: any) => r[entityCol]).filter(Boolean)))
  if (ids.length === 0) return []

  const nameMap: Record<string, string> = {}
  if (kind === 'paddle') {
    const { data: prods } = await supabase
      .from('products_catalog')
      .select('id,name')
      .in('id', ids)
    ;(prods || []).forEach((p: any) => { nameMap[p.id] = p.name })
  } else {
    const { data: ath } = await supabase
      .from('influencers')
      .select('id,name')
      .in('id', ids)
    ;(ath || []).forEach((a: any) => { nameMap[a.id] = a.name })
  }

  // Aggregate by (brand_id, entity_id)
  const agg: Record<string, V2IGMentionRow> = {}
  data.forEach((r: any) => {
    const slug = slugByBid[r.brand_id]
    const entityId = r[entityCol]
    if (!slug || !entityId) return
    const name = nameMap[entityId]
    if (!name) return
    const key = `${slug}::${entityId}`
    if (!agg[key]) agg[key] = { brand: slug, entityName: name, mentions: 0, positive: 0, negative: 0 }
    agg[key].mentions++
    const s = String(r.sentiment_label || '').toLowerCase()
    if (s === 'positive') agg[key].positive++
    else if (s === 'negative') agg[key].negative++
  })
  return Object.values(agg)
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, limit)
}

// ─── IG post frequency heatmap (4 weeks × 7 days, Mon-first) ─────────
export async function fetchPostFrequency(brands: V2Brand[]): Promise<Record<string, number[][]>> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const { data } = await supabase
    .from('ig_posts')
    .select('brand_id,posted_at')
    .order('posted_at', { ascending: false })
    .limit(2000)
  const now = Date.now()
  const freq: Record<string, number[][]> = {}
  brands.forEach((b) => { freq[b.id] = Array.from({ length: 4 }, () => Array(7).fill(0)) })
  ;(data || []).forEach((p: any) => {
    const slug = slugByBid[p.brand_id]
    if (!slug || !p.posted_at) return
    const daysAgo = Math.floor((now - new Date(p.posted_at).getTime()) / 86400000)
    if (daysAgo >= 28) return
    const weekIdx = Math.min(3, Math.floor(daysAgo / 7))
    const monFirst = (new Date(p.posted_at).getDay() + 6) % 7
    freq[slug][3 - weekIdx][monFirst]++
  })
  return freq
}

// ─── Promotion detail rows ────────────────────────────────────────────
export type V2PromoDetail = { brand: string; banner: string; type: string | null; discount: number | null; detectedAt: string | null }

export async function fetchPromoDetails(brands: V2Brand[]): Promise<V2PromoDetail[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const { data } = await supabase
    .from('promotions')
    .select('brand_id,banner_text,promo_type,discount_pct,detected_at')
    .order('detected_at', { ascending: false })
    .limit(200)
  return (data || []).map((p: any) => ({
    brand: slugByBid[p.brand_id] || 'unknown',
    banner: p.banner_text || '',
    type: p.promo_type,
    discount: p.discount_pct != null ? Number(p.discount_pct) : null,
    detectedAt: p.detected_at,
  }))
}

// ─── Products full list ───────────────────────────────────────────────
export type V2ProductItem = {
  brand: string
  name: string
  price: number | null
  salePrice: number | null
  discountPct: number | null
  rating: number | null
  reviewCount: number | null
  category: string | null
  inStock: boolean
  lastScrapedAt: string | null
}

export async function fetchProductsList(brands: V2Brand[], limit = 500): Promise<V2ProductItem[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const { data } = await supabase
    .from('products')
    .select('brand_id,name,price_usd,sale_price_usd,discount_pct,avg_rating,review_count,category,in_stock,last_scraped_at')
    .order('price_usd', { ascending: false })
    .limit(limit)
  return (data || []).map((p: any) => ({
    brand: slugByBid[p.brand_id] || 'unknown',
    name: p.name || '',
    price: p.price_usd != null ? Number(p.price_usd) : null,
    salePrice: p.sale_price_usd != null ? Number(p.sale_price_usd) : null,
    discountPct: p.discount_pct != null ? Number(p.discount_pct) : null,
    rating: p.avg_rating != null ? Number(p.avg_rating) : null,
    reviewCount: p.review_count != null ? Number(p.review_count) : null,
    category: p.category,
    inStock: p.in_stock ?? true,
    lastScrapedAt: p.last_scraped_at || null,
  }))
}

// ─── Comment counts per brand (IG + YT) ──────────────────────────────
export type V2CommentCount = { brand: string; ig: number; yt: number; total: number }

export async function fetchCommentCounts(brands: V2Brand[]): Promise<V2CommentCount[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const [{ data: ig }, { data: yt }] = await Promise.all([
    supabase.from('ig_comments').select('brand_id').limit(10000),
    supabase.from('yt_comments').select('brand_id').limit(10000),
  ])
  const igC: Record<string, number> = {}
  const ytC: Record<string, number> = {}
  ;(ig || []).forEach((c: any) => { const s = slugByBid[c.brand_id]; if (s) igC[s] = (igC[s] || 0) + 1 })
  ;(yt || []).forEach((c: any) => { const s = slugByBid[c.brand_id]; if (s) ytC[s] = (ytC[s] || 0) + 1 })
  return brands
    .map((b) => ({ brand: b.id, ig: igC[b.id] || 0, yt: ytC[b.id] || 0, total: (igC[b.id] || 0) + (ytC[b.id] || 0) }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
}

// ─── SEO: keyword rankings ────────────────────────────────────────────
export type V2KeywordRanking = {
  keyword: string
  brand: string
  position: number | null
  volume: number
  difficulty: number
  url: string
  recordedAt: string
}

export type V2KeywordTrend = {
  keyword: string
  brand: string
  history: { date: string; position: number | null }[]
  latestPosition: number | null
  volume: number
  difficulty: number
}

export async function fetchKeywordRankings(brands: V2Brand[]): Promise<V2KeywordTrend[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const { data } = await supabase
    .from('keyword_rankings')
    .select('brand_id,keyword,position,search_volume,difficulty,url,recorded_at')
    .order('recorded_at', { ascending: false })
    .limit(2000)

  // Group by brand+keyword, collect chronological history
  const byKey: Record<string, { keyword: string; brand: string; history: { date: string; position: number | null }[]; volume: number; difficulty: number }> = {}
  ;(data || []).forEach((r: any) => {
    const slug = slugByBid[r.brand_id]
    if (!slug) return
    const key = `${slug}::${r.keyword}`
    if (!byKey[key]) byKey[key] = { keyword: r.keyword, brand: slug, history: [], volume: r.search_volume || 0, difficulty: r.difficulty || 0 }
    byKey[key].history.push({ date: r.recorded_at ? r.recorded_at.slice(0, 10) : '', position: r.position })
  })

  return Object.values(byKey)
    .map((k) => {
      const sorted = k.history.slice().sort((a, b) => a.date.localeCompare(b.date))
      return { ...k, history: sorted, latestPosition: sorted[sorted.length - 1]?.position ?? null }
    })
    .filter((k) => k.latestPosition !== null)
    .sort((a, b) => (a.latestPosition ?? 999) - (b.latestPosition ?? 999))
    .slice(0, 40)
}

// ─── SEO: crawl coverage ──────────────────────────────────────────────
export type V2CrawlSummary = {
  brand: string
  total: number
  ok: number       // 2xx
  redirect: number // 3xx
  clientErr: number // 4xx
  serverErr: number // 5xx
  avgOnPageScore: number
  crawlDate: string
}

export async function fetchCrawlSummary(brands: V2Brand[]): Promise<V2CrawlSummary[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const { data } = await supabase
    .from('crawl_pages')
    .select('brand_id,http_status,on_page_score,crawl_date')
    .order('crawl_date', { ascending: false })
    .limit(5000)

  const byBrand: Record<string, V2CrawlSummary> = {}
  ;(data || []).forEach((p: any) => {
    const slug = slugByBid[p.brand_id]
    if (!slug) return
    if (!byBrand[slug]) byBrand[slug] = { brand: slug, total: 0, ok: 0, redirect: 0, clientErr: 0, serverErr: 0, avgOnPageScore: 0, crawlDate: p.crawl_date || '' }
    byBrand[slug].total++
    const s = p.http_status || 0
    if (s >= 200 && s < 300) byBrand[slug].ok++
    else if (s >= 300 && s < 400) byBrand[slug].redirect++
    else if (s >= 400 && s < 500) byBrand[slug].clientErr++
    else if (s >= 500) byBrand[slug].serverErr++
    byBrand[slug].avgOnPageScore += p.on_page_score || 0
  })

  return Object.values(byBrand).map((r) => ({
    ...r,
    avgOnPageScore: r.total > 0 ? Math.round(r.avgOnPageScore / r.total) : 0,
  })).sort((a, b) => b.total - a.total)
}

// ─── SEO: on-page score trend (weekly avg per brand) ─────────────────
export type V2OnPageTrend = { brand: string; dates: string[]; scores: number[] }

export async function fetchOnPageScoreTrend(brands: V2Brand[]): Promise<V2OnPageTrend[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const { data } = await supabase
    .from('crawl_pages')
    .select('brand_id,on_page_score,crawl_date')
    .order('crawl_date', { ascending: true })
    .limit(5000)

  const byBrandDate: Record<string, Record<string, { sum: number; n: number }>> = {}
  ;(data || []).forEach((p: any) => {
    const slug = slugByBid[p.brand_id]
    if (!slug || p.on_page_score == null) return
    const d = p.crawl_date || ''
    if (!byBrandDate[slug]) byBrandDate[slug] = {}
    if (!byBrandDate[slug][d]) byBrandDate[slug][d] = { sum: 0, n: 0 }
    byBrandDate[slug][d].sum += p.on_page_score
    byBrandDate[slug][d].n++
  })

  return Object.entries(byBrandDate).map(([slug, dateMap]) => {
    const sorted = Object.keys(dateMap).sort()
    return {
      brand: slug,
      dates: sorted,
      scores: sorted.map((d) => Math.round(dateMap[d].sum / dateMap[d].n)),
    }
  })
}

// ─── SEO: content brief pipeline ─────────────────────────────────────
export type V2BriefStats = {
  brand: string
  pending: number
  drafted: number
  published: number
  cancelled: number
  total: number
  completionRate: number
}

export async function fetchContentBriefStats(brands: V2Brand[]): Promise<V2BriefStats[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const { data } = await supabase
    .from('content_briefs')
    .select('brand_id,status')
    .limit(2000)

  const agg: Record<string, V2BriefStats> = {}
  ;(data || []).forEach((b: any) => {
    const slug = slugByBid[b.brand_id]
    if (!slug) return
    if (!agg[slug]) agg[slug] = { brand: slug, pending: 0, drafted: 0, published: 0, cancelled: 0, total: 0, completionRate: 0 }
    agg[slug].total++
    const st = b.status || 'pending'
    if (st === 'pending') agg[slug].pending++
    else if (st === 'drafted') agg[slug].drafted++
    else if (st === 'published') agg[slug].published++
    else if (st === 'cancelled') agg[slug].cancelled++
  })

  return Object.values(agg).map((r) => ({
    ...r,
    completionRate: r.total > 0 ? Math.round((r.published / r.total) * 100) : 0,
  })).sort((a, b) => b.total - a.total)
}

// ─── SEO bundle ───────────────────────────────────────────────────────
export type V2SeoData = {
  brands: V2Brand[]
  keywordTrends: V2KeywordTrend[]
  crawlSummary: V2CrawlSummary[]
  onPageTrend: V2OnPageTrend[]
  briefStats: V2BriefStats[]
}

export async function fetchSeoData(): Promise<V2SeoData> {
  const brands = await fetchBrands()
  const [keywordTrends, crawlSummary, onPageTrend, briefStats] = await Promise.all([
    fetchKeywordRankings(brands),
    fetchCrawlSummary(brands),
    fetchOnPageScoreTrend(brands),
    fetchContentBriefStats(brands),
  ])
  return { brands, keywordTrends, crawlSummary, onPageTrend, briefStats }
}

// ─── X (Twitter) ─────────────────────────────────────────────────────────────
export type V2XRow = {
  brand: string; handle: string; followers: number; following: number;
  tweets: number; engRate: number; delta: number | null; deltaPct: number | null; trend: number[]
}
export type V2XPost = {
  brand: string; handle: string; text: string; post_url: string;
  likes: number; retweets: number; replies: number; views: number; days: number
}

export async function fetchX(brands: V2Brand[]): Promise<V2XRow[]> {
  const slugByBid = Object.fromEntries(brands.map(b => [b.brand_id, b.id]))
  const [{ data: profiles }, { data: posts }] = await Promise.all([
    supabase.from('x_profiles_weekly').select('brand_id,handle,followers,following,tweet_count,week_number,year,scraped_at').order('scraped_at', { ascending: false }),
    supabase.from('x_posts').select('brand_id,like_count,retweet_count').limit(2000),
  ])
  const byBrand: Record<string, { current: number; following: number; tweetCount: number; trend: number[] }> = {}
  ;(profiles || []).forEach((p: any) => {
    const slug = slugByBid[p.brand_id]
    if (!slug) return
    if (!byBrand[slug]) byBrand[slug] = { current: 0, following: 0, tweetCount: 0, trend: [] }
    if (byBrand[slug].current === 0) { byBrand[slug].current = p.followers || 0; byBrand[slug].following = p.following || 0; byBrand[slug].tweetCount = p.tweet_count || 0 }
    if (byBrand[slug].trend.length < 8) byBrand[slug].trend.push(p.followers || 0)
  })
  const engAcc: Record<string, { likes: number; rts: number; n: number }> = {}
  ;(posts || []).forEach((p: any) => {
    const slug = slugByBid[p.brand_id]
    if (!slug) return
    if (!engAcc[slug]) engAcc[slug] = { likes: 0, rts: 0, n: 0 }
    engAcc[slug].likes += p.like_count || 0
    engAcc[slug].rts += p.retweet_count || 0
    engAcc[slug].n++
  })
  const rows = sb_get_x_handles()
  return brands.map(b => {
    const f = byBrand[b.id]?.current || 0
    const trendRaw = (byBrand[b.id]?.trend || []).slice().reverse()
    const trend = trendRaw.length ? trendRaw : [f]
    const prev = trend.length > 1 ? trend[trend.length - 2] : null
    const e = engAcc[b.id]
    const engRate = e?.n ? (e.likes + e.rts) / e.n : 0
    return {
      brand: b.id,
      handle: rows[b.id] || '',
      followers: f,
      following: byBrand[b.id]?.following || 0,
      tweets: e?.n || 0,
      engRate: Number(engRate.toFixed(2)),
      delta: prev !== null ? f - prev : null,
      deltaPct: prev && prev > 0 ? ((f - prev) / prev) * 100 : null,
      trend,
    }
  }).sort((a, b) => b.followers - a.followers)
}

// Mirrors the seed in migrations/003_x_tiktok.sql (single source of truth).
// Brands intentionally omitted have no confirmed pickleball-specific X account
// (crbn, six-zero, engage, paddletek, prokennex — see migration 003 verification
// policy). Also removed 2026-05-24:
//   - franklin: FranklinSports is parent corporate account, not pickleball arm
//   - head:     head_tennis is HEAD's tennis arm, not pickleball
function sb_get_x_handles(): Record<string, string> {
  return {
    joola:    'joolapickleball',
    selkirk:  'SelkirkSport',
    onix:     'OnixPickleball',
    wilson:   'WilsonSportingG',
    gamma:    'gammapickleball',
  }
}

export async function fetchXTrend(brands: V2Brand[]): Promise<Record<string, number[]>> {
  const slugByBid = Object.fromEntries(brands.map(b => [b.brand_id, b.id]))
  const { data } = await supabase.from('x_profiles_weekly').select('brand_id,followers,year,week_number').order('year', { ascending: true }).order('week_number', { ascending: true })
  const trend: Record<string, number[]> = {}
  ;(data || []).forEach((c: any) => {
    const slug = slugByBid[c.brand_id]
    if (!slug) return
    if (!trend[slug]) trend[slug] = []
    trend[slug].push(c.followers || 0)
  })
  return trend
}

export async function fetchTopXPosts(brands: V2Brand[], limit = 200): Promise<V2XPost[]> {
  const slugByBid = Object.fromEntries(brands.map(b => [b.brand_id, b.id]))
  const { data } = await supabase.from('x_posts').select('brand_id,handle,tweet_id,post_url,text,like_count,retweet_count,reply_count,view_count,posted_at').order('like_count', { ascending: false }).limit(limit)
  return (data || []).map((p: any) => ({
    brand: slugByBid[p.brand_id] || 'unknown',
    handle: '@' + (p.handle || ''),
    text: p.text || '',
    post_url: p.post_url || '',
    likes: p.like_count || 0,
    retweets: p.retweet_count || 0,
    replies: p.reply_count || 0,
    views: p.view_count || 0,
    days: p.posted_at ? Math.max(0, Math.floor((Date.now() - new Date(p.posted_at).getTime()) / 86400000)) : 0,
  }))
}

// ─── TikTok ───────────────────────────────────────────────────────────────────
export type V2TikTokRow = {
  brand: string; handle: string; followers: number; following: number;
  videos: number; totalHearts: number; avgViews: number; delta: number | null; deltaPct: number | null; trend: number[]
}
export type V2TikTokVideo = {
  brand: string; handle: string; text: string; video_url: string;
  views: number; likes: number; comments: number; shares: number; days: number
}

export async function fetchTikTok(brands: V2Brand[]): Promise<V2TikTokRow[]> {
  const slugByBid = Object.fromEntries(brands.map(b => [b.brand_id, b.id]))
  const [{ data: profiles }, { data: vids }] = await Promise.all([
    supabase.from('tiktok_profiles_weekly').select('brand_id,handle,followers,following,video_count,total_hearts,week_number,year,scraped_at').order('scraped_at', { ascending: false }),
    supabase.from('tiktok_videos').select('brand_id,view_count').limit(3000),
  ])
  const byBrand: Record<string, { current: number; following: number; videoCount: number; hearts: number; trend: number[] }> = {}
  ;(profiles || []).forEach((p: any) => {
    const slug = slugByBid[p.brand_id]
    if (!slug) return
    if (!byBrand[slug]) byBrand[slug] = { current: 0, following: 0, videoCount: 0, hearts: 0, trend: [] }
    if (byBrand[slug].current === 0) { byBrand[slug].current = p.followers || 0; byBrand[slug].following = p.following || 0; byBrand[slug].videoCount = p.video_count || 0; byBrand[slug].hearts = p.total_hearts || 0 }
    if (byBrand[slug].trend.length < 8) byBrand[slug].trend.push(p.followers || 0)
  })
  const viewAcc: Record<string, { total: number; n: number }> = {}
  ;(vids || []).forEach((v: any) => {
    const slug = slugByBid[v.brand_id]
    if (!slug) return
    if (!viewAcc[slug]) viewAcc[slug] = { total: 0, n: 0 }
    viewAcc[slug].total += v.view_count || 0
    viewAcc[slug].n++
  })
  const handles = sb_get_tiktok_handles()
  return brands.map(b => {
    const f = byBrand[b.id]?.current || 0
    const trendRaw = (byBrand[b.id]?.trend || []).slice().reverse()
    const trend = trendRaw.length ? trendRaw : [f]
    const prev = trend.length > 1 ? trend[trend.length - 2] : null
    const va = viewAcc[b.id]
    const avgViews = va?.n ? va.total / va.n : 0
    return {
      brand: b.id,
      handle: handles[b.id] || '',
      followers: f,
      following: byBrand[b.id]?.following || 0,
      videos: va?.n || byBrand[b.id]?.videoCount || 0,
      totalHearts: byBrand[b.id]?.hearts || 0,
      avgViews: Number(avgViews.toFixed(0)),
      delta: prev !== null ? f - prev : null,
      deltaPct: prev && prev > 0 ? ((f - prev) / prev) * 100 : null,
      trend,
    }
  }).sort((a, b) => b.followers - a.followers)
}

function sb_get_tiktok_handles(): Record<string, string> {
  return {
    joola: 'joolapickleball', selkirk: 'selkirksport', crbn: 'crbnpickleball',
    engage: 'engage_pickleball',
    'six-zero': 'sixzeropickleball', onix: 'onix_pickleball',
    wilson: 'wilsonsportinggoods', gamma: 'gammasports', prokennex: 'prokennexpickleball',
  }
}

export async function fetchTikTokTrend(brands: V2Brand[]): Promise<Record<string, number[]>> {
  const slugByBid = Object.fromEntries(brands.map(b => [b.brand_id, b.id]))
  const { data } = await supabase.from('tiktok_profiles_weekly').select('brand_id,followers,year,week_number').order('year', { ascending: true }).order('week_number', { ascending: true })
  const trend: Record<string, number[]> = {}
  ;(data || []).forEach((c: any) => {
    const slug = slugByBid[c.brand_id]
    if (!slug) return
    if (!trend[slug]) trend[slug] = []
    trend[slug].push(c.followers || 0)
  })
  return trend
}

export async function fetchTopTikTokVideos(brands: V2Brand[], limit = 200): Promise<V2TikTokVideo[]> {
  const slugByBid = Object.fromEntries(brands.map(b => [b.brand_id, b.id]))
  const { data } = await supabase.from('tiktok_videos').select('brand_id,handle,tiktok_video_id,video_url,text,view_count,like_count,comment_count,share_count,posted_at').order('view_count', { ascending: false }).limit(limit)
  return (data || []).map((v: any) => ({
    brand: slugByBid[v.brand_id] || 'unknown',
    handle: '@' + (v.handle || ''),
    text: v.text || '',
    video_url: v.video_url || '',
    views: Number(v.view_count) || 0,
    likes: v.like_count || 0,
    comments: v.comment_count || 0,
    shares: v.share_count || 0,
    days: v.posted_at ? Math.max(0, Math.floor((Date.now() - new Date(v.posted_at).getTime()) / 86400000)) : 0,
  }))
}

// ─── Top athlete posts (cross-platform; currently Instagram-only data) ─────
// Pulls posts from influencer_posts (IG by platform column) and resolves
// influencer_id → athlete name + brand. Keeps the shape close to V2TopIGPost
// so the table can be styled identically to other top-post tables.
export type V2TopInfluencerPost = {
  athleteId: string
  athleteName: string
  athleteHandle: string
  brand: string
  platform: 'ig' | 'tiktok' | 'yt' | 'x'
  caption: string
  likes: number
  comments: number
  views: number
  days: number
  url: string
}

export async function fetchTopInfluencerPosts(
  brands: V2Brand[],
  limit = 50,
): Promise<V2TopInfluencerPost[]> {
  const slugByBid: Record<string, string> = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))

  // Athlete roster lookup: id → name, handle, brand
  const { data: infs } = await supabase
    .from('influencers')
    .select('id,name,brand_id,instagram_handle')
  const athleteById: Record<string, { name: string; brand: string; handle: string }> = {}
  ;(infs || []).forEach((i: any) => {
    athleteById[i.id] = {
      name: i.name || '',
      brand: slugByBid[i.brand_id] || 'unknown',
      handle: i.instagram_handle || '',
    }
  })

  const { data: posts } = await supabase
    .from('influencer_posts')
    .select('influencer_id,platform,post_url,caption,like_count,comment_count,view_count,posted_at')
    .order('like_count', { ascending: false })
    .limit(limit)

  return (posts || [])
    .map((p: any): V2TopInfluencerPost | null => {
      const ath = athleteById[p.influencer_id]
      if (!ath) return null
      const platformRaw = String(p.platform || 'instagram').toLowerCase()
      const platform: V2TopInfluencerPost['platform'] =
        platformRaw === 'tiktok' ? 'tiktok'
          : platformRaw === 'youtube' || platformRaw === 'yt' ? 'yt'
          : platformRaw === 'x' || platformRaw === 'twitter' ? 'x'
          : 'ig'
      const days = p.posted_at
        ? Math.max(0, Math.floor((Date.now() - new Date(p.posted_at).getTime()) / 86400000))
        : 0
      const url = p.post_url
        || (ath.handle ? `https://www.instagram.com/${ath.handle}/` : '')
      return {
        athleteId: p.influencer_id,
        athleteName: ath.name,
        athleteHandle: ath.handle,
        brand: ath.brand,
        platform,
        caption: p.caption || '',
        likes: p.like_count || 0,
        comments: p.comment_count || 0,
        views: p.view_count || 0,
        days,
        url,
      }
    })
    .filter((r): r is V2TopInfluencerPost => r !== null)
}

export async function fetchOverview(): Promise<V2Overview> {
  const brands = await fetchBrands()
  const [ig, ads, promos, products, yt, reddit, influencers, adSample, topIGPosts, topYTVideos, topComments] = await Promise.all([
    fetchIG(brands),
    fetchAds(brands),
    fetchPromos(brands),
    fetchProductStats(brands),
    fetchYT(brands),
    fetchReddit(brands),
    fetchInfluencers(brands),
    fetchAdSample(brands),
    fetchTopIGPosts(brands),
    fetchTopYTVideos(brands),
    fetchTopComments(brands),
  ])
  return { brands, ig, ads, promos, products, yt, reddit, influencers, adSample, topIGPosts, topYTVideos, topComments }
}
