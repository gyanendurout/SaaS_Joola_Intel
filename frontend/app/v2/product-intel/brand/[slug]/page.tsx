'use client'

import { Fragment, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  PageHead, LoadingPage, MiniKpi, SectionInfo, SortTh,
  pgColor, pgName,
} from '@/components/v2/PageShell'
import { fmt, Sparkline } from '@/components/v2/charts'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import { Breadcrumb } from '@/components/v2/Breadcrumb'
import {
  fetchProductIntel,
  type RawCatalogProduct,
  type CuratedProduct,
  type AttentionSummaryRow,
  type PriceStat,
  type PriceTierStat,
  type ProductMatchResult,
  type ProductIntelData,
} from '@/lib/v2/productIntel'
import type { LeaderboardRow } from '@/components/v2/charts/LeaderboardTable'
import { ProductDetailModal } from '@/components/v2/product-detail/ProductDetailModal'

const BRAND_STORE_URLS: Record<string, string> = {
  joola:      'https://joola.com/collections/pickleball-paddles',
  selkirk:    'https://www.selkirk.com/collections/paddles',
  paddletek:  'https://www.paddletek.com/collections/paddles',
  crbn:       'https://www.crbnpickleball.com/collections/paddles',
  'six-zero': 'https://www.sixzeropickleball.com/collections/paddles',
  engage:     'https://engagepickleball.com/collections/paddles',
  onix:       'https://www.onixpickleball.com/collections/paddles',
  franklin:   'https://www.franklinsports.com/pickleball/paddles',
  head:       'https://www.head.com/en_US/pickleball/paddles/',
  wilson:     'https://www.wilson.com/en-us/collection/pickleball/paddles',
  gamma:      'https://gammasports.com/pickleball/paddles/',
}

const emptyCell: { textAlign: 'center'; padding: string; color: string; fontSize: number } = { textAlign: 'center', padding: '32px 0', color: 'var(--fg-4)', fontSize: 13 }

export default function BrandProductPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const brandSlug = decodeURIComponent(slug)

  const [brands, setBrands] = useState<V2Brand[]>([])
  const [products, setProducts] = useState<RawCatalogProduct[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([])
  const [summary, setSummary] = useState<AttentionSummaryRow[]>([])
  const [curated, setCurated] = useState<CuratedProduct[]>([])
  const [priceStat, setPriceStat] = useState<PriceStat | null>(null)
  const [priceTier, setPriceTier] = useState<PriceTierStat | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [matrixSort, setMatrixSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'last30d', dir: 'desc' })
  const [attSort, setAttSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'attention', dir: 'desc' })
  const [prodSort, setProdSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'price_usd', dir: 'desc' })
  const [tierHov, setTierHov] = useState<string | null>(null)
  const [productMatches, setProductMatches] = useState<ProductMatchResult | null>(null)
  const [intel, setIntel] = useState<ProductIntelData | null>(null)
  const [drillProduct, setDrillProduct] = useState<{ brand: string; productId: string } | null>(null)

  useEffect(() => {
    if (!brandSlug) return
    document.title = `${brandSlug} — Product Intel`
    ;(async () => {
      try {
        const b = await fetchBrands()
        setBrands(b)
        const d = await fetchProductIntel(b)
        setIntel(d)
        const bId = b.find(x => x.id === brandSlug)?.brand_id || ''
        setProducts(d.catalogProducts.filter(p => p.brand_id === bId))
        setLeaderboard(d.leaderboardRows.filter(r => r.brand === brandSlug))
        setSummary(d.attentionSummary.filter(s => s.brand_id === bId))
        setCurated(d.curatedProducts)
        setProductMatches(d.productMatches)
        setPriceStat(d.priceStatsByBrand.find(s => s.brand === brandSlug) || null)
        setPriceTier(d.priceTierStatsByBrand.find(s => s.brand === brandSlug) || null)
      } finally { setLoading(false) }
    })()
  }, [brandSlug])

  if (loading) return <LoadingPage />

  const brandColor = pgColor(brandSlug)
  const brandName = pgName(brandSlug, brands)
  const isJoola = brandSlug === 'joola'
  const storeUrl = BRAND_STORE_URLS[brandSlug] || null
  const norm = (v: number) => v > 1000 ? +(v / 1000).toFixed(2) : v

  // Derived KPI values
  const inStock = products.filter(p => p.in_stock !== false).length
  const outOfStock = products.length - inStock
  const avgPrice = priceStat ? norm(priceStat.avg) : 0
  const totalMentions = leaderboard.reduce((s, r) => s + r.mentions, 0)
  const topProduct = [...leaderboard].sort((a, b) => b.attention - a.attention)[0]
  const categories = Array.from(new Set(products.map(p => p.category).filter(Boolean)))

  // Product name lookup (curated ID → display name)
  const productName = (pid: string) => curated.find(c => c.id === pid)?.display_name || pid.slice(0, 12) + '…'

  // Build period map: product_id → { last_7d, last_30d, last_90d, all_time }
  const periodMap: Record<string, Record<string, AttentionSummaryRow>> = {}
  summary.forEach(s => {
    if (!periodMap[s.product_id]) periodMap[s.product_id] = {}
    periodMap[s.product_id][s.period] = s
  })

  // Matrix rows for this brand
  const matrixRows = Object.entries(periodMap).map(([pid, m]) => ({
    pid,
    name: productName(pid),
    last7d:  m.last_7d?.total_mentions  ?? 0,
    last30d: m.last_30d?.total_mentions ?? 0,
    last90d: m.last_90d?.total_mentions ?? 0,
    allTime: m.all_time?.total_mentions ?? 0,
    gap:     m.last_30d?.gap_to_top_competitor ?? null,
    salesLikelihood: m.last_30d?.avg_sentiment ?? null,
  })).filter(r => r.last30d > 0 || r.last90d > 0 || r.allTime > 0)

  // Sorted matrix
  const sortedMatrix = [...matrixRows].sort((a, b) => {
    const av = ((a as unknown as Record<string, number>)[matrixSort.key]) ?? 0
    const bv = ((b as unknown as Record<string, number>)[matrixSort.key]) ?? 0
    return matrixSort.dir === 'desc' ? bv - av : av - bv
  })

  // Momentum: top 30D rising products
  const last30Summary = summary.filter(s => s.period === 'last_30d')
  const allTimeSummary = summary.filter(s => s.period === 'all_time')
  const allTimeMap: Record<string, AttentionSummaryRow> = {}
  allTimeSummary.forEach(s => { allTimeMap[s.product_id] = s })

  const topRising = [...last30Summary]
    .map(s => {
      const at = allTimeMap[s.product_id]
      const pct = at && at.total_mentions > 0 ? Math.round((s.total_mentions / at.total_mentions) * 100) : null
      return { ...s, name: productName(s.product_id), risePct: pct }
    })
    .filter(s => s.total_mentions > 0)
    .sort((a, b) => b.total_mentions - a.total_mentions)
    .slice(0, 10)

  const topByGap = [...last30Summary]
    .filter(s => s.gap_to_top_competitor != null)
    .map(s => ({ ...s, name: productName(s.product_id) }))
    .sort((a, b) => (b.gap_to_top_competitor ?? 0) - (a.gap_to_top_competitor ?? 0))
    .slice(0, 10)

  // Sorted leaderboard
  const sortedLeaderboard = [...leaderboard].sort((a, b) => {
    const av = ((a as unknown as Record<string, number>)[attSort.key]) ?? 0
    const bv = ((b as unknown as Record<string, number>)[attSort.key]) ?? 0
    return attSort.dir === 'desc' ? bv - av : av - bv
  })

  // Filtered + sorted products
  const filteredProducts = products
    .filter(p => !search || (p.name || '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (prodSort.key === 'price_usd') {
        const av = a.price_usd ? norm(Number(a.price_usd)) : 0
        const bv = b.price_usd ? norm(Number(b.price_usd)) : 0
        return prodSort.dir === 'desc' ? bv - av : av - bv
      }
      return prodSort.dir === 'desc'
        ? (b.name || '').localeCompare(a.name || '')
        : (a.name || '').localeCompare(b.name || '')
    })

  const toggle = (_s: unknown, set: (fn: (prev: {key:string;dir:'asc'|'desc'}) => {key:string;dir:'asc'|'desc'}) => void) => (k: string) => {
    set(prev => ({ key: k, dir: prev.key === k ? (prev.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))
  }

  return (
    <>
      {drillProduct && intel && (
        <ProductDetailModal
          brand={drillProduct.brand}
          productId={drillProduct.productId}
          intel={intel}
          brands={brands}
          onClose={() => setDrillProduct(null)}
        />
      )}
      <Breadcrumb crumbs={[
        { label: 'Product Intel', href: '/v2/product-intel' },
        { label: brandName },
      ]} />
      <PageHead
        eyebrow="Product Intel"
        title={brandName}
        sub={`${products.length} catalogue products · ${leaderboard.length} with community attention data`}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {storeUrl && (
              <a href={storeUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ fontSize: 12 }}>
                Visit Store ↗
              </a>
            )}
            <button onClick={() => router.back()} className="btn btn-ghost" style={{ fontSize: 12 }}>← Back</button>
          </div>
        }
      />

      {/* ─── KPI strip ─────────────────────────────────────────────── */}
      <section>
        <div className="kpi-grid">
          <MiniKpi
            label="Total products"
            value={String(products.length)}
            color={brandColor}
            tip={`Total number of products in ${brandName}'s scraped catalogue.`}
            src="products_catalog"
          />
          <MiniKpi
            label="In stock"
            value={String(inStock)}
            color="#22c55e"
            customVs={outOfStock > 0 ? `${outOfStock} out of stock` : 'all in stock'}
            tip="Products currently marked as available. Out-of-stock items are still in the catalogue but unavailable to buy."
            src="products_catalog.in_stock"
          />
          <MiniKpi
            label="Avg price"
            value={avgPrice > 0 ? `$${avgPrice.toFixed(0)}` : '—'}
            color="#60a5fa"
            customVs={priceStat ? `$${norm(priceStat.min).toFixed(0)} – $${norm(priceStat.max).toFixed(0)} range` : ''}
            tip="Average retail price across all products in the catalogue. Range shows cheapest to most expensive."
            src="products_catalog.price_usd"
          />
          <MiniKpi
            label="Community mentions"
            value={fmt(totalMentions)}
            color="#F5E625"
            customVs={`${leaderboard.length} products tracked`}
            tip="Total community mentions (posts, comments, forum threads) referencing this brand's products across all channels in the active date window."
            src="product_attention_daily"
          />
          <MiniKpi
            label="Top product"
            value={topProduct?.product || '—'}
            color={isJoola ? '#22c55e' : brandColor}
            customVs={topProduct ? `${topProduct.attention.toFixed(1)} attention score` : ''}
            tip="Product with the highest rolling 7-day attention score — a composite of mentions, engagement, and estimated sales signals."
            src="product_attention_daily"
          />
        </div>
        {categories.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {categories.map(c => (
              <span key={c} className="pill pill-ghost" style={{ fontSize: 11 }}>{c}</span>
            ))}
          </div>
        )}
      </section>

      {/* ─── Product Attention Leaderboard ─────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Product attention leaderboard
              <SectionInfo
                title="Product Attention Leaderboard"
                description="Products ranked by rolling 7-day attention score — a composite of community mentions, engagement weight, and estimated unit sell-through signals. Higher score = more fan conversation and purchase intent around that product right now."
                source="product_attention_daily · 28-day window"
              />
            </h2>
            <div className="sub">{leaderboard.length} {brandName} products with community attention data in the active window.</div>
          </div>
        </div>
        {leaderboard.length === 0 ? (
          <div className="card"><div style={emptyCell}>No attention data for {brandName} products in the current date window. Try expanding the date range.</div></div>
        ) : (
          <div className="card">
            <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
              <table className="data" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>#</th>
                    <SortTh col="product"   label="Product"    sortKey={attSort.key} sortDir={attSort.dir} toggle={toggle(attSort, setAttSort)} style={{ textAlign: 'left' }}   title="Product name" />
                    <SortTh col="attention" label="Attention"  sortKey={attSort.key} sortDir={attSort.dir} toggle={toggle(attSort, setAttSort)} style={{ textAlign: 'right' }}  title="7-day rolling attention score — composite of mentions, engagement weight, and estimated sales signals. Higher = more community buzz right now." />
                    <SortTh col="mentions"  label="Mentions"   sortKey={attSort.key} sortDir={attSort.dir} toggle={toggle(attSort, setAttSort)} style={{ textAlign: 'right' }}  title="Total community mentions (posts + comments) for this product in the active date window across all tracked channels." />
                    {leaderboard.some(r => r.estimatedUnitsSold != null) && (
                      <SortTh col="estimatedUnitsSold" label="Est. units" sortKey={attSort.key} sortDir={attSort.dir} toggle={toggle(attSort, setAttSort)} style={{ textAlign: 'right' }} title="AI-estimated units sold based on attention score and historical signal patterns. Directional only — not actual sales data." />
                    )}
                    <th title="28-day rolling mention trend. Rising line = growing momentum.">Trend (28d)</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLeaderboard.map((r, i) => (
                    <tr key={r.product} className={isJoola ? 'joola' : ''}>
                      <td style={{ color: 'var(--fg-4)', fontWeight: 600, fontSize: 11 }}>#{i + 1}</td>
                      <td style={{ fontWeight: 700 }}>{r.product}</td>
                      <td className="cell-num" style={{ textAlign: 'right', color: r.attention > 0 ? '#F5E625' : 'var(--fg-4)', fontWeight: 700 }}>
                        {r.attention > 0 ? r.attention.toFixed(2) : '—'}
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>{r.mentions > 0 ? fmt(r.mentions) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                      {leaderboard.some(x => x.estimatedUnitsSold != null) && (
                        <td className="cell-num" style={{ textAlign: 'right', color: '#22c55e' }}>
                          {r.estimatedUnitsSold != null ? fmt(r.estimatedUnitsSold) : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                        </td>
                      )}
                      <td>
                        {r.sparkline?.length > 1
                          ? <Sparkline data={r.sparkline} color={isJoola ? '#22c55e' : brandColor} />
                          : <span style={{ color: 'var(--fg-4)', fontSize: 11 }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ─── Full Product Catalogue ─────────────────────────────────── */}
      {/* ─── Momentum Leaders ─────────────────────────────────────── */}
      {topRising.length > 0 && (
        <section>
          <div className="section-head">
            <div>
              <h2>
                Momentum leaders · 30-day window
                <SectionInfo
                  title="Momentum Leaders — 30-Day Window"
                  description="Products ranked by total community mentions in the last 30 days. Rise % shows how much of the all-time mention volume happened in just the last 30 days — a high % means a product is spiking right now. Gap shows the mention lead or lag versus the top competitor product in the same category."
                  source="product_attention_summary · last_30d period"
                />
              </h2>
              <div className="sub">Top {topRising.length} {brandName} products by 30-day mention volume</div>
            </div>
          </div>
          <div className="two-col-even">
            {/* Top rising */}
            <div className="card"><div className="card-pad">
              <h6 style={{ marginTop: 0 }}>Top rising · last 30d</h6>
              <table className="data" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>#</th>
                    <th style={{ textAlign: 'left' }} title="Product name">Product</th>
                    <th style={{ textAlign: 'right' }} title="Total community mentions in the last 30 days across all channels">30d mentions</th>
                    <th style={{ textAlign: 'right' }} title="Share of all-time mentions that came in the last 30 days — higher % = currently spiking">Rise %</th>
                  </tr>
                </thead>
                <tbody>
                  {topRising.map((r, i) => (
                    <tr key={r.product_id} className={isJoola ? 'joola' : ''}>
                      <td style={{ color: 'var(--fg-4)', fontWeight: 600, fontSize: 11 }}>#{i + 1}</td>
                      <td style={{ fontWeight: 700, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</td>
                      <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625', fontWeight: 700 }}>{fmt(r.total_mentions)}</td>
                      <td className="cell-num" style={{ textAlign: 'right', color: r.risePct != null && r.risePct > 50 ? '#22c55e' : 'var(--fg-3)' }}>
                        {r.risePct != null ? `▲ ${r.risePct}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div></div>
            {/* Competitive gap */}
            <div className="card"><div className="card-pad">
              <h6 style={{ marginTop: 0 }}>Largest competitive gaps</h6>
              {topByGap.length === 0 ? (
                <div style={emptyCell}>No competitive gap data available.</div>
              ) : (
                <table className="data" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>#</th>
                      <th style={{ textAlign: 'left' }} title="Product name">Product</th>
                      <th style={{ textAlign: 'right' }} title="Mention gap vs top competitor in the same category. Positive = brand leads; negative = brand trails.">Gap vs competitor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topByGap.map((r, i) => {
                      const gap = r.gap_to_top_competitor ?? 0
                      return (
                        <tr key={r.product_id} className={isJoola ? 'joola' : ''}>
                          <td style={{ color: 'var(--fg-4)', fontWeight: 600, fontSize: 11 }}>#{i + 1}</td>
                          <td style={{ fontWeight: 700, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</td>
                          <td className="cell-num" style={{ textAlign: 'right', fontWeight: 700, color: gap > 0 ? '#22c55e' : '#ef4444' }}>
                            {gap > 0 ? '+' : ''}{gap.toFixed(2)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div></div>
          </div>
        </section>
      )}

      {/* ─── Cross-period Product Matrix ──────────────────────────── */}
      {matrixRows.length > 0 && (
        <section>
          <div className="section-head">
            <div>
              <h2>
                Product performance matrix · {matrixRows.length} rows
                <SectionInfo
                  title="Product Performance Matrix"
                  description="Each row is one product. Columns show total community mentions across different time windows — 7D, 30D, 90D, and all-time. Trend shows direction of last-30d vs all-time. Gap is the mention lead/lag vs top competitor in the same category. Click any column header to sort."
                  source="product_attention_summary · all periods"
                />
              </h2>
              <div className="sub">Click column headers to sort · all-time mention data</div>
            </div>
          </div>
          <div className="card">
            <div className="table-wrap" style={{ maxHeight: 440, overflowY: 'auto' }}>
              <table className="data" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <SortTh col="name"    label="Product" sortKey={matrixSort.key} sortDir={matrixSort.dir} toggle={toggle(matrixSort, setMatrixSort)} style={{ textAlign: 'left' }}  title="Product name" />
                    <SortTh col="last7d"  label="7D"      sortKey={matrixSort.key} sortDir={matrixSort.dir} toggle={toggle(matrixSort, setMatrixSort)} style={{ textAlign: 'right' }} title="Total community mentions in the last 7 days" />
                    <SortTh col="last30d" label="30D"      sortKey={matrixSort.key} sortDir={matrixSort.dir} toggle={toggle(matrixSort, setMatrixSort)} style={{ textAlign: 'right' }} title="Total community mentions in the last 30 days" />
                    <SortTh col="last90d" label="90D"      sortKey={matrixSort.key} sortDir={matrixSort.dir} toggle={toggle(matrixSort, setMatrixSort)} style={{ textAlign: 'right' }} title="Total community mentions in the last 90 days" />
                    <SortTh col="allTime" label="All"      sortKey={matrixSort.key} sortDir={matrixSort.dir} toggle={toggle(matrixSort, setMatrixSort)} style={{ textAlign: 'right' }} title="All-time total community mentions since tracking began" />
                    <SortTh col="gap"     label="Gap"      sortKey={matrixSort.key} sortDir={matrixSort.dir} toggle={toggle(matrixSort, setMatrixSort)} style={{ textAlign: 'right' }} title="Mention gap vs top competitor in the same category. Positive = this product leads; negative = it trails." />
                    <th title="30-day vs all-time trend direction" style={{ textAlign: 'center' }}>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedMatrix.map(r => {
                    const trend = r.allTime > 0 ? (r.last30d / r.allTime >= 0.35 ? 'up' : r.last30d / r.allTime >= 0.15 ? 'flat' : 'down') : 'unknown'
                    const trendIcon = trend === 'up' ? '▲' : trend === 'down' ? '▼' : trend === 'flat' ? '▬' : '—'
                    const trendColor = trend === 'up' ? '#22c55e' : trend === 'down' ? '#ef4444' : '#94a3b8'
                    return (
                      <tr key={r.pid} className={isJoola ? 'joola' : ''}>
                        <td style={{ fontWeight: 700, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</td>
                        <td className="cell-num" style={{ textAlign: 'right' }}>{r.last7d > 0 ? r.last7d : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                        <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625', fontWeight: r.last30d > 0 ? 700 : 400 }}>{r.last30d > 0 ? r.last30d : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                        <td className="cell-num" style={{ textAlign: 'right' }}>{r.last90d > 0 ? r.last90d : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                        <td className="cell-num" style={{ textAlign: 'right' }}>{r.allTime > 0 ? r.allTime : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                        <td className="cell-num" style={{ textAlign: 'right', color: r.gap != null ? (r.gap > 0 ? '#22c55e' : '#ef4444') : 'var(--fg-4)', fontWeight: r.gap != null ? 700 : 400 }}>
                          {r.gap != null ? `${r.gap > 0 ? '+' : ''}${r.gap.toFixed(1)}` : 'N/A'}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span title={`30D is ${Math.round((r.last30d / Math.max(1, r.allTime)) * 100)}% of all-time mentions`} style={{ color: trendColor, fontWeight: 700, fontSize: 13, cursor: 'help' }}>{trendIcon}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ─── Product Catalogue ──────────────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Product catalogue
              <SectionInfo
                title="Product Catalogue"
                description="Full list of products scraped from the brand's website. Prices are in USD. In-stock status reflects the most recent weekly scrape — it may lag real-time availability by up to 7 days. Click Product Page to open the live listing."
                source="products_catalog · scraped from brand storefront weekly"
              />
            </h2>
            <div className="sub">
              {filteredProducts.length} of {products.length} products
              {storeUrl && <> · <a href={storeUrl} target="_blank" rel="noopener noreferrer" className="ext-link" style={{ fontSize: 12 }}>Browse full store ↗</a></>}
            </div>
          </div>
          <div className="head-actions">
            <input
              type="text"
              className="col-filter-input"
              placeholder="Search products…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 200 }}
            />
          </div>
        </div>
        <div className="card">
          <div className="table-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
            <table className="data" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <SortTh col="name"      label="Product"   sortKey={prodSort.key} sortDir={prodSort.dir} toggle={toggle(prodSort, setProdSort)} style={{ textAlign: 'left' }}   title="Product name as scraped from the brand storefront." />
                  <th title="Product category (paddle, accessory, apparel, etc.)">Category</th>
                  <th title="Whether this product is currently marked in-stock on the brand website. Updated weekly." style={{ textAlign: 'center' }}>In Stock</th>
                  <SortTh col="price_usd" label="Price"     sortKey={prodSort.key} sortDir={prodSort.dir} toggle={toggle(prodSort, setProdSort)} style={{ textAlign: 'right' }}  title="Retail price in USD. Sale prices are reflected if the scraper detected a promotion." />
                  <th title="Price tier: Value = under $100 · Mid = $100–$199 · Premium = $200+" style={{ textAlign: 'right' }}>Tier</th>
                  <th title="Link to the live product page on the brand website." style={{ textAlign: 'center' }}>Product Page</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.length === 0 && (
                  <tr><td colSpan={6} style={emptyCell}>No products match your search.</td></tr>
                )}
                {filteredProducts.map(p => {
                  const price = p.price_usd != null ? norm(Number(p.price_usd)) : null
                  const tier = price == null ? null : price >= 200 ? 'Premium' : price >= 100 ? 'Mid' : 'Value'
                  const tierColor = tier === 'Premium' ? '#F5E625' : tier === 'Mid' ? '#60a5fa' : '#22c55e'
                  return (
                    <tr key={p.id} className={isJoola ? 'joola' : ''}
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('a')) return
                        const curatedId = productMatches?.catalogToCurated.get(p.id)
                        setDrillProduct({ brand: brandSlug, productId: curatedId || p.name || p.id })
                      }}>
                      <td style={{ fontWeight: 700, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.name || undefined}>
                        {p.name || '—'}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--fg-3)' }}>{p.category || '—'}</td>
                      <td style={{ textAlign: 'center' }}>
                        <span
                          className={'pill ' + (p.in_stock !== false ? 'pill-green' : 'pill-ghost')}
                          style={{ fontSize: 9 }}
                          title={p.in_stock !== false ? 'Available to purchase on brand website' : 'Currently unavailable — may be sold out or discontinued'}
                        >
                          {p.in_stock !== false ? 'IN STOCK' : 'OUT'}
                        </span>
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right', fontWeight: 700, color: price ? 'var(--fg)' : 'var(--fg-4)' }}>
                        {price ? `$${price.toFixed(0)}` : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {tier ? (
                          <span className="pill pill-ghost" style={{ fontSize: 9, color: tierColor }} title={`${tier}: ${tier === 'Premium' ? '$200+' : tier === 'Mid' ? '$100–$199' : 'under $100'}`}>
                            {tier.toUpperCase()}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {p.url
                          ? <a href={p.url} target="_blank" rel="noopener noreferrer" className="ext-link" style={{ fontSize: 11 }} title="Open live product listing on brand website">open →</a>
                          : <span style={{ color: 'var(--fg-4)' }}>·</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ─── Price Intelligence ─────────────────────────────────────── */}
      {(priceStat || priceTier) && (
        <section>
          <div className="section-head">
            <div>
              <h2>
                Price &amp; catalogue intelligence
                <SectionInfo
                  title="Price & Catalogue Intelligence"
                  description="Static catalogue snapshot from the last scrape. Shows price spread, average, and how the brand distributes products across Value / Mid / Premium price tiers. Does not apply the active date filter — price data is snapshot-based, not time-series."
                  source="products_catalog · static snapshot — not date-filtered"
                />
              </h2>
              <div className="sub">Static catalogue snapshot · does not apply date filter.</div>
            </div>
          </div>
          <div className="two-col-even">
            {priceStat && (
              <div className="card"><div className="card-pad">
                <h6 style={{ marginTop: 0 }}>Price distribution</h6>
                <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
                  {[
                    { label: 'Min',    value: `$${norm(priceStat.min).toFixed(0)}`,  color: '#22c55e',  tip: 'Cheapest product in the current catalogue' },
                    { label: 'Median', value: `$${norm(priceStat.med).toFixed(0)}`,  color: '#60a5fa',  tip: 'Middle price point — half the catalogue is cheaper, half is more expensive' },
                    { label: 'Avg',    value: `$${norm(priceStat.avg).toFixed(0)}`,  color: '#F5E625',  tip: 'Average retail price across all catalogue products' },
                    { label: 'Max',    value: `$${norm(priceStat.max).toFixed(0)}`,  color: '#ef4444',  tip: 'Most expensive product in the current catalogue' },
                  ].map(m => (
                    <MiniKpi key={m.label} label={m.label} value={m.value} color={m.color} tip={m.tip} src="products_catalog.price_usd" />
                  ))}
                </div>
                {/* Price range bar */}
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--fg-4)', marginBottom: 4 }}>
                    <span>$0</span><span>$100</span><span>$200</span><span>$300</span>
                  </div>
                  <div style={{ height: 10, background: 'var(--line)', borderRadius: 99, position: 'relative', overflow: 'hidden' }}>
                    <div style={{
                      position: 'absolute',
                      left: `${Math.min(98, (norm(priceStat.min) / 300) * 100)}%`,
                      right: `${Math.max(0, 100 - (norm(priceStat.max) / 300) * 100)}%`,
                      height: '100%',
                      background: `linear-gradient(90deg, ${brandColor}88, ${brandColor})`,
                      borderRadius: 99,
                    }} title={`Price range: $${norm(priceStat.min).toFixed(0)} – $${norm(priceStat.max).toFixed(0)}`} />
                    <div style={{
                      position: 'absolute',
                      left: `${Math.min(98, (norm(priceStat.avg) / 300) * 100)}%`,
                      width: 2, height: '100%', background: '#fff', opacity: 0.7,
                    }} title={`Avg $${norm(priceStat.avg).toFixed(0)}`} />
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--fg-4)', marginTop: 4 }}>
                    White line = avg · bar shows min → max spread
                  </div>
                </div>
              </div></div>
            )}
            {priceTier && (() => {
              const priced = priceTier.value + priceTier.mid + priceTier.premium
              const unpriced = Math.max(0, priceTier.total - priced)
              const tiers = [
                { key: 'value',    label: 'Value',    desc: 'under $100',      value: priceTier.value,   color: '#22c55e' },
                { key: 'mid',      label: 'Mid',      desc: '$100–$199',       value: priceTier.mid,     color: '#60a5fa' },
                { key: 'premium',  label: 'Premium',  desc: '$200+',           value: priceTier.premium, color: '#F5E625' },
                ...(unpriced > 0 ? [{ key: 'unknown', label: 'No price', desc: 'price not scraped', value: unpriced, color: '#374151' }] : []),
              ]
              const total = priceTier.total || 1
              const sz = 260, r = 100, inner = 58, cx = sz / 2, cy = sz / 2
              let acc = 0
              const arcs = tiers.map(t => {
                const start = (acc / total) * Math.PI * 2 - Math.PI / 2
                acc += t.value
                const isFull = t.value / total >= 0.9999
                const end = isFull ? start + Math.PI * 2 - 0.003 : (acc / total) * Math.PI * 2 - Math.PI / 2
                const large = t.value / total > 0.5 ? 1 : 0
                const rH = r + 4, iH = inner - 2
                const x0 = cx + r * Math.cos(start), y0 = cy + r * Math.sin(start)
                const x1 = cx + r * Math.cos(end),   y1 = cy + r * Math.sin(end)
                const x2 = cx + inner * Math.cos(end),   y2 = cy + inner * Math.sin(end)
                const x3 = cx + inner * Math.cos(start), y3 = cy + inner * Math.sin(start)
                const d = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${inner} ${inner} 0 ${large} 0 ${x3} ${y3} Z`
                const xH0 = cx + rH * Math.cos(start), yH0 = cy + rH * Math.sin(start)
                const xH1 = cx + rH * Math.cos(end),   yH1 = cy + rH * Math.sin(end)
                const xH2 = cx + iH * Math.cos(end),   yH2 = cy + iH * Math.sin(end)
                const xH3 = cx + iH * Math.cos(start), yH3 = cy + iH * Math.sin(start)
                const dH = `M ${xH0} ${yH0} A ${rH} ${rH} 0 ${large} 1 ${xH1} ${yH1} L ${xH2} ${yH2} A ${iH} ${iH} 0 ${large} 0 ${xH3} ${yH3} Z`
                return { ...t, d, dH }
              })
              const anyHov = tierHov !== null
              const hovArc = arcs.find(a => a.key === tierHov)
              return (
                <div className="card"><div className="card-pad">
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <div style={{ position: 'relative', width: sz, height: sz, flexShrink: 0 }}>
                      <svg width={sz} height={sz} viewBox={`0 0 ${sz} ${sz}`} style={{ overflow: 'visible' }}>
                        {arcs.map(a => {
                          const isHov = tierHov === a.key
                          return (
                            <g key={a.key} style={{ cursor: 'pointer' }}
                              onMouseEnter={() => setTierHov(a.key)}
                              onMouseLeave={() => setTierHov(null)}>
                              <path d={a.d} fill={a.color}
                                opacity={anyHov && !isHov ? 0.5 : 1}
                                style={{ transition: 'opacity 200ms ease' }} />
                              {isHov && (
                                <path d={a.dH} fill={a.color} opacity={0.95}
                                  style={{ filter: `drop-shadow(0 0 6px ${a.color}88)` }} />
                              )}
                            </g>
                          )
                        })}
                        <text x={cx} y={cy - 4} textAnchor="middle"
                          fontSize={hovArc ? 13 : 18} fontWeight={800} fill="#fff"
                          style={{ transition: 'font-size 150ms ease', pointerEvents: 'none' }}>
                          {hovArc ? hovArc.value : total}
                        </text>
                        <text x={cx} y={cy + 14} textAnchor="middle" fontSize={9} fill="#94a3b8"
                          style={{ pointerEvents: 'none' }}>
                          {hovArc ? hovArc.label : 'products'}
                        </text>
                      </svg>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '10px 1fr auto', alignItems: 'center', columnGap: 8, rowGap: 7, fontSize: 12, flex: 1, minWidth: 0 }}>
                      {arcs.map(a => {
                        const pct = Math.round((a.value / total) * 100)
                        const isHov = tierHov === a.key
                        return (
                          <Fragment key={a.key}>
                            <span style={{ width: 10, height: 10, background: a.color, borderRadius: 2, justifySelf: 'center', opacity: anyHov && !isHov ? 0.35 : 1, transition: 'opacity 200ms' }} />
                            <span style={{ color: isHov ? '#fff' : '#cbd1dc', fontWeight: isHov ? 700 : 400, transition: 'color 150ms' }}>
                              {a.label} <span style={{ color: 'var(--fg-4)', fontSize: 11 }}>{a.desc}</span>
                            </span>
                            <span style={{ fontWeight: 700, color: isHov ? a.color : '#fff', textAlign: 'right', fontVariantNumeric: 'tabular-nums', transition: 'color 150ms' }}>
                              {a.value} <span style={{ color: 'var(--fg-4)', fontWeight: 400, fontSize: 11 }}>({pct}%)</span>
                            </span>
                          </Fragment>
                        )
                      })}
                    </div>
                  </div>
                </div></div>
              )
            })()}
          </div>
        </section>
      )}
    </>
  )
}
