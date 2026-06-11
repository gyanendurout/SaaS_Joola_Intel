'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  fetchBrands, fetchTikTok, fetchTopTikTokVideos,
  fetchTikTokCommentStats, fetchTikTokPaddleMentions,
  type V2Brand, type V2TikTokRow, type V2TikTokVideo,
  type V2TikTokCommentStats, type V2TikTokPaddleMention,
} from '@/lib/v2/data'
import { fmt, Donut } from '@/components/v2/charts'
import { PageHead, pgColor, pgName, LoadingPage, SectionInfo, SortTh, FilterBanner, ColumnFilter } from '@/components/v2/PageShell'
import { PlatformPlaybook } from '@/components/v2/PlatformPlaybook'
import { tiktokPlaybook } from '@/lib/v2/playbook'
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
  const [commentStats, setCommentStats] = useState<V2TikTokCommentStats[]>([])
  const [paddleMentions, setPaddleMentions] = useState<V2TikTokPaddleMention[]>([])
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
  const [bwSortKey, setBwSortKey] = useState<string>('followers')
  const [bwSortDir, setBwSortDir] = useState<'asc' | 'desc'>('desc')
  const [selectedVideo, setSelectedVideo] = useState<V2TikTokVideo | null>(null)
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()
  const { range, effectiveFrom, effectiveTo } = useDateRange()
  const router = useRouter()

  useEffect(() => { document.title = 'JOOLA INTEL — TikTok' }, [])
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedVideo(null) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    fetchBrands().then(async (b) => {
      try {
        const [t, v, cs, pm] = await Promise.all([
          fetchTikTok(b), fetchTopTikTokVideos(b, 200),
          fetchTikTokCommentStats(b), fetchTikTokPaddleMentions(b, 20),
        ])
        setBrands(b); setAllBrands(b); setTtData(t); setVideos(v)
        setCommentStats(cs); setPaddleMentions(pm); setLoading(false)
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

  function toggleBwSort(col: string) {
    if (bwSortKey === col) setBwSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setBwSortKey(col); setBwSortDir('desc') }
  }
  const topVideoByBrand: Record<string, V2TikTokVideo> = {}
  displayVideos.forEach(v => {
    if (!topVideoByBrand[v.brand] || v.views > topVideoByBrand[v.brand].views)
      topVideoByBrand[v.brand] = v
  })
  const sortedBrandOverview = [...displayTT].sort((a, b) => {
    if (a.brand === 'joola') return -1
    if (b.brand === 'joola') return 1
    const getV = (x: typeof a): number | string => {
      if (bwSortKey === 'brand') return name(x.brand)
      if (bwSortKey === 'videos') return x.videos
      if (bwSortKey === 'totalHearts') return x.totalHearts
      if (bwSortKey === 'avgViews') return x.avgViews
      if (bwSortKey === 'delta') return x.delta ?? -9999
      return x.followers
    }
    const av = getV(a), bv = getV(b)
    if (typeof av === 'number' && typeof bv === 'number')
      return bwSortDir === 'asc' ? av - bv : bv - av
    return bwSortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
  })

  return (
    <>
      <PageHead title="TIKTOK" />
      <FilterBanner />

      <PlatformPlaybook
        title="TikTok Playbook"
        sub="Rule-derived TikTok competitor moves from tiktok_videos + tiktok_comments."
        findings={tiktokPlaybook(brands, displayTT, displayVideos, commentStats, paddleMentions)}
        brands={brands}
      />

      {/* ── Brand-wise Overview Table ── */}
      <section style={{ marginBottom: 28 }}>
        <div className="section-head">
          <div>
            <h2>Brand-wise overview <SectionInfo title="TikTok Channel Overview" description="One row per brand — followers, growth, video count, total hearts, avg views per video, and best post. Click any row for full brand TikTok activity." source="tiktok_profiles_weekly · tiktok_videos · latest snapshot" /></h2>
            <div className="sub">{sortedBrandOverview.length} brands · click a row to view full details</div>
          </div>
        </div>
        <div className="card">
          <div className="table-wrap">
            <table className="data" style={{ width: '100%' }}>
              <thead><tr>
                <th style={{ width: 28, textAlign: 'center', color: 'var(--fg-4)', fontSize: 10 }}>#</th>
                <SortTh col="brand"       label="Brand"        sortKey={bwSortKey} sortDir={bwSortDir} toggle={toggleBwSort} style={{ minWidth: 130 }} />
                <SortTh col="followers"   label="Followers"    sortKey={bwSortKey} sortDir={bwSortDir} toggle={toggleBwSort} style={{ textAlign: 'right' }} />
                <SortTh col="delta"       label="Flw Δ (wk)"  sortKey={bwSortKey} sortDir={bwSortDir} toggle={toggleBwSort} style={{ textAlign: 'right', width: 80 }} />
                <SortTh col="videos"      label="Videos"       sortKey={bwSortKey} sortDir={bwSortDir} toggle={toggleBwSort} style={{ textAlign: 'right', width: 70 }} />
                <SortTh col="totalHearts" label="Total Hearts" sortKey={bwSortKey} sortDir={bwSortDir} toggle={toggleBwSort} style={{ textAlign: 'right' }} />
                <SortTh col="avgViews"    label="Avg Views"    sortKey={bwSortKey} sortDir={bwSortDir} toggle={toggleBwSort} style={{ textAlign: 'right', width: 90 }} />
                <th style={{ minWidth: 180 }}>Top Video</th>
                <th style={{ width: 70, textAlign: 'center' }}>Profile</th>
              </tr></thead>
              <tbody>
                {sortedBrandOverview.map((d, i) => {
                  const isJ = d.brand === 'joola'
                  const color = pgColor(d.brand)
                  const tv = topVideoByBrand[d.brand]
                  return (
                    <tr key={d.brand} className={isJ ? 'joola' : ''}
                      style={{ cursor: 'pointer' }}
                      onClick={() => router.push(`/v2/tiktok/brand/${encodeURIComponent(d.brand)}`)}
                      title={`View ${name(d.brand)} TikTok details`}>
                      <td style={{ textAlign: 'center', fontSize: 11, color: 'var(--fg-4)', fontFamily: 'JetBrains Mono' }}>{i + 1}</td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                            <span style={{ fontWeight: 700, color: isJ ? '#22c55e' : 'var(--fg)' }}>{name(d.brand)}</span>
                          </span>
                          {TIKTOK_HANDLES[d.brand] && <span style={{ paddingLeft: 15, fontSize: 10, color: 'var(--fg-4)' }}>@{TIKTOK_HANDLES[d.brand]}</span>}
                        </div>
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'JetBrains Mono', color: isJ ? '#22c55e' : 'var(--fg)' }}>
                        {d.followers > 0 ? fmt(d.followers) : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>
                        {d.delta != null && d.delta !== 0 ? (
                          <span style={{ fontWeight: 700, fontSize: 11, fontFamily: 'JetBrains Mono', color: d.delta >= 0 ? '#22c55e' : '#ef4444' }}>
                            {d.delta >= 0 ? '+' : ''}{fmt(d.delta)}
                          </span>
                        ) : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right', color: 'var(--fg-3)' }}>{d.videos > 0 ? d.videos : '—'}</td>
                      <td className="cell-num" style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'JetBrains Mono', color: '#f97316' }}>
                        {d.totalHearts > 0 ? fmt(d.totalHearts) : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right', fontFamily: 'JetBrains Mono', color: '#F5E625', fontWeight: 700 }}>
                        {d.avgViews > 0 ? fmt(d.avgViews) : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                      </td>
                      <td style={{ maxWidth: 200 }}>
                        {tv ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontSize: 11, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 190 }} title={tv.text}>
                              {(tv.text || '').slice(0, 55)}{(tv.text || '').length > 55 ? '…' : ''}
                            </span>
                            <span style={{ fontSize: 10, color: '#F5E625', fontFamily: 'JetBrains Mono' }}>👁 {fmt(tv.views)}</span>
                          </div>
                        ) : <span style={{ color: 'var(--fg-4)', fontSize: 11 }}>No video data</span>}
                      </td>
                      <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        {TIKTOK_HANDLES[d.brand] ? (
                          <a href={`https://www.tiktok.com/@${TIKTOK_HANDLES[d.brand]}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ fontSize: 10, padding: '3px 8px' }}>View ↗</a>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 28 }}>
        <div className="two-col-even">
          <div>
            <div className="section-head">
              <div>
                <h2>
                  TikTok comment sentiment · by brand
                  <SectionInfo
                    title="TikTok comment sentiment"
                    description="Positive vs negative vs neutral TikTok comment counts per brand. Pulled from the tiktok_comments table (migration 014) and its sentiment_label column."
                    source="tiktok_comments · sentiment_label · GROUP BY brand_id"
                  />
                </h2>
                <div className="sub">Audience tone per brand — large neutral % usually means classifier still calibrating.</div>
              </div>
            </div>
            <div className="card"><div className="card-pad">
              {commentStats.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>
                  No TikTok comment data — run scrape_comments.py + enrichment.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                  {commentStats.slice(0, 10).map(c => {
                    const tot = Math.max(1, c.total)
                    const posPct = (c.positive / tot) * 100
                    const neuPct = (c.neutral / tot) * 100
                    const negPct = (c.negative / tot) * 100
                    return (
                      <div key={c.brand} className={'sent-row ' + (c.brand === 'joola' ? 'joola' : '')} style={{ padding: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: c.brand === 'joola' ? '#22c55e' : 'var(--fg)' }}>{name(c.brand)}</span>
                          <span style={{ fontSize: 10, color: 'var(--fg-4)' }}>{fmt(c.total)} comments · {Math.round((c.enriched / tot) * 100)}% enriched</span>
                        </div>
                        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'rgba(255,255,255,0.04)' }}>
                          <div style={{ width: posPct + '%', background: '#22c55e' }} title={`Positive ${c.positive}`} />
                          <div style={{ width: neuPct + '%', background: '#94a3b8', opacity: 0.5 }} title={`Neutral ${c.neutral}`} />
                          <div style={{ width: negPct + '%', background: '#ef4444' }} title={`Negative ${c.negative}`} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div></div>
          </div>

          <div>
            <div className="section-head">
              <div>
                <h2>
                  Top paddle mentions · TikTok comments
                  <SectionInfo
                    title="Paddle mentions in TikTok comments"
                    description="Which paddles get name-checked most in TikTok comment threads. Extracted from tiktok_comments.products_mentioned[] (GPT-4o-mini NER)."
                    source="tiktok_comments.products_mentioned[] · aggregated by (brand, paddle)"
                  />
                </h2>
                <div className="sub">Top 20 paddle mentions across the TikTok comment stream.</div>
              </div>
            </div>
            <div className="card"><div className="card-pad">
              {paddleMentions.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>
                  No paddle mentions yet — run tiktok_enrichment.py.
                </div>
              ) : (() => {
                const top = paddleMentions.slice(0, 12)
                const total = top.reduce((s, p) => s + p.mentions, 0)
                const donutData = top.map(p => ({
                  name: p.paddle,
                  value: p.mentions,
                  color: pgColor(p.brand),
                }))
                return (
                  <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    {/* Donut */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <Donut data={donutData} size={220} thickness={36} centerLabel={String(total)} centerSub="mentions" />
                    </div>
                    {/* Legend */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7, minWidth: 180 }}>
                      {top.map((p, i) => {
                        const pct = total > 0 ? Math.round((p.mentions / total) * 100) : 0
                        const c = pgColor(p.brand)
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ width: 10, height: 10, borderRadius: 2, background: c, flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: p.brand === 'joola' ? '#22c55e' : 'var(--fg)' }}>{p.paddle}</span>
                              <span style={{ fontSize: 10, color: 'var(--fg-4)', marginLeft: 6 }}>{name(p.brand)}</span>
                            </div>
                            <span style={{ fontSize: 10, color: 'var(--fg-4)', minWidth: 28, textAlign: 'right' }}>{pct}%</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: c, fontFamily: 'JetBrains Mono', minWidth: 20, textAlign: 'right' }}>{p.mentions}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </div></div>
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 28 }}>
        <div className="section-head">
          <div>
            <h2>
              Viral video pattern · views vs comments
              <SectionInfo
                title="Viral pattern scatter"
                description="Each dot is a TikTok video; X-axis = view count, Y-axis = comment count. Outliers in the top-right are the most engaging videos in absolute terms. Colored by brand."
                source="tiktok_videos · top 100 by views"
              />
            </h2>
            <div className="sub">Top 100 TikTok videos in the sample, plotted to surface viral outliers.</div>
          </div>
        </div>
        <div className="card"><div className="card-pad">
          {(() => {
            const sample = displayVideos.slice(0, 100)
            if (sample.length === 0) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>No TikTok videos to plot.</div>
            const W = 760, H = 320, padL = 50, padR = 20, padT = 16, padB = 32
            const maxV = Math.max(1, ...sample.map(v => v.views))
            const maxC = Math.max(1, ...sample.map(v => v.comments))
            const xScale = (v: number) => padL + (Math.log10(v + 1) / Math.log10(maxV + 1)) * (W - padL - padR)
            const yScale = (c: number) => H - padB - (Math.log10(c + 1) / Math.log10(maxC + 1)) * (H - padT - padB)
            return (
              <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', cursor: 'pointer' }}>
                <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="rgba(255,255,255,0.1)" />
                <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="rgba(255,255,255,0.1)" />
                <text x={W / 2} y={H - 6} fill="#8a93a4" fontSize="10" textAnchor="middle">Views (log scale)</text>
                <text x={12} y={H / 2} fill="#8a93a4" fontSize="10" textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`}>Comments (log scale)</text>
                {sample.map((v, i) => {
                  const isJ = v.brand === 'joola'
                  const cx = xScale(v.views), cy = yScale(v.comments)
                  const r = isJ ? 8 : 5
                  return (
                    <g key={i} style={{ cursor: 'pointer' }} onClick={() => setSelectedVideo(v)}>
                      {/* invisible larger hit area */}
                      <circle cx={cx} cy={cy} r={r + 8} fill="transparent" />
                      <circle cx={cx} cy={cy} r={r}
                        fill={pgColor(v.brand)} fillOpacity={0.85}
                        stroke={isJ ? '#22c55e' : 'rgba(255,255,255,0.25)'} strokeWidth={isJ ? 2 : 1}
                        style={{ transition: 'r 120ms' }}>
                        <title>{name(v.brand)} · {fmt(v.views)} views · {fmt(v.comments)} comments · click for details</title>
                      </circle>
                    </g>
                  )
                })}
              </svg>
            )
          })()}
        </div></div>

        {/* ── Video detail modal ── */}
        {selectedVideo && (() => {
          const v = selectedVideo
          const bColor = pgColor(v.brand)
          const isJ = v.brand === 'joola'
          const engRate = v.views > 0 ? (((v.likes + v.comments) / v.views) * 100).toFixed(2) : '0'
          const watchUrl = v.video_url || `https://www.tiktok.com/search?q=${encodeURIComponent(v.text?.slice(0, 40) ?? '')}`
          return (
            <div onClick={() => setSelectedVideo(null)}
              style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
              <div onClick={e => e.stopPropagation()}
                style={{ background: '#0d1117', border: `1px solid ${bColor}55`, borderRadius: 16, width: '100%', maxWidth: 560, overflow: 'hidden', boxShadow: `0 32px 80px rgba(0,0,0,0.65), 0 0 0 1px ${bColor}22` }}>

                {/* Header */}
                <div style={{ background: `linear-gradient(135deg, ${bColor}22 0%, rgba(13,17,23,0) 70%)`, padding: '20px 22px 18px', borderBottom: `1px solid rgba(255,255,255,0.07)`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: bColor, boxShadow: `0 0 18px ${bColor}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-2.47 12 12 0 00-11.64 0A4.83 4.83 0 01.41 6.69 49.11 49.11 0 000 12a49.11 49.11 0 00.41 5.31 4.83 4.83 0 003.77 2.47 12 12 0 0011.64 0 4.83 4.83 0 003.77-2.47A49.11 49.11 0 0024 12a49.11 49.11 0 00-.41-5.31zM9.75 15.02V8.98l6 3.02z"/></svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: isJ ? '#22c55e' : '#fff' }}>{name(v.brand)}</div>
                      {v.handle && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>@{v.handle}</div>}
                    </div>
                  </div>
                  <button onClick={() => setSelectedVideo(null)}
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--fg-3)', fontSize: 18, flexShrink: 0 }}>×</button>
                </div>

                {/* Body */}
                <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Caption */}
                  {v.text && (
                    <p style={{ fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.6, margin: 0, padding: '12px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, borderLeft: `3px solid ${bColor}` }}>
                      {v.text}
                    </p>
                  )}

                  {/* Stats grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                    {[
                      { label: 'Views',    value: fmt(v.views),    color: '#F5E625', icon: '👁' },
                      { label: 'Likes',    value: fmt(v.likes),    color: '#f97316', icon: '♥' },
                      { label: 'Comments', value: fmt(v.comments), color: '#a78bfa', icon: '💬' },
                      { label: 'Shares',   value: fmt(v.shares),   color: '#34d399', icon: '↗' },
                    ].map(({ label, value, color: c, icon }) => (
                      <div key={label} style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${c}22`, borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                        <div style={{ fontSize: 16, marginBottom: 4 }}>{icon}</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: c, fontFamily: 'JetBrains Mono', lineHeight: 1 }}>{value}</div>
                        <div style={{ fontSize: 10, color: 'var(--fg-4)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Eng rate + posted */}
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>Engagement rate</span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: Number(engRate) > 5 ? '#22c55e' : Number(engRate) > 2 ? '#F5E625' : '#ef4444', fontFamily: 'JetBrains Mono' }}>{engRate}%</span>
                    </div>
                    <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>Posted</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-2)', fontFamily: 'JetBrains Mono' }}>{v.days === 0 ? 'Today' : `${v.days}d ago`}</span>
                    </div>
                  </div>

                  {/* CTA */}
                  <a href={watchUrl} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: bColor, borderRadius: 10, padding: '11px 0', color: '#000', fontWeight: 800, fontSize: 13, textDecoration: 'none' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-2.47 12 12 0 00-11.64 0A4.83 4.83 0 01.41 6.69 49.11 49.11 0 000 12a49.11 49.11 0 00.41 5.31 4.83 4.83 0 003.77 2.47 12 12 0 0011.64 0 4.83 4.83 0 003.77-2.47A49.11 49.11 0 0024 12a49.11 49.11 0 00-.41-5.31zM9.75 15.02V8.98l6 3.02z"/></svg>
                    Watch on TikTok ↗
                  </a>
                </div>

                {/* Footer */}
                <div style={{ padding: '10px 22px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 10, color: 'var(--fg-4)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>TikTok Video Intelligence · {name(v.brand)}</span>
                  <span>Press Esc or click outside to close</span>
                </div>
              </div>
            </div>
          )
        })()}
      </section>

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
