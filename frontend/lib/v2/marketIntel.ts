'use client'

/**
 * Market Intel — command-center data layer.
 *
 * Single-page summary across every domain we already track:
 *   - Product attention      (product_attention_summary, period last_30d)
 *   - Campaign pressure      (ad_pressure_daily + promotion_daily, last 30d avg)
 *   - Community sentiment    (mention_facts, last 30d)
 *   - Influencer impact      (mention_facts WHERE athlete_id IS NOT NULL, last 30d)
 *   - Sales/stock movement   (inventory_events, last 30d)
 *
 * We pull ONE row set per table (LIMIT-bounded) and aggregate in JS so the
 * page issues ~5 base queries instead of 11 brand-scoped ones. Every query
 * is wrapped with safeQuery so missing tables / RLS denials degrade
 * gracefully to an empty area instead of crashing the page.
 *
 * Used by /v2/market for:
 *   D. Command Center Summary table
 *   E. Competitor Strategy Summary cards
 */

import { supabase } from '@/lib/shared/supabase'
import { type V2Brand } from '@/lib/v2/data'

// ─── Public shapes ───────────────────────────────────────────────────

export type MarketIntelArea =
  | 'product'
  | 'campaign'
  | 'community'
  | 'influencer'
  | 'sales'

export interface CommandCenterRow {
  area: MarketIntelArea
  areaLabel: string
  winnerBrand: string | null          // slug
  winnerValue: number                 // headline metric for the winner
  winnerLabel: string                 // pretty description of the metric
  joolaRank: number | null            // 1 = top
  joolaValue: number                  // JOOLA's value on the same metric
  threatBrand: string | null          // top non-JOOLA brand
  threatValue: number
  recommendedAction: string
  caveat?: string                     // e.g. "sentiment classifier calibrating"
}

export interface BrandStrategyCard {
  brand: string                       // slug (non-JOOLA only)
  strategyLabel: string               // 'Premium + YouTube reach', etc.
  evidence: string[]                  // short bullet evidence strings
  joolaCounterMove: string
  // Underlying ranks/quadrants used to compute the label
  campaignQuadrant: CampaignQuadrant
  productRank: number | null
  dominantTheme: string | null
  athleteMentions: number
  inventoryEvents: number
}

export type CampaignQuadrant =
  | 'aggressive-growth'    // high ads + high promos
  | 'brand-building'       // high ads + low promos
  | 'price-sensitive'      // low ads + high promos
  | 'quiet'                // low ads + low promos

export interface MarketIntelData {
  command: CommandCenterRow[]
  strategies: BrandStrategyCard[]
  caveats: {
    sentimentCalibrating: boolean
  }
}

// ─── Internal raw shapes ─────────────────────────────────────────────
interface RawAdPressure {
  brand_id: string
  metric_date: string
  active_creatives: number | null
  ad_pressure_score: number | null
}

interface RawPromotionDaily {
  brand_id: string
  metric_date: string
  promo_active_flag: number | null
  promo_depth_pct: number | null
}

interface RawAttentionSummary {
  brand_id: string
  period: string
  mentions_total: number | null
  attention_score: number | null
}

interface RawMentionFact {
  brand_id: string
  athlete_id: string | null
  sentiment_label: string | null
  is_crisis: boolean | null
  posted_at: string | null
}

interface RawInventoryEvent {
  brand_id: string
  event_type: string | null
  event_time: string | null
}

interface RawIgProfile {
  brand_id: string
  dominant_content_theme: string | null
  year: number | null
  week_number: number | null
}

// ─── safeQuery (mirrors communityIntel pattern) ───────────────────────
async function safeQuery<T = unknown>(builder: unknown): Promise<{ data: T[]; ok: boolean }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = (await (builder as any))
    if (error) {
      // eslint-disable-next-line no-console
      if (!/(?:does not exist|relation .* does not exist|42P01)/i.test(String(error.message || error.code || ''))) {
        // eslint-disable-next-line no-console
        console.warn('[marketIntel] query failed:', error)
      }
      return { data: [], ok: false }
    }
    return { data: (data || []) as T[], ok: true }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[marketIntel] query threw:', err)
    return { data: [], ok: false }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────
const DAY_MS = 86_400_000

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString()
}

function rankOf(slug: string, ranking: Array<{ brand: string; value: number }>): number | null {
  const idx = ranking.findIndex((r) => r.brand === slug)
  if (idx < 0) return null
  return idx + 1
}

function topNonJoola(ranking: Array<{ brand: string; value: number }>): { brand: string; value: number } | null {
  return ranking.find((r) => r.brand !== 'joola' && r.value > 0) || null
}

function quadrantOf(ads: number, promos: number, adMedian: number, promoMedian: number): CampaignQuadrant {
  const hiA = ads >= adMedian
  const hiP = promos >= promoMedian
  if (hiA && hiP) return 'aggressive-growth'
  if (hiA && !hiP) return 'brand-building'
  if (!hiA && hiP) return 'price-sensitive'
  return 'quiet'
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

// ─── Main fetcher ────────────────────────────────────────────────────
export async function fetchMarketIntel(brands: V2Brand[]): Promise<MarketIntelData> {
  const slugByBid: Record<string, string> = Object.fromEntries(
    brands.map((b) => [b.brand_id, b.id]),
  )
  const since30d = isoDaysAgo(30)

  // Single round-trip for every input table — aggregation happens in JS.
  const [adPressureRes, promoDailyRes, attentionRes, mentionRes, inventoryRes, igThemeRes] = await Promise.all([
    safeQuery<RawAdPressure>(
      supabase
        .from('ad_pressure_daily')
        .select('brand_id,metric_date,active_creatives,ad_pressure_score')
        .gte('metric_date', since30d.slice(0, 10))
        .limit(5000),
    ),
    safeQuery<RawPromotionDaily>(
      supabase
        .from('promotion_daily')
        .select('brand_id,metric_date,promo_active_flag,promo_depth_pct')
        .gte('metric_date', since30d.slice(0, 10))
        .limit(10000),
    ),
    safeQuery<RawAttentionSummary>(
      supabase
        .from('product_attention_summary')
        .select('brand_id,period,mentions_total,attention_score')
        .eq('period', 'last_30d')
        .limit(2000),
    ),
    safeQuery<RawMentionFact>(
      supabase
        .from('mention_facts')
        .select('brand_id,athlete_id,sentiment_label,is_crisis,posted_at')
        .gte('posted_at', since30d)
        .limit(20000),
    ),
    safeQuery<RawInventoryEvent>(
      supabase
        .from('inventory_events')
        .select('brand_id,event_type,event_time')
        .gte('event_time', since30d)
        .limit(5000),
    ),
    safeQuery<RawIgProfile>(
      supabase
        .from('ig_profiles_weekly')
        .select('brand_id,dominant_content_theme,year,week_number')
        .order('year', { ascending: false })
        .order('week_number', { ascending: false })
        .limit(200),
    ),
  ])

  // ─── A. Product attention (last_30d aggregated per brand) ───────────
  const productByBrand = new Map<string, { mentions: number; attention: number }>()
  for (const r of attentionRes.data) {
    const slug = slugByBid[r.brand_id]
    if (!slug) continue
    const cur = productByBrand.get(slug) || { mentions: 0, attention: 0 }
    cur.mentions += Number(r.mentions_total || 0)
    cur.attention += Number(r.attention_score || 0)
    productByBrand.set(slug, cur)
  }
  const productRanking = Array.from(productByBrand.entries())
    .map(([brand, v]) => ({ brand, value: v.attention }))
    .sort((a, b) => b.value - a.value)

  // ─── B. Campaign pressure (ads * 0.5 + promos * 0.5 normalized) ─────
  const adAvgByBrand = new Map<string, { sum: number; count: number; active: number }>()
  for (const r of adPressureRes.data) {
    const slug = slugByBid[r.brand_id]
    if (!slug) continue
    const cur = adAvgByBrand.get(slug) || { sum: 0, count: 0, active: 0 }
    cur.sum += Number(r.ad_pressure_score || 0)
    cur.count += 1
    cur.active += Number(r.active_creatives || 0)
    adAvgByBrand.set(slug, cur)
  }
  const promoAvgByBrand = new Map<string, { sum: number; count: number; depth: number; depthCount: number }>()
  for (const r of promoDailyRes.data) {
    const slug = slugByBid[r.brand_id]
    if (!slug) continue
    const cur = promoAvgByBrand.get(slug) || { sum: 0, count: 0, depth: 0, depthCount: 0 }
    cur.sum += Number(r.promo_active_flag || 0)
    cur.count += 1
    if (r.promo_depth_pct != null) {
      cur.depth += Number(r.promo_depth_pct)
      cur.depthCount += 1
    }
    promoAvgByBrand.set(slug, cur)
  }
  const campaignByBrand = new Map<string, { adScore: number; promoScore: number; combined: number; ads: number; promos: number }>()
  for (const b of brands) {
    const a = adAvgByBrand.get(b.id)
    const p = promoAvgByBrand.get(b.id)
    const adScoreAvg = a && a.count > 0 ? a.sum / a.count : 0
    const promoAvg = p && p.count > 0 ? p.sum / p.count : 0
    const promoDepthAvg = p && p.depthCount > 0 ? p.depth / p.depthCount : 0
    const promoScore = promoAvg * (promoDepthAvg || 1) // weighted by depth when available
    campaignByBrand.set(b.id, {
      adScore: adScoreAvg,
      promoScore,
      combined: adScoreAvg + promoScore,
      ads: a?.active || 0,
      promos: Math.round(promoAvg * 100), // % of days a promo was active
    })
  }
  const campaignRanking = Array.from(campaignByBrand.entries())
    .map(([brand, v]) => ({ brand, value: v.combined }))
    .sort((a, b) => b.value - a.value)

  // ─── C. Community sentiment (positive / total per brand, with crisis caveat) ──
  const sentimentByBrand = new Map<string, { positive: number; negative: number; neutral: number; crisis: number; total: number }>()
  for (const r of mentionRes.data) {
    const slug = slugByBid[r.brand_id]
    if (!slug) continue
    const cur = sentimentByBrand.get(slug) || { positive: 0, negative: 0, neutral: 0, crisis: 0, total: 0 }
    cur.total += 1
    const label = String(r.sentiment_label || '').toLowerCase()
    if (label === 'positive') cur.positive += 1
    else if (label === 'negative') cur.negative += 1
    else if (label === 'neutral') cur.neutral += 1
    if (r.is_crisis) cur.crisis += 1
    sentimentByBrand.set(slug, cur)
  }
  const sentimentRanking = Array.from(sentimentByBrand.entries())
    .map(([brand, v]) => ({ brand, value: v.total > 0 ? v.positive / v.total : 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
  // Caveat: classifier looks "calibrating" if NO brand has non-zero positive AND negative samples.
  const sentimentCalibrating = Array.from(sentimentByBrand.values())
    .every((v) => v.positive === 0 || v.negative === 0)

  // ─── D. Influencer impact (mention_facts with athlete_id) ───────────
  const athleteByBrand = new Map<string, number>()
  for (const r of mentionRes.data) {
    if (!r.athlete_id) continue
    const slug = slugByBid[r.brand_id]
    if (!slug) continue
    athleteByBrand.set(slug, (athleteByBrand.get(slug) || 0) + 1)
  }
  const influencerRanking = Array.from(athleteByBrand.entries())
    .map(([brand, value]) => ({ brand, value }))
    .sort((a, b) => b.value - a.value)

  // ─── E. Sales/stock (restock + sellout events) ───────────────────────
  const salesByBrand = new Map<string, { restock: number; sellout: number; total: number }>()
  for (const r of inventoryRes.data) {
    const slug = slugByBid[r.brand_id]
    if (!slug) continue
    const cur = salesByBrand.get(slug) || { restock: 0, sellout: 0, total: 0 }
    const t = String(r.event_type || '').toLowerCase()
    if (t === 'restock' || t === 'reappearance') cur.restock += 1
    else if (t === 'sellout') cur.sellout += 1
    cur.total += 1
    salesByBrand.set(slug, cur)
  }
  const salesRanking = Array.from(salesByBrand.entries())
    .map(([brand, v]) => ({ brand, value: v.restock + v.sellout }))
    .sort((a, b) => b.value - a.value)

  // ─── F. IG dominant theme (latest snapshot per brand) ────────────────
  const themeByBrand = new Map<string, string>()
  for (const r of igThemeRes.data) {
    const slug = slugByBid[r.brand_id]
    if (!slug) continue
    if (!themeByBrand.has(slug) && r.dominant_content_theme) {
      themeByBrand.set(slug, String(r.dominant_content_theme))
    }
  }

  // ─── G. Command Center rows ──────────────────────────────────────────
  const command: CommandCenterRow[] = []

  function rowFromRanking(
    area: MarketIntelArea,
    areaLabel: string,
    ranking: Array<{ brand: string; value: number }>,
    metricLabel: string,
    actionTpl: (winner: string | null, joolaRank: number | null, threat: string | null) => string,
    caveat?: string,
  ): CommandCenterRow {
    const winner = ranking[0] || null
    const threat = topNonJoola(ranking)
    const joolaRank = rankOf('joola', ranking)
    const joolaValue = ranking.find((r) => r.brand === 'joola')?.value || 0
    return {
      area,
      areaLabel,
      winnerBrand: winner?.brand || null,
      winnerValue: winner?.value || 0,
      winnerLabel: metricLabel,
      joolaRank,
      joolaValue,
      threatBrand: threat?.brand || null,
      threatValue: threat?.value || 0,
      recommendedAction: actionTpl(winner?.brand || null, joolaRank, threat?.brand || null),
      caveat,
    }
  }

  command.push(rowFromRanking(
    'product', 'Product attention',
    productRanking,
    'Σ attention_score (last 30d)',
    (winner, jRank) =>
      winner === 'joola'
        ? 'JOOLA is leading. Defend share with new content + reviews.'
        : jRank && jRank <= 3
          ? `Pressure ${winner ?? 'leader'} with paddle-comparison content + reviewer outreach.`
          : `Close attention gap to ${winner ?? 'leader'} — invest in paddle reviews + comparison content.`,
  ))

  command.push(rowFromRanking(
    'campaign', 'Campaign pressure',
    campaignRanking,
    'ad_pressure + promo_pressure (30d avg)',
    (winner, jRank) =>
      winner === 'joola'
        ? 'JOOLA leading on paid. Maintain creative refresh cadence.'
        : jRank && jRank <= 3
          ? `Match ${winner ?? 'leader'}\'s creative volume on the highest-CTR channel only.`
          : `Counter ${winner ?? 'leader'} with a focused product-launch ad burst, not blanket parity.`,
  ))

  command.push(rowFromRanking(
    'community', 'Community sentiment',
    sentimentRanking,
    'positive ÷ total mentions (30d)',
    (winner, jRank) =>
      winner === 'joola'
        ? 'JOOLA holds positivity leadership — amplify quotes in social proof.'
        : jRank && jRank <= 3
          ? `Surface JOOLA testimonials publicly to close the gap with ${winner ?? 'leader'}.`
          : `Trigger community response play — proactive replies + creator gifting to recover sentiment vs ${winner ?? 'leader'}.`,
    sentimentCalibrating ? 'Sentiment classifier calibrating — treat ranks as indicative.' : undefined,
  ))

  command.push(rowFromRanking(
    'influencer', 'Influencer impact',
    influencerRanking,
    'mentions tied to sponsored athletes (30d)',
    (winner, jRank) =>
      winner === 'joola'
        ? 'JOOLA athlete roster is dominant — keep cadence + add UGC reposts.'
        : jRank && jRank <= 3
          ? `Brief JOOLA athletes to post comparison content vs ${winner ?? 'leader'} in tournaments.`
          : `Activate athletes weekly — ${winner ?? 'leader'} is winning attention through sponsored creators.`,
  ))

  command.push(rowFromRanking(
    'sales', 'Sales / stock signals',
    salesRanking,
    'restock + sellout events (30d)',
    (winner, jRank) =>
      winner === 'joola'
        ? 'JOOLA hottest on inventory — verify forecast keeps up with demand.'
        : jRank && jRank <= 3
          ? `Mirror ${winner ?? 'leader'}\'s restock cadence on hot SKUs to avoid Particl-style sellout signals.`
          : `Monitor ${winner ?? 'leader'} stock turns weekly — they may be running a hidden growth push.`,
  ))

  // ─── H. Per-brand strategy cards ─────────────────────────────────────
  const allCampaign = Array.from(campaignByBrand.values())
  const adMedian = median(allCampaign.map((c) => c.adScore))
  const promoMedian = median(allCampaign.map((c) => c.promoScore))

  const strategies: BrandStrategyCard[] = []
  for (const b of brands) {
    if (b.id === 'joola') continue
    const camp = campaignByBrand.get(b.id) || { adScore: 0, promoScore: 0, combined: 0, ads: 0, promos: 0 }
    const quadrant = quadrantOf(camp.adScore, camp.promoScore, adMedian, promoMedian)
    const productRank = rankOf(b.id, productRanking)
    const theme = themeByBrand.get(b.id) || null
    const athleteCount = athleteByBrand.get(b.id) || 0
    const sales = salesByBrand.get(b.id) || { restock: 0, sellout: 0, total: 0 }
    const strategy = labelStrategy(quadrant, productRank, theme, athleteCount, sales.total)
    const counter = counterMoveFor(strategy, b.id)

    const evidence: string[] = []
    if (camp.ads > 0) evidence.push(`${camp.ads.toFixed(0)} active ad creatives (30d avg)`)
    if (camp.promos > 0) evidence.push(`${camp.promos}% of days had an active promo`)
    if (productRank) evidence.push(`#${productRank} on product attention`)
    if (theme) evidence.push(`IG theme: ${theme}`)
    if (athleteCount > 0) evidence.push(`${athleteCount} athlete-tied mentions`)
    if (sales.total > 0) evidence.push(`${sales.restock} restocks · ${sales.sellout} sellouts`)
    if (evidence.length === 0) evidence.push('Low signal in tracked sources for the last 30 days')

    strategies.push({
      brand: b.id,
      strategyLabel: strategy,
      evidence,
      joolaCounterMove: counter,
      campaignQuadrant: quadrant,
      productRank,
      dominantTheme: theme,
      athleteMentions: athleteCount,
      inventoryEvents: sales.total,
    })
  }

  return {
    command,
    strategies,
    caveats: { sentimentCalibrating },
  }
}

// ─── Strategy label rules ────────────────────────────────────────────
function labelStrategy(
  quadrant: CampaignQuadrant,
  productRank: number | null,
  theme: string | null,
  athleteMentions: number,
  inventoryEvents: number,
): string {
  // priority: sales > athlete > product > campaign
  if (inventoryEvents >= 10) return 'Stockout / demand signal'
  if (athleteMentions >= 20) return 'Athlete-led attention'
  if (productRank && productRank <= 3) return 'Product momentum'
  if (quadrant === 'aggressive-growth') return 'Aggressive growth push'
  if (quadrant === 'brand-building') return 'Brand-building / premium positioning'
  if (quadrant === 'price-sensitive') return 'Price-sensitive sales push'
  if (theme === 'tutorial' || theme === 'how-to') return 'Education-led acquisition'
  if (theme === 'highlight' || theme === 'tournament') return 'Pro-tour / tournament marketing'
  return 'Quiet / low activity'
}

function counterMoveFor(strategy: string, brand: string): string {
  switch (strategy) {
    case 'Stockout / demand signal':
      return `Defensive — track ${brand} velocity weekly; preempt with JOOLA bundle promo if their sellout signal sustains.`
    case 'Athlete-led attention':
      return `Brief JOOLA athletes to post matched-tournament content; lean into Ben Johns + Anna Bright proof points.`
    case 'Product momentum':
      return `Counter with a JOOLA flagship feature comparison + reviewer outreach focused on the same paddle category.`
    case 'Aggressive growth push':
      return `Match creative volume on the highest-ROAS channel; ignore the rest. Don\'t broadcast-match.`
    case 'Brand-building / premium positioning':
      return `Win on substance — pro endorsements + tournament wins beat polished brand work.`
    case 'Price-sensitive sales push':
      return `Hold price. Bundle accessories or extend warranty instead of discounting headline SKUs.`
    case 'Education-led acquisition':
      return `Counter with a JOOLA "advanced player" tutorial series; out-credential the beginner content.`
    case 'Pro-tour / tournament marketing':
      return `Amplify JOOLA tournament wins + sponsor podium athletes who post organically.`
    default:
      return `Hold — re-check ${brand} weekly. No urgent counter-move needed.`
  }
}
