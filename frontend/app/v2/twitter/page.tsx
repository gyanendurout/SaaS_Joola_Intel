'use client'

import { useEffect, useState } from 'react'
import {
  fetchBrands, fetchX, fetchXTrend, fetchTopXPosts,
  type V2Brand, type V2XRow, type V2XPost,
} from '@/lib/v2/data'
import { fmt } from '@/components/v2/charts'
import { PageHead, MiniKpi, pgColor, pgName, LoadingPage, SectionInfo, SortTh, FilterBanner, ColumnFilter } from '@/components/v2/PageShell'
import { useBrandFilter, applyBrandFilter, applyBrandFilterRecord } from '@/lib/v2/BrandFilterContext'
import { useDateRange, applyDateRange, DATE_RANGE_LABEL } from '@/lib/v2/DateRangeContext'
import { formatCalendarDateFromDaysAgo } from '@/lib/v2/format'

/** Relative caption ("3 days ago") kept only for the title tooltip on date cells. */
function relativeLabel(days: number): string {
  return days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
}

const X_HANDLES: Record<string, string> = {
  joola:     'joolausa',
  selkirk:   'SelkirkSport',
  franklin:  'FranklinSports',
  engage:    'engagepickleball',
  paddletek: 'PaddletekLLC',
  onix:      'OnixPickleball',
  wilson:    'WilsonSportingG',
  gamma:     'gammasportsusa',
}

export default function TwitterPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [xData, setXData] = useState<V2XRow[]>([])
  const [trend, setTrend] = useState<Record<string, number[]>>({})
  const [posts, setPosts] = useState<V2XPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [colFilter, setColFilter] = useState<Record<string, string>>({})
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()
  const { range, maxDays } = useDateRange()

  useEffect(() => { document.title = 'JOOLA INTEL — X / Twitter' }, [])

  useEffect(() => {
    fetchBrands().then(async (b) => {
      try {
        const [x, t, p] = await Promise.all([fetchX(b), fetchXTrend(b), fetchTopXPosts(b, 20)])
        setBrands(b); setAllBrands(b); setXData(x); setTrend(t); setPosts(p); setLoading(false)
      } catch (err) {
        console.error('X data fetch failed', err)
        setError('Unable to load X data. Please refresh.')
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

  const displayX = applyBrandFilter(xData, filteredBrands, isFiltered)
  const displayPostsAll = applyBrandFilter(posts, filteredBrands, isFiltered)
  const displayPosts = applyDateRange(displayPostsAll, maxDays)
  const displayTrend = applyBrandFilterRecord(trend, filteredBrands, isFiltered)

  const name = (s: string) => pgName(s, brands)
  const joolaX = displayX.find(d => d.brand === 'joola')
  const topByFollowers = [...displayX].sort((a, b) => b.followers - a.followers)
  const maxFollowers = topByFollowers[0]?.followers || 1
  const totalFollowers = displayX.reduce((s, d) => s + d.followers, 0)

  const erSorted = [...displayX].filter(d => d.tweets > 0).sort((a, b) => b.engRate - a.engRate)
  const maxER = erSorted[0]?.engRate || 1

  // Apply per-column filters (case-insensitive substring match) BEFORE sorting.
  const filteredPosts = displayPosts.filter(p => {
    const rec = p as unknown as Record<string, unknown>
    return Object.entries(colFilter).every(([col, q]) => {
      if (!q) return true
      const cell = col === 'brand' ? name(p.brand) : String(rec[col] ?? '')
      return cell.toLowerCase().includes(q.toLowerCase())
    })
  })

  const sortedPosts = sortKey ? [...filteredPosts].sort((a, b) => {
    const av = (a as Record<string, unknown>)[sortKey]
    const bv = (b as Record<string, unknown>)[sortKey]
    if (typeof av === 'number' && typeof bv === 'number')
      return sortDir === 'asc' ? av - bv : bv - av
    return sortDir === 'asc'
      ? String(av ?? '').localeCompare(String(bv ?? ''))
      : String(bv ?? '').localeCompare(String(av ?? ''))
  }) : filteredPosts

  const hasData = displayX.some(d => d.followers > 0)

  return (
    <>
      <PageHead
        eyebrow={`X · ${displayX.filter(d => d.followers > 0).length} ACCOUNTS · ${displayPosts.length} POSTS`}
        title="X / Twitter"
        accent="reach"
        sub="Brand presence, follower counts, and post engagement on X. Data refreshes every Monday morning."
        actions={<>
          <a href="https://x.com/search?q=pickleball&src=typed_query" target="_blank" rel="noopener noreferrer" className="btn btn-ghost">X Search ↗</a>
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
              <h4>X DATA IS BEING REFRESHED</h4>
              <p>Follower counts and posts for this channel will appear after the next weekly snapshot completes. Check back shortly.</p>
            </div>
          </div>
        </section>
      )}

      <section>
        <div className="kpi-grid">
          <MiniKpi
            label="JOOLA X followers" src="X profile" flavor="joola"
            value={joolaX && joolaX.followers > 0 ? fmt(joolaX.followers) : 'Pending'}
            color="#22c55e"
            spark={displayTrend['joola'] || []}
            customVs={joolaX && joolaX.followers > 0
              ? `vs. ${name(topByFollowers.find(d => d.brand !== 'joola')?.brand || 'selkirk')}: ${fmt(topByFollowers.find(d => d.brand !== 'joola')?.followers || 0)}`
              : 'Run pipeline to collect'}
          />
          <MiniKpi
            label="JOOLA engagement/tweet" src="X posts" flavor="joola"
            value={joolaX && joolaX.engRate > 0 ? joolaX.engRate.toFixed(1) : '—'}
            color="#818cf8"
            customVs={joolaX && joolaX.tweets > 0 ? `${joolaX.tweets} tweets tracked` : 'Avg likes + RTs per tweet'}
          />
          <MiniKpi
            label="Total X followers" src="X profiles"
            value={totalFollowers > 0 ? fmt(totalFollowers) : '—'}
            color="#F5E625"
            customVs={`across ${displayX.length} brands`}
          />
          <MiniKpi
            label="Most followed" src="X profiles"
            value={topByFollowers[0]?.followers > 0 ? name(topByFollowers[0].brand) : '—'}
            color="#818cf8"
            customVs={topByFollowers[0]?.followers > 0 ? `${fmt(topByFollowers[0].followers)} followers` : 'Pending first scrape'}
          />
        </div>
      </section>

      <section>
        <div className="two-col">
          <div>
            <div className="section-head"><div>
              <h2>
                Follower count · ranked
                <SectionInfo
                  title="X Follower Ranking"
                  description="Who has the largest X audience among tracked pickleball brands. Wilson and Franklin have large corporate accounts. JOOLA's X at ~500 followers is much smaller than its TikTok presence."
                  source="x_profiles_weekly · latest weekly snapshot"
                />
              </h2>
              <div className="sub">{displayX.length} brands · current snapshot</div>
            </div></div>
            <div className="card"><div className="card-pad">
              {topByFollowers.map(d => (
                <div key={d.brand} className={'bar-row ' + (d.brand === 'joola' ? 'joola' : '')}>
                  <div className="lbl" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span>{name(d.brand)}</span>
                    {X_HANDLES[d.brand] && (
                      <a
                        href={`https://x.com/${X_HANDLES[d.brand]}`}
                        target="_blank" rel="noopener noreferrer"
                        className="ext-link"
                        style={{ fontSize: 10 }}
                        onClick={e => e.stopPropagation()}
                      >
                        @{X_HANDLES[d.brand]}
                      </a>
                    )}
                  </div>
                  <div className="track">
                    <div className="fill" style={{
                      width: d.followers > 0 ? Math.max(2, d.followers / maxFollowers * 100) + '%' : '2%',
                      background: `linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                    }}>{d.followers > 0 ? fmt(d.followers) : '—'}</div>
                  </div>
                  <div className="spark-mini">{d.tweets > 0 ? d.tweets + ' tweets' : 'no data'}</div>
                </div>
              ))}
            </div></div>
          </div>
          <div>
            <div className="section-head"><div>
              <h2>
                Engagement · avg per tweet
                <SectionInfo
                  title="Tweet Engagement Rate"
                  description="Average likes + retweets per tweet. A high score means each tweet gets strong community response — quality content over volume. Brands with small followings but high per-tweet engagement have punchy content."
                  source="x_posts · scraped via apidojo/twitter-scraper-lite"
                />
              </h2>
              <div className="sub">Avg likes + retweets per tweet published.</div>
            </div></div>
            <div className="card"><div className="card-pad">
              {erSorted.length > 0 ? erSorted.map(d => (
                <div
                  key={d.brand}
                  className={'bar-row ' + (d.brand === 'joola' ? 'joola' : '')}
                  style={{ cursor: 'pointer' }}
                  title={`Click to filter the posts table below to ${name(d.brand)}`}
                  onClick={() => {
                    setColFilter(p => ({ ...p, brand: name(d.brand) }))
                    document.getElementById('twitter-posts-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                >
                  <div className="lbl">{name(d.brand)} <span style={{ fontSize: 10, color: 'var(--fg-4)' }}>↓ filter</span></div>
                  <div className="track">
                    <div className="fill" style={{
                      width: Math.max(2, d.engRate / maxER * 100) + '%',
                      background: d.brand === 'joola' ? '#22c55e' : `linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                    }}>{d.engRate.toFixed(1)}</div>
                  </div>
                  <div className="spark-mini">avg eng</div>
                </div>
              )) : (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>No post data yet — check back after the next weekly refresh</div>
              )}
            </div></div>
          </div>
        </div>
      </section>

      <section id="twitter-posts-table">
        <div className="section-head"><div>
          <h2>
            Top {sortedPosts.length} posts
            <SectionInfo
              title="Top X Posts"
              description="Up to the 20 highest-engagement posts across the tracked X accounts. Narrow with the brand filter (top right), the date range (top right), or per-column search below. Product launches, pro player news, and community posts tend to dominate."
              source="x_posts · scraped via apidojo/twitter-scraper-lite. Click column headers to sort."
            />
          </h2>
          <div className="sub">
            Showing <strong style={{ color: 'var(--fg)' }}>{sortedPosts.length}</strong> of up to 20 ·
            {' '}sorted by likes · {DATE_RANGE_LABEL[range].toLowerCase()} · click column headers to sort.
          </div>
        </div></div>
        <div className="card">
          {sortedPosts.length > 0 ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <SortTh col="brand" label="Brand" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                    <SortTh col="text" label="Post" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ width: '42%' }} />
                    <SortTh col="likes" label="Likes" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                    <SortTh col="retweets" label="RTs" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                    <SortTh col="replies" label="Replies" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                    <SortTh col="views" label="Views" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                    <SortTh col="days" label="Posted" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                  </tr>
                  <tr className="col-filter-row">
                    <th><ColumnFilter col="brand" value={colFilter.brand} onChange={v => setColFilter(p => ({ ...p, brand: v }))} placeholder="brand…" /></th>
                    <th><ColumnFilter col="text" value={colFilter.text} onChange={v => setColFilter(p => ({ ...p, text: v }))} placeholder="search post text…" /></th>
                    <th colSpan={5} />
                  </tr>
                </thead>
                <tbody>
                  {sortedPosts.map((p, i) => (
                    <tr key={i} className={p.brand === 'joola' ? 'joola' : ''}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="brand-dot" style={{ background: pgColor(p.brand) }} />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontWeight: 700, color: p.brand === 'joola' ? '#22c55e' : 'var(--fg)' }}>{name(p.brand)}</span>
                            {X_HANDLES[p.brand] && (
                              <a href={`https://x.com/${X_HANDLES[p.brand]}`} target="_blank" rel="noopener noreferrer" className="ext-link" style={{ fontSize: 10 }} onClick={e => e.stopPropagation()}>
                                @{X_HANDLES[p.brand]}
                              </a>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ color: 'var(--fg)' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                          <span style={{ fontSize: 12 }}>{p.text?.slice(0, 80) || '—'}</span>
                          {p.post_url && (
                            <a href={p.post_url} target="_blank" rel="noopener noreferrer" className="ext-link" style={{ marginTop: 1, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                              View
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625' }}>{fmt(p.likes)}</td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(p.retweets)}</td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(p.replies)}</td>
                      <td
                        className="cell-num"
                        style={{ textAlign: 'right' }}
                        title={p.views ? undefined : 'View count not available from X API'}
                      >
                        {p.views ? fmt(p.views) : '—'}
                      </td>
                      <td className="cell-num" title={relativeLabel(p.days)}>{formatCalendarDateFromDaysAgo(p.days)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>
              <div style={{ fontSize: 13, marginBottom: 8 }}>No posts match the current filters.</div>
              <div style={{ fontSize: 11 }}>
                Try widening the date range (top right){displayPostsAll.length > 0 ? `, expanding the brand filter, or clearing the column search.` : ' or check back after the next weekly refresh.'}
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
