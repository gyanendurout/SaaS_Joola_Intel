'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { PageHead, LoadingPage, pgColor, pgName } from '@/components/v2/PageShell'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import { fetchProductIntel, type RawCatalogProduct } from '@/lib/v2/productIntel'

function StatCard({ label, value, color, tip }: { label: string; value: string; color?: string; tip?: string }) {
  return (
    <div title={tip} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '14px 16px', cursor: tip ? 'help' : 'default' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: value === '—' ? '#3a4150' : (color || '#fff'), fontFamily: 'JetBrains Mono', lineHeight: 1 }}>{value}</div>
    </div>
  )
}

export default function BrandProductPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const brandSlug = decodeURIComponent(slug)

  const [brands, setBrands] = useState<V2Brand[]>([])
  const [products, setProducts] = useState<RawCatalogProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<'price_usd' | 'name'>('price_usd')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!brandSlug) return
    document.title = `${brandSlug} Products — JOOLA INTEL`
    ;(async () => {
      try {
        const b = await fetchBrands()
        setBrands(b)
        const to = new Date()
        const from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000)
        const d = await fetchProductIntel(b)
        const bId = b.find(x => x.id === brandSlug)?.brand_id || ''
        setProducts(d.catalogProducts.filter(p => p.brand_id === bId))
      } finally { setLoading(false) }
    })()
  }, [brandSlug])

  if (loading) return <LoadingPage />

  const brandColor = pgColor(brandSlug)
  const brandName = pgName(brandSlug, brands)
  const isJoola = brandSlug === 'joola'

  // Brand ecommerce site URLs (from product catalog scraper config)
  const BRAND_STORE_URLS: Record<string, string> = {
    joola:     'https://joola.com/collections/pickleball-paddles',
    selkirk:   'https://www.selkirk.com/collections/paddles',
    paddletek: 'https://www.paddletek.com/collections/paddles',
    crbn:      'https://www.crbnpickleball.com/collections/paddles',
    'six-zero':'https://www.sixzeropickleball.com/collections/paddles',
    engage:    'https://engagepickleball.com/collections/paddles',
    onix:      'https://www.onixpickleball.com/collections/paddles',
    franklin:  'https://www.franklinsports.com/pickleball/paddles',
    head:      'https://www.head.com/en_US/pickleball/paddles/',
    wilson:    'https://www.wilson.com/en-us/collection/pickleball/paddles',
    gamma:     'https://gammasports.com/pickleball/paddles/',
  }
  const storeUrl = BRAND_STORE_URLS[brandSlug] || null

  // Normalize prices stored as milli-dollars (1000x too large)
  const normalizePrice = (v: number) => v > 1000 ? v / 1000 : v

  const filtered = products
    .filter(p => !search || (p.name || '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortKey === 'price_usd') {
        const av = a.price_usd != null ? normalizePrice(Number(a.price_usd)) : 0
        const bv = b.price_usd != null ? normalizePrice(Number(b.price_usd)) : 0
        return sortDir === 'desc' ? bv - av : av - bv
      }
      return sortDir === 'desc'
        ? (b.name || '').localeCompare(a.name || '')
        : (a.name || '').localeCompare(b.name || '')
    })

  const prices = products.map(p => p.price_usd != null ? normalizePrice(Number(p.price_usd)) : 0).filter(n => n > 0)
  const avgPrice = prices.length ? prices.reduce((s, n) => s + n, 0) / prices.length : 0
  const minPrice = prices.length ? Math.min(...prices) : 0
  const maxPrice = prices.length ? Math.max(...prices) : 0
  const inStock = products.filter(p => p.in_stock !== false).length
  const categories = Array.from(new Set(products.map(p => p.category).filter(Boolean)))

  return (
    <>
      <PageHead
        eyebrow="Product Intel"
        title={brandName}
        sub={`${products.length} products in catalogue`}
        actions={
          <button onClick={() => router.back()} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--fg-3)', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>← Back</button>
        }
      />

      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
        <StatCard label="Total Products"  value={String(products.length)}                  color="#60a5fa" tip="Number of products in the catalogue for this brand" />
        <StatCard label="In Stock"        value={String(inStock)}                           color="#22c55e" tip="Products currently marked as in stock" />
        <StatCard label="Avg Price"       value={avgPrice > 0 ? `$${avgPrice.toFixed(0)}` : '—'} color="#F5E625" tip="Average retail price across all products" />
        <StatCard label="Price Range"     value={prices.length ? `$${minPrice}–$${maxPrice}` : '—'} color="#a78bfa" tip="Lowest to highest price in the catalogue" />
        <StatCard label="Categories"      value={String(categories.length)}                color="#fb923c" tip="Number of distinct product categories" />
      </div>

      {/* Store URL */}
      {storeUrl && (
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>Ecommerce Store:</span>
          <a href={storeUrl} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 12, color: '#60a5fa', textDecoration: 'none', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {storeUrl.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}
            <span style={{ fontSize: 10 }}>↗</span>
          </a>
        </div>
      )}

      {/* Category pills */}
      {categories.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {categories.map(c => (
            <span key={c} style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99, background: brandColor + '18', color: brandColor, border: `1px solid ${brandColor}33` }}>{c}</span>
          ))}
        </div>
      )}

      {/* Product table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="text" placeholder="Search products..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '6px 12px', color: '#fff', fontSize: 12, outline: 'none' }}
          />
          <span style={{ fontSize: 12, color: '#6b7280' }}>{filtered.length} of {products.length}</span>
        </div>
        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          <table className="data" style={{ width: '100%', minWidth: 700 }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>
              <tr>
                <th style={{ textAlign: 'left' }}>Product</th>
                <th style={{ textAlign: 'left' }}>Category</th>
                <th style={{ textAlign: 'center' }}>In Stock</th>
                <th style={{ textAlign: 'right', cursor: 'pointer', color: sortKey === 'price_usd' ? '#F5E625' : undefined }}
                  onClick={() => { setSortKey('price_usd'); setSortDir(prev => prev === 'desc' ? 'asc' : 'desc') }}>
                  Price {sortKey === 'price_usd' ? (sortDir === 'desc' ? '▼' : '▲') : '↕'}
                </th>
                <th style={{ textAlign: 'right' }}>Price Tier</th>
                <th style={{ textAlign: 'center' }}>Product Page</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: '#6b7280' }}>No products match the search.</td></tr>
              )}
              {filtered.map(p => {
                const price = p.price_usd != null ? normalizePrice(Number(p.price_usd)) : null
                const tier = price == null ? '—' : price >= 200 ? 'Premium' : price >= 100 ? 'Mid' : 'Value'
                const tierColor = tier === 'Premium' ? '#F5E625' : tier === 'Mid' ? '#60a5fa' : '#22c55e'
                return (
                  <tr key={p.id} style={isJoola ? { borderLeft: `3px solid ${brandColor}`, background: `${brandColor}06` } : {}}>
                    <td style={{ fontWeight: 700, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.name || undefined}>
                      {p.name || '—'}
                    </td>
                    
                    <td style={{ fontSize: 12 }}>{p.category || '—'}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={'pill ' + (p.in_stock !== false ? 'pill-green' : 'pill-ghost')} style={{ fontSize: 9 }}>
                        {p.in_stock !== false ? 'IN STOCK' : 'OUT'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: price ? '#fff' : '#3a4150', fontVariantNumeric: 'tabular-nums' }}>
                      {price ? `$${price.toFixed(0)}` : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: tierColor }}>{tier}</span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {p.url
                        ? <a href={p.url} target="_blank" rel="noopener noreferrer" className="ext-link" style={{ fontSize: 11 }}>View ↗</a>
                        : <span style={{ color: '#3a4150', fontSize: 11 }}>—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
