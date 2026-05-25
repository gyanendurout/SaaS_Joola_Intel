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
      .select('id,channel,source_id,brand_id,product_id,athlete_id,sentiment_label,text_snippet,posted_at')
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
  function bumpAttention(playerName: string, brandSlug: string, platform: IntelPlatform, sentiment: IntelSentiment, engagement: number) {
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
  }

  influencerPosts.forEach(p => {
    bumpAttention(p.athleteName, p.brandSlug, p.platform, p.sentiment, p.engagement)
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
    bumpAttention(m.player, m.brandSlug, plat, m.sentiment, 0)
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
  if (ytMentions === 0) {
    pending.push({
      section: 'YouTube player attention',
      why: 'No mention_facts rows for tracked athletes on YouTube channel.',
      requiredSource: 'mention_facts (channel in [yt, yt_comment]) with athlete_id populated',
      recommendation: 'Run yt_comments enrichment step that resolves player names → athlete_id and writes a mention_facts row per match.',
    })
  }
  if (tiktokMentions === 0) {
    pending.push({
      section: 'TikTok player attention',
      why: 'No mention_facts rows for tracked athletes on TikTok.',
      requiredSource: 'mention_facts (channel = tiktok) with athlete_id populated',
      recommendation: 'Add TikTok comment scraper + extend enrichment to extract player NER from tiktok_videos.text + comments.',
    })
  }
  if (xMentions === 0) {
    pending.push({
      section: 'X / Twitter player attention',
      why: 'No mention_facts rows for tracked athletes on X.',
      requiredSource: 'mention_facts (channel in [x, x_influencer]) with athlete_id populated',
      recommendation: 'Extend X enrichment to extract player NER from x_posts.text and write mention_facts rows per match.',
    })
  }
  if (redditMentions === 0) {
    pending.push({
      section: 'Reddit player attention',
      why: 'No mention_facts rows for tracked athletes on Reddit.',
      requiredSource: 'mention_facts (channel = reddit) with athlete_id populated',
      recommendation: 'Extend Reddit enrichment to NER player names from reddit_mentions.body + reddit_comments.comment_text.',
    })
  }
  if (playerProductConnections.length === 0) {
    pending.push({
      section: 'Player ↔ paddle connections',
      why: 'No mention_facts rows have both athlete_id AND product_id populated.',
      requiredSource: 'mention_facts with athlete_id AND product_id non-null',
      recommendation: 'Tighten enrichment prompt so the LLM extracts both athlete + product entities from the same comment when present.',
    })
  }

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
