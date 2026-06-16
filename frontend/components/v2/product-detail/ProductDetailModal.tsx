'use client'

import { useEffect, useMemo } from 'react'
import { SectionInfo, pgColor, pgName } from '@/components/v2/PageShell'
import { fmt, Sparkline } from '@/components/v2/charts'
import type { V2Brand } from '@/lib/v2/data'
import type { ProductIntelData } from '@/lib/v2/productIntel'
import { ProductHero }         from '@/components/v2/product-detail/ProductHero'
import { ProductAttention }    from '@/components/v2/product-detail/ProductAttention'
import { ProductPeriodMatrix } from '@/components/v2/product-detail/ProductPeriodMatrix'
import { ProductPriceContext } from '@/components/v2/product-detail/ProductPriceContext'

const norm = (v: number) => (v > 1000 ? +(v / 1000).toFixed(2) : v)

interface Props {
  brand: string          // brand slug e.g. "joola"
  productId: string      // curated product id OR raw product name
  intel: ProductIntelData
  brands: V2Brand[]
  onClose: () => void
}

export function ProductDetailModal({ brand, productId, intel, brands, onClose }: Props) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [onClose])

  const brandColor   = pgColor(brand)
  const brandDisplay = pgName(brand, brands)

  // 1. Find curated product (by id or display_name)
  const cp = useMemo(() =>
    intel.curatedProducts.find(c => c.id === productId) ||
    intel.curatedProducts.find(c => c.display_name === productId) ||
    null
  , [intel, productId])

  // 2. Find catalog product — via curated match first, then direct name search
  const cat = useMemo(() => {
    if (cp) {
      const catId = intel.productMatches.curatedToCatalog.get(cp.id)
      if (catId) return intel.catalogProducts.find(p => p.id === catId) || null
    }
    // No curated match — search by brand + name
    const bId = brands.find(b => b.id === brand)?.brand_id || ''
    const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    return intel.catalogProducts.find(p =>
      p.brand_id === bId && (
        p.name === productId ||
        n(p.name || '') === n(productId) ||
        n(p.name || '').includes(n(productId)) ||
        n(productId).includes(n(p.name || ''))
      )
    ) || null
  }, [intel, cp, brand, brands, productId])

  // 3. Leaderboard row — brand field uses display name
  const lbRow = useMemo(() => {
    const dn = cp?.display_name || productId
    return (
      intel.leaderboardRows.find(r => r.brand === brandDisplay && r.product === dn) ||
      intel.leaderboardRows.find(r => {
        if (r.brand !== brandDisplay) return false
        const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
        return n(r.product).includes(n(dn)) || n(dn).includes(n(r.product))
      }) ||
      null
    )
  }, [intel, cp, productId, brandDisplay])

  // 4. Attention periods & daily
  const periodRows = useMemo(() =>
    cp ? intel.attentionSummary.filter(s => s.product_id === cp.id) : []
  , [intel, cp])

  const dailyRows = useMemo(() =>
    cp
      ? intel.attentionDaily
          .filter(r => r.product_id === cp.id)
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(-60)
      : []
  , [intel, cp])

  // 5. Price stat
  const priceStat = useMemo(() =>
    intel.priceStatsByBrand.find(s => s.brand === brand) || null
  , [intel, brand])

  // 6. Category peers
  const peers = useMemo(() => {
    if (!cp) return []
    const catIds = new Set(intel.curatedProducts.filter(c => c.category === cp.category).map(c => c.id))
    return intel.leaderboardRows
      .filter(r => {
        const p2 = intel.curatedProducts.find(c => c.display_name === r.product)
        return p2 && catIds.has(p2.id) && r.product !== cp.display_name
      })
      .sort((a, b) => b.attention - a.attention)
      .slice(0, 6)
  }, [intel, cp])

  const price  = cat?.price_usd != null ? norm(Number(cat.price_usd)) : null
  const maxD   = Math.max(1, ...dailyRows.map(r => r.mention_count))
  const dn     = cp?.display_name || productId

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#0d1117', border: '1px solid var(--wb-10)', borderRadius: 14, width: '100%', maxWidth: 900, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 32px 80px rgba(0,0,0,0.85)' }}
        onClick={e => e.stopPropagation()}
      >

        {/* ── Header ── */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'flex-start', gap: 12, flexShrink: 0 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: brandColor, flexShrink: 0, marginTop: 5 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 17, color: brand === 'joola' ? '#22c55e' : '#fff', lineHeight: 1.3, wordBreak: 'break-word' }}>{dn}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>
              {[brandDisplay, cat?.category, cat ? (cat.in_stock !== false ? 'In Stock' : 'Out of Stock') : null].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 24, cursor: 'pointer', lineHeight: 1, flexShrink: 0, padding: '0 4px' }}>×</button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 0 }}>

          {/* Hero KPI cards — same as detail page */}
          {cat ? (
            <ProductHero product={cat} brands={brands} norm={norm} />
          ) : (
            <div style={{ padding: '14px 0', color: '#6b7280', fontSize: 13 }}>
              No catalogue data found for this product.
            </div>
          )}

          {/* Community attention sparkline */}
          <div style={{ marginTop: 20 }}>
            <ProductAttention row={lbRow} brandColor={brandColor} />
          </div>

          {/* Daily bar chart */}
          {dailyRows.length > 0 && (
            <section style={{ marginTop: 4 }}>
              <div className="section-head"><div>
                <h2>Daily mention activity <SectionInfo title="Daily Mention Activity" description="Day-by-day mention count for this product — last 60 days. Spikes indicate launches, tournament buzz, or viral posts." source="product_attention_daily" /></h2>
                <div className="sub">Last {dailyRows.length} days</div>
              </div></div>
              <div className="card card-pad">
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 72 }}>
                  {dailyRows.map((r, i) => (
                    <div
                      key={i}
                      title={`${r.date}: ${r.mention_count} mention${r.mention_count !== 1 ? 's' : ''}`}
                      style={{ flex: 1, height: `${Math.max(4, (r.mention_count / maxD) * 100)}%`, background: r.mention_count > 0 ? brandColor : 'var(--wb-6)', borderRadius: '2px 2px 0 0', opacity: r.mention_count > 0 ? 0.85 : 1, minHeight: 4 }}
                    />
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--fg-4)', marginTop: 5 }}>
                  <span>{dailyRows[0]?.date?.slice(0, 10)}</span>
                  <span>{dailyRows[dailyRows.length - 1]?.date?.slice(0, 10)}</span>
                </div>
              </div>
            </section>
          )}

          {/* Period matrix */}
          <ProductPeriodMatrix rows={periodRows} />

          {/* Price context bar */}
          <ProductPriceContext productPrice={price} brandStat={priceStat} brandColor={brandColor} norm={norm} />

          {/* Category peers */}
          {peers.length > 0 && (
            <section>
              <div className="section-head"><div>
                <h2>Category peers <SectionInfo title="Category Peers" description="Top competing products in the same category ranked by attention score." source="leaderboard_rows · category-filtered" /></h2>
                <div className="sub">{cp?.category} · top {peers.length}</div>
              </div></div>
              <div className="card">
                <div className="table-wrap" style={{ maxHeight: 240, overflowY: 'auto' }}>
                  <table className="data" style={{ width: '100%' }}>
                    <thead><tr>
                      <th style={{ textAlign: 'left' }}>Brand</th>
                      <th style={{ textAlign: 'left' }}>Product</th>
                      <th style={{ textAlign: 'right' }}>Attention</th>
                      <th style={{ textAlign: 'right' }}>Mentions</th>
                      <th>Trend</th>
                    </tr></thead>
                    <tbody>
                      {peers.map(p => (
                        <tr key={`${p.brand}-${p.product}`}>
                          <td>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: pgColor(p.brand) }} />
                              <span style={{ fontWeight: 600, fontSize: 12 }}>{p.brand}</span>
                            </span>
                          </td>
                          <td style={{ fontWeight: 600, fontSize: 12 }}>{p.product}</td>
                          <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625', fontWeight: 700 }}>{p.attention > 0 ? p.attention.toFixed(2) : '—'}</td>
                          <td className="cell-num" style={{ textAlign: 'right' }}>{p.mentions > 0 ? fmt(p.mentions) : '—'}</td>
                          <td>{p.sparkline?.length > 1 ? <Sparkline data={p.sparkline} color={pgColor(p.brand)} w={70} h={18} /> : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {!cat && !lbRow && (
            <div style={{ textAlign: 'center', color: '#6b7280', fontSize: 13, padding: '32px 0' }}>
              No intelligence data available for this product yet.
            </div>
          )}

        </div>

        {/* ── Footer ── */}
        <div style={{ padding: '10px 24px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6b7280', flexShrink: 0 }}>
          <span>Product Intelligence · {brandDisplay}</span>
          <span>Press Esc to close</span>
        </div>

      </div>
    </div>
  )
}
