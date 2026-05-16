'use client'

import { useEffect, useState } from 'react'
import {
  fetchBrands, fetchYT, fetchYTTrend, fetchTopYTVideos,
  type V2Brand, type V2YTRow, type V2TopYTVideo,
} from '@/lib/v2/data'
import { fmt, LineChart } from '@/components/v2/charts'
import { PageHead, MiniKpi, pgColor, pgName, LoadingPage, SectionInfo, SortTh, FilterBanner } from '@/components/v2/PageShell'
import { useBrandFilter, applyBrandFilter, applyBrandFilterRecord } from '@/lib/v2/BrandFilterContext'

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
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()

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
  const displayVideos = applyBrandFilter(videos, filteredBrands, isFiltered)
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

  const vpvSorted = [...displayYt].filter((d) => d.videos > 0)
    .sort((a, b) => (b.views / b.videos) - (a.views / a.videos))
  const maxVpv = vpvSorted[0] ? vpvSorted[0].views / vpvSorted[0].videos : 1

  const sortedVideos = applySortVideos(displayVideos)

  return (
    <>
      <PageHead
        eyebrow={`YOUTUBE · ${totalVideos} VIDEOS · ${displayYt.length} CHANNELS`}
        title="Youtube"
        accent="domination map"
        sub="Selkirk owns long-form pickleball video. JOOLA is a strong #2 but underweight given Ben Johns' reach. The gap to close: short-form tutorial content."
        actions={<>
          <select className="select"><option>All channels</option></select>
          <select className="select"><option>Last 90 days</option></select>
        </>}
      />
      <FilterBanner />

      <section>
        <div className="kpi-grid">
          <MiniKpi
            label="JOOLA subscribers" src="YouTube channels" flavor="joola"
            value={joolaYT && joolaYT.subs > 0 ? fmt(joolaYT.subs) : 'Pending'}
            color="#22c55e"
            spark={displayTrend['joola'] || []}
            customVs={joolaYT && joolaYT.subs > 0
              ? `vs. ${name(topByViews.find(d => d.brand !== 'joola')?.brand || 'selkirk')}: ${fmt(topByViews.find(d => d.brand !== 'joola')?.subs || 0)}`
              : 'Weekly snapshots still being collected'}
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
            customVs="across all brands"
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
                  source="YouTube channels · scraped via streamers/youtube-scraper every Monday"
                />
              </h2>
              <div className="sub">Weekly subscriber counts from scraped channel data.</div>
            </div>
          </div>
          <div className="card"><div className="card-pad">
            <LineChart series={lineSeries} />
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
                      width: Math.max(2, (d.subs / maxSubs) * 100) + '%',
                      background: `linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                    }}>{fmt(d.subs)}</div>
                  </div>
                  <div className="spark-mini">{d.videos} videos</div>
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
                  source="YouTube videos · scraped channel stats via streamers/youtube-scraper"
                />
              </h2>
              <div className="sub">Output quality — who makes the most-watched videos per upload.</div>
            </div></div>
            <div className="card"><div className="card-pad">
              {vpvSorted.map((d) => {
                const vpv = Math.round(d.views / d.videos)
                return (
                  <div key={d.brand} className={'bar-row ' + (d.brand === 'joola' ? 'joola' : '')}>
                    <div className="lbl">{name(d.brand)}</div>
                    <div className="track">
                      <div className="fill" style={{
                        width: Math.max(2, (vpv / maxVpv) * 100) + '%',
                        background: `linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                      }}>{fmt(vpv)}</div>
                    </div>
                    <div className="spark-mini">avg/vid</div>
                    <div className="delta-mini flat">{d.videos}v</div>
                  </div>
                )
              })}
            </div></div>
          </div>
        </div>
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2>
              Top videos · by views
              <SectionInfo
                title="Top Performing Videos"
                description="The most-watched videos across all brands. Shows which content formats resonate — coaching tutorials tend to dominate. Click any column header to sort."
                source="YouTube videos · scraped from YouTube channel pages via streamers/youtube-scraper"
              />
            </h2>
            <div className="sub">Long-form pickleball coaching wins. Note coaching + tutorial format dominance.</div>
          </div>
        </div>
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <SortTh col="brand" label="Brand" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                <SortTh col="title" label="Title" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ width: '42%' }} />
                <SortTh col="duration" label="Duration" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                <SortTh col="views" label="Views" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                <SortTh col="likes" label="Likes" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                <SortTh col="comments" label="Comments" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                <SortTh col="days" label="Posted" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
              </tr></thead>
              <tbody>
                {sortedVideos.map((v, i) => (
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
                          href={`https://www.youtube.com/results?search_query=${encodeURIComponent(v.title || '')}`}
                          target="_blank" rel="noopener noreferrer"
                          className="ext-link"
                          style={{ marginTop: 1, flexShrink: 0 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          Watch
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        </a>
                      </div>
                    </td>
                    <td className="cell-num">{v.duration}</td>
                    <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625' }}>{fmt(v.views)}</td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(v.likes)}</td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(v.comments)}</td>
                    <td className="cell-num">{v.days}d ago</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  )
}
