'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  PageHead, MiniKpi, SortTh, ColumnFilter, LoadingPage, SectionInfo,
  FilterBanner, pgColor, pgName,
} from '@/components/v2/PageShell'
import { fmt } from '@/components/v2/charts'
import { useBrandFilter, applyBrandFilter } from '@/lib/v2/BrandFilterContext'
import { useDateRange, applyDateRangeCustom, DATE_RANGE_LABEL, type DateRangeKey } from '@/lib/v2/DateRangeContext'
import { useReveal, revealCls } from '@/lib/v2/animations'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import {
  fetchCommunityIntel,
  fetchComplaintMap,
  fetchDefectionSignals,
  fetchTopicLifecycle,
  fetchBrandReplies,
  communityChannelLabel,
  communityChannelColor,
  type CommunityIntelData,
  type CommunitySignal,
  type CommunitySentiment,
  type BrandDiscussionRow,
  type SentimentStat,
  type TrendPoint,
  type HeatmapCell,
  type ComplaintRow,
  type DefectionRow,
  type DefectionKpis,
  type TopicLifecycleRow,
  type BrandReplyRow,
} from '@/lib/v2/communityIntel'
import { supabase } from '@/lib/shared/supabase'
import { formatCalendarDate } from '@/lib/v2/format'

type ChannelKey = 'all' | 'ig' | 'yt' | 'reddit' | 'tiktok' | 'x'
type SentimentKey = 'all' | 'positive' | 'neutral' | 'negative'
type CrisisKey = 'all' | 'crisis' | 'non-crisis'

const SENT_PILL: Record<CommunitySentiment, string> = {
  positive: 'pill-green',
  neutral: 'pill-ghost',
  negative: 'pill-red',
  unknown: 'pill-ghost',
}

const RISK_COLOR: Record<SentimentStat['risk'], string> = {
  low: '#22c55e',
  moderate: '#F5E625',
  high: '#fb923c',
  critical: '#ef4444',
}

const RISK_LABEL: Record<SentimentStat['risk'], string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  critical: 'Critical',
}

export default function CommunityIntelPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [data, setData] = useState<CommunityIntelData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ─── Extended-section state ─────────────────────────────────────────
  const [complaints, setComplaints] = useState<ComplaintRow[]>([])
  const [defection, setDefection] = useState<{ rows: DefectionRow[]; kpis: DefectionKpis } | null>(null)
  const [topicLifecycle, setTopicLifecycle] = useState<TopicLifecycleRow[]>([])
  const [brandReplies, setBrandReplies] = useState<BrandReplyRow[]>([])

  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()
  const { range, setRange, mode, customFrom, customTo, setCustomFrom, setCustomTo, effectiveFrom, effectiveTo } = useDateRange()

  // ─── Local filters ──────────────────────────────────────────────────
  const [channelFilter, setChannelFilter] = useState<ChannelKey>('all')
  const [sentimentFilter, setSentimentFilter] = useState<SentimentKey>('all')
  const [crisisFilter, setCrisisFilter] = useState<CrisisKey>('all')

  // ─── Sort + column-filter state per table ───────────────────────────
  const [discSort, setDiscSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'total', dir: 'desc' })
  const [discBrand, setDiscBrand] = useState('')
  const [feedSort, setFeedSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' })
  const [feedColFilter, setFeedColFilter] = useState<Record<string, string>>({})
  const [feedJoolaOnly, setFeedJoolaOnly] = useState(false)
  const [feedNegativeOnly, setFeedNegativeOnly] = useState(false)
  const [feedCommentsOnly, setFeedCommentsOnly] = useState(false)
  const [topSort, setTopSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'likes', dir: 'desc' })
  const [topColFilter, setTopColFilter] = useState<Record<string, string>>({})
  const [topJoolaOnly, setTopJoolaOnly] = useState(false)
  const [topNegativeOnly, setTopNegativeOnly] = useState(false)
  const [crisisSort, setCrisisSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' })
  const [crisisColFilter, setCrisisColFilter] = useState<Record<string, string>>({})
  const [sentimentSort, setSentimentSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'crisis', dir: 'desc' })
  const [topicSort, setTopicSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'peakMentions', dir: 'desc' })
  const [drillBrand, setDrillBrand] = useState<string | null>(null)
  const [drillSignal, setDrillSignal] = useState<import('@/lib/v2/communityIntel').CommunitySignal | null>(null)

  // Crisis alerts fetched once with NO date filter — always shows all active crises
  // regardless of what the date-range picker is set to (matches the sidebar badge count).
  // Initialised with dummy data so the panel is visible immediately; real data overwrites it.
  const [rawCrisisAlerts, setRawCrisisAlerts] = useState<{
    id: string; brand_id: string; channel: string; text_snippet: string | null; posted_at: string | null
  }[]>([])

  useEffect(() => {
    supabase
      .from('mention_facts')
      .select('id,brand_id,channel,text_snippet,posted_at')
      .eq('is_crisis', true)
      .order('posted_at', { ascending: false })
      .limit(50)
      .then(({ data: rows }) => { if (rows) setRawCrisisAlerts(rows) })
  }, [])

  useEffect(() => {
    document.title = 'JOOLA INTEL — Community Intel'
  }, [])

  // ─── Fetch ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const b = await fetchBrands()
        if (cancelled) return
        setBrands(b)
        setAllBrands(b)
        const d = await fetchCommunityIntel(b, { from: effectiveFrom, to: effectiveTo })
        if (cancelled) return
        setData(d)
        // Fire extended fetchers in parallel — failures fall back to empty arrays.
        const [complaintsRes, defectionRes, topicRes, repliesRes] = await Promise.all([
          fetchComplaintMap(b, { from: effectiveFrom, to: effectiveTo }).catch(() => [] as ComplaintRow[]),
          fetchDefectionSignals(b, { from: effectiveFrom, to: effectiveTo }).catch(() => ({ rows: [] as DefectionRow[], kpis: { joolaInflow: 0, joolaOutflow: 0, joolaNet: 0, totalSwitches: 0 } })),
          fetchTopicLifecycle().catch(() => [] as TopicLifecycleRow[]),
          fetchBrandReplies(b).catch(() => [] as BrandReplyRow[]),
        ])
        if (cancelled) return
        setComplaints(complaintsRes)
        setDefection(defectionRes)
        setTopicLifecycle(topicRes)
        setBrandReplies(repliesRes)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[community-intel] load failed', err)
        if (!cancelled) setError('Unable to load Community Intel. Refresh the page to retry.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [effectiveFrom, effectiveTo, setAllBrands])

  const name = (s: string) => pgName(s, brands)

  // ─── Helpers ───────────────────────────────────────────────────────

  const passesChannel = (s: CommunitySignal): boolean => {
    if (channelFilter === 'all') return true
    return String(s.source) === channelFilter
  }
  const passesSentiment = (s: CommunitySignal): boolean => {
    if (sentimentFilter === 'all') return true
    return s.sentiment === sentimentFilter
  }
  const passesCrisis = (s: CommunitySignal): boolean => {
    if (crisisFilter === 'all') return true
    if (crisisFilter === 'crisis') return s.isCrisis
    return !s.isCrisis
  }

  // ─── Filtered + brand-scoped views (computed before early-returns) ──

  const filteredSignals = useMemo(() => {
    if (!data) return []
    const brandScoped = applyBrandFilter(data.signals, filteredBrands, isFiltered)
    const dateScoped = applyDateRangeCustom(brandScoped, effectiveFrom, effectiveTo)
    return dateScoped.filter((s) => passesChannel(s) && passesSentiment(s) && passesCrisis(s))
  }, [data, filteredBrands, isFiltered, effectiveFrom, effectiveTo, channelFilter, sentimentFilter, crisisFilter])

  const filteredDiscussion = useMemo<BrandDiscussionRow[]>(() => {
    if (!data) return []
    return applyBrandFilter(data.brandDiscussion, filteredBrands, isFiltered)
  }, [data, filteredBrands, isFiltered])

  const filteredChannelStats = useMemo(() => {
    if (!data) return []
    // Recompute channel stats from the currently filtered signal list so the
    // donut/bar respects the global filter bar.
    const acc = new Map<string, { channel: string; label: string; color: string; total: number; crisis: number }>()
    for (const s of filteredSignals) {
      const ch = String(s.source)
      if (!acc.has(ch)) {
        acc.set(ch, {
          channel: ch,
          label: communityChannelLabel(ch),
          color: communityChannelColor(ch),
          total: 0,
          crisis: 0,
        })
      }
      const row = acc.get(ch)!
      row.total += 1
      if (s.isCrisis) row.crisis += 1
    }
    return Array.from(acc.values()).sort((a, b) => b.total - a.total)
  }, [data, filteredSignals])

  const filteredHeatmap = useMemo<HeatmapCell[]>(() => {
    if (!data) return []
    const acc = new Map<string, HeatmapCell>()
    for (const s of filteredSignals) {
      if (!s.brand) continue
      const key = `${s.brand}::${s.source}`
      if (!acc.has(key)) {
        acc.set(key, { brand: s.brand, channel: String(s.source), total: 0, crisis: 0, negative: 0 })
      }
      const row = acc.get(key)!
      row.total += 1
      if (s.isCrisis) row.crisis += 1
      if (s.sentiment === 'negative') row.negative += 1
    }
    return Array.from(acc.values())
  }, [data, filteredSignals])

  const filteredSentimentStats = useMemo<SentimentStat[]>(() => {
    if (!data) return []
    return applyBrandFilter(data.sentimentStats, filteredBrands, isFiltered)
  }, [data, filteredBrands, isFiltered])

  const filteredTrend = useMemo<TrendPoint[]>(() => {
    if (!data) return []
    // Trend buckets are already aligned to the date window — just downscale
    // crisis/joola/negative to the active filter for accuracy.
    const points = data.trend.map((p) => ({ ...p, total: 0, crisis: 0, joola: 0, negative: 0 }))
    const pointByDate = new Map(points.map((p) => [p.date, p]))
    for (const s of filteredSignals) {
      const p = pointByDate.get(s.date)
      if (!p) {
        // Try nearest bucket: snap to the latest bucket that's ≤ s.date.
        let snapped: TrendPoint | null = null
        for (const candidate of points) {
          if (candidate.date <= s.date) snapped = candidate
          else break
        }
        if (!snapped) continue
        snapped.total += 1
        if (s.isCrisis) snapped.crisis += 1
        if (s.brand === 'joola') snapped.joola += 1
        if (s.sentiment === 'negative') snapped.negative += 1
        continue
      }
      p.total += 1
      if (s.isCrisis) p.crisis += 1
      if (s.brand === 'joola') p.joola += 1
      if (s.sentiment === 'negative') p.negative += 1
    }
    return points
  }, [data, filteredSignals])

  // ─── Section-specific derived data ──────────────────────────────────

  const discussionRows = useMemo(() => {
    const q = discBrand.trim().toLowerCase()
    const rows = filteredDiscussion.filter(
      (r) => !q || r.brand.toLowerCase().includes(q) || name(r.brand).toLowerCase().includes(q),
    )
    return sortRows(rows, discSort.key, discSort.dir)
  }, [filteredDiscussion, discBrand, discSort, brands])

  const feedRows = useMemo(() => {
    let rows = [...filteredSignals]
    if (feedJoolaOnly) rows = rows.filter((r) => r.brand === 'joola')
    if (feedNegativeOnly) rows = rows.filter((r) => r.sentiment === 'negative')
    if (feedCommentsOnly) rows = rows.filter((r) => r.signalType === 'comment')
    const colFilter = feedColFilter
    if (Object.keys(colFilter).length > 0) {
      rows = rows.filter((r) =>
        Object.entries(colFilter).every(([k, q]) => {
          if (!q) return true
          const needle = q.toLowerCase()
          if (k === 'brand') {
            return r.brand.toLowerCase().includes(needle) || name(r.brand).toLowerCase().includes(needle)
          }
          if (k === 'summary') return r.summary.toLowerCase().includes(needle)
          if (k === 'source') return r.sourceLabel.toLowerCase().includes(needle)
          return true
        }),
      )
    }
    rows = sortRows(rows, feedSort.key, feedSort.dir)
    return rows.slice(0, 200)
  }, [filteredSignals, feedColFilter, feedSort, feedJoolaOnly, feedNegativeOnly, feedCommentsOnly, brands])

  const topCommentsAll = useMemo(() => {
    return filteredSignals.filter((s) => s.signalType === 'comment' && s.summary && s.summary !== '(no snippet)')
  }, [filteredSignals])

  const topCommentRows = useMemo(() => {
    let rows = [...topCommentsAll]
    if (topJoolaOnly) rows = rows.filter((r) => r.brand === 'joola')
    if (topNegativeOnly) rows = rows.filter((r) => r.sentiment === 'negative')
    if (Object.keys(topColFilter).length > 0) {
      rows = rows.filter((r) =>
        Object.entries(topColFilter).every(([k, q]) => {
          if (!q) return true
          const needle = q.toLowerCase()
          if (k === 'brand') {
            return r.brand.toLowerCase().includes(needle) || name(r.brand).toLowerCase().includes(needle)
          }
          if (k === 'summary') return r.summary.toLowerCase().includes(needle)
          return true
        }),
      )
    }
    rows = sortRows(rows, topSort.key, topSort.dir)
    return rows.slice(0, 200)
  }, [topCommentsAll, topJoolaOnly, topNegativeOnly, topColFilter, topSort, brands])

  const crisisRows = useMemo(() => {
    if (!data) return []
    let rows = applyBrandFilter(data.crisisSignals, filteredBrands, isFiltered)
    rows = applyDateRangeCustom(rows, effectiveFrom, effectiveTo)
    if (Object.keys(crisisColFilter).length > 0) {
      rows = rows.filter((r) =>
        Object.entries(crisisColFilter).every(([k, q]) => {
          if (!q) return true
          const needle = q.toLowerCase()
          if (k === 'brand') {
            return r.brand.toLowerCase().includes(needle) || name(r.brand).toLowerCase().includes(needle)
          }
          if (k === 'summary') return r.summary.toLowerCase().includes(needle)
          return true
        }),
      )
    }
    rows = sortRows(rows, crisisSort.key, crisisSort.dir)
    return rows
  }, [data, filteredBrands, isFiltered, effectiveFrom, effectiveTo, crisisColFilter, crisisSort, brands])


  const sentimentRows = useMemo(() => {
    return sortRows(filteredSentimentStats, sentimentSort.key, sentimentSort.dir)
  }, [filteredSentimentStats, sentimentSort])

  const sortedTopicLifecycle = useMemo(() => {
    const arr = [...topicLifecycle]
    const { key, dir } = topicSort
    arr.sort((a, b) => {
      const av: unknown = key === 'channelCount' ? a.channelsTouched.length : (a as Record<string, unknown>)[key]
      const bv: unknown = key === 'channelCount' ? b.channelsTouched.length : (b as Record<string, unknown>)[key]
      if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av
      if (typeof av === 'boolean' && typeof bv === 'boolean') return dir === 'asc' ? (av === bv ? 0 : av ? 1 : -1) : (av === bv ? 0 : av ? -1 : 1)
      return dir === 'asc' ? String(av ?? '').localeCompare(String(bv ?? '')) : String(bv ?? '').localeCompare(String(av ?? ''))
    })
    return arr
  }, [topicLifecycle, topicSort])

  // ─── Scroll-reveal refs ─────────────────────────────────────────────
  const sec1 = useReveal()
  const sec2 = useReveal()
  const sec3 = useReveal()
  const sec4 = useReveal()
  const sec5 = useReveal()
  const sec6 = useReveal()
  const sec7 = useReveal()
  const sec8 = useReveal()
  const sec9 = useReveal()

  // ─── Early returns ──────────────────────────────────────────────────

  if (loading) return <LoadingPage />

  if (error || !data) return (
    <div style={{ padding: '80px 32px', textAlign: 'center' }}>
      <div style={{ color: '#ef4444', fontSize: 14, marginBottom: 16 }}>
        {error || 'Unable to load Community Intel.'}
      </div>
      <button className="btn btn-yellow" onClick={() => window.location.reload()} aria-label="Refresh page">Refresh page</button>
    </div>
  )

  // ─── Render ─────────────────────────────────────────────────────────

  const summary = data.summary
  const sentimentCoverage = data.dataStatus.sentimentCoverage
  const showSentimentLowCoverage = sentimentCoverage < 0.2 && filteredSignals.length > 0

  // ── Filter-aware KPI values (recomputed from filteredSignals so the top
  //    strip and MiniKpi cards always reflect the active date + brand filter)
  const filteredJoolaMentions = filteredSignals.filter((s) => s.brand === 'joola').length
  const filteredCommentsCount = filteredSignals.filter((s) => s.signalType === 'comment').length
  const filteredWithSentiment = filteredSignals.filter(
    (s) => s.sentiment === 'positive' || s.sentiment === 'neutral' || s.sentiment === 'negative',
  )
  const filteredNegCount = filteredWithSentiment.filter((s) => s.sentiment === 'negative').length
  const filteredNegativePct = filteredWithSentiment.length > 0
    ? Math.round(filteredNegCount / filteredWithSentiment.length * 100)
    : summary.negativePct
  const filteredSentimentCoverage = filteredSignals.length > 0
    ? Math.round(filteredWithSentiment.length / filteredSignals.length * 100)
    : Math.round(sentimentCoverage * 100)
  const filteredOpenCrisis30d = crisisRows.filter((c) => c.days <= 30).length
  const filteredTopChannel = filteredChannelStats[0]?.channel || summary.topChannel
  const filteredTopBrand = (() => {
    const counts = new Map<string, number>()
    for (const s of filteredSignals) {
      if (s.brand) counts.set(s.brand, (counts.get(s.brand) || 0) + 1)
    }
    let top = '', topN = 0
    counts.forEach((n, b) => { if (n > topN) { top = b; topN = n } })
    return top || summary.topBrand
  })()
  const filteredTopBrandAtRisk = (() => {
    const counts = new Map<string, number>()
    for (const s of filteredSignals) {
      if (s.brand && s.isCrisis) counts.set(s.brand, (counts.get(s.brand) || 0) + 1)
    }
    let top = '', topN = 0
    counts.forEach((n, b) => { if (n > topN) { top = b; topN = n } })
    return top || summary.topBrandAtRisk
  })()
  const negativeAvailable = filteredSentimentStats.some((r) => r.negative > 0 || r.positive > 0)

  const fromInputValue = effectiveFrom.toISOString().slice(0, 10)
  const toInputValue = effectiveTo.toISOString().slice(0, 10)

  return (
    <div className="ov-page-enter">
      {drillSignal && (
        <SignalDetailDialog signal={drillSignal} brandName={name(drillSignal.brand)} onClose={() => setDrillSignal(null)} />
      )}
      {drillBrand && (
        <SignalDialog
          brand={drillBrand}
          brandName={name(drillBrand)}
          signals={filteredSignals}
          onClose={() => setDrillBrand(null)}
        />
      )}
      <PageHead title="COMMUNITY INTEL" />
      <FilterBanner />

      {/* ─── Active Crisis Alerts ──────────────────────────────────── */}
      {rawCrisisAlerts.length > 0 && (
        <section style={{ marginBottom: 20 }}>
          <div style={{
            border: '1px solid rgba(239,68,68,0.25)',
            borderTop: '3px solid #ef4444',
            borderRadius: 10,
            background: 'rgba(239,68,68,0.04)',
            padding: '14px 18px',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 16, lineHeight: 1 }}>🚨</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Active Crisis Signals
              </span>
              <span style={{
                background: '#ef4444', color: '#fff', borderRadius: 99,
                fontSize: 10, fontWeight: 800, padding: '2px 8px',
              }}>
                {rawCrisisAlerts.length}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--fg-4)' }}>
                Most recent first · scroll down to Crisis Watchlist for details
              </span>
            </div>

            {/* Crisis items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {rawCrisisAlerts.slice(0, 10).map((c, i) => {
                const brandSlug = brands.find(b => b.brand_id === c.brand_id)?.id || c.brand_id
                const bc = pgColor(brandSlug)
                const chLabel = communityChannelLabel(c.channel as Parameters<typeof communityChannelLabel>[0]) || c.channel.toUpperCase()
                const chColors: Record<string, string> = { ig: '#e1306c', yt: '#ff0000', reddit: '#ff4500', tiktok: '#69c9d0', x: '#94a3b8' }
                const chColor = chColors[c.channel] || 'var(--fg-4)'
                const days = c.posted_at ? Math.max(0, Math.floor((Date.now() - new Date(c.posted_at).getTime()) / 86400000)) : 0
                return (
                  <div
                    key={c.id}
                    className="ov-kpi"
                    style={{
                      '--ov-d': `${i * 55}ms`,
                      display: 'grid',
                      gridTemplateColumns: '120px 80px 1fr auto',
                      alignItems: 'center',
                      gap: 12,
                      padding: '9px 12px',
                      borderRadius: 8,
                      background: 'var(--wb-3)',
                      border: '1px solid rgba(239,68,68,0.12)',
                      transition: 'background 150ms, border-color 150ms',
                    } as React.CSSProperties}
                    onMouseEnter={e => {
                      const el = e.currentTarget as HTMLElement
                      el.style.background = 'rgba(239,68,68,0.07)'
                      el.style.borderColor = 'rgba(239,68,68,0.3)'
                    }}
                    onMouseLeave={e => {
                      const el = e.currentTarget as HTMLElement
                      el.style.background = 'var(--wb-3)'
                      el.style.borderColor = 'rgba(239,68,68,0.12)'
                    }}
                  >
                    {/* Brand */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, overflow: 'hidden' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: bc, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: bc, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name(brandSlug)}
                      </span>
                    </div>

                    {/* Channel */}
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                      background: 'rgba(255,255,255,0.06)', color: chColor,
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      textAlign: 'center', whiteSpace: 'nowrap',
                    }}>
                      {chLabel}
                    </span>

                    {/* Text snippet */}
                    <span style={{
                      fontSize: 11, color: 'var(--fg-2)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {c.text_snippet || '—'}
                    </span>

                    {/* Age */}
                    <span style={{
                      fontSize: 10, fontWeight: 700, flexShrink: 0,
                      color: days === 0 ? '#ef4444' : days <= 7 ? '#fb923c' : 'var(--fg-4)',
                    }}>
                      {days === 0 ? 'today' : `${days}d ago`}
                    </span>
                  </div>
                )
              })}
            </div>

            {rawCrisisAlerts.length > 10 && (
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--fg-4)', textAlign: 'center', paddingTop: 10, borderTop: '1px solid rgba(239,68,68,0.1)' }}>
                +{rawCrisisAlerts.length - 10} more — scroll down to Crisis Watchlist for full table
              </div>
            )}
          </div>
        </section>
      )}

      {/* ─── Section 1: Summary strip ──────────────────────────────── */}
      <section>
        <div
          className="card"
          style={{
            padding: '14px 18px',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-evenly',
            alignItems: 'center',
            fontSize: 12,
            color: 'var(--fg-2)',
            marginBottom: 18,
          }}
        >
          <SummaryItem
            label="Community signals"
            value={fmt(filteredSignals.length)}
            tip="Total community signals (mentions, comments, and crisis flags) across all channels within the selected date range and brand filter."
          />
          <SummaryItem
            label="Comments analyzed"
            value={fmt(filteredCommentsCount)}
            tip="Comment-type signals (Instagram comments, YouTube comments, Reddit comments) within the current filters — a subset of total community signals."
          />
          <SummaryItem
            label="Open crisis (30d)"
            value={fmt(filteredOpenCrisis30d)}
            color={filteredOpenCrisis30d > 0 ? '#ef4444' : undefined}
            tip="Crisis-flagged signals from the last 30 days. Crisis signals are GPT-4o-mini events: recalls, safety issues, coordinated backlash, or scandals — a higher bar than negative sentiment."
          />
          <SummaryItem
            label="Top brand"
            value={filteredTopBrand ? name(filteredTopBrand) : '—'}
            color={filteredTopBrand ? pgColor(filteredTopBrand) : undefined}
            tip="Brand with the highest total community signal count in the current date and brand filter."
          />
          <SummaryItem
            label="Top brand at risk"
            value={filteredTopBrandAtRisk ? name(filteredTopBrandAtRisk) : '—'}
            color={filteredTopBrandAtRisk ? pgColor(filteredTopBrandAtRisk) : '#94a3b8'}
            tip="Brand with the most crisis-flagged signals in the current filter window — the most urgent reputation risk."
          />
          <SummaryItem
            label="Top channel"
            value={filteredTopChannel ? communityChannelLabel(filteredTopChannel) : '—'}
            color={filteredTopChannel ? communityChannelColor(filteredTopChannel) : undefined}
            tip="Most active community channel by signal volume in the current date range."
          />
          <SummaryItem
            label="JOOLA mentions"
            value={fmt(filteredJoolaMentions)}
            color="#22c55e"
            tip="Count of community signals specifically about JOOLA within the current date and brand filters."
          />
          <SummaryItem
            label="Negative %"
            value={`${filteredNegativePct}%`}
            tip="Share of sentiment-classified signals that are negative: negative ÷ (positive + neutral + negative) × 100. Only signals with a sentiment label are counted — coverage shown on the Negative Share card below."
          />
        </div>

      </section>

      {/* ─── Section 2: Brand discussion volume ────────────────────── */}
      <section ref={sec1.ref} className={"ov-reveal" + (sec1.vis ? " is-vis" : "")}>
        <div className="section-head">
          <div>
            <h2>
              Brand discussion volume
              <SectionInfo
                title="Brand discussion volume"
                description="Total community signals per brand across IG comments, YT comments, Reddit posts + comments, and any rows promoted into mention_facts. Channel-specific columns make it obvious where each brand's conversation lives. Negative % and Crisis count surface where the conversation is unhealthy."
                source="ig_comments + yt_comments + reddit_mentions + reddit_comments + mention_facts"
              />
            </h2>
            <div className="sub">Brands with the most active community footprint. Sort, search, or click headers.</div>
          </div>
        </div>
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="data" style={{ width: '100%', minWidth: 940 }}>
            <thead>
              <tr>
                <SortTh col="brand" label="Brand" sortKey={discSort.key} sortDir={discSort.dir} toggle={(k) => toggleSort(discSort, setDiscSort, k)} style={{ textAlign: 'left' }} />
                <SortTh col="total" label="Total" sortKey={discSort.key} sortDir={discSort.dir} toggle={(k) => toggleSort(discSort, setDiscSort, k)} style={{ textAlign: 'right' }} />
                <SortTh col="ig" label="IG" sortKey={discSort.key} sortDir={discSort.dir} toggle={(k) => toggleSort(discSort, setDiscSort, k)} style={{ textAlign: 'right' }} />
                <SortTh col="yt" label="YT" sortKey={discSort.key} sortDir={discSort.dir} toggle={(k) => toggleSort(discSort, setDiscSort, k)} style={{ textAlign: 'right' }} />
                <SortTh col="reddit" label="Reddit" sortKey={discSort.key} sortDir={discSort.dir} toggle={(k) => toggleSort(discSort, setDiscSort, k)} style={{ textAlign: 'right' }} />
                <SortTh col="tiktok" label="TikTok" sortKey={discSort.key} sortDir={discSort.dir} toggle={(k) => toggleSort(discSort, setDiscSort, k)} style={{ textAlign: 'right' }} />
                <SortTh col="x" label="X" sortKey={discSort.key} sortDir={discSort.dir} toggle={(k) => toggleSort(discSort, setDiscSort, k)} style={{ textAlign: 'right' }} />
                <SortTh col="negativePct" label="Negative %" sortKey={discSort.key} sortDir={discSort.dir} toggle={(k) => toggleSort(discSort, setDiscSort, k)} style={{ textAlign: 'right' }} />
                <SortTh col="crisis" label="Crisis" sortKey={discSort.key} sortDir={discSort.dir} toggle={(k) => toggleSort(discSort, setDiscSort, k)} style={{ textAlign: 'right' }} />
              </tr>
              <tr className="col-filter-row">
                <th><ColumnFilter col="brand" value={discBrand} onChange={setDiscBrand} placeholder="search brand…" /></th>
                <th colSpan={8} />
              </tr>
            </thead>
            <tbody>
              {discussionRows.length === 0 && (
                <tr><td colSpan={9} style={emptyCell}>No discussion data for this filter.</td></tr>
              )}
              {discussionRows.map((r) => {
                const isJoola = r.brand === 'joola'
                const maxTotal = Math.max(1, ...discussionRows.map((x) => x.total))
                const barPct = (r.total / maxTotal) * 100
                return (
                  <tr key={r.brand} style={isJoola ? { borderLeft: '3px solid #22c55e', background: 'rgba(34,197,94,0.04)' } : {}}>
                    <td style={{ textAlign: 'left' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: pgColor(r.brand) }} />
                        <span style={{ fontWeight: 700, color: isJoola ? '#22c55e' : 'inherit' }}>{name(r.brand)}</span>
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', verticalAlign: 'middle' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                        <span style={{ fontWeight: 700, color: '#fff' }}>{fmt(r.total)}</span>
                        <div style={{ width: 80, height: 6, background: 'var(--wb-5)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${barPct}%`, height: '100%', background: isJoola ? '#22c55e' : '#F5E625' }} />
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>{r.ig > 0 ? fmt(r.ig) : <span style={{ color: '#3a4150' }}>·</span>}</td>
                    <td style={{ textAlign: 'right' }}>{r.yt > 0 ? fmt(r.yt) : <span style={{ color: '#3a4150' }}>·</span>}</td>
                    <td style={{ textAlign: 'right' }}>{r.reddit > 0 ? fmt(r.reddit) : <span style={{ color: '#3a4150' }}>·</span>}</td>
                    <td style={{ textAlign: 'right' }}>{r.tiktok > 0 ? fmt(r.tiktok) : <span style={{ color: '#3a4150' }}>·</span>}</td>
                    <td style={{ textAlign: 'right' }}>{r.x > 0 ? fmt(r.x) : <span style={{ color: '#3a4150' }}>·</span>}</td>
                    <td style={{ textAlign: 'right', color: r.negativePct >= 30 ? '#ef4444' : r.negativePct >= 15 ? '#F5E625' : 'inherit', fontWeight: r.negativePct >= 15 ? 700 : 400 }}>
                      {r.total > 0 ? `${r.negativePct}%` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: r.crisis > 0 ? '#ef4444' : 'inherit', fontWeight: r.crisis > 0 ? 700 : 400 }}>
                      {r.crisis > 0 ? r.crisis : <span style={{ color: '#3a4150' }}>·</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── Section 3: Community trend over time ──────────────────── */}
      <section ref={sec2.ref} className={"ov-reveal" + (sec2.vis ? " is-vis" : "")}>
        <div className="section-head">
          <div>
            <h2>
              Community trend over time
              <SectionInfo
                title="Community trend"
                description="Daily (or weekly, for long windows) volume of community signals — total, crisis, JOOLA-specific, and negative-sentiment overlays. Use this to spot spikes that warrant drill-through into the live feed below."
                source="All filtered community signals · bucketed by posted_at"
              />
            </h2>
            <div className="sub">Stacked view of every community signal in the active window.</div>
          </div>
        </div>
        {showSentimentLowCoverage && (
          <div className="price-war" style={{ borderColor: 'rgba(245,230,37,0.3)', marginBottom: 12 }}>
            Sentiment classification is still being calibrated. Showing volume and crisis signals only until sentiment confidence is available.
          </div>
        )}
        <div className="card" style={{ padding: 16 }}>
          <CommunityTrendChart points={filteredTrend} />
        </div>
      </section>

      {/* ─── Section 4: Channel + heatmap two-up ──────────────────── */}
      <section ref={sec3.ref} className={"ov-reveal" + (sec3.vis ? " is-vis" : "")}>
        <div className="two-col">
          <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column' }}>
            <h6 style={{ marginTop: 0 }}>
              Channel mix
              <SectionInfo
                title="Channel mix"
                description="Where the conversation lives — donut of total signals per channel, sized to volume. Crisis count is shown as a red dot overlay so you can spot disproportionate crisis concentration in a single channel."
                source="Filtered community signals · grouped by source"
              />
            </h6>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ChannelMixDonut rows={filteredChannelStats} />
            </div>
          </div>
          <div className="card" style={{ padding: 16 }}>
            <h6 style={{ marginTop: 0 }}>
              Brand × channel heatmap
              <SectionInfo
                title="Brand × channel heatmap"
                description="Each cell shows total signal count for a brand on a channel. A small red dot indicates the cell also contains crisis signals; hover for breakdown."
                source="Filtered signals · brand × channel cross-tab"
              />
            </h6>
            <BrandChannelHeatmap rows={filteredHeatmap} brands={brands} name={name} />
          </div>
        </div>
      </section>

      {/* ─── Section 5: Sentiment + risk ──────────────────────────── */}
      <section ref={sec4.ref} className={revealCls(sec4.vis)}>
        <div className="section-head">
          <div>
            <h2>
              Sentiment and risk
              <SectionInfo
                title="Sentiment and risk"
                description="Per-brand negative share and crisis count, ranked by how at-risk each brand looks today. Risk level is a synthetic bucket combining negative % and crisis count thresholds — calibrate when you have more ground truth."
                source="Aggregated from filtered signals — sentiment from sentiment_label (mention_facts + comment tables)"
              />
            </h2>
            <div className="sub">Ranked watchlist of brands whose community sentiment is trending negative.</div>
          </div>
        </div>
        {!negativeAvailable && (
          <div className="card" style={{ padding: 14, marginBottom: 12, fontSize: 12, color: '#F5E625', background: 'rgba(245,182,37,0.08)', borderColor: 'rgba(245,182,37,0.3)' }}>
            Sentiment data partial — section limited to crisis signals while the classifier finishes calibration.
          </div>
        )}
        {showSentimentLowCoverage && (
          <div className="card" style={{ padding: 14, marginBottom: 12, fontSize: 12, color: '#F5E625', background: 'rgba(245,182,37,0.08)', borderColor: 'rgba(245,182,37,0.3)' }}>
            Only {Math.round(sentimentCoverage * 100)}% of signals carry a sentiment label — values below are partial.
          </div>
        )}
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="data" style={{ width: '100%', minWidth: 880 }}>
            <thead>
              <tr>
                <SortTh col="brand" label="Brand" sortKey={sentimentSort.key} sortDir={sentimentSort.dir} toggle={(k) => toggleSort(sentimentSort, setSentimentSort, k)} style={{ textAlign: 'left' }} title="Paddle brand being scored. JOOLA row is highlighted in green." />
                <SortTh col="total" label="Total" sortKey={sentimentSort.key} sortDir={sentimentSort.dir} toggle={(k) => toggleSort(sentimentSort, setSentimentSort, k)} style={{ textAlign: 'right' }} title="Total community signals for this brand in the active window — every mention across Instagram, YouTube, Reddit, TikTok, and X combined." />
                <SortTh col="positive" label="Positive" sortKey={sentimentSort.key} sortDir={sentimentSort.dir} toggle={(k) => toggleSort(sentimentSort, setSentimentSort, k)} style={{ textAlign: 'right' }} title="Number of signals GPT-4o-mini classified as POSITIVE — compliments, recommendations, 'love this paddle', 'just bought, amazing'." />
                <SortTh col="neutral" label="Neutral" sortKey={sentimentSort.key} sortDir={sentimentSort.dir} toggle={(k) => toggleSort(sentimentSort, setSentimentSort, k)} style={{ textAlign: 'right' }} title="Signals with no clear positive or negative tone — questions, factual statements, links, casual references." />
                <SortTh col="negative" label="Negative" sortKey={sentimentSort.key} sortDir={sentimentSort.dir} toggle={(k) => toggleSort(sentimentSort, setSentimentSort, k)} style={{ textAlign: 'right' }} title="NEGATIVE = any everyday complaint, gripe, or unhappy comment. Examples: 'paddle cracked after 3 weeks', 'support never replied', 'didn't fit my swing', 'overpriced'. Low-severity unhappiness counted one-by-one. Most negative signals are NOT crises — they are individual user gripes." />
                <SortTh col="crisis" label="Crisis" sortKey={sentimentSort.key} sortDir={sentimentSort.dir} toggle={(k) => toggleSort(sentimentSort, setSentimentSort, k)} style={{ textAlign: 'right' }} title="CRISIS = a much higher bar than 'negative'. Crisis signals are viral or systemic events that demand immediate brand response: safety issue, recall, ban / illegality ruling, mass warranty failure, coordinated backlash, athlete scandal. Every crisis is negative, but most negative signals are NOT crises. Detected via GPT-4o-mini crisis-classifier on top of sentiment." />
                <SortTh col="negativePct" label="Negative %" sortKey={sentimentSort.key} sortDir={sentimentSort.dir} toggle={(k) => toggleSort(sentimentSort, setSentimentSort, k)} style={{ textAlign: 'right' }} title="Share of this brand's mentions that are negative. Formula: negative ÷ (positive + neutral + negative) × 100. Yellow >= 15%, red >= 30%." />
                <SortTh col="risk" label="Risk Level" sortKey={sentimentSort.key} sortDir={sentimentSort.dir} toggle={(k) => toggleSort(sentimentSort, setSentimentSort, k)} style={{ textAlign: 'right' }} title="Overall brand-health rating combining crisis count, severity, recency, and negative share. Low / Moderate / High / Critical bands." />
              </tr>
            </thead>
            <tbody>
              {sentimentRows.length === 0 && (
                <tr><td colSpan={8} style={emptyCell}>No sentiment data in this filter.</td></tr>
              )}
              {sentimentRows.map((r) => {
                const isJoola = r.brand === 'joola'
                const rank = sentimentRows.filter(x => x.total > r.total).length + 1
                const positivePct = r.total > 0 ? Math.round(r.positive / r.total * 100) : 0
                const neutralPct  = r.total > 0 ? Math.round(r.neutral  / r.total * 100) : 0
                const avgNegPct = sentimentRows.length > 0
                  ? Math.round(sentimentRows.reduce((s, x) => s + x.negativePct, 0) / sentimentRows.length)
                  : 0
                const RISK_DESC: Record<string, string> = {
                  critical: 'Immediate response required — viral or systemic issue in play.',
                  high:     'Elevated risk — monitor closely and prepare a response.',
                  moderate: 'Watch list — sentiment is trending negative.',
                  low:      'Brand health stable — no urgent action needed.',
                }
                const rowTip = [
                  `${name(r.brand).toUpperCase()}  ·  ${RISK_LABEL[r.risk].toUpperCase()} RISK`,
                  RISK_DESC[r.risk],
                  '',
                  `Volume: ${r.total.toLocaleString()} signals  (ranked #${rank} of ${sentimentRows.length} by volume)`,
                  r.total > 0
                    ? `Sentiment:  ${r.positive} positive (${positivePct}%)  ·  ${r.neutral} neutral (${neutralPct}%)  ·  ${r.negative} negative (${r.negativePct}%)`
                    : 'No signals with sentiment labels.',
                  r.total > 0
                    ? `Negative share ${r.negativePct}% vs ${avgNegPct}% category avg  ${r.negativePct > avgNegPct ? '▲ above average' : r.negativePct < avgNegPct ? '▼ below average' : '= at average'}`
                    : '',
                  r.crisis > 0
                    ? `⚠  ${r.crisis} crisis signal${r.crisis !== 1 ? 's' : ''} — viral/systemic events needing immediate brand response`
                    : '✓  No crisis signals detected',
                ].filter(s => s !== undefined).join('\n')
                return (
                  <tr
                    key={r.brand}
                    title={rowTip}
                    style={{ ...(isJoola ? { borderLeft: '3px solid #22c55e', background: 'rgba(34,197,94,0.04)' } : {}), cursor: 'pointer' }}
                    onClick={() => setDrillBrand(r.brand)}
                  >
                    <td style={{ textAlign: 'left' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: pgColor(r.brand) }} />
                        <span style={{ fontWeight: 700, color: isJoola ? '#22c55e' : 'inherit' }}>{name(r.brand)}</span>
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>{fmt(r.total)}</td>
                    <td style={{ textAlign: 'right', color: r.positive > 0 ? '#22c55e' : 'inherit' }}>{r.positive > 0 ? fmt(r.positive) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{r.neutral > 0 ? fmt(r.neutral) : '—'}</td>
                    <td style={{ textAlign: 'right', color: r.negative > 0 ? '#ef4444' : 'inherit' }}>{r.negative > 0 ? fmt(r.negative) : '—'}</td>
                    <td style={{ textAlign: 'right', color: r.crisis > 0 ? '#ef4444' : 'inherit', fontWeight: r.crisis > 0 ? 700 : 400 }}>
                      {r.crisis > 0 ? r.crisis : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: r.negativePct >= 30 ? '#ef4444' : r.negativePct >= 15 ? '#F5E625' : 'inherit' }}>
                      {r.total > 0 ? `${r.negativePct}%` : '—'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span
                        className="pill"
                        style={{
                          background: `${RISK_COLOR[r.risk]}22`,
                          color: RISK_COLOR[r.risk],
                          border: `1px solid ${RISK_COLOR[r.risk]}55`,
                          fontWeight: 700,
                        }}
                      >
                        {RISK_LABEL[r.risk]}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── Section 6: Live community intel feed (merged) ──────────── */}
      <section ref={sec5.ref} className={revealCls(sec5.vis)}>
        <div className="section-head">
          <div>
            <h2>
              Live community intel feed
              <SectionInfo
                title="Live community intel feed"
                description="Unified, deduped stream of every community signal in the active window — mentions, comments, and crisis flags across Instagram, YouTube, Reddit, TikTok and X. Sort by Date for most-recent first; sort by Likes for highest-impact first. Use the chips to filter to JOOLA only, negative only, or comments only."
                source="ig_comments + yt_comments + reddit_mentions + reddit_comments + mention_facts (deduped)"
              />
            </h2>
            <div className="sub">Up to 200 signals. Click any row to open the source thread. Sort by Likes to surface ambassadors and viral complaints.</div>
          </div>
          <div className="actions">
            <div className="chip-row">
              <button className={'chip ' + (feedJoolaOnly ? 'on' : '')} onClick={() => setFeedJoolaOnly((v) => !v)} title="Show only JOOLA-brand signals">JOOLA only</button>
              <button className={'chip ' + (feedNegativeOnly ? 'on' : '')} onClick={() => setFeedNegativeOnly((v) => !v)} title="Show only signals classified as negative">Negative only</button>
              <button className={'chip ' + (feedCommentsOnly ? 'on' : '')} onClick={() => setFeedCommentsOnly((v) => !v)} title="Show only comment signals (hide mentions/crisis-only rows)">Comments only</button>
            </div>
          </div>
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '8px 18px', fontSize: 12, color: 'var(--fg-4)' }}>
            Showing {feedRows.length} of {filteredSignals.length} filtered signals
          </div>
          <div style={{ maxHeight: 480, overflowY: 'auto', overflowX: 'auto' }}>
            <table className="data" style={{ width: '100%', minWidth: 1040 }}>
              <thead>
                <tr>
                  <SortTh col="brand" label="Brand" sortKey={feedSort.key} sortDir={feedSort.dir} toggle={(k) => toggleSort(feedSort, setFeedSort, k)} style={{ textAlign: 'left' }} title="Paddle brand the signal mentions. JOOLA rows highlighted in green." />
                  <SortTh col="sourceLabel" label="Source" sortKey={feedSort.key} sortDir={feedSort.dir} toggle={(k) => toggleSort(feedSort, setFeedSort, k)} style={{ textAlign: 'left' }} title="Where the signal came from — Instagram, YouTube, Reddit, TikTok, or X." />
                  <SortTh col="signalType" label="Type" sortKey={feedSort.key} sortDir={feedSort.dir} toggle={(k) => toggleSort(feedSort, setFeedSort, k)} style={{ textAlign: 'center' }} title="mention = brand named in a post or caption · comment = thread reply or comment · crisis = flagged as a high-risk event" />
                  <SortTh col="summary" label="Summary" sortKey={feedSort.key} sortDir={feedSort.dir} toggle={(k) => toggleSort(feedSort, setFeedSort, k)} style={{ textAlign: 'left' }} title="Short snippet of the signal text. Hover for full text." />
                  <SortTh col="sentiment" label="Sentiment" sortKey={feedSort.key} sortDir={feedSort.dir} toggle={(k) => toggleSort(feedSort, setFeedSort, k)} style={{ textAlign: 'center' }} title="GPT-4o-mini classification: positive / neutral / negative." />
                  <SortTh col="likes" label="Likes" sortKey={feedSort.key} sortDir={feedSort.dir} toggle={(k) => toggleSort(feedSort, setFeedSort, k)} style={{ textAlign: 'right' }} title="Engagement count — likes on IG / YT comments, upvotes on Reddit. Sort by this to surface highest-impact signals." />
                  <SortTh col="isCrisis" label="Risk" sortKey={feedSort.key} sortDir={feedSort.dir} toggle={(k) => toggleSort(feedSort, setFeedSort, k)} style={{ textAlign: 'center' }} title="CRISIS pill = AI flagged this as a recall / safety / coordinated-backlash event needing immediate brand response." />
                  <SortTh col="date" label="Date" sortKey={feedSort.key} sortDir={feedSort.dir} toggle={(k) => toggleSort(feedSort, setFeedSort, k)} style={{ textAlign: 'right' }} title="When the signal was posted. Sort descending for most-recent." />
                  <th title="Open the original post / comment in a new tab.">Link</th>
                </tr>
                <tr className="col-filter-row">
                  <th><ColumnFilter col="brand" value={feedColFilter.brand} onChange={(v) => setFeedColFilter((p) => ({ ...p, brand: v }))} placeholder="filter…" /></th>
                  <th><ColumnFilter col="source" value={feedColFilter.source} onChange={(v) => setFeedColFilter((p) => ({ ...p, source: v }))} placeholder="filter…" /></th>
                  <th />
                  <th><ColumnFilter col="summary" value={feedColFilter.summary} onChange={(v) => setFeedColFilter((p) => ({ ...p, summary: v }))} placeholder="search text…" /></th>
                  <th colSpan={5} />
                </tr>
              </thead>
              <tbody>
                {feedRows.length === 0 && (
                  <tr><td colSpan={9} style={emptyCell}>No community signals in this filter.</td></tr>
                )}
                {feedRows.map((s) => (
                  <tr
                    key={s.uniqueKey}
                    style={{ cursor: s.link ? 'pointer' : 'default' }}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('a')) return
                      setDrillSignal(s)
                    }}
                    title={s.link ? 'Click to open source' : undefined}
                  >
                    <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 99, background: pgColor(s.brand) }} />
                        <span style={{ fontWeight: 600, color: s.brand === 'joola' ? '#22c55e' : 'inherit' }}>{name(s.brand)}</span>
                      </span>
                    </td>
                    <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 99, background: communityChannelColor(String(s.source)) }} />
                        {s.sourceLabel}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={'pill ' + (s.signalType === 'crisis' ? 'pill-red' : s.signalType === 'comment' ? 'pill-info' : 'pill-ghost')} style={{ fontSize: 10 }}>
                        {s.signalType}
                      </span>
                    </td>
                    <td style={{ textAlign: 'left', maxWidth: 380 }}>
                      <span title={s.summary} style={{ display: 'inline-block', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.summary.slice(0, 160)}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={'pill ' + SENT_PILL[s.sentiment]} style={{ fontSize: 10 }}>{s.sentiment}</span>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono', fontSize: 11 }}>
                      {s.likes > 0 ? `♥ ${fmt(s.likes)}` : <span style={{ color: '#3a4150' }}>·</span>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {s.isCrisis
                        ? <span className="pill pill-red" style={{ fontSize: 10, fontWeight: 700 }}>CRISIS</span>
                        : <span style={{ color: '#3a4150' }}>·</span>}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'JetBrains Mono', fontSize: 11 }}>
                      {formatCalendarDate(s.postedAt)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {s.link
                        ? <a href={s.link} target="_blank" rel="noopener noreferrer" className="ext-link" style={{ fontSize: 11 }}>open →</a>
                        : <span style={{ color: '#3a4150' }}>·</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ─── Section 7: Crisis watchlist ──────────────────────────── */}
      <section ref={sec6.ref} className={revealCls(sec6.vis)}>
        <div className="section-head">
          <div>
            <h2>
              Crisis watchlist
              <SectionInfo
                title="Crisis watchlist"
                description="Every signal in the active window that the AI enrichment step flagged as is_crisis=true. mention_facts has no status/severity columns, so we sort by recency and surface a synthetic severity (negative + crisis = critical)."
                source="mention_facts where is_crisis=true"
              />
            </h2>
            <div className="sub">Open incidents first. Investigate, drill into the source thread, then act.</div>
          </div>
        </div>
        {!data.dataStatus.hasIncidentLifecycle && (
          <div className="card" style={{ padding: 14, marginBottom: 12, fontSize: 12, color: '#F5E625', background: 'rgba(245,182,37,0.08)', borderColor: 'rgba(245,182,37,0.3)' }}>
            Incident workflow not yet implemented — showing recent crisis signals from mention_facts (no status / severity tracking yet).
          </div>
        )}
        <div className="card">
          <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
            <table className="data" style={{ width: '100%', minWidth: 980 }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--sticky-bg)', zIndex: 2 }}>
                <tr>
                  <th>Status</th>
                  <SortTh col="brand" label="Brand" sortKey={crisisSort.key} sortDir={crisisSort.dir} toggle={(k) => toggleSort(crisisSort, setCrisisSort, k)} style={{ textAlign: 'left' }} />
                  <SortTh col="sourceLabel" label="Channel" sortKey={crisisSort.key} sortDir={crisisSort.dir} toggle={(k) => toggleSort(crisisSort, setCrisisSort, k)} style={{ textAlign: 'left' }} />
                  <th>Severity</th>
                  <SortTh col="sentiment" label="Sentiment" sortKey={crisisSort.key} sortDir={crisisSort.dir} toggle={(k) => toggleSort(crisisSort, setCrisisSort, k)} />
                  <SortTh col="summary" label="Summary" sortKey={crisisSort.key} sortDir={crisisSort.dir} toggle={(k) => toggleSort(crisisSort, setCrisisSort, k)} style={{ textAlign: 'left' }} />
                  <SortTh col="date" label="First seen" sortKey={crisisSort.key} sortDir={crisisSort.dir} toggle={(k) => toggleSort(crisisSort, setCrisisSort, k)} />
                  <SortTh col="days" label="Age" sortKey={crisisSort.key} sortDir={crisisSort.dir} toggle={(k) => toggleSort(crisisSort, setCrisisSort, k)} />
                  <th>Link</th>
                </tr>
                <tr className="col-filter-row">
                  <th />
                  <th><ColumnFilter col="brand" value={crisisColFilter.brand} onChange={(v) => setCrisisColFilter((p) => ({ ...p, brand: v }))} /></th>
                  <th colSpan={3} />
                  <th><ColumnFilter col="summary" value={crisisColFilter.summary} onChange={(v) => setCrisisColFilter((p) => ({ ...p, summary: v }))} placeholder="search text…" /></th>
                  <th colSpan={3} />
                </tr>
              </thead>
              <tbody>
                {crisisRows.length === 0 && (
                  <tr><td colSpan={9} style={emptyCell}>No crisis signals in the active window.</td></tr>
                )}
                {crisisRows.map((c) => {
                  const severity = c.sentiment === 'negative' ? 'critical' : c.days <= 7 ? 'high' : 'moderate'
                  return (
                    <tr key={c.uniqueKey}>
                      <td style={{ textAlign: 'center' }}>
                        <span className="pill pill-red" style={{ fontSize: 10, fontWeight: 700 }}>OPEN</span>
                      </td>
                      <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 6, height: 6, borderRadius: 99, background: pgColor(c.brand) }} />
                          <span style={{ fontWeight: 600 }}>{name(c.brand)}</span>
                        </span>
                      </td>
                      <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{c.sourceLabel}</td>
                      <td style={{ textAlign: 'center' }}>
                        <span
                          className="pill"
                          style={{
                            background: severity === 'critical' ? 'rgba(239,68,68,0.18)' : severity === 'high' ? 'rgba(251,146,60,0.18)' : 'rgba(245,230,37,0.18)',
                            color: severity === 'critical' ? '#fca5a5' : severity === 'high' ? '#fdba74' : '#fde68a',
                            fontWeight: 700,
                            fontSize: 10,
                          }}
                        >
                          {severity.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={'pill ' + SENT_PILL[c.sentiment]} style={{ fontSize: 10 }}>{c.sentiment}</span>
                      </td>
                      <td style={{ textAlign: 'left', maxWidth: 380 }}>
                        <span title={c.summary} style={{ display: 'inline-block', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.summary.slice(0, 160)}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'JetBrains Mono', fontSize: 11 }}>{formatCalendarDate(c.postedAt)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'JetBrains Mono', fontSize: 11 }}>{c.days}d</td>
                      <td style={{ textAlign: 'center' }}>
                        {c.link
                          ? <a href={c.link} target="_blank" rel="noopener noreferrer" className="ext-link" style={{ fontSize: 11 }}>open →</a>
                          : <span style={{ color: '#3a4150' }}>·</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ─── Section 9: JOOLA community mentions ──────────────────── */}
      <section ref={sec7.ref} className={revealCls(sec7.vis)}>
        <div className="section-head">
          <div>
            <h2>
              JOOLA community mentions
              <SectionInfo
                title="JOOLA community footprint"
                description="JOOLA-specific roll-up: total mentions, channel mix, and the top negative signals you need to know about. When the brand filter is set to JOOLA-only, this collapses into a single summary card to avoid duplicating Sections 3/6/7."
                source="Filtered signals where brand = joola"
              />
            </h2>
            <div className="sub">Where JOOLA shows up in the community — and what people are saying.</div>
          </div>
        </div>
        <JoolaSummary
          signals={filteredSignals.filter((s) => s.brand === 'joola')}
          name={name}
          isJoolaOnly={isFiltered && filteredBrands.every((b) => b.id === 'joola')}
        />
      </section>

      {/* ─── Section A: Competitor Complaint Map ───────────────────── */}
      <section ref={sec8.ref} className={revealCls(sec8.vis)}>
        <div className="section-head">
          <div>
            <h2>
              Competitor complaint map
              <SectionInfo
                title="Competitor complaint map"
                description="Per-brand top complaint topic, crisis count, negative %, and sample comments. Built from is_crisis=true OR sentiment=negative rows across IG / YT / Reddit / TikTok comments. JOOLA opportunity rule: high competitor negative % on a topic → content angle for JOOLA."
                source="ig_comments + yt_comments + reddit_comments + tiktok_comments (crisis_keywords[])"
              />
            </h2>
            <div className="sub">Where each brand is taking heat — and where the opening sits for JOOLA.</div>
          </div>
        </div>
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="data" style={{ width: '100%', minWidth: 980 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Brand</th>
                <th style={{ textAlign: 'left' }}>Top complaint topic</th>
                <th style={{ textAlign: 'right' }}>Crisis</th>
                <th style={{ textAlign: 'right' }}>Negative %</th>
                <th style={{ textAlign: 'left' }}>Examples</th>
                <th style={{ textAlign: 'left' }}>JOOLA opportunity</th>
              </tr>
            </thead>
            <tbody>
              {complaints.length === 0 && (
                <tr><td colSpan={6} style={emptyCell}>No complaint signals in the active window.</td></tr>
              )}
              {complaints.map((r) => {
                const isJoola = r.brand === 'joola'
                return (
                  <tr key={r.brand} style={isJoola ? { borderLeft: '3px solid #22c55e', background: 'rgba(34,197,94,0.04)' } : {}}>
                    <td style={{ textAlign: 'left' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: pgColor(r.brand) }} />
                        <span style={{ fontWeight: 700, color: isJoola ? '#22c55e' : 'inherit' }}>{name(r.brand)}</span>
                      </span>
                    </td>
                    <td style={{ textAlign: 'left', fontStyle: r.topTopic === '(uncategorized)' ? 'italic' : 'normal', color: r.topTopic === '(uncategorized)' ? 'var(--fg-4)' : 'inherit' }}>
                      {r.topTopic}
                    </td>
                    <td style={{ textAlign: 'right', color: r.crisisCount > 0 ? '#ef4444' : 'inherit', fontWeight: r.crisisCount > 0 ? 700 : 400 }}>
                      {r.crisisCount || <span style={{ color: '#3a4150' }}>·</span>}
                    </td>
                    <td style={{ textAlign: 'right', color: r.negativePct >= 30 ? '#ef4444' : r.negativePct >= 15 ? '#F5E625' : 'inherit' }}>
                      {r.negativePct}%
                    </td>
                    <td style={{ textAlign: 'left', maxWidth: 360 }}>
                      {r.examples.length === 0
                        ? <span style={{ color: '#3a4150' }}>·</span>
                        : (
                          <div style={{ display: 'grid', gap: 4 }}>
                            {r.examples.map((ex, i) => (
                              <div key={i} title={ex} style={{ fontSize: 11, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 340 }}>
                                "{ex.slice(0, 100)}"
                              </div>
                            ))}
                          </div>
                        )
                      }
                    </td>
                    <td style={{ textAlign: 'left', fontSize: 12, color: isJoola ? 'var(--fg-3)' : '#fde68a' }}>{r.opportunity}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <ImpactCards
          competitorMove="Competitors absorbing negative voice on durability, grip, and warranty topics."
          businessImpact="High negative % concentrates buyer doubt on weak points — JOOLA can convert it."
          recommendedAction="Pick the top-2 competitor weakness topics and ship comparison content + retargeting copy this week."
        />
      </section>

      {/* ─── Section B: Defection Signals ───────────────────────────── */}
      <section ref={sec9.ref} className={revealCls(sec9.vis)}>
        <div className="section-head">
          <div>
            <h2>
              Defection signals
              <SectionInfo
                title="Defection signals (switching intent)"
                description="From competitor_switch_events — confirmed 'I switched from X to Y' moments. Grouped by (from, to) brand pair with avg confidence + an example quote."
                source="competitor_switch_events"
              />
            </h2>
            <div className="sub">Who is moving, where, and how confident the signal is.</div>
          </div>
        </div>
        {defection && (
          <div className="kpi-grid" style={{ marginBottom: 10 }}>
            <div className="ov-kpi" style={{ '--ov-d': '160ms' } as React.CSSProperties}><MiniKpi label="JOOLA inflow" value={fmt(defection.kpis.joolaInflow)} color="#22c55e" customVs="switches into JOOLA" flavor="joola" /></div>
            <div className="ov-kpi" style={{ '--ov-d': '235ms' } as React.CSSProperties}><MiniKpi label="JOOLA outflow" value={fmt(defection.kpis.joolaOutflow)} color={defection.kpis.joolaOutflow > 0 ? '#ef4444' : '#22c55e'} customVs="switches away from JOOLA" /></div>
            <div className="ov-kpi" style={{ '--ov-d': '310ms' } as React.CSSProperties}><MiniKpi label="JOOLA net" value={(defection.kpis.joolaNet >= 0 ? '+' : '') + fmt(defection.kpis.joolaNet)} color={defection.kpis.joolaNet >= 0 ? '#22c55e' : '#ef4444'} customVs="inflow − outflow" /></div>
            <div className="ov-kpi" style={{ '--ov-d': '385ms' } as React.CSSProperties}><MiniKpi label="Total switches" value={fmt(defection.kpis.totalSwitches)} color="#06b6d4" customVs="all brand-pair moves" /></div>
          </div>
        )}
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="data" style={{ width: '100%', minWidth: 920 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>From</th>
                <th style={{ textAlign: 'left' }}>To</th>
                <th style={{ textAlign: 'right' }}>Count</th>
                <th style={{ textAlign: 'right' }}>Confidence</th>
                <th style={{ textAlign: 'left' }}>Example</th>
                <th style={{ textAlign: 'left' }}>Opportunity</th>
              </tr>
            </thead>
            <tbody>
              {(!defection || defection.rows.length === 0) && (
                <tr><td colSpan={6} style={emptyCell}>No defection signals in the window — table populates after competitor_switch.py enrichment runs.</td></tr>
              )}
              {defection?.rows.map((r) => {
                const isJoolaInflow = r.toBrand === 'joola'
                const isJoolaOutflow = r.fromBrand === 'joola'
                return (
                  <tr key={`${r.fromBrand}::${r.toBrand}`} style={isJoolaInflow ? { borderLeft: '3px solid #22c55e', background: 'rgba(34,197,94,0.04)' } : isJoolaOutflow ? { borderLeft: '3px solid #ef4444', background: 'rgba(239,68,68,0.04)' } : {}}>
                    <td style={{ textAlign: 'left' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: pgColor(r.fromBrand) }} />
                        <span style={{ fontWeight: 600 }}>{name(r.fromBrand)}</span>
                      </span>
                    </td>
                    <td style={{ textAlign: 'left' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: pgColor(r.toBrand) }} />
                        <span style={{ fontWeight: 700, color: r.toBrand === 'joola' ? '#22c55e' : 'inherit' }}>{name(r.toBrand)}</span>
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(r.count)}</td>
                    <td style={{ textAlign: 'right' }}>{r.confidence.toFixed(2)}</td>
                    <td style={{ textAlign: 'left', maxWidth: 360 }}>
                      <span title={r.exampleText} style={{ display: 'inline-block', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: 'var(--fg-3)' }}>
                        {r.exampleText ? `"${r.exampleText.slice(0, 140)}"` : '—'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'left', fontSize: 12, color: '#fde68a' }}>{r.opportunity}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <ImpactCards
          competitorMove="Real users are publicly switching brands — every row is a captured purchase decision."
          businessImpact="Net defection is the leading indicator of share shift before sales data registers it."
          recommendedAction="Reach out to JOOLA-inflow authors for testimonials; investigate any outflow root-cause within 7 days."
        />
      </section>

      {/* ─── Section C: Topic Lifecycle Radar ───────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Topic lifecycle radar
              <SectionInfo
                title="Topic lifecycle radar"
                description="From topic_lifecycle — emergent topics with first-seen channel, peak date, channels touched, crisis flag. Use to spot a trend before competitors react."
                source="topic_lifecycle"
              />
            </h2>
            <div className="sub">Earliest channel + decay state per tracked topic.</div>
          </div>
        </div>
        {topicLifecycle.length === 0 ? (
          <div className="card" style={{ padding: 18, fontSize: 13, color: '#F5E625', background: 'rgba(245,182,37,0.08)', borderColor: 'rgba(245,182,37,0.3)' }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Pipeline pending — no topic_lifecycle rows.</div>
            <div style={{ fontSize: 12, color: 'var(--fg-2)', marginBottom: 4 }}>
              The topic_lifecycle table is empty in the active window. Known issue: <code style={{ fontSize: 11 }}>backend/scraping/facts/topic_lifecycle.py</code> currently fails with PGRST204 brand_id when populating.
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>
              <strong>USER ACTION:</strong> patch topic_lifecycle.py to drop brand_id from its insert payload, then re-run the facts module.
            </div>
          </div>
        ) : (
          <div className="card" style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
            <table className="data" style={{ width: '100%', minWidth: 960 }}>
              <thead>
                <tr>
                  <SortTh col="topic" label="Topic" sortKey={topicSort.key} sortDir={topicSort.dir} toggle={(k) => toggleSort(topicSort, setTopicSort, k)} style={{ textAlign: 'left' }} title="Topic name detected across community signals." />
                  <SortTh col="firstSeenChannel" label="First Channel" sortKey={topicSort.key} sortDir={topicSort.dir} toggle={(k) => toggleSort(topicSort, setTopicSort, k)} style={{ textAlign: 'left' }} title="The channel where this topic was first detected." />
                  <SortTh col="peakDate" label="Peak Date" sortKey={topicSort.key} sortDir={topicSort.dir} toggle={(k) => toggleSort(topicSort, setTopicSort, k)} style={{ textAlign: 'left' }} title="Date when mentions peaked." />
                  <SortTh col="peakMentions" label="Peak / 24h" sortKey={topicSort.key} sortDir={topicSort.dir} toggle={(k) => toggleSort(topicSort, setTopicSort, k)} style={{ textAlign: 'right' }} title="Highest mention count in a single 24-hour window." />
                  <SortTh col="channelCount" label="Channels" sortKey={topicSort.key} sortDir={topicSort.dir} toggle={(k) => toggleSort(topicSort, setTopicSort, k)} style={{ textAlign: 'left' }} title="Number of distinct channels the topic has spread to." />
                  <SortTh col="isCrisis" label="Crisis" sortKey={topicSort.key} sortDir={topicSort.dir} toggle={(k) => toggleSort(topicSort, setTopicSort, k)} style={{ textAlign: 'center' }} title="AI-flagged as a crisis-level topic." />
                  <SortTh col="action" label="Action" sortKey={topicSort.key} sortDir={topicSort.dir} toggle={(k) => toggleSort(topicSort, setTopicSort, k)} style={{ textAlign: 'left' }} title="Recommended action based on topic decay state and crisis flag." />
                </tr>
              </thead>
              <tbody>
                {sortedTopicLifecycle.map((r, i) => (
                  <tr key={r.topic + i}>
                    <td style={{ textAlign: 'left', fontWeight: 700 }}>{r.topic}</td>
                    <td style={{ textAlign: 'left' }}>{r.firstSeenChannel}</td>
                    <td style={{ textAlign: 'left', fontFamily: 'JetBrains Mono', fontSize: 11 }}>
                      {r.peakDate ? formatCalendarDate(r.peakDate) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(r.peakMentions)}</td>
                    <td style={{ textAlign: 'left' }}>
                      <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                        {r.channelsTouched.length === 0
                          ? <span style={{ color: '#3a4150' }}>·</span>
                          : r.channelsTouched.map((c) => (
                            <span key={c} className="pill pill-ghost" style={{ fontSize: 9 }}>{c}</span>
                          ))}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {r.isCrisis
                        ? <span className="pill pill-red" style={{ fontSize: 10, fontWeight: 700 }}>YES</span>
                        : <span style={{ color: '#3a4150' }}>·</span>}
                    </td>
                    <td style={{ textAlign: 'left', fontSize: 12, color: r.isCrisis ? '#fb923c' : 'var(--fg-3)' }}>{r.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Section D: Brand Reply Advantage ───────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Brand reply advantage
              <SectionInfo
                title="Brand reply advantage"
                description="Per-brand response-time and reply rate. Currently sourced from brand_replies — which is not in the default weekly scheduler."
                source="brand_replies"
              />
            </h2>
            <div className="sub">Who responds fast and who lets complaints sit.</div>
          </div>
        </div>
        {brandReplies.length === 0 ? (
          <div className="card" style={{ padding: 18, fontSize: 13, color: '#F5E625', background: 'rgba(245,182,37,0.08)', borderColor: 'rgba(245,182,37,0.3)' }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Pipeline pending — no brand_replies rows.</div>
            <div style={{ fontSize: 12, color: 'var(--fg-2)', marginBottom: 4 }}>
              The brand_replies table exists but is empty because <code style={{ fontSize: 11 }}>detect_brand_replies.py</code> is not currently invoked by the weekly scheduler.
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>
              <strong>USER ACTION:</strong> add <code style={{ fontSize: 11 }}>detect_brand_replies.py</code> to <code style={{ fontSize: 11 }}>scripts/scraping/run.py</code> facts module list so it runs each Monday.
            </div>
          </div>
        ) : (
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="data" style={{ width: '100%', minWidth: 860 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Brand</th>
                  <th style={{ textAlign: 'right' }}>Avg response</th>
                  <th style={{ textAlign: 'right' }}>Complaints replied</th>
                  <th style={{ textAlign: 'right' }}>Complaints ignored</th>
                  <th style={{ textAlign: 'center' }}>Rank</th>
                </tr>
              </thead>
              <tbody>
                {brandReplies.map((r) => {
                  const isJoola = r.brand === 'joola'
                  return (
                    <tr key={r.brand} style={isJoola ? { borderLeft: '3px solid #22c55e', background: 'rgba(34,197,94,0.04)' } : {}}>
                      <td style={{ textAlign: 'left' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 999, background: pgColor(r.brand) }} />
                          <span style={{ fontWeight: 700, color: isJoola ? '#22c55e' : 'inherit' }}>{name(r.brand)}</span>
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>{r.avgResponseMins === null ? '—' : `${fmt(r.avgResponseMins)} min`}</td>
                      <td style={{ textAlign: 'right', color: '#22c55e' }}>{fmt(r.complaintsReplied)}</td>
                      <td style={{ textAlign: 'right', color: r.complaintsIgnored > 0 ? '#ef4444' : 'inherit' }}>{fmt(r.complaintsIgnored)}</td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>#{r.joolaRank}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Section 10: Review required ──────────────────────────── */}
      {(data.dataStatus.mentionFactsTotal === 0 || sentimentCoverage < 0.2) && (
        <section>
          <div className="card" style={{ padding: 16 }}>
            <h6 style={{ marginTop: 0, color: '#F5E625' }}>Review required</h6>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--fg-2)', fontSize: 12, lineHeight: 1.7 }}>
              {data.dataStatus.mentionFactsTotal === 0 && (
                <li>
                  <strong>mention_facts is empty</strong> — Crisis watchlist + sentiment coverage will stay sparse until
                  the enrichment pipeline (`scripts/scraping/facts/mention_facts.py`) is run.
                </li>
              )}
              {sentimentCoverage < 0.2 && (
                <li>
                  <strong>Sentiment classifier coverage at {Math.round(sentimentCoverage * 100)}%</strong> — only that
                  fraction of signals carries a sentiment_label. Re-run the AI enrichment step to backfill.
                </li>
              )}
              {!data.dataStatus.hasIncidentLifecycle && (
                <li>
                  <strong>No incident lifecycle</strong> — mention_facts has no status / severity / assigned-to columns.
                  Crisis watchlist surfaces recent flags only, not an actionable workflow.
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

function SummaryItem({ label, value, color, tip }: { label: string; value: string; color?: string; tip?: string }) {
  return (
    <div
      title={tip}
      style={{
        display: 'inline-flex', flexDirection: 'column', minWidth: 80,
        padding: '2px 16px',
        cursor: tip ? 'help' : 'default',
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 800, color: color || '#fff', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )
}

/**
 * Reusable framing cards rendered below intel sections.
 * Three cards: Competitor move / Business impact / Recommended JOOLA action.
 */
function ImpactCards({
  competitorMove, businessImpact, recommendedAction,
}: {
  competitorMove: string; businessImpact: string; recommendedAction: string
}) {
  const card: React.CSSProperties = {
    padding: 14,
    background: 'var(--wb-3)',
    border: '1px solid var(--wb-8)',
    borderRadius: 8,
    fontSize: 12,
    color: 'var(--fg-2)',
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginTop: 12 }}>
      <div style={card}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#06b6d4', marginBottom: 4 }}>Competitor move</div>
        <div>{competitorMove}</div>
      </div>
      <div style={card}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#F5E625', marginBottom: 4 }}>Business impact</div>
        <div>{businessImpact}</div>
      </div>
      <div style={{ ...card, borderColor: 'rgba(34,197,94,0.30)', background: 'rgba(34,197,94,0.06)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#22c55e', marginBottom: 4 }}>Recommended JOOLA action</div>
        <div>{recommendedAction}</div>
      </div>
    </div>
  )
}

function CommunityTrendChart({ points }: { points: TrendPoint[] }) {
  const w = 920
  const h = 220
  const padL = 36
  const padR = 100
  const padT = 14
  const padB = 28

  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const hasData = points.length > 0 && !points.every((p) => p.crisis === 0 && p.joola === 0 && p.negative === 0)
  if (!hasData) {
    return <div style={{ color: '#6b7280', fontSize: 13, padding: '32px 0', textAlign: 'center' }}>No signals in the window.</div>
  }

  // Series — Total removed per UX feedback (was visually dominant + duplicative of channel-mix view)
  const series = [
    { id: 'joola', label: 'JOOLA mentions', color: '#22c55e', desc: 'Conversation specifically about JOOLA' },
    { id: 'negative', label: 'Negative sentiment', color: '#fb923c', desc: 'Signals classified as negative across all brands' },
    { id: 'crisis', label: 'Crisis signals', color: '#ef4444', desc: 'Crisis-flagged signals (recalls, warranty issues, public complaints)' },
  ] as const

  const max = Math.max(1, ...points.flatMap((p) => series.map((s) => p[s.id as 'crisis' | 'joola' | 'negative'])))
  const N = points.length
  const x = (i: number) => padL + (i / Math.max(1, N - 1)) * (w - padL - padR)
  const y = (v: number) => padT + (h - padT - padB) * (1 - v / max)

  function build(key: 'crisis' | 'joola' | 'negative'): string {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ')
  }

  const last = points[points.length - 1]
  const endLabels = series.map((s) => ({ id: s.id, color: s.color, label: s.label, y: y(last[s.id as 'crisis' | 'joola' | 'negative']) }))
  endLabels.sort((a, b) => a.y - b.y)
  const minGap = 14
  for (let i = 1; i < endLabels.length; i++) {
    if (endLabels[i].y < endLabels[i - 1].y + minGap) endLabels[i].y = endLabels[i - 1].y + minGap
  }

  const hoverPoint = hoverIdx !== null ? points[hoverIdx] : null

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    // Convert mouse x to viewBox x then to index
    const localX = ((e.clientX - rect.left) / rect.width) * w
    if (localX < padL || localX > w - padR) { setHoverIdx(null); return }
    const ratio = (localX - padL) / (w - padL - padR)
    const idx = Math.max(0, Math.min(N - 1, Math.round(ratio * (N - 1))))
    setHoverIdx(idx)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onMouseMove={onMove} onMouseLeave={() => setHoverIdx(null)}>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8, fontSize: 11, color: 'var(--fg-2)' }}>
        {series.map((s) => (
          <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title={s.desc}>
            <span style={{ width: 14, height: 3, background: s.color, borderRadius: 2, display: 'inline-block' }} />
            <span style={{ color: s.color, fontWeight: 700 }}>{s.label}</span>
          </span>
        ))}
      </div>

      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
        {[0, Math.ceil(max / 2), max].map((tick) => (
          <g key={tick}>
            <line x1={padL} x2={w - padR} y1={y(tick)} y2={y(tick)} stroke="var(--wb-6)" strokeDasharray="2 4" />
            <text x={padL - 6} y={y(tick) + 3} textAnchor="end" fontSize={10} fill="#6b7280">{tick}</text>
          </g>
        ))}
        {series.map((s) => (
          <path key={s.id} d={build(s.id as 'crisis' | 'joola' | 'negative')} fill="none" stroke={s.color} strokeWidth={1.7} strokeLinejoin="round" />
        ))}
        {endLabels.map((lb) => (
          <text key={lb.id} x={w - padR + 6} y={lb.y + 3} fontSize={10} fill={lb.color} fontWeight={700}>
            {lb.label.split(' ')[0]}: {last[lb.id as 'crisis' | 'joola' | 'negative']}
          </text>
        ))}
        {[0, Math.floor(N / 2), N - 1].map((i) =>
          points[i] ? (
            <text key={i} x={x(i)} y={h - padB + 16} textAnchor="middle" fontSize={10} fill="#6b7280">
              {points[i].date.slice(5)}
            </text>
          ) : null,
        )}
        {/* Crosshair + dots */}
        {hoverIdx !== null && hoverPoint && (
          <g pointerEvents="none">
            <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={padT} y2={h - padB} stroke="rgba(255,255,255,0.25)" strokeDasharray="2 3" />
            {series.map((s) => (
              <circle
                key={s.id}
                cx={x(hoverIdx)}
                cy={y(hoverPoint[s.id as 'crisis' | 'joola' | 'negative'])}
                r={4}
                fill={s.color}
                stroke="var(--bg)"
                strokeWidth={2}
              />
            ))}
          </g>
        )}
      </svg>

      {/* Hover tooltip */}
      {hoverIdx !== null && hoverPoint && wrapRef.current && (
        <div
          style={{
            position: 'absolute',
            left: `${Math.min(82, Math.max(2, (x(hoverIdx) / w) * 100))}%`,
            top: 22,
            transform: 'translateX(-50%)',
            background: 'rgba(7,9,14,0.95)',
            border: '1px solid var(--wb-14)',
            borderRadius: 6,
            padding: '8px 10px',
            fontSize: 11,
            color: '#cbd1dc',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 2,
            boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
          }}
        >
          <div style={{ fontWeight: 700, color: '#fff', marginBottom: 4 }}>{hoverPoint.date}</div>
          {series.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: s.color, display: 'inline-block' }} />
              <span style={{ color: s.color }}>{s.label}:</span>
              <span style={{ color: '#fff', fontWeight: 700 }}>{hoverPoint[s.id as 'crisis' | 'joola' | 'negative']}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ChannelMixDonut({ rows }: { rows: { channel: string; label: string; color: string; total: number; crisis: number }[] }) {
  const [centerHov, setCenterHov] = useState(false)
  const [hovArc, setHovArc] = useState<string | null>(null)
  const total = rows.reduce((s, r) => s + r.total, 0)
  if (total === 0) {
    return <div style={{ color: '#6b7280', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>No data</div>
  }
  const size = 260
  const r = 100
  const inner = 58
  const cx = size / 2
  const cy = size / 2
  let acc = 0
  const arcs = rows.map((row) => {
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2
    acc += row.total
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2
    const large = row.total / total > 0.5 ? 1 : 0
    const rH = r + 4, iH = inner - 2
    const x0 = cx + r * Math.cos(start), y0 = cy + r * Math.sin(start)
    const x1 = cx + r * Math.cos(end), y1 = cy + r * Math.sin(end)
    const x2 = cx + inner * Math.cos(end), y2 = cy + inner * Math.sin(end)
    const x3 = cx + inner * Math.cos(start), y3 = cy + inner * Math.sin(start)
    const d = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${inner} ${inner} 0 ${large} 0 ${x3} ${y3} Z`
    const xH0 = cx + rH * Math.cos(start), yH0 = cy + rH * Math.sin(start)
    const xH1 = cx + rH * Math.cos(end), yH1 = cy + rH * Math.sin(end)
    const xH2 = cx + iH * Math.cos(end), yH2 = cy + iH * Math.sin(end)
    const xH3 = cx + iH * Math.cos(start), yH3 = cy + iH * Math.sin(start)
    const dH = `M ${xH0} ${yH0} A ${rH} ${rH} 0 ${large} 1 ${xH1} ${yH1} L ${xH2} ${yH2} A ${iH} ${iH} 0 ${large} 0 ${xH3} ${yH3} Z`
    return { ...row, d, dH }
  })
  const anyHov = hovArc !== null
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
          {arcs.map((a) => {
            const isHov = hovArc === a.channel
            return (
              <g key={a.channel} style={{ cursor: 'pointer' }}
                onMouseEnter={() => { setHovArc(a.channel); setCenterHov(false) }}
                onMouseLeave={() => setHovArc(null)}>
                <path d={a.d} fill={a.color}
                  opacity={anyHov && !isHov ? 0.5 : 1}
                  style={{ transition: 'opacity 200ms ease' }} />
                {isHov && (
                  <path d={a.dH} fill={a.color} opacity={0.95}
                    style={{ filter: `drop-shadow(0 0 6px ${a.color}88)` }} />
                )}
              </g>
            )
          })}
          <text x={cx} y={cy - 4} textAnchor="middle"
            fontSize={hovArc ? 13 : 18} fontWeight={800} fill="#fff"
            style={{ transition: 'font-size 150ms ease', pointerEvents: 'none' }}>
            {hovArc ? (arcs.find(a => a.channel === hovArc)?.total.toLocaleString() ?? total) : total}
          </text>
          {hovArc && (
            <text x={cx} y={cy + 14} textAnchor="middle" fontSize={9} fill="#94a3b8"
              style={{ pointerEvents: 'none' }}>
              {arcs.find(a => a.channel === hovArc)?.label}
            </text>
          )}
          <circle cx={cx} cy={cy} r={inner - 2} fill="transparent"
            onMouseEnter={() => setCenterHov(true)} onMouseLeave={() => setCenterHov(false)} />
        </svg>
        {centerHov && (
          <div className="tip" style={{ left: '50%', top: '50%' }}>
            <div className="t-name">{rows.length} channel{rows.length !== 1 ? 's' : ''}</div>
            {total.toLocaleString()} total signals
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '10px 1fr auto auto', alignItems: 'center', columnGap: 8, rowGap: 7, fontSize: 12, flex: 1, minWidth: 0 }}>
        {arcs.map((a) => {
          const isHov = hovArc === a.channel
          return (
            <Fragment key={a.channel}>
              <span style={{ width: 10, height: 10, background: a.color, borderRadius: 2, justifySelf: 'center', opacity: anyHov && !isHov ? 0.5 : 1, transition: 'opacity 200ms' }} />
              <span style={{ color: isHov ? '#fff' : '#cbd1dc', fontWeight: isHov ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', transition: 'color 150ms' }}>{a.label}</span>
              <span style={{ color: isHov ? a.color : '#fff', fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums', transition: 'color 150ms' }}>{a.total.toLocaleString()}</span>
              <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 10, whiteSpace: 'nowrap', paddingLeft: 2 }}>
                {a.crisis > 0 ? `· ${a.crisis}` : ''}
              </span>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
function BrandChannelHeatmap({
  rows, brands, name,
}: {
  rows: HeatmapCell[]; brands: V2Brand[]; name: (s: string) => string
}) {
  if (rows.length === 0) {
    return <div style={{ color: '#6b7280', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>No data in the window.</div>
  }
  const brandSlugs = Array.from(new Set(rows.map((r) => r.brand))).sort((a, b) => {
    const aTotal = rows.filter((r) => r.brand === a).reduce((s, r) => s + r.total, 0)
    const bTotal = rows.filter((r) => r.brand === b).reduce((s, r) => s + r.total, 0)
    return bTotal - aTotal
  })
  const channels = Array.from(new Set(rows.map((r) => r.channel))).sort((a, b) => {
    const aTotal = rows.filter((r) => r.channel === a).reduce((s, r) => s + r.total, 0)
    const bTotal = rows.filter((r) => r.channel === b).reduce((s, r) => s + r.total, 0)
    return bTotal - aTotal
  })
  const lookup = new Map<string, HeatmapCell>()
  for (const r of rows) lookup.set(`${r.brand}::${r.channel}`, r)
  const max = Math.max(1, ...rows.map((r) => r.total))
  void brands

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 12, minWidth: '100%' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#8a93a4', fontWeight: 600 }}>Brand</th>
            {channels.map((c) => (
              <th key={c} style={{ padding: '6px 8px', color: '#8a93a4', fontWeight: 600, textAlign: 'center' }}>
                {communityChannelLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {brandSlugs.map((slug) => (
            <tr key={slug}>
              <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: pgColor(slug), display: 'inline-block' }} />
                  <span style={{ color: '#fff', fontWeight: 600 }}>{name(slug)}</span>
                </span>
              </td>
              {channels.map((c) => {
                const cell = lookup.get(`${slug}::${c}`)
                const v = cell?.total || 0
                const crisis = cell?.crisis || 0
                const intensity = v / max
                const bg = v === 0 ? 'transparent' : `rgba(6,182,212,${0.15 + intensity * 0.55})`
                return (
                  <td
                    key={c}
                    style={{
                      padding: '4px 6px', textAlign: 'center', background: bg,
                      color: v > 0 ? '#fff' : '#3a4150', fontWeight: v > 0 ? 700 : 400,
                      borderRadius: 4, cursor: v > 0 ? 'help' : 'default',
                      position: 'relative',
                    }}
                    title={v > 0
                      ? `${name(slug)} on ${communityChannelLabel(c)}: ${v} signals · ${crisis} crisis · ${cell?.negative || 0} negative`
                      : ''}
                  >
                    {v > 0 ? v : '·'}
                    {crisis > 0 && (
                      <span style={{
                        position: 'absolute', top: 2, right: 2, width: 6, height: 6,
                        borderRadius: 99, background: '#ef4444',
                      }} />
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function JoolaSummary({
  signals, isJoolaOnly,
}: {
  signals: CommunitySignal[]
  name: (s: string) => string
  isJoolaOnly: boolean
}) {
  if (signals.length === 0) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
        No JOOLA community mentions in the active window.
      </div>
    )
  }

  const channelBreakdown = new Map<string, number>()
  for (const s of signals) channelBreakdown.set(String(s.source), (channelBreakdown.get(String(s.source)) || 0) + 1)

  const negative = signals.filter((s) => s.sentiment === 'negative')
  const topNegative = [...negative].sort((a, b) => b.likes - a.likes).slice(0, 6)
  const positive = signals.filter((s) => s.sentiment === 'positive').length
  const negCount = negative.length
  const crisisCount = signals.filter((s) => s.isCrisis).length

  if (isJoolaOnly) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', fontSize: 13, color: 'var(--fg-2)' }}>
          <SummaryItem label="JOOLA total" value={fmt(signals.length)} color="#22c55e" />
          <SummaryItem label="Positive" value={fmt(positive)} color="#22c55e" />
          <SummaryItem label="Negative" value={fmt(negCount)} color={negCount > 0 ? '#ef4444' : undefined} />
          <SummaryItem label="Crisis" value={fmt(crisisCount)} color={crisisCount > 0 ? '#ef4444' : undefined} />
          <SummaryItem
            label="Top channel"
            value={Array.from(channelBreakdown.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
              ? communityChannelLabel(Array.from(channelBreakdown.entries()).sort((a, b) => b[1] - a[1])[0][0])
              : '—'}
          />
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--fg-4)' }}>
          Brand filter is JOOLA-only — see Sections 3 / 6 / 7 above for the full trend and per-comment breakdown.
        </div>
      </div>
    )
  }

  return (
    <div className="two-col">
      <div className="card" style={{ padding: 16 }}>
        <h6 style={{ marginTop: 0 }}>JOOLA channel breakdown</h6>
        <div style={{ display: 'grid', gap: 8 }}>
          {Array.from(channelBreakdown.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([ch, count]) => {
              const pct = Math.round((count / signals.length) * 100)
              return (
                <div key={ch} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 60px', gap: 8, alignItems: 'center', fontSize: 12 }}>
                  <span>
                    <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 99, background: communityChannelColor(ch), marginRight: 6 }} />
                    {communityChannelLabel(ch)}
                  </span>
                  <div style={{ height: 6, background: 'var(--wb-5)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: '#22c55e' }} />
                  </div>
                  <span style={{ textAlign: 'right', fontFamily: 'JetBrains Mono', color: '#fff', fontWeight: 700 }}>{count}</span>
                </div>
              )
            })}
        </div>
      </div>
      <div className="card" style={{ padding: 16 }}>
        <h6 style={{ marginTop: 0 }}>Top JOOLA negatives</h6>
        {topNegative.length === 0 ? (
          <div style={{ color: '#22c55e', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>No negative JOOLA mentions in this window.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {topNegative.map((c) => (
              <div key={c.uniqueKey} style={{ borderLeft: '3px solid #ef4444', padding: '8px 10px', fontSize: 12, background: 'rgba(239,68,68,0.06)', borderRadius: 4 }}>
                <div style={{ color: '#cbd1dc', marginBottom: 4 }}>{c.summary.slice(0, 220)}</div>
                <div style={{ fontSize: 10, color: '#6b7280', fontFamily: 'JetBrains Mono', display: 'flex', gap: 10 }}>
                  <span>{c.sourceLabel}</span>
                  <span>♥ {fmt(c.likes)}</span>
                  <span>{formatCalendarDate(c.postedAt)}</span>
                  {c.link && <a href={c.link} target="_blank" rel="noopener noreferrer" className="ext-link">open →</a>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sort helpers ────────────────────────────────────────────────────

function toggleSort<S extends { key: string; dir: 'asc' | 'desc' }>(
  current: S,
  set: (next: S) => void,
  k: string,
): void {
  if (current.key === k) {
    set({ ...current, dir: current.dir === 'asc' ? 'desc' : 'asc' })
  } else {
    set({ ...current, key: k, dir: 'desc' })
  }
}

function sortRows<T extends Record<string, unknown>>(rows: T[], key: string, dir: 'asc' | 'desc'): T[] {
  if (!key) return rows
  const k = key as keyof T
  return [...rows].sort((a, b) => {
    const av = a[k]
    const bv = b[k]
    if (typeof av === 'number' && typeof bv === 'number') {
      return dir === 'asc' ? av - bv : bv - av
    }
    if (typeof av === 'boolean' && typeof bv === 'boolean') {
      return dir === 'asc' ? (av === bv ? 0 : av ? 1 : -1) : (av === bv ? 0 : av ? -1 : 1)
    }
    const as = String(av ?? '')
    const bs = String(bv ?? '')
    return dir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
  })
}

// ─── Single-signal detail dialog ─────────────────────────────────────
function SignalDetailDialog({
  signal: s, brandName, onClose,
}: {
  signal: import('@/lib/v2/communityIntel').CommunitySignal
  brandName: string
  onClose: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const SENT_COLOR: Record<string, string> = { positive: '#22c55e', negative: '#ef4444', neutral: '#94a3b8', unknown: '#6b7280' }
  const sentColor = SENT_COLOR[s.sentiment] || '#6b7280'
  const chColor = { ig: '#e1306c', yt: '#ff0000', reddit: '#ff4500', tiktok: '#69c9d0', x: '#1d9bf0' }[String(s.source).split('_')[0]] || '#6b7280'

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--bg)', border: '1px solid var(--wb-10)', borderRadius: 14, width: '100%', maxWidth: 640, boxShadow: '0 32px 80px rgba(0,0,0,0.8)', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: `${chColor}22`, color: chColor, border: `1px solid ${chColor}44` }}>
            {s.sourceLabel}
          </span>
          {s.isCrisis && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
              ⚠ CRISIS
            </span>
          )}
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: `${sentColor}18`, color: sentColor, border: `1px solid ${sentColor}33` }}>
            {s.sentiment}
          </span>
          <span style={{ marginLeft: 'auto', color: '#6b7280', fontSize: 11, fontFamily: 'JetBrains Mono' }}>{formatCalendarDate(s.postedAt)}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 20, cursor: 'pointer', lineHeight: 1, marginLeft: 8 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Brand + type */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: pgColor(s.brand), flexShrink: 0 }} />
            <span style={{ fontWeight: 700, color: s.brand === 'joola' ? '#22c55e' : '#fff' }}>{brandName}</span>
            <span style={{ color: '#6b7280' }}>·</span>
            <span style={{ color: '#94a3b8', textTransform: 'capitalize' }}>{s.signalType}</span>
            {s.likes > 0 && (
              <>
                <span style={{ color: '#6b7280' }}>·</span>
                <span style={{ color: '#94a3b8' }}>♥ {fmt(s.likes)} likes</span>
              </>
            )}
          </div>

          {/* Full text */}
          <div style={{ fontSize: 14, color: '#e2e8f0', lineHeight: 1.7, background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '14px 16px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {s.summary || '(no content)'}
          </div>

          {/* Meta row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
            {[
              ['Source', s.sourceLabel],
              ['Signal type', s.signalType],
              ['Posted', formatCalendarDate(s.postedAt)],
              ['Days ago', `${s.days} day${s.days !== 1 ? 's' : ''}`],
            ].map(([label, val]) => (
              <div key={label} style={{ background: 'var(--wb-3)', borderRadius: 6, padding: '8px 12px' }}>
                <div style={{ color: '#6b7280', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>{label}</div>
                <div style={{ color: '#cbd1dc' }}>{val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Press Esc to close</span>
          {s.link
            ? <a href={s.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa', textDecoration: 'none', padding: '6px 14px', border: '1px solid rgba(96,165,250,0.3)', borderRadius: 6, background: 'rgba(96,165,250,0.08)' }}>
                View original source →
              </a>
            : <span style={{ fontSize: 11, color: '#3a4150' }}>No source link available</span>
          }
        </div>
      </div>
    </div>
  )
}

// ─── Signal drill-down dialog ─────────────────────────────────────────
function SignalDialog({
  brand, brandName, signals, onClose,
}: {
  brand: string; brandName: string
  signals: import('@/lib/v2/communityIntel').CommunitySignal[]
  onClose: () => void
}) {
  const [tab, setTab] = useState<'crisis' | 'negative'>('crisis')

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const crisis   = signals.filter(s => s.brand === brand && s.isCrisis)
  const negative = signals.filter(s => s.brand === brand && s.sentiment === 'negative' && !s.isCrisis)
  const list     = tab === 'crisis' ? crisis : negative
  const empty    = tab === 'crisis' ? 'No crisis signals for this brand in the current window.' : 'No negative signals for this brand in the current window.'

  const CHANNEL_COLOR: Record<string, string> = {
    ig: '#e1306c', yt: '#ff0000', reddit: '#ff4500',
    tiktok: '#69c9d0', x: '#1d9bf0', default: '#6b7280',
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--bg)', border: '1px solid var(--wb-10)', borderRadius: 14, width: '100%', maxWidth: 720, maxHeight: '82vh', display: 'flex', flexDirection: 'column', boxShadow: '0 32px 80px rgba(0,0,0,0.8)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#fff', letterSpacing: 0.3 }}>{brandName}</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Negative &amp; Crisis signal breakdown</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--line)' }}>
          {([['crisis', `⚠ Crisis (${crisis.length})`, '#ef4444'], ['negative', `▼ Negative (${negative.length})`, '#f97316']] as const).map(([t, label, color]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1, padding: '10px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: 'none', border: 'none', borderBottom: tab === t ? `2px solid ${color}` : '2px solid transparent',
                color: tab === t ? color : '#6b7280', transition: 'all 150ms',
              }}
            >{label}</button>
          ))}
        </div>

        {/* Signal list */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {list.length === 0 ? (
            <div style={{ color: '#6b7280', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>{empty}</div>
          ) : list.map(s => {
            const chKey = String(s.source).split('_')[0]
            const chColor = CHANNEL_COLOR[chKey] || CHANNEL_COLOR.default
            return (
              <div key={s.uniqueKey} style={{ background: 'var(--wb-3)', border: `1px solid ${s.isCrisis ? 'rgba(239,68,68,0.25)' : 'rgba(249,115,22,0.18)'}`, borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: `${chColor}22`, color: chColor, border: `1px solid ${chColor}44` }}>
                    {s.sourceLabel}
                  </span>
                  {s.isCrisis && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
                      CRISIS
                    </span>
                  )}
                  <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 'auto', fontFamily: 'JetBrains Mono' }}>{formatCalendarDate(s.postedAt)}</span>
                  {s.likes > 0 && <span style={{ fontSize: 10, color: '#6b7280', fontFamily: 'JetBrains Mono' }}>♥ {fmt(s.likes)}</span>}
                </div>
                <div style={{ fontSize: 13, color: '#cbd1dc', lineHeight: 1.55 }}>{s.summary}</div>
                {s.link && (
                  <a href={s.link} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 8, fontSize: 11, color: '#60a5fa', textDecoration: 'none' }}>
                    View source →
                  </a>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--line)', fontSize: 11, color: '#6b7280', display: 'flex', justifyContent: 'space-between' }}>
          <span>Showing signals from the active filter window</span>
          <span>Press Esc to close</span>
        </div>
      </div>
    </div>
  )
}
