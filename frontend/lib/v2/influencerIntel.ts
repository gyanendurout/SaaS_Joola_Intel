'use client'

/**
 * Influencer Intel data adapter — unifies sponsored-player roster, scraped
 * influencer profiles, influencer posts, and (where available) cross-channel
 * mentions into a single fetcher that the /v2/influencers page reads.
 *
 * Sources:
 *  - SPONSORED_PLAYER_ROSTER (business-provided mapping, see playerRoster.ts)
 *  - influencers             (athlete IG profile rows + x_handle)
 *  - influencer_posts        (post-level metrics, IG only today)
 *  - mention_facts           (cross-channel mentions when athlete_id is set)
 *
 * Every Supabase call is wrapped so a missing table / RLS denial yields `[]`
 * and the page surfaces the gap in the "Pending / Needs data pipeline" section
 * rather than crashing.
 */

import { supabase } from '@/lib/shared/supabase'
import { type V2Brand } from './data'
import {
  SPONSORED_PLAYER_ROSTER,
  BRANDS_WITHOUT_ROSTER,
  type PlayerSponsorship,
  type PlayerSponsorshipStatus,
} from './playerRoster'

// ─── Shared types ─────────────────────────────────────────────────────

export type IntelPlatform = 'ig' | 'yt' | 'tiktok' | 'x' | 'reddit'
export type IntelSentiment = 'positive' | 'neutral' | 'negative' | 'unknown'

export interface InfluencerRow {
  id: string
  name: string
  brandSlug: string
  followers: number
  posts: number
  avgLikes: number
  avgComments: number
  engRate: number
  init: string
  igHandle?: string
  xHandle?: string
  /** Sponsorship status from the roster (null if athlete is scraped but not on the business roster). */
  sponsorshipStatus: PlayerSponsorshipStatus | null
  /** All brands the player appears under in the roster (for multi-brand players). */
  rosterBrands: string[]
  /** Days since the athlete's most recent post in `influencer_posts`. null if no posts. */
  lastSeenDays: number | null
}

export interface InfluencerPostRow {
  id: string
  athleteId: string
  athleteName: string
  athleteHandle: string
  brandSlug: string
  platform: IntelPlatform
  caption: string
  type: string                // 'image' | 'reel' | 'video' | etc.
  views: number
  likes: number
  comments: number
  shares: number
  engagement: number          // likes + comments + shares
  engRate: number             // engagement / followers (%)
  sentiment: IntelSentiment
  isSponsored: boolean
  postedAt: string | null
  days: number
  url: string
}

export interface RosterRow {
  brandSlug: string
  player: string
  status: PlayerSponsorshipStatus
  igHandle: string | null
  ytHandle: string | null
  tiktokHandle: string | null
  xHandle: string | null
  redditHandle: string | null
  verification: 'verified' | 'matched' | 'unmatched'
  lastSeenDays: number | null
}

export interface PlatformAttention {
  brandSlug: string
  player: string
  ig: number
  yt: number
  tiktok: number
  x: number
  reddit: number
  total: number
  engagement: number
  positive: number
  negative: number
  trend: 'up' | 'down' | 'flat' | 'unknown'
}

export interface BrandPlayerStats {
  brandSlug: string
  playersTracked: number
  playersActive: number
  totalMentions: number
  totalReach: number
  avgEngRate: number
  totalEngagement: number
  ig: number
  yt: number
  tiktok: number
  x: number
  reddit: number
  negativePct: number
}

export interface CommunityMention {
  id: string
  player: string
  brandSlug: string
  channel: IntelPlatform | 'ig_comment' | 'yt_comment' | 'tiktok_comment' | 'reddit_comment' | 'x_influencer' | 'product_review' | 'unknown'
  channelLabel: string
  mentionText: string
  sentiment: IntelSentiment
  productName: string | null
  engagement: number
  postedAt: string | null
  days: number
  link: string
}

export interface JoolaPlayerFocus {
  player: string
  athleteId: string | null
  signals: number
  ig: number
  yt: number
  tiktok: number
  x: number
  reddit: number
  reach: number
  engRate: number
  topContent: string | null
  topContentUrl: string | null
  sentiment: IntelSentiment | 'mixed' | 'no-data'
  relatedPaddle: string | null
  trend: 'up' | 'down' | 'flat' | 'unknown'
}

export interface PlayerProductConnection {
  player: string
  brandSlug: string
  productName: string
  productBrandSlug: string
  mentions: number
  channel: IntelPlatform | 'ig_comment' | 'yt_comment' | 'tiktok_comment' | 'reddit_comment' | 'x_influencer' | 'product_review' | 'unknown'
  channelLabel: string
  positive: number
  negative: number
  attentionScore: number
}

export interface DataCoverage {
  igRoster: boolean
  igPosts: number
  ytMentions: number
  tiktokMentions: number
  xMentions: number
  redditMentions: number
  commentLevelMentions: boolean
  aliasMatching: boolean
  sponsorshipVerification: boolean
}

export interface PendingItem {
  section: string
  why: string
  requiredSource: string
  recommendation: string
}

export interface ReviewItem {
  section: string
  detail: string
}

export interface InfluencerIntelData {
  brands: V2Brand[]
  sponsoredPlayerMap: PlayerSponsorship[]
  influencers: InfluencerRow[]
  influencerPosts: InfluencerPostRow[]
  playerMentions: CommunityMention[]
  rosterRows: RosterRow[]
  platformStats: PlatformAttention[]
  brandPlayerStats: BrandPlayerStats[]
  playerAttentionStats: PlatformAttention[]   // alias of platformStats sorted by total
  topPlayerContent: InfluencerPostRow[]
  communityMentions: CommunityMention[]
  joolaPlayerStats: JoolaPlayerFocus[]
  playerProductConnections: PlayerProductConnection[]
  dataCoverage: DataCoverage
  dataStatus: {
    sponsoredPlayers: number
    activeBrands: number
    platformsWithData: IntelPlatform[]
    influencerCount: number
    influencerPostCount: number
    mentionFactCount: number
  }
  pending: PendingItem[]
  reviewRequired: ReviewItem[]
}

// ─── Aliases + normalization ──────────────────────────────────────────
// `normalize` is a deliberately small surface — lowercase, strip punctuation,
// collapse whitespace, trim. Match by full-name equality OR by an explicit
// alias entry. NEVER match by first-name alone ("Ben", "Riley", "Anna") so a
// generic mention is not mis-attributed to a sponsored player.

const PLAYER_ALIASES: Record<string, string> = {
  // alias (normalized) -> canonical roster name
  'alw': 'Anna Leigh Waters',
  'ben johns': 'Ben Johns',
  'bj': 'Ben Johns',
  'tyson mcguffin': 'Tyson McGuffin',
  'jdv': 'Jay Devilliers',
  'jay dev': 'Jay Devilliers',
}

function normalize(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Resolve a free-text mention back to a canonical roster player. Returns
 * null when no safe match exists.
 *
 * Match priority:
 *   1) exact normalized full-name match against the roster
 *   2) alias map (only multi-letter aliases — never bare first names)
 * Falls back to word-boundary substring of the full name if the snippet
 * mentions multiple words from the player's name (e.g. "Anna Leigh said").
 */
export function matchPlayerFromText(text: string, rosterPlayers: string[]): string | null {
  const snippet = normalize(text)
  if (!snippet) return null

  // 1) exact alias hit
  if (PLAYER_ALIASES[snippet]) return PLAYER_ALIASES[snippet]

  // 2) exact roster name match
  for (const p of rosterPlayers) {
    if (normalize(p) === snippet) return p
  }

  // 3) word-boundary substring — require full multi-word match
  for (const p of rosterPlayers) {
    const np = normalize(p)
    if (np.includes(' ') && new RegExp(`\\b${np}\\b`).test(snippet)) return p
  }

  return null
}

// ─── Supabase helpers ─────────────────────────────────────────────────

const MISSING_TABLE_RE =
  /(does not exist|42P01|relation .* does not exist|Could not find the table)/i

function isMissingTable(error: unknown): boolean {
  if (!error) return false
  const msg = String((error as { message?: string }).message || error)
  return MISSING_TABLE_RE.test(msg)
}

// supabase-js Promise-like builders are not typed as plain `Promise<…>`;
// accept any thenable here (mirrors the safeQuery helper in communityIntel.ts).
async function safeSelect<T = Record<string, unknown>>(
  fn: () => unknown,
): Promise<T[]> {
  try {
    const builder = fn() as PromiseLike<{ data: T[] | null; error: unknown }>
    const { data, error } = await builder
    if (error) {
      if (!isMissingTable(error)) {
        // eslint-disable-next-line no-console
        console.warn('[influencerIntel] supabase error', error)
      }
      return []
    }
    return data || []
  } catch (err) {
    if (!isMissingTable(err)) {
      // eslint-disable-next-line no-console
      console.warn('[influencerIntel] fetch failed', err)
    }
    return []
  }
}

function sentimentFromLabel(label: unknown): IntelSentiment {
  const s = String(label || '').toLowerCase()
  if (s === 'positive' || s === 'pos') return 'positive'
  if (s === 'negative' || s === 'neg') return 'negative'
  if (s === 'neutral' || s === 'neu') return 'neutral'
  return 'unknown'
}

function platformFromRaw(raw: unknown): IntelPlatform {
  const s = String(raw || '').toLowerCase()
  if (s === 'tiktok') return 'tiktok'
  if (s === 'youtube' || s === 'yt') return 'yt'
  if (s === 'x' || s === 'twitter') return 'x'
  if (s === 'reddit') return 'reddit'
  return 'ig'
}

export function platformLabel(p: IntelPlatform): string {
  switch (p) {
    case 'ig': return 'Instagram'
    case 'yt': return 'YouTube'
    case 'tiktok': return 'TikTok'
    case 'x': return 'X / Twitter'
    case 'reddit': return 'Reddit'
  }
}

export function platformShort(p: IntelPlatform): string {
  switch (p) {
    case 'ig': return 'IG'
    case 'yt': return 'YT'
    case 'tiktok': return 'TT'
    case 'x': return 'X'
    case 'reddit': return 'RD'
  }
}

function daysSince(ts: string | null | undefined): number {
  if (!ts) return 0
  const t = new Date(ts).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000))
}

function initials(name: string): string {
  return name.split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'
}

// ─── Main fetcher ─────────────────────────────────────────────────────

export async function fetchInfluencerIntel(
  brands: V2Brand[],
  opts: { from: Date; to: Date },
): Promise<InfluencerIntelData> {
  const slugByBid: Record<string, string> = Object.fromEntries(brands.map(b => [b.brand_id, b.id]))
  const bidBySlug: Record<string, string> = Object.fromEntries(brands.map(b => [b.id, b.brand_id]))

  // ── 1. Influencers + their posts ───────────────────────────────────
  const [infsRaw, postsRaw] = await Promise.all([
    safeSelect<any>(() =>
      supabase.from('influencers')
        .select('id,name,brand_id,follower_count_ig,instagram_handle,x_handle')
        .order('follower_count_ig', { ascending: false }),
    ),
    safeSelect<any>(() =>
      supabase.from('influencer_posts')
        .select('id,influencer_id,platform,post_url,caption,like_count,comment_count,view_count,posted_at,sentiment,is_sponsored')
        .order('like_count', { ascending: false })
        .limit(2000),
    ),
  ])

  // Aggregate posts per influencer
  type PostAgg = {
    likes: number; comments: number; views: number; n: number;
    lastSeenDays: number | null;
  }
  const engByInf: Record<string, PostAgg> = {}
  ;(postsRaw || []).forEach(p => {
    const id = p.influencer_id
    if (!id) return
    if (!engByInf[id]) engByInf[id] = { likes: 0, comments: 0, views: 0, n: 0, lastSeenDays: null }
    const a = engByInf[id]
    a.likes += p.like_count || 0
    a.comments += p.comment_count || 0
    a.views += p.view_count || 0
    a.n++
    const d = p.posted_at ? daysSince(p.posted_at) : null
    if (d != null && (a.lastSeenDays == null || d < a.lastSeenDays)) a.lastSeenDays = d
  })

  // Map athlete → roster brands so we can attach sponsorshipStatus to scraped rows
  const rosterByPlayer = new Map<string, PlayerSponsorship[]>()
  SPONSORED_PLAYER_ROSTER.forEach(r => {
    const k = normalize(r.player)
    const list = rosterByPlayer.get(k) || []
    list.push(r)
    rosterByPlayer.set(k, list)
  })

  const influencers: InfluencerRow[] = (infsRaw || []).map(i => {
    const e = engByInf[i.id] || { likes: 0, comments: 0, views: 0, n: 0, lastSeenDays: null }
    const followers = i.follower_count_ig || 0
    const avgLikes = e.n ? e.likes / e.n : 0
    const avgComments = e.n ? e.comments / e.n : 0
    const rawEr = followers > 0 ? ((avgLikes + avgComments) / followers) * 100 : 0
    const engRate = Math.min(100, rawEr)
    const brandSlug = slugByBid[i.brand_id] || 'unknown'
    const rosterEntries = rosterByPlayer.get(normalize(i.name || ''))
    const rosterMatch = rosterEntries?.find(r => r.brandSlug === brandSlug) || rosterEntries?.[0] || null
    return {
      id: i.id,
      name: i.name || '?',
      brandSlug,
      followers,
      posts: e.n,
      avgLikes: Math.round(avgLikes),
      avgComments: Math.round(avgComments),
      engRate: Number(engRate.toFixed(2)),
      init: initials(i.name || '?'),
      igHandle: i.instagram_handle || undefined,
      xHandle: i.x_handle || undefined,
      sponsorshipStatus: rosterMatch ? rosterMatch.status : null,
      rosterBrands: rosterEntries ? Array.from(new Set(rosterEntries.map(r => r.brandSlug))) : [],
      lastSeenDays: e.lastSeenDays,
    }
  })

  // ── 2. Posts → influencerPosts shape (with athlete + brand lookup) ─
  const athleteById: Record<string, InfluencerRow> = {}
  influencers.forEach(i => { athleteById[i.id] = i })

  const fromTs = opts.from.getTime()
  const toTs = opts.to.getTime()

  const influencerPosts: InfluencerPostRow[] = (postsRaw || [])
    .map((p): InfluencerPostRow | null => {
      const ath = athleteById[p.influencer_id]
      if (!ath) return null
      const platform = platformFromRaw(p.platform)
      const days = daysSince(p.posted_at)
      const url = p.post_url || (ath.igHandle ? `https://www.instagram.com/${ath.igHandle}/` : '')
      const likes = p.like_count || 0
      const comments = p.comment_count || 0
      const views = p.view_count || 0
      const shares = 0   // not collected in influencer_posts schema today
      const engagement = likes + comments + shares
      const engRate = ath.followers > 0 ? (engagement / ath.followers) * 100 : 0
      return {
        id: p.id,
        athleteId: p.influencer_id,
        athleteName: ath.name,
        athleteHandle: ath.igHandle || '',
        brandSlug: ath.brandSlug,
        platform,
        caption: p.caption || '',
        type: (platform === 'ig' ? 'image' : ''),
        views,
        likes,
        comments,
        shares,
        engagement,
        engRate: Number(engRate.toFixed(2)),
        sentiment: sentimentFromLabel(p.sentiment),
        isSponsored: !!p.is_sponsored,
        postedAt: p.posted_at || null,
        days,
        url,
      }
    })
    .filter((p): p is InfluencerPostRow => p !== null)
    .filter(p => {
      if (!p.postedAt) return true   // keep undated posts in coverage
      const t = new Date(p.postedAt).getTime()
      return t >= fromTs && t <= toTs
    })

  // ── 3. Mention facts (cross-channel player mentions when athlete_id set)
  const mentionsRaw = await safeSelect<any>(() =>
    supabase.from('mention_facts')
      .select('id,channel,source_id,brand_id,product_id,athlete_id,sentiment_label,text_snippet,posted_at,engagement,link_url')
      .not('athlete_id', 'is', null)
      .order('posted_at', { ascending: false })
      .limit(5000),
  )

  // Build product lookup so connections section can label paddles
  const productIds = Array.from(new Set((mentionsRaw || []).map(m => m.product_id).filter(Boolean)))
  let productMap: Record<string, { name: string; brandSlug: string }> = {}
  if (productIds.length > 0) {
    const prods = await safeSelect<any>(() =>
      supabase.from('products_catalog').select('id,display_name,brand_id').in('id', productIds),
    )
    prods.forEach(p => {
      productMap[p.id] = {
        name: p.display_name || '',
        brandSlug: slugByBid[p.brand_id] || 'unknown',
      }
    })
  }

  function channelLabelFor(ch: string): string {
    switch (ch) {
      case 'ig': return 'Instagram'
      case 'ig_comment': return 'Instagram comment'
      case 'yt': return 'YouTube'
      case 'yt_comment': return 'YouTube comment'
      case 'reddit': return 'Reddit'
      case 'reddit_comment': return 'Reddit comment'
      case 'tiktok': return 'TikTok'
      case 'tiktok_comment': return 'TikTok comment'
      case 'x':
      case 'x_influencer': return 'X / Twitter'
      case 'product_review': return 'Product review'
      default: return ch || 'Unknown'
    }
  }

  const playerMentions: CommunityMention[] = (mentionsRaw || [])
    .map((m): CommunityMention | null => {
      const ath = athleteById[m.athlete_id]
      if (!ath) return null
      const postedAt = m.posted_at || null
      const days = daysSince(postedAt)
      if (postedAt) {
        const t = new Date(postedAt).getTime()
        if (t < fromTs || t > toTs) return null
      }
      const product = m.product_id ? productMap[m.product_id] : null
      const ch = String(m.channel || 'unknown') as CommunityMention['channel']
      return {
        id: m.id,
        player: ath.name,
        brandSlug: ath.brandSlug,
        channel: ch,
        channelLabel: channelLabelFor(String(m.channel || 'unknown')),
        mentionText: m.text_snippet || '',
        sentiment: sentimentFromLabel(m.sentiment_label),
        productName: product ? product.name : null,
        engagement: 0,
        postedAt,
        days,
        link: '',
      }
    })
    .filter((m): m is CommunityMention => m !== null)

  // ── 4. Roster table rows (every business-roster entry + lookup of handles)
  const infByPlayerBrand = new Map<string, InfluencerRow>()
  influencers.forEach(i => {
    infByPlayerBrand.set(`${normalize(i.name)}::${i.brandSlug}`, i)
  })

  const rosterRows: RosterRow[] = SPONSORED_PLAYER_ROSTER.map(r => {
    const inf = infByPlayerBrand.get(`${normalize(r.player)}::${r.brandSlug}`)
    // fall back: any influencer row matching the name regardless of brand
    const infAny = inf || Array.from(infByPlayerBrand.values()).find(i => normalize(i.name) === normalize(r.player))
    return {
      brandSlug: r.brandSlug,
      player: r.player,
      status: r.status,
      igHandle: infAny?.igHandle || null,
      ytHandle: null,
      tiktokHandle: null,
      xHandle: infAny?.xHandle || null,
      redditHandle: null,
      verification: infAny
        ? (inf ? 'verified' : 'matched')
        : 'unmatched',
      lastSeenDays: infAny?.lastSeenDays ?? null,
    }
  })

  // Surface Wilson (or any brand with no roster) as an explicit row
  BRANDS_WITHOUT_ROSTER.forEach(slug => {
    rosterRows.push({
      brandSlug: slug,
      player: '—',
      status: 'roster-not-confirmed',
      igHandle: null,
      ytHandle: null,
      tiktokHandle: null,
      xHandle: null,
      redditHandle: null,
      verification: 'unmatched',
      lastSeenDays: null,
    })
  })

  // ── 5. Platform attention per player ───────────────────────────────
  const attentionByPlayer = new Map<string, PlatformAttention>()
  const trendCounts = new Map<string, { recent: number; older: number }>()

  function bumpAttention(playerName: string, brandSlug: string, platform: IntelPlatform, sentiment: IntelSentiment, engagement: number, days: number) {
    const key = `${playerName}::${brandSlug}`
    let row = attentionByPlayer.get(key)
    if (!row) {
      row = {
        brandSlug, player: playerName,
        ig: 0, yt: 0, tiktok: 0, x: 0, reddit: 0,
        total: 0, engagement: 0, positive: 0, negative: 0,
        trend: 'unknown',
      }
      attentionByPlayer.set(key, row)
    }
    row[platform]++
    row.total++
    row.engagement += engagement
    if (sentiment === 'positive') row.positive++
    else if (sentiment === 'negative') row.negative++
    // Track recent (0–14 days) vs older (15–28 days) for trend
    const tc = trendCounts.get(key) || { recent: 0, older: 0 }
    if (days <= 14) tc.recent++
    else if (days <= 28) tc.older++
    trendCounts.set(key, tc)
  }

  influencerPosts.forEach(p => {
    bumpAttention(p.athleteName, p.brandSlug, p.platform, p.sentiment, p.engagement, p.days)
  })
  playerMentions.forEach(m => {
    // Translate community channel into one of the 5 platforms.
    // mention_facts.channel values include comment-suffix variants
    // (tiktok_comment, x_influencer, reddit_comment, ig_comment, yt_comment)
    // that must be folded into their parent platform bucket.
    let plat: IntelPlatform = 'ig'
    const ch = String(m.channel || '')
    if (ch === 'yt' || ch === 'yt_comment') plat = 'yt'
    else if (ch === 'reddit' || ch === 'reddit_comment') plat = 'reddit'
    else if (ch === 'tiktok' || ch === 'tiktok_comment') plat = 'tiktok'
    else if (ch === 'x' || ch === 'x_influencer' || ch === 'unknown') plat = 'x'
    else plat = 'ig'
    bumpAttention(m.player, m.brandSlug, plat, m.sentiment, 0, m.days)
  })

  // Compute trend: compare last 14 days vs prior 14 days
  attentionByPlayer.forEach((row, key) => {
    const tc = trendCounts.get(key)
    if (!tc || (tc.recent === 0 && tc.older === 0)) { row.trend = 'unknown'; return }
    if (tc.older === 0) { row.trend = tc.recent > 0 ? 'up' : 'unknown'; return }
    const ratio = tc.recent / tc.older
    if (ratio >= 1.2) row.trend = 'up'
    else if (ratio <= 0.8) row.trend = 'down'
    else row.trend = 'flat'
  })

  const platformStats = Array.from(attentionByPlayer.values()).sort((a, b) => b.total - a.total)

  // ── 6. Brand sponsored-player strength ─────────────────────────────
  const brandStatsByBrand = new Map<string, BrandPlayerStats>()
  brands.forEach(b => {
    brandStatsByBrand.set(b.id, {
      brandSlug: b.id,
      playersTracked: 0,
      playersActive: 0,
      totalMentions: 0,
      totalReach: 0,
      avgEngRate: 0,
      totalEngagement: 0,
      ig: 0, yt: 0, tiktok: 0, x: 0, reddit: 0,
      negativePct: 0,
    })
  })
  SPONSORED_PLAYER_ROSTER.forEach(r => {
    const s = brandStatsByBrand.get(r.brandSlug)
    if (s) s.playersTracked++
  })
  const erAcc: Record<string, { sum: number; n: number; neg: number; total: number }> = {}
  influencers.forEach(i => {
    const s = brandStatsByBrand.get(i.brandSlug)
    if (!s) return
    s.totalReach += i.followers
    if (i.posts > 0) s.playersActive++
    if (i.engRate > 0) {
      if (!erAcc[i.brandSlug]) erAcc[i.brandSlug] = { sum: 0, n: 0, neg: 0, total: 0 }
      erAcc[i.brandSlug].sum += i.engRate
      erAcc[i.brandSlug].n++
    }
  })
  platformStats.forEach(p => {
    const s = brandStatsByBrand.get(p.brandSlug)
    if (!s) return
    s.totalMentions += p.total
    s.totalEngagement += p.engagement
    s.ig += p.ig; s.yt += p.yt; s.tiktok += p.tiktok; s.x += p.x; s.reddit += p.reddit
    if (!erAcc[p.brandSlug]) erAcc[p.brandSlug] = { sum: 0, n: 0, neg: 0, total: 0 }
    erAcc[p.brandSlug].neg += p.negative
    erAcc[p.brandSlug].total += p.total
  })
  brandStatsByBrand.forEach(s => {
    const e = erAcc[s.brandSlug]
    if (e) {
      s.avgEngRate = e.n > 0 ? Number((e.sum / e.n).toFixed(2)) : 0
      s.negativePct = e.total > 0 ? Number(((e.neg / e.total) * 100).toFixed(1)) : 0
    }
  })

  const brandPlayerStats = Array.from(brandStatsByBrand.values())
    .sort((a, b) => b.totalEngagement - a.totalEngagement)

  // ── 7. JOOLA focus rows ────────────────────────────────────────────
  const JOOLA_PLAYERS = ['Ben Johns', 'Collin Johns', 'Tyson McGuffin', 'Lea Jansen', 'Federico Staksrud', 'Anna Bright']
  const joolaPlayerStats: JoolaPlayerFocus[] = JOOLA_PLAYERS.map(name => {
    const inf = Array.from(infByPlayerBrand.values()).find(i => normalize(i.name) === normalize(name))
    const att = attentionByPlayer.get(`${name}::joola`) || null
    const topPost = influencerPosts
      .filter(p => p.athleteName === name && p.brandSlug === 'joola')
      .sort((a, b) => b.engagement - a.engagement)[0] || null
    const conn = (mentionsRaw || [])
      .filter(m => m.athlete_id && athleteById[m.athlete_id]?.name === name && m.product_id)
      .map(m => productMap[m.product_id])
      .find(Boolean)
    const sentiment: JoolaPlayerFocus['sentiment'] = att
      ? (att.positive > att.negative ? 'positive' : att.negative > att.positive ? 'negative' : att.total > 0 ? 'mixed' : 'no-data')
      : 'no-data'
    return {
      player: name,
      athleteId: inf?.id || null,
      signals: att?.total || 0,
      ig: att?.ig || 0,
      yt: att?.yt || 0,
      tiktok: att?.tiktok || 0,
      x: att?.x || 0,
      reddit: att?.reddit || 0,
      reach: inf?.followers || 0,
      engRate: inf?.engRate || 0,
      topContent: topPost?.caption?.slice(0, 80) || null,
      topContentUrl: topPost?.url || null,
      sentiment,
      relatedPaddle: conn?.name || null,
      trend: 'unknown',
    }
  })

  // ── 8. Player ↔ Paddle connections (only if data exists) ───────────
  const connKey = (a: string, b: string, c: string) => `${a}::${b}::${c}`
  const connMap = new Map<string, PlayerProductConnection>()
  ;(mentionsRaw || []).forEach(m => {
    if (!m.athlete_id || !m.product_id) return
    const ath = athleteById[m.athlete_id]
    const prod = productMap[m.product_id]
    if (!ath || !prod) return
    const k = connKey(ath.name, prod.name, String(m.channel || 'unknown'))
    let row = connMap.get(k)
    if (!row) {
      row = {
        player: ath.name,
        brandSlug: ath.brandSlug,
        productName: prod.name,
        productBrandSlug: prod.brandSlug,
        mentions: 0,
        channel: String(m.channel || 'unknown') as PlayerProductConnection['channel'],
        channelLabel: channelLabelFor(String(m.channel || 'unknown')),
        positive: 0,
        negative: 0,
        attentionScore: 0,
      }
      connMap.set(k, row)
    }
    row.mentions++
    const s = sentimentFromLabel(m.sentiment_label)
    if (s === 'positive') row.positive++
    else if (s === 'negative') row.negative++
  })
  const playerProductConnections = Array.from(connMap.values())
    .map(r => ({ ...r, attentionScore: r.mentions + r.positive * 0.5 - r.negative * 0.5 }))
    .sort((a, b) => b.attentionScore - a.attentionScore)

  // ── 9. Data coverage diagnostic ────────────────────────────────────
  // Fold comment-suffix channels into their parent platform so counts match
  // what mention_facts actually stores (channel='tiktok_comment','x_influencer',
  // 'reddit_comment', etc — see backend/scraping/facts/mention_facts.py SOURCES).
  const ytMentions = playerMentions.filter(m => m.channel === 'yt' || m.channel === 'yt_comment').length
  const tiktokMentions = playerMentions.filter(m => m.channel === 'tiktok' || m.channel === 'tiktok_comment').length
  const xMentions = playerMentions.filter(m => m.channel === 'x' || m.channel === 'x_influencer').length
  const redditMentions = playerMentions.filter(m => m.channel === 'reddit' || m.channel === 'reddit_comment').length
  const igCommentMentions = playerMentions.filter(m => m.channel === 'ig_comment').length

  const dataCoverage: DataCoverage = {
    igRoster: influencers.length > 0,
    igPosts: influencerPosts.filter(p => p.platform === 'ig').length,
    ytMentions,
    tiktokMentions,
    xMentions,
    redditMentions,
    commentLevelMentions: igCommentMentions > 0,
    aliasMatching: true,
    sponsorshipVerification: false,
  }

  // ── 10. Pending pipeline items ─────────────────────────────────────
  const pending: PendingItem[] = []

  // ── 11. Review-required (anything that doesn't fit cleanly) ─────────
  const reviewRequired: ReviewItem[] = []
  const unmatchedScraped = influencers.filter(i => !i.sponsorshipStatus)
  if (unmatchedScraped.length > 0) {
    reviewRequired.push({
      section: 'Roster verification',
      detail: `${unmatchedScraped.length} scraped athletes not on the business-provided roster (likely additional players to add to playerRoster.ts).`,
    })
  }
  const multiBrandPlayers = SPONSORED_PLAYER_ROSTER.filter(r => r.status === 'needs-verification')
  if (multiBrandPlayers.length > 0) {
    const names = Array.from(new Set(multiBrandPlayers.map(r => r.player)))
    reviewRequired.push({
      section: 'Multi-brand players',
      detail: `${names.length} player(s) appear on more than one brand roster (${names.join(', ')}). Confirm true sponsor with the brand team.`,
    })
  }

  // ── 12. Platforms with usable player-level data ────────────────────
  const platformsWithData: IntelPlatform[] = []
  if (dataCoverage.igPosts > 0 || dataCoverage.igRoster) platformsWithData.push('ig')
  if (ytMentions > 0) platformsWithData.push('yt')
  if (tiktokMentions > 0) platformsWithData.push('tiktok')
  if (xMentions > 0) platformsWithData.push('x')
  if (redditMentions > 0) platformsWithData.push('reddit')

  // ── Top content (sorted) ────────────────────────────────────────────
  const topPlayerContent = influencerPosts
    .slice()
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 200)

  return {
    brands,
    sponsoredPlayerMap: SPONSORED_PLAYER_ROSTER,
    influencers,
    influencerPosts,
    playerMentions,
    rosterRows,
    platformStats,
    brandPlayerStats,
    playerAttentionStats: platformStats.slice(0, 200),
    topPlayerContent,
    communityMentions: playerMentions,
    joolaPlayerStats,
    playerProductConnections,
    dataCoverage,
    dataStatus: {
      sponsoredPlayers: new Set(SPONSORED_PLAYER_ROSTER.map(r => r.player)).size,
      activeBrands: Array.from(new Set(SPONSORED_PLAYER_ROSTER.map(r => r.brandSlug))).length,
      platformsWithData,
      influencerCount: influencers.length,
      influencerPostCount: influencerPosts.length,
      mentionFactCount: (mentionsRaw || []).length,
    },
    pending,
    reviewRequired,
  }
}

// Silence "unused" warning on bidBySlug for callers that may want this map later.
export type _UnusedHelper = { bidBySlug: Record<string, string> }

// ─── Extended types for new influencer-intel sections ─────────────────

export interface AthleteImpactRow {
  athleteId: string
  player: string
  brandSlug: string
  posts30d: number
  avgEngagement: number
  mentions: number
  followerGrowthPct: number
  productMentions: number
  positivePct: number
  impactScore: number
  classification: 'rising' | 'underperforming' | 'steady'
}

export interface SponsoredOrganicRow {
  athleteId: string
  player: string
  brandSlug: string
  sponsoredPosts: number
  organicPosts: number
  sponsoredER: number
  organicER: number
  difference: number
  recommendation: string
}

export interface AthleteProductPullRow {
  athleteId: string
  player: string
  brandSlug: string
  productName: string
  productBrandSlug: string
  mentions: number
  engagement: number
  salesLikelihood: number
  action: string
}

export interface CompetitorThreatRow {
  athleteId: string
  player: string
  brandSlug: string
  topPlatform: IntelPlatform
  topPlatformCount: number
  engagement: number
  productMentioned: string | null
  impactScore: number
  threatLevel: 'critical' | 'high' | 'moderate' | 'low'
}

// ─── Extended fetchers ────────────────────────────────────────────────

/**
 * Athlete Impact Score — composite "ROI-proxy" per player.
 * Uses influencer_posts (last 30d), mention_facts, influencer_x_snapshots.
 */
export async function fetchAthleteImpact(brands: V2Brand[]): Promise<AthleteImpactRow[]> {
  const slugByBid: Record<string, string> = Object.fromEntries(brands.map(b => [b.brand_id, b.id]))

  const cutoffIso = new Date(Date.now() - 30 * 86_400_000).toISOString()

  const [infs, posts, mentions, xSnap] = await Promise.all([
    safeSelect<any>(() => supabase.from('influencers')
      .select('id,name,brand_id,follower_count_ig')),
    safeSelect<any>(() => supabase.from('influencer_posts')
      .select('id,influencer_id,like_count,comment_count,view_count,posted_at,sentiment')
      .gte('posted_at', cutoffIso)
      .limit(5000)),
    safeSelect<any>(() => supabase.from('mention_facts')
      .select('athlete_id,product_id,sentiment_label')
      .not('athlete_id', 'is', null)
      .limit(10000)),
    safeSelect<any>(() => supabase.from('influencer_x_snapshots')
      .select('influencer_id,followers,week_number,year,scraped_at')
      .order('scraped_at', { ascending: false })
      .limit(5000)),
  ])

  type Agg = {
    posts30d: number
    engagementSum: number
    mentions: number
    productMentions: number
    positiveCount: number
    sentimentTotal: number
  }
  const aggByAth: Record<string, Agg> = {}
  function bump(id: string): Agg {
    if (!aggByAth[id]) {
      aggByAth[id] = {
        posts30d: 0, engagementSum: 0, mentions: 0,
        productMentions: 0, positiveCount: 0, sentimentTotal: 0,
      }
    }
    return aggByAth[id]
  }

  for (const p of posts) {
    if (!p.influencer_id) continue
    const a = bump(p.influencer_id)
    a.posts30d += 1
    a.engagementSum += (p.like_count || 0) + (p.comment_count || 0)
  }
  for (const m of mentions) {
    if (!m.athlete_id) continue
    const a = bump(m.athlete_id)
    a.mentions += 1
    if (m.product_id) a.productMentions += 1
    a.sentimentTotal += 1
    if (m.sentiment_label === 'positive') a.positiveCount += 1
  }

  // Follower growth: latest two snapshots per influencer.
  const snapByAth: Record<string, { followers: number; scraped_at: string }[]> = {}
  for (const s of xSnap) {
    if (!s.influencer_id) continue
    if (!snapByAth[s.influencer_id]) snapByAth[s.influencer_id] = []
    snapByAth[s.influencer_id].push({ followers: s.followers || 0, scraped_at: s.scraped_at })
  }
  const growthByAth: Record<string, number> = {}
  for (const [id, list] of Object.entries(snapByAth)) {
    list.sort((a, b) => (b.scraped_at || '').localeCompare(a.scraped_at || ''))
    if (list.length >= 2) {
      const cur = list[0].followers
      const prev = list[1].followers
      growthByAth[id] = prev > 0 ? Number((((cur - prev) / prev) * 100).toFixed(2)) : 0
    }
  }

  // Build rows with composite score (normalize each dim 0..1, then sum × 100).
  const raw = infs.map((i): {
    athleteId: string; player: string; brandSlug: string;
    posts30d: number; avgEngagement: number; mentions: number;
    growth: number; productMentions: number; positivePct: number;
  } => {
    const a = aggByAth[i.id] || { posts30d: 0, engagementSum: 0, mentions: 0, productMentions: 0, positiveCount: 0, sentimentTotal: 0 }
    const avgEng = a.posts30d > 0 ? Math.round(a.engagementSum / a.posts30d) : 0
    const posPct = a.sentimentTotal > 0 ? Math.round((a.positiveCount / a.sentimentTotal) * 100) : 0
    return {
      athleteId: i.id,
      player: i.name || '?',
      brandSlug: slugByBid[i.brand_id] || 'unknown',
      posts30d: a.posts30d,
      avgEngagement: avgEng,
      mentions: a.mentions,
      growth: growthByAth[i.id] || 0,
      productMentions: a.productMentions,
      positivePct: posPct,
    }
  })

  const maxPosts = Math.max(1, ...raw.map(r => r.posts30d))
  const maxEng = Math.max(1, ...raw.map(r => r.avgEngagement))
  const maxMentions = Math.max(1, ...raw.map(r => r.mentions))
  const maxGrowth = Math.max(1, ...raw.map(r => Math.abs(r.growth)))
  const maxProduct = Math.max(1, ...raw.map(r => r.productMentions))

  const rows: AthleteImpactRow[] = raw.map((r): AthleteImpactRow => {
    const score =
      ((r.posts30d / maxPosts) +
        (r.avgEngagement / maxEng) +
        (r.mentions / maxMentions) +
        (Math.max(0, r.growth) / maxGrowth) +
        (r.productMentions / maxProduct) +
        (r.positivePct / 100)) / 6 * 100
    return {
      athleteId: r.athleteId,
      player: r.player,
      brandSlug: r.brandSlug,
      posts30d: r.posts30d,
      avgEngagement: r.avgEngagement,
      mentions: r.mentions,
      followerGrowthPct: r.growth,
      productMentions: r.productMentions,
      positivePct: r.positivePct,
      impactScore: Number(score.toFixed(1)),
      classification: 'steady',
    }
  }).sort((a, b) => b.impactScore - a.impactScore)

  rows.forEach((r, i) => {
    if (i < 10) r.classification = 'rising'
    else if (i >= rows.length - 10 && rows.length > 20) r.classification = 'underperforming'
  })
  return rows
}

/**
 * Sponsored vs Organic Performance — compares ER on sponsored vs organic
 * influencer_posts. ER capped at 100% to avoid micro-account distortion.
 */
export async function fetchSponsoredVsOrganic(brands: V2Brand[]): Promise<SponsoredOrganicRow[]> {
  const slugByBid: Record<string, string> = Object.fromEntries(brands.map(b => [b.brand_id, b.id]))

  const [infs, posts] = await Promise.all([
    safeSelect<any>(() => supabase.from('influencers').select('id,name,brand_id,follower_count_ig')),
    safeSelect<any>(() => supabase.from('influencer_posts')
      .select('influencer_id,like_count,comment_count,is_sponsored')
      .limit(10000)),
  ])

  type B = { sumEr: number; n: number }
  const sp: Record<string, B> = {}
  const og: Record<string, B> = {}
  const infById: Record<string, any> = {}
  for (const i of infs) infById[i.id] = i

  for (const p of posts) {
    const inf = infById[p.influencer_id]
    if (!inf) continue
    const followers = inf.follower_count_ig || 0
    if (followers <= 0) continue
    const er = Math.min(100, ((p.like_count || 0) + (p.comment_count || 0)) / followers * 100)
    const bucket = p.is_sponsored ? sp : og
    if (!bucket[p.influencer_id]) bucket[p.influencer_id] = { sumEr: 0, n: 0 }
    bucket[p.influencer_id].sumEr += er
    bucket[p.influencer_id].n += 1
  }

  const allIdsSet = new Set<string>()
  Object.keys(sp).forEach(k => allIdsSet.add(k))
  Object.keys(og).forEach(k => allIdsSet.add(k))
  const allIds = Array.from(allIdsSet)
  const rows: SponsoredOrganicRow[] = []
  for (const id of allIds) {
    const inf = infById[id]
    if (!inf) continue
    const s = sp[id] || { sumEr: 0, n: 0 }
    const o = og[id] || { sumEr: 0, n: 0 }
    const sER = s.n > 0 ? Number((s.sumEr / s.n).toFixed(2)) : 0
    const oER = o.n > 0 ? Number((o.sumEr / o.n).toFixed(2)) : 0
    if (s.n === 0 && o.n === 0) continue
    let rec = 'Insufficient data — gather more posts.'
    if (s.n > 0 && o.n > 0) {
      const ratio = oER > 0 ? sER / oER : 0
      if (ratio < 0.5) rec = 'Sponsored content underperforming — review content fit.'
      else if (ratio > 1.5) rec = 'Sponsored format strong — scale program.'
      else rec = 'Sponsored matches organic — healthy balance.'
    } else if (s.n === 0) {
      rec = 'No sponsored posts yet — pilot a campaign.'
    } else {
      rec = 'No organic baseline — encourage organic cadence.'
    }
    rows.push({
      athleteId: id,
      player: inf.name || '?',
      brandSlug: slugByBid[inf.brand_id] || 'unknown',
      sponsoredPosts: s.n,
      organicPosts: o.n,
      sponsoredER: sER,
      organicER: oER,
      difference: Number((sER - oER).toFixed(2)),
      recommendation: rec,
    })
  }
  return rows.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))
}

/**
 * Athlete-to-Product Pull — mention_facts where athlete_id AND product_id.
 * Optionally enriched with product_attention_daily for sales-likelihood.
 */
export async function fetchAthleteProductPull(brands: V2Brand[]): Promise<AthleteProductPullRow[]> {
  const slugByBid: Record<string, string> = Object.fromEntries(brands.map(b => [b.brand_id, b.id]))

  const [infs, mentions] = await Promise.all([
    safeSelect<any>(() => supabase.from('influencers').select('id,name,brand_id')),
    safeSelect<any>(() => supabase.from('mention_facts')
      .select('athlete_id,product_id,sentiment_label,is_purchase_intent')
      .not('athlete_id', 'is', null)
      .not('product_id', 'is', null)
      .limit(10000)),
  ])

  const productIds = Array.from(new Set(mentions.map(m => m.product_id).filter(Boolean)))
  let productMap: Record<string, { name: string; brandSlug: string }> = {}
  if (productIds.length > 0) {
    const prods = await safeSelect<any>(() =>
      supabase.from('products_catalog').select('id,display_name,brand_id').in('id', productIds))
    for (const p of prods) {
      productMap[p.id] = {
        name: p.display_name || '',
        brandSlug: slugByBid[p.brand_id] || 'unknown',
      }
    }
  }

  // Optional sales-likelihood lookup
  let likelihoodByProduct: Record<string, number> = {}
  if (productIds.length > 0) {
    const att = await safeSelect<any>(() =>
      supabase.from('product_attention_summary')
        .select('product_id,sales_likelihood_score')
        .in('product_id', productIds)
        .eq('period', 'last_30d'))
    for (const a of att) {
      likelihoodByProduct[a.product_id] = Number(a.sales_likelihood_score || 0)
    }
  }

  const infById: Record<string, any> = {}
  for (const i of infs) infById[i.id] = i

  type Bucket = {
    athleteId: string; player: string; brandSlug: string;
    productName: string; productBrandSlug: string; productId: string;
    mentions: number; engagement: number;
    purchaseIntent: number;
  }
  const map = new Map<string, Bucket>()
  for (const m of mentions) {
    const inf = infById[m.athlete_id]
    if (!inf) continue
    const prod = productMap[m.product_id]
    if (!prod) continue
    const key = `${m.athlete_id}::${m.product_id}`
    if (!map.has(key)) {
      map.set(key, {
        athleteId: m.athlete_id,
        player: inf.name || '?',
        brandSlug: slugByBid[inf.brand_id] || 'unknown',
        productName: prod.name,
        productBrandSlug: prod.brandSlug,
        productId: m.product_id,
        mentions: 0,
        engagement: 0,
        purchaseIntent: 0,
      })
    }
    const b = map.get(key)!
    b.mentions += 1
    if (m.is_purchase_intent) b.purchaseIntent += 1
  }

  const rows: AthleteProductPullRow[] = Array.from(map.values()).map(b => {
    const likelihood = likelihoodByProduct[b.productId] || 0
    let action = 'Monitor cadence.'
    if (b.brandSlug === 'joola' && b.productBrandSlug === 'joola') {
      action = likelihood > 50 ? 'Amplify — JOOLA player + JOOLA paddle resonating.' : 'Coordinate content push.'
    } else if (b.brandSlug === 'joola' && b.productBrandSlug !== 'joola') {
      action = 'Investigate — JOOLA athlete mentioning competitor product.'
    } else if (b.productBrandSlug === 'joola') {
      action = 'Capture — competitor athlete mentioning JOOLA paddle.'
    } else if (likelihood > 60) {
      action = 'Track — high-intent competitor pairing.'
    }
    return {
      athleteId: b.athleteId,
      player: b.player,
      brandSlug: b.brandSlug,
      productName: b.productName,
      productBrandSlug: b.productBrandSlug,
      mentions: b.mentions,
      engagement: b.engagement,
      salesLikelihood: Number(likelihood.toFixed(1)),
      action,
    }
  })
  return rows.sort((a, b) => b.mentions - a.mentions)
}

/**
 * Competitor Athlete Threats — top 10 competitor athletes by impact score.
 */
export async function fetchCompetitorAthleteThreats(
  brands: V2Brand[],
  impactRows: AthleteImpactRow[],
  platformStats: PlatformAttention[],
  productConnections: PlayerProductConnection[],
): Promise<CompetitorThreatRow[]> {
  const competitorOnly = impactRows.filter(r => r.brandSlug !== 'joola' && r.brandSlug !== 'unknown')
  // Compute per-brand percentile for threat-level classification
  const byBrand: Record<string, AthleteImpactRow[]> = {}
  for (const r of competitorOnly) {
    if (!byBrand[r.brandSlug]) byBrand[r.brandSlug] = []
    byBrand[r.brandSlug].push(r)
  }
  for (const slug of Object.keys(byBrand)) {
    byBrand[slug].sort((a, b) => b.impactScore - a.impactScore)
  }

  const rows: CompetitorThreatRow[] = competitorOnly.map(r => {
    // Find dominant platform
    const att = platformStats.find(p => p.player === r.player && p.brandSlug === r.brandSlug)
    const platCounts: Record<IntelPlatform, number> = {
      ig: att?.ig || 0, yt: att?.yt || 0, tiktok: att?.tiktok || 0,
      x: att?.x || 0, reddit: att?.reddit || 0,
    }
    let top: IntelPlatform = 'ig'
    let topN = 0
    for (const [k, v] of Object.entries(platCounts) as [IntelPlatform, number][]) {
      if (v > topN) { topN = v; top = k }
    }

    // Product mentioned (first connection for player)
    const conn = productConnections.find(c => c.player === r.player && c.brandSlug === r.brandSlug)
    const productMentioned = conn ? conn.productName : null

    // Threat level: top quartile within brand = critical, etc.
    const brandList = byBrand[r.brandSlug] || []
    const idx = brandList.findIndex(b => b.athleteId === r.athleteId)
    const pct = brandList.length > 0 ? idx / brandList.length : 1
    let threatLevel: CompetitorThreatRow['threatLevel'] = 'low'
    if (pct < 0.1) threatLevel = 'critical'
    else if (pct < 0.25) threatLevel = 'high'
    else if (pct < 0.5) threatLevel = 'moderate'

    return {
      athleteId: r.athleteId,
      player: r.player,
      brandSlug: r.brandSlug,
      topPlatform: top,
      topPlatformCount: topN,
      engagement: att?.engagement || r.avgEngagement,
      productMentioned,
      impactScore: r.impactScore,
      threatLevel,
    }
  })
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 10)

  return rows
}
