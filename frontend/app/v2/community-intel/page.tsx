'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  PageHead, MiniKpi, SortTh, ColumnFilter, LoadingPage, SectionInfo,
  FilterBanner, pgColor, pgName,
} from '@/components/v2/PageShell'
import { fmt } from '@/components/v2/charts'
import { useBrandFilter, applyBrandFilter } from '@/lib/v2/BrandFilterContext'
import { useDateRange, applyDateRangeCustom, DATE_RANGE_LABEL, type DateRangeKey } from '@/lib/v2/DateRangeContext'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import {
  fetchCommunityIntel,
  communityChannelLabel,
  communityChannelColor,
  type CommunityIntelData,
  type CommunitySignal,
  type CommunitySentiment,
  type BrandDiscussionRow,
  type SentimentStat,
  type TrendPoint,
  type HeatmapCell,
} from '@/lib/v2/communityIntel'
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
  const [topSort, setTopSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'likes', dir: 'desc' })
  const [topColFilter, setTopColFilter] = useState<Record<string, string>>({})
  const [topJoolaOnly, setTopJoolaOnly] = useState(false)
  const [topNegativeOnly, setTopNegativeOnly] = useState(false)
  const [crisisSort, setCrisisSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' })
  const [crisisColFilter, setCrisisColFilter] = useState<Record<string, string>>({})
  const [sentimentSort, setSentimentSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'crisis', dir: 'desc' })

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
  }, [filteredSignals, feedColFilter, feedSort, brands])

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

  // ─── Early returns ──────────────────────────────────────────────────

  if (loading) return <LoadingPage />

  if (error || !data) return (
    <div style={{ padding: '80px 32px', textAlign: 'center' }}>
      <div style={{ color: '#ef4444', fontSize: 14, marginBottom: 16 }}>
        {error || 'Unable to load Community Intel.'}
      </div>
      <button className="btn btn-yellow" onClick={() => window.location.reload()}>Refresh page</button>
    </div>
  )

  // ─── Render ─────────────────────────────────────────────────────────

  const summary = data.summary
  const sentimentCoverage = data.dataStatus.sentimentCoverage
  const showSentimentLowCoverage = sentimentCoverage < 0.2 && filteredSignals.length > 0
  const negativeAvailable = filteredSentimentStats.some((r) => r.negative > 0 || r.positive > 0)

  const fromInputValue = effectiveFrom.toISOString().slice(0, 10)
  const toInputValue = effectiveTo.toISOString().slice(0, 10)

  return (
    <>
      <PageHead title="COMMUNITY INTEL" />
      <FilterBanner />

      {/* ─── Global filter bar ─────────────────────────────────────── */}
      <section>
        <div
          className="card"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center',
            padding: '12px 16px',
            marginBottom: 16,
          }}
        >
          <label style={filterLabel}>Range
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as DateRangeKey)}
              className="page-select"
              aria-label="Preset date range"
            >
              {(Object.keys(DATE_RANGE_LABEL) as DateRangeKey[]).map((k) => (
                <option key={k} value={k}>{DATE_RANGE_LABEL[k]}</option>
              ))}
            </select>
          </label>
          <label style={filterLabel}>From
            <input
              type="date"
              value={fromInputValue}
              onChange={(e) => {
                const v = e.target.value
                if (!v) return
                setCustomFrom(new Date(v + 'T00:00:00'))
              }}
              className="page-select"
              aria-label="Custom from date"
            />
          </label>
          <label style={filterLabel}>To
            <input
              type="date"
              value={toInputValue}
              onChange={(e) => {
                const v = e.target.value
                if (!v) return
                setCustomTo(new Date(v + 'T00:00:00'))
              }}
              className="page-select"
              aria-label="Custom to date"
            />
          </label>
          {mode === 'custom' && (
            <span className="pill pill-amber" style={{ fontSize: 10 }}>Custom window</span>
          )}
          <span style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.08)' }} />
          <label style={filterLabel}>Channel
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value as ChannelKey)}
              className="page-select"
              aria-label="Channel filter"
            >
              <option value="all">All channels</option>
              <option value="ig">Instagram</option>
              <option value="yt">YouTube</option>
              <option value="reddit">Reddit</option>
              <option value="tiktok">TikTok</option>
              <option value="x">X / Twitter</option>
            </select>
          </label>
          <label style={filterLabel}>Sentiment
            <select
              value={sentimentFilter}
              onChange={(e) => setSentimentFilter(e.target.value as SentimentKey)}
              className="page-select"
              aria-label="Sentiment filter"
            >
              <option value="all">All sentiment</option>
              <option value="positive">Positive</option>
              <option value="neutral">Neutral</option>
              <option value="negative">Negative</option>
            </select>
          </label>
          <label style={filterLabel}>Crisis
            <select
              value={crisisFilter}
              onChange={(e) => setCrisisFilter(e.target.value as CrisisKey)}
              className="page-select"
              aria-label="Crisis filter"
            >
              <option value="all">All signals</option>
              <option value="crisis">Crisis only</option>
              <option value="non-crisis">Non-crisis only</option>
            </select>
          </label>
        </div>
      </section>

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
          <SummaryItem label="Community signals" value={fmt(filteredSignals.length)} />
          <SummaryItem label="Comments analyzed" value={fmt(summary.commentsAnalyzed)} />
          <SummaryItem
            label="Open crisis (30d)"
            value={fmt(crisisRows.filter((c) => c.days <= 30).length || summary.openCrisis30d)}
            color={summary.openCrisis30d > 0 ? '#ef4444' : undefined}
          />
          <SummaryItem
            label="Top brand"
            value={summary.topBrand ? name(summary.topBrand) : '—'}
            color={summary.topBrand ? pgColor(summary.topBrand) : undefined}
          />
          <SummaryItem
            label="Top brand at risk"
            value={summary.topBrandAtRisk ? name(summary.topBrandAtRisk) : '—'}
            color={summary.topBrandAtRisk ? pgColor(summary.topBrandAtRisk) : '#94a3b8'}
          />
          <SummaryItem
            label="Top channel"
            value={summary.topChannel ? communityChannelLabel(summary.topChannel) : '—'}
            color={summary.topChannel ? communityChannelColor(summary.topChannel) : undefined}
          />
          <SummaryItem label="JOOLA mentions" value={fmt(summary.joolaMentions)} color="#22c55e" />
          <SummaryItem label="Negative %" value={`${summary.negativePct}%`} />
        </div>

        {/* KPI grid for accessibility — reuses MiniKpi visuals */}
        <div className="kpi-grid" style={{ marginBottom: 6 }}>
          <MiniKpi
            label="Total signals (filter)"
            value={fmt(filteredSignals.length)}
            color="#06b6d4"
            customVs={`${data.signals.length} pre-filter`}
            src="ig_comments + yt_comments + reddit_mentions + reddit_comments + mention_facts"
          />
          <MiniKpi
            label="Crisis signals"
            value={fmt(crisisRows.length)}
            color={crisisRows.length > 0 ? '#ef4444' : '#22c55e'}
            customVs={`${summary.openCrisis30d} in last 30d`}
            src="mention_facts.is_crisis"
            flavor={crisisRows.length > 0 ? 'danger' : undefined}
          />
          <MiniKpi
            label="JOOLA mentions"
            value={fmt(summary.joolaMentions)}
            color="#22c55e"
            customVs={`across ${filteredChannelStats.length} channels`}
            flavor="joola"
            src="Filtered JOOLA-brand signals"
          />
          <MiniKpi
            label="Negative share"
            value={`${summary.negativePct}%`}
            color={summary.negativePct >= 30 ? '#ef4444' : '#F5E625'}
            customVs={sentimentCoverage > 0
              ? `${Math.round(sentimentCoverage * 100)}% classifier coverage`
              : 'Sentiment classifier pending'}
          />
        </div>
      </section>

      {/* ─── Section 2: Brand discussion volume ────────────────────── */}
      <section>
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
          <div className="actions">
            <input
              type="text"
              className="col-filter-input"
              placeholder="Search brand…"
              value={discBrand}
              onChange={(e) => setDiscBrand(e.target.value)}
              style={{ minWidth: 160 }}
              aria-label="Filter brands"
            />
          </div>
        </div>
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="data" style={{ width: '100%', minWidth: 940 }}>
            <thead>
              <tr>
                <SortTh col="brand" label="Brand" sortKey={discSort.key} sortDir={discSort.dir} toggle={(k) => toggleSort(discSort, setDiscSort, k)} style={{ textAlign: 'left' }} />
                <SortTh col="total" label="Total" sortKey={discSort.key} sortDir={discSort.dir} toggle={(k) => toggleSort(discSort, setDiscSort, k)} />
                <SortTh col="ig" label="IG" sortKey={discSort.key} sortDir={discSort.dir} toggle={(k) => toggleSort(discSort, setDiscSort, k)} />
                <SortTh col="yt" label="YT" sortKey={discSort.key} sortDir={discSort.dir} toggle={(k) => toggleSort(discSort, setDiscSort, k)} />
                <SortTh col="reddit" label="Reddit" sortKey={discSort.key} sortDir={discSort.dir} toggle={(k) => toggleSort(discSort, setDiscSort, k)} />
                <SortTh col="tiktok" label="TikTok" sortKey={discSort.key} sortDir={discSort.dir} toggle={(k) => toggleSort(discSort, setDiscSort, k)} />
                <SortTh col="negativePct" label="Negative %" sortKey={discSort.key} sortDir={discSort.dir} toggle={(k) => toggleSort(discSort, setDiscSort, k)} />
                <SortTh col="crisis" label="Crisis" sortKey={discSort.key} sortDir={discSort.dir} toggle={(k) => toggleSort(discSort, setDiscSort, k)} />
              </tr>
            </thead>
            <tbody>
              {discussionRows.length === 0 && (
                <tr><td colSpan={8} style={emptyCell}>No discussion data for this filter.</td></tr>
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
                        <div style={{ width: 80, height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${barPct}%`, height: '100%', background: isJoola ? '#22c55e' : '#F5E625' }} />
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>{r.ig > 0 ? fmt(r.ig) : <span style={{ color: '#3a4150' }}>·</span>}</td>
                    <td style={{ textAlign: 'right' }}>{r.yt > 0 ? fmt(r.yt) : <span style={{ color: '#3a4150' }}>·</span>}</td>
                    <td style={{ textAlign: 'right' }}>{r.reddit > 0 ? fmt(r.reddit) : <span style={{ color: '#3a4150' }}>·</span>}</td>
                    <td style={{ textAlign: 'right' }}>{r.tiktok > 0 ? fmt(r.tiktok) : <span style={{ color: '#3a4150' }}>·</span>}</td>
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
      <section>
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
      <section>
        <div className="two-col">
          <div className="card" style={{ padding: 16 }}>
            <h6 style={{ marginTop: 0 }}>
              Channel mix
              <SectionInfo
                title="Channel mix"
                description="Where the conversation lives — donut of total signals per channel, sized to volume. Crisis count is shown as a red dot overlay so you can spot disproportionate crisis concentration in a single channel."
                source="Filtered community signals · grouped by source"
              />
            </h6>
            <ChannelMixDonut rows={filteredChannelStats} />
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
      <section>
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
                <SortTh col="brand" label="Brand" sortKey={sentimentSort.key} sortDir={sentimentSort.dir} toggle={(k) => toggleSort(sentimentSort, setSentimentSort, k)} style={{ textAlign: 'left' }} />
                <SortTh col="total" label="Total" sortKey={sentimentSort.key} sortDir={sentimentSort.dir} toggle={(k) => toggleSort(sentimentSort, setSentimentSort, k)} />
                <SortTh col="positive" label="Positive" sortKey={sentimentSort.key} sortDir={sentimentSort.dir} toggle={(k) => toggleSort(sentimentSort, setSentimentSort, k)} />
                <SortTh col="neutral" label="Neutral" sortKey={sentimentSort.key} sortDir={sentimentSort.dir} toggle={(k) => toggleSort(sentimentSort, setSentimentSort, k)} />
                <SortTh col="negative" label="Negative" sortKey={sentimentSort.key} sortDir={sentimentSort.dir} toggle={(k) => toggleSort(sentimentSort, setSentimentSort, k)} />
                <SortTh col="crisis" label="Crisis" sortKey={sentimentSort.key} sortDir={sentimentSort.dir} toggle={(k) => toggleSort(sentimentSort, setSentimentSort, k)} />
                <SortTh col="negativePct" label="Negative %" sortKey={sentimentSort.key} sortDir={sentimentSort.dir} toggle={(k) => toggleSort(sentimentSort, setSentimentSort, k)} />
                <SortTh col="risk" label="Risk Level" sortKey={sentimentSort.key} sortDir={sentimentSort.dir} toggle={(k) => toggleSort(sentimentSort, setSentimentSort, k)} title="Risk level considers crisis signal count, severity, recency, and negative share." />
              </tr>
            </thead>
            <tbody>
              {sentimentRows.length === 0 && (
                <tr><td colSpan={8} style={emptyCell}>No sentiment data in this filter.</td></tr>
              )}
              {sentimentRows.map((r) => {
                const isJoola = r.brand === 'joola'
                return (
                  <tr key={r.brand} style={isJoola ? { borderLeft: '3px solid #22c55e', background: 'rgba(34,197,94,0.04)' } : {}}>
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

      {/* ─── Section 6: Live community intel feed ──────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Live community intel feed
              <SectionInfo
                title="Live community intel feed"
                description="Unified, deduped stream of every community signal in the active window. mention_facts rows take precedence over their source-table duplicates so each conversation only shows up once."
                source="ig_comments + yt_comments + reddit_mentions + reddit_comments + mention_facts (deduped)"
              />
            </h2>
            <div className="sub">Up to 200 most-recent signals. Click any row to open the source thread.</div>
          </div>
        </div>
        <div className="card">
          <div style={{ padding: '8px 18px', fontSize: 12, color: 'var(--fg-4)' }}>
            Showing {feedRows.length} of {filteredSignals.length} filtered signals
          </div>
          <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
            <table className="data" style={{ width: '100%', minWidth: 980 }}>
              <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
                <tr>
                  <SortTh col="sourceLabel" label="Source" sortKey={feedSort.key} sortDir={feedSort.dir} toggle={(k) => toggleSort(feedSort, setFeedSort, k)} style={{ textAlign: 'left' }} />
                  <SortTh col="brand" label="Brand" sortKey={feedSort.key} sortDir={feedSort.dir} toggle={(k) => toggleSort(feedSort, setFeedSort, k)} style={{ textAlign: 'left' }} />
                  <SortTh col="signalType" label="Type" sortKey={feedSort.key} sortDir={feedSort.dir} toggle={(k) => toggleSort(feedSort, setFeedSort, k)} />
                  <SortTh col="summary" label="Summary" sortKey={feedSort.key} sortDir={feedSort.dir} toggle={(k) => toggleSort(feedSort, setFeedSort, k)} style={{ textAlign: 'left' }} />
                  <SortTh col="sentiment" label="Sentiment" sortKey={feedSort.key} sortDir={feedSort.dir} toggle={(k) => toggleSort(feedSort, setFeedSort, k)} />
                  <SortTh col="isCrisis" label="Risk" sortKey={feedSort.key} sortDir={feedSort.dir} toggle={(k) => toggleSort(feedSort, setFeedSort, k)} />
                  <SortTh col="date" label="Date" sortKey={feedSort.key} sortDir={feedSort.dir} toggle={(k) => toggleSort(feedSort, setFeedSort, k)} />
                  <th>Link</th>
                </tr>
                <tr className="col-filter-row">
                  <th><ColumnFilter col="source" value={feedColFilter.source} onChange={(v) => setFeedColFilter((p) => ({ ...p, source: v }))} /></th>
                  <th><ColumnFilter col="brand" value={feedColFilter.brand} onChange={(v) => setFeedColFilter((p) => ({ ...p, brand: v }))} /></th>
                  <th />
                  <th><ColumnFilter col="summary" value={feedColFilter.summary} onChange={(v) => setFeedColFilter((p) => ({ ...p, summary: v }))} placeholder="search text…" /></th>
                  <th colSpan={4} />
                </tr>
              </thead>
              <tbody>
                {feedRows.length === 0 && (
                  <tr><td colSpan={8} style={emptyCell}>No community signals in this filter.</td></tr>
                )}
                {feedRows.map((s) => (
                  <tr key={s.uniqueKey}>
                    <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 99, background: communityChannelColor(String(s.source)) }} />
                        {s.sourceLabel}
                      </span>
                    </td>
                    <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 99, background: pgColor(s.brand) }} />
                        <span style={{ fontWeight: 600, color: s.brand === 'joola' ? '#22c55e' : 'inherit' }}>{name(s.brand)}</span>
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

      {/* ─── Section 7: Top comments + community posts ─────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Top comments and community posts
              <SectionInfo
                title="Top comments and community posts"
                description="Per-comment voice across IG, YT, Reddit. Sort by likes or sentiment to surface ambassadors and complaints. Quick filters narrow to JOOLA-only or negative-only."
                source="ig_comments + yt_comments + reddit_comments (deduped against mention_facts)"
              />
            </h2>
            <div className="sub">Highest-impact comments. Find ambassadors. Catch complaints early.</div>
          </div>
          <div className="actions">
            <div className="chip-row">
              <button className={'chip ' + (topJoolaOnly ? 'on' : '')} onClick={() => setTopJoolaOnly((v) => !v)}>JOOLA only</button>
              <button className={'chip ' + (topNegativeOnly ? 'on' : '')} onClick={() => setTopNegativeOnly((v) => !v)}>Negative only</button>
            </div>
          </div>
        </div>
        <div className="card">
          <div style={{ padding: '8px 18px', fontSize: 12, color: 'var(--fg-4)' }}>
            Showing {topCommentRows.length} of {topCommentsAll.length} comments
          </div>
          <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
            <table className="data" style={{ width: '100%', minWidth: 940 }}>
              <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
                <tr>
                  <SortTh col="sourceLabel" label="Channel" sortKey={topSort.key} sortDir={topSort.dir} toggle={(k) => toggleSort(topSort, setTopSort, k)} style={{ textAlign: 'left' }} />
                  <SortTh col="brand" label="Brand" sortKey={topSort.key} sortDir={topSort.dir} toggle={(k) => toggleSort(topSort, setTopSort, k)} style={{ textAlign: 'left' }} />
                  <SortTh col="summary" label="Comment" sortKey={topSort.key} sortDir={topSort.dir} toggle={(k) => toggleSort(topSort, setTopSort, k)} style={{ textAlign: 'left' }} />
                  <SortTh col="sentiment" label="Sentiment" sortKey={topSort.key} sortDir={topSort.dir} toggle={(k) => toggleSort(topSort, setTopSort, k)} />
                  <SortTh col="likes" label="Likes" sortKey={topSort.key} sortDir={topSort.dir} toggle={(k) => toggleSort(topSort, setTopSort, k)} />
                  <SortTh col="date" label="Date" sortKey={topSort.key} sortDir={topSort.dir} toggle={(k) => toggleSort(topSort, setTopSort, k)} />
                  <th>Link</th>
                </tr>
                <tr className="col-filter-row">
                  <th />
                  <th><ColumnFilter col="brand" value={topColFilter.brand} onChange={(v) => setTopColFilter((p) => ({ ...p, brand: v }))} /></th>
                  <th><ColumnFilter col="summary" value={topColFilter.summary} onChange={(v) => setTopColFilter((p) => ({ ...p, summary: v }))} placeholder="search text…" /></th>
                  <th colSpan={4} />
                </tr>
              </thead>
              <tbody>
                {topCommentRows.length === 0 && (
                  <tr><td colSpan={7} style={emptyCell}>No comments match this filter.</td></tr>
                )}
                {topCommentRows.map((c) => (
                  <tr key={c.uniqueKey}>
                    <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 99, background: communityChannelColor(String(c.source)) }} />
                        {c.sourceLabel}
                      </span>
                    </td>
                    <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 99, background: pgColor(c.brand) }} />
                        <span style={{ fontWeight: 600, color: c.brand === 'joola' ? '#22c55e' : 'inherit' }}>{name(c.brand)}</span>
                      </span>
                    </td>
                    <td style={{ textAlign: 'left', maxWidth: 420 }}>
                      <span title={c.summary} style={{ display: 'inline-block', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        "{c.summary.slice(0, 180)}"
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={'pill ' + SENT_PILL[c.sentiment]} style={{ fontSize: 10 }}>{c.sentiment}</span>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono', fontSize: 11 }}>♥ {fmt(c.likes)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'JetBrains Mono', fontSize: 11 }}>{formatCalendarDate(c.postedAt)}</td>
                    <td style={{ textAlign: 'center' }}>
                      {c.link
                        ? <a href={c.link} target="_blank" rel="noopener noreferrer" className="ext-link" style={{ fontSize: 11 }}>open →</a>
                        : <span style={{ color: '#3a4150' }}>·</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ─── Section 8: Crisis watchlist ──────────────────────────── */}
      <section>
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
              <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
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
      <section>
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
    </>
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

function SummaryItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', minWidth: 100 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 800, color: color || '#fff', whiteSpace: 'nowrap' }}>{value}</span>
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

  if (!points.length || points.every((p) => p.total === 0)) {
    return <div style={{ color: '#6b7280', fontSize: 13, padding: '32px 0', textAlign: 'center' }}>No signals in the window.</div>
  }

  const max = Math.max(1, ...points.map((p) => p.total))
  const N = points.length
  const x = (i: number) => padL + (i / Math.max(1, N - 1)) * (w - padL - padR)
  const y = (v: number) => padT + (h - padT - padB) * (1 - v / max)

  function build(key: keyof Pick<TrendPoint, 'total' | 'crisis' | 'joola' | 'negative'>): string {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ')
  }

  const series = [
    { id: 'total', label: 'Total', color: '#06b6d4' },
    { id: 'crisis', label: 'Crisis', color: '#ef4444' },
    { id: 'joola', label: 'JOOLA', color: '#22c55e' },
    { id: 'negative', label: 'Negative', color: '#fb923c' },
  ] as const

  const last = points[points.length - 1]
  const labels = series.map((s) => ({ id: s.id, color: s.color, label: s.label, y: y(last[s.id]) }))
  labels.sort((a, b) => a.y - b.y)
  const minGap = 14
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y < labels[i - 1].y + minGap) labels[i].y = labels[i - 1].y + minGap
  }

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      {[0, Math.ceil(max / 2), max].map((tick) => (
        <g key={tick}>
          <line x1={padL} x2={w - padR} y1={y(tick)} y2={y(tick)} stroke="rgba(255,255,255,0.06)" strokeDasharray="2 4" />
          <text x={padL - 6} y={y(tick) + 3} textAnchor="end" fontSize={10} fill="#6b7280">{tick}</text>
        </g>
      ))}
      {series.map((s) => (
        <path key={s.id} d={build(s.id)} fill="none" stroke={s.color} strokeWidth={1.7} strokeLinejoin="round" />
      ))}
      {labels.map((lb) => (
        <text key={lb.id} x={w - padR + 6} y={lb.y + 3} fontSize={10} fill={lb.color} fontWeight={700}>
          {lb.label}: {last[lb.id as 'total' | 'crisis' | 'joola' | 'negative']}
        </text>
      ))}
      {[0, Math.floor(N / 2), N - 1].map((i) =>
        points[i] ? (
          <text key={i} x={x(i)} y={h - padB + 16} textAnchor="middle" fontSize={10} fill="#6b7280">
            {points[i].date.slice(5)}
          </text>
        ) : null,
      )}
    </svg>
  )
}

function ChannelMixDonut({ rows }: { rows: { channel: string; label: string; color: string; total: number; crisis: number }[] }) {
  const total = rows.reduce((s, r) => s + r.total, 0)
  if (total === 0) {
    return <div style={{ color: '#6b7280', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>No data</div>
  }
  const size = 160
  const r = 60
  const inner = 36
  const cx = size / 2
  const cy = size / 2
  let acc = 0
  const arcs = rows.map((row) => {
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2
    acc += row.total
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2
    const large = row.total / total > 0.5 ? 1 : 0
    const x0 = cx + r * Math.cos(start), y0 = cy + r * Math.sin(start)
    const x1 = cx + r * Math.cos(end), y1 = cy + r * Math.sin(end)
    const x2 = cx + inner * Math.cos(end), y2 = cy + inner * Math.sin(end)
    const x3 = cx + inner * Math.cos(start), y3 = cy + inner * Math.sin(start)
    const d = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${inner} ${inner} 0 ${large} 0 ${x3} ${y3} Z`
    return { ...row, d }
  })
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {arcs.map((a) => (
          <path key={a.channel} d={a.d} fill={a.color}>
            <title>{`${a.label}: ${a.total} signals · ${a.crisis} crisis`}</title>
          </path>
        ))}
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize={18} fontWeight={800} fill="#fff">{total}</text>
      </svg>
      <div style={{ display: 'grid', gap: 6, fontSize: 12, flex: 1, minWidth: 0 }}>
        {arcs.map((a) => (
          <div key={a.channel} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ width: 10, height: 10, background: a.color, borderRadius: 2, flexShrink: 0 }} />
            <span style={{ color: '#cbd1dc', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.label}</span>
            <span style={{ color: '#fff', fontWeight: 700 }}>{a.total}</span>
            {a.crisis > 0 && <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 10 }}>· {a.crisis} crisis</span>}
          </div>
        ))}
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
                  <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
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
