'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { PageHead, SectionInfo, LoadingPage, SortTh, ColumnFilter, pgColor } from '@/components/v2/PageShell'
import { fmt, LineChart, ScatterChart, type ScatterDatum } from '@/components/v2/charts'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import { useReveal, revealCls } from '@/lib/v2/animations'
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
import { useBrandFilter } from '@/lib/v2/BrandFilterContext'

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
  avg_rating: number | null
  review_count: number | null
  image_url: string | null
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
  price: number | null
  compare_at_price: number | null
  first_seen_at: string | null
  variant_title: string | null
}

interface SalesEstimate {
  brand_id: string
  product_id: string | null
  variant_id: string | null
  estimate_date: string
  estimated_units_sold: number
  estimated_revenue: number
  price_used: number | null
  confidence_score: number
  inventory_start: number | null
  inventory_end: number | null
  estimation_method: string
}

interface InventoryEvent {
  brand_id: string
  variant_id: string | null
  event_time: string
  event_type: string
  previous_qty: number | null
  current_qty: number | null
  delta_qty: number | null
  confidence_score: number | null
  reason_code: string | null
}

interface SalesFact {
  brand_id: string
  date: string
  estimated_units_sold: number
  estimated_revenue: number
  avg_price: number | null
  discount_percent: number | null
  product_id: string | null
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
  return STATUS_COLORS[status] ?? 'var(--wb-8)'
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

  // Sections P-T (Particl-style pricing block) — respect global brand filter
  const { filteredBrands, isFiltered } = useBrandFilter()

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
  const [ovSortKey, setOvSortKey] = useState<string>('total')
  const [ovSortDir, setOvSortDir] = useState<'asc' | 'desc'>('desc')
  const router = useRouter()

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

  const [salesEstimates, setSalesEstimates] = useState<SalesEstimate[]>([])
  const [inventoryEvts, setInventoryEvts] = useState<InventoryEvent[]>([])
  const [estSortKey, setEstSortKey] = useState<string | null>(null)
  const [estSortDir, setEstSortDir] = useState<'asc' | 'desc'>('desc')
  const [evtSortKey, setEvtSortKey] = useState<string | null>(null)
  const [evtSortDir, setEvtSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleEst(k: string) {
    if (estSortKey === k) setEstSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setEstSortKey(k); setEstSortDir('desc') }
  }
  function toggleEvt(k: string) {
    if (evtSortKey === k) setEvtSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setEvtSortKey(k); setEvtSortDir('desc') }
  }

  // Sections M-O state
  const [salesFacts, setSalesFacts] = useState<SalesFact[]>([])
  const [salesTimeView, setSalesTimeView] = useState<'volume' | 'revenue'>('volume')
  const [bsSortKey, setBsSortKey] = useState<string | null>('totalRevenue')
  const [bsSortDir, setBsSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleBs(k: string) {
    if (bsSortKey === k) setBsSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setBsSortKey(k); setBsSortDir('desc') }
  }

  // Search + sort state for sections K, L, N, O
  const [estSearch, setEstSearch] = useState('')
  const [evtSearch, setEvtSearch] = useState('')
  const [bsSearch, setBsSearch] = useState('')
  const [brandSortKey, setBrandSortKey] = useState<string | null>('totalRevenue')
  const [brandSortDir, setBrandSortDir] = useState<'asc' | 'desc'>('desc')
  const [brandSearch, setBrandSearch] = useState('')

  function toggleBrand(k: string) {
    if (brandSortKey === k) setBrandSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setBrandSortKey(k); setBrandSortDir('desc') }
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
            .select('id, brand_id, display_name, sku, category, avg_rating, review_count, image_url'),
          supabase
            .from('product_snapshots')
            .select(
              'brand_id, product_id, snapshot_time, price, availability_status, visible_inventory_qty, inventory_signal_type, inventory_confidence',
            )
            .order('snapshot_time', { ascending: false })
            .limit(2000),
          supabase
            .from('product_variants')
            .select('id, brand_id, product_id, availability_status, price, compare_at_price, first_seen_at, variant_title')
            .limit(1000),
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

        // Sections J-L: sales estimates + inventory events
        const [estRes, evtRes] = await Promise.all([
          supabase
            .from('sales_estimates')
            .select('brand_id, product_id, variant_id, estimate_date, estimated_units_sold, estimated_revenue, price_used, confidence_score, inventory_start, inventory_end, estimation_method')
            .order('estimate_date', { ascending: false })
            .limit(1000),
          supabase
            .from('inventory_events')
            .select('brand_id, variant_id, event_time, event_type, previous_qty, current_qty, delta_qty, confidence_score, reason_code')
            .order('event_time', { ascending: false })
            .limit(500),
        ])
        if (cancelled) return
        setSalesEstimates((estRes.data as SalesEstimate[] | null) ?? [])
        setInventoryEvts((evtRes.data as InventoryEvent[] | null) ?? [])

        // Section M: sales_facts_daily time-series (populated by Phase 3 pipeline)
        const sfRes = await supabase
          .from('sales_facts_daily')
          .select('brand_id, date, estimated_units_sold, estimated_revenue, avg_price, discount_percent, product_id')
          .order('date', { ascending: true })
          .limit(500)
        if (cancelled) return
        setSalesFacts((sfRes.data as SalesFact[] | null) ?? [])

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

  // Estimates table display
  const displayEstimates = useMemo(() => {
    const q = estSearch.toLowerCase()
    const filtered = q
      ? salesEstimates.filter(e => {
          const bName = brandById.get(e.brand_id)?.name ?? ''
          const pName = e.product_id ? (productById.get(e.product_id)?.display_name ?? '') : ''
          return bName.toLowerCase().includes(q) || pName.toLowerCase().includes(q)
        })
      : salesEstimates
    if (!estSortKey) return filtered
    return [...filtered].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[estSortKey]
      const bv = (b as unknown as Record<string, unknown>)[estSortKey]
      if (typeof av === 'number' && typeof bv === 'number') return estSortDir === 'asc' ? av - bv : bv - av
      return estSortDir === 'asc'
        ? String(av ?? '').localeCompare(String(bv ?? ''))
        : String(bv ?? '').localeCompare(String(av ?? ''))
    })
  }, [salesEstimates, estSearch, estSortKey, estSortDir, brandById, productById])

  // Inventory events table display
  const displayEvts = useMemo(() => {
    const q = evtSearch.toLowerCase()
    const filtered = q
      ? inventoryEvts.filter(e => (brandById.get(e.brand_id)?.name ?? '').toLowerCase().includes(q))
      : inventoryEvts
    if (!evtSortKey) return filtered
    return [...filtered].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[evtSortKey]
      const bv = (b as unknown as Record<string, unknown>)[evtSortKey]
      if (typeof av === 'number' && typeof bv === 'number') return evtSortDir === 'asc' ? av - bv : bv - av
      return evtSortDir === 'asc'
        ? String(av ?? '').localeCompare(String(bv ?? ''))
        : String(bv ?? '').localeCompare(String(av ?? ''))
    })
  }, [inventoryEvts, evtSearch, evtSortKey, evtSortDir, brandById])

  // Sellout velocity — grouped by brand, sorted by count desc
  const selloutByBrand = useMemo(() => {
    const events = inventoryEvts.filter(e => e.event_type === 'sellout')
    const byBrand: Record<string, { brand: Brand; count: number; latest: string }> = {}
    for (const e of events) {
      if (!byBrand[e.brand_id]) {
        const b = brandById.get(e.brand_id)
        if (!b) continue
        byBrand[e.brand_id] = { brand: b, count: 0, latest: '' }
      }
      byBrand[e.brand_id].count++
      if (!byBrand[e.brand_id].latest || e.event_time > byBrand[e.brand_id].latest) {
        byBrand[e.brand_id].latest = e.event_time
      }
    }
    return Object.values(byBrand).sort((a, b) => b.count - a.count)
  }, [inventoryEvts, brandById])

  const maxSelloutCount = selloutByBrand[0]?.count ?? 1
  const totalEstRev = salesEstimates.reduce((s, e) => s + (e.estimated_revenue ?? 0), 0)
  const totalEstUnits = salesEstimates.reduce((s, e) => s + (e.estimated_units_sold ?? 0), 0)

  // ─── Section M–O derived data ──────────────────────────────────────

  const variantById = useMemo(() => {
    const m = new Map<string, ProductVariant>()
    for (const v of variants) m.set(v.id, v)
    return m
  }, [variants])

  // Sales Over Time — prefer sales_facts_daily, fall back to sales_estimates aggregated by date
  const salesByDate = useMemo(() => {
    type TimeRow = { date: string; brand_id: string; units: number; revenue: number }
    const rows: TimeRow[] = salesFacts.length > 0
      ? salesFacts.map(f => ({ date: f.date, brand_id: f.brand_id, units: Number(f.estimated_units_sold) || 0, revenue: Number(f.estimated_revenue) || 0 }))
      : salesEstimates.map(e => ({ date: e.estimate_date, brand_id: e.brand_id, units: Number(e.estimated_units_sold) || 0, revenue: Number(e.estimated_revenue) || 0 }))

    if (rows.length === 0) return { dates: [] as string[], series: [] as { label: string; color: string; data: number[]; dataRev: number[] }[], source: 'empty' }

    const dateSet = Array.from(new Set(rows.map(r => r.date))).sort()
    const brandSet = Array.from(new Set(rows.map(r => r.brand_id))).filter(bid => brandById.has(bid))

    const series = brandSet.map(bid => {
      const brand = brandById.get(bid)!
      const byDate = new Map<string, { units: number; revenue: number }>()
      for (const r of rows.filter(r => r.brand_id === bid)) {
        const ex = byDate.get(r.date) ?? { units: 0, revenue: 0 }
        byDate.set(r.date, { units: ex.units + r.units, revenue: ex.revenue + r.revenue })
      }
      return {
        label: brand.name,
        color: brandColor(brand.slug),
        data: dateSet.map(d => byDate.get(d)?.units ?? 0),
        dataRev: dateSet.map(d => byDate.get(d)?.revenue ?? 0),
      }
    }).filter(s => s.data.some(v => v > 0) || s.dataRev.some(v => v > 0))

    return { dates: dateSet, series, source: salesFacts.length > 0 ? 'sales_facts_daily' : 'sales_estimates' }
  }, [salesFacts, salesEstimates, brandById])

  // Best Selling Products — group estimates by product_id, enrich with catalog + variant data
  const bestSellers = useMemo(() => {
    type BsRow = {
      productId: string
      productName: string
      brand: Brand | undefined
      brandSlug: string
      category: string | null
      imageUrl: string | null
      totalUnits: number
      totalRevenue: number
      avgPrice: number
      avgDiscount: number | null
      avgConfidence: number
      firstSeen: string | null
      reviewCount: number | null
      avgRating: number | null
      variantCount: number
      currentInStock: number
      sellThroughRate: number | null
      dailyVelocity: number | null
    }
    const map = new Map<string, BsRow>()

    for (const e of salesEstimates) {
      // Resolve product_id: direct field first, then via variant lookup
      const productId: string | null = e.product_id ?? (e.variant_id ? (variantById.get(e.variant_id)?.product_id ?? null) : null)
      if (!productId) continue
      const prod = productById.get(productId)
      if (!prod) continue
      const brand = brandById.get(e.brand_id)
      const existing = map.get(productId) ?? {
        productId,
        productName: prod.display_name,
        brand,
        brandSlug: brand?.slug ?? '',
        category: prod.category,
        imageUrl: prod.image_url,
        totalUnits: 0,
        totalRevenue: 0,
        avgPrice: 0,
        avgDiscount: null,
        avgConfidence: 0,
        firstSeen: null,
        reviewCount: prod.review_count ?? null,
        avgRating: prod.avg_rating ?? null,
        variantCount: 0,
        currentInStock: 0,
        sellThroughRate: null,
        dailyVelocity: null,
      }
      existing.totalUnits += Number(e.estimated_units_sold) || 0
      existing.totalRevenue += Number(e.estimated_revenue) || 0
      const n = existing.variantCount
      existing.avgPrice = n > 0 ? (existing.avgPrice * n + (e.price_used ?? 0)) / (n + 1) : (e.price_used ?? 0)
      existing.avgConfidence = n > 0 ? (existing.avgConfidence * n + (e.confidence_score ?? 0)) / (n + 1) : (e.confidence_score ?? 0)
      existing.variantCount++
      map.set(productId, existing)
    }

    // Enrich with first_seen + discount from product_variants
    for (const v of variants) {
      if (!v.product_id) continue
      const row = map.get(v.product_id)
      if (!row) continue
      if (v.first_seen_at && (!row.firstSeen || v.first_seen_at < row.firstSeen)) row.firstSeen = v.first_seen_at
      if (v.price && v.compare_at_price && v.compare_at_price > v.price) {
        const disc = ((v.compare_at_price - v.price) / v.compare_at_price) * 100
        row.avgDiscount = row.avgDiscount != null ? (row.avgDiscount + disc) / 2 : disc
      }
      if (v.availability_status === 'in_stock') row.currentInStock++
    }

    // Add inventory qty from snapshots for sell-through rate and daily velocity
    const msPerDay = 86_400_000
    const now = Date.now()
    for (const row of Array.from(map.values())) {
      const prodSnaps = latestSnapshots.filter(s => s.product_id === row.productId)
      const totalInv = prodSnaps.reduce((s, snap) => s + (snap.visible_inventory_qty ?? 0), 0)
      if (row.totalUnits > 0 || totalInv > 0) {
        // Particl formula: units / (units + inventory/2) — halved denominator because
        // current inventory is an end-of-period snapshot, not average-period inventory.
        row.sellThroughRate = row.totalUnits > 0
          ? (row.totalUnits / (row.totalUnits + totalInv / 2)) * 100
          : 0
      }
      // Rate sold: units per day since first variant seen (Particl's rate_sold metric)
      const daysActive = row.firstSeen
        ? Math.max(1, Math.floor((now - new Date(row.firstSeen).getTime()) / msPerDay))
        : null
      row.dailyVelocity = daysActive != null && row.totalUnits > 0
        ? row.totalUnits / daysActive
        : null
    }

    return Array.from(map.values()).sort((a, b) => b.totalRevenue - a.totalRevenue)
  }, [salesEstimates, productById, brandById, variants, variantById, latestSnapshots])

  const displayBestSellers = useMemo(() => {
    const q = bsSearch.toLowerCase()
    const filtered = q
      ? bestSellers.filter(r => r.productName.toLowerCase().includes(q) || (r.brand?.name ?? '').toLowerCase().includes(q))
      : bestSellers
    if (!bsSortKey) return filtered
    return [...filtered].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[bsSortKey]
      const bv = (b as unknown as Record<string, unknown>)[bsSortKey]
      if (typeof av === 'number' && typeof bv === 'number') return bsSortDir === 'asc' ? av - bv : bv - av
      return bsSortDir === 'asc'
        ? String(av ?? '').localeCompare(String(bv ?? ''))
        : String(bv ?? '').localeCompare(String(av ?? ''))
    })
  }, [bestSellers, bsSearch, bsSortKey, bsSortDir])

  // Brand Sales Breakdown — per-brand: product count, estimates, avg price, avg rating, stock %
  const brandSalesRows = useMemo(() => {
    return brands.map(b => {
      const brandProds = products.filter(p => p.brand_id === b.id)
      const brandEstimates = salesEstimates.filter(e => e.brand_id === b.id)
      const totalUnits = brandEstimates.reduce((s, e) => s + (Number(e.estimated_units_sold) || 0), 0)
      const totalRevenue = brandEstimates.reduce((s, e) => s + (Number(e.estimated_revenue) || 0), 0)
      const brandSnaps = latestSnapshots.filter(s => s.brand_id === b.id)
      const pricesWithData = brandSnaps.filter(s => s.price && s.price > 0)
      const avgPrice = pricesWithData.length > 0 ? pricesWithData.reduce((s, snap) => s + (snap.price ?? 0), 0) / pricesWithData.length : null
      const brandVariants = variants.filter(v => v.brand_id === b.id)
      const discountedVariants = brandVariants.filter(v => v.price != null && v.compare_at_price != null && v.compare_at_price > v.price)
      const avgDiscount = discountedVariants.length > 0
        ? discountedVariants.reduce((sum, v) => sum + ((v.compare_at_price! - v.price!) / v.compare_at_price!) * 100, 0) / discountedVariants.length
        : null
      const inStockCount = brandSnaps.filter(s => s.availability_status === 'in_stock').length
      const inStockPct = brandSnaps.length > 0 ? (inStockCount / brandSnaps.length) * 100 : null
      const ratingsWithData = brandProds.filter(p => p.avg_rating != null)
      const avgRating = ratingsWithData.length > 0 ? ratingsWithData.reduce((s, p) => s + (p.avg_rating ?? 0), 0) / ratingsWithData.length : null
      const totalReviews = brandProds.reduce((s, p) => s + (p.review_count ?? 0), 0)
      return { brand: b, productCount: brandProds.length, totalUnits, totalRevenue, avgPrice, avgDiscount, avgRating, totalReviews, inStockPct, snapshotCount: brandSnaps.length }
    }).filter(r => r.productCount > 0 || r.snapshotCount > 0)
      .sort((a, b) => b.totalRevenue - a.totalRevenue || b.productCount - a.productCount)
  }, [brands, products, salesEstimates, latestSnapshots])

  const displayBrandSalesRows = useMemo(() => {
    const q = brandSearch.toLowerCase()
    const filtered = q ? brandSalesRows.filter(r => r.brand.name.toLowerCase().includes(q)) : brandSalesRows
    if (!brandSortKey) return filtered
    return [...filtered].sort((a, b) => {
      if (brandSortKey === 'brand') {
        return brandSortDir === 'asc' ? a.brand.name.localeCompare(b.brand.name) : b.brand.name.localeCompare(a.brand.name)
      }
      const av = (a as unknown as Record<string, unknown>)[brandSortKey]
      const bv = (b as unknown as Record<string, unknown>)[brandSortKey]
      if (typeof av === 'number' && typeof bv === 'number') return brandSortDir === 'asc' ? av - bv : bv - av
      return brandSortDir === 'asc'
        ? String(av ?? '').localeCompare(String(bv ?? ''))
        : String(bv ?? '').localeCompare(String(av ?? ''))
    })
  }, [brandSalesRows, brandSearch, brandSortKey, brandSortDir])

  // ─── Section P-T derived data (Particl-style pricing block) ───────
  // Brand scope: when the global BrandFilter is active, only these brand ids
  // participate. Otherwise all loaded brands do.
  const scopedBrandIds = useMemo(() => {
    if (!isFiltered) return new Set(brands.map(b => b.id))
    return new Set(filteredBrands.map(b => b.id))
  }, [brands, filteredBrands, isFiltered])

  const scopedBrandLabel = useMemo(() => {
    if (!isFiltered) return `all ${brands.length} brands`
    if (filteredBrands.length === 1) return filteredBrands[0].name
    return `${filteredBrands.length} brands`
  }, [brands, filteredBrands, isFiltered])

  // P · Best Selling Products — top 6 by totalRevenue within scope
  const pBestSellers = useMemo(() => {
    return bestSellers
      .filter(r => r.brand && scopedBrandIds.has(r.brand.id))
      .slice(0, 6)
  }, [bestSellers, scopedBrandIds])

  // Q · Total Discounted Products — donut: variants where compare_at_price > price
  const qDiscountStats = useMemo(() => {
    const inScope = variants.filter(v => scopedBrandIds.has(v.brand_id) && v.price != null)
    const total = inScope.length
    const discounted = inScope.filter(v => v.compare_at_price != null && v.compare_at_price! > (v.price ?? 0)).length
    const pct = total > 0 ? (discounted / total) * 100 : 0
    return { total, discounted, pct }
  }, [variants, scopedBrandIds])

  // R · Product Types — group products_catalog by category, attach pricing + rating from variants/snapshots
  const rProductTypes = useMemo(() => {
    type Row = {
      category: string
      productCount: number
      avgRating: number | null
      pctDiscounted: number
      minPrice: number | null
      maxPrice: number | null
      avgPrice: number | null
      avgFullPrice: number | null
      avgDiscount: number | null
    }
    const inScope = products.filter(p => scopedBrandIds.has(p.brand_id))
    const variantByProduct = new Map<string, ProductVariant[]>()
    for (const v of variants) {
      if (!v.product_id) continue
      const arr = variantByProduct.get(v.product_id) ?? []
      arr.push(v)
      variantByProduct.set(v.product_id, arr)
    }
    const snapByProduct = new Map<string, ProductSnapshot[]>()
    for (const s of snapshots) {
      if (!s.product_id) continue
      const arr = snapByProduct.get(s.product_id) ?? []
      arr.push(s)
      snapByProduct.set(s.product_id, arr)
    }
    const byCat = new Map<string, ProductCatalog[]>()
    for (const p of inScope) {
      const cat = (p.category ?? 'uncategorized').trim() || 'uncategorized'
      const arr = byCat.get(cat) ?? []
      arr.push(p)
      byCat.set(cat, arr)
    }
    const rows: Row[] = []
    for (const [cat, prods] of Array.from(byCat.entries())) {
      const ratings = prods.map(p => p.avg_rating).filter((r): r is number => r != null)
      const allVariants = prods.flatMap(p => variantByProduct.get(p.id) ?? [])
      const allSnaps = prods.flatMap(p => snapByProduct.get(p.id) ?? []).filter(s => s.price && s.price > 0)
      const discounted = allVariants.filter(v => v.price != null && v.compare_at_price != null && v.compare_at_price! > v.price!)
      const pctDiscounted = allVariants.length > 0 ? (discounted.length / allVariants.length) * 100 : 0
      const prices = allSnaps.map(s => s.price as number)
      const fullPrices = allVariants.map(v => v.compare_at_price).filter((p): p is number => p != null && p > 0)
      const avgPrice = prices.length > 0 ? prices.reduce((s, p) => s + p, 0) / prices.length : null
      const avgFullPrice = fullPrices.length > 0 ? fullPrices.reduce((s, p) => s + p, 0) / fullPrices.length : null
      const avgDiscount = discounted.length > 0
        ? discounted.reduce((s, v) => s + ((v.compare_at_price! - v.price!) / v.compare_at_price!) * 100, 0) / discounted.length
        : null
      rows.push({
        category: cat,
        productCount: prods.length,
        avgRating: ratings.length > 0 ? ratings.reduce((s, r) => s + r, 0) / ratings.length : null,
        pctDiscounted,
        minPrice: prices.length > 0 ? Math.min(...prices) : null,
        maxPrice: prices.length > 0 ? Math.max(...prices) : null,
        avgPrice,
        avgFullPrice,
        avgDiscount,
      })
    }
    return rows.sort((a, b) => b.productCount - a.productCount)
  }, [products, variants, snapshots, scopedBrandIds])

  // S · Price Distribution — histogram of prices, % of products and % of revenue
  const sPriceDistribution = useMemo(() => {
    // Source of prices: latest product snapshots (current price). Revenue
    // proxy: sum of estimated_revenue from sales_estimates joined by product.
    const inScopeSnaps = latestSnapshots.filter(s => scopedBrandIds.has(s.brand_id) && s.price && s.price > 0)
    const prices = inScopeSnaps.map(s => s.price as number).sort((a, b) => a - b)
    if (prices.length === 0) return { buckets: [] as { lo: number; hi: number; products: number; revenue: number; productPct: number; revenuePct: number }[], totalProducts: 0, totalRevenue: 0 }

    const p5 = prices[Math.floor(prices.length * 0.05)] ?? prices[0]
    const p95 = prices[Math.floor(prices.length * 0.95)] ?? prices[prices.length - 1]
    const N_BUCKETS = 11
    const step = (p95 - p5) / N_BUCKETS
    const buckets = Array.from({ length: N_BUCKETS }, (_, i) => ({
      lo: p5 + step * i,
      hi: p5 + step * (i + 1),
      products: 0,
      revenue: 0,
      productPct: 0,
      revenuePct: 0,
    }))
    // revenue per product (sum of estimated_revenue across all estimates)
    const revenueByProduct = new Map<string, number>()
    for (const e of salesEstimates) {
      const pid = e.product_id ?? (e.variant_id ? variantById.get(e.variant_id)?.product_id ?? null : null)
      if (!pid || !scopedBrandIds.has(e.brand_id)) continue
      revenueByProduct.set(pid, (revenueByProduct.get(pid) ?? 0) + (Number(e.estimated_revenue) || 0))
    }
    for (const s of inScopeSnaps) {
      const price = s.price as number
      let idx = Math.floor((price - p5) / step)
      if (idx < 0) idx = 0
      if (idx >= N_BUCKETS) idx = N_BUCKETS - 1
      buckets[idx].products++
      buckets[idx].revenue += s.product_id ? (revenueByProduct.get(s.product_id) ?? 0) : 0
    }
    const totalProducts = buckets.reduce((s, b) => s + b.products, 0)
    const totalRevenue = buckets.reduce((s, b) => s + b.revenue, 0)
    for (const b of buckets) {
      b.productPct = totalProducts > 0 ? (b.products / totalProducts) * 100 : 0
      b.revenuePct = totalRevenue > 0 ? (b.revenue / totalRevenue) * 100 : 0
    }
    return { buckets, totalProducts, totalRevenue }
  }, [latestSnapshots, salesEstimates, scopedBrandIds, variantById])

  // T · Pricing Over Time — weekly: avg current price, avg full price, avg discount %
  const tPricingTimeline = useMemo(() => {
    const inScope = salesFacts.filter(f => scopedBrandIds.has(f.brand_id) && f.avg_price && f.avg_price > 0)
    if (inScope.length === 0) return { weeks: [] as string[], avgPrice: [] as number[], avgFullPrice: [] as number[], avgDiscountPct: [] as number[] }
    // Group by ISO week start (Mon)
    const weekKey = (iso: string): string => {
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
      const day = d.getUTCDay() || 7
      d.setUTCDate(d.getUTCDate() - day + 1)
      return d.toISOString().slice(0, 10)
    }
    const byWeek = new Map<string, { priceSum: number; discSum: number; n: number }>()
    for (const f of inScope) {
      const w = weekKey(f.date)
      const ex = byWeek.get(w) ?? { priceSum: 0, discSum: 0, n: 0 }
      ex.priceSum += f.avg_price ?? 0
      ex.discSum += f.discount_percent ?? 0
      ex.n++
      byWeek.set(w, ex)
    }
    const weeks = Array.from(byWeek.keys()).sort()
    const avgPrice: number[] = []
    const avgFullPrice: number[] = []
    const avgDiscountPct: number[] = []
    for (const w of weeks) {
      const v = byWeek.get(w)!
      const p = v.priceSum / v.n
      const d = v.discSum / v.n
      avgPrice.push(p)
      avgFullPrice.push(p / Math.max(0.5, 1 - d / 100))
      avgDiscountPct.push(d)
    }
    return { weeks, avgPrice, avgFullPrice, avgDiscountPct }
  }, [salesFacts, scopedBrandIds])

  // T view toggle
  const [tView, setTView] = useState<'discount' | 'current' | 'full'>('discount')

  // ─── Brand overview (aggregated per-brand signals) ─────────────────
  const brandOverview = useMemo(() => {
    function toggleOvSort(col: string) {
      if (ovSortKey === col) setOvSortDir(d => d === 'asc' ? 'desc' : 'asc')
      else { setOvSortKey(col); setOvSortDir('desc') }
    }
    return { toggleOvSort }
  }, [ovSortKey])

  const brandOverviewRows = useMemo(() => {
    return brandCards.map(card => {
      const slug = card.brand.slug
      const stockouts = stockoutRows.filter(r => r.brandSlug === slug).length
      const prices = priceRows2.filter(r => r.brandSlug === slug)
      const avgDiscount = prices.length
        ? prices.reduce((s, r) => s + (r.discountPct ?? 0), 0) / prices.length
        : null
      const avgPrice = revenueRows.find(r => r.brand.slug === slug)?.avgPrice ?? null
      const cadence = cadenceRows.filter(r => r.brandSlug === slug)
      const demand = cadence.reduce((s, r) => s + r.demand30d, 0)
      const patterns = cadence.map(r => r.pattern)
      const topPattern = patterns.length
        ? (['Frequent', 'Steady', 'Occasional', 'Single restock'] as const)
            .find(p => patterns.includes(p)) ?? patterns[0]
        : null
      return { brand: card.brand, total: card.total, inStock: card.inStock, outStock: card.outStock, limited: card.limited, confidence: card.confidence, stockouts, avgDiscount, avgPrice, demand, topPattern }
    }).sort((a, b) => {
      if (a.brand.slug === 'joola') return -1
      if (b.brand.slug === 'joola') return 1
      const getV = (x: typeof a): number | string => {
        if (ovSortKey === 'brand') return x.brand.name
        if (ovSortKey === 'inStock') return x.inStock
        if (ovSortKey === 'outStock') return x.outStock
        if (ovSortKey === 'stockouts') return x.stockouts
        if (ovSortKey === 'avgPrice') return x.avgPrice ?? -1
        if (ovSortKey === 'demand') return x.demand
        return x.total
      }
      const av = getV(a), bv = getV(b)
      if (typeof av === 'number' && typeof bv === 'number') return ovSortDir === 'asc' ? av - bv : bv - av
      return ovSortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
  }, [brandCards, stockoutRows, priceRows2, cadenceRows, revenueRows, ovSortKey, ovSortDir])

  // ─── Reveal hooks (must be before early return) ───────────────────
  const row2 = useReveal()
  const row3 = useReveal()
  const row4 = useReveal()
  const row5 = useReveal()
  const row6 = useReveal()
  const row7 = useReveal()

  // ─── Render ────────────────────────────────────────────────────────
  if (loading) return <LoadingPage />

  if (error) {
    return (
      <div style={{ padding: '80px 32px', textAlign: 'center' }}>
        <div style={{ color: '#ef4444', fontSize: 14, marginBottom: 16 }}>{error}</div>
        <button className="btn btn-yellow" onClick={() => window.location.reload()} aria-label="Refresh page">
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
          <div className="ov-kpi" style={{ '--ov-d': '160ms' } as React.CSSProperties}>
            <MiniKpi
              label="Products tracked"
              src="product_snapshots · latest per product"
              value={fmt(kpis.totalProducts)}
              color="#F5E625"
              customVs={`${products.length} in catalog`}
              tip="How many distinct paddle SKUs across the 11 brands had a stock snapshot during this window. Each SKU is checked weekly on the brand's own product page (Add-to-cart button visible = in stock; 'Sold out' = out of stock)."
            />
          </div>
          <div className="ov-kpi" style={{ '--ov-d': '235ms' } as React.CSSProperties}>
            <MiniKpi
              label="In stock"
              src="latest snapshot availability"
              flavor="joola"
              value={kpis.inStockPct.toFixed(1) + '%'}
              color="#22c55e"
              customVs={`${Math.round((kpis.inStockPct / 100) * kpis.totalProducts)} of ${kpis.totalProducts} SKUs`}
              tip="Share of tracked paddles currently available to buy. Formula: in_stock_pct = (SKUs in stock at most recent snapshot ÷ total SKUs tracked) × 100. Source: weekly scrape of each brand's own product page."
            />
          </div>
          <div className="ov-kpi" style={{ '--ov-d': '310ms' } as React.CSSProperties}>
            <MiniKpi
              label="Out of stock"
              src="latest snapshot availability"
              value={kpis.outStockPct.toFixed(1) + '%'}
              color="#ef4444"
              customVs={`${Math.round((kpis.outStockPct / 100) * kpis.totalProducts)} SKUs unavailable`}
              tip="Share of tracked paddles unavailable to buy right now. High out-of-stock % at a competitor = demand-transfer opportunity for JOOLA (their buyers are looking for alternatives). Source: brand product page snapshots."
            />
          </div>
          <div className="ov-kpi" style={{ '--ov-d': '385ms' } as React.CSSProperties}>
            <MiniKpi
              label="Brands with data"
              value={fmt(kpis.brandsWithData)}
              color="#818cf8"
              customVs={`of ${brands.length} tracked`}
              tip="How many of the 11 tracked brands returned at least one stock snapshot this window. If this is low, scraper coverage needs a check before drawing conclusions from the page."
            />
          </div>
        </div>
      </section>

      {/* ─── Brand Overview Table ──────────────────────────────────── */}
      <section ref={row2.ref} className={revealCls(row2.vis)} style={{ marginBottom: 28 }}>
        <div className="section-head">
          <div>
            <h2>Brand-wise overview
              <SectionInfo title="Sales Intel — Brand Overview" description="Per-brand summary: products tracked, stock health, stockout opportunities, avg price, demand signal, and restock cadence. Click any row to see full brand-level detail." source="product_snapshots · inventory_events · price_daily · product_attention_summary" />
            </h2>
            <div className="sub">{brandOverviewRows.length} brands · click a row for full sales detail</div>
          </div>
        </div>
        <div className="card">
          <div className="table-wrap">
            <table className="data" style={{ width: '100%' }}>
              <thead><tr>
                <th style={{ width: 28, textAlign: 'center', color: 'var(--fg-4)', fontSize: 10 }}>#</th>
                <SortTh col="brand"    label="Brand"         sortKey={ovSortKey} sortDir={ovSortDir} toggle={brandOverview.toggleOvSort} style={{ minWidth: 130 }} />
                <SortTh col="total"    label="Products"      sortKey={ovSortKey} sortDir={ovSortDir} toggle={brandOverview.toggleOvSort} style={{ textAlign: 'right', width: 80 }} />
                <SortTh col="inStock"  label="In Stock"      sortKey={ovSortKey} sortDir={ovSortDir} toggle={brandOverview.toggleOvSort} style={{ textAlign: 'right', width: 80 }} />
                <SortTh col="outStock" label="Out of Stock"  sortKey={ovSortKey} sortDir={ovSortDir} toggle={brandOverview.toggleOvSort} style={{ textAlign: 'right', width: 90 }} />
                <th style={{ minWidth: 120 }}>Stock Health</th>
                <SortTh col="stockouts" label="Stockout Opps" sortKey={ovSortKey} sortDir={ovSortDir} toggle={brandOverview.toggleOvSort} style={{ textAlign: 'right', width: 100 }} />
                <SortTh col="avgPrice" label="Avg Price"     sortKey={ovSortKey} sortDir={ovSortDir} toggle={brandOverview.toggleOvSort} style={{ textAlign: 'right', width: 85 }} />
                <SortTh col="demand"   label="Demand 30d"    sortKey={ovSortKey} sortDir={ovSortDir} toggle={brandOverview.toggleOvSort} style={{ textAlign: 'right', width: 90 }} />
                <th style={{ width: 110 }}>Restock Pattern</th>
                <th style={{ width: 70, textAlign: 'center' }}>Detail</th>
              </tr></thead>
              <tbody>
                {brandOverviewRows.map((row, i) => {
                  const isJ = row.brand.slug === 'joola'
                  const color = brandColor(row.brand.slug)
                  const inPct = row.total > 0 ? Math.round((row.inStock / row.total) * 100) : 0
                  const patternColor = row.topPattern === 'Frequent' ? '#22c55e' : row.topPattern === 'Steady' ? '#F5E625' : row.topPattern === 'Occasional' ? '#fb923c' : '#6b7280'
                  return (
                    <tr key={row.brand.slug} className={isJ ? 'joola' : ''}
                      style={{ cursor: 'pointer' }}
                      onClick={() => router.push(`/v2/sales-intel/brand/${encodeURIComponent(row.brand.slug)}`)}
                      title={`View ${row.brand.name} sales detail`}>
                      <td style={{ textAlign: 'center', fontSize: 11, color: 'var(--fg-4)', fontFamily: 'JetBrains Mono' }}>{i + 1}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                          <span style={{ fontWeight: 700, color: isJ ? '#22c55e' : 'var(--fg)' }}>{row.brand.name}</span>
                        </span>
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right', fontFamily: 'JetBrains Mono', fontWeight: 700, color: isJ ? '#22c55e' : 'var(--fg)' }}>{row.total || '—'}</td>
                      <td className="cell-num" style={{ textAlign: 'right', fontWeight: 700, color: '#22c55e', fontFamily: 'JetBrains Mono' }}>{row.inStock > 0 ? row.inStock : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                      <td className="cell-num" style={{ textAlign: 'right', fontWeight: 700, color: row.outStock > 0 ? '#ef4444' : 'var(--fg-4)', fontFamily: 'JetBrains Mono' }}>{row.outStock > 0 ? row.outStock : '—'}</td>
                      <td>
                        {row.total > 0 ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1, height: 6, background: 'var(--wb-6)', borderRadius: 99, overflow: 'hidden', minWidth: 60 }}>
                              <div style={{ height: '100%', width: `${inPct}%`, background: inPct > 70 ? '#22c55e' : inPct > 40 ? '#F5E625' : '#ef4444', borderRadius: 99 }} />
                            </div>
                            <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono', color: 'var(--fg-3)', minWidth: 30 }}>{inPct}%</span>
                          </div>
                        ) : <span style={{ color: 'var(--fg-4)', fontSize: 11 }}>No data</span>}
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>
                        {row.stockouts > 0 ? (
                          <span style={{ fontWeight: 700, color: '#fb923c', fontFamily: 'JetBrains Mono', fontSize: 12 }}>{row.stockouts}</span>
                        ) : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right', fontFamily: 'JetBrains Mono', color: 'var(--fg-2)', fontWeight: 600 }}>
                        {row.avgPrice != null ? `$${Math.round(row.avgPrice)}` : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right', fontFamily: 'JetBrains Mono', color: '#818cf8', fontWeight: 700 }}>
                        {row.demand > 0 ? fmt(row.demand) : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                      </td>
                      <td>
                        {row.topPattern ? (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: patternColor + '18', color: patternColor, border: `1px solid ${patternColor}44` }}>{row.topPattern}</span>
                        ) : <span style={{ color: 'var(--fg-4)', fontSize: 11 }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => router.push(`/v2/sales-intel/brand/${encodeURIComponent(row.brand.slug)}`)}
                          className="btn btn-ghost" style={{ fontSize: 10, padding: '3px 8px' }}>Detail →</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ─── Section 1: Inventory Status Grid ─────────────────────── */}
      <section ref={row3.ref} className={revealCls(row3.vis)}>
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
                      borderTop: '1px solid var(--wb-6)',
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
      <section ref={row4.ref} className={revealCls(row4.vis)}>
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
                <thead style={{ position: 'sticky', top: 0, background: 'var(--sticky-bg)', zIndex: 2 }}>
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
      <section ref={row5.ref} className={revealCls(row5.vis)}>
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
                <thead style={{ position: 'sticky', top: 0, background: 'var(--sticky-bg)', zIndex: 2 }}>
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
                          <div style={{ background: 'var(--line-2)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
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
      <section ref={row6.ref} className={revealCls(row6.vis)}>
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
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--sticky-bg)', zIndex: 2 }}>
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
              <div style={{ fontSize: 10, color: '#6b7280', padding: '8px 16px 12px', borderTop: '1px solid var(--line-2)' }}>
                Tracking {variants.length} product variants across {kpis.brandsWithData} brands.
              </div>
            </>
          )}
        </div>
      </section>

      {/* ─── NEW SECTIONS · Sales Intel Expansion (2026-05-25) ──── */}

      {/* ── F. Competitor stockout opportunity ──────────────────── */}
      <section ref={row7.ref} className={revealCls(row7.vis)}>
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
                <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--sticky-bg)' }}>
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
                <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--sticky-bg)' }}>
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
                <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--sticky-bg)' }}>
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

      {/* ─── Section J: Sellout Velocity ──────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              J. Sellout velocity · {selloutByBrand.length} brands
              <SectionInfo
                title="Sellout Velocity"
                description="How often each brand's products sell out, measured as the total count of 'sellout' events from inventory tracking. Brands with high sellout counts are clearing stock fast — a signal of strong demand or thin inventory buffers. The bar shows relative frequency vs the top brand."
                source="inventory_events WHERE event_type = 'sellout' · grouped by brand"
              />
            </h2>
            <div className="sub">
              Relative sellout frequency across {inventoryEvts.filter(e => e.event_type === 'sellout').length} recorded sellout events.
              {' '}High sellout count = demand outpacing supply.
            </div>
          </div>
        </div>

        {selloutByBrand.length === 0 ? (
          <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>
            No sellout events recorded yet — inventory_events.event_type=&apos;sellout&apos; populates once the sales pipeline scrapes consecutive snapshots showing in_stock → out_of_stock transitions.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {selloutByBrand.map((row) => {
              const isJoola = row.brand.slug === 'joola'
              const color = brandColor(row.brand.slug)
              const pct = (row.count / maxSelloutCount) * 100
              return (
                <div
                  key={row.brand.id}
                  className="card"
                  style={{ padding: 16, borderLeft: `3px solid ${color}` }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                    <span style={{ fontWeight: 800, fontSize: 14, color: isJoola ? '#22c55e' : '#fff' }}>
                      {row.brand.name}
                    </span>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, fontSize: 18, color: color }}>
                      {row.count}
                    </span>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 4, height: 6, marginBottom: 8 }}>
                    <div style={{ background: `linear-gradient(90deg, ${color}cc, ${color}44)`, borderRadius: 4, height: 6, width: `${Math.max(3, pct)}%`, transition: 'width 0.4s ease' }} />
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--fg-4)' }}>
                    sellout events · last: {row.latest ? row.latest.slice(0, 10) : '—'}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <ActionFrame
          move="A brand with a high sellout count is repeatedly running out of specific SKUs — demand is outpacing their replenishment cycle."
          impact="When a competitor sells out of a high-demand paddle, that buyer is now in-market for an alternative. JOOLA's window to capture that demand is typically 48–96 hours before the competitor restocks or the buyer moves on."
          action="For the top-3 brands by sellout count, prepare same-day paid targeting on their most frequently mentioned paddles. Run for 72h post-sellout detection, refresh every Monday after the pipeline runs."
        />
        <Caveat tables={['inventory_events (event_type = sellout, grouped by brand)']} />
      </section>

      {/* ─── Section K: Estimated Sales Transactions ──────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              K. Estimated sales transactions · {salesEstimates.length} records
              <SectionInfo
                title="Estimated Sales Transactions"
                description="INFERRED sales events derived from public inventory signals. Two methods: (1) inventory_delta — when consecutive snapshots show a quantity drop (e.g. 47→32 units = 15 sold), confidence 0.5–1.0; (2) availability_flip — when status changes in_stock→out_of_stock with no unit count, confidence 0.25. These are estimates, not verified sales data."
                source="sales_estimates · populated by backend/scraping/sales_intelligence/estimate.py"
              />
            </h2>
            <div className="sub">
              Est. total:{' '}
              <strong style={{ color: '#F5E625' }}>{totalEstUnits} units</strong>{' '}
              ·{' '}
              <strong style={{ color: '#22c55e' }}>${totalEstRev.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>{' '}
              estimated revenue · Confidence reflects signal quality, not verified sales.
            </div>
          </div>
          <input
            className="col-filter"
            placeholder="Search brand or product…"
            value={estSearch}
            onChange={e => setEstSearch(e.target.value)}
            style={{ width: 220, alignSelf: 'center' }}
          />
        </div>

        <div
          className="card"
          style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)', padding: 12, marginBottom: 12, fontSize: 12, color: '#fbbf24' }}
        >
          <strong>Estimation methodology:</strong>{' '}
          <strong>inventory_delta</strong> (high confidence) = two consecutive crawl4ai snapshots showing a quantity drop; units_sold = prev_qty − curr_qty.{' '}
          <strong>availability_flip</strong> (low confidence) = in_stock → out_of_stock status change with no quantity data; records as 1 unit minimum signal.{' '}
          Neither method reflects verified POS data.
        </div>

        <div className="card">
          {displayEstimates.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>
              No sales estimates yet — populates after the sales-intelligence pipeline runs with consecutive product snapshots (Phase 4 of weekly_run.py).
            </div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto', overflowX: 'auto' }}>
              <table className="data">
                <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
                  <tr>
                    <SortTh col="estimate_date" label="Date" sortKey={estSortKey} sortDir={estSortDir} toggle={toggleEst} style={{ width: 100 }} />
                    <SortTh col="brand_id" label="Brand" sortKey={estSortKey} sortDir={estSortDir} toggle={toggleEst} />
                    <th style={{ minWidth: 140 }}>Product</th>
                    <SortTh col="estimation_method" label="Method" sortKey={estSortKey} sortDir={estSortDir} toggle={toggleEst} />
                    <SortTh col="estimated_units_sold" label="Units" sortKey={estSortKey} sortDir={estSortDir} toggle={toggleEst} style={{ textAlign: 'right' }} title="Estimated units sold in this window" />
                    <SortTh col="estimated_revenue" label="Est. Revenue" sortKey={estSortKey} sortDir={estSortDir} toggle={toggleEst} style={{ textAlign: 'right' }} title="units × observed price" />
                    <SortTh col="price_used" label="Price" sortKey={estSortKey} sortDir={estSortDir} toggle={toggleEst} style={{ textAlign: 'right' }} />
                    <SortTh col="confidence_score" label="Confidence" sortKey={estSortKey} sortDir={estSortDir} toggle={toggleEst} style={{ textAlign: 'right' }} title="0.25 = flip signal only, 0.5–1.0 = qty delta" />
                    <th>Qty Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {displayEstimates.map((e, i) => {
                    const brand = brandById.get(e.brand_id)
                    const slug = brand?.slug ?? ''
                    const color = brandColor(slug)
                    const methodPill = e.estimation_method === 'inventory_delta' ? 'pill-green' : 'pill-ghost'
                    const confColor = e.confidence_score >= 0.5 ? '#22c55e' : e.confidence_score >= 0.3 ? '#F5E625' : '#9ca3af'
                    return (
                      <tr key={i}>
                        <td style={{ fontSize: 11, color: 'var(--fg-2)', whiteSpace: 'nowrap' }}>{e.estimate_date}</td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span className="brand-dot" style={{ background: color }} />
                            <span style={{ fontWeight: 700, color: slug === 'joola' ? '#22c55e' : 'var(--fg)', fontSize: 12 }}>
                              {brand?.name ?? e.brand_id.slice(0, 8)}
                            </span>
                          </span>
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--fg-2)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={(() => { const pid = e.product_id ?? (e.variant_id ? variantById.get(e.variant_id)?.product_id ?? null : null); return pid ? (productById.get(pid)?.display_name ?? '—') : '—' })()}>
                          {(() => {
                            const pid = e.product_id ?? (e.variant_id ? variantById.get(e.variant_id)?.product_id ?? null : null)
                            return pid ? (productById.get(pid)?.display_name ?? '—') : '—'
                          })()}
                        </td>
                        <td><span className={`pill ${methodPill}`} style={{ fontSize: 10 }}>{e.estimation_method.replace(/_/g, ' ')}</span></td>
                        <td className="cell-num" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#F5E625' }}>
                          {e.estimated_units_sold}
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#22c55e' }}>
                          ${(e.estimated_revenue ?? 0).toFixed(2)}
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {e.price_used != null ? '$' + e.price_used.toFixed(2) : '—'}
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: confColor, fontWeight: 700 }}>
                          {(e.confidence_score * 100).toFixed(0)}%
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap', fontFamily: 'JetBrains Mono, monospace' }}>
                          {e.inventory_start != null && e.inventory_end != null
                            ? `${e.inventory_start} → ${e.inventory_end}`
                            : '—'}
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

      {/* ─── Section L: Inventory Event Timeline ──────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              L. Inventory event log · {inventoryEvts.length} events
              <SectionInfo
                title="Inventory Event Log"
                description="Append-only log of every inventory transition detected. Event types: sale = quantity drop (Path A); restock = quantity increase; sellout = product went out of stock; reappearance = new variant detected or product came back. Color-coded by event type. This is the raw signal feed that feeds the estimates above."
                source="inventory_events · ordered by event_time DESC, latest 500"
              />
            </h2>
            <div className="sub">
              {inventoryEvts.filter(e => e.event_type === 'sale').length} sales ·{' '}
              {inventoryEvts.filter(e => e.event_type === 'restock').length} restocks ·{' '}
              {inventoryEvts.filter(e => e.event_type === 'sellout').length} sellouts ·{' '}
              {inventoryEvts.filter(e => e.event_type === 'reappearance').length} reappearances
            </div>
          </div>
          <input
            className="col-filter"
            placeholder="Search brand…"
            value={evtSearch}
            onChange={e => setEvtSearch(e.target.value)}
            style={{ width: 200, alignSelf: 'center' }}
          />
        </div>

        <div className="card">
          {displayEvts.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>
              No inventory events yet — populates after the first sales-intelligence pipeline run captures consecutive product snapshots.
            </div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto', overflowX: 'auto' }}>
              <table className="data">
                <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
                  <tr>
                    <SortTh col="event_time" label="Time" sortKey={evtSortKey} sortDir={evtSortDir} toggle={toggleEvt} style={{ width: 130 }} />
                    <SortTh col="brand_id" label="Brand" sortKey={evtSortKey} sortDir={evtSortDir} toggle={toggleEvt} />
                    <th style={{ minWidth: 140 }}>Product</th>
                    <SortTh col="event_type" label="Event" sortKey={evtSortKey} sortDir={evtSortDir} toggle={toggleEvt} />
                    <SortTh col="previous_qty" label="Prev Qty" sortKey={evtSortKey} sortDir={evtSortDir} toggle={toggleEvt} style={{ textAlign: 'right' }} />
                    <SortTh col="current_qty" label="Curr Qty" sortKey={evtSortKey} sortDir={evtSortDir} toggle={toggleEvt} style={{ textAlign: 'right' }} />
                    <SortTh col="delta_qty" label="Delta" sortKey={evtSortKey} sortDir={evtSortDir} toggle={toggleEvt} style={{ textAlign: 'right' }} />
                    <SortTh col="confidence_score" label="Confidence" sortKey={evtSortKey} sortDir={evtSortDir} toggle={toggleEvt} style={{ textAlign: 'right' }} />
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {displayEvts.slice(0, 200).map((e, i) => {
                    const brand = brandById.get(e.brand_id)
                    const slug = brand?.slug ?? ''
                    const color = brandColor(slug)
                    const eventPill =
                      e.event_type === 'sale' ? 'pill-green' :
                      e.event_type === 'restock' ? 'pill-info' :
                      e.event_type === 'sellout' ? 'pill-red' :
                      'pill-amber'
                    const deltaColor = (e.delta_qty ?? 0) < 0 ? '#22c55e' : (e.delta_qty ?? 0) > 0 ? '#3b82f6' : 'var(--fg-3)'
                    return (
                      <tr key={i}>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 11, color: '#9ca3af' }}>
                          {formatSnapshotTime(e.event_time)}
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span className="brand-dot" style={{ background: color }} />
                            <span style={{ fontWeight: 700, color: slug === 'joola' ? '#22c55e' : 'var(--fg)', fontSize: 12 }}>
                              {brand?.name ?? e.brand_id.slice(0, 8)}
                            </span>
                          </span>
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--fg-2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={(() => { const pid = e.variant_id ? variantById.get(e.variant_id)?.product_id ?? null : null; return pid ? (productById.get(pid)?.display_name ?? '—') : '—' })()}>
                          {(() => {
                            const pid = e.variant_id ? variantById.get(e.variant_id)?.product_id ?? null : null
                            return pid ? (productById.get(pid)?.display_name ?? '—') : '—'
                          })()}
                        </td>
                        <td><span className={`pill ${eventPill}`} style={{ fontSize: 10 }}>{e.event_type}</span></td>
                        <td className="cell-num" style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: 'var(--fg-3)' }}>
                          {e.previous_qty != null ? e.previous_qty : '—'}
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: 'var(--fg)' }}>
                          {e.current_qty != null ? e.current_qty : '—'}
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: deltaColor }}>
                          {e.delta_qty != null ? (e.delta_qty > 0 ? '+' : '') + e.delta_qty : '—'}
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: (e.confidence_score ?? 0) >= 0.5 ? '#22c55e' : '#9ca3af' }}>
                          {e.confidence_score != null ? (e.confidence_score * 100).toFixed(0) + '%' : '—'}
                        </td>
                        <td style={{ fontSize: 10 }}>
                          <span className="pill pill-ghost">{e.reason_code?.replace(/_/g, ' ') ?? '—'}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <Caveat tables={['inventory_events (ordered by event_time DESC, limit 200 displayed of 500 fetched)']} />
      </section>

      {/* ─── Section M: Sales Over Time ────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              M. Sales over time · {salesByDate.dates.length} date{salesByDate.dates.length === 1 ? '' : 's'} tracked
              <SectionInfo
                title="Sales Over Time"
                description="Estimated units sold or revenue across all brands over the scraped date range. Prefers sales_facts_daily (Phase 3 denormalised roll-up) and falls back to sales_estimates aggregated by estimate_date. Both are inferred from public inventory signals, not verified POS data."
                source="sales_facts_daily (preferred) · sales_estimates (fallback) — grouped by brand × date"
              />
            </h2>
            <div className="sub">
              {salesByDate.source === 'sales_facts_daily' ? 'Source: sales_facts_daily (Phase 3 roll-up)' : salesByDate.source === 'sales_estimates' ? 'Source: sales_estimates (availability-flip signals)' : 'Populates after Phase 3 or Phase 4 pipeline runs.'}
              {salesByDate.series.length > 0 && (
                <span style={{ marginLeft: 12, color: '#F5E625' }}>
                  {salesByDate.series.length} brand{salesByDate.series.length === 1 ? '' : 's'} with data
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              className={salesTimeView === 'volume' ? 'btn btn-yellow' : 'btn'}
              style={{ fontSize: 12, padding: '4px 12px' }}
              onClick={() => setSalesTimeView('volume')}
            >
              Volume
            </button>
            <button
              className={salesTimeView === 'revenue' ? 'btn btn-yellow' : 'btn'}
              style={{ fontSize: 12, padding: '4px 12px' }}
              onClick={() => setSalesTimeView('revenue')}
            >
              Revenue
            </button>
          </div>
        </div>

        {salesByDate.dates.length === 0 ? (
          <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>
            Sales over time chart populates once <strong style={{ color: 'var(--fg-2)' }}>Phase 3</strong> (sales_facts_daily roll-up) or <strong style={{ color: 'var(--fg-2)' }}>Phase 4</strong> (crawl4ai inventory snapshots) of the weekly pipeline complete.
            <div style={{ fontSize: 11, marginTop: 8, color: 'var(--fg-4)' }}>
              Run: <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 4 }}>python scripts/weekly_run.py</code>
            </div>
          </div>
        ) : (
          <div className="card"><div className="card-pad">
            <LineChart
              series={salesByDate.series.map(s => ({
                id: s.label,
                label: s.label,
                color: s.color,
                data: salesTimeView === 'volume' ? s.data : s.dataRev,
              }))}
              xLabels={salesByDate.dates.map(d => d.slice(5))}
              h={300}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
              {salesByDate.series.map(s => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                  <span style={{ color: 'var(--fg-2)' }}>{s.label}</span>
                  <span style={{ color: s.color, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
                    {salesTimeView === 'volume'
                      ? s.data.reduce((a, b) => a + b, 0) + ' units'
                      : '$' + s.dataRev.reduce((a, b) => a + b, 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </span>
                </div>
              ))}
            </div>
          </div></div>
        )}
        <ActionFrame
          move="Track which brands show consistent weekly sales velocity vs. one-off spikes — velocity brands are taking share, spike brands are clearing excess inventory."
          impact="A brand with rising revenue velocity and rising out-of-stock events is supply-constrained, not demand-constrained — JOOLA's window to capture that demand is narrow."
          action="Flag any brand whose weekly volume drops >30% WoW while sellout events rise — that's the clearest demand-transfer trigger for same-day campaign activation."
        />
        <Caveat tables={['sales_facts_daily (Phase 3 roll-up, preferred)', 'sales_estimates (Phase 4 availability signals, fallback)']} />
      </section>

      {/* ─── Section N: Best Selling Products ─────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              N. Best selling products · {bestSellers.length} ranked
              <SectionInfo
                title="Best Selling Products"
                description="Products ranked by estimated revenue, derived from inventory delta signals. Each row is one paddle in the catalog that had at least one estimable sales event. Price, discount, and sell-through rate come from snapshot data; reviews and rating from the product catalog."
                source="sales_estimates (units + revenue) · products_catalog (name, rating, reviews) · product_variants (price, first seen) · product_snapshots (sell-through inventory)"
              />
            </h2>
            <div className="sub">
              Ranked by estimated revenue. Sell-through = units ÷ (units + inventory ÷ 2). Daily vel. = units ÷ days active.
              {' '}<span style={{ color: 'var(--fg-4)', fontSize: 11 }}>Confidence reflects signal method, not verified sales.</span>
            </div>
          </div>
          <input
            className="col-filter"
            placeholder="Search product or brand…"
            value={bsSearch}
            onChange={e => setBsSearch(e.target.value)}
            style={{ width: 220, alignSelf: 'center' }}
          />
        </div>

        {bestSellers.length === 0 ? (
          <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>
            Best selling products populates after the <strong style={{ color: 'var(--fg-2)' }}>sales-intelligence pipeline</strong> (Phase 4) detects inventory deltas on consecutive product snapshots.
            <div style={{ fontSize: 11, marginTop: 8 }}>
              Requires at least 2 weekly crawl4ai runs to produce inventory_delta records.
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="table-wrap" style={{ maxHeight: 640, overflowY: 'auto', overflowX: 'auto' }}>
              <table className="data">
                <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
                  <tr>
                    <th style={{ width: 36, textAlign: 'center', color: 'var(--fg-4)', fontSize: 10 }}>#</th>
                    <SortTh col="productName" label="Product" sortKey={bsSortKey} sortDir={bsSortDir} toggle={toggleBs} />
                    <SortTh col="brandSlug" label="Brand" sortKey={bsSortKey} sortDir={bsSortDir} toggle={toggleBs} />
                    <SortTh col="avgPrice" label="Price" sortKey={bsSortKey} sortDir={bsSortDir} toggle={toggleBs} style={{ textAlign: 'right' }} title="Average price observed across snapshots for this product's variants" />
                    <SortTh col="avgDiscount" label="Avg Disc%" sortKey={bsSortKey} sortDir={bsSortDir} toggle={toggleBs} style={{ textAlign: 'right' }} title="Average discount % = (compare_at_price − price) ÷ compare_at_price × 100. Only populated when compare_at_price is available in Shopify JSON." />
                    <SortTh col="totalUnits" label="Volume" sortKey={bsSortKey} sortDir={bsSortDir} toggle={toggleBs} style={{ textAlign: 'right' }} title="Estimated total units sold — sum of inventory_delta events for this product across all variants" />
                    <SortTh col="dailyVelocity" label="Daily Vel." sortKey={bsSortKey} sortDir={bsSortDir} toggle={toggleBs} style={{ textAlign: 'right' }} title="Estimated units sold per day = total volume ÷ days since first seen. Equivalent to Particl's rate_sold metric. Higher = faster-moving SKU." />
                    <SortTh col="totalRevenue" label="Est. Revenue" sortKey={bsSortKey} sortDir={bsSortDir} toggle={toggleBs} style={{ textAlign: 'right' }} title="Estimated revenue = units sold × observed price. Not verified POS data." />
                    <SortTh col="sellThroughRate" label="Sell-Through" sortKey={bsSortKey} sortDir={bsSortDir} toggle={toggleBs} style={{ textAlign: 'right' }} title="Sell-through rate = units sold ÷ (units sold + current inventory ÷ 2). Halved denominator follows Particl convention: current snapshot is end-of-period, so average-period inventory ≈ current ÷ 2. High rate = strong demand vs. stock." />
                    <SortTh col="reviewCount" label="Reviews" sortKey={bsSortKey} sortDir={bsSortDir} toggle={toggleBs} style={{ textAlign: 'right' }} title="Total public review count from the brand's product page (scraped via scrape_catalog). Industry proxy: ~3-5% of buyers leave a review." />
                    <SortTh col="avgRating" label="Rating" sortKey={bsSortKey} sortDir={bsSortDir} toggle={toggleBs} style={{ textAlign: 'right' }} title="Average star rating scraped from the brand's product page (1–5). Source: products_catalog.avg_rating." />
                    <SortTh col="avgConfidence" label="Conf." sortKey={bsSortKey} sortDir={bsSortDir} toggle={toggleBs} style={{ textAlign: 'right' }} title="Average confidence of the underlying sales estimate. 0.5–1.0 = quantity delta method (high). 0.25 = availability-flip only (low)." />
                    <SortTh col="firstSeen" label="First Seen" sortKey={bsSortKey} sortDir={bsSortDir} toggle={toggleBs} title="Date this variant first appeared in the JOOLA Intel product tracking database." />
                  </tr>
                </thead>
                <tbody>
                  {displayBestSellers.map((row, i) => {
                    const color = brandColor(row.brandSlug)
                    const isJoola = row.brandSlug === 'joola'
                    const confColor = row.avgConfidence >= 0.5 ? '#22c55e' : row.avgConfidence >= 0.3 ? '#F5E625' : '#9ca3af'
                    const stColor = (row.sellThroughRate ?? 0) >= 50 ? '#22c55e' : (row.sellThroughRate ?? 0) >= 20 ? '#F5E625' : '#9ca3af'
                    return (
                      <tr key={row.productId}>
                        <td style={{ textAlign: 'center', color: 'var(--fg-4)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                          {i + 1}
                        </td>
                        <td style={{ maxWidth: 240 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: isJoola ? '#22c55e' : 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={row.productName}>
                            {row.productName}
                          </div>
                          {row.category && (
                            <div style={{ fontSize: 10, color: 'var(--fg-4)', marginTop: 2 }}>{row.category}</div>
                          )}
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <span className="brand-dot" style={{ background: color }} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: isJoola ? '#22c55e' : 'var(--fg-2)' }}>{row.brand?.name ?? row.brandSlug}</span>
                          </span>
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                          {row.avgPrice > 0 ? '$' + row.avgPrice.toFixed(0) : '—'}
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right', fontSize: 12 }}>
                          {row.avgDiscount != null ? (
                            <span style={{ color: '#f59e0b', fontWeight: 700 }}>{row.avgDiscount.toFixed(1)}%</span>
                          ) : '—'}
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: '#F5E625', fontSize: 13 }}>
                          {row.totalUnits.toFixed(0)}
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--fg-2)' }}>
                          {row.dailyVelocity != null ? row.dailyVelocity.toFixed(2) + '/d' : '—'}
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: '#22c55e', fontSize: 13 }}>
                          ${row.totalRevenue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right' }}>
                          {row.sellThroughRate != null ? (
                            <span style={{ color: stColor, fontWeight: 700, fontSize: 12 }}>{row.sellThroughRate.toFixed(1)}%</span>
                          ) : '—'}
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right', fontSize: 12 }}>
                          {row.reviewCount != null && row.reviewCount > 0 ? (
                            <span style={{ color: 'var(--fg-2)' }}>{row.reviewCount.toLocaleString()}</span>
                          ) : '—'}
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right' }}>
                          {row.avgRating != null ? (
                            <span style={{ color: '#F5E625', fontSize: 12, fontWeight: 700 }}>
                              ★ {row.avgRating.toFixed(1)}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right', fontWeight: 700, color: confColor, fontSize: 11 }}>
                          {(row.avgConfidence * 100).toFixed(0)}%
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
                          {row.firstSeen ? row.firstSeen.slice(0, 10) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <ActionFrame
          move="Products with high sell-through (>50%) and high review counts are in genuine demand — use these as benchmarks for JOOLA comparable paddle positioning."
          impact="A competitor paddle with 200+ reviews and >40% sell-through is a proven market winner. If JOOLA has no direct comparable at a similar price, that's a product gap."
          action="For every top-10 product with high sell-through and high reviews, identify the closest JOOLA paddle by specs (weight, material, shape). If the JOOLA comp ranks below #20, escalate to product team as a positioning priority."
        />
        <Caveat tables={['sales_estimates (units + revenue)', 'products_catalog (display_name, avg_rating, review_count)', 'product_variants (price, compare_at_price, first_seen_at)', 'product_snapshots (visible_inventory_qty for sell-through)']} />
      </section>

      {/* ─── Section O: Brand Sales Breakdown ─────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              O. Brand sales breakdown · {brandSalesRows.length} brands
              <SectionInfo
                title="Brand Sales Breakdown"
                description="Per-brand rollup of estimated sales volume, revenue, average price, discount rate, stock availability, and product ratings. All revenue and unit figures are inferred from public inventory signals (not verified POS). Sorted by estimated revenue descending."
                source="sales_estimates (units + revenue) · product_snapshots (price, stock %) · products_catalog (avg_rating, review_count)"
              />
            </h2>
            <div className="sub">
              Per-brand summary. Revenue is estimated from inventory signals — compare relative ranking, not absolute values.
            </div>
          </div>
          <input
            className="col-filter"
            placeholder="Search brand…"
            value={brandSearch}
            onChange={e => setBrandSearch(e.target.value)}
            style={{ width: 180, alignSelf: 'center' }}
          />
        </div>

        <div className="card">
          <div className="table-wrap" style={{ overflowX: 'auto' }}>
            <table className="data">
              <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
                <tr>
                  <SortTh col="brand" label="Brand" sortKey={brandSortKey} sortDir={brandSortDir} toggle={toggleBrand} />
                  <SortTh col="productCount" label="# Products" sortKey={brandSortKey} sortDir={brandSortDir} toggle={toggleBrand} style={{ textAlign: 'right' }} title="Number of paddle SKUs in products_catalog for this brand" />
                  <SortTh col="avgPrice" label="Avg Price" sortKey={brandSortKey} sortDir={brandSortDir} toggle={toggleBrand} style={{ textAlign: 'right' }} title="Average price observed across all product snapshots for this brand" />
                  <SortTh col="avgDiscount" label="Avg Disc%" sortKey={brandSortKey} sortDir={brandSortDir} toggle={toggleBrand} style={{ textAlign: 'right' }} title="Average discount % from product_variants compare_at_price" />
                  <SortTh col="totalUnits" label="Est. Units" sortKey={brandSortKey} sortDir={brandSortDir} toggle={toggleBrand} style={{ textAlign: 'right' }} title="Total estimated units sold (sum of all sales_estimates records)" />
                  <SortTh col="totalRevenue" label="Est. Revenue" sortKey={brandSortKey} sortDir={brandSortDir} toggle={toggleBrand} style={{ textAlign: 'right' }} title="Total estimated revenue = units × observed price" />
                  <SortTh col="totalReviews" label="Reviews" sortKey={brandSortKey} sortDir={brandSortDir} toggle={toggleBrand} style={{ textAlign: 'right' }} title="Total public review count across all products in this brand's catalog" />
                  <SortTh col="avgRating" label="Avg Rating" sortKey={brandSortKey} sortDir={brandSortDir} toggle={toggleBrand} style={{ textAlign: 'right' }} title="Average star rating across all products with ratings in this brand's catalog" />
                  <SortTh col="inStockPct" label="In Stock %" sortKey={brandSortKey} sortDir={brandSortDir} toggle={toggleBrand} style={{ textAlign: 'right' }} title="Percentage of tracked product variants currently in_stock at latest snapshot" />
                </tr>
              </thead>
              <tbody>
                {displayBrandSalesRows.map((row) => {
                  const color = brandColor(row.brand.slug)
                  const isJoola = row.brand.slug === 'joola'
                  const hasEstimates = row.totalRevenue > 0 || row.totalUnits > 0
                  return (
                    <tr key={row.brand.id}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
                          <span style={{ fontWeight: 800, fontSize: 13, color: isJoola ? '#22c55e' : 'var(--fg)' }}>
                            {row.brand.name}
                          </span>
                          {isJoola && <span className="pill pill-green" style={{ fontSize: 9 }}>JOOLA</span>}
                        </span>
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right', color: 'var(--fg-2)' }}>
                        {row.productCount}
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                        {row.avgPrice != null ? '$' + row.avgPrice.toFixed(0) : '—'}
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>
                        {row.avgDiscount != null ? (
                          <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 12 }}>{row.avgDiscount.toFixed(1)}%</span>
                        ) : '—'}
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: hasEstimates ? '#F5E625' : 'var(--fg-4)', fontSize: 13 }}>
                        {hasEstimates ? row.totalUnits.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, color: hasEstimates ? '#22c55e' : 'var(--fg-4)', fontSize: 13 }}>
                        {hasEstimates ? '$' + row.totalRevenue.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right', color: 'var(--fg-2)', fontSize: 12 }}>
                        {row.totalReviews > 0 ? row.totalReviews.toLocaleString() : '—'}
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>
                        {row.avgRating != null ? (
                          <span style={{ color: '#F5E625', fontWeight: 700, fontSize: 12 }}>★ {row.avgRating.toFixed(1)}</span>
                        ) : '—'}
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>
                        {row.inStockPct != null ? (
                          <span style={{ color: row.inStockPct >= 70 ? '#22c55e' : row.inStockPct >= 40 ? '#F5E625' : '#ef4444', fontWeight: 700, fontSize: 12 }}>
                            {row.inStockPct.toFixed(0)}%
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        <ActionFrame
          move="Brands with high review counts + high ratings + growing estimated revenue are the 'proven winners' in the category — they've crossed the social-proof threshold."
          impact="A brand with >$50K estimated revenue AND >4.5 avg rating AND >200 total reviews has a self-reinforcing competitive moat. JOOLA needs to match or exceed on at least two of the three axes."
          action="For any brand outperforming JOOLA on this table, run the 'crisis scan' on the underperforming JOOLA paddles (Section D) and fast-follow with review-solicitation campaigns on the JOOLA comparable."
        />
        <Caveat tables={['sales_estimates (grouped by brand_id)', 'product_snapshots (latest per product, price + availability)', 'products_catalog (avg_rating, review_count — from scrape_catalog scraper)']} />
        <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: 12, marginTop: 12, fontSize: 11, color: '#fbbf24' }}>
          <strong>What scraper populates which column:</strong>
          {' '}Est. Units + Revenue → <code style={{ background: 'rgba(255,255,255,0.06)', padding: '0 4px', borderRadius: 3 }}>scripts/pipeline/sales_intelligence/estimate.py</code> (Phase 4).
          {' '}Avg Price + In Stock % → <code style={{ background: 'rgba(255,255,255,0.06)', padding: '0 4px', borderRadius: 3 }}>scripts/pipeline/scrape_inventory_crawl4ai.py</code> (Phase 4).
          {' '}Reviews + Rating → <code style={{ background: 'rgba(255,255,255,0.06)', padding: '0 4px', borderRadius: 3 }}>scripts/pipeline/scrape_catalog.py</code> (Phase 1).
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════ */}
      {/*  PRICING INTELLIGENCE BLOCK — Sections P-T                       */}
      {/*  Particl-style per-brand pricing view, scoped by global filter   */}
      {/* ════════════════════════════════════════════════════════════════ */}

      {/* ─── Section P: Best Selling Products (visual grid) ─────── */}
      <section>
        <div className="card">
          <div className="section-head">
            <h2>
              P · Best Selling Products
              <SectionInfo
                title="Best Selling Products"
                description={`Top 6 products by estimated revenue across ${scopedBrandLabel}. Revenue is sum of estimated_revenue from sales_estimates (Phase 4 pipeline). Product image is the og:image / Shopify featured_image scraped per product URL — falls back to brand-color placeholder when image_url is null.`}
                source="sales_estimates → product_id → products_catalog · ordered by total estimated_revenue desc"
              />
            </h2>
            <span className="sub">Scope: <strong style={{ color: '#fff' }}>{scopedBrandLabel}</strong></span>
          </div>
          {pBestSellers.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              No sales estimates yet for the selected scope. The Phase 4 estimator populates this after 2+ consecutive scrapes detect inventory deltas.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginTop: 8 }}>
              {pBestSellers.map((row, i) => {
                const color = brandColor(row.brandSlug)
                return (
                  <div key={row.productId} className="kpi" style={{ padding: 0, overflow: 'hidden', position: 'relative', minHeight: 240, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 2, background: 'rgba(13,17,23,0.85)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '2px 8px', fontWeight: 800, fontSize: 11, color: '#fff' }}>
                      #{i + 1}
                    </div>
                    <div style={{ height: 140, background: `linear-gradient(135deg, ${color}33 0%, ${color}11 50%, rgba(13,17,23,0.6) 100%)`, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: `2px solid ${color}`, overflow: 'hidden' }}>
                      {row.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={row.imageUrl}
                          alt={row.productName}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                          style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 8 }}
                        />
                      ) : (
                        <span style={{ fontSize: 42, opacity: 0.35, fontWeight: 900, letterSpacing: -2, color }}>
                          {(row.brand?.name ?? '?').slice(0, 1).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div style={{ padding: 10, flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ fontSize: 9, color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{row.brand?.name ?? '—'}</div>
                      <div style={{ fontSize: 12, color: '#fff', fontWeight: 600, lineHeight: 1.25 }} title={row.productName}>
                        {row.productName.length > 50 ? row.productName.slice(0, 48) + '…' : row.productName}
                      </div>
                      <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>${row.avgPrice ? row.avgPrice.toFixed(0) : '—'}</span>
                        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{fmt(row.totalRevenue)} rev</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <Caveat tables={['products_catalog (display_name, image_url)', 'sales_estimates (estimated_revenue grouped by product_id)', 'product_variants (price)']} />
        </div>
      </section>

      {/* ─── Section Q: Total Discounted Products (donut) ─────── */}
      <section>
        <div className="card">
          <div className="section-head">
            <h2>
              Q · Total Discounted Products
              <SectionInfo
                title="Total Discounted Products"
                description={`How many products are actively on sale right now. A variant is discounted when its current price is below its compare_at_price. % discounted = discounted_variants / total_variants. Scope: ${scopedBrandLabel}.`}
                source="product_variants · price < compare_at_price"
              />
            </h2>
            <span className="sub">Discount pressure check · {scopedBrandLabel}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 32, alignItems: 'center', padding: '8px 4px' }}>
            <div style={{ position: 'relative', width: 200, height: 200, justifySelf: 'center' }}>
              <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                <circle cx="50" cy="50" r="42" stroke="rgba(255,255,255,0.08)" strokeWidth="10" fill="none" />
                <circle
                  cx="50" cy="50" r="42"
                  stroke="#3b82f6" strokeWidth="10" fill="none"
                  strokeDasharray={`${(qDiscountStats.pct / 100) * (2 * Math.PI * 42)} ${2 * Math.PI * 42}`}
                  strokeLinecap="round"
                />
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 900, color: '#fff' }}>{qDiscountStats.pct.toFixed(0)}%</div>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>discounted</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#fff', lineHeight: 1 }}>
                {qDiscountStats.discounted} <span style={{ fontSize: 18, color: 'var(--muted)', fontWeight: 600 }}>/ {qDiscountStats.total}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>products on sale right now</div>
              <div style={{ marginTop: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span className="pill pill-info">discounted: {qDiscountStats.discounted}</span>
                <span className="pill pill-ghost">full price: {qDiscountStats.total - qDiscountStats.discounted}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
                {qDiscountStats.pct >= 40
                  ? 'Heavy promotional activity — likely clearing inventory or defending share.'
                  : qDiscountStats.pct >= 15
                    ? 'Moderate, healthy discount cadence.'
                    : 'Low discount intensity — full-price pricing posture.'}
              </div>
            </div>
          </div>
          <Caveat tables={['product_variants (price, compare_at_price)']} />
        </div>
      </section>

      {/* ─── Section R: Product Types ─────── */}
      <section>
        <div className="card">
          <div className="section-head">
            <h2>
              R · Product Types
              <SectionInfo
                title="Product Types"
                description={`Catalog rolled up by category. # Products counts products_catalog rows. Avg Rating averages products_catalog.avg_rating. % Discount = share of variants in the category with compare_at_price > price. Price Range, Avg Price, Avg Full Price come from latest snapshots and variant compare_at_price. Scope: ${scopedBrandLabel}.`}
                source="products_catalog grouped by category · enriched with product_variants + product_snapshots"
              />
            </h2>
            <span className="sub">Catalog by category · {scopedBrandLabel}</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data" style={{ width: '100%', minWidth: 760 }}>
              <thead style={{ position: 'sticky', top: 0, background: '#0d1117', zIndex: 1 }}>
                <tr>
                  <th style={{ textAlign: 'left' }}>Category</th>
                  <th style={{ textAlign: 'right' }}># Products</th>
                  <th style={{ textAlign: 'right' }}>Avg Rating</th>
                  <th style={{ textAlign: 'right' }}>% Discounted</th>
                  <th style={{ textAlign: 'right' }}>Price Range</th>
                  <th style={{ textAlign: 'right' }}>Avg Price</th>
                  <th style={{ textAlign: 'right' }}>Avg Full Price</th>
                  <th style={{ textAlign: 'right' }}>Avg Discount</th>
                </tr>
              </thead>
              <tbody>
                {rProductTypes.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24, fontSize: 12 }}>No catalog data for this scope.</td></tr>
                ) : rProductTypes.map(row => (
                  <tr key={row.category}>
                    <td style={{ fontWeight: 600, color: '#fff', textTransform: 'capitalize' }}>{row.category}</td>
                    <td style={{ textAlign: 'right' }}>{row.productCount}</td>
                    <td style={{ textAlign: 'right' }}>{row.avgRating != null ? row.avgRating.toFixed(2) : '—'}</td>
                    <td style={{ textAlign: 'right', color: row.pctDiscounted >= 30 ? '#3b82f6' : '#fff' }}>{row.pctDiscounted.toFixed(0)}%</td>
                    <td style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 11 }}>
                      {row.minPrice != null && row.maxPrice != null
                        ? `$${row.minPrice.toFixed(0)} – $${row.maxPrice.toFixed(0)}`
                        : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>{row.avgPrice != null ? '$' + row.avgPrice.toFixed(0) : '—'}</td>
                    <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{row.avgFullPrice != null ? '$' + row.avgFullPrice.toFixed(0) : '—'}</td>
                    <td style={{ textAlign: 'right', color: row.avgDiscount != null && row.avgDiscount > 20 ? '#ef4444' : '#fff' }}>
                      {row.avgDiscount != null ? row.avgDiscount.toFixed(1) + '%' : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Caveat tables={['products_catalog (category, avg_rating)', 'product_variants (price, compare_at_price)', 'product_snapshots (price)']} />
        </div>
      </section>

      {/* ─── Section S: Price Distribution (histogram) ─────── */}
      <section>
        <div className="card">
          <div className="section-head">
            <h2>
              S · Price Distribution
              <SectionInfo
                title="Price Distribution"
                description={`Where products sit on the price axis. The x-axis is split into 11 buckets between the 5th and 95th percentile of current prices (latest snapshot per product). The top bar shows % of products in each bucket; the bottom bar shows % of revenue (sum of estimated_revenue from sales_estimates). A right-shifted revenue distribution vs. product distribution signals premium-skewed demand. Scope: ${scopedBrandLabel}.`}
                source="product_snapshots (latest price) + sales_estimates (estimated_revenue)"
              />
            </h2>
            <span className="sub">{sPriceDistribution.totalProducts} products · {fmt(sPriceDistribution.totalRevenue)} est. revenue</span>
          </div>
          {sPriceDistribution.buckets.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No price data for this scope.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 0 8px' }}>
              {/* % of Product Prices */}
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontWeight: 600, letterSpacing: 0.3 }}>% OF PRODUCT PRICES</div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sPriceDistribution.buckets.length}, 1fr)`, gap: 4, alignItems: 'end', height: 120 }}>
                  {sPriceDistribution.buckets.map((b, i) => {
                    const maxPct = Math.max(...sPriceDistribution.buckets.map(x => x.productPct), 1)
                    const h = (b.productPct / maxPct) * 100
                    const isTop = b.productPct === maxPct
                    return (
                      <div key={i} title={`$${b.lo.toFixed(0)}–$${b.hi.toFixed(0)} · ${b.products} products · ${b.productPct.toFixed(1)}%`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{b.productPct.toFixed(0)}%</div>
                        <div style={{ width: '100%', height: `${h}%`, background: isTop ? '#3b82f6' : 'rgba(59,130,246,0.45)', borderRadius: '4px 4px 0 0', minHeight: 2 }} />
                      </div>
                    )
                  })}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sPriceDistribution.buckets.length}, 1fr)`, gap: 4, marginTop: 4, fontSize: 9, color: 'var(--muted)', textAlign: 'center' }}>
                  {sPriceDistribution.buckets.map((b, i) => <div key={i}>${b.lo.toFixed(0)}</div>)}
                </div>
              </div>
              {/* % of Revenue */}
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontWeight: 600, letterSpacing: 0.3 }}>% OF REVENUE</div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sPriceDistribution.buckets.length}, 1fr)`, gap: 4, alignItems: 'end', height: 120 }}>
                  {sPriceDistribution.buckets.map((b, i) => {
                    const maxPct = Math.max(...sPriceDistribution.buckets.map(x => x.revenuePct), 1)
                    const h = (b.revenuePct / maxPct) * 100
                    const isTop = b.revenuePct === maxPct
                    return (
                      <div key={i} title={`$${b.lo.toFixed(0)}–$${b.hi.toFixed(0)} · ${fmt(b.revenue)} revenue · ${b.revenuePct.toFixed(1)}%`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{b.revenuePct.toFixed(0)}%</div>
                        <div style={{ width: '100%', height: `${h}%`, background: isTop ? '#22c55e' : 'rgba(34,197,94,0.45)', borderRadius: '4px 4px 0 0', minHeight: 2 }} />
                      </div>
                    )
                  })}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sPriceDistribution.buckets.length}, 1fr)`, gap: 4, marginTop: 4, fontSize: 9, color: 'var(--muted)', textAlign: 'center' }}>
                  {sPriceDistribution.buckets.map((b, i) => <div key={i}>${b.lo.toFixed(0)}</div>)}
                </div>
              </div>
            </div>
          )}
          <Caveat tables={['product_snapshots (latest price per product)', 'sales_estimates (estimated_revenue per product)']} />
        </div>
      </section>

      {/* ─── Section T: Pricing Over Time ─────── */}
      <section>
        <div className="card">
          <div className="section-head">
            <h2>
              T · Pricing Over Time
              <SectionInfo
                title="Pricing Over Time"
                description={`Weekly evolution of pricing. Avg Current Price is the realized price after discounts (sales_facts_daily.avg_price, weekly mean). Avg Full Price reverses discount % to estimate list price (avg_price ÷ (1 – discount/100)). Avg Discount % is the mean discount across the week. Use to spot rising discount intensity (margin compression) or rising prices (premium repositioning). Scope: ${scopedBrandLabel}.`}
                source="sales_facts_daily · weekly aggregation (Mon–Sun)"
              />
            </h2>
            <span className="sub">{tPricingTimeline.weeks.length} weeks · {scopedBrandLabel}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {(['discount', 'current', 'full'] as const).map(v => (
              <button
                key={v}
                onClick={() => setTView(v)}
                className={tView === v ? 'btn btn-yellow' : 'btn'}
                style={{ fontSize: 11, padding: '4px 10px', textTransform: 'capitalize' }}
              >
                Avg {v} {v === 'discount' ? '%' : 'Price'}
              </button>
            ))}
          </div>
          {tPricingTimeline.weeks.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              No sales_facts_daily data yet for this scope. Phase 3 pipeline populates this weekly on Mondays.
            </div>
          ) : (
            <LineChart
              series={[{
                id: `pricing-${tView}`,
                label: tView === 'discount' ? 'Avg Discount %' : tView === 'full' ? 'Avg Full Price' : 'Avg Current Price',
                color: tView === 'discount' ? '#3b82f6' : tView === 'full' ? '#94a3b8' : '#22c55e',
                data: tView === 'discount' ? tPricingTimeline.avgDiscountPct : tView === 'full' ? tPricingTimeline.avgFullPrice : tPricingTimeline.avgPrice,
              }]}
              xLabels={tPricingTimeline.weeks}
              w={760}
              h={260}
              yLabel={tView === 'discount' ? 'Discount %' : 'USD'}
            />
          )}
          <Caveat tables={['sales_facts_daily (avg_price, discount_percent — weekly aggregated)']} />
        </div>
      </section>
    </>
  )
}

