'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { LineChart, fmt, type LineSeries } from '@/components/v2/charts'
import {
  PageHead,
  LoadingPage,
  SectionInfo,
  SortTh,
  useSortTable,
  pgColor,
  pgName,
} from '@/components/v2/PageShell'
import type { V2Brand } from '@/lib/v2/data'

// ─── Supabase client (browser, anon key) ─────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
)

// ─── Types ───────────────────────────────────────────────────────────────
interface Brand {
  id: string
  slug: string
  name: string
}

interface ProductCatalog {
  id: string
  brand_id: string
  display_name: string
  sku: string | null
  category: string | null
}

interface AttentionDaily {
  product_id: string
  brand_id: string
  date: string
  mention_count: number
  weighted_score: number
  avg_sentiment: number | null
}

interface AttentionSummary {
  product_id: string
  brand_id: string
  period: string
  total_mentions: number
  weighted_total: number
  avg_sentiment: number | null
  gap_to_top_competitor: number | null
  rank_in_category: number | null
}

// ─── Fallback palette for products whose brand color we don't know ──────
const FALLBACK_PALETTE: string[] = [
  '#22c55e', '#F5E625', '#06b6d4', '#ec4899', '#a855f7',
  '#f59e0b', '#818cf8', '#ef4444', '#14b8a6', '#60a5fa',
]

const MONTH_LABEL: string[] = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

const CARD_STYLE = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  padding: 20,
} as const

const EMPTY_STATE_STYLE = {
  textAlign: 'center' as const,
  padding: '48px 24px',
  color: '#6b7280',
}

// ─── Helpers ─────────────────────────────────────────────────────────────
function lastNMonths(n: number, now: Date = new Date()): string[] {
  const result: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    result.push(`${yyyy}-${mm}`)
  }
  return result
}

function monthShortLabel(ym: string): string {
  const [, m] = ym.split('-')
  const idx = Math.max(0, Math.min(11, Number(m) - 1))
  return MONTH_LABEL[idx]
}

function brandV2List(brands: Brand[]): V2Brand[] {
  return brands.map((b) => ({
    id: b.slug,
    brand_id: b.id,
    name: b.name,
    color: pgColor(b.slug),
  }))
}

// ─── Page ────────────────────────────────────────────────────────────────
export default function ProductsIntelPage() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [products, setProducts] = useState<ProductCatalog[]>([])
  const [daily, setDaily] = useState<AttentionDaily[]>([])
  const [summary, setSummary] = useState<AttentionSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = 'JOOLA INTEL — Product Intelligence'
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [bRes, pRes, dRes, sRes] = await Promise.all([
          supabase.from('brands').select('id,slug,name').order('name'),
          supabase.from('products_catalog').select('id,brand_id,display_name,sku,category'),
          supabase
            .from('product_attention_daily')
            .select('product_id,brand_id,date,mention_count,weighted_score,avg_sentiment')
            .order('date', { ascending: false })
            .limit(10000),
          supabase
            .from('product_attention_summary')
            .select('product_id,brand_id,period,total_mentions,weighted_total,avg_sentiment,gap_to_top_competitor,rank_in_category')
            .limit(1000),
        ])
        if (cancelled) return
        setBrands((bRes.data as Brand[] | null) || [])
        setProducts((pRes.data as ProductCatalog[] | null) || [])
        setDaily((dRes.data as AttentionDaily[] | null) || [])
        setSummary((sRes.data as AttentionSummary[] | null) || [])
      } catch {
        // Keep empty arrays — empty-state UI handles the rest.
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // ─── Brand maps ────────────────────────────────────────────────────────
  const brandsById = useMemo(() => {
    const m: Record<string, Brand> = {}
    brands.forEach((b) => { m[b.id] = b })
    return m
  }, [brands])

  const v2Brands = useMemo(() => brandV2List(brands), [brands])

  const productsById = useMemo(() => {
    const m: Record<string, ProductCatalog> = {}
    products.forEach((p) => { m[p.id] = p })
    return m
  }, [products])

  function brandSlugForProduct(productId: string): string {
    const p = productsById[productId]
    if (!p) return 'unknown'
    return brandsById[p.brand_id]?.slug || 'unknown'
  }

  function productLabel(productId: string): string {
    return productsById[productId]?.display_name || '— unknown product —'
  }

  function brandLabel(brandId: string): string {
    const slug = brandsById[brandId]?.slug
    if (!slug) return '—'
    return pgName(slug, v2Brands)
  }

  function brandColor(brandId: string): string {
    const slug = brandsById[brandId]?.slug
    return slug ? pgColor(slug) : '#888'
  }

  // ─── Section 1: MoM trend lines ────────────────────────────────────────
  const months = useMemo(() => lastNMonths(6), [])
  const monthLabels = useMemo(() => months.map(monthShortLabel), [months])

  const topProductSeries = useMemo<LineSeries[]>(() => {
    if (!daily.length) return []
    // group by product_id × month → mention_count
    const grid: Record<string, Record<string, number>> = {}
    const totals: Record<string, number> = {}
    for (const row of daily) {
      const ym = (row.date || '').slice(0, 7)
      if (!months.includes(ym)) continue
      if (!grid[row.product_id]) grid[row.product_id] = {}
      const prev = grid[row.product_id][ym] || 0
      const next = prev + (row.mention_count || 0)
      grid[row.product_id][ym] = next
      totals[row.product_id] = (totals[row.product_id] || 0) + (row.mention_count || 0)
    }
    const top = Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pid]) => pid)
    return top.map((pid, i) => {
      const data = months.map((ym) => grid[pid]?.[ym] || 0)
      const slug = brandSlugForProduct(pid)
      const color = slug !== 'unknown' ? pgColor(slug) : FALLBACK_PALETTE[i % FALLBACK_PALETTE.length]
      return {
        id: pid,
        label: productLabel(pid),
        color,
        data,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily, months, productsById, brandsById])

  // ─── Section 2: Momentum leaderboards (need last_30d summary slice) ────
  const last30 = useMemo(
    () => summary.filter((s) => s.period === 'last_30d'),
    [summary],
  )
  const allTime = useMemo(
    () => summary.filter((s) => s.period === 'all_time'),
    [summary],
  )

  const topRising = useMemo(() => {
    const allTimeMap: Record<string, AttentionSummary> = {}
    allTime.forEach((s) => { allTimeMap[s.product_id] = s })
    return [...last30]
      .map((s) => {
        const at = allTimeMap[s.product_id]
        // crude "rising" proxy: share of total mentions captured in last 30d
        const pct = at && at.total_mentions > 0
          ? Math.round((s.total_mentions / at.total_mentions) * 100)
          : null
        return { ...s, risePct: pct }
      })
      .sort((a, b) => b.total_mentions - a.total_mentions)
      .slice(0, 10)
  }, [last30, allTime])

  const topByGap = useMemo(() => {
    return [...last30]
      .filter((s) => s.gap_to_top_competitor !== null)
      .sort((a, b) => (b.gap_to_top_competitor || 0) - (a.gap_to_top_competitor || 0))
      .slice(0, 10)
  }, [last30])

  // ─── Section 3: Cross-brand comparison matrix ──────────────────────────
  interface MatrixRow extends Record<string, unknown> {
    productId: string
    productName: string
    brand: string
    brandId: string
    last7d: number
    last30d: number
    last90d: number
    allTime: number
    isJoola: boolean
  }

  const matrixRows = useMemo<MatrixRow[]>(() => {
    if (!summary.length) return []
    const byProduct: Record<string, Record<string, AttentionSummary>> = {}
    summary.forEach((s) => {
      if (!byProduct[s.product_id]) byProduct[s.product_id] = {}
      byProduct[s.product_id][s.period] = s
    })
    const rows = Object.entries(byProduct).map(([pid, m]): MatrixRow => {
      const anySummary = m.all_time || m.last_90d || m.last_30d || m.last_7d
      const brandId = anySummary?.brand_id || ''
      const slug = brandsById[brandId]?.slug || ''
      return {
        productId: pid,
        productName: productLabel(pid),
        brand: brandLabel(brandId),
        brandId,
        last7d: m.last_7d?.total_mentions || 0,
        last30d: m.last_30d?.total_mentions || 0,
        last90d: m.last_90d?.total_mentions || 0,
        allTime: m.all_time?.total_mentions || 0,
        isJoola: slug === 'joola',
      }
    })
    return rows
      .sort((a, b) => b.allTime - a.allTime)
      .slice(0, 20)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, brandsById, productsById])

  const { sorted: sortedMatrix, sortKey, sortDir, toggle } = useSortTable<MatrixRow>(matrixRows)

  // ─── Section 4: JOOLA product cards ────────────────────────────────────
  const joolaBrand = brands.find((b) => b.slug === 'joola')
  const joolaProducts = useMemo(
    () => (joolaBrand ? products.filter((p) => p.brand_id === joolaBrand.id) : []),
    [products, joolaBrand],
  )

  const summaryByProductPeriod = useMemo(() => {
    const m: Record<string, Record<string, AttentionSummary>> = {}
    summary.forEach((s) => {
      if (!m[s.product_id]) m[s.product_id] = {}
      m[s.product_id][s.period] = s
    })
    return m
  }, [summary])

  // ─── Render ────────────────────────────────────────────────────────────
  if (loading) return <LoadingPage />

  const hasDaily = daily.length > 0
  const hasSummary = summary.length > 0
  const totalBrands = brands.length

  return (
    <>
      <PageHead
        eyebrow="PRODUCT INTELLIGENCE · PADDLE MOMENTUM · MoM TRENDS"
        title="Paddle Trends"
        accent="& Momentum"
        sub={`Top products across all ${totalBrands || '—'} brands — month-on-month attention from community, comments, and search signals.`}
      />

      {/* ── Section 1: MoM trend lines ────────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Month-on-month attention · top 10 products
              <SectionInfo
                title="Product Attention Trend"
                description="One line per product, summed across every tracked channel (Instagram, YouTube, Reddit, TikTok, X). The top 10 products by all-time mention count are plotted over the last six months. Hover the chart to read exact values; hover a line to highlight a single product."
                source="product_attention_daily · aggregated weekly by the AI enrichment pipeline"
              />
            </h2>
            <div className="sub">Whose paddles are gaining mindshare — and whose are fading.</div>
          </div>
        </div>
        {hasDaily && topProductSeries.length > 0 ? (
          <div className="card">
            <div className="card-pad">
              <LineChart
                series={topProductSeries}
                xLabels={monthLabels}
                h={320}
                yLabel="Mentions"
              />
            </div>
          </div>
        ) : (
          <div className="card" style={EMPTY_STATE_STYLE}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
            <div style={{ fontSize: 14 }}>
              Product attention trends will appear after the weekly pipeline completes.
            </div>
            <div style={{ fontSize: 12, marginTop: 8, opacity: 0.6 }}>
              Data populates automatically — check back after next Monday 07:00 IST run.
            </div>
          </div>
        )}
      </section>

      {/* ── Section 2: Momentum leaderboards ──────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Momentum leaderboards · who&apos;s up, who&apos;s trailing
              <SectionInfo
                title="Rising vs Gap"
                description="Left: products with the highest mention count in the last 30 days. Right: products with the largest positive gap to their top in-category competitor — a higher gap means category leadership. JOOLA rows are highlighted in green; trailing JOOLA products show an amber warning."
                source="product_attention_summary · period = last_30d"
              />
            </h2>
            <div className="sub">Two angles: raw momentum and competitive positioning.</div>
          </div>
        </div>
        <div className="two-col-even">
          <div className="card">
            <div className="card-head" style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: '#fff', margin: 0, letterSpacing: '0.04em' }}>
                Top 10 rising · last 30d
              </h3>
              <span className="meta" style={{ fontSize: 11, color: '#6b7280' }}>by mention volume</span>
            </div>
            <div>
              {topRising.length === 0 && (
                <div style={{ ...EMPTY_STATE_STYLE, padding: '32px 8px' }}>
                  <div style={{ fontSize: 13 }}>No 30-day window data yet.</div>
                </div>
              )}
              {topRising.map((s, i) => (
                <div
                  key={s.product_id}
                  className="leaderboard-row"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '28px 1fr auto auto',
                    gap: 10,
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderRadius: 8,
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <div style={{ color: '#6b7280', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>#{i + 1}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: '#e6e8ec', fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {productLabel(s.product_id)}
                    </div>
                    <div style={{ fontSize: 10.5, color: brandColor(s.brand_id), fontWeight: 700, letterSpacing: '0.02em' }}>
                      {brandLabel(s.brand_id)}
                    </div>
                  </div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#cbd1dc', fontWeight: 600 }}>
                    {fmt(s.total_mentions)}
                  </div>
                  <div>
                    {s.risePct !== null && s.risePct >= 0 && (
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 99,
                          fontSize: 10,
                          fontWeight: 800,
                          background: 'rgba(34,197,94,0.18)',
                          color: '#22c55e',
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                        title="Share of all-time mentions captured in last 30d"
                      >
                        ▲ {s.risePct}%
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head" style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: '#fff', margin: 0, letterSpacing: '0.04em' }}>
                Top 10 by gap to competitor
              </h3>
              <span className="meta" style={{ fontSize: 11, color: '#6b7280' }}>category leaders</span>
            </div>
            <div>
              {topByGap.length === 0 && (
                <div style={{ ...EMPTY_STATE_STYLE, padding: '32px 8px' }}>
                  <div style={{ fontSize: 13 }}>Gap analysis pending — needs ≥2 products per category.</div>
                </div>
              )}
              {topByGap.map((s, i) => {
                const gap = s.gap_to_top_competitor || 0
                const isJoola = brandsById[s.brand_id]?.slug === 'joola'
                const trailing = isJoola && gap < 0
                return (
                  <div
                    key={s.product_id}
                    className="leaderboard-row"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '28px 1fr auto',
                      gap: 10,
                      alignItems: 'center',
                      padding: '8px 12px',
                      borderRadius: 8,
                      transition: 'background 0.15s',
                      borderLeft: isJoola ? '2px solid #22c55e' : '2px solid transparent',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <div style={{ color: '#6b7280', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>#{i + 1}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontWeight: 600,
                        color: isJoola ? '#22c55e' : '#e6e8ec',
                        fontSize: 12.5,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {productLabel(s.product_id)}
                      </div>
                      <div style={{ fontSize: 10.5, color: brandColor(s.brand_id), fontWeight: 700, letterSpacing: '0.02em' }}>
                        {brandLabel(s.brand_id)}
                      </div>
                    </div>
                    <div
                      style={{
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: 12,
                        fontWeight: 700,
                        color: trailing ? '#f59e0b' : gap >= 0 ? '#22c55e' : '#ef4444',
                      }}
                      title="gap_to_top_competitor: positive = leading, negative = trailing"
                    >
                      {gap >= 0 ? '+' : ''}{fmt(gap)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 3: Cross-brand comparison matrix ──────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Cross-brand product matrix · top 20
              <SectionInfo
                title="Side-by-Side Comparison"
                description="Top 20 products by all-time mention count, with their 7-day, 30-day, and 90-day attention figures lined up. Click any column header to sort. JOOLA rows carry a green left border so you can spot them quickly inside a sorted view."
                source="product_attention_summary · all four periods joined on product_id"
              />
            </h2>
            <div className="sub">Every period for every leading product, one scroll.</div>
          </div>
        </div>
        <div className="card" style={{ padding: 0 }}>
          {sortedMatrix.length === 0 ? (
            <div style={EMPTY_STATE_STYLE}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 14 }}>No summary rows yet — matrix populates after first pipeline run.</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data" style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <SortTh col="productName" label="Product" sortKey={sortKey as string | null} sortDir={sortDir} toggle={(k) => toggle(k as keyof MatrixRow)} style={{ textAlign: 'left' }} />
                    <SortTh col="brand" label="Brand" sortKey={sortKey as string | null} sortDir={sortDir} toggle={(k) => toggle(k as keyof MatrixRow)} style={{ textAlign: 'left' }} />
                    <SortTh col="last7d" label="Last 7d" sortKey={sortKey as string | null} sortDir={sortDir} toggle={(k) => toggle(k as keyof MatrixRow)} style={{ textAlign: 'right' }} />
                    <SortTh col="last30d" label="Last 30d" sortKey={sortKey as string | null} sortDir={sortDir} toggle={(k) => toggle(k as keyof MatrixRow)} style={{ textAlign: 'right' }} />
                    <SortTh col="last90d" label="Last 90d" sortKey={sortKey as string | null} sortDir={sortDir} toggle={(k) => toggle(k as keyof MatrixRow)} style={{ textAlign: 'right' }} />
                    <SortTh col="allTime" label="All Time" sortKey={sortKey as string | null} sortDir={sortDir} toggle={(k) => toggle(k as keyof MatrixRow)} style={{ textAlign: 'right' }} />
                    <th style={{ textAlign: 'center', padding: '10px 8px', fontSize: 11, color: '#6b7280', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedMatrix.map((row) => {
                    const trendDir = row.last30d > row.last90d / 3 ? 'up' : row.last30d < row.last90d / 3 ? 'down' : 'flat'
                    const trendChar = trendDir === 'up' ? '▲' : trendDir === 'down' ? '▼' : '▬'
                    const trendColor = trendDir === 'up' ? '#22c55e' : trendDir === 'down' ? '#ef4444' : '#6b7280'
                    return (
                      <tr
                        key={row.productId}
                        style={{
                          borderLeft: row.isJoola ? '2px solid #22c55e' : '2px solid transparent',
                        }}
                      >
                        <td style={{ padding: '10px 12px', color: row.isJoola ? '#22c55e' : '#e6e8ec', fontWeight: 600, fontSize: 12.5 }}>
                          {row.productName}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 11.5, color: brandColor(row.brandId), fontWeight: 700 }}>
                          {row.brand}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#cbd1dc' }}>
                          {row.last7d > 0 ? fmt(row.last7d) : '—'}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#cbd1dc' }}>
                          {row.last30d > 0 ? fmt(row.last30d) : '—'}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#cbd1dc' }}>
                          {row.last90d > 0 ? fmt(row.last90d) : '—'}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5, color: '#fff', fontWeight: 700 }}>
                          {row.allTime > 0 ? fmt(row.allTime) : '—'}
                        </td>
                        <td style={{ padding: '10px 8px', textAlign: 'center', color: trendColor, fontSize: 13, fontWeight: 800 }}>
                          {trendChar}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ── Section 4: JOOLA product cards ────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              JOOLA paddle line · current attention
              <SectionInfo
                title="JOOLA Product Health"
                description="Every JOOLA paddle in the catalog with its 7-day, 30-day, and 90-day mention count and its competitive gap. Positive gap (green) means JOOLA leads the category; negative (amber) means a competitor's paddle is winning attention right now."
                source="product_attention_summary filtered to brand_id = JOOLA"
              />
            </h2>
            <div className="sub">
              {joolaProducts.length} JOOLA {joolaProducts.length === 1 ? 'paddle' : 'paddles'} in the catalog.
            </div>
          </div>
        </div>
        {joolaProducts.length === 0 ? (
          <div className="card" style={EMPTY_STATE_STYLE}>
            <div style={{ fontSize: 14 }}>No JOOLA products in the catalog yet.</div>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 12,
          }}>
            {joolaProducts.map((p) => {
              const periods = summaryByProductPeriod[p.id] || {}
              const last7 = periods.last_7d?.total_mentions
              const last30 = periods.last_30d?.total_mentions
              const last90 = periods.last_90d?.total_mentions
              const gap = periods.last_30d?.gap_to_top_competitor
              const gapColor = gap === null || gap === undefined
                ? '#6b7280'
                : gap >= 0 ? '#22c55e' : '#f59e0b'
              return (
                <div
                  key={p.id}
                  style={{
                    ...CARD_STYLE,
                    borderLeft: '2px solid #22c55e',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: '#fff', lineHeight: 1.3 }}>
                      {p.display_name}
                    </div>
                    {p.category && (
                      <span
                        style={{
                          display: 'inline-block',
                          marginTop: 6,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.08)',
                          fontSize: 10,
                          color: '#6b7280',
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                        }}
                      >
                        {p.category}
                      </span>
                    )}
                  </div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 6,
                    paddingTop: 8,
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    {[
                      { label: '7d', v: last7 },
                      { label: '30d', v: last30 },
                      { label: '90d', v: last90 },
                    ].map((cell) => (
                      <div key={cell.label}>
                        <div style={{ fontSize: 9, color: '#6b7280', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                          {cell.label}
                        </div>
                        <div style={{
                          fontFamily: 'JetBrains Mono, monospace',
                          fontSize: 14,
                          fontWeight: 700,
                          color: cell.v && cell.v > 0 ? '#fff' : '#6b7280',
                        }}>
                          {cell.v && cell.v > 0 ? fmt(cell.v) : '—'}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingTop: 6,
                    fontSize: 11,
                  }}>
                    <span style={{ color: '#6b7280', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      Gap vs leader
                    </span>
                    <span
                      style={{
                        fontFamily: 'JetBrains Mono, monospace',
                        fontWeight: 800,
                        color: gapColor,
                        fontSize: 12.5,
                      }}
                      title="gap_to_top_competitor (last_30d): positive = leading, negative = trailing"
                    >
                      {gap === null || gap === undefined ? '—' : (gap >= 0 ? '+' : '') + fmt(gap)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {!hasSummary && !hasDaily && (
        <section>
          <div className="card" style={{ ...EMPTY_STATE_STYLE, marginTop: 8 }}>
            <div style={{ fontSize: 13 }}>
              Both attention tables are empty. The product intelligence pipeline has not produced data yet —
              the page is wired and will populate automatically once the next pipeline run completes.
            </div>
          </div>
        </section>
      )}
    </>
  )
}
