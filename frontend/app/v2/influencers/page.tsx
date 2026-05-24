'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  fetchBrands, fetchInfluencers, fetchTopInfluencerPosts,
  type V2Brand, type V2InfluencerRow, type V2TopInfluencerPost,
} from '@/lib/v2/data'
import { fmt } from '@/components/v2/charts'
import { PageHead, MiniKpi, pgColor, pgName, LoadingPage, SectionInfo, SortTh, FilterBanner } from '@/components/v2/PageShell'
import { useBrandFilter, applyBrandFilter } from '@/lib/v2/BrandFilterContext'
import { useDateRange, applyDateRange, DATE_RANGE_LABEL } from '@/lib/v2/DateRangeContext'

// Tier thresholds — used for the "Tier" column legend + per-row labels.
// Keeping the names in sync with industry usage:
//   Nano   < 10K
//   Micro  10K – 100K
//   Macro  100K – 500K
//   Mega   500K +
const TIERS = [
  { key: 'mega',  label: 'Mega',  min: 500_000, max: Infinity, color: '#F5E625', desc: '500K+ followers' },
  { key: 'macro', label: 'Macro', min: 100_000, max: 499_999,  color: '#22c55e', desc: '100K – 500K followers' },
  { key: 'micro', label: 'Micro', min:  10_000, max:  99_999,  color: '#818cf8', desc: '10K – 100K followers' },
  { key: 'nano',  label: 'Nano',  min:       0, max:   9_999,  color: '#94a3b8', desc: 'Under 10K followers' },
] as const

function getTier(followers: number) {
  return TIERS.find((t) => followers >= t.min) || TIERS[TIERS.length - 1]
}

// Posts-per-week is intentionally capped for display so a single outlier
// athlete (29+/wk = mixed feed + Reels + stories) does not visually skew
// the column. Underlying number is preserved for sort + tooltip.
const POSTS_PER_WEEK_CAP = 14

// Athletes with ER scaled by very low follower counts are typically a
// scraping artefact (private/locked account, handle mis-mapped). The icon
// surfaces that doubt to the user; threshold is conservative.
const LOW_FOLLOWERS_WARNING = 1000

export default function InfluencersPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [influencers, setInfluencers] = useState<V2InfluencerRow[]>([])
  const [topPosts, setTopPosts] = useState<V2TopInfluencerPost[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [error, setError] = useState<string | null>(null)
  const [hovBubble, setHovBubble] = useState<{ a: V2InfluencerRow; bx: number; by: number } | null>(null)
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null)
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()
  const { range, maxDays } = useDateRange()

  useEffect(() => {
    fetchBrands().then(async (b) => {
      try {
        const [inf, posts] = await Promise.all([
          fetchInfluencers(b),
          fetchTopInfluencerPosts(b, 50),
        ])
        setBrands(b); setAllBrands(b); setInfluencers(inf); setTopPosts(posts); setLoading(false)
      } catch (err) {
        console.error('Influencer data fetch failed', err)
        setError('Unable to load influencer data. Please refresh.')
        setLoading(false)
      }
    }).catch(err => {
      console.error('Brands fetch failed', err)
      setError('Unable to load data. Please refresh.')
      setLoading(false)
    })
  }, [setAllBrands])

  useEffect(() => { document.title = 'JOOLA INTEL — Influencer Network' }, [])

  // Weeks in the currently selected date range — used by posts/week math.
  const weeksInWindow = useMemo(() => {
    if (maxDays == null) return 4 // "All time" → treat as a 4-week rolling baseline
    return Math.max(1, Math.round(maxDays / 7))
  }, [maxDays])

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

  const displayInfluencers = applyBrandFilter(influencers, filteredBrands, isFiltered)
  const displayTopPostsAll = applyBrandFilter(topPosts, filteredBrands, isFiltered)
  const displayTopPosts = applyDateRange(displayTopPostsAll, maxDays)

  const name = (s: string) => pgName(s, brands)

  // Split active vs. inactive athletes so the all-N/A row at the bottom
  // (Jay Devilliers, etc.) doesn't visually rank alongside athletes with posts.
  const isActive = (r: V2InfluencerRow) => r.posts > 0 && r.engRate > 0
  const activeOnly = displayInfluencers.filter(isActive)
  const inactiveOnly = displayInfluencers.filter(r => !isActive(r))
  const baseSort = [...activeOnly].sort((a, b) => b.engRate - a.engRate)

  const sorted = sortKey ? [...baseSort, ...inactiveOnly].sort((a, b) => {
    const av = (a as Record<string, unknown>)[sortKey]
    const bv = (b as Record<string, unknown>)[sortKey]
    if (typeof av === 'number' && typeof bv === 'number')
      return sortDir === 'asc' ? av - bv : bv - av
    return sortDir === 'asc'
      ? String(av ?? '').localeCompare(String(bv ?? ''))
      : String(bv ?? '').localeCompare(String(av ?? ''))
  }) : [...baseSort, ...inactiveOnly]

  const totalReach = displayInfluencers.reduce((s, i) => s + i.followers, 0)
  const joolaReach = displayInfluencers.filter((i) => i.brand === 'joola').reduce((s, i) => s + i.followers, 0)
  const joolaAvgER = (() => {
    const j = activeOnly.filter((i) => i.brand === 'joola')
    return j.length ? (j.reduce((s, i) => s + i.engRate, 0) / j.length).toFixed(2) : '0'
  })()
  const topER = baseSort[0]
  const joolaAthletes = displayInfluencers.filter((i) => i.brand === 'joola').length
  const totalTrackedPosts = displayInfluencers.reduce((s, i) => s + i.posts, 0)

  // Bubble chart only plots active athletes — inactive ones would collapse onto
  // the y-axis at (0, 0) and add noise to the scatter.
  const bubblePool = activeOnly

  // Bubble chart dimensions
  const bubW = 760, bubH = 360
  const padL = 56, padR = 30, padT = 30, padB = 44
  const innerW = bubW - padL - padR
  const innerH = bubH - padT - padB
  const xMax = Math.max(500000, ...bubblePool.map((a) => a.followers))
  const yMax = Math.max(12, ...bubblePool.map((a) => a.engRate))
  // sqrt scale: low-follower athletes spread across 50% of chart instead of clustering left
  const xb = (v: number) => padL + Math.sqrt(v / xMax) * innerW
  const yb = (v: number) => padT + innerH - (v / yMax) * innerH

  // VIZ-05: collision-resolved positions for bubbles
  type Placed = { a: V2InfluencerRow; cx: number; cy: number; r: number }
  const placed: Placed[] = bubblePool.map((a) => ({
    a, cx: xb(a.followers), cy: yb(a.engRate), r: 6 + a.posts / 4,
  }))
  // simple iterative repulsion
  const gap = 3
  for (let iter = 0; iter < 60; iter++) {
    let moved = false
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const A = placed[i], B = placed[j]
        const dx = B.cx - A.cx, dy = B.cy - A.cy
        const dist = Math.hypot(dx, dy) || 0.001
        const minDist = A.r + B.r + gap
        if (dist < minDist) {
          const overlap = (minDist - dist) / 2
          const ux = dx / dist, uy = dy / dist
          A.cx -= ux * overlap; A.cy -= uy * overlap
          B.cx += ux * overlap; B.cy += uy * overlap
          // clamp into chart area
          A.cx = Math.min(Math.max(A.cx, padL + A.r), padL + innerW - A.r)
          A.cy = Math.min(Math.max(A.cy, padT + A.r), padT + innerH - A.r)
          B.cx = Math.min(Math.max(B.cx, padL + B.r), padL + innerW - B.r)
          B.cy = Math.min(Math.max(B.cy, padT + B.r), padT + innerH - B.r)
          moved = true
        }
      }
    }
    if (!moved) break
  }

  // VIZ-20: label deconflict — show all labels, push overlapping ones vertically
  const labels = placed.map((p) => ({ id: p.a.name, x: p.cx, y: p.cy - p.r - 6 }))
  const minGap = 11
  labels.sort((a, b) => a.y - b.y)
  for (let i = 1; i < labels.length; i++) {
    // only adjust if x positions are close enough to overlap horizontally
    for (let j = 0; j < i; j++) {
      if (Math.abs(labels[i].x - labels[j].x) < 60 && labels[i].y - labels[j].y < minGap) {
        labels[i].y = labels[j].y + minGap
      }
    }
  }
  const labelByName = new Map(labels.map(l => [l.id, l]))

  // Filter top posts to the selected athlete if one is pinned.
  const selectedAthlete = selectedAthleteId
    ? displayInfluencers.find(a => a.id === selectedAthleteId)
    : null
  const visibleTopPosts = selectedAthleteId
    ? displayTopPosts.filter(p => p.athleteId === selectedAthleteId)
    : displayTopPosts

  // Posted-cell helpers
  function postedLabel(days: number): { date: string; relative: string } {
    const d = new Date(Date.now() - Math.max(0, days) * 86400000)
    const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const relative = days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
    return { date, relative }
  }
  function platformLabel(p: V2TopInfluencerPost['platform']): string {
    if (p === 'ig') return 'Instagram'
    if (p === 'tiktok') return 'TikTok'
    if (p === 'yt') return 'YouTube'
    return 'X'
  }
  function platformShort(p: V2TopInfluencerPost['platform']): string {
    if (p === 'ig') return 'IG'
    if (p === 'tiktok') return 'TT'
    if (p === 'yt') return 'YT'
    return 'X'
  }

  function jumpToTopPosts(athleteId: string) {
    setSelectedAthleteId(athleteId)
    document.getElementById('influencer-top-posts')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      <PageHead
        eyebrow={`INFLUENCER NETWORK · ${displayInfluencers.length} ATHLETES · ${totalTrackedPosts} POSTS`}
        title="Influencer"
        accent="ROI"
        sub={`JOOLA's ${joolaAthletes} tracked athletes deliver ${fmt(joolaReach)} reach — ${Math.round(joolaReach / Math.max(1, totalReach) * 100)}% of the tracked influencer audience. Platform scope: Instagram. TikTok and YouTube athlete coverage rolling out next.`}
      />
      <FilterBanner />

      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>
            Platform scope
          </span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 99,
            background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.35)',
            color: '#22c55e', fontSize: 11, fontWeight: 700,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: '#22c55e' }} />
            Instagram
          </span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 99,
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)',
            color: 'var(--fg-4)', fontSize: 11, fontWeight: 600,
          }}>
            TikTok — coming soon
          </span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 99,
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)',
            color: 'var(--fg-4)', fontSize: 11, fontWeight: 600,
          }}>
            YouTube — coming soon
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fg-4)' }}>
            Window: <strong style={{ color: 'var(--fg)' }}>{DATE_RANGE_LABEL[range]}</strong>
          </span>
        </div>

        <div className="kpi-grid">
          <MiniKpi
            label="JOOLA reach (Instagram)" src="Athlete roster" flavor="joola"
            value={fmt(joolaReach)}
            color="#22c55e"
            customVs={`${Math.round(joolaReach / Math.max(1, totalReach) * 100)}% of tracked total`}
          />
          <MiniKpi
            label="JOOLA athletes" value={joolaAthletes} color="#22c55e" flavor="joola"
            src="Roster summary"
            customVs="tracked on Instagram"
          />
          <MiniKpi
            label="Avg eng. rate (JOOLA)" src="Engagement metrics"
            value={joolaAvgER + '%'}
            color="#818cf8"
            customVs={`Across ${totalTrackedPosts} tracked posts`}
            flavor="warn"
          />
          <MiniKpi
            label="Top ER (market)" src="Engagement metrics"
            value={topER ? topER.engRate.toFixed(2) + '%' : '—'}
            color="#F5E625"
            customVs={topER ? topER.name + ' · ' + name(topER.brand) : ''}
            flavor="warn"
          />
        </div>
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2>
              Reach &times; engagement bubble map
              <SectionInfo
                title="Influencer ROI Bubble Map"
                description="Each bubble is one athlete. X-axis: Instagram followers (reach). Y-axis: engagement rate (audience reactiveness). Bubble size: number of posts tracked. Top-right Superstar Zone equals maximum ROI. JOOLA athletes are outlined in white. Athletes with no posts in the current window are omitted from this view."
                source="Influencer roster snapshots + post-level engagement"
              />
            </h2>
            <div className="sub">Bubble size = posts tracked. Top-right = high-volume, high-engagement. JOOLA athletes outlined in white. {DATE_RANGE_LABEL[range].toLowerCase()}.</div>
          </div>
        </div>
        <div className="card"><div className="card-pad-lg">
          <div className="scatter-wrap">
          <svg viewBox={`0 0 ${bubW} ${bubH}`} width="100%" height={bubH}>
            {/* Quadrant backgrounds */}
            <rect x={padL} y={padT} width={xb(xMax * 0.3) - padL} height={yb(7) - padT} fill="rgba(129,140,248,0.05)" />
            <rect x={xb(xMax * 0.3)} y={padT} width={padL + innerW - xb(xMax * 0.3)} height={yb(7) - padT} fill="rgba(34,197,94,0.06)" />
            <rect x={padL} y={yb(7)} width={xb(xMax * 0.3) - padL} height={padT + innerH - yb(7)} fill="rgba(100,116,139,0.03)" />
            <rect x={xb(xMax * 0.3)} y={yb(7)} width={padL + innerW - xb(xMax * 0.3)} height={padT + innerH - yb(7)} fill="rgba(245,158,11,0.04)" />
            <g className="scatter-grid">
              {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
                <line key={'x' + i} x1={xb(t * xMax)} x2={xb(t * xMax)} y1={padT} y2={padT + innerH} />
              ))}
              {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
                <line key={'y' + i} x1={padL} x2={padL + innerW} y1={padT + t * innerH} y2={padT + t * innerH} />
              ))}
            </g>
            <line x1={xb(xMax * 0.3)} x2={xb(xMax * 0.3)} y1={padT} y2={padT + innerH} stroke="rgba(245,230,37,0.35)" strokeDasharray="3 3" strokeWidth="1.5" />
            <line x1={padL} x2={padL + innerW} y1={yb(7)} y2={yb(7)} stroke="rgba(245,230,37,0.35)" strokeDasharray="3 3" strokeWidth="1.5" />
            {/* VIZ-06: quadrant labels with backing rect to ensure readability over bubbles */}
            {[
              { x: padL + 10, y: padT + 8, w: 162, label: 'High ER · Smaller audience', anchor: 'start' as const, color: '#94a3b8' },
              { x: padL + innerW - 10, y: padT + 8, w: 122, label: 'SUPERSTAR ZONE', anchor: 'end' as const, color: '#22c55e' },
              { x: padL + 10, y: padT + innerH - 22, w: 156, label: 'Low ER · Smaller audience', anchor: 'start' as const, color: '#94a3b8' },
              { x: padL + innerW - 10, y: padT + innerH - 22, w: 178, label: 'Big reach · Low engagement', anchor: 'end' as const, color: '#94a3b8' },
            ].map((q, i) => (
              <g key={'q' + i}>
                <rect
                  x={q.anchor === 'end' ? q.x - q.w : q.x - 4}
                  y={q.y}
                  width={q.w + 4} height={16} rx={4}
                  fill="rgba(7,9,14,0.78)" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5"
                />
                <text x={q.x} y={q.y + 11} textAnchor={q.anchor} className="scatter-quadrant"
                  style={{ fontSize: 10, fontWeight: 700, fill: q.color, opacity: 1 }}>
                  {q.label}
                </text>
              </g>
            ))}
            {[xMax * 0.0625, xMax * 0.25, xMax * 0.5625, xMax].map((v, i) => (
              <text key={i} x={xb(v)} y={bubH - 22} textAnchor="middle" className="scatter-axis">{fmt(v)}</text>
            ))}
            <text x={padL + innerW / 2} y={bubH - 6} textAnchor="middle" className="scatter-axis" style={{ fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>INSTAGRAM FOLLOWERS →</text>
            {[0, 3, 6, 9, 12].map((v, i) => (
              <text key={i} x={padL - 8} y={yb(v) + 3} textAnchor="end" className="scatter-axis">{v}%</text>
            ))}
            <text transform={`translate(14 ${padT + innerH / 2}) rotate(-90)`} textAnchor="middle" className="scatter-axis" style={{ fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>INSTAGRAM ENGAGEMENT RATE ↑</text>
            {placed.map((p, i) => {
              const { a, cx, cy, r: bR } = p
              const isJ = a.brand === 'joola'
              const isHov = hovBubble?.a === a
              const lbl = labelByName.get(a.name)
              const labelY = lbl ? lbl.y : cy - bR - 6
              return (
                <g key={i} style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHovBubble({ a, bx: cx, by: cy })}
                  onMouseLeave={() => setHovBubble(null)}
                  onClick={() => jumpToTopPosts(a.id)}>
                  {/* halo */}
                  <circle cx={cx} cy={cy} r={bR + (isHov ? 10 : 5)} fill={pgColor(a.brand)}
                    opacity={isHov ? 0.22 : 0.10}
                    style={{ transition: 'r 200ms, opacity 200ms' }} />
                  {/* main dot */}
                  <circle cx={cx} cy={cy} r={isHov ? bR + 3 : bR} fill={pgColor(a.brand)}
                    opacity={isJ ? 1 : 0.85}
                    stroke={isJ ? '#fff' : isHov ? '#fff' : 'rgba(0,0,0,0.4)'}
                    strokeWidth={isJ ? 2.5 : isHov ? 2 : 1}
                    style={{ transition: 'r 200ms', filter: isHov ? `drop-shadow(0 0 10px ${pgColor(a.brand)}cc)` : 'none' }} />
                  {/* connector when label is displaced */}
                  {Math.abs(labelY - (cy - bR - 6)) > 1 && (
                    <line x1={cx} y1={cy - bR} x2={cx} y2={labelY + 4}
                      stroke={pgColor(a.brand)} strokeOpacity="0.35" strokeWidth="0.6" />
                  )}
                  {/* VIZ-20: every athlete gets a label */}
                  <text x={cx} y={labelY} textAnchor="middle" className="scatter-label"
                    style={{
                      fontSize: isHov ? 12 : isJ ? 11 : 10,
                      fontWeight: isJ || isHov ? 800 : 600,
                      fill: isJ ? '#22c55e' : isHov ? '#fff' : '#cbd1dc',
                      pointerEvents: 'none',
                      paintOrder: 'stroke',
                      stroke: 'rgba(7,9,14,0.85)', strokeWidth: 2.5, strokeLinejoin: 'round',
                    }}>
                    {a.name.split(' ')[0]}
                  </text>
                </g>
              )
            })}
          </svg>
          {hovBubble && (
            <div className="tip" style={{ left: (hovBubble.bx / bubW) * 100 + '%', top: (hovBubble.by / bubH) * 100 + '%' }}>
              <div className="t-name">{hovBubble.a.name}</div>
              {fmt(hovBubble.a.followers)} followers · {hovBubble.a.engRate.toFixed(2)}% ER · click to view posts
            </div>
          )}
          </div>
        </div></div>
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2>
              Full athlete roster · ranked by engagement
              <SectionInfo
                title="Athlete Roster"
                description="Every tracked athlete across all brands, ranked by how engaged their Instagram audience is. Engagement rate above 8% (highlighted in yellow) is exceptional. Click an athlete name to see their top posts below. Athletes with no post data in the current window are sorted to the bottom and marked Inactive. Posts/wk is the post count in the selected window divided by the number of weeks in that window."
                source="Athlete roster + Instagram post engagement"
              />
            </h2>
            <div className="sub">
              Ranked by engagement rate · {DATE_RANGE_LABEL[range].toLowerCase()} · {weeksInWindow} {weeksInWindow === 1 ? 'week' : 'weeks'} in window
            </div>
          </div>
        </div>

        {/* Tier legend (M1: NANO / MICRO / MACRO / MEGA glossary) */}
        <div style={{
          display: 'flex', gap: 14, flexWrap: 'wrap',
          padding: '10px 14px', marginBottom: 12,
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8,
          fontSize: 11, color: 'var(--fg-3)',
        }}>
          <span style={{ fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-2)' }}>
            Tiers
          </span>
          {TIERS.map((t) => (
            <span key={t.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title={`${t.label}: ${t.desc}`}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: t.color }} />
              <strong style={{ color: t.color }}>{t.label.toUpperCase()}</strong> {t.desc}
            </span>
          ))}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#f59e0b', marginLeft: 'auto' }}>
            <span>⚠</span>
            = follower count anomaly — verify athlete account
          </span>
        </div>

        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <th>#</th>
                <SortTh col="name" label="Athlete" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                <SortTh col="brand" label="Brand" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                <th title="Platforms the athlete account is currently tracked on">Platforms</th>
                <SortTh col="followers" label="Followers (IG)" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                <SortTh
                  col="posts"
                  label="Posts/wk"
                  sortKey={sortKey} sortDir={sortDir} toggle={toggleSort}
                  style={{ textAlign: 'right' }}
                />
                <SortTh col="avgLikes" label="Avg likes" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                <SortTh col="engRate" label="Eng. rate" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                <th style={{ width: 160 }}>Tier</th>
              </tr></thead>
              <tbody>
                {sorted.map((a, i) => {
                  const isJ = a.brand === 'joola'
                  const active = isActive(a)
                  const igHandle = a.igHandle || a.name.toLowerCase().replace(/ /g, '')
                  const postsPerWeek = a.posts / weeksInWindow
                  const cappedPpw = postsPerWeek > POSTS_PER_WEEK_CAP
                  const tier = getTier(a.followers)
                  const lowFollowers = a.followers > 0 && a.followers < LOW_FOLLOWERS_WARNING
                  const isSelected = selectedAthleteId === a.id
                  return (
                    <tr
                      key={a.id || i}
                      className={isJ ? 'joola' : ''}
                      style={isSelected ? { background: 'rgba(245,230,37,0.10)' } : undefined}
                    >
                      <td className="cell-num">{active ? i + 1 : '—'}</td>
                      <td>
                        <div className="athlete-row">
                          <div className="athlete-avatar" style={{ background: pgColor(a.brand) + '33', color: pgColor(a.brand), borderColor: pgColor(a.brand) + '44' }}>{a.init}</div>
                          <div>
                            <button
                              type="button"
                              onClick={() => jumpToTopPosts(a.id)}
                              title="View this athlete's top posts below"
                              style={{
                                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                fontWeight: 700, color: isSelected ? '#F5E625' : 'var(--fg)', fontSize: 13,
                                textAlign: 'left',
                              }}
                            >
                              {a.name}
                              <span style={{ fontSize: 10, color: 'var(--fg-4)', marginLeft: 6 }}>↓ posts</span>
                            </button>
                            <a
                              href={`https://www.instagram.com/${igHandle}`}
                              target="_blank" rel="noopener noreferrer"
                              className="cta-link"
                              style={{ display: 'block' }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              @{igHandle}
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{flexShrink:0}}><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                            </a>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className="brand-dot" style={{ background: pgColor(a.brand) }} />
                          {name(a.brand)}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                          {a.igHandle && (
                            <span title={`Instagram: @${a.igHandle}`} style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: 22, height: 18, borderRadius: 4,
                              background: 'rgba(236,72,153,0.14)', border: '1px solid rgba(236,72,153,0.35)',
                              color: '#ec4899', fontSize: 9, fontWeight: 800, letterSpacing: '0.04em',
                            }}>IG</span>
                          )}
                          {a.xHandle && (
                            <span title={`X / Twitter: @${a.xHandle}`} style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: 22, height: 18, borderRadius: 4,
                              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.18)',
                              color: 'var(--fg-2)', fontSize: 9, fontWeight: 800, letterSpacing: '0.04em',
                            }}>X</span>
                          )}
                          {!a.igHandle && !a.xHandle && (
                            <span style={{ color: 'var(--fg-4)', fontSize: 11 }}>—</span>
                          )}
                        </div>
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>
                        <span title={`Instagram followers: ${a.followers.toLocaleString()}`}>
                          <span style={{ fontSize: 9, color: 'var(--fg-4)', marginRight: 4 }}>IG</span>
                          {fmt(a.followers)}
                        </span>
                        {lowFollowers && (
                          <span
                            title="Follower count below typical threshold — may indicate a tracking gap or a private/recently-created athlete account. Verify the handle is mapped correctly."
                            style={{ color: '#f59e0b', marginLeft: 5, fontSize: 11, cursor: 'help' }}
                          >⚠</span>
                        )}
                      </td>
                      <td
                        className="cell-num"
                        style={{ textAlign: 'right' }}
                        title={`${postsPerWeek.toFixed(2)} posts per week (feed + Reels + video) over ${weeksInWindow} ${weeksInWindow === 1 ? 'week' : 'weeks'} · ${a.posts} total posts in window`}
                      >
                        {a.posts > 0
                          ? (cappedPpw
                              ? <>{POSTS_PER_WEEK_CAP.toFixed(1)}+ <span style={{ color: 'var(--fg-4)', fontSize: 10 }}>ⓘ</span></>
                              : postsPerWeek.toFixed(1))
                          : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>
                        {a.avgLikes > 0 ? fmt(a.avgLikes) : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right', color: a.engRate > 8 ? '#F5E625' : a.engRate === 0 ? 'var(--fg-4)' : 'var(--fg)' }}>
                        {a.engRate > 0
                          ? a.engRate.toFixed(2) + '%'
                          : <span style={{ color: 'var(--fg-4)' }}>No posts in this period</span>}
                      </td>
                      <td>
                        {active ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <span
                              title={`${tier.label}: ${tier.desc}`}
                              style={{ fontSize: 10, fontWeight: 800, color: tier.color, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'help' }}
                            >
                              {tier.label}
                            </span>
                            <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden', width: 44 }}>
                              <div style={{ width: (Math.min(a.engRate, 12) / 12 * 100) + '%', height: '100%', background: tier.color }} />
                            </div>
                          </div>
                        ) : (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '2px 8px', borderRadius: 99,
                            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)',
                            color: 'var(--fg-4)', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                          }}>
                            Inactive
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="influencer-top-posts">
        <div className="section-head">
          <div>
            <h2>
              Top performing posts by athlete
              <SectionInfo
                title="Top Athlete Posts"
                description="Highest-engagement posts from tracked athletes in the selected window. Click an athlete in the roster above to narrow this table to just that athlete; use the clear button to reset. Currently sourced from Instagram only — TikTok and YouTube athlete-level posts will join here as that data lands."
                source="Athlete post engagement (Instagram)"
              />
            </h2>
            <div className="sub">
              {selectedAthlete
                ? <>Showing <strong style={{ color: '#F5E625' }}>{selectedAthlete.name}</strong> only · {visibleTopPosts.length} {visibleTopPosts.length === 1 ? 'post' : 'posts'} · {DATE_RANGE_LABEL[range].toLowerCase()}</>
                : <>Showing top <strong style={{ color: 'var(--fg)' }}>{visibleTopPosts.length}</strong> {visibleTopPosts.length === 1 ? 'post' : 'posts'} · {DATE_RANGE_LABEL[range].toLowerCase()} · click an athlete in the roster to filter</>}
              {selectedAthlete && (
                <>
                  {' '}·{' '}
                  <button
                    onClick={() => setSelectedAthleteId(null)}
                    style={{
                      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
                      borderRadius: 4, color: 'var(--fg-2)', fontSize: 10,
                      padding: '2px 8px', cursor: 'pointer',
                    }}
                  >
                    × clear athlete
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="card">
          {visibleTopPosts.length > 0 ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Athlete</th>
                    <th>Brand</th>
                    <th>Platform</th>
                    <th style={{ width: '36%' }}>Caption</th>
                    <th style={{ textAlign: 'right' }}>Likes</th>
                    <th style={{ textAlign: 'right' }}>Comments</th>
                    <th style={{ textAlign: 'right' }}>Engagement</th>
                    <th>Posted</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTopPosts.slice(0, 20).map((p, i) => {
                    const engagement = p.likes + p.comments
                    const posted = postedLabel(p.days)
                    return (
                      <tr key={i} className={p.brand === 'joola' ? 'joola' : ''}>
                        <td>
                          <button
                            type="button"
                            onClick={() => setSelectedAthleteId(p.athleteId)}
                            style={{
                              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                              fontWeight: 700, color: 'var(--fg)', fontSize: 12, textAlign: 'left',
                            }}
                            title="Filter to this athlete"
                          >
                            {p.athleteName}
                          </button>
                          {p.athleteHandle && (
                            <div style={{ fontSize: 10, color: 'var(--fg-4)' }}>@{p.athleteHandle}</div>
                          )}
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span className="brand-dot" style={{ background: pgColor(p.brand) }} />
                            {name(p.brand)}
                          </span>
                        </td>
                        <td>
                          <span title={platformLabel(p.platform)} style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            minWidth: 28, height: 18, padding: '0 6px', borderRadius: 4,
                            background: p.platform === 'ig' ? 'rgba(236,72,153,0.14)' : 'rgba(255,255,255,0.06)',
                            border: '1px solid ' + (p.platform === 'ig' ? 'rgba(236,72,153,0.35)' : 'rgba(255,255,255,0.18)'),
                            color: p.platform === 'ig' ? '#ec4899' : 'var(--fg-2)',
                            fontSize: 9, fontWeight: 800, letterSpacing: '0.04em',
                          }}>
                            {platformShort(p.platform)}
                          </span>
                        </td>
                        <td style={{ color: 'var(--fg)' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                            <span style={{ fontSize: 12 }}>{p.caption ? p.caption.slice(0, 90) + (p.caption.length > 90 ? '…' : '') : '—'}</span>
                            {p.url && (
                              <a href={p.url} target="_blank" rel="noopener noreferrer" className="ext-link" style={{ marginTop: 1, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                                View
                                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(p.likes)}</td>
                        <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(p.comments)}</td>
                        <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625' }}>{fmt(engagement)}</td>
                        <td className="cell-num" title={posted.relative}>{posted.date}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>
              <div style={{ fontSize: 13, marginBottom: 8 }}>
                {selectedAthlete
                  ? `${selectedAthlete.name} has no posts in this window.`
                  : 'No athlete posts in the current window.'}
              </div>
              <div style={{ fontSize: 11 }}>
                Try widening the date range (top right){selectedAthlete ? ' or clear the athlete filter above' : ''}.
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
