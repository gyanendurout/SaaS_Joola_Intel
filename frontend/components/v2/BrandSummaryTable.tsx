'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { pgColor, pgName } from '@/components/v2/PageShell'
import { fmt } from '@/components/v2/charts'
import type { V2Brand } from '@/lib/v2/data'
import type { CatalogStat, AttentionDailyRow, CuratedProduct, RawCatalogProduct } from '@/lib/v2/productIntel'

interface Props {
  catalogStats: CatalogStat[]
  daily: AttentionDailyRow[]
  brands: V2Brand[]
  curatedProducts: CuratedProduct[]
  catalogProducts: RawCatalogProduct[]
  toTs: number
}

export function BrandSummaryTable({ catalogStats, daily, brands, curatedProducts, catalogProducts, toTs }: Props) {
  const router = useRouter()
  const [hovBrand, setHovBrand] = useState<string | null>(null)

  const rows = useMemo(() => {
    if (!catalogStats.length || !brands.length) return []
    const mid = toTs - 30 * 24 * 60 * 60 * 1000
    const start = toTs - 60 * 24 * 60 * 60 * 1000

    return catalogStats.map((stat) => {
      const bId = brands.find(b => b.id === stat.brand)?.brand_id ?? ''
      const bRows = bId ? daily.filter(d => d.brand_id === bId) : []
      const total = bRows.reduce((s, d) => s + (d.mention_count ?? 0), 0)
      const last30 = bRows.filter(d => new Date(d.date).getTime() >= mid).reduce((s, d) => s + (d.mention_count ?? 0), 0)
      const prev30 = bRows.filter(d => { const t = new Date(d.date).getTime(); return t >= start && t < mid }).reduce((s, d) => s + (d.mention_count ?? 0), 0)
      const trend = (last30 === 0 && prev30 === 0) ? 'unknown'
        : prev30 === 0 ? 'up'
        : last30 / prev30 >= 1.2 ? 'up'
        : last30 / prev30 <= 0.8 ? 'down' : 'flat'
      // Use weighted_score (attention_score) as best sales proxy — incorporates estimated units + mentions
      const pMap: Record<string, number> = {}
      bRows.forEach(d => {
        if (d.product_id) {
          pMap[d.product_id] = (pMap[d.product_id] ?? 0) + (d.weighted_score > 0 ? d.weighted_score : d.mention_count ?? 0)
        }
      })
      const topPid = Object.entries(pMap).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
      // daily product_id = canonical_product_id = CuratedProduct.id
      const topProduct = topPid
        ? (curatedProducts.find(c => c.id === topPid)?.display_name ?? '—')
        : '—'
      const rawAvg = stat.avg ?? 0
      const avgPrice = rawAvg > 1000 ? rawAvg / 1000 : rawAvg
      return { brand: stat.brand, productCount: stat.count, totalMentions: total, topProduct, trend, avgPrice, last30, prev30 }
    }).sort((a, b) => b.totalMentions - a.totalMentions)
  }, [catalogStats, daily, brands, curatedProducts, catalogProducts, toTs])

  if (!rows.length) return null

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>Brand product overview</h2>
          <div className="sub">Click any row to view full brand product details</div>
        </div>
      </div>
      <div className="card" style={{ overflow: 'auto' }}>
        <table className="data" style={{ width: '100%', minWidth: 820 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Brand</th>
              <th style={{ textAlign: 'right' }}>Number of Products</th>
              <th style={{ textAlign: 'right' }}>Avg Price</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isJoola = r.brand === 'joola'
              const color = pgColor(r.brand)
              const label = pgName(r.brand, brands)
              const isHov = hovBrand === r.brand
              const trendColor = r.trend === 'up' ? '#22c55e' : r.trend === 'down' ? '#ef4444' : '#94a3b8'
              const trendIcon = r.trend === 'up' ? '▲' : r.trend === 'down' ? '▼' : r.trend === 'flat' ? '▬' : '—'
              return (
                <tr key={r.brand}
                  style={{ ...(isJoola ? { borderLeft: '3px solid #22c55e', background: 'rgba(34,197,94,0.04)' } : {}), cursor: 'pointer', opacity: hovBrand && !isHov ? 0.6 : 1, transition: 'opacity 150ms' }}
                  onClick={() => router.push(`/v2/product-intel/brand/${encodeURIComponent(r.brand)}`)}
                  onMouseEnter={() => setHovBrand(r.brand)}
                  onMouseLeave={() => setHovBrand(null)}>
                  <td style={{ textAlign: 'left' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
                      <span style={{ fontWeight: 700, color: isJoola ? '#22c55e' : 'inherit' }}>{label}</span>
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.productCount}</td>
                  <td style={{ textAlign: 'right', color: r.avgPrice > 0 ? '#60a5fa' : '#3a4150', fontVariantNumeric: 'tabular-nums' }}>
                    {r.avgPrice > 0 ? `$${r.avgPrice.toFixed(0)}` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
