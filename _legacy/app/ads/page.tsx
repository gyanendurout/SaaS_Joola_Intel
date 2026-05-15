'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/shared/supabase'
import { Card } from '@/components/v1/Card'
import { KPICard } from '@/components/v1/KPICard'
import { CSSBar } from '@/components/v1/CSSBar'
import { BrandBadge } from '@/components/v1/BrandBadge'
import { fmt, fmtDate } from '@/lib/v1/utils'

type Ad = {
  id: string
  brand_id: string
  platform: 'meta' | 'google' | string
  ad_id: string | null
  page_name: string | null
  body: string | null
  cta: string | null
  creative_url: string | null
  landing_url: string | null
  started_at: string | null
  is_active: boolean
  raw: any
  captured_at: string | null
}

function PlatformPill({ p }: { p: string }) {
  const meta = p === 'meta'
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
      style={{
        background: meta ? 'rgba(24,119,242,0.12)' : 'rgba(234,67,53,0.10)',
        color: meta ? '#5b8def' : '#e57368',
        border: `1px solid ${meta ? 'rgba(24,119,242,0.25)' : 'rgba(234,67,53,0.22)'}`,
      }}
    >
      <span className="w-1 h-1 rounded-full" style={{ background: meta ? '#5b8def' : '#e57368' }} />
      {meta ? 'Meta' : 'Google'}
    </span>
  )
}

function AdCard({ ad, brandName, isJoola }: { ad: Ad; brandName: string; isJoola?: boolean }) {
  const hasCreative = !!ad.creative_url && /^https?:\/\//.test(ad.creative_url)
  const isVideo = ad.creative_url?.match(/\.(mp4|webm|mov)(\?|$)/i)
  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col transition-all duration-200 group hover:scale-[1.005]"
      style={{
        background: 'rgba(10,15,25,0.8)',
        backdropFilter: 'blur(16px)',
        border: `1px solid ${isJoola ? 'rgba(34,197,94,0.20)' : 'rgba(255,255,255,0.07)'}`,
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      }}
    >
      {/* Creative thumbnail */}
      <div
        className="relative w-full aspect-square overflow-hidden flex-shrink-0"
        style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.02), rgba(255,255,255,0.005))' }}
      >
        {hasCreative && !isVideo ? (
          <img
            src={ad.creative_url!}
            alt=""
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-[10px] uppercase tracking-widest" style={{ color: '#475569' }}>
              {isVideo ? 'Video creative' : 'No preview'}
            </span>
          </div>
        )}
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          <PlatformPill p={ad.platform} />
          {ad.is_active && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold"
              style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.25)' }}>
              <span className="w-1 h-1 rounded-full bg-[#22c55e] animate-pulse" />
              Active
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-3.5 flex-1 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <BrandBadge name={brandName} isJoola={isJoola} />
          {ad.started_at && (
            <span className="text-[10px]" style={{ color: '#94a3b8' }}>{fmtDate(ad.started_at)}</span>
          )}
        </div>
        <p className="text-[12px] leading-snug line-clamp-3" style={{ color: '#e2e8f0' }}>
          {ad.body || <span className="italic text-[#94a3b8]">No ad copy</span>}
        </p>
        <div className="flex items-center gap-1.5 pt-1 mt-auto">
          {ad.cta && (
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(245,158,11,0.10)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.22)' }}>
              {ad.cta}
            </span>
          )}
          {ad.landing_url && (
            <a
              href={ad.landing_url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-[10px] font-medium text-[#818cf8] hover:underline"
            >
              Landing →
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AdsPage() {
  const [brands, setBrands] = useState<any[]>([])
  const [ads, setAds] = useState<Ad[]>([])
  const [loading, setLoading] = useState(true)
  const [filterBrand, setFilterBrand] = useState('all')
  const [filterPlatform, setFilterPlatform] = useState('all')
  const [filterActive, setFilterActive] = useState('all')
  const [searchQ, setSearchQ] = useState('')
  const [sortKey, setSortKey] = useState<'recent' | 'brand'>('recent')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      supabase.from('brands').select('*'),
      supabase
        .from('marketing_ads')
        .select('id,brand_id,platform,ad_id,page_name,body,cta,creative_url,landing_url,started_at,is_active,captured_at')
        .order('captured_at', { ascending: false })
        .limit(2000),
    ]).then(([{ data: b }, { data: a }]) => {
      setBrands(b || [])
      setAds((a as Ad[]) || [])
      setLoading(false)
    })
  }, [])

  const brandMap = Object.fromEntries(brands.map((b) => [b.id, b]))
  const brandsWithAds = useMemo(
    () => brands.filter((b) => ads.some((a) => a.brand_id === b.id)),
    [brands, ads],
  )

  const stats = useMemo(() => {
    const total = ads.length
    const meta = ads.filter((a) => a.platform === 'meta').length
    const google = ads.filter((a) => a.platform === 'google').length
    const active = ads.filter((a) => a.is_active).length
    const byBrand = ads.reduce<Record<string, number>>((acc, a) => {
      acc[a.brand_id] = (acc[a.brand_id] || 0) + 1
      return acc
    }, {})
    const topBrand = Object.entries(byBrand).sort((a, b) => b[1] - a[1])[0]
    return { total, meta, google, active, byBrand, topBrand }
  }, [ads])

  const filtered = useMemo(() => {
    let out = ads
    if (filterBrand !== 'all') out = out.filter((a) => a.brand_id === filterBrand)
    if (filterPlatform !== 'all') out = out.filter((a) => a.platform === filterPlatform)
    if (filterActive === 'active') out = out.filter((a) => a.is_active)
    if (filterActive === 'inactive') out = out.filter((a) => !a.is_active)
    if (searchQ) {
      const q = searchQ.toLowerCase()
      out = out.filter(
        (a) =>
          (a.body || '').toLowerCase().includes(q) ||
          (a.cta || '').toLowerCase().includes(q) ||
          (a.page_name || '').toLowerCase().includes(q),
      )
    }
    if (sortKey === 'brand') {
      out = [...out].sort((a, b) =>
        (brandMap[a.brand_id]?.name || '').localeCompare(brandMap[b.brand_id]?.name || ''),
      )
    } else {
      out = [...out].sort((a, b) => {
        const da = new Date(a.started_at || a.captured_at || 0).getTime()
        const db = new Date(b.started_at || b.captured_at || 0).getTime()
        return db - da
      })
    }
    return out
  }, [ads, filterBrand, filterPlatform, filterActive, searchQ, sortKey, brandMap])

  const ctaCounts = useMemo(() => {
    const m: Record<string, number> = {}
    ads.forEach((a) => {
      const cta = (a.cta || 'No CTA').trim() || 'No CTA'
      m[cta] = (m[cta] || 0) + 1
    })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [ads])

  const brandBarItems = useMemo(() => {
    return brandsWithAds
      .map((b) => ({
        label: b.name,
        value: stats.byBrand[b.id] || 0,
        isJoola: b.is_joola,
      }))
      .sort((a, b) => b.value - a.value)
  }, [brandsWithAds, stats])

  return (
    <div className="max-w-[1400px] animate-fade-up">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full"
            style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.2)' }}
          >
            Marketing Intelligence
          </span>
        </div>
        <h1 className="text-[32px] font-black tracking-tight leading-tight mb-1">
          <span className="text-gradient-white">Ads </span>
          <span className="text-gradient-green">Library</span>
        </h1>
        <p className="text-[14px]" style={{ color: '#cbd5e1' }}>
          Meta Ad Library + Google Ads Transparency · {fmt(stats.total)} ads across {brandsWithAds.length} brands
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <div className="w-8 h-8 rounded-full border-2 border-[#f59e0b] border-t-transparent animate-spin mx-auto mb-4" />
            <p className="text-[13px]" style={{ color: '#cbd5e1' }}>Loading ad creatives…</p>
          </div>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <KPICard label="Total Ads" value={fmt(stats.total)} accent />
            <KPICard label="Meta" value={fmt(stats.meta)} color="indigo" />
            <KPICard label="Google" value={fmt(stats.google)} color="amber" />
            <KPICard label="Active" value={fmt(stats.active)} color="green" />
            <KPICard
              label="Top Advertiser"
              value={stats.topBrand ? brandMap[stats.topBrand[0]]?.name || '—' : '—'}
              sub={stats.topBrand ? `${stats.topBrand[1]} ads` : ''}
            />
          </div>

          {/* Bar + CTAs side by side */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card title="Ads by Brand" className="md:col-span-2">
              {brandBarItems.length === 0 ? (
                <p className="text-[12px] py-6 text-center" style={{ color: '#cbd5e1' }}>No ads yet.</p>
              ) : (
                <CSSBar items={brandBarItems} />
              )}
            </Card>

            <Card title="Top CTAs">
              {ctaCounts.length === 0 ? (
                <p className="text-[12px] py-6 text-center" style={{ color: '#cbd5e1' }}>No CTA data.</p>
              ) : (
                <div className="space-y-2">
                  {ctaCounts.slice(0, 8).map(([cta, n]) => (
                    <div
                      key={cta}
                      className="flex items-center justify-between p-2 rounded-lg"
                      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
                    >
                      <span
                        className="text-[11px] font-semibold uppercase tracking-wider truncate"
                        style={{ color: cta === 'No CTA' ? '#94a3b8' : '#f59e0b' }}
                      >
                        {cta}
                      </span>
                      <span className="text-[12px] font-bold stat-number" style={{ color: '#e2e8f0' }}>
                        {n}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Filter bar */}
          <div
            className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-2xl"
            style={{ background: 'rgba(10,15,25,0.6)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <input
              type="text"
              placeholder="Search body, CTA, page…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="bg-[#0f0f13] border border-[#2a2a38] text-white text-xs rounded-lg px-3 py-1.5 w-56 focus:outline-none focus:border-[#22c55e]/50 placeholder-[#94a3b8]"
            />
            <select
              value={filterBrand}
              onChange={(e) => setFilterBrand(e.target.value)}
              className="bg-[#0f0f13] border border-[#2a2a38] text-[#e2e8f0] text-xs rounded-lg px-3 py-1.5 focus:outline-none"
            >
              <option value="all">All Brands ({brandsWithAds.length})</option>
              {brandsWithAds.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({stats.byBrand[b.id] || 0})
                </option>
              ))}
            </select>
            <select
              value={filterPlatform}
              onChange={(e) => setFilterPlatform(e.target.value)}
              className="bg-[#0f0f13] border border-[#2a2a38] text-[#e2e8f0] text-xs rounded-lg px-3 py-1.5 focus:outline-none"
            >
              <option value="all">All Platforms</option>
              <option value="meta">Meta ({stats.meta})</option>
              <option value="google">Google ({stats.google})</option>
            </select>
            <select
              value={filterActive}
              onChange={(e) => setFilterActive(e.target.value)}
              className="bg-[#0f0f13] border border-[#2a2a38] text-[#e2e8f0] text-xs rounded-lg px-3 py-1.5 focus:outline-none"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as any)}
              className="bg-[#0f0f13] border border-[#2a2a38] text-[#e2e8f0] text-xs rounded-lg px-3 py-1.5 focus:outline-none"
            >
              <option value="recent">Most Recent</option>
              <option value="brand">By Brand</option>
            </select>
            {(searchQ || filterBrand !== 'all' || filterPlatform !== 'all' || filterActive !== 'all') && (
              <button
                onClick={() => {
                  setSearchQ('')
                  setFilterBrand('all')
                  setFilterPlatform('all')
                  setFilterActive('all')
                }}
                className="text-xs px-3 py-1.5 rounded-lg bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/20 transition-colors cursor-pointer"
              >
                Clear filters
              </button>
            )}
            <span className="ml-auto text-[11px]" style={{ color: '#94a3b8' }}>
              Showing <span className="font-bold text-white">{filtered.length}</span> of {stats.total}
            </span>
          </div>

          {/* Creative gallery */}
          {filtered.length === 0 ? (
            <Card>
              <p className="text-[12px] py-10 text-center" style={{ color: '#cbd5e1' }}>
                No ads match the current filters.
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {filtered.slice(0, 200).map((ad) => (
                <AdCard
                  key={ad.id}
                  ad={ad}
                  brandName={brandMap[ad.brand_id]?.name || '?'}
                  isJoola={brandMap[ad.brand_id]?.is_joola}
                />
              ))}
            </div>
          )}
          {filtered.length > 200 && (
            <p className="text-[11px] mt-4 text-center" style={{ color: '#94a3b8' }}>
              Showing first 200 creatives. Use filters to narrow further.
            </p>
          )}
        </>
      )}
    </div>
  )
}
