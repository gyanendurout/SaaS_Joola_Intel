'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  PageHead, LoadingPage, MiniKpi, SectionInfo,
  pgColor, pgName,
} from '@/components/v2/PageShell'
import { fmt, Sparkline } from '@/components/v2/charts'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import {
  fetchProductIntel,
  type CuratedProduct,
  type RawCatalogProduct,
  type AttentionSummaryRow,
  type AttentionDailyRow,
  type PriceStat,
} from '@/lib/v2/productIntel'
import type { LeaderboardRow } from '@/components/v2/charts/LeaderboardTable'

const PERIOD_ORDER = ['last_7d', 'last_30d', 'last_90d', 'all_time']
const PERIOD_LABEL: Record<string, string> = {
  last_7d: 'Last 7D', last_30d: 'Last 30D', last_90d: 'Last 90D', all_time: 'All Time',
}

const emptyCell: React.CSSProperties = { textAlign: 'center', padding: '28px 0', color: 'var(--fg-4)', fontSize: 13 }
const norm = (v: number) => v > 1000 ? +(v / 1000).toFixed(2) : v

export default function LeaderboardProductPage() {
  const { brand: brandParam, productId } = useParams<{ brand: string; productId: string }>()
  const router = useRouter()
  const brandSlug    = decodeURIComponent(brandParam)
  const productIdDec = decodeURIComponent(productId)

  const [brands, setBrands]          = useState<V2Brand[]>([])
  const [curatedProduct, setCurated] = useState<CuratedProduct | null>(null)
  const [catalogProduct, setCatalog] = useState<RawCatalogProduct | null>(null)
  const [leaderboardRow, setLBRow]   = useState<LeaderboardRow | null>(null)
  const [periodRows, setPeriodRows]  = useState<AttentionSummaryRow[]>([])
  const [dailyRows, setDailyRows]    = useState<AttentionDailyRow[]>([])
  const [peers, setPeers]            = useState<LeaderboardRow[]>([])
  const [priceStat, setPriceStat]    = useState<PriceStat | null>(null)
  const [brandProducts, setBrandProducts] = useState<LeaderboardRow[]>([])
  const [allMatrix, setAllMatrix]         = useState<LeaderboardRow[]>([])
  const [loading, setLoading]        = useState(true)

  useEffect(() => {
    if (!brandSlug || !productIdDec) return
    ;(async () => {
      try {
        const b = await fetchBrands()
        setBrands(b)
        const d = await fetchProductIntel(b)
        const bId = b.find(x => x.id === brandSlug)?.brand_id || ''

        // Resolve curated product
        const cp = d.curatedProducts.find(c => c.id === productIdDec)
          || d.curatedProducts.find(c => c.display_name === productIdDec)
        setCurated(cp || null)
        if (cp) document.title = `${cp.display_name} — Product Intel`

        // Find matching catalogue product via productMatches
        if (cp) {
          const catId = d.productMatches.curatedToCatalog.get(cp.id)
          const catProd = catId ? d.catalogProducts.find(p => p.id === catId) : null
          setCatalog(catProd || null)
        }

        // Leaderboard row
        const displayName = cp?.display_name || productIdDec
        setLBRow(d.leaderboardRows.find(r => r.brand === brandSlug && r.product === displayName) || null)

        // Period summary
        const pid = cp?.id || productIdDec
        setPeriodRows(d.attentionSummary.filter(s => s.product_id === pid))

        // Daily activity — last 60 days
        setDailyRows(d.attentionDaily.filter(r => r.product_id === pid).sort((a, b) => a.date.localeCompare(b.date)).slice(-60))

        // Peer comparison — same category, different products
        const category = cp?.category
        if (category) {
          const sameCatCuratedIds = new Set(
            d.curatedProducts.filter(c => c.category === category).map(c => c.id)
          )
          // Products in same category from all brands, sorted by attention
          const peerRows = d.leaderboardRows
            .filter(r => {
              const peerCp = d.curatedProducts.find(c => c.display_name === r.product)
              return peerCp && sameCatCuratedIds.has(peerCp.id) && r.product !== displayName
            })
            .sort((a, b) => b.attention - a.attention)
            .slice(0, 8)
          setPeers(peerRows)
        }

        setPriceStat(d.priceStatsByBrand.find(s => s.brand === brandSlug) || null)

        // All products from this brand sorted by attention
        setBrandProducts(d.leaderboardRows.filter(r => r.brand === brandSlug).sort((a, b) => b.attention - a.attention))

        // Full leaderboard sorted by attention (for cross-brand context)
        setAllMatrix([...d.leaderboardRows].sort((a, b) => b.attention - a.attention).slice(0, 30))
      } finally { setLoading(false) }
    })()
  }, [brandSlug, productIdDec])

  if (loading) return <LoadingPage />

  const brandColor  = pgColor(brandSlug)
  const brandName   = pgName(brandSlug, brands)
  const displayName = curatedProduct?.display_name || productIdDec
  const isJoola     = brandSlug === 'joola'

  const byPeriod: Record<string, AttentionSummaryRow> = {}
  periodRows.forEach(r => { byPeriod[r.period] = r })

  // Daily chart
  const maxDaily = Math.max(1, ...dailyRows.map(r => r.mention_count))
  const price = catalogProduct?.price_usd != null ? norm(Number(catalogProduct.price_usd)) : null
  const salePrice = catalogProduct?.sale_price_usd != null ? norm(Number(catalogProduct.sale_price_usd)) : null

  return (
    <>
      <style>{`.v2-root .page-head h1 { white-space: normal !important; font-size: clamp(18px, 2.2vw, 28px) !important; line-height: 1.25 !important; word-break: break-word; }`}</style>
      <PageHead
        eyebrow={`${brandName} · Product Intel`}
        title={displayName}
        sub={[curatedProduct?.category, isJoola ? 'JOOLA product' : undefined, catalogProduct?.in_stock !== false ? 'In Stock' : 'Out of Stock'].filter(Boolean).join(' · ')}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            {catalogProduct?.url && (
              <a href={catalogProduct.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ fontSize: 12 }}>
                View on store ↗
              </a>
            )}
            <button onClick={() => router.back()} className="btn btn-ghost" style={{ fontSize: 12 }}>← Back</button>
          </div>
        }
      />

      {/* ── Section 1: Product specs from catalogue ───────────────── */}
      {catalogProduct && (
        <section>
          <div className="section-head">
            <div>
              <h2>
                Product details
                <SectionInfo
                  title="Product Details"
                  description="Scraped product information from the brand's storefront. Price, stock status, and ratings are updated weekly. Review count and average rating come from the brand's own product page."
                  source="products_catalog · scraped weekly from brand storefront"
                />
              </h2>
            </div>
          </div>
          <div className="card card-pad">
            <div className="kpi-grid">
              {price != null && (
                <MiniKpi label="Price" value={`$${price.toFixed(0)}`} color="#60a5fa"
                  customVs={salePrice && salePrice < price ? `Sale: $${salePrice.toFixed(0)}` : undefined}
                  tip="Retail price in USD. Sale price shown if a promotion is active." src="products_catalog.price_usd" />
              )}
              <MiniKpi label="In stock" value={catalogProduct.in_stock !== false ? 'Yes' : 'No'}
                color={catalogProduct.in_stock !== false ? '#22c55e' : '#ef4444'}
                tip="Whether this product is currently available for purchase. Updated weekly." src="products_catalog.in_stock" />
              {catalogProduct.avg_rating != null && (
                <MiniKpi label="Avg rating" value={`${catalogProduct.avg_rating.toFixed(1)} ★`} color="#F5E625"
                  customVs={catalogProduct.review_count != null ? `${catalogProduct.review_count} reviews` : undefined}
                  tip="Average customer star rating and total review count from the product page." src="products_catalog.avg_rating" />
              )}
              {catalogProduct.discount_pct != null && catalogProduct.discount_pct > 0 && (
                <MiniKpi label="Discount" value={`${catalogProduct.discount_pct.toFixed(0)}%`} color="#ef4444"
                  tip="Percentage discount detected — difference between regular price and current sale price." src="products_catalog.discount_pct" />
              )}
              {price && priceStat && (
                <MiniKpi label="vs brand avg"
                  value={`${price - norm(priceStat.avg) >= 0 ? '+' : ''}$${(price - norm(priceStat.avg)).toFixed(0)}`}
                  color={price > norm(priceStat.avg) ? '#ef4444' : '#22c55e'}
                  tip={`This product is $${Math.abs(price - norm(priceStat.avg)).toFixed(0)} ${price > norm(priceStat.avg) ? 'above' : 'below'} the brand's average price of $${norm(priceStat.avg).toFixed(0)}.`}
                  src="products_catalog.price_usd" />
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Section 2: Community attention ───────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Community attention
              <SectionInfo
                title="Community Attention"
                description="7-day rolling attention score and 28-day sparkline. Attention is a composite of mention volume, engagement weight, and estimated sales signals. Higher score = more community buzz right now."
                source="product_attention_daily · leaderboard"
              />
            </h2>
          </div>
        </div>
        {!leaderboardRow ? (
          <div className="card"><div style={emptyCell}>No attention data for this product in the current window. Try expanding the date range.</div></div>
        ) : (
          <div className="card card-pad">
            <div className="kpi-grid" style={{ marginBottom: leaderboardRow.sparkline?.length > 1 ? 16 : 0 }}>
              <MiniKpi label="Attention score" value={leaderboardRow.attention > 0 ? leaderboardRow.attention.toFixed(2) : '0'} color="#F5E625"
                tip="7-day rolling composite score — higher means more community buzz right now." src="product_attention_daily" />
              <MiniKpi label="Total mentions" value={fmt(leaderboardRow.mentions)} color="#60a5fa"
                tip="Total community mentions in the active date window across all tracked channels." src="product_attention_daily" />
              {leaderboardRow.estimatedUnitsSold != null && (
                <MiniKpi label="Est. units sold" value={fmt(leaderboardRow.estimatedUnitsSold)} color="#22c55e"
                  tip="AI-estimated units sold. Directional only — not actual sales data." src="product_attention_daily" />
              )}
              {leaderboardRow.bestLagDays != null && (
                <MiniKpi label="Best lag" value={`${leaderboardRow.bestLagDays}d`} color="#a78bfa"
                  customVs={leaderboardRow.bestLagDriver || undefined}
                  tip="Days in advance community attention predicts sales for this product." src="product_attention_daily" />
              )}
            </div>
            {leaderboardRow.sparkline?.length > 1 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', marginBottom: 6, letterSpacing: '0.08em' }}>28-DAY MENTION TREND</div>
                <Sparkline data={leaderboardRow.sparkline} color={isJoola ? '#22c55e' : brandColor} w={500} h={44} />
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Section 3: Daily activity bar chart ───────────────────── */}
      {dailyRows.length > 0 && (
        <section>
          <div className="section-head">
            <div>
              <h2>
                Daily mention activity
                <SectionInfo
                  title="Daily Mention Activity"
                  description="Day-by-day community mention count for this product over the last 60 days. Spikes indicate news coverage, product launches, tournament results, or viral posts. Hover each bar for the exact count."
                  source="product_attention_daily · last 60 days"
                />
              </h2>
              <div className="sub">Last {dailyRows.length} days of community mentions</div>
            </div>
          </div>
          <div className="card card-pad">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 80 }}>
              {dailyRows.map((r, i) => {
                const h = Math.max(3, (r.mention_count / maxDaily) * 100)
                return (
                  <div key={i} title={`${r.date}: ${r.mention_count} mentions`}
                    style={{ flex: 1, height: `${h}%`, background: r.mention_count > 0 ? (isJoola ? '#22c55e' : brandColor) : 'var(--wb-6)', borderRadius: '2px 2px 0 0', opacity: r.mention_count > 0 ? 0.85 : 1, transition: 'height 400ms cubic-bezier(0.16,1,0.3,1)', cursor: 'default', minHeight: 3 }}
                  />
                )
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--fg-4)', marginTop: 6 }}>
              <span>{dailyRows[0]?.date?.slice(0, 10)}</span>
              <span>{dailyRows[Math.floor(dailyRows.length / 2)]?.date?.slice(0, 10)}</span>
              <span>{dailyRows[dailyRows.length - 1]?.date?.slice(0, 10)}</span>
            </div>
          </div>
        </section>
      )}

      {/* ── Section 4: Performance by period ─────────────────────── */}
      {periodRows.length > 0 && (
        <section>
          <div className="section-head">
            <div>
              <h2>
                Performance by period
                <SectionInfo
                  title="Performance by Period"
                  description="Mentions, attention score, and competitive gap across different time windows. Gap shows how this product compares to the top competitor in the same category — positive = leads, negative = trails."
                  source="product_attention_summary · all periods"
                />
              </h2>
              <div className="sub">7D · 30D · 90D · All-time breakdown with competitive gap</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {PERIOD_ORDER.map(period => {
              const r = byPeriod[period]
              return (
                <div key={period} className="card card-pad">
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>{PERIOD_LABEL[period]}</div>
                  {!r ? <div style={{ color: 'var(--fg-4)', fontSize: 12 }}>No data</div> : (
                    <>
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color: '#F5E625', fontFamily: 'JetBrains Mono' }}>{r.total_mentions}</div>
                        <div style={{ fontSize: 10, color: 'var(--fg-4)', marginTop: 2 }}>mentions</div>
                      </div>
                      {r.weighted_total > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 16, fontWeight: 700, color: '#a78bfa', fontFamily: 'JetBrains Mono' }}>{r.weighted_total.toFixed(1)}</div>
                          <div style={{ fontSize: 10, color: 'var(--fg-4)', marginTop: 2 }}>attention score</div>
                        </div>
                      )}
                      {r.gap_to_top_competitor != null && (
                        <div title="Mention gap vs top competitor in same category">
                          <div style={{ fontSize: 14, fontWeight: 700, color: r.gap_to_top_competitor >= 0 ? '#22c55e' : '#ef4444', fontFamily: 'JetBrains Mono' }}>
                            {r.gap_to_top_competitor >= 0 ? '+' : ''}{r.gap_to_top_competitor.toFixed(1)}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--fg-4)', marginTop: 2 }}>vs competitor</div>
                        </div>
                      )}
                      {r.rank_in_category != null && (
                        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--fg-3)' }}>
                          Rank <b style={{ color: 'var(--fg)' }}>#{r.rank_in_category}</b> in category
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Section 5: Peer comparison ────────────────────────────── */}
      {peers.length > 0 && (
        <section>
          <div className="section-head">
            <div>
              <h2>
                Category peers · {curatedProduct?.category || 'same category'}
                <SectionInfo
                  title="Category Peers"
                  description="Other products in the same category ranked by community attention score. Use this to understand how this product stacks up against cross-brand competitors in its niche."
                  source="leaderboard_rows · filtered by category"
                />
              </h2>
              <div className="sub">Top products in the same category across all brands</div>
            </div>
          </div>
          <div className="card">
            <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
              <table className="data" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>#</th>
                    <th style={{ textAlign: 'left' }} title="Brand name">Brand</th>
                    <th style={{ textAlign: 'left' }} title="Product name">Product</th>
                    <th style={{ textAlign: 'right' }} title="7-day rolling attention score">Attention</th>
                    <th style={{ textAlign: 'right' }} title="Total community mentions in window">Mentions</th>
                    <th title="28-day mention trend">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {peers.map((p, i) => (
                    <tr key={`${p.brand}-${p.product}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        router.push(`/v2/product-intel/leaderboard-product/${encodeURIComponent(p.brand)}/${encodeURIComponent(p.product)}`)
                      }}>
                      <td style={{ color: 'var(--fg-4)', fontWeight: 600, fontSize: 11 }}>#{i + 1}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: pgColor(p.brand) }} />
                          <span style={{ fontWeight: 600, color: p.brand === 'joola' ? '#22c55e' : 'inherit', fontSize: 12 }}>{pgName(p.brand, brands)}</span>
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, fontSize: 13 }}>{p.product}</td>
                      <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625', fontWeight: 700 }}>{p.attention > 0 ? p.attention.toFixed(2) : '—'}</td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(p.mentions)}</td>
                      <td>{p.sparkline?.length > 1 ? <Sparkline data={p.sparkline} color={pgColor(p.brand)} w={80} h={22} /> : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ── Section 6: All products from this brand ─────────────── */}
      {brandProducts.length > 0 && (
        <section>
          <div className="section-head">
            <div>
              <h2>
                All {brandName} products · leaderboard
                <SectionInfo
                  title={`${brandName} Products — Full Leaderboard`}
                  description="Every tracked product from this brand ranked by community attention score. Highlights the currently viewed product. Click any row to open its detail page."
                  source="product_attention_daily · brand-filtered leaderboard"
                />
              </h2>
              <div className="sub">{brandProducts.length} products ranked by attention score</div>
            </div>
          </div>
          <div className="card">
            <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
              <table className="data" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th title="Product name">Product</th>
                    <th title="7-day rolling attention score" style={{ textAlign: 'right' }}>Attention</th>
                    <th title="Total community mentions in the active date window" style={{ textAlign: 'right' }}>Mentions</th>
                    {brandProducts.some(r => r.estimatedUnitsSold != null) && (
                      <th title="AI-estimated units sold. Directional only." style={{ textAlign: 'right' }}>Est. Units</th>
                    )}
                    <th title="28-day mention trend">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {brandProducts.map((p, i) => {
                    const isCurrent = p.product === displayName
                    return (
                      <tr key={p.product}
                        className={isCurrent ? (isJoola ? 'joola' : '') : ''}
                        style={{ cursor: isCurrent ? 'default' : 'pointer', background: isCurrent ? `${brandColor}12` : undefined, borderLeft: isCurrent ? `3px solid ${brandColor}` : undefined }}
                        onClick={() => { if (!isCurrent) router.push(`/v2/product-intel/leaderboard-product/${encodeURIComponent(brandSlug)}/${encodeURIComponent(p.product)}`) }}>
                        <td style={{ color: 'var(--fg-4)', fontWeight: 600, fontSize: 11 }}>#{i + 1}</td>
                        <td style={{ fontWeight: isCurrent ? 800 : 600, color: isCurrent ? brandColor : 'inherit' }}>
                          {p.product} {isCurrent && <span style={{ fontSize: 9, color: brandColor, marginLeft: 4 }}>← this product</span>}
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625', fontWeight: 700 }}>{p.attention > 0 ? p.attention.toFixed(2) : '—'}</td>
                        <td className="cell-num" style={{ textAlign: 'right' }}>{p.mentions > 0 ? fmt(p.mentions) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                        {brandProducts.some(r => r.estimatedUnitsSold != null) && (
                          <td className="cell-num" style={{ textAlign: 'right', color: '#22c55e' }}>{p.estimatedUnitsSold != null ? fmt(p.estimatedUnitsSold) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                        )}
                        <td>{p.sparkline?.length > 1 ? <Sparkline data={p.sparkline} color={isJoola ? '#22c55e' : brandColor} w={80} h={22} /> : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ── Section 7: Cross-brand top 30 leaderboard ────────────── */}
      {allMatrix.length > 0 && (
        <section>
          <div className="section-head">
            <div>
              <h2>
                Cross-brand leaderboard · top {allMatrix.length}
                <SectionInfo
                  title="Cross-Brand Leaderboard"
                  description="Top products across all 11 brands ranked by attention score. The currently viewed product is highlighted. Use this to understand where this product sits in the overall competitive landscape."
                  source="product_attention_daily · all brands"
                />
              </h2>
              <div className="sub">Top products across all brands · click any row to open its detail page</div>
            </div>
          </div>
          <div className="card">
            <div className="table-wrap" style={{ maxHeight: 480, overflowY: 'auto' }}>
              <table className="data" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th style={{ textAlign: 'left' }} title="Brand name">Brand</th>
                    <th style={{ textAlign: 'left' }} title="Product name">Product</th>
                    <th style={{ textAlign: 'right' }} title="7-day rolling attention score">Attention</th>
                    <th style={{ textAlign: 'right' }} title="Total community mentions">Mentions</th>
                    <th title="28-day trend">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {allMatrix.map((p, i) => {
                    const isCurrent = p.product === displayName && p.brand === brandSlug
                    const rowColor = pgColor(p.brand)
                    return (
                      <tr key={`${p.brand}-${p.product}`}
                        style={{ cursor: isCurrent ? 'default' : 'pointer', background: isCurrent ? `${brandColor}12` : undefined, borderLeft: isCurrent ? `3px solid ${brandColor}` : undefined }}
                        onClick={() => { if (!isCurrent) router.push(`/v2/product-intel/leaderboard-product/${encodeURIComponent(p.brand)}/${encodeURIComponent(p.product)}`) }}>
                        <td style={{ color: 'var(--fg-4)', fontWeight: 600, fontSize: 11 }}>#{i + 1}</td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: rowColor, flexShrink: 0 }} />
                            <span style={{ fontWeight: 600, fontSize: 12, color: p.brand === 'joola' ? '#22c55e' : 'inherit' }}>{pgName(p.brand, brands)}</span>
                          </span>
                        </td>
                        <td style={{ fontWeight: isCurrent ? 800 : 600, color: isCurrent ? brandColor : 'inherit' }}>
                          {p.product} {isCurrent && <span style={{ fontSize: 9, color: brandColor, marginLeft: 4 }}>← this</span>}
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625', fontWeight: 700 }}>{p.attention > 0 ? p.attention.toFixed(2) : '—'}</td>
                        <td className="cell-num" style={{ textAlign: 'right' }}>{p.mentions > 0 ? fmt(p.mentions) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                        <td>{p.sparkline?.length > 1 ? <Sparkline data={p.sparkline} color={rowColor} w={80} h={22} /> : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ── Section 8: Brand price context ───────────────────────── */}
      {priceStat && (
        <section>
          <div className="section-head">
            <div>
              <h2>
                Brand price context
                <SectionInfo
                  title="Brand Price Context"
                  description="Price distribution across the full brand catalogue — min, average, and max. Helps you understand where this product sits relative to other offerings from the same brand."
                  source="products_catalog · brand-level statistics"
                />
              </h2>
              <div className="sub">Price distribution for {brandName}</div>
            </div>
          </div>
          <div className="card card-pad">
            <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {[
                { label: 'Brand min', value: `$${norm(priceStat.min).toFixed(0)}`, color: '#22c55e', tip: 'Cheapest product in the brand catalogue' },
                { label: 'Brand avg', value: `$${norm(priceStat.avg).toFixed(0)}`, color: '#F5E625', tip: 'Average price across all brand products' },
                { label: 'Brand max', value: `$${norm(priceStat.max).toFixed(0)}`, color: '#ef4444', tip: 'Most expensive product in the brand catalogue' },
                { label: 'Products',  value: String(priceStat.count),              color: '#60a5fa', tip: 'Total products in the brand catalogue' },
              ].map(m => (
                <MiniKpi key={m.label} label={m.label} value={m.value} color={m.color} tip={m.tip} src="products_catalog.price_usd" />
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  )
}
