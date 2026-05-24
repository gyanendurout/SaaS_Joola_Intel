'use client'

import { useEffect, useState } from 'react'
import {
  fetchBrands, fetchIG, fetchTopIGPosts, fetchPostFrequency,
  type V2Brand, type V2IGRow, type V2TopIGPost,
} from '@/lib/v2/data'
import { fmt, LineChart, ScatterChart } from '@/components/v2/charts'
import { PageHead, MiniKpi, pgColor, pgName, LoadingPage, SectionInfo, SortTh, FilterBanner } from '@/components/v2/PageShell'
import { TableSearch } from '@/components/v2/TableSearch'
import { useBrandFilter, applyBrandFilter, applyBrandFilterRecord } from '@/lib/v2/BrandFilterContext'
import { useDateRange, applyDateRange, DATE_RANGE_LABEL } from '@/lib/v2/DateRangeContext'
import { formatCalendarDateFromDaysAgo } from '@/lib/v2/format'

/** Relative caption ("3 days ago") kept only for the title tooltip on date cells. */
function relativeLabel(days: number): string {
  return days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
}

/** Map raw API/post format codes to human-friendly labels. */
const FORMAT_LABEL: Record<string, string> = {
  SIDECAR: 'Carousel',
  VIDEO: 'Video',
  IMAGE: 'Image',
  CAROUSEL: 'Carousel',
  REEL: 'Reel',
}

/** Minimum follower threshold for ER-based rankings — anything below is a scraping artifact. */
const ER_MIN_FOLLOWERS = 50

export default function InstagramPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [ig, setIg] = useState<V2IGRow[]>([])
  const [posts, setPosts] = useState<V2TopIGPost[]>([])
  const [freq, setFreq] = useState<Record<string, number[][]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [chipFilter, setChipFilter] = useState<'all' | 'joola' | 'reels' | 'carousels'>('all')
  const [colFilter, setColFilter] = useState<Record<string, string>>({})
  const [searchCaption, setSearchCaption] = useState('')
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()
  const { range, maxDays } = useDateRange()

  useEffect(() => {
    fetchBrands().then(async (b) => {
      try {
        const [i, p, f] = await Promise.all([fetchIG(b), fetchTopIGPosts(b, 20), fetchPostFrequency(b)])
        setBrands(b); setAllBrands(b); setIg(i); setPosts(p); setFreq(f); setLoading(false)
      } catch (err) {
        console.error('Instagram data fetch failed', err)
        setError('Unable to load Instagram data. Please refresh.')
        setLoading(false)
      }
    }).catch(err => {
      console.error('Brands fetch failed', err)
      setError('Unable to load data. Please refresh.')
      setLoading(false)
    })
  }, [setAllBrands])

  useEffect(() => { document.title = 'JOOLA INTEL — Instagram Performance' }, [])

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

  const displayIg = applyBrandFilter(ig, filteredBrands, isFiltered)
  const displayPostsAll = applyBrandFilter(posts, filteredBrands, isFiltered)
  const displayPosts = applyDateRange(displayPostsAll, maxDays)
  const displayFreq = applyBrandFilterRecord(freq, filteredBrands, isFiltered)

  const name = (s: string) => pgName(s, brands)
  const joolaIG = displayIg.find((d) => d.brand === 'joola')
  const totalPosts = displayPosts.length
  const totalFollowers = displayIg.reduce((s, d) => s + d.followers, 0)

  // Weekly snapshots — generate calendar-date x-axis labels from index N (N-1-i weeks ago)
  const trendLen = Math.max(1, ...displayIg.slice(0, 7).map(d => d.trend.length))
  const xLabels = Array.from({ length: trendLen }, (_, i) =>
    new Date(Date.now() - (trendLen - 1 - i) * 7 * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  )

  const lineSeries = displayIg.slice(0, 7).map((d) => ({
    id: d.brand, label: name(d.brand), color: pgColor(d.brand), data: d.trend,
  }))

  // ER-based rankings/scatter exclude micro-account scrape artifacts (Paddletek: 1 follower, 69708% ER).
  const erEligible = displayIg.filter(r => r.followers >= ER_MIN_FOLLOWERS)

  const scatterData = erEligible.map((d) => ({
    brand: d.brand, name: name(d.brand), color: pgColor(d.brand),
    followers: d.followers, engRate: d.engRate, posts: 30,
  }))

  const topByER = [...displayPosts]
    .map((p) => {
      const igRow = displayIg.find((r) => r.brand === p.brand)
      const engRate = igRow && igRow.followers > 0
        ? ((p.likes + p.comments) / igRow.followers) * 100
        : 0
      return { ...p, engRate }
    })
    .sort((a, b) => b.engRate - a.engRate)

  // Chip-filter format matches both raw API codes (SIDECAR/VIDEO) and human labels (Carousel/Reel).
  const isVideoFormat = (f: string) => f === 'Video' || f === 'Reel' || f === 'VIDEO' || f === 'REEL'
  const isCarouselFormat = (f: string) => f === 'Carousel' || f === 'CAROUSEL' || f === 'SIDECAR'

  const chipPosts = chipFilter === 'all' ? topByER
    : chipFilter === 'joola' ? topByER.filter(p => p.brand === 'joola')
    : chipFilter === 'reels' ? topByER.filter(p => isVideoFormat(p.format))
    : topByER.filter(p => isCarouselFormat(p.format))

  // Apply per-column filters (case-insensitive substring match) before sorting.
  const q = searchCaption.trim().toLowerCase()
  const filteredPosts = chipPosts.filter(p => {
    const rec = p as unknown as Record<string, unknown>
    const cols = Object.entries(colFilter).every(([col, qv]) => {
      if (!qv) return true
      const cell = col === 'brand' ? name(p.brand) : String(rec[col] ?? '')
      return cell.toLowerCase().includes(qv.toLowerCase())
    })
    if (!cols) return false
    if (!q) return true
    const caption = String(p.caption ?? '').toLowerCase()
    const handle = String(p.handle ?? '').toLowerCase()
    const brandName = name(p.brand).toLowerCase()
    return caption.includes(q) || handle.includes(q) || brandName.includes(q)
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

  const erSorted = [...erEligible].sort((a, b) => b.engRate - a.engRate)
  const maxER = erSorted[0]?.engRate || 1

  const freqBrands = Object.keys(displayFreq).length > 0
    ? Object.keys(displayFreq)
    : ['joola', 'selkirk', 'crbn', 'engage', 'paddletek']

  // View count is only meaningful for video formats; image/carousel posts legitimately have 0 views.
  function renderViews(v: V2TopIGPost & { engRate: number }) {
    if (v.views > 0) return fmt(v.views)
    const isVid = isVideoFormat(v.format)
    return (
      <span title={isVid ? 'View count not available' : 'Views are only reported for videos and reels'} style={{ color: 'var(--fg-4)' }}>—</span>
    )
  }

  return (
    <>
      <PageHead
        eyebrow={`INSTAGRAM · ${displayPostsAll.length} POSTS FETCHED · ${displayIg.length} PROFILES`}
        title="Instagram"
        accent="performance"
        sub="Who is growing, whose content actually resonates, and what JOOLA can learn from the brands punching above their weight."
      />
      <FilterBanner />

      <section>
        <div className="kpi-grid">
          <MiniKpi
            label="JOOLA followers" src="Instagram weekly" flavor="joola"
            value={joolaIG ? fmt(joolaIG.followers) : '—'}
            delta={joolaIG?.delta ?? null} deltaPct={joolaIG?.deltaPct ?? null}
            color="#22c55e" spark={joolaIG?.trend}
          />
          <MiniKpi
            label="JOOLA eng. rate" src="Instagram posts"
            value={joolaIG ? joolaIG.engRate.toFixed(2) + '%' : '—'}
            color="#818cf8" spark={joolaIG?.trend.map(() => joolaIG.engRate)}
            customVs={`#${erSorted.findIndex((r) => r.brand === 'joola') + 1} of ${erSorted.length} brands`}
          />
          <MiniKpi
            label="Total tracked posts" src="Instagram posts"
            value={fmt(totalPosts)}
            color="#F5E625"
            customVs={`across ${displayIg.length} brands`}
          />
          <MiniKpi
            label="Total audience" src="Instagram weekly"
            value={fmt(totalFollowers)}
            color="#ec4899"
            customVs={`combined follower base across ${displayIg.length} brands`}
          />
        </div>
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2>
              Follower trajectory
              <SectionInfo
                title="Follower Growth Over Time"
                description="Each brand's Instagram follower count plotted week by week. Upward slopes show momentum — a brand gaining followers is growing its earned media reach."
                source="ig_profiles_weekly · updated every Monday"
              />
            </h2>
            <div className="sub">Updated weekly from Instagram channel data — trend lines across all tracked brands.</div>
          </div>
        </div>
        <div className="card"><div className="card-pad">
          <LineChart series={lineSeries} xLabels={xLabels} />
        </div></div>
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2>
              Engagement quality matrix
              <SectionInfo
                title="Reach vs. Resonance Quadrant"
                description="X-axis = follower count (how big the audience is). Y-axis = engagement rate (how much that audience cares). Brands in the top-right corner are winning both size and resonance. JOOLA's position shows at a glance whether we're punching our weight."
                source="ig_posts + ig_profiles_weekly · engagement rate = (avg likes + avg comments) ÷ followers × 100"
              />
            </h2>
            <div className="sub">Followers (reach) × engagement rate (resonance). Top-right = winning. JOOLA crosshair shown. Brands with under {ER_MIN_FOLLOWERS} followers are excluded — ER is unreliable on tiny audiences.</div>
          </div>
        </div>
        <div className="card"><div className="card-pad-lg">
          <ScatterChart data={scatterData} />
        </div></div>
      </section>

      <section id="instagram-posts-table">
        <div className="section-head">
          <div>
            <h2>
              Top {sortedPosts.length} posts · by engagement rate
              <SectionInfo
                title="Best Posts Across All Brands"
                description="The highest-engagement posts pulled from every tracked Instagram account. Sorted by engagement rate — the percentage of an audience that liked or commented. Click column headers to re-sort."
                source="ig_posts · refreshed every Monday. Engagement rate calculated locally."
              />
            </h2>
            <div className="sub">
              Showing <strong style={{ color: 'var(--fg)' }}>{sortedPosts.length}</strong> of {displayPostsAll.length}
              {' '}· {DATE_RANGE_LABEL[range].toLowerCase()} · click column headers to sort.
            </div>
          </div>
          <div className="actions">
            <div className="chip-row">
              <button className={'chip' + (chipFilter === 'all' ? ' on' : '')} onClick={() => setChipFilter('all')}>All</button>
              <button className={'chip' + (chipFilter === 'joola' ? ' on' : '')} onClick={() => setChipFilter('joola')}>JOOLA</button>
              <button className={'chip' + (chipFilter === 'reels' ? ' on' : '')} onClick={() => setChipFilter('reels')}>Reels</button>
              <button className={'chip' + (chipFilter === 'carousels' ? ' on' : '')} onClick={() => setChipFilter('carousels')}>Carousels</button>
            </div>
          </div>
        </div>
        <div className="card">
          <div style={{ padding: '10px 14px 0' }}>
            <TableSearch value={searchCaption} onChange={setSearchCaption} placeholder="Search caption, handle, or brand…" width={280} />
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <SortTh col="brand" label="Brand · handle" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                <th style={{ width: '38%' }}>Caption</th>
                <SortTh col="format" label="Format" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                <SortTh col="likes" label="Likes" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                <SortTh col="comments" label="Comments" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                <SortTh col="views" label="Views" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                <th
                  className={'sortable' + (sortKey === 'engRate' ? ' sort-' + sortDir : '')}
                  onClick={() => toggleSort('engRate')}
                  title="(Likes + Comments) ÷ Followers × 100 — engagement rate"
                  style={{ textAlign: 'right' }}
                  aria-sort={sortKey === 'engRate' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <span className="sort-ic">
                    Eng. Rate
                    <span className="sort-arrows" aria-hidden="true">
                      <span className="arr-up">▲</span>
                      <span className="arr-down">▼</span>
                    </span>
                  </span>
                </th>
                <SortTh col="days" label="Posted" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
              </tr></thead>
              <tbody>
                {sortedPosts.slice(0, 15).map((v, i) => {
                  const formatLabel = FORMAT_LABEL[v.format] || v.format || 'Image'
                  const isVid = isVideoFormat(v.format)
                  const isCar = isCarouselFormat(v.format)
                  return (
                    <tr key={i} className={v.brand === 'joola' ? 'joola' : ''}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="brand-dot" style={{ background: pgColor(v.brand) }} />
                          <div>
                            <div style={{ fontWeight: 700, color: 'var(--fg)', fontSize: 12 }}>{name(v.brand)}</div>
                            <a
                              href={`https://www.instagram.com/${v.handle.replace('@', '')}`}
                              target="_blank" rel="noopener noreferrer"
                              className="cta-link"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {v.handle}
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                            </a>
                          </div>
                        </div>
                      </td>
                      <td style={{ color: 'var(--fg)' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                          <span style={{ fontSize: 12 }}>{v.caption?.slice(0, 80) || '—'}</span>
                          {v.url && (
                            <a href={v.url} target="_blank" rel="noopener noreferrer" className="ext-link" style={{ marginTop: 1, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                              View post
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                            </a>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={'pill ' + (isVid ? 'pill-info' : isCar ? 'pill-amber' : 'pill-ghost')}>
                          {formatLabel}
                        </span>
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(v.likes)}</td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(v.comments)}</td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>{renderViews(v)}</td>
                      <td className="cell-num" style={{ textAlign: 'right', color: v.engRate > 3 ? '#F5E625' : 'var(--fg)' }}>
                        {v.engRate.toFixed(2)}%
                      </td>
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
        <div className="two-col-even">
          <div>
            <div className="section-head">
              <div>
                <h2>
                  Engagement rate · benchmark
                  <SectionInfo
                    title="Engagement Rate Benchmark"
                    description="Ranked by engagement rate across all brands. 1–3% is considered good for large accounts; above 3% is excellent. Shows whether JOOLA's content resonates relative to its audience size."
                    source="ig_posts · (avg likes + avg comments) ÷ followers × 100"
                  />
                </h2>
                <div className="sub">Ranked by engagement rate. Brands with under {ER_MIN_FOLLOWERS} followers are excluded — ER is unreliable on tiny audiences.</div>
              </div>
            </div>
            <div className="card"><div className="card-pad">
              {erSorted.map((d) => (
                <div
                  key={d.brand}
                  className={'bar-row ' + (d.brand === 'joola' ? 'joola' : '')}
                  style={{ gridTemplateColumns: '110px 1fr 70px', cursor: 'pointer' }}
                  title={`Click to filter the posts table above to ${name(d.brand)}`}
                  onClick={() => {
                    setColFilter(p => ({ ...p, brand: name(d.brand) }))
                    document.getElementById('instagram-posts-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                >
                  <div className="lbl">{name(d.brand)} <span style={{ fontSize: 10, color: 'var(--fg-4)' }}>↓ filter</span></div>
                  <div className="track">
                    <div className="fill" style={{
                      width: (d.engRate / maxER * 100) + '%',
                      background: d.brand === 'joola' ? '#22c55e' : `linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                    }}>{d.engRate.toFixed(2)}%</div>
                  </div>
                  <div className="spark-mini" style={{ textAlign: 'right' }}>{fmt(d.followers)}</div>
                </div>
              ))}
            </div></div>
          </div>
          <div>
            <div className="section-head">
              <div>
                <h2>
                  Posting cadence · recent activity
                  <SectionInfo
                    title="Posting Frequency Heatmap"
                    description="How often each brand posted per day over the recent posting window. Darker cells = more posts that day. Brands that post consistently maintain algorithmic visibility and audience habit."
                    source="ig_posts · post timestamps refreshed every Monday"
                  />
                </h2>
                <div className="sub">Daily posting frequency heatmap per brand.</div>
              </div>
            </div>
            <div className="card"><div className="card-pad">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {freqBrands.map((b) => {
                  const grid = displayFreq[b] || Array.from({ length: 4 }, () => Array(7).fill(0))
                  const total = grid.flat().reduce((s, v) => s + v, 0)
                  return (
                    <div key={b}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="brand-dot" style={{ background: pgColor(b) }} />
                          <span style={{ fontWeight: 700, color: b === 'joola' ? '#22c55e' : 'var(--fg)', fontSize: 12 }}>{name(b)}</span>
                        </div>
                        <span style={{ fontSize: 10, color: 'var(--fg-4)', fontFamily: 'JetBrains Mono' }}>{total} posts · 4wk</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
                        {grid.flat().map((v, i) => {
                          const dayIdx = i % 7
                          const weekIdx = Math.floor(i / 7)
                          const dayName = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][dayIdx]
                          return (
                            <div key={i} className="cadence-cell" style={{
                              height: 14,
                              background: v === 0 ? 'rgba(255,255,255,0.03)' : pgColor(b) + (['00', '50', '85', 'cc', 'ff'][Math.min(v, 4)]),
                              borderRadius: 2,
                            }} title={`${name(b)} · Week ${weekIdx + 1} · ${dayName}: ${v} post${v === 1 ? '' : 's'}`} />
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--fg-4)', borderTop: '1px solid var(--line-2)', paddingTop: 8, marginTop: 12 }}>
                <span>4 weeks ago →</span>
                <span>This week</span>
              </div>
            </div></div>
          </div>
        </div>
      </section>
    </>
  )
}
