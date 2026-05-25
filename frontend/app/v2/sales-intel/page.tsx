'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { PageHead, MiniKpi, SectionInfo, LoadingPage, SortTh, ColumnFilter, pgColor } from '@/components/v2/PageShell'
import { fmt, ScatterChart, type ScatterDatum } from '@/components/v2/charts'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import {
  fetchStockoutOpportunities,
  fetchRestockCadence,
  fetchPricePressure,
  fetchAttentionAvailability,
  type StockoutOpportunityRow,
  type RestockCadenceRow,
  type PricePressureRow,
  type AttentionAvailabilityPoint,
} from '@/lib/v2/productIntel'
import { ActionFrame, Caveat } from '@/components/v2/ActionFrame'

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
  // Standard pill classes: in-stock → pill-green, out-of-stock → pill-red,
  // limited/low → pill-amber, unknown/other → pill-ghost.
  const label = status.replace(/_/g, ' ')
  if (status === 'in_stock') return <span className="pill pill-green">{label}</span>
  if (status === 'out_of_stock') return <span className="pill pill-red">{label}</span>
  if (status === 'limited' || status === 'low') return <span className="pill pill-amber">{label}</span>
  return <span className="pill pill-ghost">{label}</span>
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

  // ── New section state (Sections F-I) ──────────────────────────────
  const [stockoutRows, setStockoutRows] = useState<StockoutOpportunityRow[]>([])
  const [cadenceRows, setCadenceRows] = useState<RestockCadenceRow[]>([])
  const [priceRows2, setPriceRows2] = useState<PricePressureRow[]>([])
  const [attAvailPoints, setAttAvailPoints] = useState<AttentionAvailabilityPoint[]>([])

  // Per-table sort + per-column filter state (standardization)
  const [stockSortKey, setStockSortKey] = useState<string | null>(null)
  const [stockSortDir, setStockSortDir] = useState<'asc' | 'desc'>('desc')
  const [stockColFilter, setStockColFilter] = useState<Record<string, string>>({})

  const [priceSortKey, setPriceSortKey] = useState<string | null>(null)
  const [priceSortDir, setPriceSortDir] = useState<'asc' | 'desc'>('desc')
  const [priceColFilter, setPriceColFilter] = useState<Record<string, string>>({})

  const [revSortKey, setRevSortKey] = useState<string | null>(null)
  const [revSortDir, setRevSortDir] = useState<'asc' | 'desc'>('desc')
  const [revColFilter, setRevColFilter] = useState<Record<string, string>>({})

  function toggleStock(k: string) {
    if (stockSortKey === k) setStockSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setStockSortKey(k); setStockSortDir('desc') }
  }
  function togglePrice(k: string) {
    if (priceSortKey === k) setPriceSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setPriceSortKey(k); setPriceSortDir('desc') }
  }
  function toggleRev(k: string) {
    if (revSortKey === k) setRevSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setRevSortKey(k); setRevSortDir('desc') }
  }

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

        // Sections F-I: load the productIntel-derived datasets
        const brandsV2 = await fetchBrands().catch(() => [] as V2Brand[])
        if (cancelled) return
        const [stockout, cadence, pressure, attAvail] = await Promise.all([
          fetchStockoutOpportunities(brandsV2).catch(() => [] as StockoutOpportunityRow[]),
          fetchRestockCadence(brandsV2).catch(() => [] as RestockCadenceRow[]),
          fetchPricePressure(brandsV2).catch(() => [] as PricePressureRow[]),
          fetchAttentionAvailability(brandsV2).catch(() => [] as AttentionAvailabilityPoint[]),
        ])
        if (cancelled) return
        setStockoutRows(stockout)
        setCadenceRows(cadence)
        setPriceRows2(pressure)
        setAttAvailPoints(attAvail)

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

  // Stock events timeline — latest 200 snapshots (bumped from 50 for standardization)
  const stockEvents = useMemo(() => {
    return snapshots.slice(0, 200).map((s) => {
      const brand = brandById.get(s.brand_id)
      const product = s.product_id ? productById.get(s.product_id) : null
      return {
        snap: s,
        brandName: brand?.name ?? s.brand_id,
        brandSlug: brand?.slug ?? '',
        productName: product?.display_name ?? '—',
        status: s.availability_status,
        priceVal: s.price ?? 0,
        signal: s.inventory_signal_type ?? 'unknown',
        confidence: s.inventory_confidence,
        time: s.snapshot_time,
      }
    })
  }, [snapshots, brandById, productById])

  const displayStockEvents = useMemo(() => {
    const filtered = stockEvents.filter(r => {
      return Object.entries(stockColFilter).every(([col, q]) => {
        if (!q) return true
        const rec = r as unknown as Record<string, unknown>
        return String(rec[col] ?? '').toLowerCase().includes(q.toLowerCase())
      })
    })
    if (!stockSortKey) return filtered
    return [...filtered].sort((a, b) => {
      const rec = (x: typeof a) => x as unknown as Record<string, unknown>
      const av = rec(a)[stockSortKey], bv = rec(b)[stockSortKey]
      if (typeof av === 'number' && typeof bv === 'number') return stockSortDir === 'asc' ? av - bv : bv - av
      return stockSortDir === 'asc'
        ? String(av ?? '').localeCompare(String(bv ?? ''))
        : String(bv ?? '').localeCompare(String(av ?? ''))
    })
  }, [stockEvents, stockColFilter, stockSortKey, stockSortDir])

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

  const displayPriceRows = useMemo(() => {
    const filtered = priceRows.filter(r => {
      return Object.entries(priceColFilter).every(([col, q]) => {
        if (!q) return true
        const rec = r as unknown as Record<string, unknown>
        return String(rec[col] ?? '').toLowerCase().includes(q.toLowerCase())
      })
    })
    if (!priceSortKey) return filtered
    return [...filtered].sort((a, b) => {
      const av = (a as Record<string, unknown>)[priceSortKey]
      const bv = (b as Record<string, unknown>)[priceSortKey]
      if (typeof av === 'number' && typeof bv === 'number') return priceSortDir === 'asc' ? av - bv : bv - av
      return priceSortDir === 'asc'
        ? String(av ?? '').localeCompare(String(bv ?? ''))
        : String(bv ?? '').localeCompare(String(av ?? ''))
    })
  }, [priceRows, priceColFilter, priceSortKey, priceSortDir])

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

  const displayRevenueRows = useMemo(() => {
    const filtered = revenueRows.filter(r => {
      return Object.entries(revColFilter).every(([col, q]) => {
        if (!q) return true
        const cell = col === 'brand' ? r.brand.name : ''
        return cell.toLowerCase().includes(q.toLowerCase())
      })
    })
    if (!revSortKey) return filtered
    return [...filtered].sort((a, b) => {
      if (revSortKey === 'brand') {
        return revSortDir === 'asc' ? a.brand.name.localeCompare(b.brand.name) : b.brand.name.localeCompare(a.brand.name)
      }
      const av = (a as unknown as Record<string, unknown>)[revSortKey]
      const bv = (b as unknown as Record<string, unknown>)[revSortKey]
      if (typeof av === 'number' && typeof bv === 'number') return revSortDir === 'asc' ? av - bv : bv - av
      return revSortDir === 'asc'
        ? String(av ?? '').localeCompare(String(bv ?? ''))
        : String(bv ?? '').localeCompare(String(av ?? ''))
    })
  }, [revenueRows, revColFilter, revSortKey, revSortDir])

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
              Stock events · latest 200
              <SectionInfo
                title="Stock Events Timeline"
                description="Chronological feed of the most recent product snapshots. Each row represents one observation: when we checked, what brand and product, what status we saw, and how confident the signal is. Out-of-stock rows are flagged in red as immediate competitive opportunities."
                source="product_snapshots · ordered by snapshot_time DESC, limit 200"
              />
            </h2>
            <div className="sub">
              Showing <strong style={{ color: 'var(--fg)' }}>{displayStockEvents.length}</strong> of up to 200 ·
              {' '}click column headers to sort. Color stripe encodes availability.
            </div>
          </div>
        </div>

        <div className="card">
          {displayStockEvents.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>No rows found for the selected filters.</div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto', overflowX: 'auto' }}>
              <table className="data">
                <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
                  <tr>
                    <SortTh col="time" label="Time" sortKey={stockSortKey} sortDir={stockSortDir} toggle={toggleStock} style={{ width: 130 }} />
                    <SortTh col="brandName" label="Brand" sortKey={stockSortKey} sortDir={stockSortDir} toggle={toggleStock} />
                    <SortTh col="productName" label="Product" sortKey={stockSortKey} sortDir={stockSortDir} toggle={toggleStock} />
                    <SortTh col="status" label="Status" sortKey={stockSortKey} sortDir={stockSortDir} toggle={toggleStock} />
                    <SortTh col="priceVal" label="Price" sortKey={stockSortKey} sortDir={stockSortDir} toggle={toggleStock} style={{ textAlign: 'right' }} />
                    <SortTh col="signal" label="Signal" sortKey={stockSortKey} sortDir={stockSortDir} toggle={toggleStock} />
                    <SortTh col="confidence" label="Confidence" sortKey={stockSortKey} sortDir={stockSortDir} toggle={toggleStock} />
                  </tr>
                  <tr className="col-filter-row">
                    <th />
                    <th><ColumnFilter col="brandName" value={stockColFilter.brandName} onChange={v => setStockColFilter(p => ({ ...p, brandName: v }))} placeholder="brand…" /></th>
                    <th><ColumnFilter col="productName" value={stockColFilter.productName} onChange={v => setStockColFilter(p => ({ ...p, productName: v }))} placeholder="product…" /></th>
                    <th><ColumnFilter col="status" value={stockColFilter.status} onChange={v => setStockColFilter(p => ({ ...p, status: v }))} placeholder="status…" /></th>
                    <th colSpan={3} />
                  </tr>
                </thead>
                <tbody>
                  {displayStockEvents.map((r, i) => {
                    const stripe = statusBorderColor(r.status)
                    const color = brandColor(r.brandSlug)
                    return (
                      <tr key={i} style={{ borderLeft: `2px solid ${stripe}` }}>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 11, color: '#9ca3af' }}>
                          {formatSnapshotTime(r.time)}
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span className="brand-dot" style={{ background: color }} />
                            <span style={{ fontWeight: 700, color: r.brandSlug === 'joola' ? '#22c55e' : 'var(--fg)' }}>
                              {r.brandName}
                            </span>
                          </span>
                        </td>
                        <td style={{ color: 'var(--fg)' }}>{r.productName}</td>
                        <td><StatusPill status={r.status} /></td>
                        <td className="cell-num" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {r.priceVal > 0 ? '$' + r.priceVal.toFixed(2) : '—'}
                        </td>
                        <td>
                          <span className="pill pill-ghost" style={{ fontSize: 10 }}>{r.signal}</span>
                        </td>
                        <td>
                          <span className={'pill ' + (r.confidence === 'high' ? 'pill-green' : r.confidence === 'medium' ? 'pill-amber' : 'pill-ghost')} style={{ fontSize: 10 }}>
                            {r.confidence}
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
            <div className="sub">
              Showing <strong style={{ color: 'var(--fg)' }}>{displayPriceRows.slice(0, 200).length}</strong> of up to 200 ·
              {' '}click column headers to sort.
            </div>
          </div>
        </div>

        <div className="card">
          {displayPriceRows.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>No rows found for the selected filters.</div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto', overflowX: 'auto' }}>
              <table className="data">
                <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
                  <tr>
                    <SortTh col="productName" label="Product" sortKey={priceSortKey} sortDir={priceSortDir} toggle={togglePrice} />
                    <SortTh col="brandName" label="Brand" sortKey={priceSortKey} sortDir={priceSortDir} toggle={togglePrice} style={{ width: 140 }} />
                    <th style={{ width: '40%' }}>Relative price</th>
                    <SortTh col="price" label="Price" sortKey={priceSortKey} sortDir={priceSortDir} toggle={togglePrice} style={{ width: 90, textAlign: 'right' }} />
                  </tr>
                  <tr className="col-filter-row">
                    <th><ColumnFilter col="productName" value={priceColFilter.productName} onChange={v => setPriceColFilter(p => ({ ...p, productName: v }))} placeholder="product…" /></th>
                    <th><ColumnFilter col="brandName" value={priceColFilter.brandName} onChange={v => setPriceColFilter(p => ({ ...p, brandName: v }))} placeholder="brand…" /></th>
                    <th colSpan={2} />
                  </tr>
                </thead>
                <tbody>
                  {displayPriceRows.slice(0, 200).map((r) => {
                    const color = brandColor(r.slug)
                    const pct = (r.price / maxPrice) * 100
                    return (
                      <tr key={r.productId} className={r.slug === 'joola' ? 'joola' : ''}>
                        <td style={{ color: 'var(--fg)' }}>{r.productName}</td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span className="brand-dot" style={{ background: color }} />
                            <span style={{ fontWeight: 700, color: r.slug === 'joola' ? '#22c55e' : 'var(--fg)', fontSize: 12 }}>
                              {r.brandName}
                            </span>
                          </span>
                        </td>
                        <td>
                          <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                            <div style={{ background: `linear-gradient(90deg, ${color}66, ${color}1a)`, borderRadius: 4, height: 8, width: `${Math.max(2, pct)}%` }} />
                          </div>
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                          ${r.price.toFixed(2)}
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

        <div className="card">
          {displayRevenueRows.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>No rows found for the selected filters.</div>
          ) : (
            <>
              <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto', overflowX: 'auto' }}>
                <table className="data">
                  <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
                    <tr>
                      <th style={{ width: 40 }}>#</th>
                      <SortTh col="brand" label="Brand" sortKey={revSortKey} sortDir={revSortDir} toggle={toggleRev} />
                      <SortTh col="avgPrice" label="Avg price" sortKey={revSortKey} sortDir={revSortDir} toggle={toggleRev} style={{ textAlign: 'right' }} />
                      <SortTh col="products" label="Products" sortKey={revSortKey} sortDir={revSortDir} toggle={toggleRev} style={{ textAlign: 'right' }} />
                      <SortTh col="signal" label="Revenue signal" sortKey={revSortKey} sortDir={revSortDir} toggle={toggleRev} />
                    </tr>
                    <tr className="col-filter-row">
                      <th />
                      <th><ColumnFilter col="brand" value={revColFilter.brand} onChange={v => setRevColFilter(p => ({ ...p, brand: v }))} placeholder="brand…" /></th>
                      <th colSpan={3} />
                    </tr>
                  </thead>
                  <tbody>
                    {displayRevenueRows.map((r, i) => {
                      const color = brandColor(r.brand.slug)
                      const isJoola = r.brand.slug === 'joola'
                      const pillClass =
                        r.signal === 'high' ? 'pill-green' : r.signal === 'medium' ? 'pill-amber' : 'pill-ghost'
                      return (
                        <tr key={r.brand.id} className={isJoola ? 'joola' : ''}>
                          <td style={{ color: '#6b7280', fontWeight: 700 }}>{i + 1}</td>
                          <td>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span className="brand-dot" style={{ background: color }} />
                              <span style={{ fontWeight: 700, color: isJoola ? '#22c55e' : 'var(--fg)' }}>
                                {r.brand.name}
                              </span>
                            </span>
                          </td>
                          <td className="cell-num" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            ${r.avgPrice.toFixed(2)}
                          </td>
                          <td className="cell-num" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
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
              <div style={{ fontSize: 10, color: '#6b7280', padding: '8px 16px 12px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                Tracking {variants.length} product variants across {kpis.brandsWithData} brands.
              </div>
            </>
          )}
        </div>
      </section>

      {/* ─── NEW SECTIONS · Sales Intel Expansion (2026-05-25) ──── */}

      {/* ── F. Competitor stockout opportunity ──────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              F. Competitor stockout opportunity · {stockoutRows.length} rows
              <SectionInfo
                title="Stockout Opportunity"
                description="Latest product_snapshot per (brand, product) where availability_status is not in_stock. Demand uses the matching product_attention_summary last_30d row. JOOLA comparable is the highest-attention JOOLA paddle in the same category."
                source="product_snapshots (latest per product) · inventory_events (sellout) · product_attention_summary"
              />
            </h2>
            <div className="sub">Where competitors are temporarily unable to convert demand — and the JOOLA alternative to point at.</div>
          </div>
        </div>
        <div className="card">
          {stockoutRows.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-4)' }}>
              No out-of-stock competitor paddles right now — inventory is healthy across the board.
            </div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
              <table className="data" style={{ width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'rgba(13,17,23,0.95)' }}>
                  <tr>
                    <th>Brand</th>
                    <th>Product</th>
                    <th>Stock status</th>
                    <th>Last in stock</th>
                    <th style={{ textAlign: 'right' }}>Demand (30d mentions)</th>
                    <th>JOOLA comparable</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {stockoutRows.map((r) => (
                    <tr key={`${r.brandSlug}::${r.productId || r.productName}`}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className="brand-dot" style={{ background: pgColor(r.brandSlug) }} />
                          <span style={{ fontWeight: 700, color: pgColor(r.brandSlug), fontSize: 11.5 }}>{r.brandName}</span>
                        </span>
                      </td>
                      <td style={{ color: 'var(--fg)', fontWeight: 600 }}>{r.productName}</td>
                      <td>
                        <span className={'pill ' + (r.status === 'out_of_stock' ? 'pill-red' : r.status === 'limited' ? 'pill-amber' : 'pill-ghost')}>
                          {r.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--fg-2)' }}>{r.lastInStock ? r.lastInStock.slice(0, 10) : '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: '#F5E625', fontWeight: 700 }}>{r.demand30d > 0 ? fmt(r.demand30d) : '—'}</td>
                      <td style={{ color: '#22c55e', fontSize: 11.5, fontWeight: 600 }}>{r.joolaComparableName}</td>
                      <td><span className="pill pill-green">{r.action}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <ActionFrame
          move="A competitor paddle with active 30-day mention demand is currently out-of-stock or limited on its own store."
          impact="Buyers who came intending that paddle are now in 'pick a substitute' mode; if JOOLA isn't in the consideration set, they'll go to whichever brand surfaces first on Reddit / Google."
          action="For each top-demand row, push the listed JOOLA comparable in ads, Reddit reply playbooks, and influencer DMs within 72 hours."
        />
        <Caveat tables={['product_snapshots (latest per product)', 'inventory_events (sellout)', 'product_attention_summary (last_30d)']} />
      </section>

      {/* ── G. Restock cadence ──────────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              G. Restock cadence · {cadenceRows.length} rows
              <SectionInfo
                title="Restock Cadence"
                description="For every (brand, product) with at least two restock events, the mean gap (in days) between consecutive restocks is computed. Pattern label uses thresholds — Frequent <14d, Steady 14–45d, Occasional ≥45d, Single restock = only one event in the window."
                source="inventory_events WHERE event_type = 'restock' · grouped by (brand, product)"
              />
            </h2>
            <div className="sub">How quickly each competitor replenishes — gaps signal supply chain stress or controlled scarcity.</div>
          </div>
        </div>
        <div className="card">
          {cadenceRows.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-4)' }}>
              No restock events recorded yet — sales pipeline first writes inventory_events.event_type=&apos;restock&apos; once a SKU comes back in stock after being marked out.
            </div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
              <table className="data" style={{ width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'rgba(13,17,23,0.95)' }}>
                  <tr>
                    <th>Brand</th>
                    <th>Product</th>
                    <th style={{ textAlign: 'right' }}>Avg days between restocks</th>
                    <th>Most recent restock</th>
                    <th>Pattern</th>
                    <th style={{ textAlign: 'right' }}>Demand (30d)</th>
                  </tr>
                </thead>
                <tbody>
                  {cadenceRows.map((r) => (
                    <tr key={`${r.brandSlug}::${r.productId || r.productName}`}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className="brand-dot" style={{ background: pgColor(r.brandSlug) }} />
                          <span style={{ fontWeight: 700, color: pgColor(r.brandSlug), fontSize: 11.5 }}>{r.brandName}</span>
                        </span>
                      </td>
                      <td style={{ color: 'var(--fg)', fontWeight: 600 }}>{r.productName}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: 'var(--fg)', fontWeight: 700 }}>
                        {r.avgDaysBetween == null ? '—' : r.avgDaysBetween + 'd'}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--fg-2)' }}>{r.mostRecent ? r.mostRecent.slice(0, 10) : '—'}</td>
                      <td>
                        <span className={'pill ' + (r.pattern === 'Frequent' ? 'pill-green' : r.pattern === 'Steady' ? 'pill-info' : r.pattern === 'Occasional' ? 'pill-amber' : 'pill-ghost')}>
                          {r.pattern}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: '#F5E625' }}>{r.demand30d > 0 ? fmt(r.demand30d) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <ActionFrame
          move="Competitor restock cadence reveals supply discipline: Frequent = high churn (likely high sell-through), Occasional = either weak demand or supply pain."
          impact="JOOLA can't read competitor supply directly, but cadence is a proxy. Misreading it leads to either copying flash-sale tactics that don't fit demand or missing windows where a competitor is structurally weak."
          action="For 'Occasional' rows with strong 30d demand, prioritize a paid + organic push around the JOOLA equivalent during the competitor's next dry stretch (use 'Most recent restock' to time it)."
        />
        <Caveat tables={['inventory_events (event_type = restock)', 'product_attention_summary (last_30d for demand)']} />
      </section>

      {/* ── H. Price pressure watch ─────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              H. Price pressure watch · {priceRows2.length} rows
              <SectionInfo
                title="Price Pressure Watch"
                description="For every product with at least one price_daily row, surface the current observed price and the 90-day price index (price ÷ trailing 90-day baseline). Rows with index < 0.85 are deep discounts. Discount % comes from products.discount_pct on the matched scraped catalog row."
                source="price_daily (latest per product, price_index_90d) · products (current price + discount_pct) · products_catalog"
              />
            </h2>
            <div className="sub">Where competitor pricing is squeezing the market — sorted by deepest discount first.</div>
          </div>
        </div>
        <div className="card">
          {priceRows2.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-4)' }}>
              No price_daily rows yet — needs 90 days of price_history per product before the 90d index is meaningful.
            </div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
              <table className="data" style={{ width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'rgba(13,17,23,0.95)' }}>
                  <tr>
                    <th>Brand</th>
                    <th>Product</th>
                    <th style={{ textAlign: 'right' }}>Current price</th>
                    <th style={{ textAlign: 'right' }}>90d index</th>
                    <th style={{ textAlign: 'right' }}>Discount %</th>
                    <th>JOOLA comparable</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {priceRows2.map((r) => {
                    const idx = r.priceIndex90d
                    const deep = idx != null && idx < 0.85
                    return (
                      <tr key={`${r.brandSlug}::${r.productId}`} style={{ background: deep ? 'rgba(239,68,68,0.04)' : undefined }}>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span className="brand-dot" style={{ background: pgColor(r.brandSlug) }} />
                            <span style={{ fontWeight: 700, color: pgColor(r.brandSlug), fontSize: 11.5 }}>{r.brandName}</span>
                          </span>
                        </td>
                        <td style={{ color: 'var(--fg)', fontWeight: 600 }}>{r.productName}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: 'var(--fg)' }}>
                          {r.currentPrice != null ? '$' + r.currentPrice.toFixed(0) : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: deep ? '#ef4444' : idx != null && idx < 0.95 ? '#F5E625' : 'var(--fg-2)', fontWeight: 700 }}>
                          {idx == null ? '—' : idx.toFixed(2)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {r.discountPct != null && r.discountPct > 0
                            ? <span className="pill pill-amber">-{r.discountPct.toFixed(0)}%</span>
                            : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                        </td>
                        <td style={{ color: '#22c55e', fontSize: 11.5, fontWeight: 600 }}>{r.joolaComparableName}</td>
                        <td><span className={'pill ' + (deep ? 'pill-red' : 'pill-info')}>{r.action}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <ActionFrame
          move="Competitors are dropping prices below their 90-day baseline — the deepest discounts (index < 0.85) tend to cluster around inventory clearance or seasonal flush events."
          impact="Sustained deep discounts on competitor paddles reset consumer reference price for the whole category, which makes JOOLA's full-price positioning feel premium even when materials and performance are equivalent."
          action="Avoid mirroring discounts blindly; instead lead with 'value pillar' content (player roster, warranty, free returns) on each row's JOOLA comparable for the duration of the discount window."
        />
        <Caveat tables={['price_daily.price_index_90d (latest per product)', 'products.discount_pct (current sale)', 'products_catalog (display name + comparable resolution)']} />
      </section>

      {/* ── I. Attention vs availability matrix ─────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              I. Attention vs availability matrix · {attAvailPoints.length} paddles plotted
              <SectionInfo
                title="Attention × Availability"
                description="Each dot is one paddle. X axis = 30-day mention total (from product_attention_summary), Y axis = latest availability_index (in_stock variants ÷ total). The high/low cut on attention is the median across all plotted products."
                source="product_attention_summary (last_30d) · availability_daily (latest per product)"
              />
            </h2>
            <div className="sub">Four quadrants — opportunity, strong competitor, likely-discontinued, weak product.</div>
          </div>
        </div>
        {attAvailPoints.length === 0 ? (
          <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--fg-4)' }}>
            Attention vs availability matrix activates after the attention pipeline (product_attention_summary)
            <br />AND the availability mart (availability_daily) both have data for the same products. Currently both feeds are still warming.
          </div>
        ) : (
          <div className="card"><div className="card-pad">
            <ScatterChart
              data={attAvailPoints.map((p): ScatterDatum => ({
                brand: p.brandSlug,
                name: p.productName,
                followers: p.attention,
                engRate: p.availability * 100,   // express as % so the y axis reads naturally
                color: pgColor(p.brandSlug),
                posts: 30,
              }))}
              h={420}
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 14 }}>
              {([
                { q: 'opportunity', label: 'High attention · low availability', tip: 'Competitor demand opportunity — push JOOLA alternative', color: '#22c55e' },
                { q: 'strong-competitor', label: 'High attention · high availability', tip: 'Strong competitor — content/promo response', color: '#ef4444' },
                { q: 'discontinued', label: 'Low attention · low availability', tip: 'Likely discontinued', color: 'var(--fg-3)' },
                { q: 'weak', label: 'Low attention · high availability', tip: 'Weak product — ignore', color: '#94a3b8' },
              ] as const).map((q) => {
                const count = attAvailPoints.filter((p) => p.quadrant === q.q).length
                return (
                  <div key={q.q} className="card" style={{ padding: 10, borderLeft: `3px solid ${q.color}` }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: q.color, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{q.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 4 }}>{q.tip}</div>
                    <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 6 }}>
                      <strong style={{ color: 'var(--fg)' }}>{count}</strong> paddle{count === 1 ? '' : 's'}
                    </div>
                  </div>
                )
              })}
            </div>
          </div></div>
        )}
        <ActionFrame
          move="Competitor paddles in the 'high attention / low availability' quadrant are the clearest near-term demand transfer targets — buyers want a paddle that's not on the shelf."
          impact="If JOOLA's comparable paddle isn't visible in the channels where those mentions are happening, the transferred demand goes to whichever brand pays the most for that keyword today."
          action="Treat the upper-left quadrant as the weekly 'switch-the-buyer' list — paid + organic push behind the closest JOOLA paddle for every row, refreshed every Monday."
        />
        <Caveat tables={['product_attention_summary (last_30d)', 'availability_daily (latest per product)']} />
      </section>
    </>
  )
}

