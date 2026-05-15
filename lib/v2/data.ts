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

export async function fetchBrands(): Promise<V2Brand[]> {
  const { data } = await supabase.from('brands').select('id,name,slug,is_joola').order('name')
  return (data || []).map((b: any) => ({
    id: b.slug,
    brand_id: b.id,
    name: b.name,
    color: BRAND_COLORS[b.slug] || '#888',
    joola: !!b.is_joola,
  }))
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
      const engRate = f > 0 ? ((avgLikes + avgComments) / f) * 100 : 0
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

export async function fetchReddit(brands: V2Brand[]): Promise<V2RedditRow[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const { data } = await supabase.from('reddit_mentions').select('brand_id,sentiment').limit(3000)
  const agg: Record<string, V2RedditRow> = {}
  ;(data || []).forEach((r: any) => {
    const slug = slugByBid[r.brand_id]
    if (!slug) return
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
  name: string; brand: string; followers: number; posts: number;
  avgLikes: number; engRate: number; init: string;
}

export async function fetchInfluencers(brands: V2Brand[]): Promise<V2InfluencerRow[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const [{ data: infs }, { data: posts }] = await Promise.all([
    supabase.from('influencers').select('id,name,brand_id,follower_count_ig').order('follower_count_ig', { ascending: false }),
    supabase.from('influencer_posts').select('influencer_id,like_count,comment_count'),
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
        name: i.name,
        brand: slugByBid[i.brand_id] || 'unknown',
        followers: i.follower_count_ig || 0,
        posts: e.n,
        avgLikes: Math.round(avgLikes),
        engRate: Number(engRate.toFixed(2)),
        init,
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
  views: number; format: string; days: number; engRate: number
}

export async function fetchTopIGPosts(brands: V2Brand[], limit = 12): Promise<V2TopIGPost[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const { data } = await supabase
    .from('ig_posts')
    .select('brand_id,handle,caption,like_count,comment_count,view_count,post_format,posted_at')
    .order('like_count', { ascending: false })
    .limit(limit)
  const seen = new Set<string>()
  return (data || [])
    .filter((p: any) => {
      const key = (p.brand_id || '') + '::' + (p.caption || '').slice(0, 60)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((p: any) => {
      const days = p.posted_at ? Math.max(0, Math.floor((Date.now() - new Date(p.posted_at).getTime()) / 86400000)) : 0
      return {
        brand: slugByBid[p.brand_id] || 'unknown',
        handle: '@' + (p.handle || ''),
        caption: p.caption || '',
        likes: p.like_count || 0,
        comments: p.comment_count || 0,
        views: p.view_count || 0,
        format: p.post_format || 'Image',
        days,
        engRate: 0,
      }
    })
}

// ─── Top YT videos ───────────────────────────────────────────────────
export type V2TopYTVideo = { brand: string; title: string; views: number; likes: number; comments: number; duration: string; days: number }

export async function fetchTopYTVideos(brands: V2Brand[], limit = 10): Promise<V2TopYTVideo[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const { data } = await supabase
    .from('yt_videos')
    .select('brand_id,title,view_count,like_count,comment_count,duration_seconds,published_at')
    .order('view_count', { ascending: false })
    .limit(limit)
  return (data || []).map((v: any) => {
    const sec = v.duration_seconds || 0
    const mm = Math.floor(sec / 60).toString().padStart(2, '0')
    const ss = (sec % 60).toString().padStart(2, '0')
    const days = v.published_at ? Math.max(0, Math.floor((Date.now() - new Date(v.published_at).getTime()) / 86400000)) : 0
    return {
      brand: slugByBid[v.brand_id] || 'unknown',
      title: v.title || '',
      views: v.view_count || 0,
      likes: v.like_count || 0,
      comments: v.comment_count || 0,
      duration: `${mm}:${ss}`,
      days,
    }
  })
}

// ─── Top comments (IG + YT combined, top by likes) ──────────────────
export type V2TopComment = {
  user: string; text: string; platform: 'ig' | 'yt'; brand: string; likes: number;
  sentiment: 'positive' | 'neutral' | 'negative'; days: number
}

export async function fetchTopComments(brands: V2Brand[], limit = 12): Promise<V2TopComment[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const [{ data: ig }, { data: yt }] = await Promise.all([
    supabase.from('ig_comments').select('brand_id,commenter_username,comment_text,comment_likes,posted_at').order('comment_likes', { ascending: false }).limit(limit * 2),
    supabase.from('yt_comments').select('brand_id,commenter_username,comment_text,comment_likes,posted_at').order('comment_likes', { ascending: false }).limit(limit * 2),
  ])
  const dayDiff = (ts: string | null) => ts ? Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)) : 0
  const merged: V2TopComment[] = [
    ...(ig || []).map((c: any): V2TopComment => ({
      user: '@' + (c.commenter_username || 'anon'),
      text: c.comment_text || '',
      platform: 'ig',
      brand: slugByBid[c.brand_id] || 'unknown',
      likes: c.comment_likes || 0,
      sentiment: 'neutral',
      days: dayDiff(c.posted_at),
    })),
    ...(yt || []).map((c: any): V2TopComment => ({
      user: '@' + (c.commenter_username || 'anon'),
      text: c.comment_text || '',
      platform: 'yt',
      brand: slugByBid[c.brand_id] || 'unknown',
      likes: c.comment_likes || 0,
      sentiment: 'neutral',
      days: dayDiff(c.posted_at),
    })),
  ]
  return merged.sort((a, b) => b.likes - a.likes).slice(0, limit)
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
    .select('brand_id,posted_at')
    .limit(5000)
  const now = Date.now()
  const buckets: Record<string, number[]> = {}
  ;(data || []).forEach((r: any) => {
    const slug = slugByBid[r.brand_id]
    if (!slug || !r.posted_at) return
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
  const { data } = await supabase.from('reddit_mentions').select('brand_id,subreddit').limit(5000)
  const bySubreddit: Record<string, { total: number; joola: number }> = {}
  ;(data || []).forEach((r: any) => {
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
export type V2ProductItem = { brand: string; name: string; price: number | null; category: string | null; inStock: boolean }

export async function fetchProductsList(brands: V2Brand[], limit = 500): Promise<V2ProductItem[]> {
  const slugByBid = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const { data } = await supabase
    .from('products')
    .select('brand_id,name,price_usd,category,in_stock')
    .order('price_usd', { ascending: false })
    .limit(limit)
  return (data || []).map((p: any) => ({
    brand: slugByBid[p.brand_id] || 'unknown',
    name: p.name || '',
    price: p.price_usd != null ? Number(p.price_usd) : null,
    category: p.category,
    inStock: p.in_stock ?? true,
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
