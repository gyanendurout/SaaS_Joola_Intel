'use client'

import { useEffect, useState } from 'react'
import { fetchBrands, fetchInfluencers, type V2Brand, type V2InfluencerRow } from '@/lib/v2/data'
import { fmt } from '@/components/v2/charts'
import { PageHead, MiniKpi, pgColor, pgName, LoadingPage, SectionInfo, SortTh, FilterBanner } from '@/components/v2/PageShell'
import { useBrandFilter, applyBrandFilter } from '@/lib/v2/BrandFilterContext'

function getTier(followers: number): string {
  if (followers >= 500_000) return 'Mega'
  if (followers >= 100_000) return 'Macro'
  if (followers >= 10_000) return 'Micro'
  return 'Nano'
}
function tierColor(followers: number): string {
  if (followers >= 500_000) return '#F5E625'
  if (followers >= 100_000) return '#22c55e'
  if (followers >= 10_000) return '#818cf8'
  return '#94a3b8'
}

export default function InfluencersPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [influencers, setInfluencers] = useState<V2InfluencerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [error, setError] = useState<string | null>(null)
  const [hovBubble, setHovBubble] = useState<{ a: V2InfluencerRow; bx: number; by: number } | null>(null)
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()

  useEffect(() => {
    fetchBrands().then(async (b) => {
      try {
        const inf = await fetchInfluencers(b)
        setBrands(b); setAllBrands(b); setInfluencers(inf); setLoading(false)
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
  }, [])

  useEffect(() => { document.title = 'JOOLA INTEL — Influencer Network' }, [])

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

  const name = (s: string) => pgName(s, brands)
  const baseSort = [...displayInfluencers].sort((a, b) => b.engRate - a.engRate)

  const sorted = sortKey ? [...baseSort].sort((a, b) => {
    const av = (a as Record<string, unknown>)[sortKey]
    const bv = (b as Record<string, unknown>)[sortKey]
    if (typeof av === 'number' && typeof bv === 'number')
      return sortDir === 'asc' ? av - bv : bv - av
    return sortDir === 'asc'
      ? String(av ?? '').localeCompare(String(bv ?? ''))
      : String(bv ?? '').localeCompare(String(av ?? ''))
  }) : baseSort

  const totalReach = displayInfluencers.reduce((s, i) => s + i.followers, 0)
  const joolaReach = displayInfluencers.filter((i) => i.brand === 'joola').reduce((s, i) => s + i.followers, 0)
  const joolaAvgER = (() => {
    const j = displayInfluencers.filter((i) => i.brand === 'joola')
    return j.length ? (j.reduce((s, i) => s + i.engRate, 0) / j.length).toFixed(2) : '0'
  })()
  const topER = baseSort[0]
  const joolaAthletes = displayInfluencers.filter((i) => i.brand === 'joola').length

  // Bubble chart dimensions
  const bubW = 760, bubH = 360
  const padL = 56, padR = 30, padT = 30, padB = 44
  const innerW = bubW - padL - padR
  const innerH = bubH - padT - padB
  const xMax = Math.max(500000, ...displayInfluencers.map((a) => a.followers))
  const yMax = Math.max(12, ...displayInfluencers.map((a) => a.engRate))
  // sqrt scale: low-follower athletes spread across 50% of chart instead of clustering left
  const xb = (v: number) => padL + Math.sqrt(v / xMax) * innerW
  const yb = (v: number) => padT + innerH - (v / yMax) * innerH

  // VIZ-05: collision-resolved positions for bubbles
  type Placed = { a: V2InfluencerRow; cx: number; cy: number; r: number }
  const placed: Placed[] = displayInfluencers.map((a) => ({
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

  return (
    <>
      <PageHead
        eyebrow={`INFLUENCER NETWORK · ${displayInfluencers.length} ATHLETES · ${displayInfluencers.reduce((s, i) => s + i.posts, 0)} POSTS`}
        title="Influencer"
        accent="ROI"
        sub={`JOOLA's ${joolaAthletes} tracked athletes deliver ${fmt(joolaReach)} reach — ${Math.round(joolaReach / Math.max(1, totalReach) * 100)}% of the entire tracked influencer audience.`}
        actions={<>
          <select className="select"><option>All athletes</option></select>
          <select className="select"><option>By engagement rate</option></select>
        </>}
      />
      <FilterBanner />

      <section>
        <div className="kpi-grid">
          <MiniKpi
            label="JOOLA reach" src="Influencer data" flavor="joola"
            value={fmt(joolaReach)}
            color="#22c55e"
            customVs={`${Math.round(joolaReach / Math.max(1, totalReach) * 100)}% of tracked total`}
          />
          <MiniKpi
            label="JOOLA athletes" value={joolaAthletes} color="#22c55e" flavor="joola"
            src="Influencer data"
            customVs="tracked on Instagram"
          />
          <MiniKpi
            label="Avg eng. rate (JOOLA)" src="Influencer posts"
            value={joolaAvgER + '%'}
            color="#818cf8"
            customVs="based on scraped posts"
            flavor="warn"
          />
          <MiniKpi
            label="Top ER (market)" src="Influencer posts"
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
              Reach × engagement bubble map
              <SectionInfo
                title="Influencer ROI Bubble Map"
                description="Each bubble is one athlete. X-axis = their Instagram followers (reach). Y-axis = their engagement rate (how actively their audience reacts). Bubble size = number of posts tracked. Top-right 'Superstar Zone' = maximum ROI. JOOLA athletes are outlined in white."
                source="influencer_snapshots + influencer_posts · tracked manually and via apify/instagram-profile-scraper"
              />
            </h2>
            <div className="sub">Bubble size = posts tracked. Top-right = high-volume, high-engagement. JOOLA athletes outlined in white.</div>
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
            <text x={padL + innerW / 2} y={bubH - 6} textAnchor="middle" className="scatter-axis" style={{ fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>FOLLOWERS →</text>
            {[0, 3, 6, 9, 12].map((v, i) => (
              <text key={i} x={padL - 8} y={yb(v) + 3} textAnchor="end" className="scatter-axis">{v}%</text>
            ))}
            <text transform={`translate(14 ${padT + innerH / 2}) rotate(-90)`} textAnchor="middle" className="scatter-axis" style={{ fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>ENGAGEMENT RATE ↑</text>
            {placed.map((p, i) => {
              const { a, cx, cy, r: bR } = p
              const isJ = a.brand === 'joola'
              const isHov = hovBubble?.a === a
              const lbl = labelByName.get(a.name)
              const labelY = lbl ? lbl.y : cy - bR - 6
              return (
                <g key={i} style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHovBubble({ a, bx: cx, by: cy })}
                  onMouseLeave={() => setHovBubble(null)}>
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
              {fmt(hovBubble.a.followers)} followers · {hovBubble.a.engRate.toFixed(2)}% ER
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
                description="Every tracked athlete across all brands, ranked by how engaged their audience is. Engagement rate above 8% (highlighted in yellow) is exceptional. Zero values mean no post data has been scraped yet for that athlete. Click column headers to re-sort."
                source="influencer_snapshots + influencer_posts · tracked manually and via apify/instagram-profile-scraper"
              />
            </h2>
            <div className="sub">Ranked by engagement rate — actual value per post.</div>
          </div>
        </div>
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <th>#</th>
                <SortTh col="name" label="Athlete" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                <SortTh col="brand" label="Brand" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                <SortTh col="followers" label="Followers" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                <SortTh col="posts" label="Posts/wk" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                <SortTh col="avgLikes" label="Avg likes" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                <SortTh col="engRate" label="Eng. rate" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                <th style={{ width: 160 }}>Tier</th>
              </tr></thead>
              <tbody>
                {sorted.map((a, i) => {
                  const isJ = a.brand === 'joola'
                  return (
                    <tr key={i} className={isJ ? 'joola' : ''}>
                      <td className="cell-num">{i + 1}</td>
                      <td>
                        <div className="athlete-row">
                          <div className="athlete-avatar" style={{ background: pgColor(a.brand) + '33', color: pgColor(a.brand), borderColor: pgColor(a.brand) + '44' }}>{a.init}</div>
                          <div>
                            <div style={{ fontWeight: 700, color: 'var(--fg)', fontSize: 13 }}>{a.name}</div>
                            <a
                              href={`https://www.instagram.com/${a.name.toLowerCase().replace(/ /g, '')}`}
                              target="_blank" rel="noopener noreferrer"
                              className="cta-link"
                              onClick={(e) => e.stopPropagation()}
                            >
                              @{a.name.toLowerCase().replace(/ /g, '')}
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
                      <td className="cell-num" style={{ textAlign: 'right' }}>
                        <span>{fmt(a.followers)}</span>
                        {a.followers > 0 && a.followers < 1000 && (
                          <span
                            title="Follower count seems unusually low — the Instagram handle may be incorrect or point to a different account."
                            style={{ color: '#f59e0b', marginLeft: 5, fontSize: 11, cursor: 'help' }}
                          >⚠</span>
                        )}
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>{(a.posts / 4).toFixed(1)}</td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>
                        {a.avgLikes > 0 ? fmt(a.avgLikes) : <span style={{ color: 'var(--fg-4)' }}>N/A</span>}
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right', color: a.engRate > 8 ? '#F5E625' : a.engRate === 0 ? 'var(--fg-4)' : 'var(--fg)' }}>
                        {a.engRate > 0 ? a.engRate.toFixed(2) + '%' : <span style={{ color: 'var(--fg-4)' }}>N/A</span>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: tierColor(a.followers), letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                            {getTier(a.followers)}
                          </span>
                          <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden', width: 44 }}>
                            <div style={{ width: (Math.min(a.engRate, 12) / 12 * 100) + '%', height: '100%', background: tierColor(a.followers) }} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  )
}
