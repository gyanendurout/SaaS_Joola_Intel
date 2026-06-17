'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import {
  fetchStockoutOpportunities, fetchRestockCadence, fetchPricePressure,
  type StockoutOpportunityRow, type RestockCadenceRow, type PricePressureRow,
} from '@/lib/v2/productIntel'
import { fmt } from '@/components/v2/charts'
import { LoadingPage, pgName } from '@/components/v2/PageShell'
import { Breadcrumb } from '@/components/v2/Breadcrumb'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

const BRAND_COLORS: Record<string, string> = {
  joola: '#22c55e', selkirk: '#3b82f6', crbn: '#8b5cf6', 'six-zero': '#f59e0b',
  paddletek: '#ec4899', engage: '#14b8a6', onix: '#f97316', franklin: '#a78bfa',
  head: '#06b6d4', wilson: '#84cc16', gamma: '#fb7185',
}
function brandColor(slug: string) { return BRAND_COLORS[slug] ?? '#94a3b8' }

interface ProductRow {
  id: string
  display_name: string
  category: string | null
  sku: string | null
  status: string
  price: number | null
  lastSeen: string | null
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: 'var(--wb-6)', border: '1px solid var(--wb-10)', borderRadius: 12, padding: '16px 20px', flex: 1, minWidth: 110 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || '#fff', fontFamily: 'JetBrains Mono', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const label = status.replace(/_/g, ' ')
  if (status === 'in_stock') return <span className="pill pill-green">{label}</span>
  if (status === 'out_of_stock') return <span className="pill pill-red">{label}</span>
  if (status === 'limited' || status === 'low') return <span className="pill pill-amber">{label}</span>
  return <span className="pill pill-ghost">{label}</span>
}

export default function SalesIntelBrandPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const brandSlug = decodeURIComponent(slug)

  const [brands, setBrands] = useState<V2Brand[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [stockouts, setStockouts] = useState<StockoutOpportunityRow[]>([])
  const [cadence, setCadence] = useState<RestockCadenceRow[]>([])
  const [pressure, setPressure] = useState<PricePressureRow[]>([])
  const [loading, setLoading] = useState(true)
  const [productSort, setProductSort] = useState<'name' | 'price' | 'status'>('status')

  useEffect(() => {
    document.title = `JOOLA INTEL — Sales: ${brandSlug}`
    fetchBrands().then(async (b) => {
      setBrands(b)
      const brand = b.find(x => x.id === brandSlug)
      const brandId = brand?.brand_id

      const [so, cad, pr] = await Promise.all([
        fetchStockoutOpportunities(b),
        fetchRestockCadence(b),
        fetchPricePressure(b),
      ])
      setStockouts(so.filter(r => r.brandSlug === brandSlug))
      setCadence(cad.filter(r => r.brandSlug === brandSlug))
      setPressure(pr.filter(r => r.brandSlug === brandSlug))

      if (brandId) {
        const [catRes, snapRes] = await Promise.all([
          supabase.from('products_catalog').select('id,display_name,category,sku').eq('brand_id', brandId).limit(100),
          supabase.from('product_snapshots').select('product_id,availability_status,price,snapshot_time')
            .eq('brand_id', brandId).order('snapshot_time', { ascending: false }).limit(500),
        ])
        const snaps = (snapRes.data || []) as { product_id: string; availability_status: string; price: number | null; snapshot_time: string }[]
        const latestSnap: Record<string, typeof snaps[0]> = {}
        snaps.forEach(s => { if (s.product_id && !latestSnap[s.product_id]) latestSnap[s.product_id] = s })
        const rows: ProductRow[] = ((catRes.data || []) as { id: string; display_name: string; category: string | null; sku: string | null }[]).map(p => {
          const snap = latestSnap[p.id]
          return {
            id: p.id, display_name: p.display_name, category: p.category, sku: p.sku,
            status: snap?.availability_status ?? 'unknown',
            price: snap?.price ?? null,
            lastSeen: snap?.snapshot_time ?? null,
          }
        })
        setProducts(rows)
      }
      setLoading(false)
    })
  }, [brandSlug])

  if (loading) return <LoadingPage />

  const brandName = pgName(brandSlug, brands)
  const color = brandColor(brandSlug)
  const isJ = brandSlug === 'joola'

  const inStock  = products.filter(p => p.status === 'in_stock').length
  const outStock = products.filter(p => p.status === 'out_of_stock').length
  const limited  = products.filter(p => p.status === 'limited').length
  const inPct    = products.length > 0 ? Math.round((inStock / products.length) * 100) : 0
  const avgPrice = products.filter(p => p.price && p.price > 0).reduce((s, p, _, a) => s + (p.price! / a.length), 0)
  const totalDemand = cadence.reduce((s, r) => s + r.demand30d, 0)

  const sortedProducts = [...products].sort((a, b) => {
    if (productSort === 'price') return (b.price ?? -1) - (a.price ?? -1)
    if (productSort === 'name') return a.display_name.localeCompare(b.display_name)
    const order = ['in_stock', 'limited', 'out_of_stock', 'unknown']
    return order.indexOf(a.status) - order.indexOf(b.status)
  })

  const patternColor = (p: string) =>
    p === 'Frequent' ? '#22c55e' : p === 'Steady' ? '#F5E625' : p === 'Occasional' ? '#fb923c' : '#6b7280'

  const maxCadenceDemand = Math.max(1, ...cadence.map(r => r.demand30d))
  const maxPressureDiscount = Math.max(1, ...pressure.map(r => Math.abs(r.discountPct ?? 0)))

  return (
    <div style={{ minHeight: '100vh' }}>

      {/* ── Hero ── */}
      <div style={{
        background: `linear-gradient(135deg, ${color}22 0%, rgba(13,17,23,0) 60%), linear-gradient(180deg, ${color}18 0%, var(--sticky-bg) 100%)`,
        borderBottom: `1px solid ${color}33`, padding: '28px 0 32px', marginBottom: 32,
      }}>
        <div style={{ marginBottom: 20 }}>
          <Breadcrumb crumbs={[
            { label: 'Sales Intel', href: '/v2/sales-intel' },
            { label: brandName },
          ]} />
          <button onClick={() => router.back()}
            style={{ background: 'var(--line)', border: '1px solid var(--wb-12)', borderRadius: 8, padding: '6px 14px', color: 'var(--fg-3)', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            ← Back
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: color, boxShadow: `0 0 28px ${color}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, color: isJ ? '#22c55e' : '#fff', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{brandName}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>Sales Intelligence · Inventory & Pricing</div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <StatCard label="Products Tracked" value={String(products.length)} sub="in catalog" color={isJ ? '#22c55e' : color} />
          <StatCard label="In Stock" value={String(inStock)} sub={`${inPct}% available`} color="#22c55e" />
          <StatCard label="Out of Stock" value={String(outStock)} sub={`${limited} limited`} color={outStock > 0 ? '#ef4444' : 'var(--fg-4)'} />
          <StatCard label="Stockout Opps" value={String(stockouts.length)} sub="competitor gaps" color={stockouts.length > 0 ? '#fb923c' : 'var(--fg-4)'} />
          <StatCard label="Avg Price" value={avgPrice > 0 ? `$${Math.round(avgPrice)}` : '—'} sub="tracked SKUs" color="#F5E625" />
          <StatCard label="Demand 30d" value={totalDemand > 0 ? fmt(totalDemand) : '—'} sub="mention signals" color="#818cf8" />
        </div>
      </div>

      {/* ── Product Catalog ── */}
      {products.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <div className="section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>Product catalog · stock status</h2>
              <div className="sub">{products.length} products · latest snapshot availability</div>
            </div>
            <div style={{ display: 'flex', gap: 4, background: 'var(--wb-5)', borderRadius: 8, padding: 3 }}>
              {(['status', 'price', 'name'] as const).map(k => (
                <button key={k} onClick={() => setProductSort(k)} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: productSort === k ? 'var(--wb-12)' : 'transparent', color: productSort === k ? 'var(--fg)' : 'var(--fg-4)', border: 'none' }}>
                  {k.charAt(0).toUpperCase() + k.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Stock health bar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200, height: 10, background: 'var(--wb-5)', borderRadius: 99, overflow: 'hidden', display: 'flex' }}>
              <div style={{ width: `${inPct}%`, background: '#22c55e' }} title={`In stock: ${inStock}`} />
              <div style={{ width: `${products.length > 0 ? (limited / products.length) * 100 : 0}%`, background: '#F5E625', opacity: 0.8 }} title={`Limited: ${limited}`} />
              <div style={{ width: `${products.length > 0 ? (outStock / products.length) * 100 : 0}%`, background: '#ef4444' }} title={`Out of stock: ${outStock}`} />
            </div>
            <div style={{ display: 'flex', gap: 14, fontSize: 11 }}>
              {[{ c: '#22c55e', l: `${inStock} in stock` }, { c: '#F5E625', l: `${limited} limited` }, { c: '#ef4444', l: `${outStock} OOS` }].map(({ c, l }) => (
                <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--fg-3)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{l}
                </span>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table className="data" style={{ width: '100%' }}>
                <thead><tr>
                  <th style={{ minWidth: 200 }}>Product</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Price</th>
                  <th>Last Snapshot</th>
                </tr></thead>
                <tbody>
                  {sortedProducts.map(p => (
                    <tr key={p.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 13 }}>{p.display_name}</div>
                        {p.sku && <div style={{ fontSize: 10, color: 'var(--fg-4)', marginTop: 2 }}>SKU: {p.sku}</div>}
                      </td>
                      <td><span style={{ fontSize: 10, color: 'var(--fg-3)' }}>{p.category ?? '—'}</span></td>
                      <td><StatusPill status={p.status} /></td>
                      <td className="cell-num" style={{ textAlign: 'right', fontFamily: 'JetBrains Mono', fontWeight: 700, color: '#F5E625' }}>
                        {p.price ? `$${p.price.toFixed(2)}` : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--fg-4)' }}>
                        {p.lastSeen ? new Date(p.lastSeen).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ── Two-col: Stockout Opps + Price Pressure ── */}
      <div style={{ display: 'grid', gridTemplateColumns: stockouts.length > 0 && pressure.length > 0 ? '1fr 1fr' : '1fr', gap: 16, marginBottom: 32 }}>

        {/* Stockout Opportunities */}
        {stockouts.length > 0 && (
          <section>
            <div className="section-head">
              <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>Stockout opportunities</h2>
              <div className="sub">{stockouts.length} competitor gaps · demand vs availability</div>
            </div>
            <div className="card"><div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {stockouts.map((r, i) => (
                <div key={i} style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--wb-3)', border: '1px solid rgba(251,146,60,0.2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg)' }}>{r.productName}</span>
                    <span className={`pill ${r.status === 'in_stock' ? 'pill-green' : r.status === 'limited' ? 'pill-amber' : 'pill-red'}`} style={{ fontSize: 9, flexShrink: 0 }}>{r.status.replace(/_/g, ' ')}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
                    <span style={{ color: '#818cf8' }}>📊 {r.demand30d} demand 30d</span>
                    {r.joolaComparableName && <span style={{ color: 'var(--fg-4)' }}>vs {r.joolaComparableName}</span>}
                  </div>
                  {r.action && <div style={{ fontSize: 11, color: '#fb923c', fontStyle: 'italic' }}>→ {r.action}</div>}
                </div>
              ))}
            </div></div>
          </section>
        )}

        {/* Price Pressure */}
        {pressure.length > 0 && (
          <section>
            <div className="section-head">
              <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>Price pressure</h2>
              <div className="sub">{pressure.length} products with pricing signals</div>
            </div>
            <div className="card"><div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {pressure.map((r, i) => {
                const disc = r.discountPct ?? 0
                return (
                  <div key={i} style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--wb-3)', border: '1px solid var(--wb-6)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg)' }}>{r.productName}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: r.currentPrice ? '#F5E625' : 'var(--fg-4)', fontFamily: 'JetBrains Mono', flexShrink: 0 }}>
                        {r.currentPrice ? `$${r.currentPrice}` : '—'}
                      </span>
                    </div>
                    {disc !== 0 && (
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 11 }}>
                        <span style={{ color: disc < 0 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>{disc < 0 ? `↓ ${Math.abs(disc).toFixed(1)}% discount` : `↑ ${disc.toFixed(1)}% premium`}</span>
                        <div style={{ flex: 1, height: 4, background: 'var(--wb-5)', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(100, (Math.abs(disc) / maxPressureDiscount) * 100)}%`, background: disc < 0 ? '#22c55e' : '#ef4444', borderRadius: 99 }} />
                        </div>
                      </div>
                    )}
                    {r.action && <div style={{ fontSize: 10, color: 'var(--fg-4)', fontStyle: 'italic' }}>→ {r.action}</div>}
                  </div>
                )
              })}
            </div></div>
          </section>
        )}
      </div>

      {/* ── Restock Cadence ── */}
      {cadence.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <div className="section-head">
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>Restock cadence</h2>
            <div className="sub">{cadence.length} products with restock history</div>
          </div>
          <div className="card"><div className="card-pad">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {cadence.map((r, i) => {
                const pc = patternColor(r.pattern)
                return (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 100px 80px', gap: 14, alignItems: 'center', padding: '10px 12px', borderRadius: 8, background: 'var(--wb-3)', border: '1px solid var(--wb-6)' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>{r.productName}</div>
                      {r.mostRecent && <div style={{ fontSize: 10, color: 'var(--fg-4)', marginTop: 2 }}>Last restock: {new Date(r.mostRecent).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1, height: 5, background: 'var(--wb-5)', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${(r.demand30d / maxCadenceDemand) * 100}%`, background: '#818cf8', borderRadius: 99 }} />
                      </div>
                      <span style={{ fontSize: 10, color: '#818cf8', fontFamily: 'JetBrains Mono', whiteSpace: 'nowrap' }}>{r.demand30d}</span>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: pc + '18', color: pc, border: `1px solid ${pc}44`, whiteSpace: 'nowrap', textAlign: 'center' }}>{r.pattern}</span>
                    <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'JetBrains Mono', textAlign: 'right' }}>
                      {r.avgDaysBetween != null ? `~${r.avgDaysBetween}d` : '—'}
                    </span>
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 20, marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--wb-6)', fontSize: 10, color: 'var(--fg-4)' }}>
              <span>Demand 30d = mention volume · Avg days = mean gap between restock events</span>
            </div>
          </div></div>
        </section>
      )}

      {products.length === 0 && stockouts.length === 0 && cadence.length === 0 && pressure.length === 0 && (
        <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)', fontSize: 13 }}>
          No sales intelligence data found for {brandName}. Run the pipeline to populate product snapshots.
        </div>
      )}
    </div>
  )
}
