'use client'

/**
 * Community Intel data adapter — unifies comments + crisis + community signals
 * into one fetcher that the /v2/community-intel page reads.
 *
 * Sources:
 *  - mention_facts (cross-channel rows with is_crisis + sentiment fields)
 *  - ig_comments     (per-comment text + likes + sentiment_label)
 *  - yt_comments     (per-comment text + likes + sentiment_label)
 *  - reddit_mentions (per-thread brand mention rows + sentiment)
 *  - reddit_comments (per-comment text + upvotes + sentiment_label)
 *
 * Every fetcher is wrapped to return `[]` on a missing table / RLS failure so
 * the page renders a graceful empty state instead of crashing.
 */

import { supabase } from '@/lib/shared/supabase'
import { type V2Brand } from './data'

// ─── Contextual guard for generic-name brands on Reddit ──────────────
// Some brand slugs collide with common English / non-pickleball terms
// ("gamma" → r/spain, r/lasplamas; "head" → tennis/hair/body part).
// For these brands we only count a reddit row if its text/subreddit ALSO
// carries a pickleball-context token. Brands NOT in this map pass through.
const REDDIT_BRAND_CONTEXT_REQUIRED: Record<string, string[]> = {
  gamma: ['pickleball', 'paddle', 'pickle ball', 'pickler', 'gamma sports', 'rzr', 'needle', 'compass'],
  head: ['pickleball', 'paddle', 'pickle ball', 'pickler', 'head pickleball', 'radical', 'gravity', 'extreme tour'],
}

function redditPassesBrandContext(slug: string, row: { subreddit?: string | null; title?: string | null; body?: string | null; comment_text?: string | null }): boolean {
  const required = REDDIT_BRAND_CONTEXT_REQUIRED[slug]
  if (!required) return true
  const blob = `${row.subreddit || ''} ${row.title || ''} ${row.body || ''} ${row.comment_text || ''}`.toLowerCase()
  return required.some((tok) => blob.includes(tok))
}

// ─── Shapes ───────────────────────────────────────────────────────────

export type CommunityChannel = 'ig' | 'yt' | 'reddit' | 'tiktok' | 'x'
export type CommunitySentiment = 'positive' | 'neutral' | 'negative' | 'unknown'

export type CommunitySignal = {
  id: string
  source: CommunityChannel | string
  sourceLabel: string
  brand: string
  signalType: 'comment' | 'mention' | 'crisis'
  summary: string
  sentiment: CommunitySentiment
  isCrisis: boolean
  date: string                  // YYYY-MM-DD
  postedAt: string              // raw ISO
  days: number
  link: string
  likes: number                 // likes / upvotes / score
  /** mention_facts.id when the signal originated there, otherwise table::id */
  uniqueKey: string
}

export type BrandDiscussionRow = {
  brand: string
  total: number
  ig: number
  yt: number
  reddit: number
  tiktok: number
  x: number
  positive: number
  neutral: number
  negative: number
  crisis: number
  negativePct: number
}

export type ChannelStat = { channel: string; label: string; color: string; total: number; crisis: number }
export type HeatmapCell = {
  brand: string
  channel: string
  total: number
  crisis: number
  negative: number
}

export type SentimentStat = {
  brand: string
  total: number
  positive: number
  neutral: number
  negative: number
  crisis: number
  negativePct: number
  risk: 'low' | 'moderate' | 'high' | 'critical'
}

export type TrendPoint = {
  date: string
  total: number
  crisis: number
  joola: number
  negative: number
}

export type CommunityIntelData = {
  brands: V2Brand[]
  signals: CommunitySignal[]              // unified, deduped, sorted by date desc
  crisisSignals: CommunitySignal[]        // subset where isCrisis
  joolaSignals: CommunitySignal[]         // subset where brand === 'joola'
  brandDiscussion: BrandDiscussionRow[]
  channelStats: ChannelStat[]
  heatmap: HeatmapCell[]
  sentimentStats: SentimentStat[]
  trend: TrendPoint[]
  summary: {
    totalSignals: number
    commentsAnalyzed: number
    openCrisis30d: number
    topBrand: string | null
    topBrandAtRisk: string | null
    topChannel: string | null
    joolaMentions: number
    negativePct: number
  }
  dataStatus: {
    mentionFactsTotal: number             // 0 when sandbox / RLS blocks
    sentimentCoverage: number             // 0..1 fraction of signals with non-'unknown' sentiment
    hasIncidentLifecycle: boolean         // false — schema lacks status/severity columns
  }
}

// ─── Extended types for additional sections ───────────────────────────

export type ComplaintRow = {
  brand: string
  topTopic: string
  crisisCount: number
  negativePct: number
  totalNegative: number
  examples: string[]
  opportunity: string
}

export type DefectionRow = {
  fromBrand: string
  toBrand: string
  count: number
  confidence: number
  exampleText: string
  opportunity: string
}

export type DefectionKpis = {
  joolaInflow: number
  joolaOutflow: number
  joolaNet: number
  totalSwitches: number
}

export type TopicLifecycleRow = {
  topic: string
  firstSeenChannel: string
  peakDate: string | null
  peakMentions: number
  channelsTouched: string[]
  isCrisis: boolean
  decayedAt: string | null
  action: string
}

export type BrandReplyRow = {
  brand: string
  avgResponseMins: number | null
  complaintsReplied: number
  complaintsIgnored: number
  joolaRank: number
}

// ─── Internals ────────────────────────────────────────────────────────

const MISSING_TABLE_RE =
  /(does not exist|42P01|relation .* does not exist|Could not find the table)/i

function isMissingTable(error: unknown): boolean {
  if (!error) return false
  const msg = String((error as { message?: string }).message || error)
  return MISSING_TABLE_RE.test(msg)
}

function dayKey(iso: string | null | undefined): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

function diffDays(iso: string | null | undefined): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000))
}

function normalizeSentiment(raw: unknown): CommunitySentiment {
  const s = String(raw || '').toLowerCase().trim()
  if (s === 'positive' || s === 'pos') return 'positive'
  if (s === 'negative' || s === 'neg') return 'negative'
  if (s === 'neutral' || s === 'neu' || s === 'mixed') return 'neutral'
  return 'unknown'
}

function normalizeChannel(channel: string): CommunityChannel {
  const c = (channel || '').toLowerCase()
  if (c.includes('ig')) return 'ig'
  if (c.includes('yt') || c.includes('youtube')) return 'yt'
  if (c.includes('reddit')) return 'reddit'
  if (c.includes('tiktok')) return 'tiktok'
  if (c === 'x' || c.includes('twitter')) return 'x'
  return 'reddit'
}

const SOURCE_LABEL: Record<string, string> = {
  ig: 'Instagram',
  yt: 'YouTube',
  reddit: 'Reddit',
  tiktok: 'TikTok',
  x: 'X / Twitter',
}

export function communityChannelLabel(c: string): string {
  return SOURCE_LABEL[c] || c
}

const CHANNEL_COLOR: Record<string, string> = {
  ig: '#e1306c',
  yt: '#ef4444',
  reddit: '#ff4500',
  tiktok: '#69c9d0',
  x: '#1d9bf0',
}

export function communityChannelColor(c: string): string {
  return CHANNEL_COLOR[c] || '#94a3b8'
}

function normalizeText(t: string): string {
  return String(t || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80)
}

// ─── Fetcher ──────────────────────────────────────────────────────────

interface FetchOpts {
  from: Date
  to: Date
  /** Soft cap per source — guard against runaway payloads. */
  perSourceLimit?: number
}

export async function fetchCommunityIntel(
  brands: V2Brand[],
  opts: FetchOpts,
): Promise<CommunityIntelData> {
  const perSourceLimit = opts.perSourceLimit ?? 5000
  const fromIso = opts.from.toISOString()
  const toIso = opts.to.toISOString()

  const slugByBid: Record<string, string> = Object.fromEntries(
    brands.map((b) => [b.brand_id, b.id]),
  )

  // Fire every source in parallel. Each block traps missing-table errors so
  // a single broken pipeline doesn't black-hole the whole page.
  const [
    igCommentsRes,
    ytCommentsRes,
    redditMentionsRes,
    redditCommentsRes,
    mentionFactsRes,
    mentionFactsCountRes,
  ] = await Promise.all([
    safeQuery(
      supabase
        .from('ig_comments')
        .select('id,brand_id,post_id,commenter_username,comment_text,comment_likes,posted_at,sentiment_label')
        .gte('posted_at', fromIso)
        .lte('posted_at', toIso)
        .order('posted_at', { ascending: false })
        .limit(perSourceLimit),
    ),
    safeQuery(
      supabase
        .from('yt_comments')
        .select('id,brand_id,video_id,commenter_username,comment_text,comment_likes,posted_at,sentiment_label')
        .gte('posted_at', fromIso)
        .lte('posted_at', toIso)
        .order('posted_at', { ascending: false })
        .limit(perSourceLimit),
    ),
    safeQuery(
      supabase
        .from('reddit_mentions')
        .select('id,brand_id,subreddit,title,body,score,num_comments,url,posted_at,sentiment:sentiment_label')
        .gte('posted_at', fromIso)
        .lte('posted_at', toIso)
        .order('posted_at', { ascending: false })
        .limit(perSourceLimit),
    ),
    safeQuery(
      supabase
        .from('reddit_comments')
        .select('id,brand_id,parent_post_id,subreddit,author,comment_text,upvotes,posted_at,sentiment_label')
        .gte('posted_at', fromIso)
        .lte('posted_at', toIso)
        .order('posted_at', { ascending: false })
        .limit(perSourceLimit),
    ),
    safeQuery(
      supabase
        .from('mention_facts')
        .select('id,channel,source_table,source_id,brand_id,sentiment_score,sentiment_label,is_crisis,text_snippet,posted_at')
        .gte('posted_at', fromIso)
        .lte('posted_at', toIso)
        .order('posted_at', { ascending: false })
        .limit(perSourceLimit * 2),
    ),
    safeQuery(
      supabase
        .from('mention_facts')
        .select('id', { count: 'exact' })
        .limit(1),
    ),
  ])

  // ─── Build unified signal list ──────────────────────────────────────

  const rawSignals: CommunitySignal[] = []
  const seenKeys = new Set<string>()

  function pushSignal(s: CommunitySignal): void {
    if (seenKeys.has(s.uniqueKey)) return
    seenKeys.add(s.uniqueKey)
    rawSignals.push(s)
  }

  // mention_facts first — these are the canonical enriched rows with is_crisis.
  for (const r of mentionFactsRes.data) {
    const slug = slugByBid[r.brand_id] || ''
    if (!slug) continue
    const channel = normalizeChannel(r.channel)
    const sentiment = normalizeSentiment(r.sentiment_label)
    const text = String(r.text_snippet || '').trim()
    const date = dayKey(r.posted_at)
    const dedupKey = `${slug}::${normalizeText(text)}::${date}`
    pushSignal({
      id: r.id,
      source: channel,
      sourceLabel: SOURCE_LABEL[channel] || channel,
      brand: slug,
      signalType: r.is_crisis ? 'crisis' : 'mention',
      summary: text || '(no snippet)',
      sentiment,
      isCrisis: !!r.is_crisis,
      date,
      postedAt: r.posted_at,
      days: diffDays(r.posted_at),
      link: '', // mention_facts has no canonical link column
      likes: 0,
      uniqueKey: `mf::${r.id}`,
    })
    // Also reserve the content-key so downstream comment rows that mirror this
    // mention don't double-count.
    seenKeys.add(`txt::${dedupKey}`)
  }

  // IG comments
  for (const c of igCommentsRes.data) {
    const slug = slugByBid[c.brand_id] || ''
    if (!slug) continue
    const text = String(c.comment_text || '').trim()
    if (!text) continue
    const date = dayKey(c.posted_at)
    const contentKey = `txt::${slug}::${normalizeText(text)}::${date}`
    if (seenKeys.has(contentKey)) continue
    seenKeys.add(contentKey)
    pushSignal({
      id: c.id || `ig::${c.brand_id}::${date}::${(c.commenter_username || '').slice(0, 16)}`,
      source: 'ig',
      sourceLabel: 'Instagram',
      brand: slug,
      signalType: 'comment',
      summary: text,
      sentiment: normalizeSentiment(c.sentiment_label),
      isCrisis: false,
      date,
      postedAt: c.posted_at,
      days: diffDays(c.posted_at),
      link: c.commenter_username
        ? `https://www.instagram.com/${String(c.commenter_username).replace(/^@/, '')}/`
        : '',
      likes: c.comment_likes || 0,
      uniqueKey: `ig::${c.id || contentKey}`,
    })
  }

  // YT comments
  for (const c of ytCommentsRes.data) {
    const slug = slugByBid[c.brand_id] || ''
    if (!slug) continue
    const text = String(c.comment_text || '').trim()
    if (!text) continue
    const date = dayKey(c.posted_at)
    const contentKey = `txt::${slug}::${normalizeText(text)}::${date}`
    if (seenKeys.has(contentKey)) continue
    seenKeys.add(contentKey)
    pushSignal({
      id: c.id || `yt::${c.brand_id}::${date}::${(c.commenter_username || '').slice(0, 16)}`,
      source: 'yt',
      sourceLabel: 'YouTube',
      brand: slug,
      signalType: 'comment',
      summary: text,
      sentiment: normalizeSentiment(c.sentiment_label),
      isCrisis: false,
      date,
      postedAt: c.posted_at,
      days: diffDays(c.posted_at),
      link: c.commenter_username
        ? `https://www.youtube.com/@${String(c.commenter_username).replace(/^@/, '')}`
        : '',
      likes: c.comment_likes || 0,
      uniqueKey: `yt::${c.id || contentKey}`,
    })
  }

  // Reddit mentions (per-thread)
  for (const r of redditMentionsRes.data) {
    const slug = slugByBid[r.brand_id] || ''
    if (!slug) continue
    if (!redditPassesBrandContext(slug, r)) continue
    const text = String(r.title || r.body || '').trim()
    if (!text) continue
    const date = dayKey(r.posted_at)
    const contentKey = `txt::${slug}::${normalizeText(text)}::${date}`
    if (seenKeys.has(contentKey)) continue
    seenKeys.add(contentKey)
    pushSignal({
      id: r.id,
      source: 'reddit',
      sourceLabel: 'Reddit',
      brand: slug,
      signalType: 'mention',
      summary: text,
      sentiment: normalizeSentiment(r.sentiment),
      isCrisis: false,
      date,
      postedAt: r.posted_at,
      days: diffDays(r.posted_at),
      link: r.url || '',
      likes: r.score || 0,
      uniqueKey: `rm::${r.id}`,
    })
  }

  // Reddit comments
  for (const c of redditCommentsRes.data) {
    const slug = slugByBid[c.brand_id] || ''
    if (!slug) continue
    if (!redditPassesBrandContext(slug, c)) continue
    const text = String(c.comment_text || '').trim()
    if (!text) continue
    const date = dayKey(c.posted_at)
    const contentKey = `txt::${slug}::${normalizeText(text)}::${date}`
    if (seenKeys.has(contentKey)) continue
    seenKeys.add(contentKey)
    pushSignal({
      id: c.id,
      source: 'reddit',
      sourceLabel: 'Reddit',
      brand: slug,
      signalType: 'comment',
      summary: text,
      sentiment: normalizeSentiment(c.sentiment_label),
      isCrisis: false,
      date,
      postedAt: c.posted_at,
      days: diffDays(c.posted_at),
      link: c.author
        ? `https://www.reddit.com/user/${String(c.author).replace(/^u\//, '')}/`
        : '',
      likes: c.upvotes || 0,
      uniqueKey: `rc::${c.id}`,
    })
  }

  // Sort newest first
  rawSignals.sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''))

  // ─── Derive aggregates ──────────────────────────────────────────────

  const brandDiscussion = computeBrandDiscussion(rawSignals, brands)
  const channelStats = computeChannelStats(rawSignals)
  const heatmap = computeHeatmap(rawSignals)
  const sentimentStats = computeSentimentStats(rawSignals)
  const trend = computeTrend(rawSignals, opts.from, opts.to)

  const crisisSignals = rawSignals.filter((s) => s.isCrisis)
  const joolaSignals = rawSignals.filter((s) => s.brand === 'joola')

  const now = Date.now()
  const openCrisis30d = crisisSignals.filter(
    (s) => now - new Date(s.postedAt).getTime() < 30 * 86_400_000,
  ).length

  const totalNegative = rawSignals.filter((s) => s.sentiment === 'negative').length
  const negativePct = rawSignals.length > 0
    ? Math.round((totalNegative / rawSignals.length) * 100)
    : 0

  const topBrandRow = brandDiscussion[0]
  const topBrandAtRiskRow = [...brandDiscussion].sort((a, b) => b.crisis - a.crisis)[0]
  const topChannelRow = [...channelStats].sort((a, b) => b.total - a.total)[0]

  const commentsAnalyzed =
    igCommentsRes.data.length +
    ytCommentsRes.data.length +
    redditCommentsRes.data.length

  const sentimentKnown = rawSignals.filter((s) => s.sentiment !== 'unknown').length

  return {
    brands,
    signals: rawSignals,
    crisisSignals,
    joolaSignals,
    brandDiscussion,
    channelStats,
    heatmap,
    sentimentStats,
    trend,
    summary: {
      totalSignals: rawSignals.length,
      commentsAnalyzed,
      openCrisis30d,
      topBrand: topBrandRow ? topBrandRow.brand : null,
      topBrandAtRisk: topBrandAtRiskRow && topBrandAtRiskRow.crisis > 0 ? topBrandAtRiskRow.brand : null,
      topChannel: topChannelRow ? topChannelRow.channel : null,
      joolaMentions: joolaSignals.length,
      negativePct,
    },
    dataStatus: {
      mentionFactsTotal: mentionFactsCountRes.count ?? 0,
      sentimentCoverage: rawSignals.length > 0
        ? sentimentKnown / rawSignals.length
        : 0,
      hasIncidentLifecycle: false, // mention_facts has no status/severity columns
    },
  }
}

// ─── Aggregation helpers ──────────────────────────────────────────────

function computeBrandDiscussion(
  signals: CommunitySignal[],
  brands: V2Brand[],
): BrandDiscussionRow[] {
  const acc = new Map<string, BrandDiscussionRow>()

  for (const s of signals) {
    if (!s.brand) continue
    if (!acc.has(s.brand)) {
      acc.set(s.brand, {
        brand: s.brand,
        total: 0,
        ig: 0,
        yt: 0,
        reddit: 0,
        tiktok: 0,
        x: 0,
        positive: 0,
        neutral: 0,
        negative: 0,
        crisis: 0,
        negativePct: 0,
      })
    }
    const row = acc.get(s.brand)!
    row.total += 1
    const norm = normalizeChannel(String(s.source))
    if (norm === 'ig') row.ig += 1
    else if (norm === 'yt') row.yt += 1
    else if (norm === 'reddit') row.reddit += 1
    else if (norm === 'tiktok') row.tiktok += 1
    else if (norm === 'x') row.x += 1
    if (s.sentiment === 'positive') row.positive += 1
    else if (s.sentiment === 'negative') row.negative += 1
    else if (s.sentiment === 'neutral') row.neutral += 1
    if (s.isCrisis) row.crisis += 1
  }

  // Make sure every tracked brand appears (even with zero rows) so the table
  // doesn't silently drop quiet brands.
  for (const b of brands) {
    if (!acc.has(b.id)) {
      acc.set(b.id, {
        brand: b.id,
        total: 0,
        ig: 0,
        yt: 0,
        reddit: 0,
        tiktok: 0,
        x: 0,
        positive: 0,
        neutral: 0,
        negative: 0,
        crisis: 0,
        negativePct: 0,
      })
    }
  }

  const rows = Array.from(acc.values())
  for (const r of rows) {
    const sentimentTotal = r.positive + r.neutral + r.negative
    r.negativePct = sentimentTotal > 0 ? Math.round((r.negative / sentimentTotal) * 100) : 0
  }
  return rows.sort((a, b) => b.total - a.total)
}

function computeChannelStats(signals: CommunitySignal[]): ChannelStat[] {
  const acc = new Map<string, ChannelStat>()
  for (const s of signals) {
    const ch = String(s.source)
    if (!acc.has(ch)) {
      acc.set(ch, {
        channel: ch,
        label: SOURCE_LABEL[ch] || ch,
        color: CHANNEL_COLOR[ch] || '#94a3b8',
        total: 0,
        crisis: 0,
      })
    }
    const row = acc.get(ch)!
    row.total += 1
    if (s.isCrisis) row.crisis += 1
  }
  return Array.from(acc.values()).sort((a, b) => b.total - a.total)
}

function computeHeatmap(signals: CommunitySignal[]): HeatmapCell[] {
  const acc = new Map<string, HeatmapCell>()
  for (const s of signals) {
    if (!s.brand) continue
    const key = `${s.brand}::${s.source}`
    if (!acc.has(key)) {
      acc.set(key, { brand: s.brand, channel: String(s.source), total: 0, crisis: 0, negative: 0 })
    }
    const row = acc.get(key)!
    row.total += 1
    if (s.isCrisis) row.crisis += 1
    if (s.sentiment === 'negative') row.negative += 1
  }
  return Array.from(acc.values())
}

function computeSentimentStats(signals: CommunitySignal[]): SentimentStat[] {
  const acc = new Map<string, SentimentStat>()
  for (const s of signals) {
    if (!s.brand) continue
    if (!acc.has(s.brand)) {
      acc.set(s.brand, {
        brand: s.brand,
        total: 0,
        positive: 0,
        neutral: 0,
        negative: 0,
        crisis: 0,
        negativePct: 0,
        risk: 'low',
      })
    }
    const row = acc.get(s.brand)!
    row.total += 1
    if (s.sentiment === 'positive') row.positive += 1
    else if (s.sentiment === 'negative') row.negative += 1
    else if (s.sentiment === 'neutral') row.neutral += 1
    if (s.isCrisis) row.crisis += 1
  }
  const out = Array.from(acc.values())
  for (const r of out) {
    r.negativePct = r.total > 0 ? Math.round((r.negative / r.total) * 100) : 0
    r.risk = computeRisk(r.crisis, r.negativePct, r.total)
  }
  return out.sort((a, b) => b.crisis - a.crisis || b.negativePct - a.negativePct)
}

function computeRisk(crisis: number, negPct: number, total: number): SentimentStat['risk'] {
  if (crisis >= 5 || (total >= 25 && negPct >= 50)) return 'critical'
  if (crisis >= 2 || (total >= 10 && negPct >= 30)) return 'high'
  if (crisis >= 1 || (total >= 5 && negPct >= 15)) return 'moderate'
  return 'low'
}

function computeTrend(
  signals: CommunitySignal[],
  from: Date,
  to: Date,
): TrendPoint[] {
  const fromUtc = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()))
  const toUtc = new Date(Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()))
  const days = Math.max(
    1,
    Math.floor((toUtc.getTime() - fromUtc.getTime()) / 86_400_000) + 1,
  )
  // Cap at ~120 days to keep the chart readable; for longer windows we bucket
  // to weeks instead of days.
  const cap = 120
  const bucketDays = days > cap ? Math.ceil(days / cap) : 1

  const buckets = new Map<string, TrendPoint>()
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  for (let d = new Date(fromUtc); d.getTime() <= toUtc.getTime(); d.setUTCDate(d.getUTCDate() + bucketDays)) {
    const k = d.toISOString().slice(0, 10)
    buckets.set(k, { date: k, total: 0, crisis: 0, joola: 0, negative: 0 })
  }

  for (const s of signals) {
    if (!s.date) continue
    let bucketKey = s.date
    if (bucketDays > 1) {
      const sDate = new Date(s.date + 'T00:00:00Z')
      if (Number.isNaN(sDate.getTime())) continue
      const offsetDays = Math.floor((sDate.getTime() - fromUtc.getTime()) / 86_400_000)
      if (offsetDays < 0) continue
      const bucketIdx = Math.floor(offsetDays / bucketDays)
      const bucketStart = new Date(fromUtc)
      bucketStart.setUTCDate(bucketStart.getUTCDate() + bucketIdx * bucketDays)
      bucketKey = bucketStart.toISOString().slice(0, 10)
    }
    const point = buckets.get(bucketKey)
    if (!point) continue
    point.total += 1
    if (s.isCrisis) point.crisis += 1
    if (s.brand === 'joola') point.joola += 1
    if (s.sentiment === 'negative') point.negative += 1
  }
  return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Extended fetchers for new community-intel sections ───────────────

/**
 * Competitor Complaint Map — per-brand top complaint topic + examples.
 * Pulls crisis_keywords + comment_text from ig_comments / yt_comments /
 * reddit_comments / tiktok_comments (all have crisis_keywords text[]).
 */
export async function fetchComplaintMap(
  brands: V2Brand[],
  opts: { from: Date; to: Date },
): Promise<ComplaintRow[]> {
  const fromIso = opts.from.toISOString()
  const toIso = opts.to.toISOString()
  const slugByBid: Record<string, string> = Object.fromEntries(brands.map(b => [b.brand_id, b.id]))

  const [igCom, ytCom, redCom, ttCom] = await Promise.all([
    safeQuery(
      supabase.from('ig_comments')
        .select('brand_id,comment_text,sentiment_label,crisis_keywords,is_crisis,posted_at')
        .or('is_crisis.eq.true,sentiment_label.eq.negative')
        .gte('posted_at', fromIso).lte('posted_at', toIso)
        .limit(3000),
    ),
    safeQuery(
      supabase.from('yt_comments')
        .select('brand_id,comment_text,sentiment_label,crisis_keywords,is_crisis,posted_at')
        .or('is_crisis.eq.true,sentiment_label.eq.negative')
        .gte('posted_at', fromIso).lte('posted_at', toIso)
        .limit(3000),
    ),
    safeQuery(
      supabase.from('reddit_comments')
        .select('brand_id,comment_text,sentiment_label,crisis_keywords,is_crisis,posted_at,subreddit')
        .or('is_crisis.eq.true,sentiment_label.eq.negative')
        .gte('posted_at', fromIso).lte('posted_at', toIso)
        .limit(3000),
    ),
    safeQuery(
      supabase.from('tiktok_comments')
        .select('brand_id,comment_text,sentiment_label,crisis_keywords,is_crisis,posted_at')
        .or('is_crisis.eq.true,sentiment_label.eq.negative')
        .gte('posted_at', fromIso).lte('posted_at', toIso)
        .limit(3000),
    ),
  ])

  type Bucket = {
    brand: string
    total: number
    negative: number
    crisis: number
    keywords: Record<string, number>
    examples: string[]
  }
  const buckets = new Map<string, Bucket>()

  function ingest(row: any, slug: string): void {
    if (!buckets.has(slug)) {
      buckets.set(slug, { brand: slug, total: 0, negative: 0, crisis: 0, keywords: {}, examples: [] })
    }
    const b = buckets.get(slug)!
    b.total += 1
    if (row.sentiment_label === 'negative') b.negative += 1
    if (row.is_crisis) b.crisis += 1
    const kws: string[] = Array.isArray(row.crisis_keywords) ? row.crisis_keywords : []
    for (const kw of kws) {
      const k = String(kw || '').toLowerCase().trim()
      if (!k || k.length < 3) continue
      b.keywords[k] = (b.keywords[k] || 0) + 1
    }
    const txt = String(row.comment_text || '').trim()
    if (txt && b.examples.length < 3 && !b.examples.includes(txt)) {
      b.examples.push(txt.slice(0, 220))
    }
  }

  for (const arr of [igCom.data, ytCom.data, redCom.data, ttCom.data]) {
    if (!arr) continue
    for (const row of arr) {
      const slug = slugByBid[row.brand_id] || ''
      if (!slug) continue
      // Reddit context guard for generic-name brands
      if (arr === redCom.data && !redditPassesBrandContext(slug, row)) continue
      ingest(row, slug)
    }
  }

  const rows: ComplaintRow[] = []
  const allBuckets = Array.from(buckets.values())
  for (const b of allBuckets) {
    const entries = Object.entries(b.keywords) as [string, number][]
    entries.sort((a, z) => z[1] - a[1])
    const top = entries[0]
    const topTopic = top ? top[0] : '(uncategorized)'
    const negPct = b.total > 0 ? Math.round((b.negative / b.total) * 100) : 0
    rows.push({
      brand: b.brand,
      topTopic,
      crisisCount: b.crisis,
      negativePct: negPct,
      totalNegative: b.negative,
      examples: b.examples,
      opportunity: opportunityForComplaint(b.brand, topTopic, negPct, b.crisis),
    })
  }
  return rows.sort((a, c) => c.crisisCount - a.crisisCount || c.negativePct - a.negativePct)
}

function opportunityForComplaint(brand: string, topic: string, negPct: number, crisis: number): string {
  if (brand === 'joola') {
    if (crisis > 0) return 'Address own crisis on this topic first.'
    return 'Monitor — own brand complaints in window.'
  }
  if (crisis >= 3 || negPct >= 40) return `Run content addressing "${topic}" — competitor weakness.`
  if (negPct >= 20) return `Light counter-positioning around "${topic}".`
  return 'Watch — not yet a campaign-worthy gap.'
}

/**
 * Defection Signals — competitor_switch_events grouped by (from_brand, to_brand).
 */
export async function fetchDefectionSignals(
  brands: V2Brand[],
  opts: { from: Date; to: Date },
): Promise<{ rows: DefectionRow[]; kpis: DefectionKpis }> {
  const fromIso = opts.from.toISOString()
  const toIso = opts.to.toISOString()
  const slugByBid: Record<string, string> = Object.fromEntries(brands.map(b => [b.brand_id, b.id]))

  const events = await safeQuery(
    supabase.from('competitor_switch_events')
      .select('from_brand_id,to_brand_id,confidence,text_snippet,posted_at')
      .gte('posted_at', fromIso).lte('posted_at', toIso)
      .limit(2000),
  )

  type Bucket = {
    fromBrand: string
    toBrand: string
    count: number
    confidenceSum: number
    examples: string[]
  }
  const map = new Map<string, Bucket>()
  let inflow = 0
  let outflow = 0

  for (const e of events.data) {
    const fromSlug = slugByBid[e.from_brand_id] || ''
    const toSlug = slugByBid[e.to_brand_id] || ''
    if (!fromSlug || !toSlug) continue
    if (toSlug === 'joola') inflow += 1
    if (fromSlug === 'joola') outflow += 1
    const key = `${fromSlug}::${toSlug}`
    if (!map.has(key)) {
      map.set(key, { fromBrand: fromSlug, toBrand: toSlug, count: 0, confidenceSum: 0, examples: [] })
    }
    const b = map.get(key)!
    b.count += 1
    b.confidenceSum += Number(e.confidence || 0)
    const txt = String(e.text_snippet || '').trim()
    if (txt && b.examples.length === 0) b.examples.push(txt.slice(0, 220))
  }

  const rows: DefectionRow[] = Array.from(map.values()).map(b => ({
    fromBrand: b.fromBrand,
    toBrand: b.toBrand,
    count: b.count,
    confidence: b.count > 0 ? Number((b.confidenceSum / b.count).toFixed(2)) : 0,
    exampleText: b.examples[0] || '',
    opportunity: opportunityForDefection(b.fromBrand, b.toBrand),
  })).sort((a, c) => c.count - a.count)

  return {
    rows,
    kpis: {
      joolaInflow: inflow,
      joolaOutflow: outflow,
      joolaNet: inflow - outflow,
      totalSwitches: events.data.length,
    },
  }
}

function opportunityForDefection(fromSlug: string, toSlug: string): string {
  if (toSlug === 'joola') return 'Amplify — capture story for testimonial / content.'
  if (fromSlug === 'joola') return 'Investigate churn — root-cause + retention play.'
  return 'Watch market shift — track velocity and reasons.'
}

/**
 * Topic Lifecycle Radar — pulled from topic_lifecycle.
 * Empty when the populator is broken (known PGRST204 brand_id bug).
 */
export async function fetchTopicLifecycle(): Promise<TopicLifecycleRow[]> {
  const res = await safeQuery(
    supabase.from('topic_lifecycle')
      .select('topic_slug,display_label,first_seen_channel,peak_at,peak_mentions_24h,channels_touched,is_crisis,decayed_at,total_mentions')
      .order('peak_at', { ascending: false })
      .limit(200),
  )
  const now = Date.now()
  return res.data.map((r): TopicLifecycleRow => {
    const peakAt = r.peak_at || null
    const ageDays = peakAt ? Math.floor((now - new Date(peakAt).getTime()) / 86_400_000) : 999
    let action = 'Monitor'
    if (r.is_crisis && !r.decayed_at) action = 'Respond before spread'
    else if (ageDays > 7) action = 'Likely decayed'
    else if (peakAt && ageDays <= 3) action = 'Engage in conversation'
    return {
      topic: r.display_label || r.topic_slug || '(unknown topic)',
      firstSeenChannel: r.first_seen_channel || '—',
      peakDate: peakAt,
      peakMentions: r.peak_mentions_24h || 0,
      channelsTouched: Array.isArray(r.channels_touched) ? r.channels_touched : [],
      isCrisis: !!r.is_crisis,
      decayedAt: r.decayed_at || null,
      action,
    }
  })
}

/**
 * Brand Reply Advantage — pulled from brand_replies.
 * Empty when detect_brand_replies.py is not in the default scheduler.
 */
export async function fetchBrandReplies(brands: V2Brand[]): Promise<BrandReplyRow[]> {
  const slugByBid: Record<string, string> = Object.fromEntries(brands.map(b => [b.brand_id, b.id]))
  const res = await safeQuery(
    supabase.from('brand_replies')
      .select('replying_brand_id,response_time_mins,reply_text,sentiment')
      .limit(5000),
  )
  type Bucket = { brand: string; sum: number; n: number; replied: number; ignored: number }
  const buckets = new Map<string, Bucket>()
  for (const r of res.data) {
    const slug = slugByBid[r.replying_brand_id] || ''
    if (!slug) continue
    if (!buckets.has(slug)) {
      buckets.set(slug, { brand: slug, sum: 0, n: 0, replied: 0, ignored: 0 })
    }
    const b = buckets.get(slug)!
    if (r.reply_text) {
      b.replied += 1
      if (typeof r.response_time_mins === 'number' && r.response_time_mins >= 0) {
        b.sum += r.response_time_mins
        b.n += 1
      }
    } else {
      b.ignored += 1
    }
  }
  const rows = Array.from(buckets.values()).map(b => ({
    brand: b.brand,
    avgResponseMins: b.n > 0 ? Math.round(b.sum / b.n) : null,
    complaintsReplied: b.replied,
    complaintsIgnored: b.ignored,
    joolaRank: 0,
  }))
  rows.sort((a, c) => (a.avgResponseMins ?? Infinity) - (c.avgResponseMins ?? Infinity))
  rows.forEach((r, i) => { r.joolaRank = i + 1 })
  return rows
}

// ─── Safe-query wrapper ───────────────────────────────────────────────

interface SafeQueryResult<T> {
  data: T[]
  count: number | null
  ok: boolean
}

// supabase-js Promise-like is not typed for our wrapper; treat as `any`.
async function safeQuery(builder: any): Promise<SafeQueryResult<any>> {
  try {
    const { data, count, error } = await builder
    if (error) {
      if (!isMissingTable(error)) {
        // eslint-disable-next-line no-console
        console.warn('[communityIntel] query failed:', error)
      }
      return { data: [], count: null, ok: false }
    }
    return { data: data || [], count: count ?? null, ok: true }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[communityIntel] query threw:', err)
    return { data: [], count: null, ok: false }
  }
}
