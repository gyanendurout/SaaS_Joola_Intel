'use client'

import { useEffect, useMemo, useState } from 'react'
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
  const [data, setData] = useState<CampaignOfferIntelData | null>(null)
  const [matrix, setMatrix] = useState<CampaignStrategyMatrix | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  // ─── Early returns ──────────────────────────────────────────────────
  if (loading) return <LoadingPage />

  if (error || !data) return (
    <div style={{ padding: '80px 32px', textAlign: 'center' }}>
      <div style={{ color: '#ef4444', fontSize: 14, marginBottom: 16 }}>{error || 'Unable to load Campaign & Offer Intel.'}</div>
      <button className="btn btn-yellow" onClick={() => window.location.reload()}>Refresh page</button>
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
    <>
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
          <SummaryItem label="Active ads" value={fmt(activeAds)} />
          <SummaryItem label="Active promos" value={fmt(activePromos)} />
          <SummaryItem label="Brands advertising" value={fmt(brandsAdvertising)} />
          <SummaryItem label="Brands discounting" value={fmt(brandsDiscounting)} />
          <SummaryItem label="JOOLA ad share" value={`${joolaAdShare.toFixed(1)}%`} color="#22c55e" />
          <SummaryItem label="JOOLA promos" value={fmt(joolaPromo?.count || 0)} color={(joolaPromo?.count || 0) === 0 ? '#ef4444' : '#22c55e'} />
          <SummaryItem
            label="Top ad brand"
            value={topAdBrand ? name(topAdBrand.brand) : '—'}
            color={topAdBrand ? pgColor(topAdBrand.brand) : undefined}
          />
          <SummaryItem
            label="Top promo brand"
            value={topPromoBrand ? name(topPromoBrand.brand) : '—'}
            color={topPromoBrand ? pgColor(topPromoBrand.brand) : undefined}
          />
          <SummaryItem label="Avg discount" value={avgDiscountAll > 0 ? `${avgDiscountAll}%` : '—'} />
        </div>

        <div className="kpi-grid" style={{ marginBottom: 6 }}>
          <MiniKpi
            label="Active ads (filter)"
            value={fmt(activeAds)}
            color="#f59e0b"
            customVs={`${totalAds} total in window`}
            src="marketing_ads"
            tip="Number of paddle-brand ads currently running in the selected window after applying the active filters. Source: Meta Ad Library + Google Ads Transparency scrape -> marketing_ads table."
          />
          <MiniKpi
            label="Active promos (filter)"
            value={fmt(activePromos)}
            color="#ef4444"
            customVs={`${totalPromos} total in window`}
            src="promotions"
            tip="Number of homepage / banner / email promotions detected across the 11 brands' own websites in the active window. Source: brand homepage scrape -> promotions table."
          />
          <MiniKpi
            label="JOOLA ad share"
            value={`${joolaAdShare.toFixed(1)}%`}
            color="#22c55e"
            customVs={joolaAd ? `${joolaAd.total} ads · #${joolaAdRank} rank` : '—'}
            flavor="joola"
            tip="JOOLA's share of all paid ad creatives running across the 11 brands. Formula: JOOLA active ads ÷ total active ads × 100. Rank shows JOOLA's position vs the other 10 brands."
          />
          <MiniKpi
            label="Avg discount"
            value={avgDiscountAll > 0 ? `${avgDiscountAll}%` : '—'}
            color="#818cf8"
            customVs={`${brandsDiscounting} brands discounting`}
            tip="Average % off across all active promotions in the window. High value = aggressive discounting environment. The 'brands discounting' count tells you how many of the 11 brands are running promos right now."
          />
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
        <div className="card" style={{ overflowX: 'auto' }}>
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
                  <tr key={r.brand} style={isJoola ? { borderLeft: '3px solid #22c55e', background: 'rgba(34,197,94,0.04)' } : {}}>
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
                        <div style={{ width: 80, height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
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
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
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
        <div className="card" style={{ padding: 16 }}>
          <AdsVsPromosScatter rows={recomputedPressure} name={name} />
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
              <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
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
                  <tr key={p.id} style={p.brand === 'joola' ? { borderLeft: '3px solid #22c55e', background: 'rgba(34,197,94,0.04)' } : {}}>
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
              <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
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
                  <tr key={a.id} style={a.brand === 'joola' ? { borderLeft: '3px solid #22c55e', background: 'rgba(34,197,94,0.04)' } : {}}>
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
            <CampaignStrategyMatrixChart matrix={matrix} name={name} />
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
              <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
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
                  <tr key={`${r.brand}-${r.promoType}-${i}`} style={r.brand === 'joola' ? { borderLeft: '3px solid #22c55e', background: 'rgba(34,197,94,0.04)' } : {}}>
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
                <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
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
    </>
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
  const w = 920
  const h = 240
  const padL = 36
  const padR = 110
  const padT = 14
  const padB = 28

  // Aggregate per-brand totals across all weeks to pick top series
  const brandTotals = new Map<string, number>()
  for (const p of points) {
    for (const [b, v] of Object.entries(p.perBrandAds)) {
      brandTotals.set(b, (brandTotals.get(b) || 0) + v)
    }
  }
  const topBrands = Array.from(brandTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([b]) => b)

  if (points.length === 0 || topBrands.length === 0) {
    return <div style={{ color: '#6b7280', fontSize: 13, padding: '32px 0', textAlign: 'center' }}>No ad activity in the window.</div>
  }

  // Stacked totals per week (using top brands only)
  const stackTotals = points.map((p) => topBrands.reduce((s, b) => s + (p.perBrandAds[b] || 0), 0))
  const max = Math.max(1, ...stackTotals)
  const N = points.length
  const x = (i: number) => padL + (i / Math.max(1, N - 1)) * (w - padL - padR)
  const y = (v: number) => padT + (h - padT - padB) * (1 - v / max)

  // Build stacked paths (bottom-up)
  let stacks: { brand: string; color: string; path: string }[] = []
  const prevTop = points.map(() => 0)
  for (const b of topBrands) {
    const color = pgColor(b)
    const top: number[] = []
    const bot: number[] = prevTop.slice()
    for (let i = 0; i < N; i++) {
      top.push(prevTop[i] + (points[i].perBrandAds[b] || 0))
    }
    const upper = top.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
    const lower = bot.slice().reverse().map((v, i) => `L ${x(N - 1 - i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
    stacks.push({ brand: b, color, path: `${upper} ${lower} Z` })
    for (let i = 0; i < N; i++) prevTop[i] = top[i]
  }

  const lastTotals = topBrands.map((b) => ({ brand: b, total: brandTotals.get(b) || 0, color: pgColor(b) }))

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
        {[0, Math.ceil(max / 2), max].map((tick) => (
          <g key={tick}>
            <line x1={padL} x2={w - padR} y1={y(tick)} y2={y(tick)} stroke="rgba(255,255,255,0.06)" strokeDasharray="2 4" />
            <text x={padL - 6} y={y(tick) + 3} textAnchor="end" fontSize={10} fill="#6b7280">{tick}</text>
          </g>
        ))}
        {stacks.map((s) => (
          <path key={s.brand} d={s.path} fill={s.color} opacity={s.brand === 'joola' ? 0.85 : 0.55} stroke={s.color} strokeWidth={0.8} />
        ))}
        {[0, Math.floor(N / 2), N - 1].map((i) =>
          points[i] ? (
            <text key={i} x={x(i)} y={h - padB + 16} textAnchor="middle" fontSize={10} fill="#6b7280">
              {points[i].weekLabel}
            </text>
          ) : null,
        )}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10, fontSize: 11 }}>
        {lastTotals.map((b) => (
          <span key={b.brand} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, background: b.color, borderRadius: 2, opacity: b.brand === 'joola' ? 0.95 : 0.7 }} />
            <span style={{ color: '#cbd1dc' }}>{name(b.brand)}</span>
            <span style={{ color: '#fff', fontWeight: 700 }}>{b.total}</span>
          </span>
        ))}
      </div>
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

function AdsVsPromosScatter({ rows, name }: { rows: CampaignPressureStat[]; name: (s: string) => string }) {
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
            <g key={r.brand}>
              <circle cx={cx} cy={cy} r={rad} fill={pgColor(r.brand)} opacity={isJ ? 0.95 : 0.6} stroke={isJ ? '#22c55e' : 'transparent'} strokeWidth={isJ ? 2 : 0}>
                <title>{`${name(r.brand)} · ${r.ads} ads · ${r.promos} promos · avg discount ${r.avgDiscount}%`}</title>
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

function CampaignStrategyMatrixChart({ matrix, name }: { matrix: CampaignStrategyMatrix; name: (s: string) => string }) {
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
            <g key={p.brand} style={{ cursor: 'pointer' }} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}>
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
  if (rows.length === 0) {
    return <div style={{ color: '#6b7280', fontSize: 13, padding: '32px 0', textAlign: 'center' }}>No themes to chart.</div>
  }
  // Aggregate per theme
  const themeOrder: MessageTheme[] = ['performance', 'power', 'sale', 'pro-endorsement', 'new-launch', 'beginner', 'tournament', 'other']
  const themeLabelMap: Record<MessageTheme, string> = {
    'performance': 'Performance',
    'power': 'Power',
    'sale': 'Sale',
    'pro-endorsement': 'Pro',
    'new-launch': 'New',
    'beginner': 'Beginner',
    'tournament': 'Tournament',
    'other': 'Other',
  }
  const byTheme = new Map<MessageTheme, Map<string, number>>()
  for (const r of rows) {
    if (!byTheme.has(r.theme)) byTheme.set(r.theme, new Map())
    const m = byTheme.get(r.theme)!
    m.set(r.brand, (m.get(r.brand) || 0) + r.count)
  }
  const themes = themeOrder.filter((t) => byTheme.has(t))
  const totalsByTheme = themes.map((t) => {
    const m = byTheme.get(t)!
    return Array.from(m.values()).reduce((s, v) => s + v, 0)
  })
  const maxTotal = Math.max(1, ...totalsByTheme)
  const allBrands = Array.from(new Set(rows.map((r) => r.brand))).sort()

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {themes.map((t, idx) => {
          const m = byTheme.get(t)!
          const total = totalsByTheme[idx]
          const widthPct = (total / maxTotal) * 100
          return (
            <div key={t} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 60px', alignItems: 'center', gap: 10, fontSize: 12 }}>
              <span style={{ color: '#cbd1dc', fontWeight: 600 }}>{themeLabelMap[t]}</span>
              <div style={{ height: 18, background: 'rgba(255,255,255,0.04)', borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
                <div style={{ display: 'flex', height: '100%', width: `${widthPct}%`, transition: 'width 200ms' }}>
                  {allBrands.map((b) => {
                    const v = m.get(b) || 0
                    if (v === 0) return null
                    const segPct = (v / total) * 100
                    return (
                      <div
                        key={b}
                        style={{ width: `${segPct}%`, background: pgColor(b), opacity: b === 'joola' ? 1 : 0.75 }}
                        title={`${name(b)} · ${themeLabelMap[t]} · ${v}`}
                      />
                    )
                  })}
                </div>
              </div>
              <span style={{ color: '#fff', fontWeight: 700, textAlign: 'right' }}>{total}</span>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14, fontSize: 11, color: '#6b7280' }}>
        {allBrands.map((b) => (
          <span key={b} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: pgColor(b), opacity: b === 'joola' ? 1 : 0.75 }} />
            <span>{name(b)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
