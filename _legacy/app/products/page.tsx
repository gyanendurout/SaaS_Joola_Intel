'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/shared/supabase'
import { Card } from '@/components/v1/Card'
import { KPICard } from '@/components/v1/KPICard'
import { CSSBar } from '@/components/v1/CSSBar'
import { BrandBadge } from '@/components/v1/BrandBadge'
import { DataTable } from '@/components/v1/DataTable'
import { fmt, fmtPrice, categoryColor, ratingColor } from '@/lib/v1/utils'

type Product = {
  id: string
  brand_id: string
  name: string
  url: string | null
  category: string | null
  price_usd: number | null
  sale_price_usd?: number | null
  discount_pct?: number | null
  currency: string | null
  country_code: string | null
  in_stock: boolean | null
  stock_count?: number | null
  avg_rating: number | null
  review_count: number | null
  is_new?: boolean
  first_seen_at?: string | null
}

function StockPill({ inStock }: { inStock: boolean | null }) {
  if (inStock === null) return <span className="text-[11px] italic" style={{ color: '#94a3b8' }}>—</span>
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
      style={{
        background: inStock ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
        color: inStock ? '#22c55e' : '#ef4444',
        border: `1px solid ${inStock ? 'rgba(34,197,94,0.22)' : 'rgba(239,68,68,0.22)'}`,
      }}
    >
      <span
        className="w-1 h-1 rounded-full"
        style={{ background: inStock ? '#22c55e' : '#ef4444' }}
      />
      {inStock ? 'In Stock' : 'Out'}
    </span>
  )
}

function PriceTag({ p }: { p: Product }) {
  const sale = p.sale_price_usd && p.price_usd && p.sale_price_usd < p.price_usd
  return (
    <div className="flex items-baseline gap-1.5">
      {sale ? (
        <>
          <span className="text-[16px] font-black stat-number text-[#22c55e]">
            {fmtPrice(p.sale_price_usd!)}
          </span>
          <span className="text-[11px] line-through" style={{ color: '#94a3b8' }}>
            {fmtPrice(p.price_usd!)}
          </span>
          {p.discount_pct && (
            <span className="text-[10px] font-bold text-[#ef4444]">−{p.discount_pct.toFixed(0)}%</span>
          )}
        </>
      ) : p.price_usd ? (
        <span className="text-[16px] font-black stat-number" style={{ color: '#f1f5f9' }}>
          {fmtPrice(p.price_usd)}
        </span>
      ) : (
        <span className="text-[11px] italic" style={{ color: '#94a3b8' }}>No price</span>
      )}
    </div>
  )
}

function ProductCard({ p, brandName, isJoola }: { p: Product; brandName: string; isJoola?: boolean }) {
  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-2.5 transition-all duration-200 hover:scale-[1.01]"
      style={{
        background: 'rgba(10,15,25,0.8)',
        backdropFilter: 'blur(16px)',
        border: `1px solid ${isJoola ? 'rgba(34,197,94,0.20)' : 'rgba(255,255,255,0.07)'}`,
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <BrandBadge name={brandName} isJoola={isJoola} />
        <div className="flex items-center gap-1.5">
          {p.category && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${categoryColor(p.category)}`}>
              {p.category}
            </span>
          )}
          <StockPill inStock={p.in_stock} />
        </div>
      </div>

      <p className="text-[13px] font-bold leading-snug line-clamp-2" style={{ color: '#f1f5f9' }}>
        {p.name}
      </p>

      <div className="flex items-center justify-between gap-2 mt-auto">
        <PriceTag p={p} />
        {p.url && (
          <a
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] font-medium text-[#818cf8] hover:underline"
          >
            View →
          </a>
        )}
      </div>
    </div>
  )
}

export default function ProductsPage() {
  const [brands, setBrands] = useState<any[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  const [searchQ, setSearchQ] = useState('')
  const [filterBrand, setFilterBrand] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterStock, setFilterStock] = useState<'all' | 'in' | 'out'>('all')
  const [priceRange, setPriceRange] = useState<'all' | '0-100' | '100-200' | '200-300' | '300+'>('all')
  const [view, setView] = useState<'grid' | 'table'>('grid')
  const [sortKey, setSortKey] = useState<'price_desc' | 'price_asc' | 'brand'>('price_desc')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      supabase.from('brands').select('*'),
      supabase
        .from('products')
        .select('*')
        .order('price_usd', { ascending: false, nullsFirst: false })
        .limit(1000),
    ]).then(([{ data: b }, { data: p }]) => {
      setBrands(b || [])
      setProducts((p as Product[]) || [])
      setLoading(false)
    })
  }, [])

  const brandMap = Object.fromEntries(brands.map((b) => [b.id, b]))
  const brandsWithProducts = useMemo(
    () => brands.filter((b) => products.some((p) => p.brand_id === b.id)),
    [brands, products],
  )

  const stats = useMemo(() => {
    const total = products.length
    const priced = products.filter((p) => p.price_usd != null)
    const inStock = products.filter((p) => p.in_stock).length
    const avgPrice = priced.length ? priced.reduce((s, p) => s + (p.price_usd || 0), 0) / priced.length : 0
    const minPrice = priced.length ? Math.min(...priced.map((p) => p.price_usd || 0)) : 0
    const maxPrice = priced.length ? Math.max(...priced.map((p) => p.price_usd || 0)) : 0

    const byBrand: Record<string, { count: number; prices: number[]; inStock: number }> = {}
    products.forEach((p) => {
      if (!byBrand[p.brand_id]) byBrand[p.brand_id] = { count: 0, prices: [], inStock: 0 }
      byBrand[p.brand_id].count++
      if (p.price_usd != null) byBrand[p.brand_id].prices.push(p.price_usd)
      if (p.in_stock) byBrand[p.brand_id].inStock++
    })

    const byCategory: Record<string, number> = {}
    products.forEach((p) => {
      const c = p.category || 'Uncategorised'
      byCategory[c] = (byCategory[c] || 0) + 1
    })

    return { total, priced: priced.length, inStock, avgPrice, minPrice, maxPrice, byBrand, byCategory }
  }, [products])

  const categoryOptions = useMemo(
    () => Array.from(new Set(products.map((p) => p.category).filter(Boolean) as string[])).sort(),
    [products],
  )

  const filtered = useMemo(() => {
    let out = products
    if (filterBrand !== 'all') out = out.filter((p) => p.brand_id === filterBrand)
    if (filterCategory !== 'all') out = out.filter((p) => p.category === filterCategory)
    if (filterStock === 'in') out = out.filter((p) => p.in_stock)
    if (filterStock === 'out') out = out.filter((p) => p.in_stock === false)
    if (priceRange !== 'all') {
      out = out.filter((p) => {
        if (p.price_usd == null) return false
        if (priceRange === '0-100') return p.price_usd < 100
        if (priceRange === '100-200') return p.price_usd >= 100 && p.price_usd < 200
        if (priceRange === '200-300') return p.price_usd >= 200 && p.price_usd < 300
        if (priceRange === '300+') return p.price_usd >= 300
        return true
      })
    }
    if (searchQ) {
      const q = searchQ.toLowerCase()
      out = out.filter((p) => p.name?.toLowerCase().includes(q))
    }
    if (sortKey === 'price_desc') {
      out = [...out].sort((a, b) => (b.price_usd || 0) - (a.price_usd || 0))
    } else if (sortKey === 'price_asc') {
      out = [...out].sort((a, b) => (a.price_usd || 99999) - (b.price_usd || 99999))
    } else {
      out = [...out].sort((a, b) =>
        (brandMap[a.brand_id]?.name || '').localeCompare(brandMap[b.brand_id]?.name || ''),
      )
    }
    return out
  }, [products, filterBrand, filterCategory, filterStock, priceRange, searchQ, sortKey, brandMap])

  const brandSummaryRows = useMemo(() => {
    return Object.entries(stats.byBrand).map(([bid, s]) => {
      const avg = s.prices.length ? s.prices.reduce((a, b) => a + b, 0) / s.prices.length : 0
      const min = s.prices.length ? Math.min(...s.prices) : 0
      const max = s.prices.length ? Math.max(...s.prices) : 0
      return {
        brand: brandMap[bid],
        bid,
        count: s.count,
        priced: s.prices.length,
        avgPrice: avg,
        priceRange: s.prices.length ? { min, max } : null,
        inStock: s.inStock,
        inStockPct: s.count ? (s.inStock / s.count) * 100 : 0,
      }
    }).sort((a, b) => b.count - a.count)
  }, [stats, brandMap])

  const avgPriceBarItems = useMemo(
    () =>
      brandSummaryRows
        .filter((r) => r.avgPrice > 0)
        .map((r) => ({
          label: r.brand?.name || '?',
          value: r.avgPrice,
          isJoola: r.brand?.is_joola,
          formatted: fmtPrice(r.avgPrice),
        }))
        .sort((a, b) => b.value - a.value),
    [brandSummaryRows],
  )

  const productCountBarItems = useMemo(
    () =>
      brandSummaryRows.map((r) => ({
        label: r.brand?.name || '?',
        value: r.count,
        isJoola: r.brand?.is_joola,
      })),
    [brandSummaryRows],
  )

  return (
    <div className="max-w-[1400px] animate-fade-up">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full"
            style={{ background: 'rgba(129,140,248,0.10)', color: '#818cf8', border: '1px solid rgba(129,140,248,0.22)' }}
          >
            Product Intelligence
          </span>
        </div>
        <h1 className="text-[32px] font-black tracking-tight leading-tight mb-1">
          <span className="text-gradient-white">Catalog & </span>
          <span className="text-gradient-green">Pricing</span>
        </h1>
        <p className="text-[14px]" style={{ color: '#cbd5e1' }}>
          {fmt(stats.total)} paddles across {brandsWithProducts.length} brands · live competitor catalog
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <div className="w-8 h-8 rounded-full border-2 border-[#818cf8] border-t-transparent animate-spin mx-auto mb-4" />
            <p className="text-[13px]" style={{ color: '#cbd5e1' }}>Loading catalog…</p>
          </div>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <KPICard label="Total Products" value={fmt(stats.total)} accent />
            <KPICard label="With Pricing" value={fmt(stats.priced)} color="indigo" />
            <KPICard label="In Stock" value={fmt(stats.inStock)} color="green" />
            <KPICard label="Avg Price" value={stats.avgPrice > 0 ? fmtPrice(stats.avgPrice) : '—'} color="amber" />
            <KPICard
              label="Price Range"
              value={stats.minPrice > 0 ? `${fmtPrice(stats.minPrice)} – ${fmtPrice(stats.maxPrice)}` : '—'}
            />
          </div>

          {/* Brand pricing comparison */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <Card title="Average Price by Brand">
              {avgPriceBarItems.length === 0 ? (
                <p className="text-[12px] py-6 text-center" style={{ color: '#cbd5e1' }}>No price data.</p>
              ) : (
                <CSSBar items={avgPriceBarItems} defaultColor="#f59e0b" />
              )}
            </Card>
            <Card title="Catalog Size by Brand">
              {productCountBarItems.length === 0 ? (
                <p className="text-[12px] py-6 text-center" style={{ color: '#cbd5e1' }}>No products.</p>
              ) : (
                <CSSBar items={productCountBarItems} defaultColor="#818cf8" />
              )}
            </Card>
          </div>

          {/* Brand summary table */}
          <Card title="Brand Catalog Summary" className="mb-6">
            <DataTable
              columns={[
                {
                  key: 'brand',
                  label: 'Brand',
                  render: (b) => <BrandBadge name={b?.name || '?'} isJoola={b?.is_joola} />,
                  sortValue: (r) => r.brand?.name || '',
                },
                { key: 'count', label: 'Products', render: (v) => <span className="stat-number font-semibold">{v}</span> },
                {
                  key: 'avgPrice',
                  label: 'Avg Price',
                  render: (v) => <span className="stat-number font-semibold" style={{ color: '#f59e0b' }}>{v > 0 ? fmtPrice(v) : '—'}</span>,
                },
                {
                  key: 'priceRange',
                  label: 'Range',
                  render: (v) =>
                    v ? (
                      <span className="stat-number text-[12px]" style={{ color: '#cbd5e1' }}>
                        {fmtPrice(v.min)} – {fmtPrice(v.max)}
                      </span>
                    ) : (
                      <span className="text-[11px] italic" style={{ color: '#94a3b8' }}>—</span>
                    ),
                },
                {
                  key: 'inStockPct',
                  label: 'In Stock %',
                  render: (v, r) => (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-white/[0.05] rounded-full overflow-hidden w-24">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${v}%`,
                            background: v > 80 ? '#22c55e' : v > 50 ? '#f59e0b' : '#ef4444',
                          }}
                        />
                      </div>
                      <span className="text-[11px] font-semibold tabular-nums text-white">{v.toFixed(0)}%</span>
                      <span className="text-[10px]" style={{ color: '#94a3b8' }}>({r.inStock}/{r.count})</span>
                    </div>
                  ),
                },
              ]}
              rows={brandSummaryRows}
              isJoolaRow={(r) => r.brand?.is_joola}
            />
          </Card>

          {/* Filter bar */}
          <div
            className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-2xl"
            style={{ background: 'rgba(10,15,25,0.6)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <input
              type="text"
              placeholder="Search product name…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="bg-[#0f0f13] border border-[#2a2a38] text-white text-xs rounded-lg px-3 py-1.5 w-56 focus:outline-none focus:border-[#22c55e]/50 placeholder-[#94a3b8]"
            />
            <select
              value={filterBrand}
              onChange={(e) => setFilterBrand(e.target.value)}
              className="bg-[#0f0f13] border border-[#2a2a38] text-[#e2e8f0] text-xs rounded-lg px-3 py-1.5 focus:outline-none"
            >
              <option value="all">All Brands ({brandsWithProducts.length})</option>
              {brandsWithProducts.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({stats.byBrand[b.id]?.count || 0})
                </option>
              ))}
            </select>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="bg-[#0f0f13] border border-[#2a2a38] text-[#e2e8f0] text-xs rounded-lg px-3 py-1.5 focus:outline-none"
            >
              <option value="all">All Categories</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c} ({stats.byCategory[c] || 0})
                </option>
              ))}
            </select>
            <select
              value={priceRange}
              onChange={(e) => setPriceRange(e.target.value as any)}
              className="bg-[#0f0f13] border border-[#2a2a38] text-[#e2e8f0] text-xs rounded-lg px-3 py-1.5 focus:outline-none"
            >
              <option value="all">Any Price</option>
              <option value="0-100">&lt; $100</option>
              <option value="100-200">$100–199</option>
              <option value="200-300">$200–299</option>
              <option value="300+">$300+</option>
            </select>
            <select
              value={filterStock}
              onChange={(e) => setFilterStock(e.target.value as any)}
              className="bg-[#0f0f13] border border-[#2a2a38] text-[#e2e8f0] text-xs rounded-lg px-3 py-1.5 focus:outline-none"
            >
              <option value="all">Any Stock</option>
              <option value="in">In Stock</option>
              <option value="out">Out of Stock</option>
            </select>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as any)}
              className="bg-[#0f0f13] border border-[#2a2a38] text-[#e2e8f0] text-xs rounded-lg px-3 py-1.5 focus:outline-none"
            >
              <option value="price_desc">Highest Price</option>
              <option value="price_asc">Lowest Price</option>
              <option value="brand">By Brand</option>
            </select>

            {/* View toggle */}
            <div className="ml-auto inline-flex items-center rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
              <button
                onClick={() => setView('grid')}
                className="px-3 py-1.5 text-[11px] font-semibold transition-colors"
                style={{
                  background: view === 'grid' ? 'rgba(34,197,94,0.10)' : 'transparent',
                  color: view === 'grid' ? '#22c55e' : '#94a3b8',
                }}
              >
                Grid
              </button>
              <button
                onClick={() => setView('table')}
                className="px-3 py-1.5 text-[11px] font-semibold transition-colors"
                style={{
                  background: view === 'table' ? 'rgba(34,197,94,0.10)' : 'transparent',
                  color: view === 'table' ? '#22c55e' : '#94a3b8',
                }}
              >
                Table
              </button>
            </div>
            <span className="text-[11px]" style={{ color: '#94a3b8' }}>
              <span className="font-bold text-white">{filtered.length}</span> of {stats.total}
            </span>
            {(searchQ || filterBrand !== 'all' || filterCategory !== 'all' || filterStock !== 'all' || priceRange !== 'all') && (
              <button
                onClick={() => {
                  setSearchQ('')
                  setFilterBrand('all')
                  setFilterCategory('all')
                  setFilterStock('all')
                  setPriceRange('all')
                }}
                className="text-xs px-3 py-1.5 rounded-lg bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/20 transition-colors cursor-pointer"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Catalog */}
          {filtered.length === 0 ? (
            <Card>
              <p className="text-[12px] py-10 text-center" style={{ color: '#cbd5e1' }}>
                No products match the current filters.
              </p>
            </Card>
          ) : view === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {filtered.slice(0, 200).map((p) => (
                <ProductCard
                  key={p.id}
                  p={p}
                  brandName={brandMap[p.brand_id]?.name || '?'}
                  isJoola={brandMap[p.brand_id]?.is_joola}
                />
              ))}
            </div>
          ) : (
            <Card>
              <DataTable
                columns={[
                  {
                    key: 'brand_id',
                    label: 'Brand',
                    render: (id) => <BrandBadge name={brandMap[id]?.name || '?'} isJoola={brandMap[id]?.is_joola} />,
                    sortValue: (r) => brandMap[r.brand_id]?.name || '',
                  },
                  { key: 'name', label: 'Product', render: (v) => <span className="font-medium text-white">{v}</span> },
                  {
                    key: 'category',
                    label: 'Category',
                    render: (v) => v ? (
                      <span className={`text-[11px] px-1.5 py-0.5 rounded font-semibold ${categoryColor(v)}`}>{v}</span>
                    ) : <span className="text-[11px] italic" style={{ color: '#94a3b8' }}>—</span>,
                  },
                  {
                    key: 'price_usd',
                    label: 'Price',
                    render: (_, r) => <PriceTag p={r} />,
                  },
                  { key: 'in_stock', label: 'Stock', render: (v) => <StockPill inStock={v} /> },
                  {
                    key: 'avg_rating',
                    label: 'Rating',
                    render: (v) => v ? (
                      <span className={`stat-number font-bold ${ratingColor(v)}`}>{v.toFixed(1)}★</span>
                    ) : (
                      <span className="text-[11px] italic" style={{ color: '#94a3b8' }}>—</span>
                    ),
                  },
                  {
                    key: 'url',
                    label: 'Link',
                    render: (v) =>
                      v ? (
                        <a href={v} target="_blank" rel="noreferrer" className="text-[11px] text-[#818cf8] hover:underline">
                          View
                        </a>
                      ) : '—',
                  },
                ]}
                rows={filtered}
                isJoolaRow={(r) => brandMap[r.brand_id]?.is_joola}
              />
            </Card>
          )}
          {view === 'grid' && filtered.length > 200 && (
            <p className="text-[11px] mt-4 text-center" style={{ color: '#94a3b8' }}>
              Showing first 200 products. Switch to Table view to scroll all {filtered.length}.
            </p>
          )}
        </>
      )}
    </div>
  )
}
