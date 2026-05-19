'use client'

import { useEffect, useState } from 'react'
import {
  fetchBrands, fetchTikTok, fetchTikTokTrend, fetchTopTikTokVideos,
  type V2Brand, type V2TikTokRow, type V2TikTokVideo,
} from '@/lib/v2/data'
import { fmt } from '@/components/v2/charts'
import { PageHead, MiniKpi, pgColor, pgName, LoadingPage, SectionInfo, SortTh, FilterBanner, ColumnFilter } from '@/components/v2/PageShell'
import { useBrandFilter, applyBrandFilter, applyBrandFilterRecord } from '@/lib/v2/BrandFilterContext'

const TIKTOK_HANDLES: Record<string, string> = {
  joola:      'joolapickleball',
  selkirk:    'selkirksport',
  crbn:       'crbnpickleball',
  franklin:   'franklinsportsofficial',
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
  const [trend, setTrend] = useState<Record<string, number[]>>({})
  const [videos, setVideos] = useState<V2TikTokVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [colFilter, setColFilter] = useState<Record<string, string>>({})
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()

  useEffect(() => { document.title = 'JOOLA INTEL — TikTok' }, [])

  useEffect(() => {
    fetchBrands().then(async (b) => {
      try {
        const [t, tr, v] = await Promise.all([fetchTikTok(b), fetchTikTokTrend(b), fetchTopTikTokVideos(b, 20)])
        setBrands(b); setAllBrands(b); setTtData(t); setTrend(tr); setVideos(v); setLoading(false)
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

  const displayTT = applyBrandFilter(ttData, filteredBrands, isFiltered)
  const displayVideos = applyBrandFilter(videos, filteredBrands, isFiltered)
  const displayTrend = applyBrandFilterRecord(trend, filteredBrands, isFiltered)

  const name = (s: string) => pgName(s, brands)
  const joolaTT = displayTT.find(d => d.brand === 'joola')
  const topByFollowers = [...displayTT].sort((a, b) => b.followers - a.followers)
  const maxFollowers = topByFollowers[0]?.followers || 1
  const totalVideos = displayTT.reduce((s, d) => s + d.videos, 0)

  const vpvSorted = [...displayTT].filter(d => d.videos > 0)
    .sort((a, b) => b.avgViews - a.avgViews)
  const maxVpv = vpvSorted[0]?.avgViews || 1

  // Follower snapshot bars — one row per brand, latest non-zero value.
  // Deduplicates by brand id using a Map (defensive against duplicate keys).
  const snapshotMap = new Map<string, number>()
  for (const [id, data] of Object.entries(displayTrend)) {
    if (!data || data.length === 0) continue
    const latest = [...data].reverse().find(v => v > 0) ?? data[data.length - 1] ?? 0
    if (latest > 0) snapshotMap.set(id, latest)
  }
  const followerSnapshotBars = Array.from(snapshotMap.entries())
    .map(([id, followers]) => ({ id, followers, color: pgColor(id) }))
    .sort((a, b) => b.followers - a.followers)
  const maxSnapshot = followerSnapshotBars[0]?.followers || 1

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

  const hasData = displayTT.some(d => d.followers > 0)

  return (
    <>
      <PageHead
        eyebrow={`TIKTOK · ${totalVideos} VIDEOS · ${displayTT.filter(d => d.followers > 0).length} ACCOUNTS`}
        title="TikTok"
        accent="short-form"
        sub="JOOLA's TikTok (~20-30K followers) outpaces its X presence. Selkirk leads at ~13K. Short-form video is the fastest-growing channel for the pickleball category."
        actions={<>
          <select className="select"><option>All {displayTT.length} brands</option></select>
          <select className="select"><option>Last 8 weeks</option></select>
        </>}
      />
      <FilterBanner />

      {!hasData && (
        <section>
          <div className="price-war" style={{ borderColor: 'rgba(245,230,37,0.3)' }}>
            <div className="icn" style={{ color: '#F5E625' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><circle cx="12" cy="16" r="1" fill="currentColor" />
              </svg>
            </div>
            <div>
              <h4>TIKTOK DATA NOT YET COLLECTED</h4>
              <p>Run the Python pipeline to populate TikTok follower counts and videos. Execute <strong style={{ color: 'var(--fg)' }}>run_tiktok()</strong> in <code>scripts/apify_to_supabase.py</code> once.</p>
            </div>
          </div>
        </section>
      )}

      <section>
        <div className="kpi-grid">
          <MiniKpi
            label="JOOLA TikTok followers" src="TikTok profile" flavor="joola"
            value={joolaTT && joolaTT.followers > 0 ? fmt(joolaTT.followers) : 'Pending'}
            color="#22c55e"
            spark={displayTrend['joola'] || []}
            customVs={joolaTT && joolaTT.followers > 0
              ? `vs. ${name(topByFollowers.find(d => d.brand !== 'joola')?.brand || 'selkirk')}: ${fmt(topByFollowers.find(d => d.brand !== 'joola')?.followers || 0)}`
              : 'Run pipeline to collect'}
          />
          <MiniKpi
            label="JOOLA videos" src="TikTok profile"
            value={joolaTT && joolaTT.videos > 0 ? fmt(joolaTT.videos) : '—'}
            color="#818cf8"
            customVs={joolaTT && joolaTT.avgViews > 0 ? `${fmt(Math.round(joolaTT.avgViews))} avg views/video` : 'Avg views per video'}
          />
          <MiniKpi
            label="Total videos tracked" src="TikTok videos"
            value={totalVideos > 0 ? fmt(totalVideos) : '—'}
            color="#F5E625"
            customVs={`across ${displayTT.length} brands`}
          />
          <MiniKpi
            label="Most followed" src="TikTok profiles"
            value={topByFollowers[0]?.followers > 0 ? name(topByFollowers[0].brand) : '—'}
            color="#818cf8"
            customVs={topByFollowers[0]?.followers > 0 ? `${fmt(topByFollowers[0].followers)} followers` : 'Pending first scrape'}
          />
        </div>
      </section>

      {followerSnapshotBars.length > 0 && (
        <section>
          <div className="section-head"><div>
            <h2>
              TikTok follower snapshots by brand
              <SectionInfo
                title="Latest Follower Snapshot per Brand"
                description="Latest non-zero TikTok follower count for each tracked brand. One bar per brand — duplicate weekly rows are collapsed by keeping the most recent snapshot."
                source="tiktok_profiles_weekly · scraped via clockworks/tiktok-scraper every Monday"
              />
            </h2>
            <div className="sub">{followerSnapshotBars.length} brands · latest snapshot</div>
          </div></div>
          <div className="card"><div className="card-pad">
            {followerSnapshotBars.map(d => (
              <div key={d.id} className={'bar-row ' + (d.id === 'joola' ? 'joola' : '')}>
                <div className="lbl">{name(d.id)}</div>
                <div className="track">
                  <div className="fill" style={{
                    width: Math.max(2, d.followers / maxSnapshot * 100) + '%',
                    background: d.id === 'joola' ? '#22c55e' : `linear-gradient(90deg, ${d.color}, ${d.color}99)`,
                  }}>{fmt(d.followers)}</div>
                </div>
                <div className="spark-mini">followers</div>
              </div>
            ))}
          </div></div>
        </section>
      )}

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
              {topByFollowers.map(d => (
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
                    }}>{d.followers > 0 ? fmt(d.followers) : '—'}</div>
                  </div>
                  <div className="spark-mini">{d.videos > 0 ? d.videos + ' videos' : 'no data'}</div>
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
              {vpvSorted.length > 0 ? vpvSorted.map(d => (
                <div key={d.brand} className={'bar-row ' + (d.brand === 'joola' ? 'joola' : '')}>
                  <div className="lbl">{name(d.brand)}</div>
                  <div className="track">
                    <div className="fill" style={{
                      width: Math.max(2, d.avgViews / maxVpv * 100) + '%',
                      background: d.brand === 'joola' ? '#22c55e' : `linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                    }}>{fmt(Math.round(d.avgViews))}</div>
                  </div>
                  <div className="spark-mini">avg/vid</div>
                  <div className="delta-mini flat">{d.videos}v</div>
                </div>
              )) : (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>No video data yet — run pipeline first</div>
              )}
            </div></div>
          </div>
        </div>
      </section>

      <section>
        <div className="section-head"><div>
          <h2>
            Top videos · by views
            <SectionInfo
              title="Top TikTok Videos"
              description="Most-viewed TikTok videos across all tracked brands. Short-form tutorials and challenge content tend to dominate. High share counts indicate viral potential."
              source="tiktok_videos · scraped via clockworks/tiktok-scraper. Click column headers to sort."
            />
          </h2>
          <div className="sub">Top TikTok videos across all brands. Click column headers to sort.</div>
        </div></div>
        <div className="card">
          {sortedVideos.length > 0 ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
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
                      <td className="cell-num">{v.days}d ago</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>
              <div style={{ fontSize: 13, marginBottom: 8 }}>No video data yet.</div>
              <div style={{ fontSize: 11 }}>Run <code>python scripts/apify_to_supabase.py</code> to populate TikTok videos.</div>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
