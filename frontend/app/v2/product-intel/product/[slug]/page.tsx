'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { PageHead, LoadingPage, pgColor, pgName } from '@/components/v2/PageShell'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import {
  fetchProductIntel,
  type RawCatalogProduct,
  type AttentionSummaryRow,
  type PriceStat,
} from '@/lib/v2/productIntel'
import type { LeaderboardRow } from '@/components/v2/charts/LeaderboardTable'
import { fmt, Sparkline } from '@/components/v2/charts'
import { SectionInfo } from '@/components/v2/PageShell'
import { ProductHero }         from '@/components/v2/product-detail/ProductHero'
import { ProductAttention }    from '@/components/v2/product-detail/ProductAttention'
import { ProductPeriodMatrix } from '@/components/v2/product-detail/ProductPeriodMatrix'
import { ProductPriceContext } from '@/components/v2/product-detail/ProductPriceContext'
import type { AttentionDailyRow } from '@/lib/v2/productIntel'

export default function CatalogueProductPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [brandSlug, ...nameParts] = decodeURIComponent(slug).split('--')
  const productName = nameParts.join('--')

  const [brands, setBrands]          = useState<V2Brand[]>([])
  const [product, setProduct]        = useState<RawCatalogProduct | null>(null)
  const [leaderboardRow, setLBRow]   = useState<LeaderboardRow | null>(null)
  const [periodRows, setPeriodRows]  = useState<AttentionSummaryRow[]>([])
  const [priceStat, setPriceStat]    = useState<PriceStat | null>(null)
  const [dailyRows, setDailyRows]    = useState<AttentionDailyRow[]>([])
  const [peers, setPeers]            = useState<LeaderboardRow[]>([])
  const [brandProducts, setBrandProducts] = useState<LeaderboardRow[]>([])
  const [loading, setLoading]        = useState(true)

  const norm = (v: number) => v > 1000 ? +(v / 1000).toFixed(2) : v

  useEffect(() => {
    if (!brandSlug || !productName) return
    document.title = `${productName} — Product Intel`
    ;(async () => {
      try {
        const b = await fetchBrands()
        setBrands(b)
        const d = await fetchProductIntel(b)
        const bId = b.find(x => x.id === brandSlug)?.brand_id || ''
        const found = d.catalogProducts.find(p =>
          p.brand_id === bId && (p.name === productName || p.name?.includes(productName) || productName.includes(p.name || ''))
        ) || null
        setProduct(found)

        const lbRow = d.leaderboardRows.find(r =>
          r.brand === brandSlug && (r.product === productName || r.product.includes(productName) || productName.includes(r.product))
        ) || null
        setLBRow(lbRow)

        const norm2 = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
        const cp = d.curatedProducts.find(c =>
          c.brand_id === bId && (
            norm2(c.display_name) === norm2(productName) ||
            norm2(c.display_name).includes(norm2(productName)) ||
            norm2(productName).includes(norm2(c.display_name))
          )
        )
        if (cp) {
          setPeriodRows(d.attentionSummary.filter(s => s.product_id === cp.id))
          setDailyRows(d.attentionDaily.filter(r => r.product_id === cp.id).sort((a, b) => a.date.localeCompare(b.date)).slice(-60))
          // Category peers
          const sameCatIds = new Set(d.curatedProducts.filter(c => c.category === cp.category).map(c => c.id))
          const lbName = lbRow?.product || productName
          setPeers(d.leaderboardRows.filter(r => {
            const pcp = d.curatedProducts.find(c => c.display_name === r.product)
            return pcp && sameCatIds.has(pcp.id) && r.product !== lbName
          }).sort((a, b) => b.attention - a.attention).slice(0, 8))
        }
        setBrandProducts(d.leaderboardRows.filter(r => r.brand === brandSlug).sort((a, b) => b.attention - a.attention))
        setPriceStat(d.priceStatsByBrand.find(s => s.brand === brandSlug) || null)
      } finally { setLoading(false) }
    })()
  }, [brandSlug, productName])

  if (loading) return <LoadingPage />

  const brandColor = pgColor(brandSlug)
  const brandName  = pgName(brandSlug, brands)
  const price      = product?.price_usd != null ? norm(Number(product.price_usd)) : null

  return (
    <>
      <style>{`.v2-root .page-head h1 { white-space: normal !important; font-size: clamp(18px, 2.2vw, 28px) !important; line-height: 1.25 !important; word-break: break-word; }`}</style>
      <PageHead
        eyebrow={`${brandName} · Product Intel`}
        title={productName.startsWith(brandName) ? productName.slice(brandName.length).trim() : productName}
        sub={[product?.category, product ? (product.in_stock !== false ? 'In Stock' : 'Out of Stock') : null].filter(Boolean).join(' · ')}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            {product?.url && (
              <a href={product.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ fontSize: 12 }}>View on store ↗</a>
            )}
            <button onClick={() => router.back()} className="btn btn-ghost" style={{ fontSize: 12 }}>← Back</button>
          </div>
        }
      />

      {product ? (
        <ProductHero product={product} brands={brands} norm={norm} />
      ) : (
        <section>
          <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 13 }}>
            Product not found in the catalogue.
          </div>
        </section>
      )}

      <ProductAttention row={leaderboardRow} brandColor={brandColor} />

      {/* Daily activity chart */}
      {dailyRows.length > 0 && (() => {
        const maxD = Math.max(1, ...dailyRows.map(r => r.mention_count))
        return (
          <section>
            <div className="section-head"><div>
              <h2>Daily mention activity <SectionInfo title="Daily Mention Activity" description="Day-by-day community mention count for this product over the last 60 days. Spikes indicate launches, tournament results, or viral posts. Hover each bar for the exact count." source="product_attention_daily · last 60 days" /></h2>
              <div className="sub">Last {dailyRows.length} days</div>
            </div></div>
            <div className="card card-pad">
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 80 }}>
                {dailyRows.map((r, i) => (
                  <div key={i} title={`${r.date}: ${r.mention_count} mentions`}
                    style={{ flex: 1, height: `${Math.max(3, (r.mention_count / maxD) * 100)}%`, background: r.mention_count > 0 ? brandColor : 'rgba(255,255,255,0.06)', borderRadius: '2px 2px 0 0', opacity: r.mention_count > 0 ? 0.85 : 1, cursor: 'default', minHeight: 3 }} />
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--fg-4)', marginTop: 6 }}>
                <span>{dailyRows[0]?.date?.slice(0, 10)}</span>
                <span>{dailyRows[Math.floor(dailyRows.length / 2)]?.date?.slice(0, 10)}</span>
                <span>{dailyRows[dailyRows.length - 1]?.date?.slice(0, 10)}</span>
              </div>
            </div>
          </section>
        )
      })()}

      <ProductPeriodMatrix rows={periodRows} />
      <ProductPriceContext productPrice={price} brandStat={priceStat} brandColor={brandColor} norm={norm} />

      {/* Category peers */}
      {peers.length > 0 && (
        <section>
          <div className="section-head"><div>
            <h2>Category peers <SectionInfo title="Category Peers" description="Other products in the same category ranked by attention score across all brands." source="leaderboard_rows · category-filtered" /></h2>
            <div className="sub">Top competitors in the same category</div>
          </div></div>
          <div className="card">
            <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table className="data" style={{ width: '100%' }}>
                <thead><tr>
                  <th style={{ textAlign: 'left' }}>Brand</th>
                  <th style={{ textAlign: 'left' }}>Product</th>
                  <th style={{ textAlign: 'right' }} title="7-day attention score">Attention</th>
                  <th style={{ textAlign: 'right' }} title="Total mentions">Mentions</th>
                  <th title="28-day trend">Trend</th>
                </tr></thead>
                <tbody>
                  {peers.map(p => (
                    <tr key={`${p.brand}-${p.product}`} style={{ cursor: 'pointer' }}
                      onClick={() => router.push(`/v2/product-intel/leaderboard-product/${encodeURIComponent(p.brand)}/${encodeURIComponent(p.product)}`)}>
                      <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: pgColor(p.brand) }} /><span style={{ fontWeight: 600, fontSize: 12, color: p.brand === 'joola' ? '#22c55e' : 'inherit' }}>{pgName(p.brand, brands)}</span></span></td>
                      <td style={{ fontWeight: 600 }}>{p.product}</td>
                      <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625', fontWeight: 700 }}>{p.attention > 0 ? p.attention.toFixed(2) : '—'}</td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>{p.mentions > 0 ? fmt(p.mentions) : '—'}</td>
                      <td>{p.sparkline?.length > 1 ? <Sparkline data={p.sparkline} color={pgColor(p.brand)} w={80} h={22} /> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* All brand products */}
      {brandProducts.length > 0 && (
        <section>
          <div className="section-head"><div>
            <h2>All {brandName} products <SectionInfo title={`${brandName} Products`} description="Every tracked product from this brand ranked by attention. Current product highlighted." source="leaderboard_rows" /></h2>
            <div className="sub">{brandProducts.length} products · click any row to open</div>
          </div></div>
          <div className="card">
            <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
              <table className="data" style={{ width: '100%' }}>
                <thead><tr>
                  <th>#</th>
                  <th style={{ textAlign: 'left' }}>Product</th>
                  <th style={{ textAlign: 'right' }} title="7-day attention score">Attention</th>
                  <th style={{ textAlign: 'right' }} title="Total mentions">Mentions</th>
                  <th title="28-day trend">Trend</th>
                </tr></thead>
                <tbody>
                  {brandProducts.map((p, i) => {
                    const isCurrent = p.product === (leaderboardRow?.product || productName)
                    return (
                      <tr key={p.product}
                        style={{ cursor: isCurrent ? 'default' : 'pointer', background: isCurrent ? `${brandColor}12` : undefined, borderLeft: isCurrent ? `3px solid ${brandColor}` : undefined }}
                        onClick={() => { if (!isCurrent) router.push(`/v2/product-intel/leaderboard-product/${encodeURIComponent(brandSlug)}/${encodeURIComponent(p.product)}`) }}>
                        <td style={{ color: 'var(--fg-4)', fontSize: 11, fontWeight: 600 }}>#{i + 1}</td>
                        <td style={{ fontWeight: isCurrent ? 800 : 600, color: isCurrent ? brandColor : 'inherit' }}>
                          {p.product}{isCurrent && <span style={{ fontSize: 9, color: brandColor, marginLeft: 6 }}>← this</span>}
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625', fontWeight: 700 }}>{p.attention > 0 ? p.attention.toFixed(2) : '—'}</td>
                        <td className="cell-num" style={{ textAlign: 'right' }}>{p.mentions > 0 ? fmt(p.mentions) : '—'}</td>
                        <td>{p.sparkline?.length > 1 ? <Sparkline data={p.sparkline} color={brandColor} w={80} h={22} /> : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </>
  )
}
