'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  fetchBrands, fetchYT, fetchYTTrend, fetchTopYTVideos,
  type V2Brand, type V2YTRow, type V2TopYTVideo,
} from '@/lib/v2/data'
import { fmt, LineChart, Donut } from '@/components/v2/charts'
import { PageHead, MiniKpi, pgColor, pgName, LoadingPage, SectionInfo, SortTh, FilterBanner, ColumnFilter } from '@/components/v2/PageShell'
import { useBrandFilter, applyBrandFilter, applyBrandFilterRecord } from '@/lib/v2/BrandFilterContext'
import { useDateRange, applyDateRange, DATE_RANGE_LABEL } from '@/lib/v2/DateRangeContext'
import { formatCalendarDateFromDaysAgo } from '@/lib/v2/format'

interface VideoAnalysisRow {
  brand_id: string
  content_type: string | null
  themes: string[] | null
  players_mentioned: string[] | null
  sentiment_score: number | null
  video_id: string
}

interface TranscriptStatRow {
  brand_id: string
  fetch_status: string
  count: number
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabaseClient = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

const CONTENT_TYPE_COLORS: Record<string, string> = {
  educational: '#22c55e',
  promotional: '#F5E625',
  review: '#818cf8',
  tutorial: '#38bdf8',
  entertainment: '#f472b6',
  other: '#94a3b8',
}

/** Relative caption ("3 days ago") kept only for the title tooltip on date cells. */
function relativeLabel(days: number): string {
  return days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
}

const YT_HANDLES: Record<string, string> = {
  joola: 'JOOLAUSA',
  selkirk: 'SelkirkSport',
  crbn: 'CRBNPickleball',
  franklin: 'FranklinSports',
  engage: 'EngagePickleball',
  paddletek: 'Paddletek',
  'six-zero': 'SixZeroPickleball',
  onix: 'ONIXSports',
  wilson: 'WilsonSports',
  gamma: 'GammaSports',
  prokennex: 'ProKennexPickleball',
  // Best-guess handle — verify against YouTube before relying for outbound traffic.
  head: 'headpickleball',
}

export default function YouTubePage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [yt, setYt] = useState<V2YTRow[]>([])
  const [trend, setTrend] = useState<Record<string, number[]>>({})
  const [videos, setVideos] = useState<V2TopYTVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [colFilter, setColFilter] = useState<Record<string, string>>({})
  const [videoAnalysis, setVideoAnalysis] = useState<VideoAnalysisRow[]>([])
  const [transcriptStats, setTranscriptStats] = useState<TranscriptStatRow[]>([])
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()
  const { range, maxDays } = useDateRange()

  useEffect(() => {
    document.title = 'JOOLA INTEL — YouTube Performance'
  }, [])

  useEffect(() => {
    fetchBrands().then(async (b) => {
      try {
        const [y, t, v] = await Promise.all([fetchYT(b), fetchYTTrend(b), fetchTopYTVideos(b, 15)])
        setBrands(b); setAllBrands(b); setYt(y); setTrend(t); setVideos(v); setLoading(false)
      } catch (err) {
        console.error('Data fetch failed', err)
        setError('Unable to load data. Please refresh.')
        setLoading(false)
      }

      // Non-fatal: fetch Video Intelligence enrichment data. Empty results are
      // expected before the enrichment pipeline has finished — UI shows a
      // "pending" empty state in that case.
      if (!supabaseClient) return
      try {
        const { data: analysis } = await supabaseClient
          .from('yt_video_analysis')
          .select('brand_id,content_type,themes,players_mentioned,sentiment_score,video_id')
          .limit(500)
        if (analysis) setVideoAnalysis(analysis as VideoAnalysisRow[])

        const { data: transcripts } = await supabaseClient
          .from('yt_video_transcripts')
          .select('brand_id,fetch_status')
          .limit(2000)
        if (transcripts) {
          const counts: Record<string, Record<string, number>> = {}
          for (const r of transcripts as Array<{ brand_id: string; fetch_status: string }>) {
            const bid = r.brand_id
            const st = r.fetch_status
            counts[bid] = counts[bid] || {}
            counts[bid][st] = (counts[bid][st] || 0) + 1
          }
          const stats: TranscriptStatRow[] = []
          for (const [bid, statuses] of Object.entries(counts)) {
            for (const [status, count] of Object.entries(statuses)) {
              stats.push({ brand_id: bid, fetch_status: status, count })
            }
          }
          setTranscriptStats(stats)
        }
      } catch {
        /* non-fatal — Video Intelligence section will render the empty state */
      }
    }).catch(err => {
      console.error('Brands fetch failed', err)
      setError('Unable to load data. Please refresh.')
      setLoading(false)
    })
  }, [setAllBrands])

  if (loading) return <LoadingPage />

  if (error) return (
    <div style={{ padding: '80px 32px', textAlign: 'center' }}>
      <div style={{ color: '#ef4444', fontSize: 14, marginBottom: 16 }}>{error}</div>
      <button className="btn btn-yellow" onClick={() => window.location.reload()}>Refresh page</button>
    </div>
  )

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function applySortVideos(data: V2TopYTVideo[]): V2TopYTVideo[] {
    if (!sortKey) return data
    return [...data].sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey]
      const bv = (b as Record<string, unknown>)[sortKey]
      if (typeof av === 'number' && typeof bv === 'number')
        return sortDir === 'asc' ? av - bv : bv - av
      return sortDir === 'asc'
        ? String(av ?? '').localeCompare(String(bv ?? ''))
        : String(bv ?? '').localeCompare(String(av ?? ''))
    })
  }

  const displayYt = applyBrandFilter(yt, filteredBrands, isFiltered)
  const displayVideosAll = applyBrandFilter(videos, filteredBrands, isFiltered)
  const displayVideosByRange = applyDateRange(displayVideosAll, maxDays)
  // Data-quality safeguard: drop clearly off-topic uploads (table tennis / regular tennis)
  // that occasionally slip into the scraped YouTube feed for tracked brands.
  const OFF_TOPIC_RE = /table tennis|ping pong|tennis match/i
  const displayVideos = displayVideosByRange.filter(v => !OFF_TOPIC_RE.test(v.title))
  const offTopicHidden = displayVideosByRange.length - displayVideos.length
  const displayTrend = applyBrandFilterRecord(trend, filteredBrands, isFiltered)

  const name = (s: string) => pgName(s, brands)
  const joolaYT = displayYt.find((d) => d.brand === 'joola')
  const topByViews = [...displayYt].sort((a, b) => b.views - a.views)
  const maxSubs = topByViews[0]?.subs || 1
  const totalViews = displayYt.reduce((s, d) => s + d.views, 0)
  const totalVideos = displayYt.reduce((s, d) => s + d.videos, 0)

  const lineSeries = Object.entries(displayTrend)
    .filter(([, data]) => data.length > 0)
    .map(([id, data]) => ({ id, label: name(id), color: pgColor(id), data }))

  // Calendar-date labels (in chronological order) for the subscriber-snapshot chart,
  // matching the length of the longest series so weeks line up with each tick.
  const maxSeriesLen = lineSeries.reduce((m, s) => Math.max(m, s.data.length), 0)
  const snapshotDates = Array.from({ length: maxSeriesLen }, (_, i) =>
    new Date(Date.now() - (maxSeriesLen - 1 - i) * 7 * 86400000)
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  )
  const oldestSnapshotDate = snapshotDates[0] || ''

  const vpvSorted = [...displayYt].filter((d) => d.videos > 0)
    .sort((a, b) => (b.views / b.videos) - (a.views / a.videos))
  const maxVpv = vpvSorted[0] ? vpvSorted[0].views / vpvSorted[0].videos : 1

  // Apply per-column filters (case-insensitive substring match) before sorting.
  const filteredVideos = displayVideos.filter(v => {
    const rec = v as unknown as Record<string, unknown>
    return Object.entries(colFilter).every(([col, q]) => {
      if (!q) return true
      const cell = col === 'brand' ? name(v.brand) : String(rec[col] ?? '')
      return cell.toLowerCase().includes(q.toLowerCase())
    })
  })

  const sortedVideos = applySortVideos(filteredVideos)

  // Surface a per-brand skew hint when a single brand dominates the table (> 50%).
  const brandCounts: Record<string, number> = {}
  sortedVideos.forEach(v => { brandCounts[v.brand] = (brandCounts[v.brand] || 0) + 1 })
  const dominantBrandEntry = Object.entries(brandCounts).sort((a, b) => b[1] - a[1])[0]
  const dominantBrand = dominantBrandEntry && sortedVideos.length > 0 && (dominantBrandEntry[1] / sortedVideos.length) > 0.5
    ? { brand: dominantBrandEntry[0], count: dominantBrandEntry[1] }
    : null

  // ─── Video Intelligence (enrichment) derived data ──────────────────────────
  // V2Brand.id is the brand slug (e.g. "joola", "selkirk"); brand_id is the uuid.
  const displayBrandIds: string[] = isFiltered
    ? filteredBrands.map(b => b.id)
    : brands.map(b => b.id)

  const displayAnalysis = videoAnalysis.filter(r => displayBrandIds.includes(r.brand_id))
  const displayTranscriptStats = transcriptStats.filter(r => displayBrandIds.includes(r.brand_id))

  // Widget 1: transcript coverage per brand (ok vs total)
  const transcriptCoverage: { brand: string; ok: number; total: number }[] = displayBrandIds.map(bid => {
    const rows = displayTranscriptStats.filter(s => s.brand_id === bid)
    const total = rows.reduce((sum, r) => sum + r.count, 0)
    const ok = rows.filter(r => r.fetch_status === 'ok').reduce((sum, r) => sum + r.count, 0)
    return { brand: bid, ok, total }
  }).filter(c => c.total > 0)
    .sort((a, b) => (b.ok / b.total) - (a.ok / a.total))

  // Widget 2: content-type mix per brand
  const contentTypeByBrand: Record<string, Record<string, number>> = {}
  for (const row of displayAnalysis) {
    if (!row.content_type) continue
    const key = row.content_type.toLowerCase()
    contentTypeByBrand[row.brand_id] = contentTypeByBrand[row.brand_id] || {}
    contentTypeByBrand[row.brand_id][key] = (contentTypeByBrand[row.brand_id][key] || 0) + 1
  }
  const contentTypeBrands = displayBrandIds.filter(b => contentTypeByBrand[b])

  // Widget 3: top themes per brand
  const themesByBrand: Record<string, Record<string, number>> = {}
  for (const row of displayAnalysis) {
    if (!row.themes || row.themes.length === 0) continue
    themesByBrand[row.brand_id] = themesByBrand[row.brand_id] || {}
    for (const theme of row.themes) {
      if (!theme) continue
      const key = String(theme).trim()
      if (!key) continue
      themesByBrand[row.brand_id][key] = (themesByBrand[row.brand_id][key] || 0) + 1
    }
  }
  const topThemesPerBrand: Record<string, { theme: string; count: number }[]> = {}
  for (const bid of displayBrandIds) {
    const themeMap = themesByBrand[bid]
    if (!themeMap) {
      topThemesPerBrand[bid] = []
      continue
    }
    topThemesPerBrand[bid] = Object.entries(themeMap)
      .map(([theme, count]) => ({ theme, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
  }

  // Widget 4: athlete mentions heatmap (top 10 athletes overall)
  const athleteTotals: Record<string, number> = {}
  for (const row of displayAnalysis) {
    if (!row.players_mentioned) continue
    for (const player of row.players_mentioned) {
      if (!player) continue
      const key = String(player).trim()
      if (!key) continue
      athleteTotals[key] = (athleteTotals[key] || 0) + 1
    }
  }
  const topAthletes = Object.entries(athleteTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([player]) => player)

  const athleteMentionsByBrand: Record<string, Record<string, number>> = {}
  for (const row of displayAnalysis) {
    if (!row.players_mentioned) continue
    athleteMentionsByBrand[row.brand_id] = athleteMentionsByBrand[row.brand_id] || {}
    const seenInThisVideo = new Set<string>()
    for (const player of row.players_mentioned) {
      if (!player) continue
      const key = String(player).trim()
      if (!key || seenInThisVideo.has(key)) continue
      seenInThisVideo.add(key)
      athleteMentionsByBrand[row.brand_id][key] = (athleteMentionsByBrand[row.brand_id][key] || 0) + 1
    }
  }

  const hasAnyAnalysis = displayAnalysis.length > 0
  const hasAnyTranscripts = displayTranscriptStats.length > 0

  function mentionOpacity(count: number): number {
    if (count <= 0) return 0
    if (count >= 5) return 0.8
    // Linear scale 1 → 0.1 ... 5 → 0.8
    return 0.1 + ((count - 1) / 4) * 0.7
  }

  return (
    <>
      <PageHead
        eyebrow={`YOUTUBE · ${totalVideos} VIDEOS · ${displayYt.length} CHANNELS`}
        title="Youtube"
        accent="domination map"
        sub={`Selkirk owns long-form pickleball video. JOOLA is a strong #2 but underweight given Ben Johns' reach. The gap to close: short-form tutorial content. · ${DATE_RANGE_LABEL[range].toLowerCase()} for video data.`}
      />
      <FilterBanner />

      <section>
        <div className="kpi-grid">
          <MiniKpi
            label="JOOLA subscribers" src="YouTube channels" flavor="joola"
            value={joolaYT && joolaYT.subs > 0 ? fmt(joolaYT.subs) : '—'}
            color="#22c55e"
            spark={joolaYT && joolaYT.subs > 0 ? (displayTrend['joola'] || []) : undefined}
            customVs={joolaYT && joolaYT.subs > 0
              ? `vs. ${name(topByViews.find(d => d.brand !== 'joola')?.brand || 'selkirk')}: ${fmt(topByViews.find(d => d.brand !== 'joola')?.subs || 0)}`
              : 'Subscriber data refreshes every Monday'}
          />
          <MiniKpi
            label="JOOLA videos" src="YouTube videos"
            value={joolaYT ? fmt(joolaYT.videos) : '—'}
            color="#818cf8"
            customVs={`vs. top brand: ${fmt(topByViews[0]?.videos || 0)}`}
          />
          <MiniKpi
            label="Total views tracked" src="YouTube videos"
            value={fmt(totalViews)}
            color="#F5E625"
            customVs={`across ${displayYt.length} brands`}
          />
          <MiniKpi
            label="JOOLA total views" src="YouTube videos"
            value={joolaYT ? fmt(joolaYT.views) : '—'}
            color="#22c55e" flavor="joola"
            customVs={`#${[...displayYt].sort((a, b) => b.views - a.views).findIndex(d => d.brand === 'joola') + 1} by views`}
          />
        </div>
      </section>

      {lineSeries.length > 0 && (
        <section>
          <div className="section-head">
            <div>
              <h2>
                Subscriber snapshots by brand
                <SectionInfo
                  title="Subscriber Snapshots"
                  description="How many followers each brand's YouTube channel has, tracked every week. Rising lines mean a growing audience — a sign the content strategy is working."
                  source="YouTube channels · refreshed every Monday from YouTube channel data"
                />
              </h2>
              <div className="sub">Weekly subscriber counts · YouTube channel data · refreshed every Monday.</div>
            </div>
          </div>
          <div className="card"><div className="card-pad">
            <LineChart series={lineSeries} xLabels={snapshotDates} />
            {oldestSnapshotDate && (
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--fg-4)', textAlign: 'center' }}>
                Tracking started {oldestSnapshotDate}. More history accumulates each Monday.
              </div>
            )}
          </div></div>
        </section>
      )}

      <section>
        <div className="two-col">
          <div>
            <div className="section-head"><div>
              <h2>
                Channels by subscriber count
                <SectionInfo
                  title="Channel Size Ranking"
                  description="Who has the biggest YouTube audience right now. More subscribers = more organic reach every time a new video is published."
                  source="YouTube channels · latest weekly snapshot"
                />
              </h2>
              <div className="sub">{displayYt.length} brands · current snapshot</div>
            </div></div>
            <div className="card"><div className="card-pad">
              {[...displayYt].sort((a, b) => b.subs - a.subs).map((d) => (
                <div key={d.brand} className={'bar-row ' + (d.brand === 'joola' ? 'joola' : '')}>
                  <div className="lbl" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span>{name(d.brand)}</span>
                    {YT_HANDLES[d.brand] && (
                      <a
                        href={`https://www.youtube.com/@${YT_HANDLES[d.brand]}`}
                        target="_blank" rel="noopener noreferrer"
                        className="ext-link"
                        style={{ fontSize: 10 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        Visit Channel
                      </a>
                    )}
                  </div>
                  <div className="track">
                    <div className="fill" style={{
                      width: d.subs > 0 ? Math.max(2, (d.subs / maxSubs) * 100) + '%' : '2%',
                      background: `linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                    }} title={d.subs === 0 ? 'Subscriber data refreshes every Monday' : undefined}>
                      {d.subs > 0 ? fmt(d.subs) : '—'}
                    </div>
                  </div>
                  <div className="spark-mini">{d.videos} {d.videos === 1 ? 'video' : 'videos'}</div>
                </div>
              ))}
            </div></div>
          </div>
          <div>
            <div className="section-head"><div>
              <h2>
                Views per video · efficiency
                <SectionInfo
                  title="Video Efficiency Score"
                  description="Total channel views divided by number of videos uploaded. A high score means each video is pulling its weight — quality over quantity. Low score = lots of videos but low viewership per upload."
                  source="YouTube videos · refreshed every Monday from YouTube channel data"
                />
              </h2>
              <div className="sub">Output quality — who makes the most-watched videos per upload.</div>
            </div></div>
            <div className="card"><div className="card-pad">
              {vpvSorted.map((d) => {
                const vpv = Math.round(d.views / d.videos)
                return (
                  <div
                    key={d.brand}
                    className={'bar-row ' + (d.brand === 'joola' ? 'joola' : '')}
                    style={{ cursor: 'pointer' }}
                    title={`Click to filter the videos table below to ${name(d.brand)}`}
                    onClick={() => {
                      setColFilter(p => ({ ...p, brand: name(d.brand) }))
                      document.getElementById('youtube-videos-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }}
                  >
                    <div className="lbl">{name(d.brand)} <span style={{ fontSize: 10, color: 'var(--fg-4)' }}>↓ filter</span></div>
                    <div className="track">
                      <div className="fill" style={{
                        width: Math.max(2, (vpv / maxVpv) * 100) + '%',
                        background: `linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                      }}>{fmt(vpv)}</div>
                    </div>
                    <div className="spark-mini">avg/vid{d.videos === 1 ? ' · single video' : ''}</div>
                    <div className="delta-mini flat">{d.videos}v</div>
                  </div>
                )
              })}
            </div></div>
          </div>
        </div>
      </section>

      <section id="youtube-videos-table">
        <div className="section-head">
          <div>
            <h2>
              Top {sortedVideos.length} videos · by views
              <SectionInfo
                title="Top Performing Videos"
                description="The most-watched videos across all brands. Shows which content formats resonate — coaching tutorials tend to dominate. Click any column header to sort."
                source="YouTube videos · refreshed every Monday from YouTube channel data"
              />
            </h2>
            <div className="sub">
              Long-form pickleball coaching wins. May be brand-skewed — use the brand filter (top right) or per-column search below to focus.
              {dominantBrand && (
                <span style={{ marginLeft: 6, color: 'var(--fg-3)' }}>
                  · {dominantBrand.count} of {sortedVideos.length} from {name(dominantBrand.brand)}
                </span>
              )}
              {offTopicHidden > 0 && (
                <span style={{ marginLeft: 6, color: 'var(--fg-4)' }}>
                  · {offTopicHidden} off-topic row{offTopicHidden === 1 ? '' : 's'} hidden
                </span>
              )}
              {' · '}{DATE_RANGE_LABEL[range].toLowerCase()}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <SortTh col="brand" label="Brand" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                  <SortTh col="title" label="Title" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ width: '42%' }} />
                  <SortTh col="duration" label="Duration" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                  <SortTh col="views" label="Views" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                  <SortTh col="likes" label="Likes" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                  <SortTh col="comments" label="Comments" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                  <SortTh col="days" label="Posted" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                </tr>
                <tr className="col-filter-row">
                  <th><ColumnFilter col="brand" value={colFilter.brand} onChange={v => setColFilter(p => ({ ...p, brand: v }))} placeholder="brand…" /></th>
                  <th><ColumnFilter col="title" value={colFilter.title} onChange={v => setColFilter(p => ({ ...p, title: v }))} placeholder="search title…" /></th>
                  <th colSpan={5} />
                </tr>
              </thead>
              <tbody>
                {sortedVideos.map((v, i) => {
                  const hasDirectLink = !!v.url
                  const watchHref = hasDirectLink
                    ? v.url
                    : `https://www.youtube.com/results?search_query=${encodeURIComponent(v.title || '')}`
                  return (
                    <tr key={i} className={v.brand === 'joola' ? 'joola' : ''}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="brand-dot" style={{ background: pgColor(v.brand) }} />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontWeight: 700, color: v.brand === 'joola' ? '#22c55e' : 'var(--fg)' }}>{name(v.brand)}</span>
                            {YT_HANDLES[v.brand] && (
                              <a
                                href={`https://www.youtube.com/@${YT_HANDLES[v.brand]}`}
                                target="_blank" rel="noopener noreferrer"
                                className="ext-link"
                                style={{ fontSize: 10 }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                Channel →
                              </a>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ color: 'var(--fg)' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                          <span style={{ color: 'var(--fg)', fontSize: 12 }}>{v.title?.slice(0, 70)}</span>
                          <a
                            href={watchHref}
                            target="_blank" rel="noopener noreferrer"
                            className="ext-link"
                            style={{ marginTop: 1, flexShrink: 0 }}
                            title={hasDirectLink ? undefined : 'Opens YouTube search — direct link unavailable'}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {hasDirectLink ? 'Watch' : 'Search YouTube'}
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                          </a>
                        </div>
                      </td>
                      <td className="cell-num">{v.duration}</td>
                      <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625' }}>{fmt(v.views)}</td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(v.likes)}</td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(v.comments)}</td>
                      <td className="cell-num" title={relativeLabel(v.days)}>{formatCalendarDateFromDaysAgo(v.days)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2>
              Video Intelligence
              <SectionInfo
                title="Video Intelligence"
                description="AI-enriched signals derived from YouTube transcripts: transcript coverage by brand, the mix of content types each brand publishes, the dominant themes per brand, and how often each brand mentions tracked athletes. Powered by the weekly enrichment pipeline."
                source="yt_video_transcripts + yt_video_analysis · enrichment pipeline (GPT-4o-mini)"
              />
            </h2>
            <div className="sub">
              Transcript coverage, content mix, themes and athlete-mention heatmap · {displayBrandIds.length} brand{displayBrandIds.length === 1 ? '' : 's'} in view.
            </div>
          </div>
        </div>

        {/* Widget 1: Transcript Coverage */}
        <div className="section-head" style={{ marginTop: 8 }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)', margin: 0 }}>
              Transcript coverage
              <SectionInfo
                title="Transcript Coverage"
                description="What share of each brand's tracked YouTube videos have successfully captured transcripts. Higher coverage = more reliable downstream theme/sentiment signals."
                source="yt_video_transcripts.fetch_status"
              />
            </h3>
            <div className="sub" style={{ fontSize: 11 }}>Share of videos with status = ok.</div>
          </div>
        </div>
        <div className="card"><div className="card-pad">
          {transcriptCoverage.length === 0 ? (
            <div style={{ padding: '24px 8px', color: '#6b7280', fontSize: 13, textAlign: 'center' }}>
              Video analysis running — check back after pipeline completes.
            </div>
          ) : (
            transcriptCoverage.map((d) => {
              const pct = d.total > 0 ? (d.ok / d.total) * 100 : 0
              return (
                <div key={d.brand} className={'bar-row ' + (d.brand === 'joola' ? 'joola' : '')}>
                  <div className="lbl">{name(d.brand)}</div>
                  <div className="track">
                    <div
                      className="fill"
                      style={{
                        width: Math.max(2, pct) + '%',
                        background: `linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                      }}
                      title={`${d.ok} of ${d.total} videos transcribed (${pct.toFixed(1)}%)`}
                    >
                      {pct.toFixed(0)}%
                    </div>
                  </div>
                  <div className="spark-mini">{d.ok} / {d.total} {d.total === 1 ? 'video' : 'videos'}</div>
                </div>
              )
            })
          )}
        </div></div>

        {/* Widget 2: Content Type Mix */}
        <div className="section-head" style={{ marginTop: 16 }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)', margin: 0 }}>
              Content type mix
              <SectionInfo
                title="Content Type Mix"
                description="The breakdown of educational, promotional, review, tutorial and entertainment content classified by the AI enrichment pass. Each donut sums to 100% per brand."
                source="yt_video_analysis.content_type"
              />
            </h3>
            <div className="sub" style={{ fontSize: 11 }}>Per-brand donuts · classified by GPT-4o-mini.</div>
          </div>
        </div>
        <div className="card"><div className="card-pad">
          {contentTypeBrands.length === 0 ? (
            <div style={{ padding: '24px 8px', color: '#6b7280', fontSize: 13, textAlign: 'center' }}>
              Video analysis running — check back after pipeline completes.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 20 }}>
              {contentTypeBrands.map(bid => {
                const mix = contentTypeByBrand[bid]
                const total = Object.values(mix).reduce((s, n) => s + n, 0)
                const donutData = Object.entries(mix)
                  .sort((a, b) => b[1] - a[1])
                  .map(([key, value]) => ({
                    value,
                    color: CONTENT_TYPE_COLORS[key] || CONTENT_TYPE_COLORS.other,
                    name: key.charAt(0).toUpperCase() + key.slice(1),
                  }))
                return (
                  <div key={bid} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <div style={{
                      fontWeight: 700,
                      fontSize: 12,
                      color: bid === 'joola' ? '#22c55e' : 'var(--fg)',
                      letterSpacing: 0.3,
                    }}>{name(bid)}</div>
                    <Donut
                      data={donutData}
                      size={150}
                      thickness={22}
                      centerLabel={String(total)}
                      centerSub={total === 1 ? 'video' : 'videos'}
                    />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center', maxWidth: 200 }}>
                      {donutData.slice(0, 4).map(seg => (
                        <span key={seg.name} style={{
                          fontSize: 10,
                          color: '#cbd1dc',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                        }}>
                          <span style={{ width: 8, height: 8, background: seg.color, borderRadius: 2, display: 'inline-block' }} />
                          {seg.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div></div>

        {/* Widget 3: Top Themes per Brand */}
        <div className="section-head" style={{ marginTop: 16 }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)', margin: 0 }}>
              Top themes per brand
              <SectionInfo
                title="Top Themes"
                description="The six most frequent themes mentioned across each brand's transcribed videos. Useful for spotting messaging focus areas — coaching, technique, gear reviews, athlete stories."
                source="yt_video_analysis.themes (array, frequency-counted)"
              />
            </h3>
            <div className="sub" style={{ fontSize: 11 }}>Top 6 themes per brand · pill = frequency badge.</div>
          </div>
        </div>
        <div className="card"><div className="card-pad">
          {!hasAnyAnalysis ? (
            <div style={{ padding: '24px 8px', color: '#6b7280', fontSize: 13, textAlign: 'center' }}>
              Video analysis running — check back after pipeline completes.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {displayBrandIds.map(bid => {
                const themes = topThemesPerBrand[bid] || []
                const isJoola = bid === 'joola'
                const pillBorder = isJoola ? '#22c55e' : 'rgba(255,255,255,0.15)'
                return (
                  <div key={bid} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{
                      minWidth: 110,
                      fontWeight: 700,
                      fontSize: 12,
                      color: isJoola ? '#22c55e' : 'var(--fg)',
                      paddingTop: 4,
                    }}>{name(bid)}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: 1 }}>
                      {themes.length === 0 ? (
                        <span style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>
                          No themes extracted yet
                        </span>
                      ) : (
                        themes.map(t => (
                          <span
                            key={t.theme}
                            title={`${t.count} video${t.count === 1 ? '' : 's'} mentioned this theme`}
                            style={{
                              border: `1px solid ${pillBorder}`,
                              borderRadius: 20,
                              padding: '4px 10px',
                              fontSize: 11,
                              color: '#cbd1dc',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              background: isJoola ? 'rgba(34,197,94,0.06)' : 'rgba(255,255,255,0.02)',
                            }}
                          >
                            {t.theme}
                            <span style={{ color: '#6b7280', fontSize: 10 }}>×{t.count}</span>
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div></div>

        {/* Widget 4: Athlete Mentions Heatmap */}
        <div className="section-head" style={{ marginTop: 16 }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)', margin: 0 }}>
              Athlete mentions heatmap
              <SectionInfo
                title="Athlete Mentions"
                description="How often each brand's videos mention each tracked athlete (top 10 by total mentions). Darker green cells = more mentions. A single video is counted once per athlete to avoid amplifying replays."
                source="yt_video_analysis.players_mentioned (deduped per video)"
              />
            </h3>
            <div className="sub" style={{ fontSize: 11 }}>Rows = brands · columns = top 10 athletes by total mention count.</div>
          </div>
        </div>
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', minWidth: 130, position: 'sticky', left: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>Brand</th>
                  {topAthletes.length === 0 ? (
                    <th style={{ textAlign: 'center', color: '#6b7280' }}>—</th>
                  ) : (
                    topAthletes.map(a => (
                      <th key={a} style={{ textAlign: 'center', fontSize: 11, padding: '8px 6px', minWidth: 70 }} title={a}>
                        {a.length > 14 ? a.slice(0, 13) + '…' : a}
                      </th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody>
                {displayBrandIds.map(bid => {
                  const isJoola = bid === 'joola'
                  const brandMentions = athleteMentionsByBrand[bid] || {}
                  return (
                    <tr key={bid} className={isJoola ? 'joola' : ''}>
                      <td style={{
                        fontWeight: 700,
                        color: isJoola ? '#22c55e' : 'var(--fg)',
                        position: 'sticky',
                        left: 0,
                        background: isJoola ? 'rgba(34,197,94,0.08)' : 'rgba(13,17,23,0.95)',
                        zIndex: 1,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="brand-dot" style={{ background: pgColor(bid) }} />
                          {name(bid)}
                        </div>
                      </td>
                      {topAthletes.length === 0 ? (
                        <td style={{ textAlign: 'center', color: '#6b7280' }}>—</td>
                      ) : (
                        topAthletes.map(a => {
                          const count = brandMentions[a] || 0
                          const opacity = mentionOpacity(count)
                          return (
                            <td
                              key={a}
                              style={{
                                textAlign: 'center',
                                fontSize: 12,
                                fontWeight: count > 0 ? 700 : 400,
                                color: count > 0 ? '#fff' : '#3f4651',
                                background: count > 0 ? `rgba(34,197,94,${opacity})` : 'transparent',
                                padding: '8px 6px',
                              }}
                              title={count > 0 ? `${name(bid)} mentioned ${a} in ${count} video${count === 1 ? '' : 's'}` : `No mentions of ${a} by ${name(bid)}`}
                            >
                              {count > 0 ? count : '—'}
                            </td>
                          )
                        })
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!hasAnyAnalysis && !hasAnyTranscripts && (
            <div style={{ padding: '12px 16px', color: '#6b7280', fontSize: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              No athlete mentions yet — table will populate once the enrichment pipeline runs.
            </div>
          )}
        </div>
      </section>
    </>
  )
}
