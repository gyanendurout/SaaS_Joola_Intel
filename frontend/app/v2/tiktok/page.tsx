'use client'

import { useEffect, useState } from 'react'
import {
  fetchBrands, fetchTikTok, fetchTopTikTokVideos,
  type V2Brand, type V2TikTokRow, type V2TikTokVideo,
} from '@/lib/v2/data'
import { fmt } from '@/components/v2/charts'
import { PageHead, pgColor, pgName, LoadingPage, SectionInfo, SortTh, FilterBanner, ColumnFilter } from '@/components/v2/PageShell'
import { useBrandFilter, applyBrandFilter } from '@/lib/v2/BrandFilterContext'
import { useDateRange, applyDateRangeCustom, DATE_RANGE_LABEL } from '@/lib/v2/DateRangeContext'
import { formatCalendarDateFromDaysAgo } from '@/lib/v2/format'

/** Relative caption ("3 days ago") kept only for the title tooltip on date cells. */
function relativeLabel(days: number): string {
  return days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
}

const TIKTOK_HANDLES: Record<string, string> = {
  joola:      'joolapickleball',
  selkirk:    'selkirksport',
  crbn:       'crbnpickleball',
  engage:     'engage_pickleball',
  'six-zero': 'sixzeropickleball',
  onix:       'onix_pickleball',
  wilson:     'wilsonsportinggoods',
  gamma:      'gammasports',
  prokennex:  'prokennexpickleball',
}

export default function TikTokPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [ttData, setTtData] = useState<V2TikTokRow[]>([])
  const [videos, setVideos] = useState<V2TikTokVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [colFilter, setColFilter] = useState<Record<string, string>>({})
  const [followerSortKey, setFollowerSortKey] = useState<string | null>(null)
  const [followerSortDir, setFollowerSortDir] = useState<'asc' | 'desc'>('desc')
  const [followerBrandFilter, setFollowerBrandFilter] = useState('')
  const [vpvSortKey, setVpvSortKey] = useState<string | null>(null)
  const [vpvSortDir, setVpvSortDir] = useState<'asc' | 'desc'>('desc')
  const [vpvBrandFilter, setVpvBrandFilter] = useState('')
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()
  const { range, effectiveFrom, effectiveTo } = useDateRange()

  useEffect(() => { document.title = 'JOOLA INTEL — TikTok' }, [])

  useEffect(() => {
    fetchBrands().then(async (b) => {
      try {
        const [t, v] = await Promise.all([fetchTikTok(b), fetchTopTikTokVideos(b, 200)])
        setBrands(b); setAllBrands(b); setTtData(t); setVideos(v); setLoading(false)
      } catch (err) {
        console.error('TikTok data fetch failed', err)
        setError('Unable to load TikTok data. Please refresh.')
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
  function toggleFollowerSort(key: string) {
    if (followerSortKey === key) setFollowerSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setFollowerSortKey(key); setFollowerSortDir('desc') }
  }
  function toggleVpvSort(key: string) {
    if (vpvSortKey === key) setVpvSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setVpvSortKey(key); setVpvSortDir('desc') }
  }

  const displayTT = applyBrandFilter(ttData, filteredBrands, isFiltered)
  const displayVideosAll = applyBrandFilter(videos, filteredBrands, isFiltered)
  const displayVideos = applyDateRangeCustom(displayVideosAll, effectiveFrom, effectiveTo)

  const name = (s: string) => pgName(s, brands)
  const topByFollowers = [...displayTT].sort((a, b) => b.followers - a.followers)
  const maxFollowers = topByFollowers[0]?.followers || 1

  const vpvSorted = [...displayTT].filter(d => d.videos > 0)
    .sort((a, b) => b.avgViews - a.avgViews)
  const maxVpv = vpvSorted[0]?.avgViews || 1

  // ─── Follower section: filter + sort ────────────────────────────────
  const displayFollowers = (() => {
    const q = followerBrandFilter.trim().toLowerCase()
    const filtered = q
      ? topByFollowers.filter(d => name(d.brand).toLowerCase().includes(q))
      : topByFollowers
    const key = followerSortKey || 'followers'
    const dir = followerSortKey ? followerSortDir : 'desc'
    return [...filtered].sort((a, b) => {
      let av: number | string, bv: number | string
      if (key === 'brand') { av = name(a.brand); bv = name(b.brand) }
      else if (key === 'videos') { av = a.videos; bv = b.videos }
      else { av = a.followers; bv = b.followers }
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
      ? vpvSorted.filter(d => name(d.brand).toLowerCase().includes(q))
      : vpvSorted
    const key = vpvSortKey || 'avgViews'
    const dir = vpvSortKey ? vpvSortDir : 'desc'
    return [...filtered].sort((a, b) => {
      let av: number | string, bv: number | string
      if (key === 'brand') { av = name(a.brand); bv = name(b.brand) }
      else if (key === 'videos') { av = a.videos; bv = b.videos }
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
      <PageHead title="TIKTOK" />
      <FilterBanner />

      <section>
        <div className="two-col">
          <div>
            <div className="section-head"><div>
              <h2>
                Follower count · ranked
                <SectionInfo
                  title="TikTok Follower Ranking"
                  description="Who has the biggest TikTok audience right now. JOOLA's TikTok (~20-30K estimated) is notably stronger than its X presence — short-form video is the right channel for the pickleball demographic."
                  source="tiktok_profiles_weekly · latest weekly snapshot"
                />
              </h2>
              <div className="sub">{displayTT.length} brands · current snapshot</div>
            </div></div>
            <div className="card"><div className="card-pad">
              <table className="data" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
                <thead>
                  <tr>
                    <SortTh col="brand" label="Brand" sortKey={followerSortKey} sortDir={followerSortDir} toggle={toggleFollowerSort} style={{ width: 110 }} />
                    <SortTh col="followers" label="Followers" sortKey={followerSortKey} sortDir={followerSortDir} toggle={toggleFollowerSort} style={{ textAlign: 'right' }} />
                    <SortTh col="followers" label="" sortKey={followerSortKey} sortDir={followerSortDir} toggle={toggleFollowerSort} style={{ width: 80, textAlign: 'right' }} />
                    <SortTh col="videos" label="Videos" sortKey={followerSortKey} sortDir={followerSortDir} toggle={toggleFollowerSort} style={{ width: 60, textAlign: 'right' }} />
                  </tr>
                  <tr className="col-filter-row">
                    <th><ColumnFilter col="brand" value={followerBrandFilter} onChange={setFollowerBrandFilter} placeholder="brand…" /></th>
                    <th colSpan={3} />
                  </tr>
                </thead>
              </table>
              {displayFollowers.map(d => (
                <div key={d.brand} className={'bar-row ' + (d.brand === 'joola' ? 'joola' : '')}>
                  <div className="lbl" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span>{name(d.brand)}</span>
                    {TIKTOK_HANDLES[d.brand] && (
                      <a
                        href={`https://www.tiktok.com/@${TIKTOK_HANDLES[d.brand]}`}
                        target="_blank" rel="noopener noreferrer"
                        className="ext-link"
                        style={{ fontSize: 10 }}
                        onClick={e => e.stopPropagation()}
                      >
                        @{TIKTOK_HANDLES[d.brand]}
                      </a>
                    )}
                  </div>
                  <div className="track">
                    <div className="fill" style={{
                      width: d.followers > 0 ? Math.max(2, d.followers / maxFollowers * 100) + '%' : '2%',
                      background: `linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                    }} />
                  </div>
                  <div className="spark-mini" style={{ textAlign: 'right', fontWeight: 700, color: d.followers > 0 ? 'var(--fg)' : 'var(--fg-4)' }}>
                    {d.followers > 0 ? fmt(d.followers) : '—'}
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
                  title="TikTok Video Efficiency"
                  description="Average views per video posted. A high score means each video is pulling a large audience — quality content strategy. Brands with many videos but low avg views are posting too much filler."
                  source="tiktok_videos · scraped via clockworks/tiktok-scraper"
                />
              </h2>
              <div className="sub">Who makes the most-watched videos per upload.</div>
            </div></div>
            <div className="card"><div className="card-pad">
              <table className="data" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
                <thead>
                  <tr>
                    <SortTh col="brand" label="Brand" sortKey={vpvSortKey} sortDir={vpvSortDir} toggle={toggleVpvSort} style={{ width: 110 }} />
                    <SortTh col="avgViews" label="Avg views" sortKey={vpvSortKey} sortDir={vpvSortDir} toggle={toggleVpvSort} style={{ textAlign: 'right' }} />
                    <SortTh col="avgViews" label="" sortKey={vpvSortKey} sortDir={vpvSortDir} toggle={toggleVpvSort} style={{ width: 80, textAlign: 'right' }} />
                    <SortTh col="videos" label="Videos" sortKey={vpvSortKey} sortDir={vpvSortDir} toggle={toggleVpvSort} style={{ width: 60, textAlign: 'right' }} />
                  </tr>
                  <tr className="col-filter-row">
                    <th><ColumnFilter col="brand" value={vpvBrandFilter} onChange={setVpvBrandFilter} placeholder="brand…" /></th>
                    <th colSpan={3} />
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
                    document.getElementById('tiktok-videos-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

      <section id="tiktok-videos-table">
        <div className="section-head"><div>
          <h2>
            Top {sortedVideos.length} videos · by views
            <SectionInfo
              title="Top TikTok Videos"
              description="Up to the 200 most-viewed TikTok videos across the tracked brands, ranked by view count. Narrow with the brand filter (top right), the date range (top right), or per-column search below. Short-form tutorials and challenge content tend to dominate; high share counts indicate viral potential."
              source="tiktok_videos · scraped via clockworks/tiktok-scraper. Click column headers to sort."
            />
          </h2>
          <div className="sub">
            Showing <strong style={{ color: 'var(--fg)' }}>{sortedVideos.length}</strong> of up to 200 ·
            {' '}sorted by views · {DATE_RANGE_LABEL[range].toLowerCase()} · click column headers to sort.
          </div>
        </div></div>
        <div className="card">
          {sortedVideos.length > 0 ? (
            <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
              <table className="data">
                <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
                  <tr>
                    <SortTh col="brand" label="Brand" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                    <SortTh col="text" label="Caption" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ width: '38%' }} />
                    <SortTh col="views" label="Views" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                    <SortTh col="likes" label="Likes" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                    <SortTh col="comments" label="Comments" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                    <SortTh col="shares" label="Shares" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                    <SortTh col="days" label="Posted" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                  </tr>
                  <tr className="col-filter-row">
                    <th><ColumnFilter col="brand" value={colFilter.brand} onChange={v => setColFilter(p => ({ ...p, brand: v }))} placeholder="brand…" /></th>
                    <th><ColumnFilter col="text" value={colFilter.text} onChange={v => setColFilter(p => ({ ...p, text: v }))} placeholder="search caption…" /></th>
                    <th colSpan={5} />
                  </tr>
                </thead>
                <tbody>
                  {sortedVideos.map((v, i) => (
                    <tr key={i} className={v.brand === 'joola' ? 'joola' : ''}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="brand-dot" style={{ background: pgColor(v.brand) }} />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontWeight: 700, color: v.brand === 'joola' ? '#22c55e' : 'var(--fg)' }}>{name(v.brand)}</span>
                            {TIKTOK_HANDLES[v.brand] && (
                              <a href={`https://www.tiktok.com/@${TIKTOK_HANDLES[v.brand]}`} target="_blank" rel="noopener noreferrer" className="ext-link" style={{ fontSize: 10 }} onClick={e => e.stopPropagation()}>
                                @{TIKTOK_HANDLES[v.brand]}
                              </a>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ color: 'var(--fg)' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                          <span style={{ fontSize: 12 }}>{v.text?.slice(0, 70) || '—'}</span>
                          {v.video_url && (
                            <a href={v.video_url} target="_blank" rel="noopener noreferrer" className="ext-link" style={{ marginTop: 1, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                              Watch
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625' }}>{fmt(v.views)}</td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(v.likes)}</td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(v.comments)}</td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(v.shares)}</td>
                      <td className="cell-num" title={relativeLabel(v.days)}>{formatCalendarDateFromDaysAgo(v.days)}</td>
                    </tr>
                  ))}
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
