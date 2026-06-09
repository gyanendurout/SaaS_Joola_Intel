/**
 * Product Intel — unified data layer.
 *
 * Brings the raw `products` (scraped catalog with prices/stock/category) and
 * the curated `products_catalog` (mention-keyed display catalog) together
 * with the attention tables (`product_attention_daily`,
 * `product_attention_summary`) into one typed payload for the UI.
 *
 * IMPORTANT: the two product tables are NOT joined upstream. We implement a
 * safe brand-scoped matcher here:
 *   1. same brand_id
 *   2. exact normalized-name match against display_name OR any alias
 * No cross-brand fuzzy matching — false positives are worse than misses.
 */

import { supabase } from '@/lib/shared/supabase'
import { type V2Brand } from '@/lib/v2/data'
import { fetchLagScans, type LagScanRow } from '@/lib/v2/analytics'
import { pgName } from '@/components/v2/PageShell'
import { type LeaderboardRow } from '@/components/v2/charts/LeaderboardTable'

// ─── Raw row types (mirror DB schema) ──────────────────────────────────
export interface RawCatalogProduct {
  id: string
  brand_id: string
  name: string
  url: string | null
  price_usd: number | null
  sale_price_usd: number | null
  discount_pct: number | null
  avg_rating: number | null
  review_count: number | null
  category: string | null
  in_stock: boolean | null
  last_scraped_at: string | null
}

export interface CuratedProduct {
  id: string
  brand_id: string
  display_name: string
  sku: string | null
  category: string | null
  aliases: string[] | null
}

export interface AttentionDailyRow {
  product_id: string
  brand_id: string
  date: string                     // alias for attention_date
  mention_count: number            // alias for mentions_total
  weighted_score: number           // alias for attention_score
  avg_sentiment: number | null     // alias for sales_likelihood_score
}

export interface AttentionSummaryRow {
  product_id: string
  brand_id: string
  period: string                   // 'last_7d' | 'last_30d' | 'last_90d' | 'all_time'
  total_mentions: number           // alias for mentions_total
  weighted_total: number           // alias for attention_score
  avg_sentiment: number | null     // alias for sales_likelihood_score
  gap_to_top_competitor: number | null  // alias for joola_vs_competitor_gap
  rank_in_category: number | null  // alias for rank_in_brand
}

// ─── Derived aggregate shapes ─────────────────────────────────────────
export interface PriceStat {
  brand: string
  count: number
  avg: number
  min: number
  med: number
  max: number
}

export interface CatalogStat {
  brand: string
  count: number
  avg: number
}

export interface PriceTierStat {
  brand: string
  value: number      // < $100
  mid: number        // 100-199
  premium: number    // >= 200
  total: number
}

export interface ProductMatchResult {
  // catalog (products row id) -> curated (products_catalog row id)
  catalogToCurated: Map<string, string>
  curatedToCatalog: Map<string, string>
  unmatchedCatalogCount: number
  unmatchedCuratedCount: number
  matchedCount: number
}

export interface DataStatus {
  hasDaily: boolean
  hasSummary: boolean
  hasCatalog: boolean
  hasCurated: boolean
  rawCount: number
  curatedCount: number
}

export interface LeaderboardStatus {
  hasTimeseries: boolean
  hasLagScans: boolean
  rowCount: number
}

export interface LagScanStatus {
  rowCount: number
}

export interface ProductIntelData {
  brands: V2Brand[]
  catalogProducts: RawCatalogProduct[]
  curatedProducts: CuratedProduct[]
  attentionDaily: AttentionDailyRow[]
  attentionSummary: AttentionSummaryRow[]
  priceStatsByBrand: PriceStat[]
  catalogStatsByBrand: CatalogStat[]
  priceTierStatsByBrand: PriceTierStat[]
  productMatches: ProductMatchResult
  dataStatus: DataStatus
  leaderboardRows: LeaderboardRow[]
  leaderboardStatus: LeaderboardStatus
  lagScanStatus: LagScanStatus
}

// ─── Recent timeseries fetcher (joola_timeseries_daily, migration 013) ──
type TimeseriesRaw = {
  brand_id: string
  product_id: string | null
  date: string
  attention_score: number | null
  mentions: number | null
  estimated_units_sold: number | null
}

const MV_MISSING_RE = /(does not exist|42P01|relation .* does not exist|Could not find the table)/i

async function fetchRecentTimeseries(days: number): Promise<TimeseriesRaw[]> {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  // Migration 013 column names: metric_date, canonical_product_id, mention_count.
  // We alias them back to the TimeseriesRaw shape used downstream.
  const { data, error } = await supabase
    .from('joola_timeseries_daily')
    .select('brand_id,canonical_product_id,metric_date,attention_score,mention_count,estimated_units_sold')
    .gte('metric_date', cutoff)
    .order('metric_date', { ascending: true })
    .limit(20000)

  if (error) {
    const msg = String((error as { message?: string }).message || error)
    if (MV_MISSING_RE.test(msg)) {
      // eslint-disable-next-line no-console
      console.warn('[productIntel] joola_timeseries_daily missing — apply migration 013.')
    } else {
      // eslint-disable-next-line no-console
      console.warn('[productIntel] failed to load joola_timeseries_daily:', error)
    }
    return []
  }
  type Mv013 = {
    brand_id: string
    canonical_product_id: string | null
    metric_date: string
    attention_score: number | null
    mention_count: number | null
    estimated_units_sold: number | null
  }
  return ((data as Mv013[]) || []).map((r) => ({
    brand_id: r.brand_id,
    product_id: r.canonical_product_id,
    date: r.metric_date,
    attention_score: r.attention_score,
    mentions: r.mention_count,
    estimated_units_sold: r.estimated_units_sold,
  }))
}

// ─── Leaderboard builder ──────────────────────────────────────────────
function buildLeaderboardRows(
  brands: V2Brand[],
  ts: TimeseriesRaw[],
  scans: LagScanRow[],
  productNames: Record<string, string>,
): LeaderboardRow[] {
  if (!ts.length) return []

  const brandSlugById: Record<string, string> = Object.fromEntries(
    brands.map((b) => [b.brand_id, b.id]),
  )

  type Bucket = {
    brandSlug: string
    productId: string | null
    attentionPoints: { date: string; v: number }[]
    mentionsTotal: number
    unitsSoldTotal: number
  }
  const buckets = new Map<string, Bucket>()

  ts.forEach((r) => {
    const slug = brandSlugById[r.brand_id]
    if (!slug) return
    const key = `${slug}::${r.product_id || ''}`
    let b = buckets.get(key)
    if (!b) {
      b = {
        brandSlug: slug,
        productId: r.product_id,
        attentionPoints: [],
        mentionsTotal: 0,
        unitsSoldTotal: 0,
      }
      buckets.set(key, b)
    }
    if (r.attention_score != null && isFinite(Number(r.attention_score))) {
      b.attentionPoints.push({ date: r.date, v: Number(r.attention_score) })
    }
    if (r.mentions != null) b.mentionsTotal += Number(r.mentions)
    if (r.estimated_units_sold != null) b.unitsSoldTotal += Number(r.estimated_units_sold)
  })

  // Best lag lookup per (brand, product)
  const bestLag = new Map<string, { driver: string; lag: number; score: number }>()
  scans.forEach((s) => {
    if (s.best_lag === null || s.best_score === null) return
    const key = `${s.brand_slug}::${s.product_id || ''}`
    const prev = bestLag.get(key)
    if (!prev || Math.abs(s.best_score) > Math.abs(prev.score)) {
      bestLag.set(key, { driver: s.driver, lag: s.best_lag, score: s.best_score })
    }
  })

  const out: LeaderboardRow[] = []
  buckets.forEach((b, key) => {
    const sorted = b.attentionPoints.slice().sort((a, c) => a.date.localeCompare(c.date))
    const last7 = sorted.slice(-7)
    const attentionMean =
      last7.length > 0 ? last7.reduce((s, p) => s + p.v, 0) / last7.length : 0
    const sparkline = sorted.slice(-28).map((p) => p.v)
    const productName = b.productId ? productNames[b.productId] || 'Unspecified' : 'All products'
    const lag = bestLag.get(key)
    out.push({
      brand: pgName(b.brandSlug, brands),
      product: productName,
      attention: Number(attentionMean.toFixed(2)),
      mentions: b.mentionsTotal,
      estimatedUnitsSold: b.unitsSoldTotal > 0 ? Math.round(b.unitsSoldTotal) : undefined,
      bestLagDays: lag?.lag,
      bestLagDriver: lag?.driver,
      sparkline,
    })
  })

  // Filter: hide rows with no signal at all
  return out
    .filter((r) => r.attention > 0 || r.mentions > 0)
    .sort((a, b) => b.attention - a.attention)
    .slice(0, 200)
}

// ─── Name normalization ───────────────────────────────────────────────
export function normalizeProductName(raw: string | null | undefined): string {
  if (!raw) return ''
  return String(raw)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // strip combining diacritics
    .replace(/[^a-z0-9\s]+/g, ' ')     // collapse punctuation
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── Safe matcher: same brand + exact normalized name ─────────────────
export function buildProductMatches(
  catalog: RawCatalogProduct[],
  curated: CuratedProduct[],
): ProductMatchResult {
  // Build curated lookup: brand_id -> Map(normName -> curatedId)
  const curatedIndex = new Map<string, Map<string, string>>()
  curated.forEach((c) => {
    if (!curatedIndex.has(c.brand_id)) curatedIndex.set(c.brand_id, new Map())
    const m = curatedIndex.get(c.brand_id)!
    const displayN = normalizeProductName(c.display_name)
    if (displayN && !m.has(displayN)) m.set(displayN, c.id)
    if (Array.isArray(c.aliases)) {
      c.aliases.forEach((a) => {
        const n = normalizeProductName(a)
        if (n && !m.has(n)) m.set(n, c.id)
      })
    }
  })

  const catalogToCurated = new Map<string, string>()
  const curatedToCatalog = new Map<string, string>()

  catalog.forEach((p) => {
    const brandMap = curatedIndex.get(p.brand_id)
    if (!brandMap) return
    const n = normalizeProductName(p.name)
    if (!n) return
    const curatedId = brandMap.get(n)
    if (curatedId) {
      catalogToCurated.set(p.id, curatedId)
      // first catalog row wins for the reverse map
      if (!curatedToCatalog.has(curatedId)) curatedToCatalog.set(curatedId, p.id)
    }
  })

  const matchedCuratedIds = new Set(catalogToCurated.values())
  const unmatchedCuratedCount = curated.length - matchedCuratedIds.size
  const unmatchedCatalogCount = catalog.length - catalogToCurated.size

  return {
    catalogToCurated,
    curatedToCatalog,
    matchedCount: catalogToCurated.size,
    unmatchedCatalogCount,
    unmatchedCuratedCount,
  }
}

// ─── Stats helpers ────────────────────────────────────────────────────
function computePriceStats(
  brands: V2Brand[],
  catalog: RawCatalogProduct[],
): PriceStat[] {
  const slugByBid: Record<string, string> = Object.fromEntries(
    brands.map((b) => [b.brand_id, b.id]),
  )
  const buckets: Record<string, number[]> = {}
  const counts: Record<string, number> = {}
  catalog.forEach((p) => {
    const slug = slugByBid[p.brand_id]
    if (!slug) return
    counts[slug] = (counts[slug] || 0) + 1
    if (p.price_usd != null) {
      const price = Number(p.price_usd)
      // Defensive guard: drop scraping artifacts ($52,598 Selkirk row etc.)
      if (!isFinite(price) || price > 500 || price <= 0) return
      if (!buckets[slug]) buckets[slug] = []
      buckets[slug].push(price)
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
      return {
        brand: b.id,
        count,
        avg: Math.round(avg),
        min: Math.round(min),
        med: Math.round(med),
        max: Math.round(max),
      }
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
}

function computeCatalogStats(priceStats: PriceStat[]): CatalogStat[] {
  return priceStats
    .map((p) => ({ brand: p.brand, count: p.count, avg: p.avg }))
    .sort((a, b) => b.count - a.count)
}

function computePriceTierStats(
  brands: V2Brand[],
  catalog: RawCatalogProduct[],
): PriceTierStat[] {
  const slugByBid: Record<string, string> = Object.fromEntries(
    brands.map((b) => [b.brand_id, b.id]),
  )
  const agg: Record<string, PriceTierStat> = {}
  catalog.forEach((p) => {
    const slug = slugByBid[p.brand_id]
    if (!slug) return
    if (!agg[slug]) agg[slug] = { brand: slug, value: 0, mid: 0, premium: 0, total: 0 }
    const price = p.price_usd != null ? Number(p.price_usd) : 0
    // Defensive guard: drop scraping artifacts that mis-parse a size code as price.
    if (!isFinite(price) || price > 500) return
    if (price >= 200) agg[slug].premium++
    else if (price >= 100) agg[slug].mid++
    else if (price > 0) agg[slug].value++
    agg[slug].total++
  })
  return Object.values(agg).sort((a, b) => b.total - a.total)
}

// ─── Main fetcher ─────────────────────────────────────────────────────
export async function fetchProductIntel(brands: V2Brand[]): Promise<ProductIntelData> {
  // Run all queries in parallel
  const [catalogRes, curatedRes, dailyRes, summaryRes, tsRows, scanRows] = await Promise.all([
    supabase
      .from('products')
      .select('id,brand_id,name,url,price_usd,sale_price_usd,discount_pct,avg_rating,review_count,category,in_stock,last_scraped_at')
      .limit(2000),
    supabase
      .from('products_catalog')
      .select('id,brand_id,display_name,sku,category,aliases')
      .limit(2000),
    supabase
      .from('product_attention_daily')
      .select(
        'product_id,brand_id,' +
        'date:attention_date,' +
        'mention_count:mentions_total,' +
        'weighted_score:attention_score,' +
        'avg_sentiment:sales_likelihood_score',
      )
      .order('attention_date', { ascending: false })
      .limit(10000),
    supabase
      .from('product_attention_summary')
      .select(
        'product_id,brand_id,period,' +
        'total_mentions:mentions_total,' +
        'weighted_total:attention_score,' +
        'avg_sentiment:sales_likelihood_score,' +
        'gap_to_top_competitor:joola_vs_competitor_gap,' +
        'rank_in_category:rank_in_brand',
      )
      .limit(2000),
    fetchRecentTimeseries(28),
    fetchLagScans(),
  ])

  const catalogProducts = ((catalogRes.data as unknown) || []) as RawCatalogProduct[]
  const curatedProducts = ((curatedRes.data as unknown) || []) as CuratedProduct[]
  const attentionDaily = ((dailyRes.data as unknown) || []) as AttentionDailyRow[]
  const attentionSummary = ((summaryRes.data as unknown) || []) as AttentionSummaryRow[]

  const priceStatsByBrand = computePriceStats(brands, catalogProducts)
  const catalogStatsByBrand = computeCatalogStats(priceStatsByBrand)
  const priceTierStatsByBrand = computePriceTierStats(brands, catalogProducts)
  const productMatches = buildProductMatches(catalogProducts, curatedProducts)

  const dataStatus: DataStatus = {
    hasDaily: attentionDaily.length > 0,
    hasSummary: attentionSummary.length > 0,
    hasCatalog: catalogProducts.length > 0,
    hasCurated: curatedProducts.length > 0,
    rawCount: catalogProducts.length,
    curatedCount: curatedProducts.length,
  }

  // Build leaderboard rows. Product display names come from the curated
  // catalog (matches the legacy /v2/leaderboard implementation which used
  // products_catalog for `display_name`).
  const productNames: Record<string, string> = {}
  curatedProducts.forEach((p) => {
    productNames[p.id] = p.display_name || ''
  })
  const leaderboardRows = buildLeaderboardRows(brands, tsRows, scanRows, productNames)

  const leaderboardStatus: LeaderboardStatus = {
    hasTimeseries: tsRows.length > 0,
    hasLagScans: scanRows.length > 0,
    rowCount: leaderboardRows.length,
  }
  const lagScanStatus: LagScanStatus = {
    rowCount: scanRows.length,
  }

  return {
    brands,
    catalogProducts,
    curatedProducts,
    attentionDaily,
    attentionSummary,
    priceStatsByBrand,
    catalogStatsByBrand,
    priceTierStatsByBrand,
    productMatches,
    dataStatus,
    leaderboardRows,
    leaderboardStatus,
    lagScanStatus,
  }
}

// ─── Section A: Competitor product attack map ─────────────────────────
export interface AttackMapRow {
  productId: string
  productName: string
  brandSlug: string
  brandName: string
  attention7d: number
  attention30d: number
  growthPct: number | null      // (7d * 30/7) / 30d * 100 - 100
  mainChannel: string           // 'instagram' | 'youtube' | 'reddit' | 'tiktok' | 'twitter' | 'influencer' | 'ads' | 'promotions' | 'news' | '—'
  closestJoolaName: string
  closestJoolaId: string | null
  gap: number | null            // attention gap vs joola comparable in 30d
  recommendedResponse: string
  category: string | null
  salePrice: number | null
  listPrice: number | null
  inStock: boolean | null
}

const ATTENTION_CHANNELS: { col: string; label: string }[] = [
  { col: 'mentions_instagram', label: 'Instagram' },
  { col: 'mentions_youtube', label: 'YouTube' },
  { col: 'mentions_reddit', label: 'Reddit' },
  { col: 'mentions_tiktok', label: 'TikTok' },
  { col: 'mentions_twitter', label: 'X / Twitter' },
  { col: 'mentions_influencer', label: 'Influencer' },
  { col: 'mentions_ads', label: 'Ads' },
  { col: 'mentions_promotions', label: 'Promotions' },
  { col: 'mentions_news', label: 'News' },
]

/**
 * Per-channel mention totals (last 30d) keyed by product_id.
 * Used by Section A (main channel) and Section C (per-channel split).
 */
async function fetchChannelMentions30d(): Promise<Record<string, Record<string, number>>> {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const channelSelect = ATTENTION_CHANNELS.map((c) => c.col).join(',')
  const selectStr = 'product_id,attention_date,' + channelSelect
  const { data, error } = await supabase
    .from('product_attention_daily')
    .select(selectStr)
    .gte('attention_date', cutoff)
    .limit(20000)
  if (error || !data) return {}
  const out: Record<string, Record<string, number>> = {}
  for (const row of (data as unknown) as Record<string, unknown>[]) {
    const pid = String(row.product_id || '')
    if (!pid) continue
    if (!out[pid]) out[pid] = {}
    for (const ch of ATTENTION_CHANNELS) {
      const v = Number(row[ch.col] || 0)
      if (!isFinite(v) || v <= 0) continue
      out[pid][ch.col] = (out[pid][ch.col] || 0) + v
    }
  }
  return out
}

function pickMainChannel(perChannel: Record<string, number> | undefined): string {
  if (!perChannel) return '—'
  let bestCol = ''
  let bestVal = 0
  for (const ch of ATTENTION_CHANNELS) {
    const v = perChannel[ch.col] || 0
    if (v > bestVal) {
      bestVal = v
      bestCol = ch.col
    }
  }
  if (!bestCol || bestVal === 0) return '—'
  return ATTENTION_CHANNELS.find((c) => c.col === bestCol)?.label || '—'
}

/**
 * Find closest JOOLA paddle to a competitor by category match then by 30d
 * attention rank (highest-attention JOOLA paddle in same category wins).
 * Returns null when no JOOLA paddle in the same category is available.
 */
function findClosestJoola(
  competitor: { category: string | null },
  joolaProducts: { id: string; name: string; category: string | null; attention30d: number }[],
): { id: string; name: string } | null {
  if (!joolaProducts.length) return null
  const sameCat = joolaProducts.filter(
    (j) => competitor.category && j.category && j.category.toLowerCase() === competitor.category.toLowerCase(),
  )
  const pool = sameCat.length ? sameCat : joolaProducts
  const top = pool.slice().sort((a, b) => b.attention30d - a.attention30d)[0]
  return top ? { id: top.id, name: top.name } : null
}

export async function fetchCompetitorAttackMap(brands: V2Brand[], topN = 20): Promise<AttackMapRow[]> {
  const joolaBrand = brands.find((b) => b.id === 'joola')
  const slugByBid: Record<string, string> = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const nameByBid: Record<string, string> = Object.fromEntries(brands.map((b) => [b.brand_id, b.name]))

  const [summaryRes, catalogRes, curatedRes, channelMap] = await Promise.all([
    supabase
      .from('product_attention_summary')
      .select('product_id,brand_id,period,mentions_total,joola_vs_competitor_gap')
      .in('period', ['last_7d', 'last_30d'])
      .limit(5000),
    supabase
      .from('products')
      .select('id,brand_id,name,url,price_usd,sale_price_usd,category,in_stock')
      .limit(2000),
    supabase
      .from('products_catalog')
      .select('id,brand_id,display_name,category,aliases')
      .limit(2000),
    fetchChannelMentions30d(),
  ])

  type SumRow = { product_id: string; brand_id: string; period: string; mentions_total: number | null; joola_vs_competitor_gap: number | null }
  const summary = ((summaryRes.data as unknown) || []) as SumRow[]
  const catalog = ((catalogRes.data as unknown) || []) as RawCatalogProduct[]
  const curated = ((curatedRes.data as unknown) || []) as CuratedProduct[]
  const matches = buildProductMatches(catalog, curated)

  // index curated by id for display + category
  const curatedById: Record<string, CuratedProduct> = {}
  curated.forEach((c) => { curatedById[c.id] = c })

  // group summary rows by (product_id, period)
  const perProduct: Record<string, { last_7d: number; last_30d: number; gap30d: number | null; brand_id: string }> = {}
  for (const s of summary) {
    if (!s.product_id) continue
    if (!perProduct[s.product_id]) perProduct[s.product_id] = { last_7d: 0, last_30d: 0, gap30d: null, brand_id: s.brand_id }
    if (s.period === 'last_7d') perProduct[s.product_id].last_7d = Number(s.mentions_total || 0)
    if (s.period === 'last_30d') {
      perProduct[s.product_id].last_30d = Number(s.mentions_total || 0)
      perProduct[s.product_id].gap30d = s.joola_vs_competitor_gap != null ? Number(s.joola_vs_competitor_gap) : null
    }
  }

  // Build JOOLA paddle attention map (for closest-match)
  const joolaPaddles: { id: string; name: string; category: string | null; attention30d: number }[] = []
  if (joolaBrand) {
    for (const c of curated) {
      if (c.brand_id !== joolaBrand.brand_id) continue
      joolaPaddles.push({
        id: c.id,
        name: c.display_name,
        category: c.category,
        attention30d: perProduct[c.id]?.last_30d || 0,
      })
    }
  }

  // Resolve scraped catalog row for a curated id (price/stock context)
  const catalogById: Record<string, RawCatalogProduct> = {}
  catalog.forEach((p) => { catalogById[p.id] = p })
  const catalogForCurated = (curatedId: string): RawCatalogProduct | null => {
    const catId = matches.curatedToCatalog.get(curatedId)
    return catId ? catalogById[catId] || null : null
  }

  const out: AttackMapRow[] = []
  for (const [pid, agg] of Object.entries(perProduct)) {
    const slug = slugByBid[agg.brand_id]
    if (!slug || slug === 'joola') continue
    if (agg.last_30d <= 0) continue
    if (agg.last_7d <= 0) continue
    const cur = curatedById[pid]
    if (!cur) continue
    const catRow = catalogForCurated(pid)
    const closest = findClosestJoola({ category: cur.category }, joolaPaddles)
    const main = pickMainChannel(channelMap[pid])

    // Growth proxy: (7d * 30/7) vs 30d as a momentum %
    const projected30 = agg.last_7d * (30 / 7)
    const growthPct = agg.last_30d > 0 ? ((projected30 - agg.last_30d) / agg.last_30d) * 100 : null

    // Rule-based recommendation
    const onSale = catRow?.sale_price_usd != null && catRow?.price_usd != null && Number(catRow.sale_price_usd) < Number(catRow.price_usd)
    const inStock = catRow?.in_stock
    let rec = 'Content comparison'
    if (agg.last_30d >= 30 && onSale) rec = 'Match promo or content'
    else if (inStock === false) rec = 'Push availability'
    else if (agg.last_30d >= 50) rec = 'Match promo or content'

    out.push({
      productId: pid,
      productName: cur.display_name,
      brandSlug: slug,
      brandName: nameByBid[agg.brand_id] || slug,
      attention7d: agg.last_7d,
      attention30d: agg.last_30d,
      growthPct: growthPct != null ? Math.round(growthPct) : null,
      mainChannel: main,
      closestJoolaName: closest?.name || '—',
      closestJoolaId: closest?.id || null,
      gap: agg.gap30d,
      recommendedResponse: rec,
      category: cur.category,
      salePrice: catRow?.sale_price_usd != null ? Number(catRow.sale_price_usd) : null,
      listPrice: catRow?.price_usd != null ? Number(catRow.price_usd) : null,
      inStock: catRow?.in_stock ?? null,
    })
  }
  return out.sort((a, b) => b.attention30d - a.attention30d).slice(0, topN)
}

// ─── Section B: Product attention funnel ──────────────────────────────
export interface FunnelRow {
  productId: string
  productName: string
  brandSlug: string
  isJoola: boolean
  mentions: number
  positivePct: number          // 0–100
  purchaseIntent: number
  salesLikelihood: number      // 0–100
  inventoryMoves: number       // restocks + sellouts in last 30d
}

export async function fetchAttentionFunnel(brands: V2Brand[], topN = 10): Promise<FunnelRow[]> {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
  const slugByBid: Record<string, string> = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))

  const [dailyRes, curatedRes, invRes] = await Promise.all([
    supabase
      .from('product_attention_daily')
      .select('product_id,brand_id,attention_date,mentions_total,positive_mentions,purchase_intent_count,sales_likelihood_score')
      .gte('attention_date', cutoff.slice(0, 10))
      .limit(20000),
    supabase
      .from('products_catalog')
      .select('id,brand_id,display_name')
      .limit(2000),
    supabase
      .from('inventory_events')
      .select('product_id,event_type,event_time')
      .in('event_type', ['restock', 'sellout'])
      .gte('event_time', cutoff)
      .limit(5000),
  ])

  type DailyRow = { product_id: string; brand_id: string; mentions_total: number | null; positive_mentions: number | null; purchase_intent_count: number | null; sales_likelihood_score: number | null }
  const daily = ((dailyRes.data as unknown) || []) as DailyRow[]
  type CurRow = { id: string; brand_id: string; display_name: string }
  const curated = ((curatedRes.data as unknown) || []) as CurRow[]
  type InvRow = { product_id: string; event_type: string }
  const inv = ((invRes.data as unknown) || []) as InvRow[]

  const nameById: Record<string, { name: string; brand_id: string }> = {}
  curated.forEach((c) => { nameById[c.id] = { name: c.display_name, brand_id: c.brand_id } })

  const agg: Record<string, { mentions: number; positive: number; pi: number; sl: number; slN: number; brand_id: string }> = {}
  for (const r of daily) {
    if (!r.product_id) continue
    if (!agg[r.product_id]) agg[r.product_id] = { mentions: 0, positive: 0, pi: 0, sl: 0, slN: 0, brand_id: r.brand_id }
    agg[r.product_id].mentions += Number(r.mentions_total || 0)
    agg[r.product_id].positive += Number(r.positive_mentions || 0)
    agg[r.product_id].pi += Number(r.purchase_intent_count || 0)
    if (r.sales_likelihood_score != null) {
      agg[r.product_id].sl += Number(r.sales_likelihood_score)
      agg[r.product_id].slN += 1
    }
  }

  const invMoves: Record<string, number> = {}
  for (const e of inv) {
    if (!e.product_id) continue
    invMoves[e.product_id] = (invMoves[e.product_id] || 0) + 1
  }

  const rows: FunnelRow[] = Object.entries(agg).map(([pid, a]) => {
    const meta = nameById[pid]
    const slug = slugByBid[a.brand_id] || ''
    return {
      productId: pid,
      productName: meta?.name || '— unknown —',
      brandSlug: slug,
      isJoola: slug === 'joola',
      mentions: a.mentions,
      positivePct: a.mentions > 0 ? Math.round((a.positive / a.mentions) * 100) : 0,
      purchaseIntent: a.pi,
      salesLikelihood: a.slN > 0 ? Math.round(a.sl / a.slN) : 0,
      inventoryMoves: invMoves[pid] || 0,
    }
  })

  // Prefer JOOLA paddles first, then top by mentions
  return rows
    .filter((r) => r.mentions > 0)
    .sort((a, b) => {
      if (a.isJoola !== b.isJoola) return a.isJoola ? -1 : 1
      return b.mentions - a.mentions
    })
    .slice(0, topN)
}

// ─── Section C: Product channel split (last 30d) ──────────────────────
export interface ChannelSplitRow {
  productId: string
  productName: string
  brandSlug: string
  isJoola: boolean
  total: number
  instagram: number
  youtube: number
  reddit: number
  tiktok: number
  twitter: number
  influencer: number
  ads: number
  promotions: number
  dominantCol: string         // matches one of the column keys above
}

export async function fetchProductChannelSplit(brands: V2Brand[], topN = 40): Promise<ChannelSplitRow[]> {
  const slugByBid: Record<string, string> = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

  const [dailyRes, curatedRes] = await Promise.all([
    supabase
      .from('product_attention_daily')
      .select('product_id,brand_id,mentions_total,mentions_instagram,mentions_youtube,mentions_reddit,mentions_tiktok,mentions_twitter,mentions_influencer,mentions_ads,mentions_promotions')
      .gte('attention_date', cutoff)
      .limit(20000),
    supabase
      .from('products_catalog')
      .select('id,display_name')
      .limit(2000),
  ])

  type DRow = { product_id: string; brand_id: string; mentions_total: number | null; mentions_instagram: number | null; mentions_youtube: number | null; mentions_reddit: number | null; mentions_tiktok: number | null; mentions_twitter: number | null; mentions_influencer: number | null; mentions_ads: number | null; mentions_promotions: number | null }
  const daily = ((dailyRes.data as unknown) || []) as DRow[]
  const nameById: Record<string, string> = {}
  ;((curatedRes.data as unknown) as { id: string; display_name: string }[] || []).forEach((c) => {
    nameById[c.id] = c.display_name
  })

  const agg: Record<string, ChannelSplitRow> = {}
  for (const r of daily) {
    if (!r.product_id) continue
    if (!agg[r.product_id]) {
      const slug = slugByBid[r.brand_id] || ''
      agg[r.product_id] = {
        productId: r.product_id,
        productName: nameById[r.product_id] || '— unknown —',
        brandSlug: slug,
        isJoola: slug === 'joola',
        total: 0, instagram: 0, youtube: 0, reddit: 0, tiktok: 0,
        twitter: 0, influencer: 0, ads: 0, promotions: 0, dominantCol: '',
      }
    }
    const a = agg[r.product_id]
    a.total += Number(r.mentions_total || 0)
    a.instagram += Number(r.mentions_instagram || 0)
    a.youtube += Number(r.mentions_youtube || 0)
    a.reddit += Number(r.mentions_reddit || 0)
    a.tiktok += Number(r.mentions_tiktok || 0)
    a.twitter += Number(r.mentions_twitter || 0)
    a.influencer += Number(r.mentions_influencer || 0)
    a.ads += Number(r.mentions_ads || 0)
    a.promotions += Number(r.mentions_promotions || 0)
  }

  const channelKeys: (keyof ChannelSplitRow)[] = [
    'instagram', 'youtube', 'reddit', 'tiktok', 'twitter', 'influencer', 'ads', 'promotions',
  ]
  return Object.values(agg)
    .filter((r) => r.total > 0)
    .map((r) => {
      let bestKey = ''
      let bestVal = 0
      for (const k of channelKeys) {
        const v = Number(r[k] || 0)
        if (v > bestVal) { bestVal = v; bestKey = String(k) }
      }
      return { ...r, dominantCol: bestKey }
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, topN)
}

// ─── Section D: Competitor paddle launch tracker ──────────────────────
export interface LaunchTrackerRow {
  productId: string
  productName: string
  brandSlug: string
  brandName: string
  launchedAt: string           // ISO date
  preBuzz: number              // mentions 14d before launchedAt
  postBuzz: number             // mentions 14d after launchedAt
  topChannel: string
  salesLikelihood: number      // mean from last_30d row
  joolaResponse: string
}

export interface LaunchTrackerData {
  rows: LaunchTrackerRow[]
  totalProducts: number
  productsWithLaunchDate: number
}

export async function fetchLaunchTracker(brands: V2Brand[]): Promise<LaunchTrackerData> {
  const slugByBid: Record<string, string> = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const nameByBid: Record<string, string> = Object.fromEntries(brands.map((b) => [b.brand_id, b.name]))

  const [catRes, totalRes] = await Promise.all([
    supabase
      .from('products_catalog')
      .select('id,brand_id,display_name,category,launched_at')
      .not('launched_at', 'is', null)
      .limit(500),
    supabase.from('products_catalog').select('id', { count: 'exact', head: true }),
  ])
  type Cat = { id: string; brand_id: string; display_name: string; category: string | null; launched_at: string | null }
  const cats = ((catRes.data as unknown) || []) as Cat[]
  const totalProducts = Number(totalRes.count || 0)

  if (cats.length === 0) {
    return { rows: [], totalProducts, productsWithLaunchDate: 0 }
  }

  const pids = cats.map((c) => c.id)

  const channelSelect = ATTENTION_CHANNELS.map((c) => c.col).join(',')
  const dailySelectStr = 'product_id,attention_date,mentions_total,' + channelSelect
  const [dailyRes, summaryRes] = await Promise.all([
    supabase
      .from('product_attention_daily')
      .select(dailySelectStr)
      .in('product_id', pids)
      .limit(20000),
    supabase
      .from('product_attention_summary')
      .select('product_id,sales_likelihood_score,period')
      .in('product_id', pids)
      .eq('period', 'last_30d')
      .limit(1000),
  ])
  type DRow = Record<string, unknown> & { product_id: string; attention_date: string; mentions_total: number | null }
  const daily = ((dailyRes.data as unknown) || []) as DRow[]
  type Sum = { product_id: string; sales_likelihood_score: number | null }
  const sums = ((summaryRes.data as unknown) || []) as Sum[]
  const slById: Record<string, number> = {}
  for (const s of sums) {
    if (s.sales_likelihood_score != null) slById[s.product_id] = Number(s.sales_likelihood_score)
  }

  const rows: LaunchTrackerRow[] = []
  for (const c of cats) {
    if (!c.launched_at) continue
    const launch = new Date(c.launched_at).getTime()
    const preStart = launch - 14 * 86400000
    const postEnd = launch + 14 * 86400000

    let pre = 0, post = 0
    const channelTotals: Record<string, number> = {}
    for (const r of daily) {
      if (r.product_id !== c.id || !r.attention_date) continue
      const t = new Date(String(r.attention_date)).getTime()
      const m = Number(r.mentions_total || 0)
      if (t >= preStart && t < launch) pre += m
      else if (t >= launch && t <= postEnd) {
        post += m
        for (const ch of ATTENTION_CHANNELS) {
          const v = Number((r as Record<string, unknown>)[ch.col] || 0)
          if (v > 0) channelTotals[ch.label] = (channelTotals[ch.label] || 0) + v
        }
      }
    }
    let topChannel = '—'
    let topVal = 0
    for (const [k, v] of Object.entries(channelTotals)) {
      if (v > topVal) { topChannel = k; topVal = v }
    }
    const slug = slugByBid[c.brand_id] || ''
    const isJoola = slug === 'joola'

    let response = 'Monitor launch curve'
    if (!isJoola && post > pre * 1.5 && post >= 20) response = 'Counter with content + athlete push'
    else if (!isJoola && post >= 10) response = 'Match content cadence'
    else if (isJoola) response = 'Internal launch reference'

    rows.push({
      productId: c.id,
      productName: c.display_name,
      brandSlug: slug,
      brandName: nameByBid[c.brand_id] || slug,
      launchedAt: c.launched_at,
      preBuzz: pre,
      postBuzz: post,
      topChannel,
      salesLikelihood: Math.round(slById[c.id] || 0),
      joolaResponse: response,
    })
  }

  return {
    rows: rows.sort((a, b) => (new Date(b.launchedAt).getTime() - new Date(a.launchedAt).getTime())),
    totalProducts,
    productsWithLaunchDate: cats.length,
  }
}

// ─── Section E: Unmatched competitor product mentions ─────────────────
export interface UnmatchedMentionRow {
  mention: string             // normalized lowercase
  displayMention: string      // original-case representative
  totalOccurrences: number
  channels: string[]
  brandsTalking: string[]     // brand slugs whose comments/posts contained the mention
  likelyOwnerBrand: string    // heuristic: most common brand context
}

interface UnmatchedSource {
  table: string
  textArrayCol: 'products_mentioned'
  dateCol: string
  brandCol: 'brand_id'
  channelLabel: string
}

const UNMATCHED_SOURCES: UnmatchedSource[] = [
  { table: 'reddit_mentions', textArrayCol: 'products_mentioned', dateCol: 'posted_at', brandCol: 'brand_id', channelLabel: 'Reddit' },
  { table: 'ig_comments', textArrayCol: 'products_mentioned', dateCol: 'posted_at', brandCol: 'brand_id', channelLabel: 'Instagram' },
  { table: 'yt_comments', textArrayCol: 'products_mentioned', dateCol: 'posted_at', brandCol: 'brand_id', channelLabel: 'YouTube' },
  { table: 'tiktok_videos', textArrayCol: 'products_mentioned', dateCol: 'posted_at', brandCol: 'brand_id', channelLabel: 'TikTok' },
  { table: 'tiktok_comments', textArrayCol: 'products_mentioned', dateCol: 'posted_at', brandCol: 'brand_id', channelLabel: 'TikTok' },
  { table: 'x_posts', textArrayCol: 'products_mentioned', dateCol: 'posted_at', brandCol: 'brand_id', channelLabel: 'X / Twitter' },
]

export async function fetchUnmatchedProductMentions(brands: V2Brand[], topN = 30): Promise<UnmatchedMentionRow[]> {
  const slugByBid: Record<string, string> = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString()

  // Build alias allow-list to anti-join against
  const { data: curated } = await supabase
    .from('products_catalog')
    .select('display_name,aliases')
    .limit(2000)
  type C = { display_name: string; aliases: string[] | null }
  const knownNorm = new Set<string>()
  ;((curated as unknown) as C[] || []).forEach((c) => {
    const dn = normalizeProductName(c.display_name)
    if (dn) knownNorm.add(dn)
    if (Array.isArray(c.aliases)) c.aliases.forEach((a) => {
      const n = normalizeProductName(a)
      if (n) knownNorm.add(n)
    })
  })

  type Bucket = { display: string; count: number; channels: Set<string>; brandHits: Record<string, number> }
  const agg: Record<string, Bucket> = {}

  // Run all sources in parallel; tolerate per-table errors silently.
  await Promise.all(UNMATCHED_SOURCES.map(async (src) => {
    try {
      const selectStr = src.brandCol + ',' + src.textArrayCol + ',' + src.dateCol
      const { data } = await supabase
        .from(src.table)
        .select(selectStr)
        .gte(src.dateCol, cutoff)
        .not(src.textArrayCol, 'is', null)
        .limit(5000)
      type R = Record<string, unknown>
      ;((data as unknown) as R[] || []).forEach((row) => {
        const arr = row[src.textArrayCol]
        if (!Array.isArray(arr)) return
        const brandId = row[src.brandCol] ? String(row[src.brandCol]) : ''
        const brandSlug = brandId ? slugByBid[brandId] || '' : ''
        for (const raw of arr) {
          if (typeof raw !== 'string') continue
          const trimmed = raw.trim()
          if (!trimmed) continue
          const norm = normalizeProductName(trimmed)
          if (!norm || norm.length < 3) continue
          if (knownNorm.has(norm)) continue
          if (!agg[norm]) agg[norm] = { display: trimmed, count: 0, channels: new Set(), brandHits: {} }
          agg[norm].count += 1
          agg[norm].channels.add(src.channelLabel)
          if (brandSlug) agg[norm].brandHits[brandSlug] = (agg[norm].brandHits[brandSlug] || 0) + 1
        }
      })
    } catch {
      // ignore per-table failures (table may not exist in some environments)
    }
  }))

  return Object.entries(agg)
    .map(([norm, b]) => {
      const brandsTalking = Object.entries(b.brandHits).sort((a, c) => c[1] - a[1]).slice(0, 4).map(([s]) => s)
      const likely = brandsTalking[0] || '—'
      return {
        mention: norm,
        displayMention: b.display,
        totalOccurrences: b.count,
        channels: Array.from(b.channels),
        brandsTalking,
        likelyOwnerBrand: likely,
      }
    })
    .sort((a, b) => b.totalOccurrences - a.totalOccurrences)
    .slice(0, topN)
}

// ─── Section F: Competitor stockout opportunity ───────────────────────
export interface StockoutOpportunityRow {
  brandSlug: string
  brandName: string
  productId: string | null
  productName: string
  status: string                // latest snapshot availability_status
  lastInStock: string | null    // ISO date of most recent in_stock snapshot
  demand30d: number             // mentions_total last_30d
  joolaComparableName: string
  action: string
}

export async function fetchStockoutOpportunities(brands: V2Brand[], topN = 25): Promise<StockoutOpportunityRow[]> {
  const slugByBid: Record<string, string> = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const nameByBid: Record<string, string> = Object.fromEntries(brands.map((b) => [b.brand_id, b.name]))
  const joolaBrand = brands.find((b) => b.id === 'joola')

  const [snapsRes, curatedRes, summaryRes] = await Promise.all([
    supabase
      .from('product_snapshots')
      .select('brand_id,product_id,snapshot_time,availability_status')
      .order('snapshot_time', { ascending: false })
      .limit(5000),
    supabase
      .from('products_catalog')
      .select('id,brand_id,display_name,category')
      .limit(2000),
    supabase
      .from('product_attention_summary')
      .select('product_id,mentions_total,period')
      .eq('period', 'last_30d')
      .limit(2000),
  ])
  type Snap = { brand_id: string; product_id: string | null; snapshot_time: string; availability_status: string }
  const snaps = ((snapsRes.data as unknown) || []) as Snap[]
  type Cur = { id: string; brand_id: string; display_name: string; category: string | null }
  const cur = ((curatedRes.data as unknown) || []) as Cur[]
  type Sum = { product_id: string; mentions_total: number | null }
  const sums = ((summaryRes.data as unknown) || []) as Sum[]

  const curById: Record<string, Cur> = {}
  cur.forEach((c) => { curById[c.id] = c })
  const demandById: Record<string, number> = {}
  sums.forEach((s) => { demandById[s.product_id] = Number(s.mentions_total || 0) })

  // JOOLA paddle pool (by category)
  const joolaPaddles: { id: string; name: string; category: string | null; demand: number }[] = []
  if (joolaBrand) {
    for (const c of cur) {
      if (c.brand_id !== joolaBrand.brand_id) continue
      joolaPaddles.push({ id: c.id, name: c.display_name, category: c.category, demand: demandById[c.id] || 0 })
    }
  }

  // Latest snapshot per (brand,product), plus last in-stock date
  type State = { latest: Snap; lastIn: string | null }
  const stateByKey: Record<string, State> = {}
  for (const s of snaps) {
    const key = `${s.brand_id}::${s.product_id || ''}`
    if (!stateByKey[key]) stateByKey[key] = { latest: s, lastIn: s.availability_status === 'in_stock' ? s.snapshot_time : null }
    else if (s.availability_status === 'in_stock' && !stateByKey[key].lastIn) stateByKey[key].lastIn = s.snapshot_time
  }

  const out: StockoutOpportunityRow[] = []
  for (const [key, st] of Object.entries(stateByKey)) {
    const status = st.latest.availability_status
    if (status === 'in_stock') continue
    const pid = st.latest.product_id || ''
    const slug = slugByBid[st.latest.brand_id]
    if (!slug || slug === 'joola') continue
    const cInfo = pid ? curById[pid] : null
    const closest = findClosestJoola(
      { category: cInfo?.category || null },
      joolaPaddles.map((j) => ({ id: j.id, name: j.name, category: j.category, attention30d: j.demand })),
    )
    out.push({
      brandSlug: slug,
      brandName: nameByBid[st.latest.brand_id] || slug,
      productId: pid || null,
      productName: cInfo?.display_name || '— unknown —',
      status,
      lastInStock: st.lastIn,
      demand30d: pid ? demandById[pid] || 0 : 0,
      joolaComparableName: closest?.name || '—',
      action: closest ? `Push ${closest.name} as alternative` : 'Monitor',
    })
    void key
  }

  return out.sort((a, b) => b.demand30d - a.demand30d).slice(0, topN)
}

// ─── Section G: Restock cadence ───────────────────────────────────────
export interface RestockCadenceRow {
  brandSlug: string
  brandName: string
  productId: string | null
  productName: string
  avgDaysBetween: number | null      // mean of consecutive restock gaps
  mostRecent: string | null          // ISO timestamp
  pattern: string                    // 'Frequent', 'Steady', 'Occasional', 'Single restock'
  demand30d: number
}

export async function fetchRestockCadence(brands: V2Brand[], topN = 25): Promise<RestockCadenceRow[]> {
  const slugByBid: Record<string, string> = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const nameByBid: Record<string, string> = Object.fromEntries(brands.map((b) => [b.brand_id, b.name]))

  const [evRes, curRes, sumRes] = await Promise.all([
    supabase
      .from('inventory_events')
      .select('brand_id,product_id,event_type,event_time')
      .eq('event_type', 'restock')
      .order('event_time', { ascending: true })
      .limit(10000),
    supabase
      .from('products_catalog')
      .select('id,display_name')
      .limit(2000),
    supabase
      .from('product_attention_summary')
      .select('product_id,mentions_total')
      .eq('period', 'last_30d')
      .limit(2000),
  ])
  type Ev = { brand_id: string; product_id: string | null; event_time: string }
  const evs = ((evRes.data as unknown) || []) as Ev[]
  type Cur = { id: string; display_name: string }
  const nameById: Record<string, string> = {}
  ;((curRes.data as unknown) as Cur[] || []).forEach((c) => { nameById[c.id] = c.display_name })
  const demand: Record<string, number> = {}
  ;((sumRes.data as unknown) as { product_id: string; mentions_total: number | null }[] || []).forEach((s) => {
    demand[s.product_id] = Number(s.mentions_total || 0)
  })

  const buckets: Record<string, { brand_id: string; product_id: string | null; times: number[] }> = {}
  for (const e of evs) {
    const key = `${e.brand_id}::${e.product_id || ''}`
    if (!buckets[key]) buckets[key] = { brand_id: e.brand_id, product_id: e.product_id, times: [] }
    const t = new Date(e.event_time).getTime()
    if (isFinite(t)) buckets[key].times.push(t)
  }

  const out: RestockCadenceRow[] = []
  for (const b of Object.values(buckets)) {
    b.times.sort((x, y) => x - y)
    let avgDays: number | null = null
    if (b.times.length >= 2) {
      let sum = 0
      for (let i = 1; i < b.times.length; i++) sum += (b.times[i] - b.times[i - 1])
      avgDays = sum / (b.times.length - 1) / 86400000
    }
    const slug = slugByBid[b.brand_id]
    if (!slug) continue
    const pattern = avgDays === null
      ? 'Single restock'
      : avgDays < 14 ? 'Frequent'
        : avgDays < 45 ? 'Steady'
          : 'Occasional'
    const pid = b.product_id || ''
    out.push({
      brandSlug: slug,
      brandName: nameByBid[b.brand_id] || slug,
      productId: pid || null,
      productName: pid ? nameById[pid] || '— unknown —' : '— brand-level —',
      avgDaysBetween: avgDays != null ? Math.round(avgDays) : null,
      mostRecent: b.times.length ? new Date(b.times[b.times.length - 1]).toISOString() : null,
      pattern,
      demand30d: pid ? demand[pid] || 0 : 0,
    })
  }
  return out.sort((a, b) => b.demand30d - a.demand30d || (b.avgDaysBetween || 0) - (a.avgDaysBetween || 0)).slice(0, topN)
}

// ─── Section H: Price pressure watch ──────────────────────────────────
export interface PricePressureRow {
  brandSlug: string
  brandName: string
  productId: string | null
  productName: string
  currentPrice: number | null
  priceIndex90d: number | null
  discountPct: number | null
  joolaComparableName: string
  action: string
}

export async function fetchPricePressure(brands: V2Brand[], topN = 30): Promise<PricePressureRow[]> {
  const slugByBid: Record<string, string> = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))
  const nameByBid: Record<string, string> = Object.fromEntries(brands.map((b) => [b.brand_id, b.name]))
  const joolaBrand = brands.find((b) => b.id === 'joola')

  const [pdRes, prodRes, curRes] = await Promise.all([
    supabase
      .from('price_daily')
      .select('product_id,price_usd,price_index_90d,metric_date')
      .order('metric_date', { ascending: false })
      .limit(5000),
    supabase
      .from('products')
      .select('id,brand_id,name,url,price_usd,sale_price_usd,discount_pct,category')
      .limit(2000),
    supabase
      .from('products_catalog')
      .select('id,brand_id,display_name,sku,category,aliases')
      .limit(2000),
  ])
  type PD = { product_id: string; price_usd: number | null; price_index_90d: number | null; metric_date: string }
  const pd = ((pdRes.data as unknown) || []) as PD[]
  const prod = ((prodRes.data as unknown) || []) as RawCatalogProduct[]
  const cur = ((curRes.data as unknown) || []) as CuratedProduct[]

  // latest price_daily per product
  const latestPD: Record<string, PD> = {}
  for (const r of pd) {
    if (!latestPD[r.product_id]) latestPD[r.product_id] = r
  }

  // joola comparable
  const joolaPaddles: { id: string; name: string; category: string | null; attention30d: number }[] = []
  if (joolaBrand) {
    for (const c of cur) {
      if (c.brand_id !== joolaBrand.brand_id) continue
      joolaPaddles.push({ id: c.id, name: c.display_name, category: c.category, attention30d: 0 })
    }
  }

  // products_catalog.id IS the foreign-key target for price_daily.product_id
  // (per migrations 010/012/013). Build rows per catalog row (curated id).
  const curById: Record<string, CuratedProduct> = {}
  cur.forEach((c) => { curById[c.id] = c })

  // Match scraped `products` row (for discount_pct + current sale price) via
  // safe brand+name match. We reuse buildProductMatches.
  const matches = buildProductMatches(prod, cur)
  const prodById: Record<string, RawCatalogProduct> = {}
  prod.forEach((p) => { prodById[p.id] = p })
  const prodForCurated = (curatedId: string): RawCatalogProduct | null => {
    const catId = matches.curatedToCatalog.get(curatedId)
    return catId ? prodById[catId] || null : null
  }

  const out: PricePressureRow[] = []
  for (const curatedId of Object.keys(latestPD)) {
    const pd = latestPD[curatedId]
    const c = curById[curatedId]
    if (!c) continue
    const slug = slugByBid[c.brand_id]
    if (!slug || slug === 'joola') continue
    const scraped = prodForCurated(curatedId)
    const idx = pd.price_index_90d != null ? Number(pd.price_index_90d) : null
    const discount = scraped?.discount_pct != null ? Number(scraped.discount_pct) : null
    const closest = findClosestJoola({ category: c.category }, joolaPaddles)
    let action = 'Monitor'
    if (idx != null && idx < 0.85) action = closest ? `Defend ${closest.name} pricing` : 'Defend pricing'
    else if (idx != null && idx < 0.95) action = 'Watch — moderate discount'
    out.push({
      brandSlug: slug,
      brandName: nameByBid[c.brand_id] || slug,
      productId: curatedId,
      productName: c.display_name,
      currentPrice: pd.price_usd != null ? Number(pd.price_usd) : (scraped?.sale_price_usd != null ? Number(scraped.sale_price_usd) : scraped?.price_usd != null ? Number(scraped.price_usd) : null),
      priceIndex90d: idx,
      discountPct: discount,
      joolaComparableName: closest?.name || '—',
      action,
    })
  }
  return out
    .sort((a, b) => (a.priceIndex90d ?? 1) - (b.priceIndex90d ?? 1))
    .slice(0, topN)
}

// ─── Section I: Attention vs availability matrix ──────────────────────
export interface AttentionAvailabilityPoint {
  productId: string
  productName: string
  brandSlug: string
  isJoola: boolean
  attention: number              // mentions_total last_30d (x)
  availability: number           // availability_index 0..1 (y)
  quadrant: 'opportunity' | 'strong-competitor' | 'discontinued' | 'weak'
}

export async function fetchAttentionAvailability(brands: V2Brand[]): Promise<AttentionAvailabilityPoint[]> {
  const slugByBid: Record<string, string> = Object.fromEntries(brands.map((b) => [b.brand_id, b.id]))

  const [sumRes, availRes, curRes] = await Promise.all([
    supabase
      .from('product_attention_summary')
      .select('product_id,brand_id,mentions_total')
      .eq('period', 'last_30d')
      .limit(2000),
    supabase
      .from('availability_daily')
      .select('product_id,availability_index,metric_date')
      .order('metric_date', { ascending: false })
      .limit(5000),
    supabase
      .from('products_catalog')
      .select('id,display_name')
      .limit(2000),
  ])
  type S = { product_id: string; brand_id: string; mentions_total: number | null }
  const sums = ((sumRes.data as unknown) || []) as S[]
  type A = { product_id: string; availability_index: number | null; metric_date: string }
  const avs = ((availRes.data as unknown) || []) as A[]
  const nameById: Record<string, string> = {}
  ;((curRes.data as unknown) as { id: string; display_name: string }[] || []).forEach((c) => {
    nameById[c.id] = c.display_name
  })

  // latest availability per product
  const availLatest: Record<string, number> = {}
  for (const r of avs) {
    if (r.product_id && availLatest[r.product_id] === undefined && r.availability_index != null) {
      availLatest[r.product_id] = Number(r.availability_index)
    }
  }

  // Determine attention median to set the high/low cut
  const mentionList = sums.map((s) => Number(s.mentions_total || 0)).filter((n) => n > 0).sort((a, b) => a - b)
  const attentionCut = mentionList.length ? mentionList[Math.floor(mentionList.length / 2)] : 10

  const out: AttentionAvailabilityPoint[] = []
  for (const s of sums) {
    const slug = slugByBid[s.brand_id]
    if (!slug) continue
    const att = Number(s.mentions_total || 0)
    const avail = availLatest[s.product_id]
    if (avail === undefined) continue
    const highAtt = att >= attentionCut
    const highAvail = avail >= 0.5
    const quadrant =
      highAtt && !highAvail ? 'opportunity' :
        highAtt && highAvail ? 'strong-competitor' :
          !highAtt && !highAvail ? 'discontinued' :
            'weak'
    out.push({
      productId: s.product_id,
      productName: nameById[s.product_id] || '— unknown —',
      brandSlug: slug,
      isJoola: slug === 'joola',
      attention: att,
      availability: avail,
      quadrant,
    })
  }
  return out
}
