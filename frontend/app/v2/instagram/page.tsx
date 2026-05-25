'use client'

import { useEffect, useState } from 'react'
import {
  fetchBrands, fetchIG, fetchTopIGPosts, fetchPostFrequency, fetchIGCommentMentions,
  fetchIGDominantTheme,
  type V2Brand, type V2IGRow, type V2TopIGPost, type V2IGMentionRow, type V2IGTheme,
} from '@/lib/v2/data'
import { fmt, LineChart, EngagementQualityMatrix } from '@/components/v2/charts'
import { PageHead, pgColor, pgName, LoadingPage, SectionInfo, SortTh, FilterBanner, ColumnFilter } from '@/components/v2/PageShell'
import { PlatformPlaybook } from '@/components/v2/PlatformPlaybook'
import { instagramPlaybook } from '@/lib/v2/playbook'
import { useBrandFilter, applyBrandFilter, applyBrandFilterRecord } from '@/lib/v2/BrandFilterContext'
import { useDateRange, applyDateRangeCustom, DATE_RANGE_LABEL } from '@/lib/v2/DateRangeContext'
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

// brand-slug → IG handle (mirrors backend/scraping/config/brands.yaml)
const IG_HANDLES: Record<string, string> = {
  joola:       'joolapickleball',
  selkirk:     'selkirksport',
  paddletek:   'paddletek_pickleball',
  crbn:        'crbn_pickleball',
  'six-zero':  'sixzeropickleball',
  engage:      'engagepickleball',
  onix:        'onix_pickleball',
  franklin:    'franklinpickleball',
  head:        'headpickleball',
  wilson:      'wilsonsportinggoods',
  gamma:       'gammasportsusa',
}

const isVideoFormat = (f: string) => f === 'Video' || f === 'Reel' || f === 'VIDEO' || f === 'REEL'
const isCarouselFormat = (f: string) => f === 'Carousel' || f === 'CAROUSEL' || f === 'SIDECAR'
const isImageFormat = (f: string) => f === 'Image' || f === 'IMAGE'

export default function InstagramPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [ig, setIg] = useState<V2IGRow[]>([])
  const [posts, setPosts] = useState<V2TopIGPost[]>([])
  const [freq, setFreq] = useState<Record<string, number[][]>>({})
  const [paddleMentions, setPaddleMentions] = useState<V2IGMentionRow[]>([])
  const [playerMentions, setPlayerMentions] = useState<V2IGMentionRow[]>([])
  const [themes, setThemes] = useState<V2IGTheme[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [formatFilter, setFormatFilter] = useState<'all' | 'reels' | 'carousels' | 'images'>('all')
  const [colFilter, setColFilter] = useState<Record<string, string>>({})
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()
  const { range, effectiveFrom, effectiveTo } = useDateRange()

  useEffect(() => { document.title = 'JOOLA INTEL — Instagram' }, [])

  useEffect(() => {
    fetchBrands().then(async (b) => {
      try {
        const [i, p, f, pm, plm, th] = await Promise.all([
          fetchIG(b),
          fetchTopIGPosts(b, 200),
          fetchPostFrequency(b),
          fetchIGCommentMentions(b, 'paddle', 30),
          fetchIGCommentMentions(b, 'player', 30),
          fetchIGDominantTheme(b),
        ])
        setBrands(b); setAllBrands(b)
        setIg(i); setPosts(p); setFreq(f)
        setPaddleMentions(pm); setPlayerMentions(plm)
        setThemes(th)
        setLoading(false)
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

  const name = (s: string) => pgName(s, brands)

  // ─── Brand + date filters ────────────────────────────────────────────
  const displayIg = applyBrandFilter(ig, filteredBrands, isFiltered)
  const displayPostsBrand = applyBrandFilter(posts, filteredBrands, isFiltered)
  const displayPosts = applyDateRangeCustom(displayPostsBrand, effectiveFrom, effectiveTo)
  const displayFreq = applyBrandFilterRecord(freq, filteredBrands, isFiltered)
  const displayPaddleMentions = applyBrandFilter(paddleMentions, filteredBrands, isFiltered)
  const displayPlayerMentions = applyBrandFilter(playerMentions, filteredBrands, isFiltered)

  // ─── ER (engagement rate) eligible brands ────────────────────────────
  // Two guards: (1) follower threshold filters out scraping artefacts,
  // (2) defensive 100% cap on display in case any DB-sourced engRate slips through.
  const erEligible = displayIg
    .filter(r => r.followers >= ER_MIN_FOLLOWERS)
    .map(r => {
      if (r.engRate > 100) {
        // eslint-disable-next-line no-console
        console.warn(`[Instagram] ${r.brand} engagement rate ${r.engRate.toFixed(1)}% exceeds 100% — excluding from matrix.`)
        return null
      }
      return { ...r, engRate: Math.min(100, r.engRate) }
    })
    .filter((r): r is V2IGRow => r !== null)
  const erSorted = [...erEligible].sort((a, b) => b.engRate - a.engRate)

  // ─── Top posts table (with ER calc) ─────────────────────────────────
  // Per-post ER is (likes + comments) / followers * 100 — cap at 100% so a
  // single freak post on a tiny account never renders an absurd number.
  const postsWithER = displayPosts.map((p) => {
    const igRow = displayIg.find((r) => r.brand === p.brand)
    const useFollowers = igRow && igRow.followers >= ER_MIN_FOLLOWERS
    const raw = useFollowers && igRow!.followers > 0
      ? ((p.likes + p.comments) / igRow!.followers) * 100
      : 0
    return { ...p, engRate: Math.min(100, raw) }
  })

  const filteredByFormat = formatFilter === 'all' ? postsWithER
    : formatFilter === 'reels'     ? postsWithER.filter(p => isVideoFormat(p.format))
    : formatFilter === 'carousels' ? postsWithER.filter(p => isCarouselFormat(p.format))
    : postsWithER.filter(p => isImageFormat(p.format))

  const filteredPosts = filteredByFormat.filter(v => {
    const rec = v as unknown as Record<string, unknown>
    return Object.entries(colFilter).every(([col, q]) => {
      if (!q) return true
      const cell = col === 'brand' ? name(v.brand) : String(rec[col] ?? '')
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
  }) : [...filteredPosts].sort((a, b) => b.engRate - a.engRate)

  // ─── Engagement Quality Matrix data ─────────────────────────────────
  // posts sampled per brand (real count, not the hard-coded 30 from before)
  const postsPerBrand: Record<string, number> = {}
  displayPosts.forEach(p => { postsPerBrand[p.brand] = (postsPerBrand[p.brand] || 0) + 1 })
  const eqData = erEligible.map((d) => ({
    brand: d.brand, name: name(d.brand), color: pgColor(d.brand),
    followers: d.followers, engRate: d.engRate,
    posts: postsPerBrand[d.brand] ?? 0,
  }))

  // ─── Follower trajectory (now in Additional Insights, compact) ──────
  const trendLen = Math.max(1, ...displayIg.slice(0, 7).map(d => d.trend.length))
  const xLabels = Array.from({ length: trendLen }, (_, i) =>
    new Date(Date.now() - (trendLen - 1 - i) * 7 * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  )
  const lineSeries = displayIg.slice(0, 7).map((d) => ({
    id: d.brand, label: name(d.brand), color: pgColor(d.brand), data: d.trend,
  }))

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

  const maxPaddle = displayPaddleMentions[0]?.mentions || 1
  const maxPlayer = displayPlayerMentions[0]?.mentions || 1

  return (
    <>
      <PageHead title="INSTAGRAM" />
      <FilterBanner />

      <PlatformPlaybook
        title="Instagram Playbook"
        sub="Rule-derived competitor moves + recommended JOOLA actions, computed from the same data this page renders."
        findings={instagramPlaybook(brands, displayIg, displayPosts, themes)}
        brands={brands}
      />

      <section style={{ marginBottom: 28 }}>
        <div className="two-col-even">
          <div>
            <div className="section-head">
              <div>
                <h2>
                  Content format mix · by brand
                  <SectionInfo
                    title="Best-performing format per brand"
                    description="Average likes per post grouped by Instagram post format (Reel/Video, Carousel, Image). Highlights which format earns the most engagement for each competitor — and where JOOLA may be under-investing."
                    source="ig_posts.post_format · GROUP BY (brand, format), AVG(like_count)"
                  />
                </h2>
                <div className="sub">Average likes per post by format · top 6 brands by sample size.</div>
              </div>
            </div>
            <div className="card"><div className="card-pad">
              {(() => {
                type FmtAgg = { reel: { sum: number; n: number }; car: { sum: number; n: number }; img: { sum: number; n: number } }
                const agg: Record<string, FmtAgg> = {}
                displayPosts.forEach((p) => {
                  if (!agg[p.brand]) agg[p.brand] = { reel: { sum: 0, n: 0 }, car: { sum: 0, n: 0 }, img: { sum: 0, n: 0 } }
                  if (isVideoFormat(p.format)) { agg[p.brand].reel.sum += p.likes; agg[p.brand].reel.n++ }
                  else if (isCarouselFormat(p.format)) { agg[p.brand].car.sum += p.likes; agg[p.brand].car.n++ }
                  else if (isImageFormat(p.format)) { agg[p.brand].img.sum += p.likes; agg[p.brand].img.n++ }
                })
                const rows = Object.entries(agg).map(([brand, x]) => ({
                  brand,
                  reel: x.reel.n ? x.reel.sum / x.reel.n : 0,
                  car: x.car.n ? x.car.sum / x.car.n : 0,
                  img: x.img.n ? x.img.sum / x.img.n : 0,
                  n: x.reel.n + x.car.n + x.img.n,
                })).filter((r) => r.n >= 3).sort((a, b) => b.n - a.n).slice(0, 6)
                if (rows.length === 0) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>No posts in current filter window.</div>
                const max = Math.max(1, ...rows.flatMap(r => [r.reel, r.car, r.img]))
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                    {rows.map((r) => (
                      <div key={r.brand} className={'bar-row ' + (r.brand === 'joola' ? 'joola' : '')} style={{ gridTemplateColumns: '110px 1fr 1fr 1fr' }}>
                        <div className="lbl" style={{ fontWeight: 700 }}>{name(r.brand)}</div>
                        <div className="track" title={`Reel avg likes: ${fmt(Math.round(r.reel))}`}>
                          <div className="fill" style={{ width: Math.max(2, r.reel / max * 100) + '%', background: pgColor(r.brand) }} />
                          <span style={{ fontSize: 10, color: 'var(--fg-3)', marginLeft: 6 }}>Reel {fmt(Math.round(r.reel))}</span>
                        </div>
                        <div className="track" title={`Carousel avg likes: ${fmt(Math.round(r.car))}`}>
                          <div className="fill" style={{ width: Math.max(2, r.car / max * 100) + '%', background: pgColor(r.brand) + 'aa' }} />
                          <span style={{ fontSize: 10, color: 'var(--fg-3)', marginLeft: 6 }}>Car {fmt(Math.round(r.car))}</span>
                        </div>
                        <div className="track" title={`Image avg likes: ${fmt(Math.round(r.img))}`}>
                          <div className="fill" style={{ width: Math.max(2, r.img / max * 100) + '%', background: pgColor(r.brand) + '66' }} />
                          <span style={{ fontSize: 10, color: 'var(--fg-3)', marginLeft: 6 }}>Img {fmt(Math.round(r.img))}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div></div>
          </div>

          <div>
            <div className="section-head">
              <div>
                <h2>
                  Dominant content theme · by brand
                  <SectionInfo
                    title="AI-tagged dominant theme"
                    description="The single most frequent content theme detected by the GPT-4o-mini enricher over each brand's last 30 IG posts. Reveals each brand's editorial 'lane' on Instagram."
                    source="ig_profiles_weekly.dominant_content_theme · latest week per brand"
                  />
                </h2>
                <div className="sub">Latest weekly snapshot per brand.</div>
              </div>
            </div>
            <div className="card"><div className="card-pad">
              {themes.filter(t => t.theme).length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>
                  No dominant theme detected yet — re-run IG enrichment.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                  {themes.filter(t => t.theme).map((t) => (
                    <div key={t.brand} className={'kpi ' + (t.brand === 'joola' ? 'joola' : '')} style={{ padding: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span className="brand-dot" style={{ background: pgColor(t.brand) }} />
                        <span style={{ fontWeight: 700, color: t.brand === 'joola' ? '#22c55e' : 'var(--fg)', fontSize: 11 }}>{name(t.brand)}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--fg)' }}>"{t.theme}"</div>
                    </div>
                  ))}
                </div>
              )}
            </div></div>
          </div>
        </div>
      </section>

      <section id="instagram-posts-table">
        <div className="section-head">
          <div>
            <h2>
              Top {sortedPosts.length} posts · by engagement rate
              <SectionInfo
                title="Best Posts Across All Brands"
                description="Up to the 200 highest-engagement posts pulled from every tracked Instagram account, after de-duplicating shortcodes. Narrow by post format (right), brand filter (top right), date range (top right), or per-column search below. Sort by clicking any column header."
                source="ig_posts · refreshed every Monday. Engagement rate calculated locally as (likes + comments) ÷ followers × 100."
              />
            </h2>
            <div className="sub">
              Showing <strong style={{ color: 'var(--fg)' }}>{sortedPosts.length}</strong> of up to 200 ·
              {' '}{DATE_RANGE_LABEL[range].toLowerCase()} · click column headers to sort.
            </div>
          </div>
          <div className="actions">
            <div className="chip-row">
              <button className={'chip' + (formatFilter === 'all' ? ' on' : '')} onClick={() => setFormatFilter('all')}>All</button>
              <button className={'chip' + (formatFilter === 'reels' ? ' on' : '')} onClick={() => setFormatFilter('reels')}>Reels / Video</button>
              <button className={'chip' + (formatFilter === 'carousels' ? ' on' : '')} onClick={() => setFormatFilter('carousels')}>Carousel</button>
              <button className={'chip' + (formatFilter === 'images' ? ' on' : '')} onClick={() => setFormatFilter('images')}>Image</button>
            </div>
          </div>
        </div>
        <div className="card">
          {sortedPosts.length > 0 ? (
            <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
              <table className="data">
                <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
                  <tr>
                    <SortTh col="brand" label="Brand · handle" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                    <SortTh col="caption" label="Caption" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ width: '36%' }} />
                    <SortTh col="format" label="Format" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                    <SortTh col="likes" label="Likes" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                    <SortTh col="comments" label="Comments" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                    <SortTh col="views" label="Views" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                    <SortTh col="engRate" label="Eng. Rate" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                    <SortTh col="days" label="Posted" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                  </tr>
                  <tr className="col-filter-row">
                    <th><ColumnFilter col="brand" value={colFilter.brand} onChange={v => setColFilter(p => ({ ...p, brand: v }))} placeholder="brand…" /></th>
                    <th><ColumnFilter col="caption" value={colFilter.caption} onChange={v => setColFilter(p => ({ ...p, caption: v }))} placeholder="search caption…" /></th>
                    <th colSpan={6} />
                  </tr>
                </thead>
                <tbody>
                  {sortedPosts.map((v, i) => {
                    const formatLabel = FORMAT_LABEL[v.format] || v.format || 'Image'
                    const isVid = isVideoFormat(v.format)
                    const isCar = isCarouselFormat(v.format)
                    return (
                      <tr key={i} className={v.brand === 'joola' ? 'joola' : ''}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="brand-dot" style={{ background: pgColor(v.brand) }} />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontWeight: 700, color: v.brand === 'joola' ? '#22c55e' : 'var(--fg)', fontSize: 12 }}>{name(v.brand)}</span>
                              <a
                                href={`https://www.instagram.com/${v.handle.replace('@', '')}`}
                                target="_blank" rel="noopener noreferrer"
                                className="ext-link"
                                style={{ fontSize: 10 }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {v.handle}
                              </a>
                            </div>
                          </div>
                        </td>
                        <td style={{ color: 'var(--fg)' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                            <span style={{ fontSize: 12 }}>{v.caption?.slice(0, 80) || '—'}</span>
                            {v.url && (
                              <a href={v.url} target="_blank" rel="noopener noreferrer" className="ext-link" style={{ marginTop: 1, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                                View
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
          ) : (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>
              <div style={{ fontSize: 13, marginBottom: 8 }}>No posts match the current filters.</div>
              <div style={{ fontSize: 11 }}>
                Try widening the date range (top right){displayPostsBrand.length > 0 ? `, switching the format chip, or clearing the column search.` : ' or check back after the next weekly refresh.'}
              </div>
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2>
              Engagement quality matrix
              <SectionInfo
                title="Reach vs. Resonance Quadrant"
                description="X-axis = follower count (audience size). Y-axis = engagement rate (audience involvement). Top-right = winning both. Median crosshair divides the grid into the four quadrants; JOOLA's reference lines are green. Hover any dot for full stats and quadrant interpretation."
                source="ig_posts + ig_profiles_weekly · engagement rate = (avg likes + avg comments) ÷ followers × 100. Brands under 50 followers are excluded."
              />
            </h2>
            <div className="sub">
              Followers (reach) × engagement rate (resonance). Top-right = winning. Brands with under {ER_MIN_FOLLOWERS} followers are excluded — ER is unreliable on tiny audiences.
            </div>
          </div>
        </div>
        <div className="card"><div className="card-pad-lg">
          <EngagementQualityMatrix data={eqData} />
        </div></div>
      </section>

      <h3 style={{ marginTop: 56, marginBottom: 8, color: 'var(--fg)', fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        Additional Instagram Insights
      </h3>
      <div style={{ borderTop: '1px solid var(--line-2)', marginBottom: 16 }} />

      <section>
        <div className="two-col-even">
          <div>
            <div className="section-head">
              <div>
                <h2>
                  Follower trajectory
                  <SectionInfo
                    title="Follower Growth Over Time"
                    description="Each brand's Instagram follower count plotted week by week. Upward slopes show momentum."
                    source="ig_profiles_weekly · updated every Monday"
                  />
                </h2>
                <div className="sub">Weekly snapshot trend lines across tracked brands.</div>
              </div>
            </div>
            <div className="card"><div className="card-pad">
              <LineChart series={lineSeries} xLabels={xLabels} />
            </div></div>
          </div>
          <div>
            <div className="section-head">
              <div>
                <h2>
                  Engagement rate · benchmark
                  <SectionInfo
                    title="Engagement Rate Benchmark"
                    description="Ranked list — 1–3% is solid for large accounts; above 3% is excellent. Click a row to filter the posts table above."
                    source="ig_posts · (avg likes + avg comments) ÷ followers × 100"
                  />
                </h2>
                <div className="sub">Click a brand to filter the posts table above.</div>
              </div>
            </div>
            <div className="card"><div className="card-pad">
              {erSorted.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>
                  No engagement data yet — run the IG pipeline first.
                </div>
              ) : erSorted.map((d) => (
                <div
                  key={d.brand}
                  className={'bar-row ' + (d.brand === 'joola' ? 'joola' : '')}
                  style={{ gridTemplateColumns: '110px 1fr 70px 70px', cursor: 'pointer' }}
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
                    }} />
                  </div>
                  <div className="spark-mini" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--fg)' }}>{d.engRate.toFixed(2)}%</div>
                  <div className="delta-mini flat">{fmt(d.followers)}</div>
                </div>
              ))}
            </div></div>
          </div>
        </div>
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2>
              Posting cadence · recent activity
              <SectionInfo
                title="Posting Frequency Heatmap"
                description="How often each brand posted per day over the last 4 weeks. Darker cells = more posts that day. Consistent posting maintains algorithmic visibility."
                source="ig_posts · post timestamps refreshed every Monday"
              />
            </h2>
            <div className="sub">Daily posting frequency heatmap per brand · last 4 weeks.</div>
          </div>
        </div>
        <div className="card"><div className="card-pad">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 18 }}>
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
      </section>

      <section>
        <div className="two-col-even">
          <div>
            <div className="section-head">
              <div>
                <h2>
                  Paddle mentions · IG comments
                  <SectionInfo
                    title="Paddle Mentions in IG Comments"
                    description="Which paddles get talked about most in Instagram comments across all brand posts. Aggregated from the AI-enriched mention_facts table (channel = ig_comment, product_id extracted by GPT-4o NER)."
                    source="mention_facts · channel='ig_comment' · grouped by product_id × target brand"
                  />
                </h2>
                <div className="sub">Top paddles mentioned in IG comments · brand = mention target.</div>
              </div>
            </div>
            <div className="card"><div className="card-pad">
              {displayPaddleMentions.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>
                  No paddle mentions yet — run AI enrichment + populate_mention_facts.
                </div>
              ) : displayPaddleMentions.slice(0, 15).map((d, i) => (
                <div key={i} className={'bar-row ' + (d.brand === 'joola' ? 'joola' : '')}
                  style={{ gridTemplateColumns: '160px 1fr 50px 70px' }}>
                  <div className="lbl" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 12 }}>{d.entityName}</span>
                    <span style={{ fontSize: 10, color: 'var(--fg-4)' }}>{name(d.brand)}</span>
                  </div>
                  <div className="track">
                    <div className="fill" style={{
                      width: Math.max(2, d.mentions / maxPaddle * 100) + '%',
                      background: `linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                    }} />
                  </div>
                  <div className="spark-mini" style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(d.mentions)}</div>
                  <div className="delta-mini flat" title={`${d.positive} positive · ${d.negative} negative`}>
                    <span style={{ color: '#22c55e' }}>+{d.positive}</span>
                    {' / '}
                    <span style={{ color: '#ef4444' }}>-{d.negative}</span>
                  </div>
                </div>
              ))}
            </div></div>
          </div>
          <div>
            <div className="section-head">
              <div>
                <h2>
                  Player mentions · IG comments
                  <SectionInfo
                    title="Athlete Mentions in IG Comments"
                    description="Which sponsored players get name-checked most in Instagram comments. The brand column shows the player's sponsoring brand. Useful for measuring athlete ROI per dollar of sponsorship."
                    source="mention_facts · channel='ig_comment' · grouped by athlete_id × sponsoring brand"
                  />
                </h2>
                <div className="sub">Top players mentioned in IG comments · brand = sponsoring brand.</div>
              </div>
            </div>
            <div className="card"><div className="card-pad">
              {displayPlayerMentions.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>
                  No player mentions yet — run AI enrichment + populate_mention_facts.
                </div>
              ) : displayPlayerMentions.slice(0, 15).map((d, i) => (
                <div key={i} className={'bar-row ' + (d.brand === 'joola' ? 'joola' : '')}
                  style={{ gridTemplateColumns: '160px 1fr 50px 70px' }}>
                  <div className="lbl" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 12 }}>{d.entityName}</span>
                    <span style={{ fontSize: 10, color: 'var(--fg-4)' }}>{name(d.brand)}</span>
                  </div>
                  <div className="track">
                    <div className="fill" style={{
                      width: Math.max(2, d.mentions / maxPlayer * 100) + '%',
                      background: `linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                    }} />
                  </div>
                  <div className="spark-mini" style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(d.mentions)}</div>
                  <div className="delta-mini flat" title={`${d.positive} positive · ${d.negative} negative`}>
                    <span style={{ color: '#22c55e' }}>+{d.positive}</span>
                    {' / '}
                    <span style={{ color: '#ef4444' }}>-{d.negative}</span>
                  </div>
                </div>
              ))}
            </div></div>
          </div>
        </div>
      </section>

      <h3 style={{ marginTop: 56, marginBottom: 8, color: 'var(--fg)', fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        Review required — existing Instagram sections not included in this change request
      </h3>
      <div style={{ borderTop: '1px solid var(--line-2)', marginBottom: 16 }} />

      <section>
        <div className="card"><div className="card-pad">
          <table className="data" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Section</th>
                <th style={{ textAlign: 'left' }}>Original purpose</th>
                <th style={{ textAlign: 'left' }}>Data source</th>
                <th style={{ textAlign: 'left' }}>Status</th>
                <th style={{ textAlign: 'left' }}>Recommended action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>JOOLA followers KPI</td>
                <td>Headline number for JOOLA's IG follower count with WoW delta</td>
                <td>ig_profiles_weekly (latest)</td>
                <td><span className="pill pill-ghost">Working</span></td>
                <td>Keep later — duplicates info available in Engagement Benchmark</td>
              </tr>
              <tr>
                <td>JOOLA engagement rate KPI</td>
                <td>JOOLA's ER score with rank vs other brands</td>
                <td>ig_posts (avg likes+comments) / followers</td>
                <td><span className="pill pill-ghost">Working</span></td>
                <td>Keep later — already conveyed by the EQ Matrix + benchmark</td>
              </tr>
              <tr>
                <td>Total tracked posts KPI</td>
                <td>Count of all IG posts scraped across brands</td>
                <td>ig_posts.count</td>
                <td><span className="pill pill-ghost">Working</span></td>
                <td>Improve later — meaningful only if shown per-brand</td>
              </tr>
              <tr>
                <td>Total audience KPI</td>
                <td>Sum of all brand follower counts</td>
                <td>ig_profiles_weekly.followers SUM</td>
                <td><span className="pill pill-ghost">Working</span></td>
                <td>Remove later — sum across competitors is not actionable</td>
              </tr>
              <tr>
                <td>JOOLA chip filter</td>
                <td>Quick chip to filter the posts table to JOOLA only</td>
                <td>UI state</td>
                <td><span className="pill pill-info">Replaced</span></td>
                <td>Use the brand filter (top right) instead — clearer scope</td>
              </tr>
              <tr>
                <td>Caption search box</td>
                <td>Single search field hitting caption/handle/brand</td>
                <td>UI state</td>
                <td><span className="pill pill-info">Replaced</span></td>
                <td>Replaced by per-column ColumnFilter (brand + caption) on the table itself</td>
              </tr>
            </tbody>
          </table>
        </div></div>
      </section>
    </>
  )
}
