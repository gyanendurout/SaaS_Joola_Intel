'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  fetchBrands, fetchX, fetchTopXPosts,
  type V2Brand, type V2XRow, type V2XPost,
} from '@/lib/v2/data'
import { fmt } from '@/components/v2/charts'
import { PageHead, pgColor, pgName, LoadingPage, SectionInfo, SortTh, FilterBanner, ColumnFilter } from '@/components/v2/PageShell'
import { PlatformPlaybook } from '@/components/v2/PlatformPlaybook'
import { twitterPlaybook } from '@/lib/v2/playbook'
import { useBrandFilter, applyBrandFilter } from '@/lib/v2/BrandFilterContext'
import { useDateRange, applyDateRangeCustom, DATE_RANGE_LABEL } from '@/lib/v2/DateRangeContext'
import { formatCalendarDateFromDaysAgo } from '@/lib/v2/format'

/** Relative caption ("3 days ago") kept only for the title tooltip on date cells. */
function relativeLabel(days: number): string {
  return days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
}

// Mirrors the seed in migrations/003_x_tiktok.sql — see scraper note about
// brands intentionally omitted (no confirmed X account). Removed 2026-05-24:
//   - franklin: FranklinSports is parent corporate account, not pickleball arm
//   - head:     head_tennis is HEAD's tennis arm, not pickleball
const X_HANDLES: Record<string, string> = {
  joola:    'joolapickleball',
  selkirk:  'SelkirkSport',
  onix:     'OnixPickleball',
  wilson:   'WilsonSportingG',
  gamma:    'gammapickleball',
}

export default function TwitterPage() {
  const router = useRouter()
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [xData, setXData] = useState<V2XRow[]>([])
  const [posts, setPosts] = useState<V2XPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [colFilter, setColFilter] = useState<Record<string, string>>({})
  const [followerSortKey, setFollowerSortKey] = useState<string | null>(null)
  const [followerSortDir, setFollowerSortDir] = useState<'asc' | 'desc'>('desc')
  const [followerBrandFilter, setFollowerBrandFilter] = useState('')
  const [erSortKey, setErSortKey] = useState<string | null>(null)
  const [erSortDir, setErSortDir] = useState<'asc' | 'desc'>('desc')
  const [erBrandFilter, setErBrandFilter] = useState('')
  const [bwSortKey, setBwSortKey] = useState<string>('followers')
  const [bwSortDir, setBwSortDir] = useState<'asc' | 'desc'>('desc')
  const [selectedDot, setSelectedDot] = useState<V2XRow | null>(null)
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()
  const { range, effectiveFrom, effectiveTo } = useDateRange()

  useEffect(() => { document.title = 'JOOLA INTEL — X / Twitter' }, [])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedDot(null) }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [])

  useEffect(() => {
    fetchBrands().then(async (b) => {
      try {
        const [x, p] = await Promise.all([fetchX(b), fetchTopXPosts(b, 200)])
        setBrands(b); setAllBrands(b); setXData(x); setPosts(p); setLoading(false)
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
  function toggleFollowerSort(key: string) {
    if (followerSortKey === key) setFollowerSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setFollowerSortKey(key); setFollowerSortDir('desc') }
  }
  function toggleErSort(key: string) {
    if (erSortKey === key) setErSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setErSortKey(key); setErSortDir('desc') }
  }

  // Hide brands without a confirmed X handle (X_HANDLES is the single source of truth).
  // Even with handles removed from sb_get_x_handles(), stale x_profiles_weekly /
  // x_posts rows for old parent-corporate accounts (FranklinSports, head_tennis) would
  // otherwise still render here as ghost rows ("28t" etc.) until the DB DELETE runs.
  const xDataFiltered = xData.filter(d => !!X_HANDLES[d.brand])
  const postsFiltered = posts.filter(p => !!X_HANDLES[p.brand])
  const displayX = applyBrandFilter(xDataFiltered, filteredBrands, isFiltered)
  const displayPostsAll = applyBrandFilter(postsFiltered, filteredBrands, isFiltered)
  const displayPosts = applyDateRangeCustom(displayPostsAll, effectiveFrom, effectiveTo)

  const name = (s: string) => pgName(s, brands)
  const topByFollowers = [...displayX].sort((a, b) => b.followers - a.followers)
  const maxFollowers = topByFollowers[0]?.followers || 1

  const erSorted = [...displayX].filter(d => d.tweets > 0).sort((a, b) => b.engRate - a.engRate)
  const maxER = erSorted[0]?.engRate || 1

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
      else if (key === 'tweets') { av = a.tweets; bv = b.tweets }
      else { av = a.followers; bv = b.followers }
      if (typeof av === 'number' && typeof bv === 'number')
        return dir === 'asc' ? av - bv : bv - av
      return dir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av))
    })
  })()

  // ─── Engagement-per-tweet section: filter + sort ────────────────────
  const displayEr = (() => {
    const q = erBrandFilter.trim().toLowerCase()
    const filtered = q
      ? erSorted.filter(d => name(d.brand).toLowerCase().includes(q))
      : erSorted
    const key = erSortKey || 'engRate'
    const dir = erSortKey ? erSortDir : 'desc'
    return [...filtered].sort((a, b) => {
      let av: number | string, bv: number | string
      if (key === 'brand') { av = name(a.brand); bv = name(b.brand) }
      else if (key === 'tweets') { av = a.tweets; bv = b.tweets }
      else { av = a.engRate; bv = b.engRate }
      if (typeof av === 'number' && typeof bv === 'number')
        return dir === 'asc' ? av - bv : bv - av
      return dir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av))
    })
  })()

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

  // ─── Brand-wise overview ─────────────────────────────────────────────
  function toggleBwSort(col: string) {
    if (bwSortKey === col) setBwSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setBwSortKey(col); setBwSortDir('desc') }
  }
  const topPostByBrand: Record<string, V2XPost> = {}
  displayPosts.forEach(p => {
    if (!topPostByBrand[p.brand] || p.likes > topPostByBrand[p.brand].likes)
      topPostByBrand[p.brand] = p
  })
  const sortedBrandOverview = [...displayX].sort((a, b) => {
    if (a.brand === 'joola') return -1
    if (b.brand === 'joola') return 1
    const getV = (x: typeof a): number | string => {
      if (bwSortKey === 'brand') return name(x.brand)
      if (bwSortKey === 'tweets') return x.tweets
      if (bwSortKey === 'engRate') return x.engRate
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
      <PageHead title="X / TWITTER" />
      <FilterBanner />

      <PlatformPlaybook
        title="X / Twitter Playbook"
        sub="Rule-derived X competitor moves — reply quality, tweet frequency vs follower growth, engagement."
        findings={twitterPlaybook(brands, displayX, displayPosts)}
        brands={brands}
      />

      {/* ── Brand-wise Overview Table ── */}
      <section style={{ marginBottom: 28 }}>
        <div className="section-head">
          <div>
            <h2>Brand-wise overview <SectionInfo title="X / Twitter Channel Overview" description="One row per brand — followers, growth, tweet count, engagement rate, and best-performing post. Click any row for full brand X activity." source="x_profiles_weekly · x_posts · latest snapshot" /></h2>
            <div className="sub">{sortedBrandOverview.length} brands · click a row to view full details</div>
          </div>
        </div>
        <div className="card">
          <div className="table-wrap">
            <table className="data" style={{ width: '100%' }}>
              <thead><tr>
                <th style={{ width: 28, textAlign: 'center', color: 'var(--fg-4)', fontSize: 10 }}>#</th>
                <SortTh col="brand"    label="Brand"       sortKey={bwSortKey} sortDir={bwSortDir} toggle={toggleBwSort} style={{ minWidth: 130 }} />
                <SortTh col="followers" label="Followers"  sortKey={bwSortKey} sortDir={bwSortDir} toggle={toggleBwSort} style={{ textAlign: 'right' }} />
                <SortTh col="delta"    label="Flw Δ (wk)"  sortKey={bwSortKey} sortDir={bwSortDir} toggle={toggleBwSort} style={{ textAlign: 'right', width: 80 }} />
                <SortTh col="tweets"   label="Tweets"      sortKey={bwSortKey} sortDir={bwSortDir} toggle={toggleBwSort} style={{ textAlign: 'right', width: 70 }} />
                <SortTh col="engRate"  label="Eng Rate"    sortKey={bwSortKey} sortDir={bwSortDir} toggle={toggleBwSort} style={{ textAlign: 'right', width: 80 }} />
                <th style={{ minWidth: 180 }}>Top Post</th>
                <th style={{ width: 70, textAlign: 'center' }}>Profile</th>
              </tr></thead>
              <tbody>
                {sortedBrandOverview.map((d, i) => {
                  const isJ = d.brand === 'joola'
                  const color = pgColor(d.brand)
                  const tp = topPostByBrand[d.brand]
                  return (
                    <tr key={d.brand} className={isJ ? 'joola' : ''}
                      style={{ cursor: 'pointer' }}
                      onClick={() => router.push(`/v2/twitter/brand/${encodeURIComponent(d.brand)}`)}
                      title={`View ${name(d.brand)} X / Twitter details`}>
                      <td style={{ textAlign: 'center', fontSize: 11, color: 'var(--fg-4)', fontFamily: 'JetBrains Mono' }}>{i + 1}</td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                            <span style={{ fontWeight: 700, color: isJ ? '#22c55e' : 'var(--fg)' }}>{name(d.brand)}</span>
                          </span>
                          {X_HANDLES[d.brand] && <span style={{ paddingLeft: 15, fontSize: 10, color: 'var(--fg-4)' }}>@{X_HANDLES[d.brand]}</span>}
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
                      <td className="cell-num" style={{ textAlign: 'right', color: 'var(--fg-3)' }}>{d.tweets > 0 ? d.tweets : '—'}</td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>
                        {d.engRate > 0 ? (
                          <span style={{ fontWeight: 700, fontFamily: 'JetBrains Mono', color: d.engRate > 3 ? '#22c55e' : d.engRate > 1 ? '#F5E625' : '#ef4444' }}>
                            {d.engRate.toFixed(2)}%
                          </span>
                        ) : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                      </td>
                      <td style={{ maxWidth: 200 }}>
                        {tp ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontSize: 11, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 190 }} title={tp.text}>
                              {tp.text.slice(0, 60)}{tp.text.length > 60 ? '…' : ''}
                            </span>
                            <span style={{ fontSize: 10, color: '#F5E625', fontFamily: 'JetBrains Mono' }}>♥ {fmt(tp.likes)} · 🔁 {fmt(tp.retweets)}</span>
                          </div>
                        ) : <span style={{ color: 'var(--fg-4)', fontSize: 11 }}>No post data</span>}
                      </td>
                      <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        {X_HANDLES[d.brand] ? (
                          <a href={`https://x.com/${X_HANDLES[d.brand]}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ fontSize: 10, padding: '3px 8px' }}>View ↗</a>
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
        <div className="section-head">
          <div>
            <h2>
              Reply-to-OP ratio · engagement quality
              <SectionInfo
                title="Replies per tweet (engagement quality proxy)"
                description="Average number of replies per tweet, per brand. Replies indicate conversation, not just impressions — a high ratio means the audience cares enough to respond."
                source="x_posts.reply_count · GROUP BY brand_id"
              />
            </h2>
            <div className="sub">Higher = better discussion-driving content. JOOLA marked green.</div>
          </div>
        </div>
        <div className="card"><div className="card-pad">
          {(() => {
            const grp: Record<string, { replies: number; n: number }> = {}
            displayPosts.forEach(p => {
              if (!grp[p.brand]) grp[p.brand] = { replies: 0, n: 0 }
              grp[p.brand].replies += p.replies
              grp[p.brand].n++
            })
            const rows = Object.entries(grp)
              .map(([brand, g]) => ({ brand, ratio: g.n > 0 ? g.replies / g.n : 0, replies: g.replies, n: g.n }))
              .filter(r => r.n >= 3)
              .sort((a, b) => b.ratio - a.ratio)
            if (rows.length === 0) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>Not enough tweets to compute ratio.</div>
            const max = rows[0]?.ratio || 1
            return (
              <div>
                {rows.map(r => (
                  <div key={r.brand} className={'bar-row ' + (r.brand === 'joola' ? 'joola' : '')} style={{ gridTemplateColumns: '120px 1fr 80px 70px' }}>
                    <div className="lbl" style={{ fontWeight: 700 }}>{name(r.brand)}</div>
                    <div className="track">
                      <div className="fill" style={{ width: Math.max(2, r.ratio / max * 100) + '%', background: `linear-gradient(90deg, ${pgColor(r.brand)}, ${pgColor(r.brand)}99)` }} />
                    </div>
                    <div className="spark-mini" style={{ textAlign: 'right', fontWeight: 700 }}>{r.ratio.toFixed(1)}/tweet</div>
                    <div className="delta-mini flat">{r.n} tweets</div>
                  </div>
                ))}
              </div>
            )
          })()}
        </div></div>
      </section>

      <section style={{ marginBottom: 28 }}>
        <div className="section-head">
          <div>
            <h2>
              Tweet frequency × follower size
              <SectionInfo
                title="Frequency vs scale"
                description="Each dot is a brand; X = total tweets sampled, Y = follower count. Helps spot whether high cadence is paying off in audience size."
                source="x_profiles_weekly + x_posts"
              />
            </h2>
            <div className="sub">Are high-cadence brands also large-audience brands?</div>
          </div>
        </div>
        <div className="card"><div className="card-pad">
          {(() => {
            const data = displayX.filter(d => d.followers > 0)
            if (data.length === 0) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>No X profile data.</div>
            const W = 760, H = 280, padL = 50, padR = 20, padT = 16, padB = 32
            const maxT = Math.max(1, ...data.map(d => d.tweets))
            const maxF = Math.max(1, ...data.map(d => d.followers))
            const x = (t: number) => padL + (t / maxT) * (W - padL - padR)
            const y = (f: number) => H - padB - (f / maxF) * (H - padT - padB)
            return (
              <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
                <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="rgba(255,255,255,0.1)" />
                <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="rgba(255,255,255,0.1)" />
                <text x={W / 2} y={H - 6} fill="#8a93a4" fontSize="10" textAnchor="middle">Tweets sampled</text>
                <text x={12} y={H / 2} fill="#8a93a4" fontSize="10" textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`}>Followers</text>
                {data.map(d => {
                  const isJ = d.brand === 'joola'
                  const cx = x(d.tweets), cy = y(d.followers)
                  const r = isJ ? 8 : 6
                  return (
                    <g key={d.brand} style={{ cursor: 'pointer' }} onClick={() => setSelectedDot(d)}>
                      <circle cx={cx} cy={cy} r={r + 10} fill="transparent" />
                      <circle cx={cx} cy={cy} r={r}
                        fill={pgColor(d.brand)} fillOpacity={0.85}
                        stroke={isJ ? '#22c55e' : 'rgba(255,255,255,0.25)'} strokeWidth={isJ ? 2 : 1}>
                        <title>{name(d.brand)} · {d.tweets} tweets · {fmt(d.followers)} followers · click for details</title>
                      </circle>
                      <text x={cx} y={cy - r - 6} textAnchor="middle"
                        fill={isJ ? '#22c55e' : '#cbd1dc'} fontSize="10" fontWeight={isJ ? 800 : 500}>
                        {name(d.brand)}
                      </text>
                    </g>
                  )
                })}
              </svg>
            )
          })()}
        </div></div>

        {/* ── Brand detail modal ── */}
        {selectedDot && (() => {
          const d = selectedDot
          const bColor = pgColor(d.brand)
          const isJ = d.brand === 'joola'
          const handle = X_HANDLES[d.brand] || d.handle
          const topPost = displayPosts.filter(p => p.brand === d.brand).sort((a, b) => b.likes - a.likes)[0]
          return (
            <div onClick={() => setSelectedDot(null)}
              style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
              <div onClick={e => e.stopPropagation()}
                style={{ background: '#0d1117', border: `1px solid ${bColor}55`, borderRadius: 16, width: '100%', maxWidth: 520, overflow: 'hidden', boxShadow: `0 32px 80px rgba(0,0,0,0.65), 0 0 0 1px ${bColor}22` }}>

                {/* Header */}
                <div style={{ background: `linear-gradient(135deg, ${bColor}22 0%, rgba(13,17,23,0) 70%)`, padding: '20px 22px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 42, height: 42, borderRadius: '50%', background: bColor, boxShadow: `0 0 18px ${bColor}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.26 5.632 5.903-5.632z"/></svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: isJ ? '#22c55e' : '#fff' }}>{name(d.brand)}</div>
                      {handle && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>@{handle}</div>}
                    </div>
                  </div>
                  <button onClick={() => setSelectedDot(null)}
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--fg-3)', fontSize: 18, flexShrink: 0 }}>×</button>
                </div>

                {/* Stats grid */}
                <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                    {[
                      { label: 'Followers',   value: fmt(d.followers),  color: isJ ? '#22c55e' : bColor },
                      { label: 'Following',   value: fmt(d.following),  color: 'var(--fg-2)' },
                      { label: 'Tweets',      value: String(d.tweets),  color: 'var(--fg-2)' },
                      { label: 'Eng Rate',    value: d.engRate > 0 ? d.engRate.toFixed(2) + '%' : '—', color: d.engRate > 3 ? '#22c55e' : d.engRate > 1 ? '#F5E625' : '#ef4444' },
                      { label: 'Flw Growth',  value: d.delta != null ? (d.delta >= 0 ? '+' : '') + fmt(d.delta) : '—', color: d.delta != null ? (d.delta >= 0 ? '#22c55e' : '#ef4444') : 'var(--fg-4)' },
                      { label: 'Flw Growth %', value: d.deltaPct != null ? (d.deltaPct >= 0 ? '+' : '') + d.deltaPct.toFixed(2) + '%' : '—', color: d.deltaPct != null ? (d.deltaPct >= 0 ? '#22c55e' : '#ef4444') : 'var(--fg-4)' },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid rgba(255,255,255,0.07)`, borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ fontSize: 9, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color, fontFamily: 'JetBrains Mono', lineHeight: 1 }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Top post preview */}
                  {topPost && (
                    <div style={{ padding: '12px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 10, borderLeft: `3px solid ${bColor}` }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: bColor, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 7 }}>Top post</div>
                      <p style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.55, margin: 0, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{topPost.text}</p>
                      <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
                        <span style={{ fontSize: 11, color: '#f97316', fontFamily: 'JetBrains Mono', fontWeight: 700 }}>♥ {fmt(topPost.likes)}</span>
                        <span style={{ fontSize: 11, color: '#22c55e', fontFamily: 'JetBrains Mono' }}>🔁 {fmt(topPost.retweets)}</span>
                        <span style={{ fontSize: 11, color: '#a78bfa', fontFamily: 'JetBrains Mono' }}>💬 {fmt(topPost.replies)}</span>
                        {topPost.views > 0 && <span style={{ fontSize: 11, color: '#F5E625', fontFamily: 'JetBrains Mono' }}>👁 {fmt(topPost.views)}</span>}
                      </div>
                    </div>
                  )}

                  {/* CTAs */}
                  <div style={{ display: 'flex', gap: 10 }}>
                    {handle && (
                      <a href={`https://x.com/${handle}`} target="_blank" rel="noopener noreferrer"
                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: '#000', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '10px 0', color: '#fff', fontWeight: 700, fontSize: 12, textDecoration: 'none' }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.26 5.632 5.903-5.632z"/></svg>
                        View Profile ↗
                      </a>
                    )}
                    <button onClick={() => { setSelectedDot(null); router.push(`/v2/twitter/brand/${encodeURIComponent(d.brand)}`) }}
                      style={{ flex: 1, background: bColor, border: 'none', borderRadius: 10, padding: '10px 0', color: '#000', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
                      Full Detail →
                    </button>
                  </div>
                </div>

                <div style={{ padding: '8px 22px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 10, color: 'var(--fg-4)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>X / Twitter Intelligence · {name(d.brand)}</span>
                  <span>Esc or click outside to close</span>
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
                  title="X Follower Ranking"
                  description="Who has the largest X audience among tracked pickleball brands. Wilson and Franklin have large corporate accounts. JOOLA's X presence is smaller than its TikTok footprint — X plays a supporting role for product launches and press."
                  source="x_profiles_weekly · latest weekly snapshot"
                />
              </h2>
              <div className="sub">{displayX.length} brands · current snapshot</div>
            </div></div>
            <div className="card"><div className="card-pad">
              <table className="data" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
                <thead>
                  <tr>
                    <SortTh col="brand" label="Brand" sortKey={followerSortKey} sortDir={followerSortDir} toggle={toggleFollowerSort} style={{ width: 110 }} />
                    <SortTh col="followers" label="Followers" sortKey={followerSortKey} sortDir={followerSortDir} toggle={toggleFollowerSort} style={{ textAlign: 'right' }} />
                    <SortTh col="followers" label="" sortKey={followerSortKey} sortDir={followerSortDir} toggle={toggleFollowerSort} style={{ width: 80, textAlign: 'right' }} />
                    <SortTh col="tweets" label="Tweets" sortKey={followerSortKey} sortDir={followerSortDir} toggle={toggleFollowerSort} style={{ width: 60, textAlign: 'right' }} />
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
                    }} />
                  </div>
                  <div className="spark-mini" style={{ textAlign: 'right', fontWeight: 700, color: d.followers > 0 ? 'var(--fg)' : 'var(--fg-4)' }}>
                    {d.followers > 0 ? fmt(d.followers) : '—'}
                  </div>
                  <div className="delta-mini flat">{d.tweets > 0 ? d.tweets + 't' : '—'}</div>
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
              <table className="data" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
                <thead>
                  <tr>
                    <SortTh col="brand" label="Brand" sortKey={erSortKey} sortDir={erSortDir} toggle={toggleErSort} style={{ width: 110 }} />
                    <SortTh col="engRate" label="Avg eng" sortKey={erSortKey} sortDir={erSortDir} toggle={toggleErSort} style={{ textAlign: 'right' }} />
                    <SortTh col="engRate" label="" sortKey={erSortKey} sortDir={erSortDir} toggle={toggleErSort} style={{ width: 80, textAlign: 'right' }} />
                    <SortTh col="tweets" label="Tweets" sortKey={erSortKey} sortDir={erSortDir} toggle={toggleErSort} style={{ width: 60, textAlign: 'right' }} />
                  </tr>
                  <tr className="col-filter-row">
                    <th><ColumnFilter col="brand" value={erBrandFilter} onChange={setErBrandFilter} placeholder="brand…" /></th>
                    <th colSpan={3} />
                  </tr>
                </thead>
              </table>
              {displayEr.length > 0 ? displayEr.map(d => (
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
                    }} />
                  </div>
                  <div className="spark-mini" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--fg)' }}>
                    {d.engRate.toFixed(1)}
                  </div>
                  <div className="delta-mini flat">{d.tweets}t</div>
                </div>
              )) : (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>
                  {erBrandFilter ? 'No brands match the filter.' : 'No post data yet — run pipeline first'}
                </div>
              )}
            </div></div>
          </div>
        </div>
      </section>

      <section id="twitter-posts-table">
        <div className="section-head"><div>
          <h2>
            Top {sortedPosts.length} posts · by likes
            <SectionInfo
              title="Top X Posts"
              description="Up to the 200 highest-engagement posts across the tracked X accounts, ranked by like count. Narrow with the brand filter (top right), the date range (top right), or per-column search below. Product launches, pro player news, and community posts tend to dominate."
              source="x_posts · scraped via apidojo/twitter-scraper-lite. Click column headers to sort."
            />
          </h2>
          <div className="sub">
            Showing <strong style={{ color: 'var(--fg)' }}>{sortedPosts.length}</strong> of up to 200 ·
            {' '}sorted by likes · {DATE_RANGE_LABEL[range].toLowerCase()} · click column headers to sort.
          </div>
        </div></div>
        <div className="card">
          {sortedPosts.length > 0 ? (
            <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
              <table className="data">
                <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
                  <tr>
                    <SortTh col="brand" label="Brand" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                    <SortTh col="text" label="Post" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ width: '38%' }} />
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

      {/* ─── Pending: X / Twitter mention intelligence ─────────────────── */}
      <section>
        <div className="section-head"><div>
          <h2>
            Paddle and player mentions on X · pending
            <SectionInfo
              title="X Mention Intelligence — Pending"
              description="Cross-channel mention extraction (paddle SKU mentions, athlete tags, sentiment scoring per mention) is implemented for Reddit, Instagram, and YouTube via the mention_facts table. The X enrichment branch of the pipeline has not been wired up — no rows with channel='x' or 'x_posts' exist yet."
              source="mention_facts · (no X channel rows yet — see TODO_SESSION.md)"
            />
          </h2>
          <div className="sub">Awaiting enrichment pipeline coverage for X posts.</div>
        </div></div>
        <div className="card"><div className="card-pad" style={{ padding: 24, color: 'var(--fg-4)', fontSize: 12, lineHeight: 1.6 }}>
          <p style={{ marginTop: 0 }}>
            <strong style={{ color: 'var(--fg)' }}>Why this is empty:</strong> the AI enrichment step
            that writes paddle/player mentions to <code>mention_facts</code> is wired to
            <code> ig_comments</code>, <code>yt_comments</code>, <code>reddit_mentions</code>, and
            <code> reddit_comments</code>. It does not yet read from <code>x_posts</code>, so no
            X-channel mention rows are produced even though the raw posts are scraped.
          </p>
          <p>
            <strong style={{ color: 'var(--fg)' }}>What ships when it&apos;s wired:</strong>
            {' '}top mentioned paddles by tweet count, top mentioned athletes, sentiment per brand
            on X, and crisis flags surfaced on the existing Crisis page with channel = <code>x</code>.
          </p>
        </div></div>
      </section>
    </>
  )
}
