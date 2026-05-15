'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/shared/supabase'
import { Card } from '@/components/v1/Card'
import { KPICard } from '@/components/v1/KPICard'
import { CSSBar } from '@/components/v1/CSSBar'
import { BrandBadge } from '@/components/v1/BrandBadge'
import { DataTable } from '@/components/v1/DataTable'
import { fmt, fmtDate } from '@/lib/v1/utils'

type Promo = {
  id: string
  brand_id: string
  banner_text: string
  promo_type: 'sitewide' | 'category' | 'product' | 'flash' | 'seasonal' | 'general' | string | null
  discount_pct: number | null
  source_url: string | null
  detected_at: string | null
}

function PromoTypeBadge({ t }: { t: string | null }) {
  const map: Record<string, { bg: string; fg: string; border: string }> = {
    sitewide: { bg: 'rgba(239,68,68,0.10)', fg: '#ef4444', border: 'rgba(239,68,68,0.25)' },
    flash:    { bg: 'rgba(245,158,11,0.10)', fg: '#f59e0b', border: 'rgba(245,158,11,0.25)' },
    seasonal: { bg: 'rgba(129,140,248,0.10)', fg: '#818cf8', border: 'rgba(129,140,248,0.25)' },
    category: { bg: 'rgba(34,197,94,0.10)', fg: '#22c55e', border: 'rgba(34,197,94,0.25)' },
    general:  { bg: 'rgba(255,255,255,0.04)', fg: '#cbd5e1', border: 'rgba(255,255,255,0.10)' },
  }
  const tt = (t || 'general') as keyof typeof map
  const s = map[tt] || map.general
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ background: s.bg, color: s.fg, border: `1px solid ${s.border}` }}
    >
      {(t || 'general').toString()}
    </span>
  )
}

function DiscountChip({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-[11px] italic" style={{ color: '#94a3b8' }}>—</span>
  const color = pct >= 30 ? '#ef4444' : pct >= 15 ? '#f59e0b' : '#22c55e'
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[12px] font-black stat-number"
      style={{ color }}
    >
      −{pct.toFixed(0)}%
    </span>
  )
}

function PromoCard({ promo, brandName, isJoola }: { promo: Promo; brandName: string; isJoola?: boolean }) {
  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3 transition-all duration-200 hover:scale-[1.01]"
      style={{
        background: 'rgba(10,15,25,0.8)',
        backdropFilter: 'blur(16px)',
        border: `1px solid ${isJoola ? 'rgba(34,197,94,0.20)' : 'rgba(255,255,255,0.07)'}`,
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <BrandBadge name={brandName} isJoola={isJoola} />
        <div className="flex items-center gap-1.5">
          <PromoTypeBadge t={promo.promo_type} />
          <DiscountChip pct={promo.discount_pct} />
        </div>
      </div>
      <p className="text-[14px] font-bold leading-snug" style={{ color: '#f1f5f9' }}>
        “{promo.banner_text}”
      </p>
      <div className="flex items-center justify-between pt-1 mt-auto">
        <span className="text-[10px]" style={{ color: '#94a3b8' }}>
          {promo.detected_at ? fmtDate(promo.detected_at) : '—'}
        </span>
        {promo.source_url && (
          <a
            href={promo.source_url}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] font-medium text-[#818cf8] hover:underline"
          >
            Source →
          </a>
        )}
      </div>
    </div>
  )
}

export default function PromotionsPage() {
  const [brands, setBrands] = useState<any[]>([])
  const [promos, setPromos] = useState<Promo[]>([])
  const [loading, setLoading] = useState(true)
  const [filterBrand, setFilterBrand] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [searchQ, setSearchQ] = useState('')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      supabase.from('brands').select('*'),
      supabase
        .from('promotions')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(500),
    ]).then(([{ data: b }, { data: p }]) => {
      setBrands(b || [])
      setPromos((p as Promo[]) || [])
      setLoading(false)
    })
  }, [])

  const brandMap = Object.fromEntries(brands.map((b) => [b.id, b]))
  const brandsWithPromos = useMemo(
    () => brands.filter((b) => promos.some((p) => p.brand_id === b.id)),
    [brands, promos],
  )

  const stats = useMemo(() => {
    const total = promos.length
    const discounted = promos.filter((p) => p.discount_pct != null)
    const avgDiscount = discounted.length
      ? discounted.reduce((s, p) => s + (p.discount_pct || 0), 0) / discounted.length
      : 0
    const maxDiscount = discounted.length ? Math.max(...discounted.map((p) => p.discount_pct || 0)) : 0
    const byBrand = promos.reduce<Record<string, number>>((acc, p) => {
      acc[p.brand_id] = (acc[p.brand_id] || 0) + 1
      return acc
    }, {})
    const byType = promos.reduce<Record<string, number>>((acc, p) => {
      const t = p.promo_type || 'general'
      acc[t] = (acc[t] || 0) + 1
      return acc
    }, {})
    return { total, brandsCount: brandsWithPromos.length, avgDiscount, maxDiscount, byBrand, byType }
  }, [promos, brandsWithPromos])

  const filtered = useMemo(() => {
    let out = promos
    if (filterBrand !== 'all') out = out.filter((p) => p.brand_id === filterBrand)
    if (filterType !== 'all') out = out.filter((p) => (p.promo_type || 'general') === filterType)
    if (searchQ) {
      const q = searchQ.toLowerCase()
      out = out.filter((p) => (p.banner_text || '').toLowerCase().includes(q))
    }
    return out
  }, [promos, filterBrand, filterType, searchQ])

  const brandBarItems = useMemo(
    () =>
      brandsWithPromos
        .map((b) => ({ label: b.name, value: stats.byBrand[b.id] || 0, isJoola: b.is_joola }))
        .sort((a, b) => b.value - a.value),
    [brandsWithPromos, stats],
  )

  return (
    <div className="max-w-[1400px] animate-fade-up">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
          >
            Promotion Watch
          </span>
        </div>
        <h1 className="text-[32px] font-black tracking-tight leading-tight mb-1">
          <span className="text-gradient-white">Discounts & </span>
          <span className="text-gradient-green">Promotions</span>
        </h1>
        <p className="text-[14px]" style={{ color: '#cbd5e1' }}>
          Homepage promo banners across {stats.brandsCount} brands · detected from scrape of each brand's homepage
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <div className="w-8 h-8 rounded-full border-2 border-[#ef4444] border-t-transparent animate-spin mx-auto mb-4" />
            <p className="text-[13px]" style={{ color: '#cbd5e1' }}>Loading promotions…</p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <KPICard label="Active Promos" value={fmt(stats.total)} accent />
            <KPICard label="Brands Discounting" value={stats.brandsCount} color="indigo" />
            <KPICard
              label="Avg Discount"
              value={stats.avgDiscount > 0 ? stats.avgDiscount.toFixed(0) + '%' : '—'}
              color="amber"
            />
            <KPICard
              label="Max Discount"
              value={stats.maxDiscount > 0 ? stats.maxDiscount.toFixed(0) + '%' : '—'}
              color="green"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card title="Promo Volume by Brand" className="md:col-span-2">
              {brandBarItems.length === 0 ? (
                <p className="text-[12px] py-6 text-center" style={{ color: '#cbd5e1' }}>No promotions detected.</p>
              ) : (
                <CSSBar items={brandBarItems} defaultColor="#ef4444" />
              )}
            </Card>

            <Card title="Promo Type Mix">
              <div className="space-y-2">
                {Object.entries(stats.byType)
                  .sort((a, b) => b[1] - a[1])
                  .map(([t, n]) => (
                    <div
                      key={t}
                      className="flex items-center justify-between p-2 rounded-lg"
                      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
                    >
                      <PromoTypeBadge t={t} />
                      <span className="text-[12px] font-bold stat-number text-white">{n}</span>
                    </div>
                  ))}
              </div>
            </Card>
          </div>

          {/* Filters */}
          <div
            className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-2xl"
            style={{ background: 'rgba(10,15,25,0.6)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <input
              type="text"
              placeholder="Search banner text…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="bg-[#0f0f13] border border-[#2a2a38] text-white text-xs rounded-lg px-3 py-1.5 w-56 focus:outline-none focus:border-[#22c55e]/50 placeholder-[#94a3b8]"
            />
            <select
              value={filterBrand}
              onChange={(e) => setFilterBrand(e.target.value)}
              className="bg-[#0f0f13] border border-[#2a2a38] text-[#e2e8f0] text-xs rounded-lg px-3 py-1.5 focus:outline-none"
            >
              <option value="all">All Brands ({brandsWithPromos.length})</option>
              {brandsWithPromos.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({stats.byBrand[b.id] || 0})
                </option>
              ))}
            </select>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="bg-[#0f0f13] border border-[#2a2a38] text-[#e2e8f0] text-xs rounded-lg px-3 py-1.5 focus:outline-none"
            >
              <option value="all">All Types</option>
              {Object.entries(stats.byType).map(([t, n]) => (
                <option key={t} value={t}>
                  {t} ({n})
                </option>
              ))}
            </select>
            {(searchQ || filterBrand !== 'all' || filterType !== 'all') && (
              <button
                onClick={() => {
                  setSearchQ('')
                  setFilterBrand('all')
                  setFilterType('all')
                }}
                className="text-xs px-3 py-1.5 rounded-lg bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/20 transition-colors cursor-pointer"
              >
                Clear
              </button>
            )}
            <span className="ml-auto text-[11px]" style={{ color: '#94a3b8' }}>
              <span className="font-bold text-white">{filtered.length}</span> shown
            </span>
          </div>

          {/* Card grid */}
          {filtered.length === 0 ? (
            <Card>
              <p className="text-[12px] py-10 text-center" style={{ color: '#cbd5e1' }}>
                No promotions match the current filters.
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
              {filtered.map((p) => (
                <PromoCard
                  key={p.id}
                  promo={p}
                  brandName={brandMap[p.brand_id]?.name || '?'}
                  isJoola={brandMap[p.brand_id]?.is_joola}
                />
              ))}
            </div>
          )}

          {/* Detailed table */}
          {filtered.length > 0 && (
            <Card title="Full Promo Log" className="mt-4">
              <DataTable
                columns={[
                  {
                    key: 'brand_id',
                    label: 'Brand',
                    render: (id) => <BrandBadge name={brandMap[id]?.name || '?'} isJoola={brandMap[id]?.is_joola} />,
                    sortValue: (r) => brandMap[r.brand_id]?.name || '',
                  },
                  { key: 'banner_text', label: 'Banner', render: (v) => <span className="text-[12px]" style={{ color: '#e2e8f0' }}>{v}</span> },
                  { key: 'promo_type', label: 'Type', render: (v) => <PromoTypeBadge t={v} /> },
                  { key: 'discount_pct', label: 'Disc.', render: (v) => <DiscountChip pct={v} /> },
                  { key: 'detected_at', label: 'Detected', render: (v) => <span className="text-[11px]" style={{ color: '#94a3b8' }}>{fmtDate(v)}</span> },
                  {
                    key: 'source_url',
                    label: 'Source',
                    render: (v) => v ? (
                      <a href={v} target="_blank" rel="noreferrer" className="text-[11px] text-[#818cf8] hover:underline">View</a>
                    ) : '—',
                  },
                ]}
                rows={filtered}
                isJoolaRow={(r) => brandMap[r.brand_id]?.is_joola}
              />
            </Card>
          )}
        </>
      )}
    </div>
  )
}
