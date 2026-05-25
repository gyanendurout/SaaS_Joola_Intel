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
  price_usd: number | null
  category: string | null
  in_stock: boolean | null
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
      .select('id,brand_id,name,price_usd,category,in_stock')
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

