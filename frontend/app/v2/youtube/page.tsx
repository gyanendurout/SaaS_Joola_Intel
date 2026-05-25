'use client'

import { useEffect, useState } from 'react'
import {
  fetchBrands, fetchYT, fetchTopYTVideos, fetchYTVideoAnalysis,
  type V2Brand, type V2YTRow, type V2TopYTVideo, type V2YTVideoAnalysis,
} from '@/lib/v2/data'
import { fmt } from '@/components/v2/charts'
import { PageHead, pgColor, pgName, LoadingPage, SectionInfo, SortTh, FilterBanner, ColumnFilter } from '@/components/v2/PageShell'
import { PlatformPlaybook } from '@/components/v2/PlatformPlaybook'
import { youtubePlaybook } from '@/lib/v2/playbook'
import { useBrandFilter, applyBrandFilter } from '@/lib/v2/BrandFilterContext'
import { useDateRange, applyDateRangeCustom, DATE_RANGE_LABEL } from '@/lib/v2/DateRangeContext'
import { formatCalendarDateFromDaysAgo } from '@/lib/v2/format'

/** Relative caption ("3 days ago") kept only for the title tooltip on date cells. */
function relativeLabel(days: number): string {
  return days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
}

const YT_HANDLES: Record<string, string> = {
  joola: 'joolapickleball',
  selkirk: 'SelkirkSport',
  crbn: 'CRBNPickleball',
  // NOTE: `franklin` and `wilson` map to the generic Franklin Sports / Wilson
  // Sporting Goods corporate channels (their pickleball arms have no dedicated
  // YouTube channel). Same caveat as the TikTok / Twitter cleanup — see
  // `brands.yaml` and the audit notes in TODO_SESSION.md.
  franklin: 'FranklinSports',
  engage: 'EngagePickleball',
  paddletek: 'Paddletek',
  'six-zero': 'sixzeropickleball',
  onix: 'OnixPickleball',
  wilson: 'WilsonSportingGoods',
  gamma: 'GammaSports',
  prokennex: 'ProKennexPickleball',
  head: 'HEADPickleball',
}

export default function YouTubePage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [yt, setYt] = useState<V2YTRow[]>([])
  const [videos, setVideos] = useState<V2TopYTVideo[]>([])
  const [analyses, setAnalyses] = useState<V2YTVideoAnalysis[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [colFilter, setColFilter] = useState<Record<string, string>>({})
  const [subSortKey, setSubSortKey] = useState<string | null>(null)
  const [subSortDir, setSubSortDir] = useState<'asc' | 'desc'>('desc')
  const [subBrandFilter, setSubBrandFilter] = useState('')
  const [vpvSortKey, setVpvSortKey] = useState<string | null>(null)
  const [vpvSortDir, setVpvSortDir] = useState<'asc' | 'desc'>('desc')
  const [vpvBrandFilter, setVpvBrandFilter] = useState('')
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()
  const { range, effectiveFrom, effectiveTo } = useDateRange()

  useEffect(() => { document.title = 'JOOLA INTEL — YouTube' }, [])

  useEffect(() => {
    fetchBrands().then(async (b) => {
      try {
        const [y, v, a] = await Promise.all([fetchYT(b), fetchTopYTVideos(b, 200), fetchYTVideoAnalysis(b, 20)])
        setBrands(b); setAllBrands(b); setYt(y); setVideos(v); setAnalyses(a); setLoading(false)
      } catch (err) {
        console.error('YouTube data fetch failed', err)
        setError('Unable to load YouTube data. Please refresh.')
        setLoading(false)
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
  function toggleSubSort(key: string) {
    if (subSortKey === key) setSubSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSubSortKey(key); setSubSortDir('desc') }
  }
  function toggleVpvSort(key: string) {
    if (vpvSortKey === key) setVpvSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setVpvSortKey(key); setVpvSortDir('desc') }
  }

  const displayYt = applyBrandFilter(yt, filteredBrands, isFiltered)
  const displayVideosAll = applyBrandFilter(videos, filteredBrands, isFiltered)
  // Data-quality safeguard: drop clearly off-topic uploads (table tennis / regular tennis)
  // that occasionally slip into the scraped YouTube feed for tracked brands.
  const OFF_TOPIC_RE = /table tennis|ping pong|tennis match/i
  const displayVideosFilteredByDate = applyDateRangeCustom(displayVideosAll, effectiveFrom, effectiveTo)
  const displayVideos = displayVideosFilteredByDate.filter(v => !OFF_TOPIC_RE.test(v.title))
  const offTopicHidden = displayVideosFilteredByDate.length - displayVideos.length

  const name = (s: string) => pgName(s, brands)
  const topBySubs = [...displayYt].sort((a, b) => b.subs - a.subs)
  const maxSubs = topBySubs[0]?.subs || 1

  const vpvBase = [...displayYt].filter((d) => d.videos > 0)
  const vpvWithAvg = vpvBase.map(d => ({ ...d, avgViews: d.views / Math.max(1, d.videos) }))
  const maxVpv = vpvWithAvg.length > 0 ? Math.max(...vpvWithAvg.map(d => d.avgViews)) : 1

  // ─── Subs section: filter + sort ───────────────────────────────────
  const displaySubs = (() => {
    const q = subBrandFilter.trim().toLowerCase()
    const filtered = q
      ? topBySubs.filter(d => name(d.brand).toLowerCase().includes(q))
      : topBySubs
    const key = subSortKey || 'subs'
    const dir = subSortKey ? subSortDir : 'desc'
    return [...filtered].sort((a, b) => {
      let av: number | string, bv: number | string
      if (key === 'brand') { av = name(a.brand); bv = name(b.brand) }
      else if (key === 'videos') { av = a.videos; bv = b.videos }
      else { av = a.subs; bv = b.subs }
      if (typeof av === 'number' && typeof bv === 'number')
        return dir === 'asc' ? av - bv : bv - av
      return dir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av))
    })
  })()

  // ─── Views-per-video section: filter + sort ─────────────────────────
  const displayVpv = (() => {
    const q = vpvBrandFilter.trim().toLowerCase()
    const filtered = q
      ? vpvWithAvg.filter(d => name(d.brand).toLowerCase().includes(q))
      : vpvWithAvg
    const key = vpvSortKey || 'avgViews'
    const dir = vpvSortKey ? vpvSortDir : 'desc'
    return [...filtered].sort((a, b) => {
      let av: number | string, bv: number | string
      if (key === 'brand') { av = name(a.brand); bv = name(b.brand) }
      else if (key === 'videos') { av = a.videos; bv = b.videos }
      else if (key === 'subs') { av = a.subs; bv = b.subs }
      else { av = a.avgViews; bv = b.avgViews }
      if (typeof av === 'number' && typeof bv === 'number')
        return dir === 'asc' ? av - bv : bv - av
      return dir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av))
    })
  })()

  // Apply per-column filters (case-insensitive substring match) before sorting.
  const filteredVideos = displayVideos.filter(v => {
    const rec = v as unknown as Record<string, unknown>
    return Object.entries(colFilter).every(([col, q]) => {
      if (!q) return true
      const cell = col === 'brand' ? name(v.brand) : String(rec[col] ?? '')
      return cell.toLowerCase().includes(q.toLowerCase())
    })
  })

  const sortedVideos = sortKey ? [...filteredVideos].sort((a, b) => {
    const av = (a as Record<string, unknown>)[sortKey]
    const bv = (b as Record<string, unknown>)[sortKey]
    if (typeof av === 'number' && typeof bv === 'number')
      return sortDir === 'asc' ? av - bv : bv - av
    return sortDir === 'asc'
      ? String(av ?? '').localeCompare(String(bv ?? ''))
      : String(bv ?? '').localeCompare(String(av ?? ''))
  }) : filteredVideos

  return (
    <>
      <PageHead title="YOUTUBE" />
      <FilterBanner />

      <PlatformPlaybook
        title="YouTube Playbook"
        sub="Rule-derived competitor moves from yt_videos + yt_video_analysis."
        findings={youtubePlaybook(brands, displayYt, displayVideos, analyses)}
        brands={brands}
      />

      <section style={{ marginBottom: 28 }}>
        <div className="section-head">
          <div>
            <h2>
              Why competitor videos worked · top performers
              <SectionInfo
                title="Performance thesis from yt_video_analysis"
                description="One AI-generated row per top competitor video explaining WHY it performed (content type + thesis + product mentions). Pulled from the intelligence layer added in migration 012."
                source="yt_video_analysis (mig 012) JOIN yt_videos · ordered by view_count_at_analysis"
              />
            </h2>
            <div className="sub">Up to 20 most-viewed analyzed videos. Each row is a learnable performance pattern.</div>
          </div>
        </div>
        <div className="card">
          {analyses.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>
              No AI analyses available yet — run the yt_video_analysis enrichment pipeline.
            </div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 480, overflowY: 'auto' }}>
              <table className="data" style={{ width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
                  <tr>
                    <th>Brand</th>
                    <th style={{ width: '25%' }}>Video</th>
                    <th style={{ textAlign: 'right' }}>Views</th>
                    <th>Content type</th>
                    <th style={{ width: '28%' }}>Performance thesis</th>
                    <th>Product mentioned</th>
                  </tr>
                </thead>
                <tbody>
                  {analyses.map((a, i) => (
                    <tr key={i} className={a.brand === 'joola' ? 'joola' : ''}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className="brand-dot" style={{ background: pgColor(a.brand) }} />
                          <span style={{ fontWeight: 700, fontSize: 12, color: a.brand === 'joola' ? '#22c55e' : 'var(--fg)' }}>{name(a.brand)}</span>
                        </span>
                      </td>
                      <td style={{ fontSize: 11 }}>
                        {a.url ? (
                          <a href={a.url} target="_blank" rel="noopener noreferrer" className="ext-link">{a.title.slice(0, 80)}</a>
                        ) : a.title.slice(0, 80)}
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(a.views)}</td>
                      <td><span className="pill pill-ghost" style={{ fontSize: 10 }}>{a.contentType || '—'}</span></td>
                      <td style={{ fontSize: 11, color: 'var(--fg-3)' }}>{a.performanceThesis || '—'}</td>
                      <td style={{ fontSize: 10, color: 'var(--fg-4)' }}>
                        {a.productsMentioned.length > 0 ? a.productsMentioned.slice(0, 3).join(', ') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="two-col">
          <div>
            <div className="section-head"><div>
              <h2>
                Channels by subscriber count
                <SectionInfo
                  title="YouTube Subscriber Ranking"
                  description="Who has the biggest YouTube audience right now. More subscribers = more organic reach every time a new video is published."
                  source="yt_channel_weekly · latest weekly snapshot"
                />
              </h2>
              <div className="sub">{displayYt.length} brands · current snapshot</div>
            </div></div>
            <div className="card"><div className="card-pad">
              <table className="data" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
                <thead>
                  <tr>
                    <SortTh col="brand" label="Brand" sortKey={subSortKey} sortDir={subSortDir} toggle={toggleSubSort} style={{ width: 110 }} />
                    <SortTh col="subs" label="Subscribers" sortKey={subSortKey} sortDir={subSortDir} toggle={toggleSubSort} style={{ textAlign: 'right' }} />
                    <SortTh col="subs" label="" sortKey={subSortKey} sortDir={subSortDir} toggle={toggleSubSort} style={{ width: 80, textAlign: 'right' }} />
                    <SortTh col="videos" label="Videos" sortKey={subSortKey} sortDir={subSortDir} toggle={toggleSubSort} style={{ width: 60, textAlign: 'right' }} />
                  </tr>
                  <tr className="col-filter-row">
                    <th><ColumnFilter col="brand" value={subBrandFilter} onChange={setSubBrandFilter} placeholder="brand…" /></th>
                    <th colSpan={3} />
                  </tr>
                </thead>
              </table>
              {displaySubs.map(d => (
                <div key={d.brand} className={'bar-row ' + (d.brand === 'joola' ? 'joola' : '')}>
                  <div className="lbl" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span>{name(d.brand)}</span>
                    {YT_HANDLES[d.brand] && (
                      <a
                        href={`https://www.youtube.com/@${YT_HANDLES[d.brand]}`}
                        target="_blank" rel="noopener noreferrer"
                        className="ext-link"
                        style={{ fontSize: 10 }}
                        onClick={e => e.stopPropagation()}
                      >
                        @{YT_HANDLES[d.brand]}
                      </a>
                    )}
                  </div>
                  <div className="track">
                    <div className="fill" style={{
                      width: d.subs > 0 ? Math.max(2, d.subs / maxSubs * 100) + '%' : '2%',
                      background: `linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                    }} />
                  </div>
                  <div className="spark-mini" style={{ textAlign: 'right', fontWeight: 700, color: d.subs > 0 ? 'var(--fg)' : 'var(--fg-4)' }}>
                    {d.subs > 0 ? fmt(d.subs) : '—'}
                  </div>
                  <div className="delta-mini flat">{d.videos > 0 ? d.videos + 'v' : '—'}</div>
                </div>
              ))}
            </div></div>
          </div>
          <div>
            <div className="section-head"><div>
              <h2>
                Views per video · efficiency
                <SectionInfo
                  title="YouTube Video Efficiency"
                  description="Total channel views divided by number of videos. A high score means each video is pulling its weight — quality over quantity. Low score = lots of videos but low viewership per upload."
                  source="yt_videos · view_count / video count per brand"
                />
              </h2>
              <div className="sub">Who makes the most-watched videos per upload.</div>
            </div></div>
            <div className="card"><div className="card-pad">
              <table className="data" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
                <thead>
                  <tr>
                    <SortTh col="brand" label="Brand" sortKey={vpvSortKey} sortDir={vpvSortDir} toggle={toggleVpvSort} style={{ width: 110 }} />
                    <SortTh col="subs" label="Subs" sortKey={vpvSortKey} sortDir={vpvSortDir} toggle={toggleVpvSort} style={{ width: 70, textAlign: 'right' }} />
                    <SortTh col="videos" label="Videos" sortKey={vpvSortKey} sortDir={vpvSortDir} toggle={toggleVpvSort} style={{ width: 60, textAlign: 'right' }} />
                    <SortTh col="avgViews" label="Avg views" sortKey={vpvSortKey} sortDir={vpvSortDir} toggle={toggleVpvSort} style={{ textAlign: 'right' }} />
                    <SortTh col="avgViews" label="" sortKey={vpvSortKey} sortDir={vpvSortDir} toggle={toggleVpvSort} style={{ width: 80, textAlign: 'right' }} />
                  </tr>
                  <tr className="col-filter-row">
                    <th><ColumnFilter col="brand" value={vpvBrandFilter} onChange={setVpvBrandFilter} placeholder="brand…" /></th>
                    <th colSpan={4} />
                  </tr>
                </thead>
              </table>
              {displayVpv.length > 0 ? displayVpv.map(d => (
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
                      width: Math.max(2, d.avgViews / maxVpv * 100) + '%',
                      background: d.brand === 'joola' ? '#22c55e' : `linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                    }} />
                  </div>
                  <div className="spark-mini" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--fg)' }}>
                    {fmt(Math.round(d.avgViews))}
                  </div>
                  <div className="delta-mini flat">{d.videos}v</div>
                </div>
              )) : (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>
                  {vpvBrandFilter ? 'No brands match the filter.' : 'No video data yet — run pipeline first'}
                </div>
              )}
            </div></div>
          </div>
        </div>
      </section>

      <section id="youtube-videos-table">
        <div className="section-head"><div>
          <h2>
            Top {sortedVideos.length} videos · by views
            <SectionInfo
              title="Top YouTube Videos"
              description="Up to the 200 most-viewed YouTube videos across the tracked brands, ranked by view count. Narrow with the brand filter (top right), the date range (top right), or per-column search below. Long-form coaching content tends to dominate."
              source="yt_videos · scraped weekly via streamers/youtube-scraper. Click column headers to sort."
            />
          </h2>
          <div className="sub">
            Showing <strong style={{ color: 'var(--fg)' }}>{sortedVideos.length}</strong> of up to 200 ·
            {' '}sorted by views · {DATE_RANGE_LABEL[range].toLowerCase()} · click column headers to sort.
            {offTopicHidden > 0 && (
              <span style={{ marginLeft: 6, color: 'var(--fg-4)' }}>
                · {offTopicHidden} off-topic row{offTopicHidden === 1 ? '' : 's'} hidden
              </span>
            )}
          </div>
        </div></div>
        <div className="card">
          {sortedVideos.length > 0 ? (
            <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
              <table className="data">
                <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
                  <tr>
                    <SortTh col="brand" label="Brand" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                    <SortTh col="title" label="Title" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ width: '38%' }} />
                    <SortTh col="is_short" label="Short?" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ width: 70, textAlign: 'center' }} />
                    <SortTh col="duration" label="Duration" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                    <SortTh col="views" label="Views" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                    <SortTh col="likes" label="Likes" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                    <SortTh col="comments" label="Comments" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                    <SortTh col="days" label="Posted" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                  </tr>
                  <tr className="col-filter-row">
                    <th><ColumnFilter col="brand" value={colFilter.brand} onChange={v => setColFilter(p => ({ ...p, brand: v }))} placeholder="brand…" /></th>
                    <th><ColumnFilter col="title" value={colFilter.title} onChange={v => setColFilter(p => ({ ...p, title: v }))} placeholder="search title…" /></th>
                    <th colSpan={6} />
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
                                <a href={`https://www.youtube.com/@${YT_HANDLES[v.brand]}`} target="_blank" rel="noopener noreferrer" className="ext-link" style={{ fontSize: 10 }} onClick={e => e.stopPropagation()}>
                                  @{YT_HANDLES[v.brand]}
                                </a>
                              )}
                            </div>
                          </div>
                        </td>
                        <td style={{ color: 'var(--fg)' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                            <span style={{ fontSize: 12 }}>{v.title?.slice(0, 70) || '—'}</span>
                            <a
                              href={watchHref}
                              target="_blank" rel="noopener noreferrer"
                              className="ext-link"
                              style={{ marginTop: 1, flexShrink: 0 }}
                              title={hasDirectLink ? undefined : 'Opens YouTube search — direct link unavailable'}
                              onClick={e => e.stopPropagation()}
                            >
                              {hasDirectLink ? 'Watch' : 'Search'}
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                            </a>
                          </div>
                        </td>
                        <td className="cell-num" style={{ textAlign: 'center' }}>
                          {v.is_short ? <span style={{ color: '#F5E625', fontWeight: 700 }}>Short</span> : <span style={{ color: 'var(--fg-4)' }}>—</span>}
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
          ) : (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>
              <div style={{ fontSize: 13, marginBottom: 8 }}>No videos match the current filters.</div>
              <div style={{ fontSize: 11 }}>
                Try widening the date range (top right){displayVideosAll.length > 0 ? `, expanding the brand filter, or clearing the column search.` : ' or check back after the next weekly refresh.'}
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
