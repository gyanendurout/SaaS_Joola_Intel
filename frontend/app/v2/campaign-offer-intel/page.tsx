'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  PageHead, MiniKpi, SortTh, ColumnFilter, LoadingPage, SectionInfo,
  FilterBanner, pgColor, pgName,
} from '@/components/v2/PageShell'
import { fmt, Donut } from '@/components/v2/charts'
import { useBrandFilter, applyBrandFilter } from '@/lib/v2/BrandFilterContext'
import { useDateRange, DATE_RANGE_LABEL, type DateRangeKey } from '@/lib/v2/DateRangeContext'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import {
  fetchCampaignOfferIntel,
  fetchCampaignStrategyMatrix,
  buildOfferPlaybook,
  buildMessageThemeRows,
  type CampaignOfferIntelData,
  type AdCreative,
  type ActiveOffer,
  type CampaignPressureStat,
  type ActivityTrendPoint,
  type PromoCadenceRow,
  type PlatformStat,
  type CampaignStrategyMatrix,
  type CampaignStrategyPoint,
  type CampaignStrategyQuadrant,
  type OfferPlaybookRow,
  type MessageThemeRow,
  type MessageTheme,
} from '@/lib/v2/campaignOfferIntel'
import { formatCalendarDate } from '@/lib/v2/format'
import { useReveal, revealCls } from '@/lib/v2/animations'

type PlatformKey = 'all' | 'meta' | 'google' | 'other'
type PromoTypeKey = 'all' | 'discount' | 'free_shipping' | 'launch' | 'bundle' | 'general' | 'other'
type StatusKey = 'all' | 'active' | 'inactive'
type DiscountKey = 'all' | '0-10' | '10-20' | '20-30' | '30+' | 'unknown'

const PROMO_TYPE_LABEL: Record<PromoTypeKey, string> = {
  all: 'All types',
  discount: 'Discount',
  free_shipping: 'Free shipping',
  launch: 'Launch',
  bundle: 'Bundle',
  general: 'General',
  other: 'Other',
}

const filterLabel: React.CSSProperties = {
  display: 'inline-flex',
  flexDirection: 'column',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--fg-4)',
  gap: 4,
}

const emptyCell: React.CSSProperties = {
  textAlign: 'center',
  color: '#6b7280',
  padding: '32px 0',
  fontSize: 13,
}

function toggleSort<S extends { key: string; dir: 'asc' | 'desc' }>(
  current: S,
  set: (next: S) => void,
  k: string,
): void {
  if (current.key === k) set({ ...current, dir: current.dir === 'asc' ? 'desc' : 'asc' })
  else set({ ...current, key: k, dir: 'desc' })
}

function sortRows<T>(rows: T[], key: string, dir: 'asc' | 'desc'): T[] {
  if (!key) return rows
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[key]
    const bv = (b as Record<string, unknown>)[key]
    if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av
    if (typeof av === 'boolean' && typeof bv === 'boolean') {
      return dir === 'asc' ? (av === bv ? 0 : av ? 1 : -1) : (av === bv ? 0 : av ? -1 : 1)
    }
    const as = String(av ?? '')
    const bs = String(bv ?? '')
    return dir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
  })
}

function discountBucket(d: number | null): DiscountKey {
  if (d == null) return 'unknown'
  if (d < 10) return '0-10'
  if (d < 20) return '10-20'
  if (d < 30) return '20-30'
  return '30+'
}

export default function CampaignOfferIntelPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const router = useRouter()
  const [data, setData] = useState<CampaignOfferIntelData | null>(null)
  const [matrix, setMatrix] = useState<CampaignStrategyMatrix | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [drillScatter, setDrillScatter] = useState<CampaignPressureStat | null>(null)
  const [drillOffer, setDrillOffer] = useState<ActiveOffer | null>(null)
  const [drillAd, setDrillAd] = useState<AdCreative | null>(null)
  const [drillStrategy, setDrillStrategy] = useState<{ point: import('@/lib/v2/campaignOfferIntel').CampaignStrategyPoint; stat: CampaignPressureStat | null } | null>(null)
  const [drillPlaybook, setDrillPlaybook] = useState<OfferPlaybookRow | null>(null)

  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()
  const { range, setRange, mode, customFrom, customTo, setCustomFrom, setCustomTo, effectiveFrom, effectiveTo } = useDateRange()

  const [platformFilter, setPlatformFilter] = useState<PlatformKey>('all')
  const [promoTypeFilter, setPromoTypeFilter] = useState<PromoTypeKey>('all')
  const [statusFilter, setStatusFilter] = useState<StatusKey>('all')
  const [discountFilter, setDiscountFilter] = useState<DiscountKey>('all')

  const [pressureSort, setPressureSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'pressure', dir: 'desc' })
  const [pressureBrand, setPressureBrand] = useState('')

  const [offerSort, setOfferSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'detectedAt', dir: 'desc' })
  const [offerColFilter, setOfferColFilter] = useState<Record<string, string>>({})

  const [adSort, setAdSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'startedAt', dir: 'desc' })
  const [adColFilter, setAdColFilter] = useState<Record<string, string>>({})

  useEffect(() => {
    document.title = 'JOOLA INTEL — Campaign & Offer Intel'
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const b = await fetchBrands()
        if (cancelled) return
        setBrands(b)
        setAllBrands(b)
        const d = await fetchCampaignOfferIntel(b, { from: effectiveFrom, to: effectiveTo })
        if (cancelled) return
        setData(d)
        // Strategy matrix uses the analytics marts (or falls back to the just-loaded ads/offers)
        const m = await fetchCampaignStrategyMatrix(b, { ads: d.adCreatives, offers: d.activeOffers })
        if (cancelled) return
        setMatrix(m)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[campaign-offer-intel] load failed', err)
        if (!cancelled) setError('Unable to load Campaign & Offer Intel. Refresh the page to retry.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [effectiveFrom, effectiveTo, setAllBrands])

  const name = (s: string) => pgName(s, brands)

  // ─── Filtered views (computed before early-returns) ────────────────
  const filteredAds = useMemo<AdCreative[]>(() => {
    if (!data) return []
    let rows = applyBrandFilter(data.adCreatives, filteredBrands, isFiltered)
    if (platformFilter !== 'all') {
      rows = rows.filter((a) => {
        const p = a.rawPlatform
        if (platformFilter === 'meta') return p === 'meta'
        if (platformFilter === 'google') return p === 'google'
        return p !== 'meta' && p !== 'google'
      })
    }
    if (statusFilter !== 'all') {
      rows = rows.filter((a) => (statusFilter === 'active' ? a.active : !a.active))
    }
    return rows
  }, [data, filteredBrands, isFiltered, platformFilter, statusFilter])

  const filteredOffers = useMemo<ActiveOffer[]>(() => {
    if (!data) return []
    let rows = applyBrandFilter(data.activeOffers, filteredBrands, isFiltered)
    if (promoTypeFilter !== 'all') rows = rows.filter((p) => p.type === promoTypeFilter)
    if (statusFilter !== 'all') {
      rows = rows.filter((p) => (statusFilter === 'active' ? p.active : !p.active))
    }
    if (discountFilter !== 'all') rows = rows.filter((p) => discountBucket(p.discount) === discountFilter)
    return rows
  }, [data, filteredBrands, isFiltered, promoTypeFilter, statusFilter, discountFilter])

  // Recompute brand-level stats from the *filtered* underlying rows so the
  // bars, ranks, and JOOLA position respect the active filter bar.
  const recomputedAdStats = useMemo(() => {
    const agg = new Map<string, { brand: string; total: number; active: number; meta: number; google: number; other: number; share: number }>()
    for (const a of filteredAds) {
      if (!agg.has(a.brand)) {
        agg.set(a.brand, { brand: a.brand, total: 0, active: 0, meta: 0, google: 0, other: 0, share: 0 })
      }
      const row = agg.get(a.brand)!
      row.total++
      if (a.active) row.active++
      if (a.rawPlatform === 'meta') row.meta++
      else if (a.rawPlatform === 'google') row.google++
      else row.other++
    }
    const rows = Array.from(agg.values())
    const total = rows.reduce((s, r) => s + r.total, 0) || 1
    rows.forEach((r) => { r.share = (r.total / total) * 100 })
    rows.sort((a, b) => b.total - a.total)
    return rows
  }, [filteredAds])

  const recomputedPromoStats = useMemo(() => {
    const agg = new Map<string, { brand: string; count: number; discountCount: number; avgDiscount: number; pct: number }>()
    for (const p of filteredOffers) {
      if (!agg.has(p.brand)) {
        agg.set(p.brand, { brand: p.brand, count: 0, discountCount: 0, avgDiscount: 0, pct: 0 })
      }
      const row = agg.get(p.brand)!
      row.count++
      if (p.discount != null && p.discount > 0) {
        row.discountCount++
        row.avgDiscount += p.discount
      }
    }
    const rows = Array.from(agg.values())
    rows.forEach((r) => { r.avgDiscount = r.discountCount > 0 ? Math.round(r.avgDiscount / r.discountCount) : 0 })
    const total = rows.reduce((s, r) => s + r.count, 0) || 1
    rows.forEach((r) => { r.pct = (r.count / total) * 100 })
    rows.sort((a, b) => b.count - a.count)
    return rows
  }, [filteredOffers])

  const recomputedPressure = useMemo<CampaignPressureStat[]>(() => {
    const adByBrand = new Map(recomputedAdStats.map((r) => [r.brand, r]))
    const promoByBrand = new Map(recomputedPromoStats.map((r) => [r.brand, r]))
    const allBrandSlugs = Array.from(new Set([...recomputedAdStats.map((r) => r.brand), ...recomputedPromoStats.map((r) => r.brand)]))
    const maxAds = Math.max(1, ...recomputedAdStats.map((r) => r.total))
    const maxPromos = Math.max(1, ...recomputedPromoStats.map((r) => r.count))
    return allBrandSlugs.map((slug) => {
      const a = adByBrand.get(slug)
      const p = promoByBrand.get(slug)
      const ads = a?.total || 0
      const promos = p?.count || 0
      const pressure = 50 * (ads / maxAds) + 50 * (promos / maxPromos)
      return {
        brand: slug,
        ads,
        promos,
        adShare: a?.share || 0,
        promoShare: p?.pct || 0,
        avgDiscount: p?.avgDiscount || 0,
        pressure: Math.round(pressure * 10) / 10,
      }
    }).sort((a, b) => b.pressure - a.pressure)
  }, [recomputedAdStats, recomputedPromoStats])

  const recomputedPlatformStats = useMemo<PlatformStat[]>(() => {
    const map: Record<string, number> = {}
    for (const a of filteredAds) {
      const k = a.rawPlatform || 'other'
      map[k] = (map[k] || 0) + 1
    }
    const total = filteredAds.length || 1
    return Object.entries(map)
      .map(([k, v]) => ({
        platform: k,
        pretty: k === 'meta' ? 'Meta' : k === 'google' ? 'Google' : (k.charAt(0).toUpperCase() + k.slice(1)),
        count: v,
        pct: (v / total) * 100,
      }))
      .sort((a, b) => b.count - a.count)
  }, [filteredAds])

  // Pressure table rows (with brand search + sort)
  const pressureRows = useMemo(() => {
    const q = pressureBrand.trim().toLowerCase()
    const rows = recomputedPressure.filter(
      (r) => !q || r.brand.toLowerCase().includes(q) || name(r.brand).toLowerCase().includes(q),
    )
    return sortRows(rows, pressureSort.key, pressureSort.dir)
  }, [recomputedPressure, pressureBrand, pressureSort, brands])

  // Offer rows
  const offerRows = useMemo(() => {
    let rows = [...filteredOffers]
    if (Object.keys(offerColFilter).length > 0) {
      rows = rows.filter((r) =>
        Object.entries(offerColFilter).every(([k, q]) => {
          if (!q) return true
          const needle = q.toLowerCase()
          if (k === 'brand') return r.brand.toLowerCase().includes(needle) || name(r.brand).toLowerCase().includes(needle)
          if (k === 'text') return r.text.toLowerCase().includes(needle)
          return true
        }),
      )
    }
    rows = sortRows(rows, offerSort.key, offerSort.dir)
    return rows.slice(0, 200)
  }, [filteredOffers, offerColFilter, offerSort, brands])

  // Ad rows
  const adRows = useMemo(() => {
    let rows = [...filteredAds]
    if (Object.keys(adColFilter).length > 0) {
      rows = rows.filter((r) =>
        Object.entries(adColFilter).every(([k, q]) => {
          if (!q) return true
          const needle = q.toLowerCase()
          if (k === 'brand') return r.brand.toLowerCase().includes(needle) || name(r.brand).toLowerCase().includes(needle)
          if (k === 'copy') return r.copy.toLowerCase().includes(needle)
          return true
        }),
      )
    }
    rows = sortRows(rows, adSort.key, adSort.dir)
    return rows.slice(0, 200)
  }, [filteredAds, adColFilter, adSort, brands])

  // ─── New section: Offer Playbook (rule-based JOOLA response) ───────
  const offerPlaybook = useMemo<OfferPlaybookRow[]>(() => {
    return buildOfferPlaybook(filteredOffers)
  }, [filteredOffers])

  // ─── New section: Creative Message Intelligence ────────────────────
  const messageThemeData = useMemo(() => {
    return buildMessageThemeRows(filteredAds)
  }, [filteredAds])

  const sec1 = useReveal()
  const sec2 = useReveal()
  const sec3 = useReveal()

  // ─── Early returns ──────────────────────────────────────────────────
  if (loading) return <LoadingPage />

  if (error || !data) return (
    <div style={{ padding: '80px 32px', textAlign: 'center' }}>
      <div style={{ color: '#ef4444', fontSize: 14, marginBottom: 16 }}>{error || 'Unable to load Campaign & Offer Intel.'}</div>
      <button className="btn btn-yellow" onClick={() => window.location.reload()} aria-label="Refresh page">Refresh page</button>
    </div>
  )

  const fromInputValue = effectiveFrom.toISOString().slice(0, 10)
  const toInputValue = effectiveTo.toISOString().slice(0, 10)

  // Summary computations
  const totalAds = filteredAds.length
  const activeAds = filteredAds.filter((a) => a.active).length
  const totalPromos = filteredOffers.length
  const activePromos = filteredOffers.filter((p) => p.active).length
  const brandsAdvertising = recomputedAdStats.filter((r) => r.total > 0).length
  const brandsDiscounting = recomputedPromoStats.filter((r) => r.count > 0).length
  const joolaAd = recomputedAdStats.find((r) => r.brand === 'joola')
  const joolaPromo = recomputedPromoStats.find((r) => r.brand === 'joola')
  const joolaAdShare = joolaAd?.share || 0
  const topAdBrand = recomputedAdStats[0]
  const topPromoBrand = recomputedPromoStats[0]
  const discountValues = filteredOffers.filter((p) => p.discount != null && p.discount > 0).map((p) => p.discount as number)
  const avgDiscountAll = discountValues.length > 0
    ? Math.round(discountValues.reduce((s, d) => s + d, 0) / discountValues.length)
    : 0

  // JOOLA-position recomputed from active filter
  const joolaAdRank = joolaAd ? recomputedAdStats.findIndex((r) => r.brand === 'joola') + 1 : null
  const joolaPromoRank = joolaPromo ? recomputedPromoStats.findIndex((r) => r.brand === 'joola') + 1 : null
  const topNonJoolaAd = recomputedAdStats.find((r) => r.brand !== 'joola' && r.total > 0) || topAdBrand
  const topNonJoolaPromo = recomputedPromoStats.find((r) => r.brand !== 'joola' && r.count > 0) || topPromoBrand
  const adGapToLeader = (topNonJoolaAd?.total || 0) - (joolaAd?.total || 0)
  const promoGapToLeader = (topNonJoolaPromo?.count || 0) - (joolaPromo?.count || 0)

  // Donut data for platform mix
  const donutData = recomputedPlatformStats.slice(0, 6).map((p, i) => ({
    name: p.pretty,
    value: p.count,
    color: p.platform === 'meta' ? '#818cf8'
      : p.platform === 'google' ? '#4ade80'
      : ['#fb923c', '#ec4899', '#06b6d4', '#a855f7'][i % 4],
  }))

  return (
    <div className="ov-page-enter">
      {drillScatter && (
        <ScatterBubbleDialog row={drillScatter} brands={brands} onClose={() => setDrillScatter(null)} />
      )}
      {drillOffer && (
        <OfferDetailDialog offer={drillOffer} brands={brands} onClose={() => setDrillOffer(null)} />
      )}
      {drillAd && (
        <AdCreativeDialog ad={drillAd} brands={brands} onClose={() => setDrillAd(null)} />
      )}
      {drillPlaybook && (
        <PlaybookRowDialog row={drillPlaybook} brands={brands} onClose={() => setDrillPlaybook(null)} />
      )}
      {drillStrategy && (
        <StrategyBubbleDialog point={drillStrategy.point} stat={drillStrategy.stat} brands={brands} onClose={() => setDrillStrategy(null)} />
      )}
      <PageHead title="CAMPAIGN & OFFER INTEL" />
      <FilterBanner />

      {/* ─── Section 1: Summary strip ──────────────────────────────── */}
      <section>
        <div
          className="card"
          style={{
            padding: '14px 18px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 22,
            alignItems: 'center',
            fontSize: 12,
            color: 'var(--fg-2)',
            marginBottom: 18,
          }}
        >
          <div className="ov-kpi" style={{ '--ov-d': '160ms' } as React.CSSProperties}><SummaryItem label="Active ads" value={fmt(activeAds)} /></div>
          <div className="ov-kpi" style={{ '--ov-d': '235ms' } as React.CSSProperties}><SummaryItem label="Active promos" value={fmt(activePromos)} /></div>
          <div className="ov-kpi" style={{ '--ov-d': '310ms' } as React.CSSProperties}><SummaryItem label="Brands advertising" value={fmt(brandsAdvertising)} /></div>
          <div className="ov-kpi" style={{ '--ov-d': '385ms' } as React.CSSProperties}><SummaryItem label="Brands discounting" value={fmt(brandsDiscounting)} /></div>
          <div className="ov-kpi" style={{ '--ov-d': '460ms' } as React.CSSProperties}><SummaryItem label="JOOLA ad share" value={`${joolaAdShare.toFixed(1)}%`} color="#22c55e" /></div>
          <div className="ov-kpi" style={{ '--ov-d': '535ms' } as React.CSSProperties}><SummaryItem label="JOOLA promos" value={fmt(joolaPromo?.count || 0)} color={(joolaPromo?.count || 0) === 0 ? '#ef4444' : '#22c55e'} /></div>
          <div className="ov-kpi" style={{ '--ov-d': '610ms' } as React.CSSProperties}><SummaryItem
            label="Top ad brand"
            value={topAdBrand ? name(topAdBrand.brand) : '—'}
            color={topAdBrand ? pgColor(topAdBrand.brand) : undefined}
          /></div>
          <div className="ov-kpi" style={{ '--ov-d': '685ms' } as React.CSSProperties}><SummaryItem
            label="Top promo brand"
            value={topPromoBrand ? name(topPromoBrand.brand) : '—'}
            color={topPromoBrand ? pgColor(topPromoBrand.brand) : undefined}
          /></div>
          <div className="ov-kpi" style={{ '--ov-d': '760ms' } as React.CSSProperties}><SummaryItem label="Avg discount" value={avgDiscountAll > 0 ? `${avgDiscountAll}%` : '—'} /></div>
        </div>

      </section>

      {/* ─── Section 2: Brand campaign pressure ───────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Brand campaign pressure
              <SectionInfo
                title="Brand campaign pressure"
                description="Composite competitive-pressure score combining a brand's paid ad volume and active promotions. Score is 50 × ads/maxAds + 50 × promos/maxPromos, on a 0–100 scale. A brand leading in both pins to 100. Use this to spot who's leaning hardest on paid acquisition + discounting right now."
                source="marketing_ads + promotions · brand-level aggregation"
              />
            </h2>
            <div className="sub">Who's pushing hardest. Sortable, searchable.</div>
          </div>
          <div className="actions">
            <input
              type="text"
              className="col-filter-input"
              placeholder="Search brand…"
              value={pressureBrand}
              onChange={(e) => setPressureBrand(e.target.value)}
              style={{ minWidth: 160 }}
              aria-label="Filter brands"
            />
          </div>
        </div>
        <div ref={sec1.ref} className={`card ${revealCls(sec1.vis)}`} style={{ overflowX: 'auto' }}>
          <table className="data" style={{ width: '100%', minWidth: 940 }}>
            <thead>
              <tr>
                <SortTh col="brand" label="Brand" sortKey={pressureSort.key} sortDir={pressureSort.dir} toggle={(k) => toggleSort(pressureSort, setPressureSort, k)} style={{ textAlign: 'left' }} />
                <SortTh col="ads" label="Active ads" sortKey={pressureSort.key} sortDir={pressureSort.dir} toggle={(k) => toggleSort(pressureSort, setPressureSort, k)} />
                <SortTh col="promos" label="Active promos" sortKey={pressureSort.key} sortDir={pressureSort.dir} toggle={(k) => toggleSort(pressureSort, setPressureSort, k)} />
                <SortTh col="adShare" label="Ad share %" sortKey={pressureSort.key} sortDir={pressureSort.dir} toggle={(k) => toggleSort(pressureSort, setPressureSort, k)} />
                <SortTh col="promoShare" label="Promo share %" sortKey={pressureSort.key} sortDir={pressureSort.dir} toggle={(k) => toggleSort(pressureSort, setPressureSort, k)} />
                <SortTh col="avgDiscount" label="Avg discount" sortKey={pressureSort.key} sortDir={pressureSort.dir} toggle={(k) => toggleSort(pressureSort, setPressureSort, k)} />
                <SortTh col="pressure" label="Pressure score" sortKey={pressureSort.key} sortDir={pressureSort.dir} toggle={(k) => toggleSort(pressureSort, setPressureSort, k)} />
              </tr>
            </thead>
            <tbody>
              {pressureRows.length === 0 && (
                <tr><td colSpan={7} style={emptyCell}>No campaign or promo activity for this filter.</td></tr>
              )}
              {pressureRows.map((r) => {
                const isJoola = r.brand === 'joola'
                const maxPressure = Math.max(1, ...pressureRows.map((x) => x.pressure))
                const barPct = (r.pressure / maxPressure) * 100
                return (
                  <tr key={r.brand} style={{ ...(isJoola ? { borderLeft: '3px solid #22c55e', background: 'rgba(34,197,94,0.04)' } : {}), cursor: 'pointer' }} onClick={() => router.push(`/v2/campaign-offer-intel/brand/${encodeURIComponent(r.brand)}`)}>
                    <td style={{ textAlign: 'left' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: pgColor(r.brand) }} />
                        <span style={{ fontWeight: 700, color: isJoola ? '#22c55e' : 'inherit' }}>{name(r.brand)}</span>
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>{r.ads > 0 ? fmt(r.ads) : <span style={{ color: '#3a4150' }}>·</span>}</td>
                    <td style={{ textAlign: 'right' }}>{r.promos > 0 ? fmt(r.promos) : <span style={{ color: '#3a4150' }}>·</span>}</td>
                    <td style={{ textAlign: 'right' }}>{r.adShare > 0 ? `${r.adShare.toFixed(1)}%` : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{r.promoShare > 0 ? `${r.promoShare.toFixed(1)}%` : '—'}</td>
                    <td style={{ textAlign: 'right', color: r.avgDiscount > 0 ? '#F5E625' : 'inherit' }}>
                      {r.avgDiscount > 0 ? `${r.avgDiscount}%` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', verticalAlign: 'middle' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                        <span style={{ fontWeight: 700, color: '#fff' }}>{r.pressure.toFixed(1)}</span>
                        <div style={{ width: 80, height: 6, background: 'var(--wb-5)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${barPct}%`, height: '100%', background: isJoola ? '#22c55e' : '#F5E625' }} />
                        </div>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── Section 3: Campaign activity over time ─────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Campaign activity over time
              <SectionInfo
                title="Campaign activity over time"
                description="Top: weekly ad-volume stack per brand based on ads.startedAt. Bottom: per-brand promotion cadence — each lit cell means at least one promo was detected that week. Use this to spot bursts (launches, sales windows) vs. always-on always-discount strategies."
                source="marketing_ads.started_at + promotions.detected_at · 13-week rolling buckets"
              />
            </h2>
            <div className="sub">Ad volume stack and weekly promo cadence.</div>
          </div>
        </div>
        <div ref={sec2.ref} className={`card ${revealCls(sec2.vis)}`} style={{ padding: 16, marginBottom: 12 }}>
          <h6 style={{ marginTop: 0 }}>Weekly ad volume by brand</h6>
          <CampaignTrendChart points={data.activityTrend} name={name} />
        </div>
        <div className="card" style={{ padding: 16 }}>
          <h6 style={{ marginTop: 0 }}>Weekly promo cadence</h6>
          <PromoCadenceHeatmap rows={data.promoCadence} name={name} />
        </div>
      </section>

      {/* ─── Section 4: Ads vs promotions matrix ───────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Ads vs promotions matrix
              <SectionInfo
                title="Ads vs promotions matrix"
                description="X = brand's active ad count. Y = brand's active promo count. Bubble size encodes avg discount. JOOLA highlighted in green. 4 quadrants: paid-only (lower-right), discount-only (upper-left), both (upper-right), neither (lower-left)."
                source="Recomputed from filtered marketing_ads + promotions"
              />
            </h2>
            <div className="sub">Where each brand sits on paid + discount axes.</div>
          </div>
        </div>
        <div ref={sec3.ref} className={`card ${revealCls(sec3.vis)}`} style={{ padding: 16 }}>
          <AdsVsPromosScatter rows={recomputedPressure} name={name} onBubbleClick={setDrillScatter} />
        </div>
      </section>

      {/* ─── Section 5: Ad platform mix ────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Ad platform mix
              <SectionInfo
                title="Ad platform mix"
                description="Google vs. Meta vs. other distribution of all ad creatives in the active filter. A heavy Google lean means competitors are chasing high-intent search; Meta dominance means brand-awareness play."
                source="marketing_ads.platform"
              />
            </h2>
            <div className="sub">Where the paid acquisition spend lives.</div>
          </div>
        </div>
        {recomputedPlatformStats.length === 0 ? (
          <div className="card" style={{ padding: 18, fontSize: 13, color: '#6b7280', textAlign: 'center' }}>No ad platform data in the active filter.</div>
        ) : (
          <div className="two-col">
            <div className="card" style={{ padding: 16, display: 'flex', gap: 18, alignItems: 'center' }}>
              <Donut
                data={donutData}
                size={170}
                thickness={28}
                centerLabel={String(totalAds)}
                centerSub="ads"
              />
              <div className="donut-legend" style={{ flex: 1 }}>
                {donutData.map((d, i) => (
                  <div key={i} className="row">
                    <span className="swatch" style={{ background: d.color }} />
                    <span className="name">{d.name}</span>
                    <span className="val">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <h6 style={{ marginTop: 0 }}>Platform breakdown</h6>
              <table className="data" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Platform</th>
                    <th style={{ textAlign: 'right' }}>Ads</th>
                    <th style={{ textAlign: 'right' }}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {recomputedPlatformStats.map((p) => (
                    <tr key={p.platform}>
                      <td style={{ textAlign: 'left', fontWeight: 600 }}>{p.pretty}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(p.count)}</td>
                      <td style={{ textAlign: 'right' }}>{p.pct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ─── Section 6: Active offers & promotion details ──────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Active offers and promotion details
              <SectionInfo
                title="Active offers and promotion details"
                description="Deduped list of every promotion detected in the active window. Active = detected within the last 60 days (promotions table has no end_at column — recency is our proxy). Click headers to sort; use the column filters below the headers to narrow brand or text."
                source="promotions · scraped from competitor homepages weekly"
              />
            </h2>
            <div className="sub">Up to 200 most-recent offers. Click any row to open the source URL.</div>
          </div>
        </div>
        <div className="card">
          <div style={{ padding: '8px 18px', fontSize: 12, color: 'var(--fg-4)' }}>
            Showing {offerRows.length} of {filteredOffers.length} filtered offers
          </div>
          <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
            <table className="data" style={{ width: '100%', minWidth: 980 }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--sticky-bg)', zIndex: 2 }}>
                <tr>
                  <SortTh col="brand" label="Brand" sortKey={offerSort.key} sortDir={offerSort.dir} toggle={(k) => toggleSort(offerSort, setOfferSort, k)} style={{ textAlign: 'left' }} />
                  <SortTh col="text" label="Promo text" sortKey={offerSort.key} sortDir={offerSort.dir} toggle={(k) => toggleSort(offerSort, setOfferSort, k)} style={{ textAlign: 'left' }} />
                  <SortTh col="type" label="Type" sortKey={offerSort.key} sortDir={offerSort.dir} toggle={(k) => toggleSort(offerSort, setOfferSort, k)} />
                  <SortTh col="discount" label="Discount" sortKey={offerSort.key} sortDir={offerSort.dir} toggle={(k) => toggleSort(offerSort, setOfferSort, k)} />
                  <SortTh col="detectedAt" label="Detected" sortKey={offerSort.key} sortDir={offerSort.dir} toggle={(k) => toggleSort(offerSort, setOfferSort, k)} />
                  <SortTh col="active" label="Status" sortKey={offerSort.key} sortDir={offerSort.dir} toggle={(k) => toggleSort(offerSort, setOfferSort, k)} />
                  <th>Source</th>
                </tr>
                <tr className="col-filter-row">
                  <th><ColumnFilter col="brand" value={offerColFilter.brand} onChange={(v) => setOfferColFilter((p) => ({ ...p, brand: v }))} /></th>
                  <th><ColumnFilter col="text" value={offerColFilter.text} onChange={(v) => setOfferColFilter((p) => ({ ...p, text: v }))} placeholder="search text…" /></th>
                  <th colSpan={5} />
                </tr>
              </thead>
              <tbody>
                {offerRows.length === 0 && (
                  <tr><td colSpan={7} style={emptyCell}>No offers match this filter.</td></tr>
                )}
                {offerRows.map((p) => (
                  <tr key={p.id} style={{ ...(p.brand === 'joola' ? { borderLeft: '3px solid #22c55e', background: 'rgba(34,197,94,0.04)' } : {}), cursor: 'pointer' }} onClick={(e) => { if ((e.target as HTMLElement).closest('a')) return; setDrillOffer(p) }}>
                    <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 99, background: pgColor(p.brand) }} />
                        <span style={{ fontWeight: 600, color: p.brand === 'joola' ? '#22c55e' : 'inherit' }}>{name(p.brand)}</span>
                      </span>
                    </td>
                    <td style={{ textAlign: 'left', maxWidth: 380 }}>
                      <span title={p.text} style={{ display: 'inline-block', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.text || '—'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}><span className="pill pill-ghost" style={{ fontSize: 10 }}>{p.type}</span></td>
                    <td style={{ textAlign: 'right', color: p.discount != null && p.discount > 0 ? '#F5E625' : 'inherit', fontWeight: p.discount ? 700 : 400 }}>
                      {p.discount != null && p.discount > 0 ? `${p.discount}%` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'JetBrains Mono', fontSize: 11 }}>{formatCalendarDate(p.detectedAt)}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={'pill ' + (p.active ? 'pill-green' : 'pill-ghost')} style={{ fontSize: 10 }}>
                        {p.active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {p.sourceUrl
                        ? <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="ext-link" style={{ fontSize: 11 }}>open →</a>
                        : <span style={{ color: '#3a4150' }}>·</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ─── Section 7: Ad creatives & messaging ───────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Ad creatives and messaging
              <SectionInfo
                title="Ad creatives and messaging"
                description="Deduped ad-creative library — every Meta + Google ad captured in the active window. Use this to see what messages competitors are testing, what CTAs are most common, and how JOOLA's creative compares. Source link points to Meta Ads Library or the captured landing URL."
                source="marketing_ads · deduped on (platform, ad_id) with content fingerprint fallback"
              />
            </h2>
            <div className="sub">Up to 200 most-recent creatives. Click open to see the source.</div>
          </div>
        </div>
        <div className="card">
          <div style={{ padding: '8px 18px', fontSize: 12, color: 'var(--fg-4)' }}>
            Showing {adRows.length} of {filteredAds.length} filtered creatives
          </div>
          <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
            <table className="data" style={{ width: '100%', minWidth: 980 }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--sticky-bg)', zIndex: 2 }}>
                <tr>
                  <SortTh col="brand" label="Brand" sortKey={adSort.key} sortDir={adSort.dir} toggle={(k) => toggleSort(adSort, setAdSort, k)} style={{ textAlign: 'left' }} />
                  <SortTh col="platform" label="Platform" sortKey={adSort.key} sortDir={adSort.dir} toggle={(k) => toggleSort(adSort, setAdSort, k)} />
                  <SortTh col="copy" label="Copy" sortKey={adSort.key} sortDir={adSort.dir} toggle={(k) => toggleSort(adSort, setAdSort, k)} style={{ textAlign: 'left' }} />
                  <SortTh col="cta" label="CTA" sortKey={adSort.key} sortDir={adSort.dir} toggle={(k) => toggleSort(adSort, setAdSort, k)} />
                  <SortTh col="startedAt" label="First seen" sortKey={adSort.key} sortDir={adSort.dir} toggle={(k) => toggleSort(adSort, setAdSort, k)} />
                  <SortTh col="active" label="Status" sortKey={adSort.key} sortDir={adSort.dir} toggle={(k) => toggleSort(adSort, setAdSort, k)} />
                  <th>Source</th>
                </tr>
                <tr className="col-filter-row">
                  <th><ColumnFilter col="brand" value={adColFilter.brand} onChange={(v) => setAdColFilter((p) => ({ ...p, brand: v }))} /></th>
                  <th />
                  <th><ColumnFilter col="copy" value={adColFilter.copy} onChange={(v) => setAdColFilter((p) => ({ ...p, copy: v }))} placeholder="search copy…" /></th>
                  <th colSpan={4} />
                </tr>
              </thead>
              <tbody>
                {adRows.length === 0 && (
                  <tr><td colSpan={7} style={emptyCell}>No ad creatives match this filter.</td></tr>
                )}
                {adRows.map((a) => (
                  <tr key={a.id} style={{ ...(a.brand === 'joola' ? { borderLeft: '3px solid #22c55e', background: 'rgba(34,197,94,0.04)' } : {}), cursor: 'pointer' }} onClick={(e) => { if ((e.target as HTMLElement).closest('a')) return; setDrillAd(a) }}>
                    <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 99, background: pgColor(a.brand) }} />
                        <span style={{ fontWeight: 600, color: a.brand === 'joola' ? '#22c55e' : 'inherit' }}>{name(a.brand)}</span>
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={'pill ' + (a.rawPlatform === 'meta' ? 'pill-info' : a.rawPlatform === 'google' ? 'pill-amber' : 'pill-ghost')} style={{ fontSize: 10 }}>
                        {a.platform}
                      </span>
                    </td>
                    <td style={{ textAlign: 'left', maxWidth: 380 }}>
                      <span title={a.copy} style={{ display: 'inline-block', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.copy || '—'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className="pill pill-ghost" style={{ fontSize: 10 }}>{a.cta || '—'}</span>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'JetBrains Mono', fontSize: 11 }}>{formatCalendarDate(a.startedAt)}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={'pill ' + (a.active ? 'pill-green' : 'pill-ghost')} style={{ fontSize: 10 }}>
                        {a.active ? 'ACTIVE' : 'ENDED'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {a.sourceUrl
                        ? <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="ext-link" style={{ fontSize: 11 }}>open →</a>
                        : <span style={{ color: '#3a4150' }}>·</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ─── Section 8: JOOLA campaign and offer position ──────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              JOOLA campaign and offer position
              <SectionInfo
                title="JOOLA campaign and offer position"
                description="JOOLA-specific roll-up across paid + promo levers in the active filter window. Gap-to-leader = top non-JOOLA brand's count minus JOOLA's count."
                source="Recomputed from filtered marketing_ads + promotions where brand = joola"
              />
            </h2>
            <div className="sub">Where JOOLA sits on paid + discount levers right now.</div>
          </div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', fontSize: 13, color: 'var(--fg-2)' }}>
            <SummaryItem label="JOOLA active ads" value={fmt(joolaAd?.active || 0)} color="#22c55e" />
            <SummaryItem label="JOOLA total ads" value={fmt(joolaAd?.total || 0)} color="#22c55e" />
            <SummaryItem label="Ad share" value={`${joolaAdShare.toFixed(1)}%`} color="#22c55e" />
            <SummaryItem label="Ad rank" value={joolaAdRank ? `#${joolaAdRank}` : '—'} />
            <SummaryItem
              label="JOOLA promos"
              value={fmt(joolaPromo?.count || 0)}
              color={(joolaPromo?.count || 0) === 0 ? '#ef4444' : '#22c55e'}
            />
            <SummaryItem label="Promo share" value={joolaPromo ? `${joolaPromo.pct.toFixed(1)}%` : '—'} />
            <SummaryItem label="Promo rank" value={joolaPromoRank ? `#${joolaPromoRank}` : '—'} />
            <SummaryItem
              label="Avg discount (JOOLA)"
              value={(joolaPromo?.avgDiscount || 0) > 0 ? `${joolaPromo?.avgDiscount}%` : '—'}
              color={(joolaPromo?.avgDiscount || 0) > 0 ? '#F5E625' : undefined}
            />
            <SummaryItem
              label="Gap vs top advertiser"
              value={adGapToLeader > 0 ? `−${adGapToLeader} ads` : adGapToLeader < 0 ? `+${Math.abs(adGapToLeader)} ads` : 'tied'}
              color={adGapToLeader > 0 ? '#ef4444' : adGapToLeader < 0 ? '#22c55e' : undefined}
            />
            <SummaryItem
              label="Gap vs top promo brand"
              value={promoGapToLeader > 0 ? `−${promoGapToLeader} promos` : promoGapToLeader < 0 ? `+${Math.abs(promoGapToLeader)} promos` : 'tied'}
              color={promoGapToLeader > 0 ? '#ef4444' : promoGapToLeader < 0 ? '#22c55e' : undefined}
            />
          </div>
          {(joolaPromo?.count || 0) === 0 && (
            <div style={{ marginTop: 14, padding: 12, fontSize: 12, color: '#F5E625', background: 'rgba(245,182,37,0.08)', border: '1px solid rgba(245,182,37,0.3)', borderRadius: 6 }}>
              JOOLA has zero active promotions in this window — invisible on price-sensitive search. {topNonJoolaPromo
                ? `${name(topNonJoolaPromo.brand)} leads at ${topNonJoolaPromo.count} active promotion${topNonJoolaPromo.count !== 1 ? 's' : ''}.`
                : 'No competitor promotions tracked either.'}
            </div>
          )}
        </div>
      </section>

      {/* ─── Section A: Campaign Strategy Matrix (2x2 quadrant) ────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Campaign strategy matrix
              <SectionInfo
                title="Campaign strategy matrix"
                description="X = ad pressure (30d avg from ad_pressure_daily.ad_pressure_score, or active-ad count fallback). Y = promotion pressure (promo_active_flag × promo_depth_pct from promotion_daily, or promo count fallback). Bubble size = total ad+promo activity. JOOLA highlighted in green. Quadrants are split at the active brand median for X and Y."
                source={matrix?.source || 'ad_pressure_daily + promotion_daily'}
              />
            </h2>
            <div className="sub">Each brand placed on the paid × promo strategy plane.</div>
          </div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          {matrix && matrix.points.some((p) => p.adPressure > 0 || p.promoPressure > 0) ? (
            <CampaignStrategyMatrixChart matrix={matrix} name={name} pressureStats={recomputedPressure} onBubbleClick={(p, stat) => setDrillStrategy({ point: p, stat })} />
          ) : (
            <div style={emptyCell}>No campaign or promo data to plot in this window.</div>
          )}
          {matrix && (
            <div style={{ marginTop: 12, padding: 12, fontSize: 12, color: 'var(--fg-2)', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 6 }}>
              <strong style={{ color: '#22c55e' }}>JOOLA position:</strong>{' '}
              {matrix.joolaQuadrant ? (
                <>
                  Quadrant <em>{QUADRANT_LABEL[matrix.joolaQuadrant]}</em>.{' '}
                  {JOOLA_COUNTER[matrix.joolaQuadrant]}
                </>
              ) : (
                <>No JOOLA campaign signal in this window — start with paid + content push before considering promos.</>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ─── Section B: Competitor Offer Playbook ───────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Competitor offer playbook
              <SectionInfo
                title="Competitor offer playbook"
                description="One row per (brand, promo type) in the active filter. Discount depth = deepest discount we’ve observed. Frequency = number of promotion rows. JOOLA response is rule-based: deep discounts (>30%) get “match or differentiate”; flash sales get “counter with content”; bundles get “bundle response if margin allows”."
                source="promotions GROUP BY (brand_id, promo_type)"
              />
            </h2>
            <div className="sub">Rule-based JOOLA counter-move per competitor offer type.</div>
          </div>
        </div>
        <div className="card">
          <div style={{ padding: '10px 16px', fontSize: 11, color: '#F5E625', background: 'rgba(245,182,37,0.08)', borderBottom: '1px solid rgba(245,182,37,0.25)' }}>
            <strong>Caveat:</strong> the promotions table has no <code>start_date</code> / <code>end_date</code> columns — promo windows are inferred from <code>detected_at</code> only. “Last detected” is the most recent scrape that surfaced this promo, not the campaign end.
          </div>
          <div className="table-wrap" style={{ maxHeight: 480, overflowY: 'auto' }}>
            <table className="data" style={{ width: '100%', minWidth: 980 }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--sticky-bg)', zIndex: 2 }}>
                <tr>
                  <th style={{ textAlign: 'left' }}>Brand</th>
                  <th style={{ textAlign: 'center' }}>Promo type</th>
                  <th style={{ textAlign: 'right' }}>Discount depth</th>
                  <th style={{ textAlign: 'right' }}>Frequency</th>
                  <th style={{ textAlign: 'right' }}>Last detected</th>
                  <th style={{ textAlign: 'left' }}>Product affected</th>
                  <th style={{ textAlign: 'left' }}>JOOLA response</th>
                </tr>
              </thead>
              <tbody>
                {offerPlaybook.length === 0 && (
                  <tr><td colSpan={7} style={emptyCell}>No promotions to play-book in the active filter.</td></tr>
                )}
                {offerPlaybook.map((r, i) => (
                  <tr key={`${r.brand}-${r.promoType}-${i}`} style={{ ...(r.brand === 'joola' ? { borderLeft: '3px solid #22c55e', background: 'rgba(34,197,94,0.04)' } : {}), cursor: 'pointer' }} onClick={() => setDrillPlaybook(r)}>
                    <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 99, background: pgColor(r.brand) }} />
                        <span style={{ fontWeight: 600, color: r.brand === 'joola' ? '#22c55e' : 'inherit' }}>{name(r.brand)}</span>
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}><span className="pill pill-ghost" style={{ fontSize: 10 }}>{r.promoType}</span></td>
                    <td style={{ textAlign: 'right', color: r.discountDepth && r.discountDepth > 0 ? '#F5E625' : 'inherit', fontWeight: r.discountDepth ? 700 : 400 }}>
                      {r.discountDepth != null && r.discountDepth > 0 ? `${r.discountDepth}%` : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>{fmt(r.frequency)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'JetBrains Mono', fontSize: 11 }}>{r.lastDetected ? formatCalendarDate(r.lastDetected) : '—'}</td>
                    <td style={{ textAlign: 'left', color: '#6b7280', fontSize: 11 }}>{r.productAffected || '— (no product FK)'}</td>
                    <td style={{ textAlign: 'left', fontSize: 12 }}>{r.joolaResponse}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ─── Section C: Creative Message Intelligence ────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Creative message intelligence
              <SectionInfo
                title="Creative message intelligence"
                description="Ad copy is classified into themes by rule-based regex matching (no LLM call). Themes: Performance/control, Power, Sale/discount, Pro endorsement, New launch, Beginner-friendly, Tournament/PPA. First matching theme wins so totals are additive. Use to see what messages competitors are testing this window."
                source="marketing_ads.body · regex classifier"
              />
            </h2>
            <div className="sub">Rule-based theme classifier across all active ad creatives.</div>
          </div>
        </div>
        <div className="two-col">
          <div className="card" style={{ padding: 16 }}>
            <h6 style={{ marginTop: 0 }}>Themes × brands</h6>
            <MessageThemeBarChart rows={messageThemeData.rows} name={name} />
          </div>
          <div className="card" style={{ padding: 16 }}>
            <h6 style={{ marginTop: 0 }}>Theme details</h6>
            <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
              <table className="data" style={{ width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--sticky-bg)', zIndex: 2 }}>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Brand</th>
                    <th style={{ textAlign: 'left' }}>Theme</th>
                    <th style={{ textAlign: 'center' }}>CTA</th>
                    <th style={{ textAlign: 'center' }}>Platform</th>
                    <th style={{ textAlign: 'right' }}>Count</th>
                    <th style={{ textAlign: 'left' }}>Example</th>
                  </tr>
                </thead>
                <tbody>
                  {messageThemeData.rows.length === 0 && (
                    <tr><td colSpan={6} style={emptyCell}>No ad copy in the active filter.</td></tr>
                  )}
                  {messageThemeData.rows.slice(0, 100).map((r, i) => (
                    <tr key={`${r.brand}-${r.theme}-${i}`} style={r.brand === 'joola' ? { borderLeft: '3px solid #22c55e', background: 'rgba(34,197,94,0.04)' } : {}}>
                      <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 6, height: 6, borderRadius: 99, background: pgColor(r.brand) }} />
                          <span style={{ fontWeight: 600, color: r.brand === 'joola' ? '#22c55e' : 'inherit' }}>{name(r.brand)}</span>
                        </span>
                      </td>
                      <td style={{ textAlign: 'left', fontSize: 12 }}>{r.themeLabel}</td>
                      <td style={{ textAlign: 'center' }}><span className="pill pill-ghost" style={{ fontSize: 10 }}>{r.cta}</span></td>
                      <td style={{ textAlign: 'center' }}><span className="pill pill-ghost" style={{ fontSize: 10 }}>{r.platform}</span></td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(r.count)}</td>
                      <td style={{ textAlign: 'left', fontSize: 11, color: '#cbd1dc', maxWidth: 240 }}>
                        <span title={r.exampleCopy} style={{ display: 'inline-block', maxWidth: 230, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.exampleCopy || '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Section 9: Review required ───────────────────────────── */}
      {(!data.dataStatus.hasAds || !data.dataStatus.hasPromos || !data.dataStatus.hasPlatform) && (
        <section>
          <div className="card" style={{ padding: 16 }}>
            <h6 style={{ marginTop: 0, color: '#F5E625' }}>Review required</h6>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--fg-2)', fontSize: 12, lineHeight: 1.7 }}>
              {!data.dataStatus.hasAds && (
                <li>
                  <strong>No ads in the active window</strong> — marketing_ads is empty for this filter. Verify the Apify
                  Meta + Google scrapers have run recently.
                </li>
              )}
              {!data.dataStatus.hasPromos && (
                <li>
                  <strong>No promotions in the active window</strong> — promotions table is empty for this filter. Verify
                  the homepage scraper has run.
                </li>
              )}
              {!data.dataStatus.hasPlatform && data.dataStatus.hasAds && (
                <li>
                  <strong>Platform column is empty</strong> — ads are present but platform field is missing. Check the
                  marketing_ads.platform population step.
                </li>
              )}
              {!data.dataStatus.hasSourceUrl && data.dataStatus.hasAds && (
                <li>
                  <strong>Source URLs missing</strong> — ad creatives load without landing_url or creative_url. Source
                  links fall back to a Meta Ads Library search.
                </li>
              )}
            </ul>
          </div>
        </section>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────

function SummaryItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', minWidth: 100 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 800, color: color || '#fff', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )
}

function CampaignTrendChart({ points, name }: { points: ActivityTrendPoint[]; name: (s: string) => string }) {
  const [tab, setTab] = useState<'bar' | 'heatmap' | 'sparkline'>('bar')
  const [hovBrand, setHovBrand] = useState<string | null>(null)

  const brandTotals = new Map<string, number>()
  for (const p of points) {
    for (const [b, v] of Object.entries(p.perBrandAds)) {
      brandTotals.set(b, (brandTotals.get(b) || 0) + v)
    }
  }
  const brands = Array.from(brandTotals.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const maxTotal = Math.max(1, ...brands.map(([, v]) => v))
  const totalAll = brands.reduce((s, [, v]) => s + v, 0)

  if (brands.length === 0) {
    return <div style={{ color: '#6b7280', fontSize: 13, padding: '32px 0', textAlign: 'center' }}>No ad activity in the window.</div>
  }

  const TABS = [
    { key: 'bar', label: 'Ranked Bars' },
    { key: 'heatmap', label: 'Activity Heatmap' },
    { key: 'sparkline', label: 'Sparklines' },
  ] as const

  return (
    <div>
      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            background: tab === t.key ? 'var(--wb-8)' : 'none',
            border: `1px solid ${tab === t.key ? 'var(--wb-14)' : 'var(--line)'}`,
            color: tab === t.key ? '#fff' : '#6b7280',
            borderRadius: 6, padding: '5px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 150ms',
          }}>{t.label}</button>
        ))}
      </div>

      {/* ─── Option A: Ranked horizontal bars ─────────────────── */}
      {tab === 'bar' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {brands.map(([b, total], idx) => {
            const color = pgColor(b), isJ = b === 'joola', isHov = hovBrand === b
            const pct = Math.round((total / totalAll) * 100)
            return (
              <div key={b} onMouseEnter={() => setHovBrand(b)} onMouseLeave={() => setHovBrand(null)}
                style={{ display: 'grid', gridTemplateColumns: '160px 1fr 52px 44px', alignItems: 'center', gap: 12,
                  opacity: hovBrand && !isHov ? 0.4 : 1, transition: 'opacity 150ms' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, color: '#4b5563', fontWeight: 700, minWidth: 14, textAlign: 'right' }}>#{idx + 1}</span>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, boxShadow: isHov ? `0 0 6px ${color}` : 'none', transition: 'box-shadow 150ms' }} />
                  <span style={{ fontSize: 13, fontWeight: isJ ? 800 : 600, color: isJ ? '#22c55e' : '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name(b)}</span>
                </div>
                <div style={{ height: 10, background: 'var(--wb-6)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(total / maxTotal) * 100}%`,
                    background: isHov ? `linear-gradient(90deg, ${color}, ${color}cc)` : `linear-gradient(90deg, ${color}cc, ${color}66)`,
                    borderRadius: 99, transition: 'width 400ms cubic-bezier(0.16,1,0.3,1), background 150ms',
                    boxShadow: isHov ? `0 0 8px ${color}88` : 'none' }} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{total}</span>
                <span style={{ fontSize: 11, color: isHov ? color : '#6b7280', textAlign: 'right', fontWeight: 600, transition: 'color 150ms' }}>{pct}%</span>
              </div>
            )
          })}
          <div style={{ marginTop: 4, fontSize: 11, color: '#4b5563', borderTop: '1px solid var(--wb-6)', paddingTop: 8 }}>
            {brands.length} brands · {totalAll} total ads · hover to highlight
          </div>
        </div>
      )}

      {/* ─── Option B: Activity heatmap ───────────────────────── */}
      {tab === 'heatmap' && (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: `140px repeat(${points.length}, 1fr)`, gap: 3, minWidth: 600 }}>
            {/* Header row */}
            <div style={{ fontSize: 10, color: '#4b5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', alignSelf: 'center' }}>Brand</div>
            {points.map((p) => (
              <div key={p.weekLabel} style={{ fontSize: 9, color: '#6b7280', textAlign: 'center', paddingBottom: 4 }}>{p.weekLabel}</div>
            ))}
            {/* Brand rows */}
            {brands.map(([b]) => {
              const color = pgColor(b), isJ = b === 'joola'
              const weekMax = Math.max(1, ...points.map(p => p.perBrandAds[b] || 0))
              return [
                <div key={`lbl-${b}`} style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: isJ ? 800 : 500, color: isJ ? '#22c55e' : '#cbd1dc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name(b)}</span>
                </div>,
                ...points.map((p) => {
                  const val = p.perBrandAds[b] || 0
                  const intensity = val / weekMax
                  return (
                    <div key={`${b}-${p.weekLabel}`}
                      title={`${name(b)} · ${p.weekLabel}: ${val} ads`}
                      style={{ height: 32, borderRadius: 4, cursor: 'default',
                        background: val === 0 ? 'var(--line-2)' : color,
                        opacity: val === 0 ? 1 : Math.max(0.18, intensity),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'opacity 150ms' }}>
                      {val > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>{val}</span>}
                    </div>
                  )
                }),
              ]
            })}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: '#4b5563' }}>Darker cell = more ads that week · hover cell for details</div>
        </div>
      )}

      {/* ─── Option C: Sparkline table ─────────────────────────── */}
      {tab === 'sparkline' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {brands.map(([b, total], idx) => {
            const color = pgColor(b), isJ = b === 'joola', isHov = hovBrand === b
            const vals = points.map(p => p.perBrandAds[b] || 0)
            const weekMax = Math.max(1, ...vals)
            const sparkW = 120, sparkH = 32
            const sparkX = (i: number) => (i / Math.max(1, vals.length - 1)) * sparkW
            const sparkY = (v: number) => sparkH - (v / weekMax) * sparkH * 0.9 - 2
            const sparkPath = vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${sparkX(i).toFixed(1)} ${sparkY(v).toFixed(1)}`).join(' ')
            const pct = Math.round((total / totalAll) * 100)
            return (
              <div key={b} onMouseEnter={() => setHovBrand(b)} onMouseLeave={() => setHovBrand(null)}
                style={{ display: 'grid', gridTemplateColumns: '28px 150px 56px 56px 130px', alignItems: 'center', gap: 12,
                  padding: '8px 0', borderBottom: '1px solid var(--wb-5)',
                  opacity: hovBrand && !isHov ? 0.4 : 1, transition: 'opacity 150ms' }}>
                <span style={{ fontSize: 10, color: '#4b5563', fontWeight: 700, textAlign: 'right' }}>#{idx + 1}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: isJ ? 800 : 600, color: isJ ? '#22c55e' : '#e2e8f0' }}>{name(b)}</span>
                </div>
                <span style={{ fontSize: 14, fontWeight: 800, color: '#fff', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{total}</span>
                <span style={{ fontSize: 11, color: '#6b7280', textAlign: 'right' }}>{pct}% share</span>
                <svg width={sparkW} height={sparkH} style={{ overflow: 'visible' }}>
                  <path d={sparkPath} fill="none" stroke={color} strokeWidth={isHov ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round"
                    style={{ filter: isHov ? `drop-shadow(0 0 4px ${color}88)` : 'none', transition: 'filter 150ms' }} />
                  {vals[vals.length - 1] > 0 && (
                    <circle cx={sparkX(vals.length - 1)} cy={sparkY(vals[vals.length - 1])} r={3} fill={color} />
                  )}
                </svg>
              </div>
            )
          })}
          <div style={{ marginTop: 8, fontSize: 11, color: '#4b5563' }}>
            Sparklines show weekly ad volume trend · latest value marked with dot
          </div>
        </div>
      )}
    </div>
  )
}

function PromoCadenceHeatmap({ rows, name }: { rows: PromoCadenceRow[]; name: (s: string) => string }) {
  if (rows.length === 0) {
    return <div style={{ color: '#6b7280', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>No promotions detected in the window.</div>
  }
  const weeks = rows[0]?.weeks.length || 13
  const display = rows.slice(0, 11)

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 12, minWidth: '100%' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#8a93a4', fontWeight: 600 }}>Brand</th>
            {Array.from({ length: weeks }).map((_, i) => (
              <th key={i} style={{ padding: '6px 6px', color: '#8a93a4', fontWeight: 600, textAlign: 'center', fontSize: 10 }}>W{i + 1}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {display.map((row) => (
            <tr key={row.brand}>
              <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: pgColor(row.brand), display: 'inline-block' }} />
                  <span style={{ color: '#fff', fontWeight: 600 }}>{name(row.brand)}</span>
                </span>
              </td>
              {row.weeks.map((v, i) => (
                <td
                  key={i}
                  style={{
                    padding: '4px 6px', textAlign: 'center',
                    background: v === 0 ? 'rgba(255,255,255,0.025)' : pgColor(row.brand) + 'AA',
                    color: v > 0 ? '#fff' : '#3a4150',
                    fontWeight: v > 0 ? 700 : 400,
                    borderRadius: 4,
                    cursor: 'help',
                  }}
                  title={`${name(row.brand)} · Week ${i + 1}: ${v > 0 ? 'Active promotion' : 'No promo'}`}
                >
                  {v > 0 ? '•' : ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AdsVsPromosScatter({ rows, name, onBubbleClick }: { rows: CampaignPressureStat[]; name: (s: string) => string; onBubbleClick: (r: CampaignPressureStat) => void }) {
  const w = 760
  const h = 380
  const padL = 60, padR = 30, padT = 30, padB = 52
  const innerW = w - padL - padR
  const innerH = h - padT - padB

  const xMax = Math.max(5, ...rows.map((r) => r.ads))
  const yMax = Math.max(3, ...rows.map((r) => r.promos))
  const xMid = xMax / 2
  const yMid = yMax / 2

  const x = (v: number) => padL + (Math.min(v, xMax) / xMax) * innerW
  const y = (v: number) => padT + innerH - (Math.min(v, yMax) / yMax) * innerH
  const maxDiscount = Math.max(1, ...rows.map((r) => r.avgDiscount))
  const radius = (d: number) => 5 + (d / maxDiscount) * 14

  const joola = rows.find((r) => r.brand === 'joola')

  if (rows.length === 0) {
    return <div style={{ color: '#6b7280', fontSize: 13, padding: '32px 0', textAlign: 'center' }}>No campaign activity in the window.</div>
  }

  return (
    <div className="scatter-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
        <rect x={padL} y={padT} width={x(xMid) - padL} height={y(yMid) - padT} fill="rgba(239,68,68,0.05)" />
        <rect x={x(xMid)} y={padT} width={padL + innerW - x(xMid)} height={y(yMid) - padT} fill="rgba(245,158,11,0.06)" />
        <rect x={padL} y={y(yMid)} width={x(xMid) - padL} height={padT + innerH - y(yMid)} fill="rgba(100,116,139,0.03)" />
        <rect x={x(xMid)} y={y(yMid)} width={padL + innerW - x(xMid)} height={padT + innerH - y(yMid)} fill="rgba(129,140,248,0.05)" />
        <line x1={x(xMid)} x2={x(xMid)} y1={padT} y2={padT + innerH} stroke="rgba(245,230,37,0.4)" strokeDasharray="4 3" strokeWidth="1.5" />
        <line x1={padL} x2={padL + innerW} y1={y(yMid)} y2={y(yMid)} stroke="rgba(245,230,37,0.4)" strokeDasharray="4 3" strokeWidth="1.5" />
        <text x={padL + (x(xMid) - padL) / 2} y={padT + 16} textAnchor="middle" style={{ fill: '#ef4444', fontSize: 10, fontWeight: 700 }}>DISCOUNT-FOCUSED</text>
        <text x={x(xMid) + (padL + innerW - x(xMid)) / 2} y={padT + 16} textAnchor="middle" style={{ fill: '#fb923c', fontSize: 10, fontWeight: 700 }}>BOTH LEVERS (HIGH PRESSURE)</text>
        <text x={padL + (x(xMid) - padL) / 2} y={padT + innerH - 8} textAnchor="middle" style={{ fill: '#64748b', fontSize: 10, fontWeight: 700 }}>QUIET</text>
        <text x={x(xMid) + (padL + innerW - x(xMid)) / 2} y={padT + innerH - 8} textAnchor="middle" style={{ fill: '#818cf8', fontSize: 10, fontWeight: 700 }}>PAID-FOCUSED</text>
        {[0, xMid, xMax].map((v, i) => (
          <text key={i} x={x(v)} y={h - 30} textAnchor="middle" style={{ fill: '#6b7280', fontSize: 10 }}>{Math.round(v)}</text>
        ))}
        <text x={padL + innerW / 2} y={h - 12} textAnchor="middle" style={{ fill: '#6b7280', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>ACTIVE ADS →</text>
        {[0, yMid, yMax].map((v, i) => (
          <text key={i} x={padL - 8} y={y(v) + 3} textAnchor="end" style={{ fill: '#6b7280', fontSize: 10 }}>{Math.round(v)}</text>
        ))}
        <text transform={`translate(14 ${padT + innerH / 2}) rotate(-90)`} textAnchor="middle" style={{ fill: '#6b7280', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>ACTIVE PROMOS →</text>
        {rows.map((r) => {
          const cx = x(r.ads)
          const cy = y(r.promos)
          const rad = radius(r.avgDiscount)
          const isJ = r.brand === 'joola'
          return (
            <g key={r.brand} style={{ cursor: 'pointer' }} onClick={() => onBubbleClick(r)}>
              <circle cx={cx} cy={cy} r={rad} fill={pgColor(r.brand)} opacity={isJ ? 0.95 : 0.6} stroke={isJ ? '#22c55e' : 'transparent'} strokeWidth={isJ ? 2 : 0}>
                <title>{`${name(r.brand)} · ${r.ads} ads · ${r.promos} promos · avg discount ${r.avgDiscount}% · Click for details`}</title>
              </circle>
              {isJ && (
                <text x={cx} y={cy - rad - 6} textAnchor="middle" style={{ fontWeight: 800, fill: '#22c55e', fontSize: 11, pointerEvents: 'none' }}>
                  {name(r.brand)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {!joola && (
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6, textAlign: 'center' }}>
          JOOLA has no ads or promos in the active window.
        </div>
      )}
    </div>
  )
}

// ─── Campaign Strategy Matrix (2×2 quadrant scatter) ──────────────────

const QUADRANT_LABEL: Record<CampaignStrategyQuadrant, string> = {
  'aggressive-growth': 'Aggressive growth push (high ads + high promos)',
  'brand-building': 'Brand-building / premium positioning (high ads + low promos)',
  'price-sensitive': 'Price-sensitive sales push (low ads + high promos)',
  'quiet': 'Quiet / low activity (low ads + low promos)',
}

const JOOLA_COUNTER: Record<CampaignStrategyQuadrant, string> = {
  'aggressive-growth': 'Don\'t match volume — focus paid spend on highest-ROAS channel and lean harder on Ben Johns + Anna Bright proof.',
  'brand-building': 'Hold price discipline; counter with athlete-led tournament content and reviewer outreach.',
  'price-sensitive': 'Resist discount war — bundle accessories or extend warranty instead of cutting flagship paddle pricing.',
  'quiet': 'Take share now — run a focused ad burst on flagship SKUs while competitors are dormant.',
}

function CampaignStrategyMatrixChart({ matrix, name, pressureStats, onBubbleClick }: { matrix: CampaignStrategyMatrix; name: (s: string) => string; pressureStats: CampaignPressureStat[]; onBubbleClick: (p: import('@/lib/v2/campaignOfferIntel').CampaignStrategyPoint, stat: CampaignPressureStat | null) => void }) {
  const w = 760
  const h = 400
  const padL = 60, padR = 30, padT = 30, padB = 52
  const innerW = w - padL - padR
  const innerH = h - padT - padB

  const xs = matrix.points.map((p) => p.adPressure)
  const ys = matrix.points.map((p) => p.promoPressure)
  const xMax = Math.max(1, ...xs)
  const yMax = Math.max(1, ...ys)
  const xMid = matrix.xMedian > 0 ? matrix.xMedian : xMax / 2
  const yMid = matrix.yMedian > 0 ? matrix.yMedian : yMax / 2

  const x = (v: number): number => padL + (Math.min(v, xMax) / xMax) * innerW
  const y = (v: number): number => padT + innerH - (Math.min(v, yMax) / yMax) * innerH
  const maxActivity = Math.max(1, ...matrix.points.map((p) => p.totalActivity))
  const radius = (v: number): number => 6 + (v / maxActivity) * 16

  const [hover, setHover] = useState<CampaignStrategyPoint | null>(null)

  const visiblePoints = matrix.points.filter((p) => p.adPressure > 0 || p.promoPressure > 0)
  if (visiblePoints.length === 0) {
    return <div style={{ color: '#6b7280', fontSize: 13, padding: '32px 0', textAlign: 'center' }}>No campaign signal to plot.</div>
  }

  return (
    <div className="scatter-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
        <rect x={padL} y={padT} width={x(xMid) - padL} height={y(yMid) - padT} fill="rgba(239,68,68,0.05)" />
        <rect x={x(xMid)} y={padT} width={padL + innerW - x(xMid)} height={y(yMid) - padT} fill="rgba(251,146,60,0.07)" />
        <rect x={padL} y={y(yMid)} width={x(xMid) - padL} height={padT + innerH - y(yMid)} fill="rgba(100,116,139,0.04)" />
        <rect x={x(xMid)} y={y(yMid)} width={padL + innerW - x(xMid)} height={padT + innerH - y(yMid)} fill="rgba(129,140,248,0.05)" />
        <line x1={x(xMid)} x2={x(xMid)} y1={padT} y2={padT + innerH} stroke="rgba(245,230,37,0.4)" strokeDasharray="4 3" strokeWidth="1.5" />
        <line x1={padL} x2={padL + innerW} y1={y(yMid)} y2={y(yMid)} stroke="rgba(245,230,37,0.4)" strokeDasharray="4 3" strokeWidth="1.5" />
        <text x={padL + (x(xMid) - padL) / 2} y={padT + 16} textAnchor="middle" style={{ fill: '#ef4444', fontSize: 10, fontWeight: 700 }}>PRICE-SENSITIVE SALES PUSH</text>
        <text x={x(xMid) + (padL + innerW - x(xMid)) / 2} y={padT + 16} textAnchor="middle" style={{ fill: '#fb923c', fontSize: 10, fontWeight: 700 }}>AGGRESSIVE GROWTH PUSH</text>
        <text x={padL + (x(xMid) - padL) / 2} y={padT + innerH - 8} textAnchor="middle" style={{ fill: '#64748b', fontSize: 10, fontWeight: 700 }}>QUIET / LOW ACTIVITY</text>
        <text x={x(xMid) + (padL + innerW - x(xMid)) / 2} y={padT + innerH - 8} textAnchor="middle" style={{ fill: '#818cf8', fontSize: 10, fontWeight: 700 }}>BRAND-BUILDING / PREMIUM</text>
        <text x={padL + innerW / 2} y={h - 12} textAnchor="middle" style={{ fill: '#6b7280', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>AD PRESSURE →</text>
        <text transform={`translate(14 ${padT + innerH / 2}) rotate(-90)`} textAnchor="middle" style={{ fill: '#6b7280', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>PROMO PRESSURE →</text>
        {visiblePoints.map((p) => {
          const cx = x(p.adPressure)
          const cy = y(p.promoPressure)
          const rad = radius(p.totalActivity)
          const isJ = p.brand === 'joola'
          const isHov = hover?.brand === p.brand
          return (
            <g key={p.brand} style={{ cursor: 'pointer' }} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} onClick={() => onBubbleClick(p, pressureStats.find(s => s.brand === p.brand) || null)}>
              <circle cx={cx} cy={cy} r={rad} fill={pgColor(p.brand)} opacity={isJ ? 0.95 : 0.6} stroke={isJ ? '#22c55e' : isHov ? '#fff' : 'transparent'} strokeWidth={isJ ? 2.5 : isHov ? 1.5 : 0}>
                <title>{`${name(p.brand)} · ad ${p.adPressure.toFixed(1)} · promo ${p.promoPressure.toFixed(1)} · ${QUADRANT_LABEL[p.quadrant]}`}</title>
              </circle>
              {(isJ || isHov) && (
                <text x={cx} y={cy - rad - 6} textAnchor="middle" style={{ fontWeight: 800, fill: isJ ? '#22c55e' : '#fff', fontSize: 11, pointerEvents: 'none' }}>
                  {name(p.brand)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ─── Message Theme Bar Chart (themes × brands stacked) ────────────────

function MessageThemeBarChart({ rows, name }: { rows: MessageThemeRow[]; name: (s: string) => string }) {
  const [hovTheme, setHovTheme] = useState<string | null>(null)
  const [hovBrand, setHovBrand] = useState<{ theme: string; brand: string; value: number } | null>(null)

  if (rows.length === 0) {
    return <div style={{ color: '#6b7280', fontSize: 13, padding: '32px 0', textAlign: 'center' }}>No themes to chart.</div>
  }

  const themeOrder = ['performance','power','sale','pro-endorsement','new-launch','beginner','tournament','other']
  const themeLabelMap: Record<string, string> = {
    'performance': 'Performance', 'power': 'Power', 'sale': 'Sale',
    'pro-endorsement': 'Pro Endorsement', 'new-launch': 'New Launch',
    'beginner': 'Beginner', 'tournament': 'Tournament', 'other': 'Other',
  }
  const byTheme = new Map<string, Map<string, number>>()
  for (const r of rows) {
    if (!byTheme.has(r.theme)) byTheme.set(r.theme, new Map())
    const m = byTheme.get(r.theme)!
    m.set(r.brand, (m.get(r.brand) || 0) + r.count)
  }
  const themes = themeOrder.filter(t => byTheme.has(t))
  const totalsByTheme = themes.map(t => Array.from(byTheme.get(t)!.values()).reduce((s, v) => s + v, 0))
  const maxTotal = Math.max(1, ...totalsByTheme)
  const allBrands = Array.from(new Set(rows.map(r => r.brand))).sort()

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {themes.map((t, idx) => {
          const m = byTheme.get(t)!
          const total = totalsByTheme[idx]
          const isHov = hovTheme === t
          const barW = (total / maxTotal) * 100
          return (
            <div key={t}
              onMouseEnter={() => setHovTheme(t)}
              onMouseLeave={() => { setHovTheme(null); setHovBrand(null) }}
              style={{ opacity: hovTheme && !isHov ? 0.45 : 1, transition: 'opacity 150ms' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: isHov ? 700 : 500, color: isHov ? '#fff' : '#cbd1dc', transition: 'color 150ms' }}>{themeLabelMap[t]}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{total}</span>
              </div>
              <div style={{ height: 28, background: 'var(--line-2)', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
                <div style={{ display: 'flex', height: '100%', width: `${barW}%`, transition: 'width 500ms cubic-bezier(0.16,1,0.3,1)', borderRadius: 6, overflow: 'hidden' }}>
                  {allBrands.map(b => {
                    const v = m.get(b) || 0
                    if (v === 0) return null
                    const segPct = (v / total) * 100
                    const isSegHov = hovBrand?.theme === t && hovBrand?.brand === b
                    return (
                      <div key={b}
                        onMouseEnter={e => { e.stopPropagation(); setHovBrand({ theme: t, brand: b, value: v }) }}
                        onMouseLeave={() => setHovBrand(null)}
                        title={`${name(b)}: ${v} ads`}
                        style={{
                          width: `${segPct}%`,
                          background: pgColor(b),
                          opacity: isSegHov ? 1 : b === 'joola' ? 0.9 : 0.65,
                          transition: 'opacity 120ms',
                          boxShadow: isSegHov ? `inset 0 0 0 1px rgba(255,255,255,0.4)` : 'none',
                          cursor: 'default',
                        }}
                      />
                    )
                  })}
                </div>
              </div>
              {hovBrand?.theme === t && (
                <div style={{ marginTop: 4, fontSize: 11, color: pgColor(hovBrand.brand), fontWeight: 600 }}>
                  {name(hovBrand.brand)}: {hovBrand.value} ads ({Math.round((hovBrand.value / total) * 100)}%)
                </div>
              )}
            </div>
          )
        })}
      </div>
      {/* Brand legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16, padding: '10px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid var(--wb-6)' }}>
        {allBrands.map(b => (
          <span key={b} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#94a3b8' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: pgColor(b), flexShrink: 0, opacity: b === 'joola' ? 1 : 0.75 }} />
            {name(b)}
          </span>
        ))}
      </div>
    </div>
  )
}


// ─── Scatter bubble detail dialog ────────────────────────────────────
function ScatterBubbleDialog({ row: r, brands, onClose }: {
  row: CampaignPressureStat; brands: import('@/lib/v2/data').V2Brand[]; onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const isJoola = r.brand === 'joola'
  const brandColor = pgColor(r.brand)
  const brandName = pgName(r.brand, brands)

  // Determine quadrant
  const highAds = r.adShare >= 50, highPromos = r.promoShare >= 50
  const quadrant = highAds && highPromos ? 'Both Levers (High Pressure)'
    : !highAds && highPromos ? 'Discount-Focused'
    : highAds && !highPromos ? 'Paid-Focused'
    : 'Quiet'
  const qColor = quadrant === 'Both Levers (High Pressure)' ? '#fb923c'
    : quadrant === 'Discount-Focused' ? '#ef4444'
    : quadrant === 'Paid-Focused' ? '#818cf8'
    : '#64748b'

  const QUADRANT_DESC: Record<string, string> = {
    'Both Levers (High Pressure)': 'This brand is spending heavily on both paid ads AND running active promotions. They are applying maximum competitive pressure — high risk for JOOLA if they are a direct competitor.',
    'Discount-Focused': 'High promotion activity but low paid ad spend. This brand is competing on price and deals rather than paid reach. Watch for price-sensitive customers being pulled away.',
    'Paid-Focused': 'High paid ad spend but few promotions. This brand is investing in brand awareness and paid reach without discounting. A sign of confidence in their product pricing.',
    'Quiet': 'Low activity on both paid ads and promotions. Either dormant, saving budget, or shifting to organic/athlete-led marketing.',
  }

  const metrics = [
    { label: 'Active ads', value: String(r.ads), color: '#818cf8', tip: 'Number of paid ad creatives currently running' },
    { label: 'Active promos', value: String(r.promos), color: '#ef4444', tip: 'Number of active discounts or promotional offers' },
    { label: 'Ad share', value: `${r.adShare.toFixed(1)}%`, color: '#60a5fa', tip: 'Share of total ads across all tracked brands' },
    { label: 'Promo share', value: `${r.promoShare.toFixed(1)}%`, color: '#f97316', tip: 'Share of total promos across all tracked brands' },
    { label: 'Avg discount', value: r.avgDiscount > 0 ? `${r.avgDiscount}%` : '—', color: '#F5E625', tip: 'Average % discount across active promotions' },
    { label: 'Pressure score', value: r.pressure.toFixed(1), color: r.pressure >= 50 ? '#ef4444' : r.pressure >= 25 ? '#F5E625' : '#22c55e', tip: 'Composite score 0–100: 50×(ads/max) + 50×(promos/max)' },
  ]

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={onClose}>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--wb-10)', borderRadius: 14, width: '100%', maxWidth: 540, boxShadow: '0 32px 80px rgba(0,0,0,0.8)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: isJoola ? '#22c55e' : brandColor, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: isJoola ? '#22c55e' : '#fff' }}>{brandName}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Campaign & Offer Activity</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: qColor + '22', color: qColor, border: `1px solid ${qColor}44` }}>{quadrant}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 22, cursor: 'pointer', lineHeight: 1, marginLeft: 4 }}>×</button>
        </div>

        {/* Quadrant explanation */}
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)', background: qColor + '08' }}>
          <div style={{ fontSize: 12, color: '#cbd1dc', lineHeight: 1.65 }}>{QUADRANT_DESC[quadrant]}</div>
        </div>

        {/* Metrics */}
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {metrics.map(m => (
            <div key={m.label} title={m.tip} style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', textAlign: 'center', cursor: 'help' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: m.value === '—' ? '#3a4150' : m.color, fontFamily: 'JetBrains Mono' }}>{m.value}</div>
              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 3 }}>{m.label}</div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 22px', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Ads vs Promotions Matrix</span>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Press Esc to close</span>
        </div>
      </div>
    </div>
  )
}
// ─── Offer / Promotion detail dialog ─────────────────────────────────
function OfferDetailDialog({ offer: p, brands, onClose }: {
  offer: ActiveOffer; brands: import('@/lib/v2/data').V2Brand[]; onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const isJoola = p.brand === 'joola'
  const brandColor = pgColor(p.brand)

  const TYPE_DESC: Record<string, string> = {
    DISCOUNT:      'A percentage or fixed-amount discount off the regular price.',
    FREE_SHIPPING: 'Free shipping offer — reduces purchase friction and incentivises larger basket sizes.',
    LAUNCH:        'New product launch promotion — typically an introductory offer or announcement.',
    BUNDLE:        'Bundle deal — multiple products sold together at a combined price.',
    OTHER:         'Other promotional content detected on the brand homepage or storefront.',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={onClose}>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--wb-10)', borderRadius: 14, width: '100%', maxWidth: 560, boxShadow: '0 32px 80px rgba(0,0,0,0.8)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: isJoola ? '#22c55e' : brandColor, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: isJoola ? '#22c55e' : '#fff' }}>{pgName(p.brand, brands)}</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Promotion · {p.type}</div>
          </div>
          <span className={'pill ' + (p.active ? 'pill-green' : 'pill-ghost')} style={{ fontSize: 10, fontWeight: 700 }}>{p.active ? 'ACTIVE' : 'INACTIVE'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 22, cursor: 'pointer', lineHeight: 1, marginLeft: 4 }}>×</button>
        </div>

        {/* Promo text */}
        <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Promotion Text</div>
          <div style={{ fontSize: 14, color: '#e2e8f0', lineHeight: 1.65, background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 16px', wordBreak: 'break-word' }}>
            {p.text || '(no text)'}
          </div>
        </div>

        {/* Type explanation */}
        <div style={{ padding: '12px 22px', borderBottom: '1px solid var(--line)', background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
            <b style={{ color: '#cbd1dc' }}>{p.type}</b> — {TYPE_DESC[p.type] || 'Promotional content detected on the brand storefront.'}
          </div>
        </div>

        {/* Meta grid */}
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {[
            { label: 'Discount', value: p.discount != null && p.discount > 0 ? `${p.discount}%` : '—', color: p.discount ? '#F5E625' : '#3a4150' },
            { label: 'Detected', value: p.detectedAt ? formatCalendarDate(p.detectedAt) : '—', color: '#94a3b8' },
            { label: 'Status', value: p.active ? 'Active' : 'Inactive', color: p.active ? '#22c55e' : '#6b7280' },
          ].map(m => (
            <div key={m.label} style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: m.color, fontFamily: 'JetBrains Mono' }}>{m.value}</div>
              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 3 }}>{m.label}</div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Press Esc to close</span>
          {p.sourceUrl
            ? <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa', textDecoration: 'none', padding: '5px 14px', border: '1px solid rgba(96,165,250,0.3)', borderRadius: 6, background: 'rgba(96,165,250,0.08)' }}>
                View source →
              </a>
            : <span style={{ fontSize: 11, color: '#3a4150' }}>No source URL</span>}
        </div>
      </div>
    </div>
  )
}
// ─── Ad Creative detail dialog ────────────────────────────────────────
function AdCreativeDialog({ ad: a, brands, onClose }: {
  ad: AdCreative; brands: import('@/lib/v2/data').V2Brand[]; onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const isJoola = a.brand === 'joola'
  const brandColor = pgColor(a.brand)
  const platColor = a.rawPlatform === 'meta' ? '#1877f2' : a.rawPlatform === 'google' ? '#fbbc05' : '#6b7280'

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={onClose}>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--wb-10)', borderRadius: 14, width: '100%', maxWidth: 560, boxShadow: '0 32px 80px rgba(0,0,0,0.8)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: isJoola ? '#22c55e' : brandColor, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: isJoola ? '#22c55e' : '#fff' }}>{pgName(a.brand, brands)}</div>
            {a.pageName && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{a.pageName}</div>}
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: platColor + '22', color: platColor, border: `1px solid ${platColor}44` }}>{a.platform}</span>
          <span className={'pill ' + (a.active ? 'pill-green' : 'pill-ghost')} style={{ fontSize: 10, fontWeight: 700 }}>{a.active ? 'ACTIVE' : 'ENDED'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 22, cursor: 'pointer', lineHeight: 1, marginLeft: 4 }}>×</button>
        </div>

        {/* Ad copy */}
        <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Ad Copy</div>
          {a.copy
            ? <div style={{ fontSize: 14, color: '#e2e8f0', lineHeight: 1.65, background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 16px', wordBreak: 'break-word' }}>{a.copy}</div>
            : <div style={{ fontSize: 12, color: '#4b5563', fontStyle: 'italic' }}>No copy available — {a.rawPlatform === 'google' ? 'Google Ads Transparency does not expose ad text.' : 'Ad copy not scraped for this creative.'}</div>}
        </div>

        {/* CTA + creative image */}
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)', display: 'grid', gridTemplateColumns: a.creativeUrl ? '1fr 1fr' : '1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Call to Action</div>
            {a.cta
              ? <span className="pill pill-ghost" style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px' }}>{a.cta}</span>
              : <span style={{ fontSize: 12, color: '#4b5563' }}>—</span>}
          </div>
          {a.creativeUrl && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Creative</div>
              <img src={a.creativeUrl} alt="Ad creative" style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 6, border: '1px solid var(--wb-10)', objectFit: 'contain' }} onError={e => (e.currentTarget.style.display = 'none')} />
            </div>
          )}
        </div>

        {/* Meta row */}
        <div style={{ padding: '12px 22px', borderBottom: '1px solid var(--line)', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {[
            { label: 'First seen', value: a.startedAt ? formatCalendarDate(a.startedAt) : '—' },
            { label: 'Platform', value: a.platform },
          ].map(m => (
            <div key={m.label} style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 14px' }}>
              <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 3 }}>{m.label}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{m.value}</div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Press Esc to close</span>
          {a.sourceUrl
            ? <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa', textDecoration: 'none', padding: '5px 14px', border: '1px solid rgba(96,165,250,0.3)', borderRadius: 6, background: 'rgba(96,165,250,0.08)' }}>
                View in Ad Library →
              </a>
            : <span style={{ fontSize: 11, color: '#3a4150' }}>No source URL</span>}
        </div>
      </div>
    </div>
  )
}
// ─── Strategy Matrix bubble detail dialog ────────────────────────────
function StrategyBubbleDialog({ point: p, stat, brands, onClose }: {
  point: import('@/lib/v2/campaignOfferIntel').CampaignStrategyPoint
  stat: CampaignPressureStat | null
  brands: import('@/lib/v2/data').V2Brand[]
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const isJoola = p.brand === 'joola'
  const brandColor = pgColor(p.brand)

  const QUADRANT_COLOR: Record<string, string> = {
    'aggressive-growth': '#fb923c',
    'brand-building':    '#818cf8',
    'price-sensitive':   '#ef4444',
    'quiet':             '#64748b',
  }
  const QUADRANT_DESC: Record<string, string> = {
    'aggressive-growth': 'This brand is pushing hard on both paid ads and promotions simultaneously. Maximum competitive pressure — they are spending to grow market share quickly.',
    'brand-building':    'High paid ad spend but few promotions. This brand is investing in reach and awareness while holding price integrity. A sign of confidence in their product value.',
    'price-sensitive':   'High promotion activity but low paid ads. This brand is competing on price and discounts rather than paid reach. Watch for price-sensitive customers being attracted.',
    'quiet':             'Low activity on both axes. Either conserving budget, shifting to organic/athlete marketing, or simply not active in this window.',
  }

  const qColor = QUADRANT_COLOR[p.quadrant] || '#6b7280'
  const qDesc = QUADRANT_DESC[p.quadrant] || ''
  const joolaCounter = JOOLA_COUNTER[p.quadrant] || ''

  const metrics = [
    { label: 'Ad pressure',    value: p.adPressure.toFixed(1),                                     color: '#818cf8',  tip: 'Normalised paid advertising pressure score — ad volume relative to all brands' },
    { label: 'Promo pressure', value: p.promoPressure.toFixed(1),                                  color: '#ef4444',  tip: 'Normalised promotional pressure score — promo frequency and depth relative to all brands' },
    { label: 'Total activity', value: String(p.totalActivity),                                      color: '#F5E625',  tip: 'Combined ad + promo activity count used to size the bubble' },
    { label: 'Active ads',     value: stat ? String(stat.ads) : '—',                               color: '#60a5fa',  tip: 'Number of paid ad creatives currently running' },
    { label: 'Active promos',  value: stat ? String(stat.promos) : '—',                            color: '#f97316',  tip: 'Number of active discount or promotional offers' },
    { label: 'Avg discount',   value: stat && stat.avgDiscount > 0 ? `${stat.avgDiscount}%` : '—', color: '#F5E625',  tip: 'Average % discount across all active promotions' },
    { label: 'Ad share',       value: stat ? `${stat.adShare.toFixed(1)}%` : '—',                  color: '#a78bfa',  tip: 'This brand share of all tracked paid ads' },
    { label: 'Promo share',    value: stat ? `${stat.promoShare.toFixed(1)}%` : '—',               color: '#fb923c',  tip: 'This brand share of all tracked promotions' },
    { label: 'Pressure score', value: stat ? stat.pressure.toFixed(1) : '—',                       color: stat && stat.pressure >= 50 ? '#ef4444' : stat && stat.pressure >= 25 ? '#F5E625' : '#22c55e', tip: 'Composite 0–100 score: 50×(ads/max) + 50×(promos/max). Higher = more competitive pressure.' },
  ]

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={onClose}>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--wb-10)', borderRadius: 14, width: '100%', maxWidth: 540, boxShadow: '0 32px 80px rgba(0,0,0,0.8)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: isJoola ? '#22c55e' : brandColor, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: isJoola ? '#22c55e' : '#fff' }}>{pgName(p.brand, brands)}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Campaign Strategy Position</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: qColor + '22', color: qColor, border: `1px solid ${qColor}44`, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {QUADRANT_LABEL[p.quadrant]?.split('(')[0].trim()}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 22, cursor: 'pointer', lineHeight: 1, marginLeft: 4 }}>×</button>
        </div>

        {/* Quadrant description */}
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)', background: qColor + '08' }}>
          <div style={{ fontSize: 12, color: '#cbd1dc', lineHeight: 1.65 }}>{qDesc}</div>
        </div>

        {/* Metrics */}
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 8 }}>
            {metrics.slice(0, 3).map(m => (
              <div key={m.label} title={m.tip} style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', textAlign: 'center', cursor: 'help' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: m.value === '—' ? '#3a4150' : m.color, fontFamily: 'JetBrains Mono' }}>{m.value}</div>
                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 3 }}>{m.label}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {metrics.slice(3).map(m => (
              <div key={m.label} title={m.tip} style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', textAlign: 'center', cursor: 'help' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: m.value === '—' ? '#3a4150' : m.color, fontFamily: 'JetBrains Mono' }}>{m.value}</div>
                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 3 }}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* JOOLA counter-strategy (if not JOOLA itself) */}
        {!isJoola && joolaCounter && (
          <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)', background: 'rgba(34,197,94,0.05)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>JOOLA Counter-Strategy</div>
            <div style={{ fontSize: 12, color: '#cbd1dc', lineHeight: 1.6 }}>{joolaCounter}</div>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '10px 22px', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Campaign Strategy Matrix</span>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Press Esc to close</span>
        </div>
      </div>
    </div>
  )
}
// ─── Competitor Offer Playbook row detail dialog ──────────────────────
function PlaybookRowDialog({ row: r, brands, onClose }: {
  row: OfferPlaybookRow; brands: import('@/lib/v2/data').V2Brand[]; onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const isJoola = r.brand === 'joola'
  const brandColor = pgColor(r.brand)

  const TYPE_EXPLAIN: Record<string, string> = {
    DISCOUNT:      'A price reduction — either a flat dollar amount or percentage off. Signals willingness to compete on price.',
    FREE_SHIPPING: 'Removes shipping cost to lower purchase barrier. Common tactic to increase conversion without cutting paddle price.',
    LAUNCH:        'New product introduction — often paired with early-bird pricing or a limited-time offer.',
    BUNDLE:        'Multiple products sold together at a lower combined price. Aims to increase average order value.',
    GENERAL:       'General promotional content — banners or messaging without a specific discount or type.',
    OTHER:         'Other promotion type detected on the brand storefront.',
  }

  const RESPONSE_EXPLAIN: Record<string, string> = {
    'Monitor only': 'This promotion does not require an immediate JOOLA counter. Keep it on the watchlist but hold your pricing strategy.',
    'Match selectively': 'Consider matching on a non-flagship SKU or with an accessory bundle to neutralise without degrading flagship value.',
    'No discount needed': 'JOOLA value messaging and athlete proof is stronger than a direct price match. Lean on quality differentiation.',
    'Match free-shipping': 'Quietly match the free shipping threshold — customers expect it, and not offering it is a competitive disadvantage.',
  }

  const responseKey = Object.keys(RESPONSE_EXPLAIN).find(k => r.joolaResponse.startsWith(k)) || ''
  const responseExplain = RESPONSE_EXPLAIN[responseKey] || ''

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={onClose}>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--wb-10)', borderRadius: 14, width: '100%', maxWidth: 560, boxShadow: '0 32px 80px rgba(0,0,0,0.8)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: isJoola ? '#22c55e' : brandColor, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: isJoola ? '#22c55e' : '#fff' }}>{pgName(r.brand, brands)}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Competitor Offer Playbook</div>
          </div>
          <span className="pill pill-ghost" style={{ fontSize: 11, fontWeight: 700 }}>{r.promoType}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 22, cursor: 'pointer', lineHeight: 1, marginLeft: 4 }}>×</button>
        </div>

        {/* Promo type explanation */}
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)', background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>What this promo type means</div>
          <div style={{ fontSize: 12, color: '#cbd1dc', lineHeight: 1.65 }}>{TYPE_EXPLAIN[r.promoType] || 'Promotional activity detected on this brand storefront.'}</div>
        </div>

        {/* Metrics */}
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {[
            { label: 'Discount depth', value: r.discountDepth && r.discountDepth > 0 ? `${r.discountDepth}%` : '—', color: r.discountDepth ? '#F5E625' : '#3a4150', tip: 'Average % discount across promotions of this type from this brand' },
            { label: 'Frequency', value: String(r.frequency), color: '#60a5fa', tip: 'Number of times this promo type was detected across all scrapes' },
            { label: 'Last detected', value: r.lastDetected ? formatCalendarDate(r.lastDetected) : '—', color: '#94a3b8', tip: 'Most recent scrape that surfaced this promotion' },
          ].map(m => (
            <div key={m.label} title={m.tip} style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', textAlign: 'center', cursor: 'help' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: m.value === '—' ? '#3a4150' : m.color, fontFamily: 'JetBrains Mono' }}>{m.value}</div>
              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 3 }}>{m.label}</div>
            </div>
          ))}
        </div>

        {/* Product affected */}
        <div style={{ padding: '12px 22px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Product Affected</div>
          <div style={{ fontSize: 13, color: r.productAffected ? '#e2e8f0' : '#4b5563' }}>
            {r.productAffected || 'No specific product linked — promotion applies to the full storefront or product was not matched in the catalog.'}
          </div>
        </div>

        {/* JOOLA Response */}
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)', background: 'rgba(34,197,94,0.05)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Recommended JOOLA Response</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: responseExplain ? 6 : 0 }}>{r.joolaResponse}</div>
          {responseExplain && <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>{responseExplain}</div>}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 22px', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Competitor Offer Playbook</span>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Press Esc to close</span>
        </div>
      </div>
    </div>
  )
}