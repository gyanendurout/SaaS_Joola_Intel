'use client'
import { SectionInfo } from '@/components/v2/PageShell'
import type { PriceStat } from '@/lib/v2/productIntel'

interface Props {
  productPrice: number | null
  brandStat: PriceStat | null
  brandColor: string
  norm: (v: number) => number
}

export function ProductPriceContext({ productPrice, brandStat, brandColor, norm }: Props) {
  if (!brandStat || !productPrice) return null

  const min = norm(brandStat.min)
  const max = norm(brandStat.max)
  const avg = norm(brandStat.avg)
  const range = max - min || 1
  const productPct = Math.min(99, Math.max(1, ((productPrice - min) / range) * 100))
  const avgPct = Math.min(99, Math.max(1, ((avg - min) / range) * 100))
  const vsAvg = productPrice - avg
  const pctile = Math.round(((productPrice - min) / range) * 100)

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>
            Price context
            <SectionInfo
              title="Price Context"
              description="Where this product sits within the brand's full price range. The bar shows the spread from cheapest to most expensive product in the catalogue — the product marker shows exactly where this product falls. Above average means it's positioned in the premium tier."
              source="products_catalog · brand price statistics"
            />
          </h2>
          <div className="sub">How this product is positioned within the brand's catalogue</div>
        </div>
      </div>
      <div className="card card-pad">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'This product', value: `$${productPrice.toFixed(0)}`, color: brandColor },
            { label: 'Brand avg',    value: `$${avg.toFixed(0)}`,          color: '#F5E625', tip: 'Average price across all brand catalogue products' },
            { label: 'vs avg',       value: `${vsAvg >= 0 ? '+' : ''}$${vsAvg.toFixed(0)}`, color: vsAvg >= 0 ? '#ef4444' : '#22c55e', tip: 'How this product\'s price compares to the brand average. Positive = more expensive than average.' },
            { label: 'Percentile',   value: `${pctile}th`,                 color: '#a78bfa', tip: `This product is more expensive than ${pctile}% of products in the brand's catalogue.` },
          ].map(m => (
            <div key={m.label} title={m.tip} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', cursor: m.tip ? 'help' : 'default' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>{m.label}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: m.color, fontFamily: 'JetBrains Mono' }}>{m.value}</div>
            </div>
          ))}
        </div>

        {/* Price range bar */}
        <div style={{ fontSize: 10, color: 'var(--fg-4)', marginBottom: 6 }}>BRAND PRICE RANGE: ${min.toFixed(0)} → ${max.toFixed(0)}</div>
        <div style={{ height: 14, background: 'var(--line)', borderRadius: 99, position: 'relative', marginBottom: 6 }}>
          {/* Brand range fill */}
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg, ${brandColor}33, ${brandColor}66)`, borderRadius: 99 }} />
          {/* Avg marker */}
          <div title={`Brand avg $${avg.toFixed(0)}`} style={{ position: 'absolute', left: `${avgPct}%`, top: -2, width: 2, height: 18, background: 'rgba(245,230,37,0.7)', borderRadius: 1 }} />
          {/* Product marker */}
          <div title={`This product $${productPrice.toFixed(0)}`} style={{ position: 'absolute', left: `${productPct}%`, top: -4, transform: 'translateX(-50%)', width: 10, height: 22, background: brandColor, borderRadius: 3, border: '2px solid #fff', boxShadow: `0 0 8px ${brandColor}88` }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--fg-4)' }}>
          <span>${min.toFixed(0)} (cheapest)</span>
          <span style={{ color: 'rgba(245,230,37,0.7)' }}>▲ avg ${avg.toFixed(0)}</span>
          <span>${max.toFixed(0)} (priciest)</span>
        </div>
      </div>
    </section>
  )
}
