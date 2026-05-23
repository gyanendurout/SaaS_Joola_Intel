'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { PageHead, MiniKpi, SectionInfo, LoadingPage } from '@/components/v2/PageShell'
import { fmt } from '@/components/v2/charts'

// ─── Types ───────────────────────────────────────────────────────────
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

interface ProductSnapshot {
  brand_id: string
  product_id: string | null
  snapshot_time: string
  price: number | null
  availability_status: string
  visible_inventory_qty: number | null
  inventory_signal_type: string | null
  inventory_confidence: string
}

interface ProductVariant {
  id: string
  brand_id: string
  product_id: string | null
  availability_status: string
}

// ─── Brand color helpers ─────────────────────────────────────────────
const BRAND_COLORS: Record<string, string> = {
  joola: '#22c55e',
  selkirk: '#3b82f6',
  crbn: '#8b5cf6',
  'six-zero': '#f59e0b',
  paddletek: '#ec4899',
  engage: '#14b8a6',
  onix: '#f97316',
  franklin: '#a78bfa',
  head: '#06b6d4',
  wilson: '#84cc16',
  gamma: '#fb7185',
}

function brandColor(slug: string): string {
  return BRAND_COLORS[slug] ?? '#94a3b8'
}

// ─── Time formatter ──────────────────────────────────────────────────
function formatSnapshotTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const month = d.toLocaleString('en-US', { month: 'short' })
  const day = d.getDate()
  let hours = d.getHours()
  const mins = String(d.getMinutes()).padStart(2, '0')
  const ampm = hours >= 12 ? 'pm' : 'am'
  hours = hours % 12 || 12
  return `${month} ${day}, ${hours}:${mins}${ampm}`
}

// ─── Status helpers ──────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  in_stock: '#22c55e',
  out_of_stock: '#ef4444',
  limited: '#f59e0b',
}

function statusBorderColor(status: string): string {
  return STATUS_COLORS[status] ?? 'rgba(255,255,255,0.08)'
}

function StatusPill({ status }: { status: string }) {
  if (status === 'in_stock') {
    return <span className="pill pill-green">in stock</span>
  }
  const c = STATUS_COLORS[status] ?? '#94a3b8'
  return (
    <span
      className="pill"
      style={{
        background: `${c}1a`,
        color: c,
        border: `1px solid ${c}55`,
      }}
    >
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function ConfidenceBadge({ level }: { level: 'high' | 'low' }) {
  if (level === 'high') {
    return <span className="pill pill-green" style={{ fontSize: 10 }}>High signal</span>
  }
  return <span className="pill pill-ghost" style={{ fontSize: 10 }}>Low signal</span>
}

// ─── Supabase client ─────────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

// ─── Page ────────────────────────────────────────────────────────────
export default function SalesIntelPage() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [products, setProducts] = useState<ProductCatalog[]>([])
  const [snapshots, setSnapshots] = useState<ProductSnapshot[]>([])
  const [variants, setVariants] = useState<ProductVariant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'JOOLA INTEL — Sales Intelligence'
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [bRes, pRes, sRes, vRes] = await Promise.all([
          supabase.from('brands').select('id, slug, name'),
          supabase
            .from('products_catalog')
            .select('id, brand_id, display_name, sku, category'),
          supabase
            .from('product_snapshots')
            .select(
              'brand_id, product_id, snapshot_time, price, availability_status, visible_inventory_qty, inventory_signal_type, inventory_confidence',
            )
            .order('snapshot_time', { ascending: false })
            .limit(2000),
          supabase
            .from('product_variants')
            .select('id, brand_id, product_id, availability_status')
            .limit(500),
        ])

        if (cancelled) return

        if (bRes.error) throw bRes.error
        if (pRes.error) throw pRes.error
        if (sRes.error) throw sRes.error
        if (vRes.error) throw vRes.error

        setBrands((bRes.data as Brand[] | null) ?? [])
        setProducts((pRes.data as ProductCatalog[] | null) ?? [])
        setSnapshots((sRes.data as ProductSnapshot[] | null) ?? [])
        setVariants((vRes.data as ProductVariant[] | null) ?? [])
        setLoading(false)
      } catch (err: unknown) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Unable to load sales intel data.'
        setError(msg)
        setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // ─── Derived data ──────────────────────────────────────────────────
  const brandById = useMemo(() => {
    const m = new Map<string, Brand>()
    for (const b of brands) m.set(b.id, b)
    return m
  }, [brands])

  const productById = useMemo(() => {
    const m = new Map<string, ProductCatalog>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])

  // Most recent snapshot per product (snapshots already DESC by time)
  const latestByProduct = useMemo(() => {
    const m = new Map<string, ProductSnapshot>()
    for (const s of snapshots) {
      if (!s.product_id) continue
      if (!m.has(s.product_id)) m.set(s.product_id, s)
    }
    return m
  }, [snapshots])

  const latestSnapshots = useMemo(() => Array.from(latestByProduct.values()), [latestByProduct])

  const kpis = useMemo(() => {
    const totalProducts = latestSnapshots.length
    const inStock = latestSnapshots.filter((s) => s.availability_status === 'in_stock').length
    const outStock = latestSnapshots.filter((s) => s.availability_status === 'out_of_stock').length
    const brandsWithData = Array.from(new Set(latestSnapshots.map((s) => s.brand_id))).length
    return {
      totalProducts,
      inStockPct: totalProducts > 0 ? (inStock / totalProducts) * 100 : 0,
      outStockPct: totalProducts > 0 ? (outStock / totalProducts) * 100 : 0,
      brandsWithData,
    }
  }, [latestSnapshots])

  // Per-brand inventory grid
  const brandCards = useMemo(() => {
    type Card = {
      brand: Brand
      latestTime: string | null
      inStock: number
      outStock: number
      limited: number
      total: number
      confidence: 'high' | 'low'
    }
    const cards: Card[] = []
    for (const b of brands) {
      const brandSnaps = latestSnapshots.filter((s) => s.brand_id === b.id)
      if (brandSnaps.length === 0) continue
      const inStock = brandSnaps.filter((s) => s.availability_status === 'in_stock').length
      const outStock = brandSnaps.filter((s) => s.availability_status === 'out_of_stock').length
      const limited = brandSnaps.filter((s) => s.availability_status === 'limited').length
      const allBrandSnaps = snapshots.filter((s) => s.brand_id === b.id)
      const latestTime = allBrandSnaps[0]?.snapshot_time ?? null
      const highSignalCount = allBrandSnaps.filter((s) => {
        const t = s.inventory_signal_type ?? ''
        return t === 'json_ld' || t === 'shopify_json'
      }).length
      const confidence: 'high' | 'low' =
        allBrandSnaps.length > 0 && highSignalCount / allBrandSnaps.length >= 0.5
          ? 'high'
          : 'low'
      cards.push({
        brand: b,
        latestTime,
        inStock,
        outStock,
        limited,
        total: brandSnaps.length,
        confidence,
      })
    }
    // JOOLA first, then by total products desc
    cards.sort((a, b) => {
      if (a.brand.slug === 'joola') return -1
      if (b.brand.slug === 'joola') return 1
      return b.total - a.total
    })
    return cards
  }, [brands, latestSnapshots, snapshots])

  // Stock events timeline — latest 50 with availability_status changes
  const stockEvents = useMemo(() => snapshots.slice(0, 50), [snapshots])

  // Price landscape — latest price per product
  const priceRows = useMemo(() => {
    const rows: Array<{
      productId: string
      brandId: string
      slug: string
      brandName: string
      productName: string
      price: number
    }> = []
    for (const s of latestSnapshots) {
      if (!s.product_id || s.price == null || s.price <= 0) continue
      const p = productById.get(s.product_id)
      const b = brandById.get(s.brand_id)
      if (!p || !b) continue
      rows.push({
        productId: s.product_id,
        brandId: s.brand_id,
        slug: b.slug,
        brandName: b.name,
        productName: p.display_name,
        price: s.price,
      })
    }
    rows.sort((a, b) => b.price - a.price)
    return rows
  }, [latestSnapshots, productById, brandById])

  const maxPrice = priceRows[0]?.price ?? 1

  // Revenue signal ranking
  const revenueRows = useMemo(() => {
    type Row = {
      brand: Brand
      avgPrice: number
      products: number
      signal: 'high' | 'medium' | 'low'
    }
    const rows: Row[] = []
    for (const b of brands) {
      const brandSnaps = latestSnapshots.filter(
        (s) => s.brand_id === b.id && s.price != null && s.price > 0,
      )
      if (brandSnaps.length === 0) continue
      const avgPrice =
        brandSnaps.reduce((sum, s) => sum + (s.price ?? 0), 0) / brandSnaps.length
      const productCount = brandSnaps.length
      const signal: 'high' | 'medium' | 'low' =
        productCount >= 8 ? 'high' : productCount >= 3 ? 'medium' : 'low'
      rows.push({ brand: b, avgPrice, products: productCount, signal })
    }
    rows.sort((a, b) => b.avgPrice - a.avgPrice)
    return rows
  }, [brands, latestSnapshots])

  // ─── Render ────────────────────────────────────────────────────────
  if (loading) return <LoadingPage />

  if (error) {
    return (
      <div style={{ padding: '80px 32px', textAlign: 'center' }}>
        <div style={{ color: '#ef4444', fontSize: 14, marginBottom: 16 }}>{error}</div>
        <button className="btn btn-yellow" onClick={() => window.location.reload()}>
          Refresh page
        </button>
      </div>
    )
  }

  const hasSnapshots = snapshots.length > 0

  return (
    <>
      <PageHead
        eyebrow="Sales Intelligence"
        title="Inventory & Revenue"
        accent="Signals"
        sub={`Stock signals and estimated sales velocity across ${brands.length} brands`}
      />

      {/* ─── KPI Bar ───────────────────────────────────────────────── */}
      <section>
        <div className="kpi-grid">
          <MiniKpi
            label="Products tracked"
            src="product_snapshots · latest per product"
            value={fmt(kpis.totalProducts)}
            color="#F5E625"
            customVs={`${products.length} in catalog`}
          />
          <MiniKpi
            label="In stock"
            src="latest snapshot availability"
            flavor="joola"
            value={kpis.inStockPct.toFixed(1) + '%'}
            color="#22c55e"
            customVs={`${Math.round((kpis.inStockPct / 100) * kpis.totalProducts)} of ${kpis.totalProducts} SKUs`}
          />
          <MiniKpi
            label="Out of stock"
            src="latest snapshot availability"
            value={kpis.outStockPct.toFixed(1) + '%'}
            color="#ef4444"
            customVs={`${Math.round((kpis.outStockPct / 100) * kpis.totalProducts)} SKUs unavailable`}
          />
          <MiniKpi
            label="Brands with data"
            value={fmt(kpis.brandsWithData)}
            color="#818cf8"
            customVs={`of ${brands.length} tracked`}
          />
        </div>
      </section>

      {/* ─── Section 1: Inventory Status Grid ─────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Inventory status by brand
              <SectionInfo
                title="Inventory Status Grid"
                description="One card per brand showing the latest stock breakdown across tracked products. Confidence reflects whether the underlying scrape pulled structured signals (JSON-LD or Shopify JSON) versus heuristic page parsing."
                source="product_snapshots · latest per product, grouped by brand"
              />
            </h2>
            <div className="sub">Latest snapshot per product, grouped by brand.</div>
          </div>
        </div>

        {!hasSnapshots || brandCards.length === 0 ? (
          <div
            className="card"
            style={{
              textAlign: 'center',
              padding: '48px 24px',
              color: '#6b7280',
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>🏪</div>
            <div style={{ fontSize: 14 }}>
              Inventory data will appear after the weekly scrape completes.
            </div>
            <div style={{ fontSize: 12, marginTop: 8, opacity: 0.6 }}>
              Pipeline scrapes product pages every Monday at 07:00 IST.
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            {brandCards.map((c) => {
              const isJoola = c.brand.slug === 'joola'
              const color = brandColor(c.brand.slug)
              return (
                <div
                  key={c.brand.id}
                  className="card"
                  style={{
                    padding: 16,
                    borderLeft: `3px solid ${color}`,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      gap: 8,
                      marginBottom: 6,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: 14,
                        color: isJoola ? '#22c55e' : '#fff',
                      }}
                    >
                      {c.brand.name}
                    </div>
                    <ConfidenceBadge level={c.confidence} />
                  </div>

                  <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 12 }}>
                    {c.latestTime ? formatSnapshotTime(c.latestTime) : 'No snapshot yet'}
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 6,
                      marginBottom: 10,
                    }}
                  >
                    <span className="pill pill-green" style={{ fontSize: 10 }}>
                      {c.inStock} in stock
                    </span>
                    {c.outStock > 0 && (
                      <span
                        className="pill"
                        style={{
                          fontSize: 10,
                          background: 'rgba(239,68,68,0.1)',
                          color: '#ef4444',
                          border: '1px solid rgba(239,68,68,0.3)',
                        }}
                      >
                        {c.outStock} out
                      </span>
                    )}
                    {c.limited > 0 && (
                      <span className="pill pill-amber" style={{ fontSize: 10 }}>
                        {c.limited} limited
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      fontSize: 11,
                      color: '#9ca3af',
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                      paddingTop: 8,
                    }}
                  >
                    <span style={{ color: '#fff', fontWeight: 700 }}>{c.total}</span>{' '}
                    product{c.total === 1 ? '' : 's'} tracked
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ─── Section 2: Stock Events Timeline ─────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Stock events · latest 50
              <SectionInfo
                title="Stock Events Timeline"
                description="Chronological feed of the most recent product snapshots. Each row represents one observation: when we checked, what brand and product, what status we saw, and how confident the signal is. Out-of-stock rows are flagged in red as immediate competitive opportunities."
                source="product_snapshots · ordered by snapshot_time DESC, limit 50"
              />
            </h2>
            <div className="sub">
              Newest first. Color stripe on each row encodes availability.
            </div>
          </div>
        </div>

        {stockEvents.length === 0 ? (
          <div
            className="card"
            style={{
              textAlign: 'center',
              padding: '36px 24px',
              color: '#6b7280',
              fontSize: 13,
            }}
          >
            No stock events recorded yet.
          </div>
        ) : (
          <div className="card">
            <div className="table-wrap" style={{ overflowX: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>Time</th>
                    <th>Brand</th>
                    <th>Product</th>
                    <th>Status</th>
                    <th>Price</th>
                    <th>Signal</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {stockEvents.map((s, i) => {
                    const brand = brandById.get(s.brand_id)
                    const product = s.product_id ? productById.get(s.product_id) : null
                    const stripe = statusBorderColor(s.availability_status)
                    const color = brand ? brandColor(brand.slug) : '#94a3b8'
                    return (
                      <tr key={i} style={{ borderLeft: `2px solid ${stripe}` }}>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 11, color: '#9ca3af' }}>
                          {formatSnapshotTime(s.snapshot_time)}
                        </td>
                        <td>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <span
                              className="brand-dot"
                              style={{ background: color }}
                            />
                            <span
                              style={{
                                fontWeight: 700,
                                color: brand?.slug === 'joola' ? '#22c55e' : 'var(--fg)',
                              }}
                            >
                              {brand?.name ?? s.brand_id}
                            </span>
                          </span>
                        </td>
                        <td style={{ color: 'var(--fg)' }}>
                          {product?.display_name ?? '—'}
                        </td>
                        <td>
                          <StatusPill status={s.availability_status} />
                        </td>
                        <td className="cell-num" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {s.price != null && s.price > 0 ? '$' + s.price.toFixed(2) : '—'}
                        </td>
                        <td>
                          <span className="pill pill-ghost" style={{ fontSize: 10 }}>
                            {s.inventory_signal_type ?? 'unknown'}
                          </span>
                        </td>
                        <td>
                          <span
                            className={
                              'pill ' +
                              (s.inventory_confidence === 'high'
                                ? 'pill-green'
                                : s.inventory_confidence === 'medium'
                                  ? 'pill-amber'
                                  : 'pill-ghost')
                            }
                            style={{ fontSize: 10 }}
                          >
                            {s.inventory_confidence}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ─── Section 3: Price Landscape ───────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Price landscape
              <SectionInfo
                title="Price Landscape"
                description="Current observed price per product (latest snapshot), sorted by price descending. The mini-bar visualizes price relative to the most expensive paddle on the market. Useful for spotting where JOOLA sits in the premium / mid / value bands."
                source="product_snapshots · latest price per product, joined to products_catalog"
              />
            </h2>
            <div className="sub">Latest observed price per SKU. Sorted high to low.</div>
          </div>
        </div>

        {priceRows.length === 0 ? (
          <div
            className="card"
            style={{
              textAlign: 'center',
              padding: '36px 24px',
              color: '#6b7280',
              fontSize: 13,
            }}
          >
            No price data captured yet.
          </div>
        ) : (
          <div className="card">
            <div className="table-wrap" style={{ overflowX: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th style={{ width: 140 }}>Brand</th>
                    <th style={{ width: '40%' }}>Relative price</th>
                    <th style={{ width: 90, textAlign: 'right' }}>Price</th>
                  </tr>
                </thead>
                <tbody>
                  {priceRows.slice(0, 60).map((r) => {
                    const color = brandColor(r.slug)
                    const pct = (r.price / maxPrice) * 100
                    return (
                      <tr
                        key={r.productId}
                        className={r.slug === 'joola' ? 'joola' : ''}
                      >
                        <td style={{ color: 'var(--fg)' }}>{r.productName}</td>
                        <td>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <span
                              className="brand-dot"
                              style={{ background: color }}
                            />
                            <span
                              style={{
                                fontWeight: 700,
                                color: r.slug === 'joola' ? '#22c55e' : 'var(--fg)',
                                fontSize: 12,
                              }}
                            >
                              {r.brandName}
                            </span>
                          </span>
                        </td>
                        <td>
                          <div
                            style={{
                              background: 'rgba(255,255,255,0.04)',
                              borderRadius: 4,
                              height: 8,
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                background: `linear-gradient(90deg, ${color}66, ${color}1a)`,
                                borderRadius: 4,
                                height: 8,
                                width: `${Math.max(2, pct)}%`,
                              }}
                            />
                          </div>
                        </td>
                        <td
                          className="cell-num"
                          style={{
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                            fontWeight: 700,
                          }}
                        >
                          ${r.price.toFixed(2)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ─── Section 4: Revenue Estimate ──────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Revenue signal · per brand
              <SectionInfo
                title="Revenue Estimate"
                description="A rough proxy for sales activity built from inventory scan completeness. Brands with broad product coverage and consistent snapshots earn a 'high' signal — they're easier to estimate from. This is NOT official sales data; it is a coverage-quality indicator that should be used alongside official figures."
                source="product_snapshots · brand-level avg price + product coverage"
              />
            </h2>
            <div className="sub">
              Estimates based on inventory signal patterns — not official sales data.
            </div>
          </div>
        </div>

        <div
          className="card"
          style={{
            background: 'rgba(245,158,11,0.06)',
            border: '1px solid rgba(245,158,11,0.25)',
            padding: 12,
            marginBottom: 12,
            fontSize: 12,
            color: '#fbbf24',
          }}
        >
          <strong>Disclaimer:</strong> The figures below are derived from public
          inventory signals and product coverage. They estimate visibility and
          competitive activity — not actual revenue. Pair with official sales
          data when available.
        </div>

        {revenueRows.length === 0 ? (
          <div
            className="card"
            style={{
              textAlign: 'center',
              padding: '36px 24px',
              color: '#6b7280',
              fontSize: 13,
            }}
          >
            No revenue signals yet — waiting on price data.
          </div>
        ) : (
          <div className="card">
            <div className="table-wrap" style={{ overflowX: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>Brand</th>
                    <th style={{ textAlign: 'right' }}>Avg price</th>
                    <th style={{ textAlign: 'right' }}>Products</th>
                    <th>Revenue signal</th>
                  </tr>
                </thead>
                <tbody>
                  {revenueRows.map((r, i) => {
                    const color = brandColor(r.brand.slug)
                    const isJoola = r.brand.slug === 'joola'
                    const pillClass =
                      r.signal === 'high'
                        ? 'pill-green'
                        : r.signal === 'medium'
                          ? 'pill-amber'
                          : 'pill-ghost'
                    return (
                      <tr
                        key={r.brand.id}
                        className={isJoola ? 'joola' : ''}
                      >
                        <td style={{ color: '#6b7280', fontWeight: 700 }}>{i + 1}</td>
                        <td>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <span
                              className="brand-dot"
                              style={{ background: color }}
                            />
                            <span
                              style={{
                                fontWeight: 700,
                                color: isJoola ? '#22c55e' : 'var(--fg)',
                              }}
                            >
                              {r.brand.name}
                            </span>
                          </span>
                        </td>
                        <td
                          className="cell-num"
                          style={{
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          ${r.avgPrice.toFixed(2)}
                        </td>
                        <td
                          className="cell-num"
                          style={{
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {r.products}
                        </td>
                        <td>
                          <span className={'pill ' + pillClass}>{r.signal}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div
              style={{
                fontSize: 10,
                color: '#6b7280',
                padding: '8px 16px 12px',
                borderTop: '1px solid rgba(255,255,255,0.04)',
              }}
            >
              Tracking {variants.length} product variants across {kpis.brandsWithData} brands.
            </div>
          </div>
        )}
      </section>
    </>
  )
}
