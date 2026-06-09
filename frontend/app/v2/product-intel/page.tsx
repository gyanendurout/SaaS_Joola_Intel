'use client'

import { useEffect, useMemo, useState } from 'react'
import { BrandSummaryTable } from '@/components/v2/BrandSummaryTable'
import {
  PageHead,
  FilterBanner,
  SectionInfo,
  SortTh,
  LoadingPage,
  pgColor,
  pgName,
} from '@/components/v2/PageShell'
import { LineChart, BoxPlot, fmt, type LineSeries } from '@/components/v2/charts'
import { LeaderboardTable } from '@/components/v2/charts/LeaderboardTable'
import { TableSearch } from '@/components/v2/TableSearch'
import { ActionFrame, Caveat } from '@/components/v2/ActionFrame'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import {
  fetchProductIntel,
  fetchCompetitorAttackMap,
  fetchAttentionFunnel,
  fetchProductChannelSplit,
  fetchLaunchTracker,
  fetchUnmatchedProductMentions,
  type ProductIntelData,
  type RawCatalogProduct,
  type CuratedProduct,
  type AttentionSummaryRow,
  type AttackMapRow,
  type FunnelRow,
  type ChannelSplitRow,
  type LaunchTrackerData,
  type UnmatchedMentionRow,
} from '@/lib/v2/productIntel'
import { useBrandFilter, applyBrandFilter } from '@/lib/v2/BrandFilterContext'
import { useDateRange } from '@/lib/v2/DateRangeContext'

// ─── Helpers ─────────────────────────────────────────────────────────
const FALLBACK_PALETTE: string[] = [
  '#22c55e', '#F5E625', '#06b6d4', '#ec4899', '#a855f7',
  '#f59e0b', '#818cf8', '#ef4444', '#14b8a6', '#60a5fa',
]
const MONTH_LABEL = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function ymKey(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${yyyy}-${mm}`
}

function monthsBetween(from: Date, to: Date): string[] {
  const out: string[] = []
  const cur = new Date(from.getFullYear(), from.getMonth(), 1)
  const end = new Date(to.getFullYear(), to.getMonth(), 1)
  while (cur <= end) {
    out.push(ymKey(cur))
    cur.setMonth(cur.getMonth() + 1)
  }
  return out.length ? out : [ymKey(end)]
}

function monthShortLabel(ym: string): string {
  const m = Number(ym.split('-')[1] || '1')
  return MONTH_LABEL[Math.max(0, Math.min(11, m - 1))]
}

// ─── Page ────────────────────────────────────────────────────────────
export default function ProductIntelPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [intel, setIntel] = useState<ProductIntelData | null>(null)
  const [loading, setLoading] = useState(true)

  // ── New section state (Sections A-E) ──────────────────────────────
  const [attackMap, setAttackMap] = useState<AttackMapRow[]>([])
  const [funnelRows, setFunnelRows] = useState<FunnelRow[]>([])
  const [channelSplit, setChannelSplit] = useState<ChannelSplitRow[]>([])
  const [launchData, setLaunchData] = useState<LaunchTrackerData | null>(null)
  const [unmatchedRows, setUnmatchedRows] = useState<UnmatchedMentionRow[]>([])

  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()
  const { effectiveFrom, effectiveTo } = useDateRange()

  // Local filters
  const [stockFilter, setStockFilter] = useState<'all' | 'in' | 'out'>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [minPrice, setMinPrice] = useState<number>(0)
  const [maxPrice, setMaxPrice] = useState<number>(500)

  // Per-section search / sorts
  const [matrixSearch, setMatrixSearch] = useState('')
  const [matrixSortKey, setMatrixSortKey] = useState<string | null>('allTime')
  const [matrixSortDir, setMatrixSortDir] = useState<'asc' | 'desc'>('desc')

  const [joolaSortKey, setJoolaSortKey] = useState<string | null>('last30d')
  const [joolaSortDir, setJoolaSortDir] = useState<'asc' | 'desc'>('desc')

  const [catalogSizeSortKey, setCatalogSizeSortKey] = useState<string | null>('count')
  const [catalogSizeSortDir, setCatalogSizeSortDir] = useState<'asc' | 'desc'>('desc')
  const [catalogSizeBrandFilter, setCatalogSizeBrandFilter] = useState('')

  const [catalogTableSearch, setCatalogTableSearch] = useState('')
  const [catalogTableSortKey, setCatalogTableSortKey] = useState<string | null>('price_usd')
  const [catalogTableSortDir, setCatalogTableSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    document.title = 'JOOLA INTEL — Product Intel'
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const b = await fetchBrands()
        const data = await fetchProductIntel(b)
        if (cancelled) return
        setBrands(b)
        setAllBrands(b)
        setIntel(data)

        // Fire the new sections in parallel — they fail soft to empty arrays.
        const [attack, funnel, split, launches, unmatched] = await Promise.all([
          fetchCompetitorAttackMap(b).catch(() => [] as AttackMapRow[]),
          fetchAttentionFunnel(b).catch(() => [] as FunnelRow[]),
          fetchProductChannelSplit(b).catch(() => [] as ChannelSplitRow[]),
          fetchLaunchTracker(b).catch(() => ({ rows: [], totalProducts: 0, productsWithLaunchDate: 0 } as LaunchTrackerData)),
          fetchUnmatchedProductMentions(b).catch(() => [] as UnmatchedMentionRow[]),
        ])
        if (cancelled) return
        setAttackMap(attack)
        setFunnelRows(funnel)
        setChannelSplit(split)
        setLaunchData(launches)
        setUnmatchedRows(unmatched)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [setAllBrands])

  // Memoize date-window months (must be called before the early-return)
  const months = useMemo(() => monthsBetween(effectiveFrom, effectiveTo),
    [effectiveFrom.getTime(), effectiveTo.getTime()])

  if (loading || !intel) return <LoadingPage />

  const {
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
  } = intel

  // Optional column visibility flags for the leaderboard table.
  const hasAnyEstUnits = leaderboardRows.some(
    (r) => r.estimatedUnitsSold !== undefined && r.estimatedUnitsSold > 0,
  )
  const hasAnyBestLag = leaderboardRows.some((r) => r.bestLagDays !== undefined)

  // ─── Brand maps ───────────────────────────────────────────────────
  const slugByBid: Record<string, string> = Object.fromEntries(
    brands.map((b) => [b.brand_id, b.id]),
  )
  const brandLabel = (slug: string) => pgName(slug, brands)
  const brandIdLabel = (brandId: string) => {
    const slug = slugByBid[brandId]
    return slug ? pgName(slug, brands) : '—'
  }
  const brandIdColor = (brandId: string) => {
    const slug = slugByBid[brandId]
    return slug ? pgColor(slug) : '#888'
  }

  // ─── Lookups ──────────────────────────────────────────────────────
  const curatedById: Record<string, CuratedProduct> = {}
  curatedProducts.forEach((c) => { curatedById[c.id] = c })
  const catalogById: Record<string, RawCatalogProduct> = {}
  catalogProducts.forEach((p) => { catalogById[p.id] = p })

  const catalogForCurated = (curatedId: string): RawCatalogProduct | null => {
    const catId = productMatches.curatedToCatalog.get(curatedId)
    return catId ? catalogById[catId] || null : null
  }

  const productLabel = (curatedId: string): string => {
    return curatedById[curatedId]?.display_name || '— unknown product —'
  }

  // ─── Filter setup ─────────────────────────────────────────────────
  // Allowed brand slugs based on the brand filter
  const allowedSlugs = new Set(
    (isFiltered ? filteredBrands : brands).map((b) => b.id),
  )
  const allowedBrandIds = new Set(
    brands.filter((b) => allowedSlugs.has(b.id)).map((b) => b.brand_id),
  )

  // Categories derived from raw catalog
  const allCategories = Array.from(
    new Set(catalogProducts.map((p) => (p.category || '').trim()).filter(Boolean)),
  ).sort()

  // Catalog rows filtered by brand + category + stock + price range
  const filteredCatalog = catalogProducts.filter((p) => {
    if (!allowedBrandIds.has(p.brand_id)) return false
    if (categoryFilter !== 'all' && (p.category || '') !== categoryFilter) return false
    if (stockFilter === 'in' && p.in_stock === false) return false
    if (stockFilter === 'out' && p.in_stock !== false) return false
    const price = p.price_usd != null ? Number(p.price_usd) : null
    // Defensive guard: drop scraping artifacts. Pickleball paddles are $50-$500.
    // Outliers like $52,598 (Selkirk row) come from scrape misalignment (size code parsed as price).
    if (price != null && (!isFinite(price) || price > 500 || price <= 0)) return false
    if (price != null) {
      if (price < minPrice) return false
      if (maxPrice < 500 && price > maxPrice) return false
    } else {
      // unknown price: include only when no explicit price filter set
      if (minPrice > 0 || maxPrice < 500) return false
    }
    return true
  })

  // Display stats (brand-filter aware)
  const displayPriceStats = applyBrandFilter(priceStatsByBrand, filteredBrands, isFiltered)
  const displayCatalogStats = applyBrandFilter(catalogStatsByBrand, filteredBrands, isFiltered)
  const displayPriceTiers = applyBrandFilter(priceTierStatsByBrand, filteredBrands, isFiltered)

  // ─── Date filter on attention rows ────────────────────────────────
  const fromTs = effectiveFrom.getTime()
  const toTs = effectiveTo.getTime() + 86_400_000 - 1 // inclusive end of day

  const filteredDaily = attentionDaily.filter((d) => {
    if (!d.date) return false
    if (!allowedBrandIds.has(d.brand_id)) return false
    const t = new Date(d.date).getTime()
    return t >= fromTs && t <= toTs
  })

  // Period-bucket summary stays date-independent — periods are pre-bucketed
  const filteredSummary = attentionSummary.filter((s) => allowedBrandIds.has(s.brand_id))

  // ─── Section 1: Header / Filter bar derived totals ────────────────
  const totalRawCatalog = filteredCatalog.length
  const totalCuratedAttention = curatedProducts.filter((c) => allowedBrandIds.has(c.brand_id)).length
  const joolaBrand = brands.find((b) => b.id === 'joola')
  const joolaCatalogCount = joolaBrand
    ? filteredCatalog.filter((p) => p.brand_id === joolaBrand.brand_id).length
    : 0
  const joolaPrices = joolaBrand
    ? filteredCatalog
        .filter((p) => p.brand_id === joolaBrand.brand_id && p.price_usd != null)
        .map((p) => Number(p.price_usd))
    : []
  const joolaAvgPrice = joolaPrices.length
    ? Math.round(joolaPrices.reduce((s, x) => s + x, 0) / joolaPrices.length)
    : 0
  const attentionStatus =
    dataStatus.hasDaily && dataStatus.hasSummary
      ? { sym: '✓', color: '#22c55e', label: 'live' }
      : dataStatus.hasDaily || dataStatus.hasSummary
        ? { sym: '⚠', color: '#F5E625', label: 'partial' }
        : { sym: '—', color: '#6b7280', label: 'pending' }
  const brandsDisplayed = (isFiltered ? filteredBrands : brands).length

  // ─── Section 2: Momentum over time ────────────────────────────────
  const monthLabels = months.map(monthShortLabel)
  const topProductSeries: LineSeries[] = (() => {
    if (!filteredDaily.length || !months.length) return []
    const grid: Record<string, Record<string, number>> = {}
    const totals: Record<string, number> = {}
    for (const row of filteredDaily) {
      const ym = (row.date || '').slice(0, 7)
      if (!months.includes(ym)) continue
      if (!grid[row.product_id]) grid[row.product_id] = {}
      grid[row.product_id][ym] = (grid[row.product_id][ym] || 0) + (row.mention_count || 0)
      totals[row.product_id] = (totals[row.product_id] || 0) + (row.mention_count || 0)
    }
    const top = Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pid]) => pid)
    return top.map((pid, i): LineSeries => {
      const c = curatedById[pid]
      const slug = c ? slugByBid[c.brand_id] : ''
      const color = slug ? pgColor(slug) : FALLBACK_PALETTE[i % FALLBACK_PALETTE.length]
      return {
        id: pid,
        label: productLabel(pid),
        color,
        data: months.map((ym) => grid[pid]?.[ym] || 0),
      }
    })
  })()

  // ─── Section 3: Momentum leaderboards ─────────────────────────────
  const last30 = filteredSummary.filter((s) => s.period === 'last_30d')
  const allTime = filteredSummary.filter((s) => s.period === 'all_time')

  const allTimeMap: Record<string, AttentionSummaryRow> = {}
  allTime.forEach((s) => { allTimeMap[s.product_id] = s })

  const topRising = [...last30]
    .map((s) => {
      const at = allTimeMap[s.product_id]
      const pct = at && at.total_mentions > 0
        ? Math.round((s.total_mentions / at.total_mentions) * 100)
        : null
      return { ...s, risePct: pct }
    })
    .sort((a, b) => b.total_mentions - a.total_mentions)
    .slice(0, 10)

  const topByGap = [...last30]
    .filter((s) => s.gap_to_top_competitor !== null)
    .sort((a, b) => (b.gap_to_top_competitor || 0) - (a.gap_to_top_competitor || 0))
    .slice(0, 10)

  // ─── Section 4: Cross-brand matrix ────────────────────────────────
  type MatrixRow = {
    productId: string
    productName: string
    brand: string
    brandId: string
    brandSlug: string
    price: number | null
    category: string | null
    last7d: number
    last30d: number
    last90d: number
    allTime: number
    gap: number | null
    isJoola: boolean
  }

  const byProduct: Record<string, Record<string, AttentionSummaryRow>> = {}
  filteredSummary.forEach((s) => {
    if (!byProduct[s.product_id]) byProduct[s.product_id] = {}
    byProduct[s.product_id][s.period] = s
  })
  const matrixRows: MatrixRow[] = Object.entries(byProduct).map(([pid, m]) => {
    const anyS = m.all_time || m.last_90d || m.last_30d || m.last_7d
    const brandId = anyS?.brand_id || ''
    const slug = slugByBid[brandId] || ''
    const catRow = catalogForCurated(pid)
    return {
      productId: pid,
      productName: productLabel(pid),
      brand: brandIdLabel(brandId),
      brandId,
      brandSlug: slug,
      price: catRow?.price_usd != null ? Number(catRow.price_usd) : null,
      category: catRow?.category || null,
      last7d: m.last_7d?.total_mentions || 0,
      last30d: m.last_30d?.total_mentions || 0,
      last90d: m.last_90d?.total_mentions || 0,
      allTime: m.all_time?.total_mentions || 0,
      gap: m.last_30d?.gap_to_top_competitor ?? null,
      isJoola: slug === 'joola',
    }
  })

  const matrixSearched = matrixSearch.trim()
    ? matrixRows.filter((r) => {
        const q = matrixSearch.trim().toLowerCase()
        return r.productName.toLowerCase().includes(q) || r.brand.toLowerCase().includes(q)
      })
    : matrixRows

  const matrixSorted = sortRows(matrixSearched, matrixSortKey, matrixSortDir).slice(0, 200)

  // ─── Section 5: JOOLA paddle line ─────────────────────────────────
  type JoolaRow = MatrixRow & { salesLikelihood: number | null }
  const joolaRows: JoolaRow[] = matrixRows
    .filter((r) => r.isJoola)
    .map((r) => {
      const last30Row = byProduct[r.productId]?.last_30d
      return {
        ...r,
        salesLikelihood: last30Row?.avg_sentiment != null ? Number(last30Row.avg_sentiment) : null,
      }
    })

  const joolaSorted = sortRows(joolaRows, joolaSortKey, joolaSortDir)

  // ─── Section 6 derived ────────────────────────────────────────────
  const boxData = displayPriceStats.map((p) => ({
    brand: p.brand,
    name: brandLabel(p.brand),
    color: pgColor(p.brand),
    min: p.min,
    med: p.med,
    max: p.max,
    avg: p.avg,
    count: p.count,
  }))

  const catalogSizeSearched = catalogSizeBrandFilter.trim()
    ? displayCatalogStats.filter((s) =>
        brandLabel(s.brand).toLowerCase().includes(catalogSizeBrandFilter.trim().toLowerCase()))
    : displayCatalogStats
  const catalogSizeSorted = sortRows(catalogSizeSearched, catalogSizeSortKey, catalogSizeSortDir)
  const maxCatalogCount = Math.max(1, ...catalogSizeSorted.map((s) => s.count))

  // ─── Section 7: Full catalog table ────────────────────────────────
  type CatTableRow = RawCatalogProduct & {
    brandSlug: string
    brandName: string
    last30dMentions: number
    trend: 'up' | 'down' | 'flat' | null
    gap: number | null
  }

  const catalogTableRows: CatTableRow[] = filteredCatalog.map((p) => {
    const slug = slugByBid[p.brand_id] || 'unknown'
    // Look up summary via reverse-matched curated id
    let last30dMentions = 0
    let trend: 'up' | 'down' | 'flat' | null = null
    let gap: number | null = null
    const curatedId = productMatches.catalogToCurated.get(p.id)
    if (curatedId && byProduct[curatedId]) {
      const buckets = byProduct[curatedId]
      last30dMentions = buckets.last_30d?.total_mentions || 0
      gap = buckets.last_30d?.gap_to_top_competitor ?? null
      const l90 = buckets.last_90d?.total_mentions || 0
      const expected = l90 / 3
      trend = last30dMentions > expected * 1.05 ? 'up'
        : last30dMentions < expected * 0.95 ? 'down'
          : 'flat'
    }
    return {
      ...p,
      brandSlug: slug,
      brandName: brandLabel(slug),
      last30dMentions,
      trend,
      gap,
    }
  })

  const catalogTableSearched = catalogTableSearch.trim()
    ? catalogTableRows.filter((r) => {
        const q = catalogTableSearch.trim().toLowerCase()
        return (
          (r.name || '').toLowerCase().includes(q) ||
          r.brandName.toLowerCase().includes(q) ||
          (r.category || '').toLowerCase().includes(q)
        )
      })
    : catalogTableRows

  const catalogTableSorted = sortRows(
    catalogTableSearched,
    catalogTableSortKey,
    catalogTableSortDir,
  ).slice(0, 200)

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <>
      <PageHead title="PRODUCT INTEL" />
      <FilterBanner />

      {/* ── Filter bar ──────────────────────────────────────────── */}
      <section>
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', fontSize: 12 }}>
            <span style={{ color: 'var(--fg-4)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: 10 }}>
              Filters
            </span>

            <label style={labelStyle}>
              Category
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                style={selectStyle}
              >
                <option value="all">All</option>
                {allCategories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>

            <label style={labelStyle}>
              Stock
              <select
                value={stockFilter}
                onChange={(e) => setStockFilter(e.target.value as 'all' | 'in' | 'out')}
                style={selectStyle}
              >
                <option value="all">All</option>
                <option value="in">In stock</option>
                <option value="out">Out of stock</option>
              </select>
            </label>

            <label style={labelStyle}>
              Min $
              <input
                type="number"
                min={0}
                max={500}
                step={10}
                value={minPrice}
                onChange={(e) => setMinPrice(Math.max(0, Number(e.target.value) || 0))}
                style={{ ...selectStyle, width: 64 }}
              />
            </label>

            <label style={labelStyle}>
              Max $
              <input
                type="number"
                min={0}
                max={500}
                step={10}
                value={maxPrice}
                onChange={(e) => setMaxPrice(Math.min(500, Number(e.target.value) || 500))}
                style={{ ...selectStyle, width: 64 }}
              />
            </label>

            <span style={{ color: 'var(--fg-4)', fontSize: 10 }}>
              Date range applies to attention sections only · adjust via top bar.
            </span>
          </div>
        </div>
      </section>

      {/* ── Section 1: Summary strip ────────────────────────────── */}
      <section>
        <div className="card" style={{ padding: '10px 14px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center', fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>
            <SumPill label="raw catalog" value={fmt(totalRawCatalog)} color="#cbd1dc" />
            <SumPill label="curated attention" value={fmt(totalCuratedAttention)} color="#cbd1dc" />
            <SumPill label="brands" value={String(brandsDisplayed)} color="#cbd1dc" />
            <SumPill label="JOOLA catalog" value={String(joolaCatalogCount)} color="#22c55e" />
            <SumPill label="JOOLA avg" value={joolaAvgPrice ? '$' + joolaAvgPrice : '—'} color="#22c55e" />
            <SumPill label="attention" value={`${attentionStatus.sym} ${attentionStatus.label}`} color={attentionStatus.color} />
          </div>
        </div>
      </section>

      <BrandSummaryTable
        catalogStats={displayCatalogStats}
        daily={filteredDaily}
        brands={brands}
        curatedProducts={intel?.curatedProducts ?? []}
        catalogProducts={intel?.catalogProducts ?? []}
        toTs={toTs}
      />

      {/* ── Section 2: Momentum over time ────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Product momentum · top 10 over time
              <SectionInfo
                title="Top Products by Mentions"
                description="One line per product. The top 10 products by mention volume in the selected date range, plotted month-on-month across every tracked channel. Brand filter, date range, and stock/category/price filters above all apply."
                source="product_attention_daily · aggregated by the AI enrichment pipeline"
              />
            </h2>
            <div className="sub">Which paddles are gaining mindshare in the chosen window.</div>
          </div>
        </div>
        {topProductSeries.length > 0 ? (
          <div className="card"><div className="card-pad">
            <ProductMomentumBarChart series={topProductSeries} monthLabels={monthLabels} />
          </div></div>
        ) : (
          <div className="card" style={emptyStyle}>
            <div style={{ fontSize: 13 }}>No product attention data for the current date / brand window.</div>
            <div style={{ fontSize: 11, marginTop: 6, opacity: 0.6 }}>Expand the date range or clear the brand filter.</div>
          </div>
        )}
      </section>

      {/* ── Section 3: Leaderboards ─────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Momentum leaders · 30-day window
              <SectionInfo
                title="Rising + Competitive Gap"
                description="Left: top 10 products by mentions in the last 30 days. Right: top 10 products by their gap vs. the top competitor in their category — positive (green) means category leader, negative (amber) means JOOLA is trailing."
                source="product_attention_summary · period = last_30d"
              />
            </h2>
            <div className="sub">Two angles: raw momentum and competitive positioning.</div>
          </div>
        </div>
        <div className="two-col-even">
          <div className="card"><div className="card-pad">
            <h3 style={subHeadStyle}>Top 10 rising · last 30d</h3>
            {topRising.length === 0 ? (
              <div style={emptyInlineStyle}>No 30-day rows for the current filter.</div>
            ) : (
              topRising.map((s, i) => (
                <div key={s.product_id} className="bar-row" style={{ gridTemplateColumns: '28px 1fr auto auto' }}>
                  <div style={{ color: 'var(--fg-4)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>#{i + 1}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {productLabel(s.product_id)}
                    </div>
                    <div style={{ fontSize: 10.5, color: brandIdColor(s.brand_id), fontWeight: 700 }}>
                      {brandIdLabel(s.brand_id)}
                    </div>
                  </div>
                  <div style={monoNumStyle}>{fmt(s.total_mentions)}</div>
                  <div>
                    {s.risePct !== null && s.risePct >= 0 && (
                      <span style={risePillStyle} title="Share of all-time mentions captured in last 30d">
                        ▲ {s.risePct}%
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div></div>

          <div className="card"><div className="card-pad">
            <h3 style={subHeadStyle}>Largest competitive gaps</h3>
            {topByGap.length === 0 ? (
              <div style={emptyInlineStyle}>Gap analysis pending — needs ≥2 products per category.</div>
            ) : (
              topByGap.map((s, i) => {
                const gap = s.gap_to_top_competitor || 0
                const slug = slugByBid[s.brand_id] || ''
                const isJoola = slug === 'joola'
                const trailing = isJoola && gap < 0
                return (
                  <div
                    key={s.product_id}
                    className="bar-row"
                    style={{
                      gridTemplateColumns: '28px 1fr auto',
                      borderLeft: isJoola ? '2px solid #22c55e' : '2px solid transparent',
                    }}
                  >
                    <div style={{ color: 'var(--fg-4)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>#{i + 1}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: isJoola ? '#22c55e' : 'var(--fg)', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {productLabel(s.product_id)}
                      </div>
                      <div style={{ fontSize: 10.5, color: brandIdColor(s.brand_id), fontWeight: 700 }}>
                        {brandIdLabel(s.brand_id)}
                      </div>
                    </div>
                    <div
                      style={{
                        ...monoNumStyle,
                        color: trailing ? '#f59e0b' : gap >= 0 ? '#22c55e' : '#ef4444',
                      }}
                      title="gap_to_top_competitor: positive = leading, negative = trailing"
                    >
                      {gap >= 0 ? '+' : ''}{fmt(gap)}
                    </div>
                  </div>
                )
              })
            )}
          </div></div>
        </div>
      </section>

      {/* ── Coverage diagnostic (data-quality status — surfaced ABOVE matrix) ─── */}
      <section>
        <div className="card" style={{ padding: '10px 14px', fontSize: 11, color: 'var(--fg-3)', marginBottom: 12 }}>
          <span style={{ fontWeight: 700, color: 'var(--fg)', letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: 10 }}>
            Product data coverage ·
          </span>{' '}
          Raw catalog: <strong style={{ color: 'var(--fg)' }}>{dataStatus.rawCount}</strong> ·
          Curated attention: <strong style={{ color: 'var(--fg)' }}>{dataStatus.curatedCount}</strong> ·
          Matched: <strong style={{ color: '#22c55e' }}>{productMatches.matchedCount}</strong> ·
          Unmatched catalog: <strong style={{ color: '#F5E625' }}>{productMatches.unmatchedCatalogCount}</strong> ·
          Unmatched attention: <strong style={{ color: '#F5E625' }}>{productMatches.unmatchedCuratedCount}</strong> ·
          Leaderboard: <strong style={{ color: '#22c55e' }}>{leaderboardStatus.rowCount}</strong> ranked ·
          Lag scans: <strong style={{ color: '#22c55e' }}>{lagScanStatus.rowCount}</strong> ·
          Matching method: <em>brand + normalized name (display_name + aliases)</em>
        </div>
      </section>

      {/* ── Section 5: Product attention leaderboard (merged from /v2/leaderboard) ── */}
      <section id="product-leaderboard">
        <div className="section-head">
          <div>
            <h2>
              Product attention leaderboard
              <SectionInfo
                title="Attention, mentions, lag"
                description="Attention is the 7-day rolling mean of attention_score from joola_timeseries_daily. Mentions is the 28-day total. Best lag is the strongest (driver, lag) pair from lag_scan — predictive screen, not proof of causality."
                source="joola_timeseries_daily · analysis_results (lag_scan)"
              />
            </h2>
            <div className="sub">Top {leaderboardRows.length} products by rolling 28-day attention. Rows with zero attention and no signal are hidden.</div>
          </div>
        </div>

        {/* Compact "How to read this" inline helper */}
        <div className="card" style={{ padding: 12, marginBottom: 12, fontSize: 11, color: 'var(--fg-3)' }}>
          <span style={{ color: '#22c55e', fontWeight: 700 }}>Attention</span> = 7-day rolling mean ·{' '}
          <span style={{ color: '#F5E625', fontWeight: 700 }}>Best lag</span> = strongest predictive driver ·{' '}
          <span style={{ color: '#94a3b8', fontWeight: 700 }}>Sparkline</span> = 28-day trend · JOOLA rows highlighted green
        </div>

        {leaderboardRows.length > 0 ? (
          <div className="card"><div className="card-pad">
            <LeaderboardTable
              rows={leaderboardRows}
              sortBy="attention"
              showEstUnitsSold={hasAnyEstUnits}
              showBestLag={hasAnyBestLag}
              interpretation="Click any column header to sort. Brand and product search supported inline."
            />
          </div></div>
        ) : leaderboardStatus.hasTimeseries || leaderboardStatus.hasLagScans ? (
          <div className="card" style={{ padding: 28, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>
            Pipeline output is present, but no per-product timeseries rows matched the current filters.
          </div>
        ) : (
          <div className="card" style={{ padding: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>Product attention leaderboard has not been generated yet.</div>
            <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 4 }}>This section will populate after the analytics pipeline runs.</div>
          </div>
        )}
      </section>

      {/* ── Section 4: Cross-brand product matrix ──────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Cross-brand product matrix · {matrixSorted.length} rows
              <SectionInfo
                title="All Periods Side by Side"
                description="Every tracked curated product with 7d / 30d / 90d / all-time mention counts, gap vs. top competitor, and a trend arrow comparing the 30d window vs. the 90d/3 baseline. Price + category appear when the curated product is matched to a raw catalog row."
                source="product_attention_summary + safe brand+name match against products"
              />
            </h2>
            <div className="sub">Click column headers to sort.</div>
          </div>
        </div>
        <div className="card">
          <div style={{ padding: '10px 14px 0' }}>
            <TableSearch value={matrixSearch} onChange={setMatrixSearch} placeholder="Search product or brand…" width={280} />
          </div>
          <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
            <table className="data" style={{ width: '100%' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'rgba(13,17,23,0.95)' }}>
                <tr>
                  <SortTh col="productName" label="Product" sortKey={matrixSortKey} sortDir={matrixSortDir} toggle={mkToggle(setMatrixSortKey, setMatrixSortDir, matrixSortKey, matrixSortDir)} />
                  <SortTh col="brand" label="Brand" sortKey={matrixSortKey} sortDir={matrixSortDir} toggle={mkToggle(setMatrixSortKey, setMatrixSortDir, matrixSortKey, matrixSortDir)} />
                  <SortTh col="price" label="Price" sortKey={matrixSortKey} sortDir={matrixSortDir} toggle={mkToggle(setMatrixSortKey, setMatrixSortDir, matrixSortKey, matrixSortDir)} style={{ textAlign: 'right' }} />
                  <SortTh col="category" label="Category" sortKey={matrixSortKey} sortDir={matrixSortDir} toggle={mkToggle(setMatrixSortKey, setMatrixSortDir, matrixSortKey, matrixSortDir)} />
                  <SortTh col="last7d" label="7d" sortKey={matrixSortKey} sortDir={matrixSortDir} toggle={mkToggle(setMatrixSortKey, setMatrixSortDir, matrixSortKey, matrixSortDir)} style={{ textAlign: 'right' }} />
                  <SortTh col="last30d" label="30d" sortKey={matrixSortKey} sortDir={matrixSortDir} toggle={mkToggle(setMatrixSortKey, setMatrixSortDir, matrixSortKey, matrixSortDir)} style={{ textAlign: 'right' }} />
                  <SortTh col="last90d" label="90d" sortKey={matrixSortKey} sortDir={matrixSortDir} toggle={mkToggle(setMatrixSortKey, setMatrixSortDir, matrixSortKey, matrixSortDir)} style={{ textAlign: 'right' }} />
                  <SortTh col="allTime" label="All" sortKey={matrixSortKey} sortDir={matrixSortDir} toggle={mkToggle(setMatrixSortKey, setMatrixSortDir, matrixSortKey, matrixSortDir)} style={{ textAlign: 'right' }} />
                  <SortTh col="gap" label="Gap" sortKey={matrixSortKey} sortDir={matrixSortDir} toggle={mkToggle(setMatrixSortKey, setMatrixSortDir, matrixSortKey, matrixSortDir)} style={{ textAlign: 'right' }} title="Gap compares this product's attention score to the top competitor product in the same period/category." />
                  <th style={{ textAlign: 'center' }}>Trend</th>
                </tr>
              </thead>
              <tbody>
                {matrixSorted.map((row) => {
                  const expected = row.last90d / 3
                  const trendDir = row.last30d > expected * 1.05 ? 'up'
                    : row.last30d < expected * 0.95 ? 'down' : 'flat'
                  const trendChar = trendDir === 'up' ? '▲' : trendDir === 'down' ? '▼' : '▬'
                  const trendColor = trendDir === 'up' ? '#22c55e' : trendDir === 'down' ? '#ef4444' : '#6b7280'
                  return (
                    <tr key={row.productId} style={{ borderLeft: row.isJoola ? '2px solid #22c55e' : '2px solid transparent' }}>
                      <td style={{ color: row.isJoola ? '#22c55e' : 'var(--fg)', fontWeight: 600 }}>{row.productName}</td>
                      <td style={{ color: brandIdColor(row.brandId), fontWeight: 700, fontSize: 11.5 }}>{row.brand}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                        {row.price != null ? '$' + row.price.toFixed(0) : '—'}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--fg-3)' }}>{row.category || '—'}</td>
                      <td style={cellNumStyle}>{row.last7d > 0 ? fmt(row.last7d) : '—'}</td>
                      <td style={cellNumStyle}>{row.last30d > 0 ? fmt(row.last30d) : '—'}</td>
                      <td style={cellNumStyle}>{row.last90d > 0 ? fmt(row.last90d) : '—'}</td>
                      <td style={{ ...cellNumStyle, color: '#fff', fontWeight: 700 }}>{row.allTime > 0 ? fmt(row.allTime) : '—'}</td>
                      <td style={{ ...cellNumStyle, color: row.gap == null || row.gap === 0 ? 'var(--fg-4)' : row.gap > 0 ? '#22c55e' : '#ef4444' }}>
                        {row.gap == null || row.gap === 0 ? 'N/A' : (row.gap > 0 ? '+' : '') + fmt(row.gap)}
                      </td>
                      <td style={{ textAlign: 'center', color: trendColor, fontWeight: 800 }}>{trendChar}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Section 5: JOOLA paddle line intelligence ─────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              JOOLA paddle line · scannable health
              <SectionInfo
                title="JOOLA Product Health"
                description="Every JOOLA paddle as one sortable row. Shows price, stock, last-7/30/90d mentions, gap vs. competitor, and sales-likelihood score (0-100, attention-derived, NOT confirmed sales)."
                source="product_attention_summary · brand = JOOLA · matched to products catalog"
              />
            </h2>
            <div className="sub">{joolaSorted.length} JOOLA {joolaSorted.length === 1 ? 'paddle' : 'paddles'} with attention data.</div>
          </div>
        </div>
        <div className="card">
          <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
            <table className="data" style={{ width: '100%' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'rgba(13,17,23,0.95)' }}>
                <tr>
                  <SortTh col="productName" label="Product" sortKey={joolaSortKey} sortDir={joolaSortDir} toggle={mkToggle(setJoolaSortKey, setJoolaSortDir, joolaSortKey, joolaSortDir)} />
                  <SortTh col="category" label="Category" sortKey={joolaSortKey} sortDir={joolaSortDir} toggle={mkToggle(setJoolaSortKey, setJoolaSortDir, joolaSortKey, joolaSortDir)} />
                  <SortTh col="price" label="Price" sortKey={joolaSortKey} sortDir={joolaSortDir} toggle={mkToggle(setJoolaSortKey, setJoolaSortDir, joolaSortKey, joolaSortDir)} style={{ textAlign: 'right' }} />
                  <SortTh col="last7d" label="7d" sortKey={joolaSortKey} sortDir={joolaSortDir} toggle={mkToggle(setJoolaSortKey, setJoolaSortDir, joolaSortKey, joolaSortDir)} style={{ textAlign: 'right' }} />
                  <SortTh col="last30d" label="30d" sortKey={joolaSortKey} sortDir={joolaSortDir} toggle={mkToggle(setJoolaSortKey, setJoolaSortDir, joolaSortKey, joolaSortDir)} style={{ textAlign: 'right' }} />
                  <SortTh col="last90d" label="90d" sortKey={joolaSortKey} sortDir={joolaSortDir} toggle={mkToggle(setJoolaSortKey, setJoolaSortDir, joolaSortKey, joolaSortDir)} style={{ textAlign: 'right' }} />
                  <SortTh col="allTime" label="All" sortKey={joolaSortKey} sortDir={joolaSortDir} toggle={mkToggle(setJoolaSortKey, setJoolaSortDir, joolaSortKey, joolaSortDir)} style={{ textAlign: 'right' }} />
                  <SortTh col="gap" label="Gap" sortKey={joolaSortKey} sortDir={joolaSortDir} toggle={mkToggle(setJoolaSortKey, setJoolaSortDir, joolaSortKey, joolaSortDir)} style={{ textAlign: 'right' }} title="Gap compares this product's attention score to the top competitor product in the same period/category." />
                  <SortTh col="salesLikelihood" label="Sales likelihood" sortKey={joolaSortKey} sortDir={joolaSortDir} toggle={mkToggle(setJoolaSortKey, setJoolaSortDir, joolaSortKey, joolaSortDir)} style={{ textAlign: 'right' }} />
                  <th style={{ textAlign: 'center' }}>Trend</th>
                </tr>
              </thead>
              <tbody>
                {joolaSorted.length === 0 ? (
                  <tr><td colSpan={10} style={{ ...emptyStyle, padding: 32 }}>No JOOLA attention rows yet — pipeline pending.</td></tr>
                ) : joolaSorted.map((row) => {
                  const expected = row.last90d / 3
                  const trendDir = row.last30d > expected * 1.05 ? 'up'
                    : row.last30d < expected * 0.95 ? 'down' : 'flat'
                  const trendChar = trendDir === 'up' ? '▲' : trendDir === 'down' ? '▼' : '▬'
                  const trendColor = trendDir === 'up' ? '#22c55e' : trendDir === 'down' ? '#ef4444' : '#6b7280'
                  const sl = row.salesLikelihood
                  return (
                    <tr key={row.productId} style={{ borderLeft: '2px solid #22c55e' }}>
                      <td style={{ color: '#22c55e', fontWeight: 600 }}>{row.productName}</td>
                      <td style={{ fontSize: 11, color: 'var(--fg-3)' }}>{row.category || '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                        {row.price != null ? '$' + row.price.toFixed(0) : '—'}
                      </td>
                      <td style={cellNumStyle}>{row.last7d > 0 ? fmt(row.last7d) : '—'}</td>
                      <td style={cellNumStyle}>{row.last30d > 0 ? fmt(row.last30d) : '—'}</td>
                      <td style={cellNumStyle}>{row.last90d > 0 ? fmt(row.last90d) : '—'}</td>
                      <td style={{ ...cellNumStyle, color: '#fff', fontWeight: 700 }}>{row.allTime > 0 ? fmt(row.allTime) : '—'}</td>
                      <td style={{ ...cellNumStyle, color: row.gap == null || row.gap === 0 ? 'var(--fg-4)' : row.gap > 0 ? '#22c55e' : '#f59e0b' }}>
                        {row.gap == null || row.gap === 0 ? 'N/A' : (row.gap > 0 ? '+' : '') + fmt(row.gap)}
                      </td>
                      <td style={{ ...cellNumStyle, color: sl == null ? 'var(--fg-4)' : sl >= 50 ? '#22c55e' : sl >= 25 ? '#F5E625' : '#cbd1dc' }}>
                        {sl == null ? '—' : sl.toFixed(0)}
                      </td>
                      <td style={{ textAlign: 'center', color: trendColor, fontWeight: 800 }}>{trendChar}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Section 6: Price & catalog intelligence ───────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Price &amp; catalog intelligence
              <SectionInfo
                title="Catalog Shape"
                description="Three angles on the raw scraped catalog: price range distribution, catalog size + average price, and the value/mid/premium tier breakdown per brand."
                source="products · scraped from brand websites via apify/playwright-scraper"
              />
            </h2>
            <div className="sub">Static catalog snapshot — does not date-filter (no scrape date on rows).</div>
          </div>
        </div>

        {/* 6A. Price distribution */}
        <div className="card" style={{ marginBottom: 14 }}><div className="card-pad">
          <h3 style={subHeadStyle}>6A. Price distribution by brand</h3>
          {boxData.length > 0 ? (
            <BoxPlot data={boxData} />
          ) : (
            <div style={emptyInlineStyle}>No priced catalog rows for the active filter.</div>
          )}
        </div></div>

        {/* 6B. Catalog size */}
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ padding: '10px 14px 0' }}>
            <h3 style={subHeadStyle}>6B. Catalog size by brand</h3>
            <TableSearch value={catalogSizeBrandFilter} onChange={setCatalogSizeBrandFilter} placeholder="Brand…" width={200} />
          </div>
          <div style={{ padding: '0 14px 14px' }}>
            <table className="data" style={{ width: '100%', marginBottom: 8 }}>
              <thead>
                <tr>
                  <SortTh col="brand" label="Brand" sortKey={catalogSizeSortKey} sortDir={catalogSizeSortDir} toggle={mkToggle(setCatalogSizeSortKey, setCatalogSizeSortDir, catalogSizeSortKey, catalogSizeSortDir)} style={{ width: 140 }} />
                  <SortTh col="count" label="Products" sortKey={catalogSizeSortKey} sortDir={catalogSizeSortDir} toggle={mkToggle(setCatalogSizeSortKey, setCatalogSizeSortDir, catalogSizeSortKey, catalogSizeSortDir)} />
                  <SortTh col="avg" label="Avg price" sortKey={catalogSizeSortKey} sortDir={catalogSizeSortDir} toggle={mkToggle(setCatalogSizeSortKey, setCatalogSizeSortDir, catalogSizeSortKey, catalogSizeSortDir)} style={{ width: 110, textAlign: 'right' }} />
                </tr>
              </thead>
            </table>
            {catalogSizeSorted.map((s) => (
              <div key={s.brand} className={'bar-row ' + (s.brand === 'joola' ? 'joola' : '')}>
                <div className="lbl">{brandLabel(s.brand)}</div>
                <div className="track">
                  <div className="fill" style={{
                    width: Math.max(2, (s.count / maxCatalogCount) * 100) + '%',
                    background: `linear-gradient(90deg, ${pgColor(s.brand)}, ${pgColor(s.brand)}99)`,
                  }} />
                </div>
                <div className="spark-mini" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--fg)' }}>
                  {s.count}
                </div>
                <div className="delta-mini flat">${s.avg}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 6C. Price tiers */}
        <div className="card"><div className="card-pad">
          <h3 style={subHeadStyle}>6C. Price tiers · Value / Mid / Premium</h3>
          {displayPriceTiers.map((t) => {
            const total = t.total || 1
            return (
              <div key={t.brand} className="tier-row" style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: t.brand === 'joola' ? '#22c55e' : 'var(--fg)' }}>{brandLabel(t.brand)}</span>
                  <span style={{ fontSize: 10, color: 'var(--fg-4)' }}>{t.total} products</span>
                </div>
                <div style={{ display: 'flex', height: 12, borderRadius: 4, overflow: 'hidden' }}>
                  {t.value > 0 && <div className="tier-seg" style={{ width: (t.value / total * 100) + '%', background: '#22c55e', opacity: 0.8 }} title={`${brandLabel(t.brand)} · Value <$100: ${t.value} products`} />}
                  {t.mid > 0 && <div className="tier-seg" style={{ width: (t.mid / total * 100) + '%', background: '#F5E625', opacity: 0.8 }} title={`${brandLabel(t.brand)} · Mid $100-199: ${t.mid} products`} />}
                  {t.premium > 0 && <div className="tier-seg" style={{ width: (t.premium / total * 100) + '%', background: '#ef4444', opacity: 0.8 }} title={`${brandLabel(t.brand)} · Premium $200+: ${t.premium} products`} />}
                </div>
              </div>
            )
          })}
          <div className="legend" style={{ marginTop: 10 }}>
            <span className="item"><span className="swatch" style={{ background: '#22c55e' }} />Value &lt;$100</span>
            <span className="item"><span className="swatch" style={{ background: '#F5E625' }} />Mid $100-199</span>
            <span className="item"><span className="swatch" style={{ background: '#ef4444' }} />Premium $200+</span>
          </div>
        </div></div>
      </section>

      {/* ── Section 7: Full catalog table ─────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Product catalog &amp; pricing · {catalogTableSorted.length} rows
              <SectionInfo
                title="Full Scraped Catalog"
                description="Every product scraped from brand websites in the active filter window. Stock + price filters above apply. When a catalog row matches a curated attention product (same brand, exact normalized name), its 30d mention count and trend appear inline."
                source="products · scraped weekly via apify/playwright-scraper"
              />
            </h2>
            <div className="sub">Sortable. Search by brand / product / category. Brand + stock + price filters apply.</div>
          </div>
        </div>
        <div className="card">
          <div style={{ padding: '10px 14px 0' }}>
            <TableSearch value={catalogTableSearch} onChange={setCatalogTableSearch} placeholder="Search product, brand, or category…" width={320} />
          </div>
          <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
            <table className="data" style={{ width: '100%' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'rgba(13,17,23,0.95)' }}>
                <tr>
                  <SortTh col="brandName" label="Brand" sortKey={catalogTableSortKey} sortDir={catalogTableSortDir} toggle={mkToggle(setCatalogTableSortKey, setCatalogTableSortDir, catalogTableSortKey, catalogTableSortDir)} />
                  <SortTh col="name" label="Product" sortKey={catalogTableSortKey} sortDir={catalogTableSortDir} toggle={mkToggle(setCatalogTableSortKey, setCatalogTableSortDir, catalogTableSortKey, catalogTableSortDir)} />
                  <SortTh col="category" label="Category" sortKey={catalogTableSortKey} sortDir={catalogTableSortDir} toggle={mkToggle(setCatalogTableSortKey, setCatalogTableSortDir, catalogTableSortKey, catalogTableSortDir)} />
                  <SortTh col="price_usd" label="Price" sortKey={catalogTableSortKey} sortDir={catalogTableSortDir} toggle={mkToggle(setCatalogTableSortKey, setCatalogTableSortDir, catalogTableSortKey, catalogTableSortDir)} style={{ textAlign: 'right' }} />
                  <SortTh col="sale_price_usd" label="Sale" sortKey={catalogTableSortKey} sortDir={catalogTableSortDir} toggle={mkToggle(setCatalogTableSortKey, setCatalogTableSortDir, catalogTableSortKey, catalogTableSortDir)} style={{ textAlign: 'right' }} title="Current sale price scraped from brand site (when on sale)." />
                  <SortTh col="discount_pct" label="Disc%" sortKey={catalogTableSortKey} sortDir={catalogTableSortDir} toggle={mkToggle(setCatalogTableSortKey, setCatalogTableSortDir, catalogTableSortKey, catalogTableSortDir)} style={{ textAlign: 'right' }} title="Product-level discount % off list price (from sale price or scraped tag)." />
                  <SortTh col="avg_rating" label="Rating★" sortKey={catalogTableSortKey} sortDir={catalogTableSortDir} toggle={mkToggle(setCatalogTableSortKey, setCatalogTableSortDir, catalogTableSortKey, catalogTableSortDir)} style={{ textAlign: 'right' }} title="Average star rating from brand-site review widget (Bazaarvoice / Judge.me / Okendo / etc.)." />
                  <SortTh col="review_count" label="# Reviews" sortKey={catalogTableSortKey} sortDir={catalogTableSortDir} toggle={mkToggle(setCatalogTableSortKey, setCatalogTableSortDir, catalogTableSortKey, catalogTableSortDir)} style={{ textAlign: 'right' }} title="Number of customer reviews on the brand site for this product." />
                  <SortTh col="in_stock" label="Stock" sortKey={catalogTableSortKey} sortDir={catalogTableSortDir} toggle={mkToggle(setCatalogTableSortKey, setCatalogTableSortDir, catalogTableSortKey, catalogTableSortDir)} />
                  <SortTh col="last30dMentions" label="30d mentions" sortKey={catalogTableSortKey} sortDir={catalogTableSortDir} toggle={mkToggle(setCatalogTableSortKey, setCatalogTableSortDir, catalogTableSortKey, catalogTableSortDir)} style={{ textAlign: 'right' }} />
                  <SortTh col="gap" label="Gap" sortKey={catalogTableSortKey} sortDir={catalogTableSortDir} toggle={mkToggle(setCatalogTableSortKey, setCatalogTableSortDir, catalogTableSortKey, catalogTableSortDir)} style={{ textAlign: 'right' }} title="Gap compares this product's attention score to the top competitor product in the same period/category." />
                  <th style={{ textAlign: 'center' }}>Trend</th>
                </tr>
              </thead>
              <tbody>
                {catalogTableSorted.map((p) => {
                  const trendChar = p.trend === 'up' ? '▲' : p.trend === 'down' ? '▼' : p.trend === 'flat' ? '▬' : '—'
                  const trendColor = p.trend === 'up' ? '#22c55e' : p.trend === 'down' ? '#ef4444' : p.trend === 'flat' ? '#6b7280' : 'var(--fg-4)'
                  const isJoola = p.brandSlug === 'joola'
                  return (
                    <tr key={p.id} style={{ borderLeft: isJoola ? '2px solid #22c55e' : '2px solid transparent' }}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className="brand-dot" style={{ background: pgColor(p.brandSlug) }} />
                          <span style={{ fontWeight: 700, color: isJoola ? '#22c55e' : 'var(--fg)' }}>{p.brandName}</span>
                        </span>
                      </td>
                      <td style={{ color: 'var(--fg)', fontWeight: 600 }}>{(p.name || '').slice(0, 70) || '—'}</td>
                      <td style={{ fontSize: 11, color: 'var(--fg-3)' }}>{p.category || '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: (p.price_usd || 0) >= 200 ? '#F5E625' : 'var(--fg)' }}>
                        {p.price_usd != null ? '$' + Number(p.price_usd).toFixed(0) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: p.sale_price_usd != null ? '#22c55e' : 'var(--fg-4)' }}>
                        {p.sale_price_usd != null ? '$' + Number(p.sale_price_usd).toFixed(0) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                        {p.discount_pct != null && p.discount_pct > 0
                          ? <span className="pill pill-amber">-{Number(p.discount_pct).toFixed(0)}%</span>
                          : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: p.avg_rating != null ? '#F5E625' : 'var(--fg-4)', fontWeight: 700 }}>
                        {p.avg_rating != null ? Number(p.avg_rating).toFixed(1) + '★' : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: 'var(--fg-2)' }}>
                        {p.review_count != null && p.review_count > 0 ? fmt(p.review_count) : '—'}
                      </td>
                      <td>
                        <span className={'pill ' + (p.in_stock === false ? 'pill-red' : 'pill-green')}>
                          {p.in_stock === false ? 'Out' : 'In'}
                        </span>
                      </td>
                      <td style={cellNumStyle}>{p.last30dMentions > 0 ? fmt(p.last30dMentions) : '—'}</td>
                      <td style={{ ...cellNumStyle, color: p.gap == null || p.gap === 0 ? 'var(--fg-4)' : p.gap > 0 ? '#22c55e' : '#ef4444' }}>
                        {p.gap == null || p.gap === 0 ? 'N/A' : (p.gap > 0 ? '+' : '') + fmt(p.gap)}
                      </td>
                      <td style={{ textAlign: 'center', color: trendColor, fontWeight: 800 }}>{trendChar}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ─── NEW SECTIONS · Product Intel Expansion (2026-05-25) ──── */}

      {/* ── A. Competitor product attack map ────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              A. Competitor product attack map · top {attackMap.filter(r => allowedSlugs.has(r.brandSlug)).length} rows
              <SectionInfo
                title="Competitor Attack Map"
                description="Non-JOOLA paddles ranked by 30-day attention. Growth uses last 7d × (30/7) versus 30d total as a momentum proxy. Main channel is the highest per-channel mention column for the period. Closest JOOLA paddle is matched within the same category, ranked by JOOLA attention."
                source="product_attention_summary (last_7d + last_30d) · product_attention_daily (per-channel) · products_catalog · products"
              />
            </h2>
            <div className="sub">Where competitors are winning right now — and the JOOLA paddle to counter with.</div>
          </div>
        </div>
        <div className="card">
          {attackMap.filter(r => allowedSlugs.has(r.brandSlug)).length === 0 ? (
            <div style={emptyStyle}>No competitor attack rows for the current brand filter / window.</div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
              <table className="data" style={{ width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'rgba(13,17,23,0.95)' }}>
                  <tr>
                    <th>Competitor product</th>
                    <th>Brand</th>
                    <th style={{ textAlign: 'right' }}>7d</th>
                    <th style={{ textAlign: 'right' }}>30d</th>
                    <th style={{ textAlign: 'right' }}>Growth</th>
                    <th>Main channel</th>
                    <th>Closest JOOLA paddle</th>
                    <th style={{ textAlign: 'right' }}>Gap</th>
                    <th>Recommended response</th>
                  </tr>
                </thead>
                <tbody>
                  {attackMap.filter(r => allowedSlugs.has(r.brandSlug)).map((r) => {
                    const grow = r.growthPct
                    const growColor = grow == null ? 'var(--fg-4)' : grow > 0 ? '#22c55e' : grow < 0 ? '#ef4444' : 'var(--fg-3)'
                    return (
                      <tr key={r.productId}>
                        <td style={{ color: 'var(--fg)', fontWeight: 600 }}>{r.productName}</td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span className="brand-dot" style={{ background: pgColor(r.brandSlug) }} />
                            <span style={{ fontWeight: 700, color: pgColor(r.brandSlug), fontSize: 11.5 }}>{r.brandName}</span>
                          </span>
                        </td>
                        <td style={cellNumStyle}>{r.attention7d > 0 ? fmt(r.attention7d) : '—'}</td>
                        <td style={{ ...cellNumStyle, color: '#fff', fontWeight: 700 }}>{fmt(r.attention30d)}</td>
                        <td style={{ ...cellNumStyle, color: growColor, fontWeight: 700 }}>
                          {grow == null ? '—' : (grow > 0 ? '+' : '') + grow + '%'}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--fg-2)' }}>{r.mainChannel}</td>
                        <td style={{ color: '#22c55e', fontSize: 11.5, fontWeight: 600 }}>{r.closestJoolaName}</td>
                        <td style={{ ...cellNumStyle, color: r.gap == null ? 'var(--fg-4)' : r.gap > 0 ? '#22c55e' : '#ef4444' }}>
                          {r.gap == null ? '—' : (r.gap > 0 ? '+' : '') + fmt(r.gap)}
                        </td>
                        <td>
                          <span className={'pill ' + (r.recommendedResponse.startsWith('Match') ? 'pill-amber' : r.recommendedResponse.startsWith('Push') ? 'pill-green' : 'pill-info')}>
                            {r.recommendedResponse}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <ActionFrame
          move="Top competitors are stacking attention on specific paddles (see #1 row above) — often paired with sale prices or stronger main-channel cadence."
          impact="Mind-share leak. Each week a competitor leads the conversation in a category, JOOLA's comparable paddle drops further down consideration sets and into longer review cycles."
          action="For each row, brief the social team to mirror the dominant channel within 7 days and route any JOOLA paddle with negative gap into the next promo cycle."
        />
        <Caveat tables={['product_attention_summary (last_7d, last_30d)', 'product_attention_daily', 'products_catalog', 'products']} />
      </section>

      {/* ── B. Product attention funnel ─────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              B. Product attention funnel · top {funnelRows.filter(r => allowedSlugs.has(r.brandSlug)).length} paddles
              <SectionInfo
                title="Attention Funnel"
                description="Five-step funnel per paddle for the trailing 30 days: mentions → positive sentiment % → purchase-intent count → modelled sales-likelihood (0–100) → inventory moves (restocks + sellouts). Sales-likelihood is NOT confirmed revenue; it is the AI-derived attention proxy."
                source="product_attention_daily (last 30d) · inventory_events (restock + sellout, last 30d)"
              />
            </h2>
            <div className="sub">JOOLA paddles render first when present; everything below is sorted by mentions.</div>
          </div>
        </div>
        <div className="card">
          {funnelRows.filter(r => allowedSlugs.has(r.brandSlug)).length === 0 ? (
            <div style={emptyStyle}>No funnel data yet — pipeline rolling up.</div>
          ) : (
            <div className="card-pad" style={{ display: 'grid', gap: 14 }}>
              {funnelRows.filter(r => allowedSlugs.has(r.brandSlug)).map((r) => {
                const maxMentions = Math.max(1, ...funnelRows.map((x) => x.mentions))
                const stages: { label: string; value: string; pct: number; color: string }[] = [
                  { label: 'Mentions', value: fmt(r.mentions), pct: Math.max(2, (r.mentions / maxMentions) * 100), color: r.isJoola ? '#22c55e' : pgColor(r.brandSlug) },
                  { label: 'Positive %', value: r.positivePct + '%', pct: Math.max(2, r.positivePct), color: '#22c55e' },
                  { label: 'Purchase intent', value: fmt(r.purchaseIntent), pct: Math.max(2, Math.min(100, r.purchaseIntent * 5)), color: '#F5E625' },
                  { label: 'Sales likelihood', value: String(r.salesLikelihood), pct: Math.max(2, r.salesLikelihood), color: '#06b6d4' },
                  { label: 'Inventory moves', value: fmt(r.inventoryMoves), pct: Math.max(2, Math.min(100, r.inventoryMoves * 10)), color: '#a855f7' },
                ]
                return (
                  <div key={r.productId} style={{ borderLeft: r.isJoola ? '2px solid #22c55e' : '2px solid transparent', paddingLeft: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: r.isJoola ? '#22c55e' : 'var(--fg)' }}>
                        {r.productName}
                      </span>
                      <span style={{ fontSize: 10.5, color: pgColor(r.brandSlug), fontWeight: 700 }}>
                        {pgName(r.brandSlug, brands)}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
                      {stages.map((s) => (
                        <div key={s.label} title={`${s.label}: ${s.value}`}>
                          <div style={{ fontSize: 9, color: 'var(--fg-4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 3 }}>
                            {s.label}
                          </div>
                          <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 3, height: 10, overflow: 'hidden' }}>
                            <div style={{ width: s.pct + '%', height: 10, background: `linear-gradient(90deg, ${s.color}, ${s.color}99)` }} />
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--fg)', fontFamily: 'JetBrains Mono, monospace', marginTop: 3, fontWeight: 700 }}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <ActionFrame
          move="High-attention competitor paddles with strong purchase-intent counts (column 3) and inventory moves (column 5) are converting eyeballs to bought paddles."
          impact="Conversion drag for JOOLA paddles with weaker positive % or sales-likelihood scores even when raw mentions look healthy."
          action="Audit any JOOLA row whose positive % < 60 or sales-likelihood < 40 — root cause is usually a quality complaint cluster or weak proof content (reviews / video demos)."
        />
        <Caveat tables={['product_attention_daily (30d window)', 'inventory_events (restock + sellout, 30d window)']} />
      </section>

      {/* ── C. Product channel split ────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              C. Product channel split · {channelSplit.filter(r => allowedSlugs.has(r.brandSlug)).length} paddles
              <SectionInfo
                title="Channel Split"
                description="Per-paddle 30-day mention totals broken out across IG, YouTube, Reddit, TikTok, X/Twitter, influencer posts, ads, and promotions. The dominant channel cell is highlighted to show where each paddle's conversation is concentrated."
                source="product_attention_daily — per-channel mention columns, 30-day sum"
              />
            </h2>
            <div className="sub">Where each paddle's conversation actually lives.</div>
          </div>
        </div>
        <div className="card">
          {channelSplit.filter(r => allowedSlugs.has(r.brandSlug)).length === 0 ? (
            <div style={emptyStyle}>No per-channel attention rows for the active brand window.</div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
              <table className="data" style={{ width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'rgba(13,17,23,0.95)' }}>
                  <tr>
                    <th>Product</th>
                    <th>Brand</th>
                    {['IG', 'YouTube', 'Reddit', 'TikTok', 'X', 'Influencer', 'Ads', 'Promos'].map((h) => (
                      <th key={h} style={{ textAlign: 'right' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {channelSplit.filter(r => allowedSlugs.has(r.brandSlug)).map((r) => {
                    const channelMap: { key: keyof ChannelSplitRow; label: string }[] = [
                      { key: 'instagram', label: 'IG' },
                      { key: 'youtube', label: 'YouTube' },
                      { key: 'reddit', label: 'Reddit' },
                      { key: 'tiktok', label: 'TikTok' },
                      { key: 'twitter', label: 'X' },
                      { key: 'influencer', label: 'Influencer' },
                      { key: 'ads', label: 'Ads' },
                      { key: 'promotions', label: 'Promos' },
                    ]
                    return (
                      <tr key={r.productId} style={{ borderLeft: r.isJoola ? '2px solid #22c55e' : '2px solid transparent' }}>
                        <td style={{ color: r.isJoola ? '#22c55e' : 'var(--fg)', fontWeight: 600 }}>{r.productName}</td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span className="brand-dot" style={{ background: pgColor(r.brandSlug) }} />
                            <span style={{ fontWeight: 700, color: pgColor(r.brandSlug), fontSize: 11.5 }}>{pgName(r.brandSlug, brands)}</span>
                          </span>
                        </td>
                        {channelMap.map((cm) => {
                          const v = Number(r[cm.key] || 0)
                          const isDom = cm.key === r.dominantCol
                          return (
                            <td
                              key={String(cm.key)}
                              style={{
                                ...cellNumStyle,
                                fontWeight: isDom ? 800 : 600,
                                color: v <= 0 ? 'var(--fg-4)' : isDom ? '#F5E625' : 'var(--fg-2)',
                                background: isDom && v > 0 ? 'rgba(245,230,37,0.08)' : 'transparent',
                              }}
                              title={isDom ? 'Dominant channel for this paddle' : undefined}
                            >
                              {v > 0 ? fmt(v) : '—'}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <ActionFrame
          move="Each competitor paddle has a clear conversation home — usually IG or Reddit for premium paddles, TikTok for value, and ads for newer launches."
          impact="Generic cross-channel briefs underperform paddle-specific ones. JOOLA misses moments where the audience is already concentrated."
          action="Use the highlighted column to assign one channel owner per JOOLA paddle for the next sprint; cross-post only after the home channel hits 25+ mentions."
        />
        <Caveat tables={['product_attention_daily — per-channel mention columns, 30d sum']} />
      </section>

      {/* ── D. Competitor paddle launch tracker ─────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              D. Paddle launch tracker · {launchData ? launchData.rows.filter(r => allowedSlugs.has(r.brandSlug)).length : 0} launches
              <SectionInfo
                title="Launch Tracker"
                description="For every product in products_catalog with launched_at populated, we compare mentions in the 14 days BEFORE launch (pre-buzz) versus 14 days AFTER (post-buzz). Top channel is the channel that delivered the most post-launch mentions."
                source="products_catalog (launched_at IS NOT NULL) · product_attention_daily ±14d"
              />
            </h2>
            <div className="sub">Activates as launch dates are populated on competitor + JOOLA paddles.</div>
          </div>
        </div>
        <div className="card">
          {!launchData || launchData.productsWithLaunchDate === 0 ? (
            <div style={emptyStyle}>
              <div>Launch tracker activates when products_catalog.launched_at is populated.</div>
              <div style={{ marginTop: 6, opacity: 0.7 }}>
                Currently <strong style={{ color: '#F5E625' }}>{launchData?.productsWithLaunchDate ?? 0}</strong> of{' '}
                <strong style={{ color: '#F5E625' }}>{launchData?.totalProducts ?? 0}</strong> products have launch dates.
              </div>
            </div>
          ) : launchData.rows.filter(r => allowedSlugs.has(r.brandSlug)).length === 0 ? (
            <div style={emptyStyle}>No launches match the active brand filter.</div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
              <table className="data" style={{ width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'rgba(13,17,23,0.95)' }}>
                  <tr>
                    <th>Product</th>
                    <th>Brand</th>
                    <th>Launch date</th>
                    <th style={{ textAlign: 'right' }}>Pre (14d)</th>
                    <th style={{ textAlign: 'right' }}>Post (14d)</th>
                    <th>Top channel</th>
                    <th style={{ textAlign: 'right' }}>Sales likelihood</th>
                    <th>JOOLA response</th>
                  </tr>
                </thead>
                <tbody>
                  {launchData.rows.filter(r => allowedSlugs.has(r.brandSlug)).map((r) => {
                    const isJoola = r.brandSlug === 'joola'
                    return (
                      <tr key={r.productId} style={{ borderLeft: isJoola ? '2px solid #22c55e' : '2px solid transparent' }}>
                        <td style={{ color: isJoola ? '#22c55e' : 'var(--fg)', fontWeight: 600 }}>{r.productName}</td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span className="brand-dot" style={{ background: pgColor(r.brandSlug) }} />
                            <span style={{ fontWeight: 700, color: pgColor(r.brandSlug), fontSize: 11.5 }}>{r.brandName}</span>
                          </span>
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--fg-2)' }}>{r.launchedAt.slice(0, 10)}</td>
                        <td style={cellNumStyle}>{r.preBuzz > 0 ? fmt(r.preBuzz) : '—'}</td>
                        <td style={{ ...cellNumStyle, color: r.postBuzz > r.preBuzz ? '#22c55e' : 'var(--fg-2)', fontWeight: 700 }}>
                          {r.postBuzz > 0 ? fmt(r.postBuzz) : '—'}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--fg-2)' }}>{r.topChannel}</td>
                        <td style={{ ...cellNumStyle, color: r.salesLikelihood >= 50 ? '#22c55e' : r.salesLikelihood >= 25 ? '#F5E625' : 'var(--fg-3)' }}>
                          {r.salesLikelihood || '—'}
                        </td>
                        <td>
                          <span className="pill pill-info">{r.joolaResponse}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <ActionFrame
          move="Competitor launches typically generate a 5–10x lift in post-buzz vs pre-buzz on the dominant channel, often piggy-backing on athlete drops or ambassador content."
          impact="JOOLA launches without a coordinated 14-day post-launch content plan lose the share-of-attention window forever."
          action="Backfill launched_at on every JOOLA product and require a 14-day post-launch content cadence — minimum 6 IG posts, 2 YouTube videos, and 1 Reddit AMA-style thread."
        />
        <Caveat tables={['products_catalog.launched_at', 'product_attention_daily (±14d window)', 'product_attention_summary.sales_likelihood_score']} />
      </section>

      {/* ── E. Product alias gap finder ─────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              E. Product alias gap finder · {unmatchedRows.length} unmatched mentions
              <SectionInfo
                title="Alias Gap Finder"
                description="Free-text product names extracted by the AI enrichment pipeline from comments and posts in the last 90 days, that do NOT match any current products_catalog.aliases entry (case + punctuation insensitive). Each unmatched string is a candidate alias the catalog is missing."
                source="reddit_mentions, ig_comments, yt_comments, tiktok_videos, tiktok_comments, x_posts — products_mentioned text[] arrays · 90d window"
              />
            </h2>
            <div className="sub">Run these into products_catalog.aliases to widen the AI matcher's coverage.</div>
          </div>
        </div>
        <div className="card">
          {unmatchedRows.length === 0 ? (
            <div style={emptyStyle}>No unmatched product mentions in the 90-day window — catalog coverage looks healthy.</div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
              <table className="data" style={{ width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'rgba(13,17,23,0.95)' }}>
                  <tr>
                    <th>Mention text</th>
                    <th style={{ textAlign: 'right' }}>Occurrences</th>
                    <th>Channels seen</th>
                    <th>Brands talking</th>
                    <th>Likely owner</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {unmatchedRows.map((r) => (
                    <tr key={r.mention}>
                      <td style={{ color: 'var(--fg)', fontWeight: 600 }}>{r.displayMention}</td>
                      <td style={{ ...cellNumStyle, color: '#F5E625', fontWeight: 700 }}>{fmt(r.totalOccurrences)}</td>
                      <td style={{ fontSize: 11, color: 'var(--fg-2)' }}>{r.channels.join(', ') || '—'}</td>
                      <td>
                        <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
                          {r.brandsTalking.length === 0 ? <span style={{ color: 'var(--fg-4)' }}>—</span> : r.brandsTalking.map((s) => (
                            <span key={s} className="brand-dot" style={{ background: pgColor(s), border: '1px solid rgba(255,255,255,0.15)' }} title={pgName(s, brands)} />
                          ))}
                        </span>
                      </td>
                      <td style={{ fontSize: 11, fontWeight: 700, color: r.likelyOwnerBrand === '—' ? 'var(--fg-4)' : pgColor(r.likelyOwnerBrand) }}>
                        {r.likelyOwnerBrand === '—' ? '—' : pgName(r.likelyOwnerBrand, brands)}
                      </td>
                      <td>
                        <span className="pill pill-info">Add alias to products_catalog</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <ActionFrame
          move="Competitors are getting talked about under names and abbreviations the catalog matcher does not yet know, so their attention rolls up as 'unattributed' or to the wrong row."
          impact="JOOLA's competitive view systematically under-counts the noisiest competitor paddles, which compresses gap_to_top_competitor toward 0 and hides real category leaders."
          action="Each row whose 'Likely owner' is correct gets added as an alias on the matching products_catalog row, then re-run the enrichment + facts pipelines to backfill."
        />
        <Caveat tables={['reddit_mentions.products_mentioned', 'ig_comments.products_mentioned', 'yt_comments.products_mentioned', 'tiktok_videos.products_mentioned', 'tiktok_comments.products_mentioned', 'x_posts.products_mentioned (90d window)']} />
      </section>

    </>
  )
}

// ─── Small style + helper bits ────────────────────────────────────────
const labelStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontSize: 11, color: 'var(--fg-4)', fontWeight: 600,
}
const selectStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
  color: 'var(--fg-2)', fontSize: 12, padding: '4px 8px', borderRadius: 4,
}
const subHeadStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, color: '#fff', margin: '0 0 12px',
  letterSpacing: '0.04em', textTransform: 'uppercase',
}
const monoNumStyle: React.CSSProperties = {
  fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--fg-2)', fontWeight: 600, textAlign: 'right',
}
const cellNumStyle: React.CSSProperties = {
  textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--fg-2)',
}
const risePillStyle: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 99,
  fontSize: 10, fontWeight: 800,
  background: 'rgba(34,197,94,0.18)', color: '#22c55e',
  fontFamily: 'JetBrains Mono, monospace',
}
const emptyStyle: React.CSSProperties = {
  textAlign: 'center', padding: '32px 16px', color: 'var(--fg-4)', fontSize: 12,
}
const emptyInlineStyle: React.CSSProperties = {
  textAlign: 'center', padding: '20px 8px', color: 'var(--fg-4)', fontSize: 12,
}

function SumPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ color: 'var(--fg-4)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ color, fontWeight: 700, fontSize: 13 }}>{value}</span>
    </span>
  )
}

function mkToggle(
  setKey: React.Dispatch<React.SetStateAction<string | null>>,
  setDir: React.Dispatch<React.SetStateAction<'asc' | 'desc'>>,
  curKey: string | null,
  curDir: 'asc' | 'desc',
) {
  return (k: string) => {
    if (curKey === k) setDir(curDir === 'asc' ? 'desc' : 'asc')
    else { setKey(k); setDir('desc') }
  }
}

function sortRows<T>(rows: T[], key: string | null, dir: 'asc' | 'desc'): T[] {
  if (!key) return rows
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[key]
    const bv = (b as Record<string, unknown>)[key]
    if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av
    return dir === 'asc'
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av))
  })
}



// ─── Product Momentum Bump Chart (rank over time) ────────────────────
function ProductMomentumBarChart({ series, monthLabels }: {
  series: import('@/components/v2/charts').LineSeries[]
  monthLabels: string[]
}) {
  const [hovProduct, setHovProduct] = useState<string | null>(null)
  if (!series.length || !monthLabels.length) return null

  const N = monthLabels.length
  const numProducts = series.length
  const rowH = 32
  const w = 760, padL = 44, padR = 180, padT = 20, padB = 36
  const innerW = w - padL - padR
  const h = padT + numProducts * rowH + padB

  // Compute rank per month:
  // — products with mentions: ranked 1..K by count
  // — products with 0 mentions: always render at LAST rank (numProducts) regardless of month
  const ranks: number[][] = series.map(() => Array(N).fill(0))

  for (let mi = 0; mi < N; mi++) {
    const withData = series.map((s, si) => ({ si, val: s.data[mi] || 0 })).filter(x => x.val > 0)
    withData.sort((a, b) => b.val - a.val)
    // Ranked products get 1..K
    withData.forEach(({ si }, ri) => { ranks[si][mi] = ri + 1 })
    // No-data products: go to last position for all months except the final month
    // For the last month, maintain the previous rank so lines don't drop at the end
    series.forEach((_, si) => {
      if ((series[si].data[mi] || 0) === 0) {
        if (mi < N - 1) {
          ranks[si][mi] = numProducts
        } else {
          // Last month: use previous month's rank to avoid visual drop
          ranks[si][mi] = mi > 0 ? ranks[si][mi - 1] : numProducts
        }
      }
    })
  }

  const xPos = (mi: number) => padL + (N <= 1 ? innerW / 2 : (mi / (N - 1)) * innerW)
  const yPos = (rank: number) => padT + (rank - 1) * rowH + rowH / 2

  function bezier(x1: number, y1: number, x2: number, y2: number): string {
    const cp = (x1 + x2) / 2
    return `C ${cp} ${y1}, ${cp} ${y2}, ${x2} ${y2}`
  }

  const anyHov = hovProduct !== null

  return (
    <div style={{ position: 'relative' }}>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', overflow: 'visible' }}>
        {/* Horizontal guide lines */}
        {series.map((_, ri) => (
          <line key={ri} x1={padL} x2={padL + innerW} y1={yPos(ri + 1)} y2={yPos(ri + 1)}
            stroke="rgba(255,255,255,0.04)" strokeDasharray="3 6" />
        ))}
        {/* Month columns */}
        {monthLabels.map((lbl, mi) => (
          <g key={mi}>
            <line x1={xPos(mi)} x2={xPos(mi)} y1={padT} y2={h - padB}
              stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
            <text x={xPos(mi)} y={h - padB + 16} textAnchor="middle" fontSize={10} fill="#6b7280" fontWeight={600}>{lbl}</text>
          </g>
        ))}
        {/* Rank labels */}
        {series.map((_, ri) => (
          <text key={ri} x={padL - 8} y={yPos(ri + 1) + 4} textAnchor="end" fontSize={8} fill="#3a4150" fontWeight={600}>#{ri + 1}</text>
        ))}
        {/* Pre-compute staggered label Y positions to avoid overlap */}
        {(() => {
          // Group products by their last-month rank
          const lastRankGroups = new Map<number, number[]>()
          series.forEach((_, si) => {
            const lr = ranks[si][N - 1]
            if (!lastRankGroups.has(lr)) lastRankGroups.set(lr, [])
            lastRankGroups.get(lr)!.push(si)
          })
          const labelYOffset: number[] = Array(series.length).fill(0)
          lastRankGroups.forEach((siList) => {
            if (siList.length > 1) {
              const total = siList.length
              siList.forEach((si, i) => {
                labelYOffset[si] = (i - (total - 1) / 2) * 13
              })
            }
          })
          return null
        })()}
        {/* Lines + dots per product */}
        {series.map((s, si) => {
          const r = ranks[si]
          const isHov = hovProduct === s.label
          // Stagger label Y when multiple share same last rank
          const sameRankIdxs = series.map((_, i) => i).filter(i => ranks[i][N - 1] === r[N - 1])
          const lastRankIdx = sameRankIdxs.indexOf(si)
          const labelYOff = sameRankIdxs.length > 1 ? (lastRankIdx - (sameRankIdxs.length - 1) / 2) * 13 : 0
          // Build smooth path through all months
          let d = `M ${xPos(0).toFixed(1)} ${yPos(r[0]).toFixed(1)}`
          for (let mi = 1; mi < N; mi++) {
            d += ' ' + bezier(xPos(mi - 1), yPos(r[mi - 1]), xPos(mi), yPos(r[mi]))
          }
          return (
            <g key={s.label} style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHovProduct(s.label)}
              onMouseLeave={() => setHovProduct(null)}>
              <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
              <path d={d} fill="none" stroke={s.color}
                strokeWidth={isHov ? 1.5 : anyHov ? 0.8 : 1.2}
                strokeLinecap="round" strokeLinejoin="round"
                opacity={anyHov && !isHov ? 0.12 : isHov ? 1 : 0.75}
                style={{ transition: 'opacity 150ms, stroke-width 150ms',
                  filter: isHov ? `drop-shadow(0 0 5px ${s.color}88)` : 'none' }}
              />
              {/* Dots */}
              {r.map((rank, mi) => {
                const val = s.data[mi] || 0
                const noData = val === 0
                return (
                  <g key={mi}>
                    <circle cx={xPos(mi)} cy={yPos(rank)} r={isHov ? 4 : 2.5}
                      fill={noData ? 'rgba(13,17,23,0.9)' : s.color}
                      stroke={s.color}
                      strokeWidth={noData ? (isHov ? 1.5 : 1) : 0}
                      strokeDasharray={noData ? '2 2' : 'none'}
                      opacity={anyHov && !isHov ? 0.12 : noData ? 0.5 : 1}
                      style={{ transition: 'r 120ms' }}
                    />
                    {isHov && (
                      <text x={xPos(mi)} y={yPos(rank) - 9} textAnchor="middle"
                        fontSize={8} fill={noData ? '#6b7280' : s.color} fontWeight={700}
                        style={{ paintOrder: 'stroke', stroke: 'rgba(13,17,23,0.95)', strokeWidth: 2 }}>
                        {noData ? '0 / NO DATA' : val}
                      </text>
                    )}
                  </g>
                )
              })}
              {/* Right label — staggered to avoid overlap */}
              <text x={xPos(N - 1) + 14} y={yPos(r[N - 1]) + 4 + labelYOff}
                fontSize={isHov ? 11 : 10}
                fontWeight={isHov ? 700 : 500}
                fill={isHov ? '#fff' : anyHov ? '#2d3748' : s.color}
                style={{ transition: 'fill 150ms' }}>
                {s.label.length > 18 ? s.label.slice(0, 17) + '…' : s.label}
              </text>
            </g>
          )
        })}
      </svg>
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', fontSize: 9, color: '#4b5563', marginTop: 4 }}>
        <span>Rank #1 = most mentions · hover to see counts</span>
        <span>○ dashed dot = 0 / NO DATA that month</span>
        <span>{numProducts} paddles tracked</span>
      </div>
    </div>
  )
}