'use client'

import { useState } from 'react'

// ─── Number formatting helpers ───────────────────────────────────────
export function fmt(n: number | null | undefined, opts?: { money?: boolean }): string {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (opts?.money) {
    return '$' + (abs >= 1000 ? (n / 1000).toFixed(1) + 'k' : n.toFixed(0))
  }
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (abs >= 10_000) return (n / 1000).toFixed(0) + 'K'
  if (abs >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toLocaleString()
}
export function fmtPct(n: number): string { return (n > 0 ? '+' : '') + n.toFixed(1) + '%' }
export function fmtDelta(n: number): string { return (n > 0 ? '+' : '') + n.toLocaleString() }

// ─── Delta pill ──────────────────────────────────────────────────────
export function Delta({ value, pct, suffix = 'this wk' }: { value: number | null; pct?: number | null; suffix?: string }) {
  if (value == null) return <span className="delta flat">▬ <span className="vs">{suffix}</span></span>
  if (value === 0) return <span className="delta flat">▬ flat <span className="vs">{suffix}</span></span>
  const up = value > 0
  return (
    <span className={'delta ' + (up ? 'up' : 'down')}>
      {up ? '▲' : '▼'} {fmtDelta(value).replace(/^\+/, '')}{pct !== undefined && pct !== null ? ` (${fmtPct(pct)})` : ''}
      <span className="vs">{suffix}</span>
    </span>
  )
}

// ─── Sparkline ───────────────────────────────────────────────────────
export function Sparkline({ data, w = 90, h = 30, color = '#22c55e', fill = true, strokeW = 1.5 }: {
  data: number[]; w?: number; h?: number; color?: string; fill?: boolean; strokeW?: number
}) {
  if (!data || data.length === 0) return <svg width={w} height={h} />
  const safe = data.map(v => (isFinite(v) ? v : 0))
  const min = Math.min(...safe)
  const max = Math.max(...safe)
  const range = max - min || 1
  const pad = 2
  const points = safe.map((v, i) => {
    const x = pad + (i / Math.max(1, safe.length - 1)) * (w - pad * 2)
    const y = h - pad - ((v - min) / range) * (h - pad * 2)
    return [x, y] as const
  })
  const path = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')
  const area = path + ` L ${w - pad} ${h - pad} L ${pad} ${h - pad} Z`
  const id = 'sg-' + Math.random().toString(36).slice(2, 8)
  const last = points[points.length - 1]
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${id})`} />}
      <path d={path} fill="none" stroke={color} strokeWidth={strokeW} strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.2" fill={color} />
    </svg>
  )
}

// ─── Line chart (multi-series) ───────────────────────────────────────
export type LineSeries = { id: string; label: string; color: string; data: number[] }

export function LineChart({ series, w = 760, h = 260, yLabel = '', xLabels }: { series: LineSeries[]; w?: number; h?: number; yLabel?: string; xLabels?: string[] }) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [tipPos, setTipPos] = useState<{x:number,y:number}|null>(null)

  // VIZ-01: filter out series with all-zero or all-invalid data (these caused NaN labels)
  const cleanSeries = series
    .map(s => ({ ...s, data: s.data.map(v => (isFinite(v) ? v : 0)) }))
    .filter(s => s.data.length > 0 && s.data.some(v => v > 0))
  if (!cleanSeries.length || !cleanSeries[0].data.length) {
    return <div style={{ padding: 40, color: '#6b7280', fontSize: 12, textAlign: 'center' }}>No data available for this period.</div>
  }
  const padL = 44, padR = 96, padT = 14, padB = 28
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const allVals = cleanSeries.flatMap(s => s.data)
  const max = Math.max(...allVals) || 1
  const N = cleanSeries[0].data.length
  const x = (i: number) => padL + (i / Math.max(1, N - 1)) * innerW
  const y = (v: number) => {
    if (!isFinite(v) || max <= 0) return padT + innerH
    return padT + innerH - (Math.max(0, v) / max) * innerH
  }
  const yTicks = 5
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => Math.round((max / yTicks) * i))
  const hovSeries = hoveredId ? cleanSeries.find(s => s.id === hoveredId) : null

  // VIZ-09: deconflict end-of-line labels by stacking vertically when too close
  const minLabelGap = 14
  const labelLayout = (() => {
    const items = cleanSeries.map(s => ({ id: s.id, color: s.color, label: s.label, y: y(s.data[N - 1]), val: s.data[N - 1] }))
    items.sort((a, b) => a.y - b.y)
    for (let i = 1; i < items.length; i++) {
      if (items[i].y - items[i - 1].y < minLabelGap) {
        items[i].y = items[i - 1].y + minLabelGap
      }
    }
    return new Map(items.map(it => [it.id, it]))
  })()

  // VIZ-10/14: data-point tooltip — find nearest week index from mouse
  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
    const scaleX = w / rect.width
    const localX = (e.clientX - rect.left) * scaleX
    if (localX < padL || localX > padL + innerW) { setHoverIdx(null); setTipPos(null); return }
    const i = Math.round(((localX - padL) / innerW) * (N - 1))
    setHoverIdx(Math.max(0, Math.min(N - 1, i)))
    setTipPos({ x: e.clientX, y: e.clientY })
  }

  const tipIdx = hoverIdx
  const tipSeries = hovSeries

  return (
    <div className="scatter-wrap" style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}
        style={{ overflow: 'visible', display: 'block' }}
        onMouseMove={onMove}
        onMouseLeave={() => { setHoverIdx(null); setTipPos(null) }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.04)" />
            <text x={padL - 8} y={y(t) + 3} textAnchor="end" className="scatter-axis">{fmt(t)}</text>
          </g>
        ))}
        {Array.from({ length: N }).map((_, i) => (
          <text key={i} x={x(i)} y={h - 10} textAnchor="middle" className="scatter-axis">{xLabels?.[i] ?? `W${i + 1}`}</text>
        ))}
        {/* crosshair at hovered week */}
        {tipIdx !== null && (
          <line x1={x(tipIdx)} x2={x(tipIdx)} y1={padT} y2={padT + innerH}
            stroke="rgba(245,230,37,0.35)" strokeDasharray="3 3" strokeWidth="1" />
        )}
        {cleanSeries.map((s, si) => {
          const path = s.data.map((v, i) => (i === 0 ? 'M' : 'L') + x(i) + ',' + y(v)).join(' ')
          const isJoola = s.id === 'joola'
          const isHov = hoveredId === s.id
          const dimmed = hoveredId !== null && !isHov
          const lbl = labelLayout.get(s.id)
          const labelY = lbl ? lbl.y : y(s.data[N - 1])
          const endY = y(s.data[N - 1])
          return (
            <g key={si}
              onMouseEnter={() => setHoveredId(s.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{ cursor: 'pointer' }}>
              <path d={path} fill="none" stroke="transparent" strokeWidth={18} />
              <path d={path} fill="none" stroke={s.color}
                strokeWidth={isHov ? 4 : isJoola ? 2.5 : 1.4}
                opacity={dimmed ? 0.08 : isJoola ? 1 : 0.65}
                style={{ transition: 'opacity 180ms ease, stroke-width 120ms ease' }}
              />
              {isHov && s.data.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={4} fill={s.color} opacity={1}
                  stroke="rgba(0,0,0,0.6)" strokeWidth={1.5} />
              ))}
              {isJoola && !isHov && s.data.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={s.color} opacity={0.8} />
              ))}
              {/* connector line from end-of-line to deconflicted label */}
              {isFinite(endY) && isFinite(labelY) && Math.abs(labelY - endY) > 1 && (
                <line x1={x(N - 1)} x2={x(N - 1) + 4} y1={endY} y2={labelY}
                  stroke={s.color} strokeOpacity={dimmed ? 0.08 : 0.4} strokeWidth="0.8" />
              )}
              {isFinite(labelY) && (
                <text x={x(N - 1) + 7} y={labelY + 4} className="scatter-label"
                  style={{
                    fill: s.color,
                    fontSize: isHov ? 12 : 10,
                    fontWeight: isHov ? 900 : isJoola ? 800 : 600,
                    opacity: dimmed ? 0.08 : 1,
                    transition: 'opacity 180ms ease, font-size 120ms ease',
                  }}>
                  {s.label}
                </text>
              )}
            </g>
          )
        })}
        {yLabel && <text x={10} y={padT + 6} className="scatter-axis" style={{ fontWeight: 700 }}>{yLabel}</text>}
      </svg>
      {/* Per-week tooltip: shows all series values at hovered week */}
      {tipIdx !== null && tipPos && (
        <div className="tip" style={{
          left: tipPos.x, top: tipPos.y, whiteSpace: 'nowrap',
        }}>
          <div className="t-name">{xLabels?.[tipIdx] ?? `Week ${tipIdx + 1}`}</div>
          {[...cleanSeries]
            .sort((a, b) => b.data[tipIdx] - a.data[tipIdx])
            .slice(0, 6)
            .map(s => (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 10.5 }}>
                <span style={{ color: s.color, fontWeight: 700 }}>● {s.label}</span>
                <span style={{ color: '#fff', fontFamily: 'monospace' }}>{fmt(s.data[tipIdx])}</span>
              </div>
            ))}
        </div>
      )}
      {/* Series-hover hint (replaces previous "latest" tooltip when not hovering grid) */}
      {tipSeries && tipIdx === null && tipPos && (
        <div className="tip" style={{ left: tipPos.x, top: tipPos.y, whiteSpace: 'nowrap' }}>
          <div className="t-name" style={{ color: tipSeries.color }}>{tipSeries.label}</div>
          Latest: {fmt(tipSeries.data[N - 1])}
        </div>
      )}
    </div>
  )
}

// ─── Stacked area ────────────────────────────────────────────────────
export function StackedArea({ series, weeks = 13, w = 760, h = 240 }: {
  series: LineSeries[]; weeks?: number; w?: number; h?: number
}) {
  const [hoverLayer, setHoverLayer] = useState<number | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [tipPos, setTipPos] = useState<{x:number,y:number}|null>(null)
  if (!series.length) return null
  const padL = 36, padR = 12, padT = 12, padB = 28
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const N = weeks
  const x = (i: number) => padL + (i / Math.max(1, N - 1)) * innerW
  const totals = Array.from({ length: N }, (_, i) => series.reduce((s, ser) => s + (ser.data[i] || 0), 0))
  const yMax = Math.max(...totals) * 1.05 || 1
  const y = (v: number) => padT + innerH - (v / yMax) * innerH

  const stacks: { x: number; yTop: number; yBot: number }[][] = []
  for (let si = 0; si < series.length; si++) {
    const layer: { x: number; yTop: number; yBot: number }[] = []
    for (let i = 0; i < N; i++) {
      const below = series.slice(0, si).reduce((s, ser) => s + (ser.data[i] || 0), 0)
      layer.push({ x: x(i), yTop: y(below + (series[si].data[i] || 0)), yBot: y(below) })
    }
    stacks.push(layer)
  }
  const tickN = 4
  const yticks = Array.from({ length: tickN + 1 }, (_, i) => (yMax / tickN) * i)

  // VIZ-02: hover handler — find which week + which layer
  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const scaleX = w / rect.width
    const scaleY = h / rect.height
    const lx = (e.clientX - rect.left) * scaleX
    const ly = (e.clientY - rect.top) * scaleY
    if (lx < padL || lx > padL + innerW || ly < padT || ly > padT + innerH) {
      setHoverIdx(null); setHoverLayer(null); setTipPos(null); return
    }
    const i = Math.round(((lx - padL) / innerW) * (N - 1))
    setHoverIdx(i)
    setTipPos({ x: e.clientX, y: e.clientY })
    // which stack layer is at ly?
    let cumul = 0
    for (let si = 0; si < series.length; si++) {
      cumul += series[si].data[i] || 0
      if (y(cumul) <= ly) { setHoverLayer(si); return }
    }
    setHoverLayer(series.length - 1)
  }

  const hovS = hoverLayer !== null ? series[hoverLayer] : null
  const hovVal = hovS && hoverIdx !== null ? (hovS.data[hoverIdx] || 0) : 0

  return (
    <div className="scatter-wrap" style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}
        onMouseMove={onMove}
        onMouseLeave={() => { setHoverIdx(null); setHoverLayer(null); setTipPos(null) }}>
        {yticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.04)" />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="scatter-axis">{Math.round(t)}</text>
          </g>
        ))}
        {Array.from({ length: N }).map((_, i) =>
          i % 2 === 0 ? <text key={i} x={x(i)} y={h - 8} textAnchor="middle" className="scatter-axis">W{i + 1}</text> : null,
        )}
        {stacks.map((layer, si) => {
          const top = layer.map((p, i) => (i === 0 ? 'M' : 'L') + p.x + ',' + p.yTop)
          const bot = layer.slice().reverse().map(p => 'L' + p.x + ',' + p.yBot)
          const d = top.join(' ') + ' ' + bot.join(' ') + ' Z'
          const isHov = hoverLayer === si
          return (
            <path key={si} d={d} fill={series[si].color}
              opacity={isHov ? 1 : series[si].id === 'joola' ? 0.95 : 0.7}
              stroke={series[si].color} strokeWidth={isHov ? 1.5 : 0.5}
              style={{ transition: 'opacity 140ms' }} />
          )
        })}
        {/* crosshair at hovered week */}
        {hoverIdx !== null && (
          <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={padT} y2={padT + innerH}
            stroke="rgba(245,230,37,0.5)" strokeDasharray="3 3" strokeWidth="1" />
        )}
      </svg>
      {hoverIdx !== null && hovS && tipPos && (
        <div className="tip" style={{ left: tipPos.x, top: tipPos.y, whiteSpace: 'nowrap' }}>
          <div className="t-name" style={{ color: hovS.color }}>{hovS.label}</div>
          Week {hoverIdx + 1}: {hovVal} ads
        </div>
      )}
    </div>
  )
}

// ─── Scatter (engagement matrix) ─────────────────────────────────────
export type ScatterDatum = { brand: string; name: string; followers: number; engRate: number; color: string; posts?: number }

export function ScatterChart({ data, w = 760, h = 380 }: { data: ScatterDatum[]; w?: number; h?: number }) {
  const padL = 60, padR = 30, padT = 30, padB = 52
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const xMax = Math.max(150000, ...data.map(d => d.followers))
  const yMax = Math.max(2.5, ...data.map(d => d.engRate))
  const yMid = yMax / 2
  const x = (v: number) => padL + Math.sqrt(Math.min(v, xMax) / xMax) * innerW
  const y = (v: number) => padT + innerH - (Math.min(v, yMax) / yMax) * innerH
  const r = (v: number) => 5 + Math.min(v, 100) / 12
  const [hover, setHover] = useState<(ScatterDatum & { cx: number; cy: number }) | null>(null)
  const [tipPos, setTipPos] = useState<{x:number,y:number}|null>(null)
  const joola = data.find(d => d.brand === 'joola')
  const xMidVal = xMax * 0.25
  const xTickVals = [xMax * 0.0625, xMax * 0.25, xMax * 0.5625, xMax]
  const yTickVals = [yMax * 0.25, yMax * 0.5, yMax * 0.75, yMax]

  return (
    <div className="scatter-wrap"
      onMouseMove={(e) => setTipPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => { setHover(null); setTipPos(null) }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
        <rect x={padL} y={padT} width={x(xMidVal) - padL} height={y(yMid) - padT} fill="rgba(129,140,248,0.05)" />
        <rect x={x(xMidVal)} y={padT} width={padL + innerW - x(xMidVal)} height={y(yMid) - padT} fill="rgba(34,197,94,0.06)" />
        <rect x={padL} y={y(yMid)} width={x(xMidVal) - padL} height={padT + innerH - y(yMid)} fill="rgba(100,116,139,0.03)" />
        <rect x={x(xMidVal)} y={y(yMid)} width={padL + innerW - x(xMidVal)} height={padT + innerH - y(yMid)} fill="rgba(245,158,11,0.04)" />
        <g className="scatter-grid">
          {[0.25, 0.5, 0.75, 1].map((t, i) => (
            <line key={'x' + i} x1={padL + t * innerW} x2={padL + t * innerW} y1={padT} y2={padT + innerH} />
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
            <line key={'y' + i} x1={padL} x2={padL + innerW} y1={padT + t * innerH} y2={padT + t * innerH} />
          ))}
        </g>
        <line x1={x(xMidVal)} x2={x(xMidVal)} y1={padT} y2={padT + innerH} stroke="rgba(245,230,37,0.4)" strokeDasharray="4 3" strokeWidth="1.5" />
        <line x1={padL} x2={padL + innerW} y1={y(yMid)} y2={y(yMid)} stroke="rgba(245,230,37,0.4)" strokeDasharray="4 3" strokeWidth="1.5" />
        {/* Quadrant labels — all 4 visible (VIZ-07) */}
        <text x={padL + (x(xMidVal) - padL) / 2} y={padT + 16} textAnchor="middle" className="scatter-quadrant" style={{ fontSize: 10, fontWeight: 700 }}>HIGH ENG · SMALL REACH</text>
        <text x={x(xMidVal) + (padL + innerW - x(xMidVal)) / 2} y={padT + 16} textAnchor="middle" className="scatter-quadrant" style={{ fill: '#22c55e', fontSize: 10, fontWeight: 700 }}>HIGH VALUE</text>
        <text x={padL + (x(xMidVal) - padL) / 2} y={padT + innerH - 8} textAnchor="middle" className="scatter-quadrant" style={{ fontSize: 10, fontWeight: 700 }}>UNDERPERFORMING</text>
        <text x={x(xMidVal) + (padL + innerW - x(xMidVal)) / 2} y={padT + innerH - 8} textAnchor="middle" className="scatter-quadrant" style={{ fontSize: 10, fontWeight: 700 }}>BIG REACH · LOW ENG</text>
        {xTickVals.map((v, i) => (
          <text key={i} x={x(v)} y={h - 30} textAnchor="middle" className="scatter-axis">{fmt(v)}</text>
        ))}
        <text x={padL + innerW / 2} y={h - 12} textAnchor="middle" className="scatter-axis"
          style={{ fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>FOLLOWERS →</text>
        {yTickVals.map((v, i) => (
          <text key={i} x={padL - 8} y={y(v) + 3} textAnchor="end" className="scatter-axis">{v.toFixed(1)}%</text>
        ))}
        <text transform={`translate(14 ${padT + innerH / 2}) rotate(-90)`} textAnchor="middle" className="scatter-axis"
          style={{ fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>ENGAGEMENT →</text>
        {joola && (
          <>
            <line x1={x(joola.followers)} x2={x(joola.followers)} y1={padT} y2={padT + innerH} stroke="#22c55e" strokeOpacity="0.25" />
            <line x1={padL} x2={padL + innerW} y1={y(joola.engRate)} y2={y(joola.engRate)} stroke="#22c55e" strokeOpacity="0.25" />
          </>
        )}
        {data.map((d, i) => {
          const cx = x(d.followers)
          const cy = y(d.engRate)
          const isJ = d.brand === 'joola'
          const isHov = hover?.brand === d.brand
          const dotR = r(d.posts || 30)
          return (
            <g key={i} style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHover({ ...d, cx, cy })}
              onMouseLeave={() => setHover(null)}>
              <circle cx={cx} cy={cy} r={dotR + (isHov ? 10 : 5)} fill={d.color}
                opacity={isHov ? 0.22 : 0.10}
                style={{ transition: 'r 200ms, opacity 200ms' }} />
              <circle className="scatter-dot" cx={cx} cy={cy} r={isHov ? dotR + 3 : dotR}
                fill={d.color} opacity={isJ ? 1 : 0.85}
                stroke={isJ ? '#fff' : isHov ? '#fff' : 'rgba(0,0,0,0.4)'}
                strokeWidth={isJ ? 2.5 : isHov ? 2 : 1}
                style={{ filter: isHov ? `drop-shadow(0 0 10px ${d.color}cc)` : 'none', transition: 'r 200ms' }} />
              {(isJ || isHov) && (
                <text x={cx} y={cy - dotR - 8} textAnchor="middle" className="scatter-label"
                  style={{ fontWeight: 800, fill: isJ ? '#22c55e' : '#fff', fontSize: 11, pointerEvents: 'none' }}>
                  {d.name}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {hover && tipPos && (
        <div className="tip" style={{ left: tipPos.x, top: tipPos.y }}>
          <div className="t-name">{hover.name}</div>
          {fmt(hover.followers)} followers · {hover.engRate.toFixed(2)}% eng
        </div>
      )}
    </div>
  )
}

// ─── Engagement Quality Matrix (Instagram-tuned scatter) ──────────────
//
// Drop-in replacement for ScatterChart on the Instagram page. Key
// differences vs the generic ScatterChart:
//   • X axis auto-switches to log scale when >2 brands AND follower range
//     crosses ≥1 order of magnitude (fMax/fMin >= 10)
//   • Y axis uses raw min/max of ER values (no percentile clipping); floor 0;
//     ceiling Math.min(100, max + 20% headroom)
//   • Median crosshairs ONLY (dashed gray) — no JOOLA reference crosshairs.
//     JOOLA dot is enlarged with white stroke instead, so it still stands out
//   • All brand labels rendered (not hover-only) with iterative collision
//     repulsion (60 iters, 14px min gap)
//   • Tooltip carries followers / engagement rate / post count /
//     quadrant interpretation
export type EQMatrixDatum = {
  brand: string; name: string; followers: number; engRate: number;
  color: string; posts?: number
}

export function EngagementQualityMatrix({
  data, w = 760, h = 420,
}: { data: EQMatrixDatum[]; w?: number; h?: number }) {
  const padL = 64, padR = 36, padT = 32, padB = 60
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const [hover, setHover] = useState<EQMatrixDatum | null>(null)
  const [tipPos, setTipPos] = useState<{x:number,y:number}|null>(null)

  if (!data || data.length === 0) {
    return (
      <div className="scatter-wrap" style={{ height: h }}>
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)', fontSize: 13 }}>
          No engagement data available.
        </div>
      </div>
    )
  }

  // ── Axis math ─────────────────────────────────────────────────────
  const followers = data.map(d => d.followers).filter(v => v > 0).sort((a, b) => a - b)
  const engs = data.map(d => d.engRate).filter(v => isFinite(v)).sort((a, b) => a - b)
  const fMin = followers[0] || 1
  const fMax = followers[followers.length - 1] || 1
  // Log scale when there are >2 brands AND follower range crosses ≥1 order of magnitude
  const useLog = data.length > 2 && fMin > 0 && fMax / fMin >= 10
  const fMinScale = useLog ? Math.max(1, fMin / 1.2) : 0
  const fMaxScale = useLog ? fMax * 1.2 : fMax * 1.05

  const percentile = (arr: number[], p: number) => {
    if (!arr.length) return 0
    const idx = (arr.length - 1) * p
    const lo = Math.floor(idx), hi = Math.ceil(idx), t = idx - lo
    return arr[lo] + (arr[hi] - arr[lo]) * t
  }
  // Y axis: raw min/max (no percentile clipping). Floor 0, ceiling = min(100, max + 20% headroom).
  const eMaxRaw = engs.length ? engs[engs.length - 1] : 1
  const eMed = percentile(engs, 0.5)
  const eMin = 0
  const eMax = Math.min(100, eMaxRaw + Math.max(0.5, eMaxRaw * 0.2))
  const fMed = followers.length ? followers[Math.floor(followers.length / 2)] : 0

  const x = (v: number): number => {
    if (useLog) {
      const lv = Math.log10(Math.max(1, v))
      const lo = Math.log10(Math.max(1, fMinScale))
      const hi = Math.log10(fMaxScale)
      return padL + ((lv - lo) / (hi - lo)) * innerW
    }
    return padL + ((v - fMinScale) / (fMaxScale - fMinScale || 1)) * innerW
  }
  const y = (v: number): number => {
    const t = (v - eMin) / (eMax - eMin || 1)
    return padT + innerH - Math.min(1, Math.max(0, t)) * innerH
  }

  // ── X ticks: log-friendly when needed ─────────────────────────────
  const xTicks: number[] = (() => {
    if (useLog) {
      const lo = Math.log10(fMinScale), hi = Math.log10(fMaxScale)
      const out: number[] = []
      const step = Math.ceil((hi - lo) / 4)
      for (let p = Math.ceil(lo); p <= Math.floor(hi); p += step) {
        out.push(Math.pow(10, p))
      }
      return out.length ? out : [fMinScale, fMaxScale]
    }
    const step = (fMaxScale - fMinScale) / 4
    return [fMinScale + step, fMinScale + 2 * step, fMinScale + 3 * step, fMaxScale]
  })()
  const yTicks = [eMin + (eMax - eMin) * 0.25, eMin + (eMax - eMin) * 0.5, eMin + (eMax - eMin) * 0.75, eMax]

  // ── Label collision avoidance (iterative repulsion) ───────────────
  // 60 iterations, 14px minimum gap. JOOLA anchors at its dot; others nudge apart.
  type LabelPos = { brand: string; name: string; isJ: boolean; cx: number; cy: number; lx: number; ly: number }
  const labels: LabelPos[] = data.map(d => {
    const cx = x(d.followers), cy = y(d.engRate)
    return { brand: d.brand, name: d.name, isJ: d.brand === 'joola', cx, cy, lx: cx, ly: cy - 16 }
  })
  const MIN_GAP = 14, ITERS = 60
  for (let it = 0; it < ITERS; it++) {
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i], b = labels[j]
        const dx = a.lx - b.lx, dy = a.ly - b.ly
        const dist = Math.hypot(dx, dy) || 0.01
        if (dist < MIN_GAP) {
          const push = (MIN_GAP - dist) / 2
          const ux = dx / dist, uy = dy / dist
          if (!a.isJ) { a.lx += ux * push; a.ly += uy * push }
          if (!b.isJ) { b.lx -= ux * push; b.ly -= uy * push }
        }
      }
      // keep labels inside chart bounds
      const a = labels[i]
      a.lx = Math.max(padL + 4, Math.min(padL + innerW - 4, a.lx))
      a.ly = Math.max(padT + 10, Math.min(padT + innerH - 4, a.ly))
    }
  }

  // ── Quadrant interpretation for tooltip ───────────────────────────
  const quadrant = (d: EQMatrixDatum): string => {
    const right = d.followers >= fMed
    const top = d.engRate >= eMed
    if (right && top) return 'Top-right · winning reach and engagement'
    if (!right && top) return 'Top-left · niche but resonating'
    if (right && !top) return 'Bottom-right · big audience, low resonance'
    return 'Bottom-left · low reach, low engagement'
  }

  return (
    <div className="scatter-wrap" style={{ position: 'relative' }}
      onMouseMove={(e) => setTipPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => { setHover(null); setTipPos(null) }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
        {/* Quadrant backgrounds (faint) */}
        <rect x={padL} y={padT} width={x(fMed) - padL} height={y(eMed) - padT} fill="rgba(129,140,248,0.05)" />
        <rect x={x(fMed)} y={padT} width={padL + innerW - x(fMed)} height={y(eMed) - padT} fill="rgba(34,197,94,0.06)" />
        <rect x={padL} y={y(eMed)} width={x(fMed) - padL} height={padT + innerH - y(eMed)} fill="rgba(100,116,139,0.03)" />
        <rect x={x(fMed)} y={y(eMed)} width={padL + innerW - x(fMed)} height={padT + innerH - y(eMed)} fill="rgba(245,158,11,0.04)" />

        {/* Grid lines */}
        <g className="scatter-grid">
          {[0.25, 0.5, 0.75, 1].map((t, i) => (
            <line key={'gx' + i} x1={padL + t * innerW} x2={padL + t * innerW} y1={padT} y2={padT + innerH} />
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
            <line key={'gy' + i} x1={padL} x2={padL + innerW} y1={padT + t * innerH} y2={padT + t * innerH} />
          ))}
        </g>

        {/* Median crosshairs ONLY (subtle gray) — no JOOLA reference crosshairs.
            JOOLA gets a larger, white-stroked dot below so it still stands out. */}
        <line x1={x(fMed)} x2={x(fMed)} y1={padT} y2={padT + innerH}
          stroke="rgba(148,163,184,0.55)" strokeDasharray="4 4" strokeWidth="1" />
        <line x1={padL} x2={padL + innerW} y1={y(eMed)} y2={y(eMed)}
          stroke="rgba(148,163,184,0.55)" strokeDasharray="4 4" strokeWidth="1" />

        {/* Quadrant labels — corners with backing rects */}
        {[
          { txt: 'LOW REACH · HIGH ENGAGEMENT', cx: padL + 4, cy: padT + 6, anchor: 'start' as const, color: '#a1a1aa' },
          { txt: 'HIGH REACH · HIGH ENGAGEMENT', cx: padL + innerW - 4, cy: padT + 6, anchor: 'end' as const, color: '#22c55e' },
          { txt: 'LOW REACH · LOW ENGAGEMENT', cx: padL + 4, cy: padT + innerH - 6, anchor: 'start' as const, color: '#71717a' },
          { txt: 'HIGH REACH · LOW ENGAGEMENT', cx: padL + innerW - 4, cy: padT + innerH - 6, anchor: 'end' as const, color: '#a1a1aa' },
        ].map((q, i) => {
          const textW = q.txt.length * 5.5
          const rectX = q.anchor === 'start' ? q.cx - 2 : q.cx - textW - 2
          return (
            <g key={i}>
              <rect x={rectX} y={q.cy - 9} width={textW + 4} height={12} fill="rgba(7,9,14,0.78)" rx="2" />
              <text x={q.cx} y={q.cy} textAnchor={q.anchor} className="scatter-quadrant"
                style={{ fontSize: 9, fontWeight: 700, fill: q.color, letterSpacing: '0.08em' }}>{q.txt}</text>
            </g>
          )
        })}

        {/* X axis ticks */}
        {xTicks.map((v, i) => (
          <text key={'xt' + i} x={x(v)} y={h - 32} textAnchor="middle" className="scatter-axis">
            {fmt(v)}
          </text>
        ))}
        <text x={padL + innerW / 2} y={h - 14} textAnchor="middle" className="scatter-axis"
          style={{ fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          {useLog ? 'Followers (log) →' : 'Followers →'}
        </text>

        {/* Y axis ticks */}
        {yTicks.map((v, i) => (
          <text key={'yt' + i} x={padL - 8} y={y(v) + 3} textAnchor="end" className="scatter-axis">
            {v.toFixed(2)}%
          </text>
        ))}
        <text transform={`translate(16 ${padT + innerH / 2}) rotate(-90)`} textAnchor="middle" className="scatter-axis"
          style={{ fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Engagement Rate (%) →
        </text>

        {/* Dots — JOOLA slightly larger (10px) with thick white stroke since
            we no longer draw JOOLA crosshairs. */}
        {data.map((d, i) => {
          const cx = x(d.followers), cy = y(d.engRate)
          const isJ = d.brand === 'joola'
          const isHov = hover?.brand === d.brand
          const dotR = isJ ? 10 : 7
          return (
            <g key={i} style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHover(d)}
              onMouseLeave={() => setHover(null)}>
              <circle cx={cx} cy={cy} r={dotR + (isHov ? 8 : 4)} fill={d.color}
                opacity={isHov ? 0.24 : 0.10} />
              <circle cx={cx} cy={cy} r={isHov ? dotR + 2 : dotR}
                fill={d.color} opacity={isJ ? 1 : 0.9}
                stroke={isJ ? '#fff' : isHov ? '#fff' : 'rgba(0,0,0,0.45)'}
                strokeWidth={isJ ? 3 : isHov ? 2 : 1.2}
                style={{ filter: isHov || isJ ? `drop-shadow(0 0 8px ${d.color}99)` : 'none' }} />
            </g>
          )
        })}

        {/* Labels — ALL brand labels always visible (iterative repulsion
            keeps them readable). Hovered label highlights brighter; connector
            line drawn when label was displaced from its dot. */}
        {labels.map((lab, i) => {
          const isHov = hover?.brand === lab.brand
          const moved = Math.hypot(lab.lx - lab.cx, lab.ly - (lab.cy - 16)) > 4
          return (
            <g key={'lb' + i} style={{ pointerEvents: 'none' }}>
              {moved && (
                <line x1={lab.cx} y1={lab.cy - 6} x2={lab.lx} y2={lab.ly + 2}
                  stroke={lab.isJ ? '#22c55e' : 'rgba(255,255,255,0.4)'} strokeWidth="0.8" />
              )}
              <text x={lab.lx} y={lab.ly} textAnchor="middle" className="scatter-label"
                style={{
                  fontWeight: lab.isJ || isHov ? 800 : 600,
                  fontSize: lab.isJ || isHov ? 11 : 10,
                  fill: lab.isJ ? '#22c55e' : isHov ? '#fff' : '#cbd1dc',
                  paintOrder: 'stroke', stroke: 'rgba(7,9,14,0.92)', strokeWidth: 3,
                }}>{lab.name}</text>
            </g>
          )
        })}
      </svg>

      {hover && tipPos && (
        <div className="tip" style={{ left: tipPos.x, top: tipPos.y, whiteSpace: 'nowrap' }}>
          <div className="t-name" style={{ color: hover.color }}>{hover.name}</div>
          <div>{fmt(hover.followers)} followers · {hover.engRate.toFixed(2)}% eng</div>
          <div style={{ fontSize: 10, color: 'var(--fg-4)' }}>
            {hover.posts ?? 0} posts sampled
          </div>
          <div style={{ fontSize: 10, color: 'var(--fg-4)', marginTop: 2 }}>
            {quadrant(hover)}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Donut ───────────────────────────────────────────────────────────
function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const x1 = cx + r * Math.cos(startAngle)
  const y1 = cy + r * Math.sin(startAngle)
  const x2 = cx + r * Math.cos(endAngle)
  const y2 = cy + r * Math.sin(endAngle)
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`
}

export function Donut({ data, size = 200, thickness = 36, centerLabel, centerSub }: {
  data: { value: number; color: string; name: string }[]
  size?: number; thickness?: number; centerLabel?: string; centerSub?: string
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [tipPos, setTipPos] = useState<{x:number,y:number}|null>(null)
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  const r = size / 2 - thickness / 2 - 2
  const cx = size / 2, cy = size / 2
  let start = -Math.PI / 2
  const arcs = data.map((d) => {
    const angle = (d.value / total) * Math.PI * 2
    const end = start + angle
    const a = describeArc(cx, cy, r, start, end)
    start = end
    return { d: a, color: d.color, name: d.name, value: d.value }
  })
  const hoveredArc = hovered !== null ? arcs[hovered] : null
  const displayLabel = hoveredArc ? fmt(hoveredArc.value) : centerLabel
  const displaySub = hoveredArc ? hoveredArc.name : centerSub
  const displayColor = hoveredArc?.color || '#fff'
  const pct = hoveredArc ? Math.round((hoveredArc.value / total) * 100) : null
  return (
    <div className="scatter-wrap" style={{ width: size, height: size, position: 'relative' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        onMouseMove={(e) => setTipPos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setTipPos(null)}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={thickness} />
        {arcs.map((a, i) => (
          <path
            key={i}
            d={a.d}
            fill="none"
            stroke={a.color}
            strokeWidth={hovered === i ? thickness + 10 : thickness}
            strokeLinecap="butt"
            style={{
              cursor: 'pointer',
              transition: 'stroke-width 200ms ease, opacity 200ms ease, filter 200ms ease',
              filter: hovered === i ? `drop-shadow(0 0 10px ${a.color}99)` : 'none',
              opacity: hovered !== null && hovered !== i ? 0.45 : 1,
            }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <title>{a.name}: {a.value} ({Math.round((a.value / total) * 100)}%)</title>
          </path>
        ))}
        {(centerLabel || hovered !== null) && (
          <g>
            <text x={cx} y={cy - 2} textAnchor="middle"
              style={{ fontSize: 22, fontWeight: 800, fill: displayColor, fontFamily: 'Archivo Black', transition: 'fill 200ms' }}>
              {displayLabel}
            </text>
            <text x={cx} y={cy + 14} textAnchor="middle"
              style={{ fontSize: 9, fill: '#8a93a4', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              {displaySub}
            </text>
          </g>
        )}
      </svg>
      {hoveredArc && pct !== null && tipPos && (
        <div className="tip" style={{ left: tipPos.x, top: tipPos.y, whiteSpace: 'nowrap' }}>
          <div className="t-name" style={{ color: hoveredArc.color }}>{hoveredArc.name}</div>
          {hoveredArc.value} ads · {pct}%
        </div>
      )}
    </div>
  )
}

// ─── Box plot (price distribution per brand) ─────────────────────────
export type BoxPlotDatum = { brand: string; name: string; color: string; min: number; med: number; max: number; avg: number; count: number }

export function BoxPlot({ data, w = 760, h = 280 }: { data: BoxPlotDatum[]; w?: number; h?: number }) {
  const [hov, setHov] = useState<number | null>(null)
  const [tipPos, setTipPos] = useState<{x:number,y:number}|null>(null)
  if (!data.length) return null
  // VIZ-22: increase padR so "avg $X · N items" labels don't clip
  const padL = 148, padR = 120, padT = 20, padB = 36
  const innerH = h - padT - padB
  const innerW = w - padL - padR
  const rowH = innerH / data.length
  const maxVal = Math.max(...data.map(d => d.max), 1)
  const x = (v: number) => padL + (v / maxVal) * innerW
  const xTicks = [0, 50, 100, 150, 200, 250, 300].filter(t => t <= maxVal * 1.1)
  const hovD = hov !== null ? data[hov] : null

  return (
    <div className="scatter-wrap" style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} style={{ overflow: 'visible' }}
        onMouseMove={(e) => setTipPos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => { setHov(null); setTipPos(null) }}>
        {xTicks.map((v, i) => (
          <g key={i}>
            <line x1={x(v)} x2={x(v)} y1={padT} y2={padT + innerH} stroke="rgba(255,255,255,0.04)" />
            <text x={x(v)} y={h - 12} textAnchor="middle" className="scatter-axis">${v}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const y = padT + i * rowH + rowH / 2
          const isJ = d.brand === 'joola'
          const isHov = hov === i
          return (
            <g key={i} style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHov(i)}
              onMouseLeave={() => setHov(null)}>
              {/* invisible hit area covering the row */}
              <rect x={padL} y={y - rowH / 2 + 2} width={innerW} height={rowH - 4} fill="transparent" />
              <text x={padL - 10} y={y + 3} textAnchor="end" className="scatter-label"
                style={{ fill: isJ ? '#22c55e' : '#e2e8f0', fontWeight: isJ ? 800 : 600, fontSize: 11 }}>{d.name}</text>
              <line x1={x(d.min)} x2={x(d.max)} y1={y} y2={y} stroke={d.color}
                strokeOpacity={isHov ? 0.7 : 0.4} strokeWidth={isHov ? 2 : 1} />
              <line x1={x(d.min)} x2={x(d.min)} y1={y - 6} y2={y + 6} stroke={d.color} strokeOpacity="0.6" />
              <line x1={x(d.max)} x2={x(d.max)} y1={y - 6} y2={y + 6} stroke={d.color} strokeOpacity="0.6" />
              <rect x={x(d.avg * 0.85)} y={y - 9} width={Math.max(2, x(d.avg * 1.15) - x(d.avg * 0.85))} height={18}
                fill={d.color} opacity={isJ ? 0.75 : isHov ? 0.55 : 0.3}
                stroke={d.color} strokeWidth={isHov ? 1.5 : 1}
                style={{ transition: 'opacity 140ms' }} />
              <line x1={x(d.med)} x2={x(d.med)} y1={y - 11} y2={y + 11} stroke={d.color} strokeWidth="2" />
              <text x={x(d.max) + 8} y={y + 3} className="scatter-label" style={{ fontSize: 10, fill: '#cbd1dc' }}>
                avg ${d.avg} · {d.count}
              </text>
            </g>
          )
        })}
        <text x={padL + innerW / 2} y={h - 2} textAnchor="middle" className="scatter-axis"
          style={{ fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          PRICE ($) · low → high
        </text>
      </svg>
      {/* VIZ-11: hover tooltip with full stats */}
      {hovD && hov !== null && tipPos && (
        <div className="tip" style={{ left: tipPos.x, top: tipPos.y, whiteSpace: 'nowrap' }}>
          <div className="t-name" style={{ color: hovD.color }}>{hovD.name}</div>
          Min ${hovD.min} · Med ${hovD.med} · Avg ${hovD.avg} · Max ${hovD.max}
          <div style={{ fontSize: 10, color: '#8a93a4', marginTop: 2 }}>{hovD.count} items</div>
        </div>
      )}
    </div>
  )
}

// ─── Sentiment bar (Reddit) ──────────────────────────────────────────
export function SentimentBar({ data }: {
  data: { name: string; brand: string; color?: string; positive: number; neutral: number; negative: number; mentions: number; delta: number | null }[]
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.map((d, i) => {
        const total = d.positive + d.neutral + d.negative || 1
        const isJ = d.brand === 'joola'
        const posPct = Math.round((d.positive / total) * 100)
        const neuPct = Math.round((d.neutral / total) * 100)
        const negPct = Math.round((d.negative / total) * 100)
        return (
          <div key={i}
            className="sent-row"
            title={`${d.name} · ${d.mentions} mentions · ${posPct}% positive · ${neuPct}% neutral · ${negPct}% negative`}
            style={{ display: 'grid', gridTemplateColumns: '100px 1fr 80px 60px', gap: 10, alignItems: 'center' }}>
            <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: isJ ? '#22c55e' : '#cbd1dc' }}>{d.name}</div>
            <div style={{ display: 'flex', height: 20, borderRadius: 3, overflow: 'hidden', background: 'rgba(255,255,255,0.03)' }}>
              <div style={{ width: (d.positive / total) * 100 + '%', background: '#22c55e', opacity: 0.9 }} title={`Positive: ${d.positive}`} />
              {/* VIZ-25: use neutral gray for the neutral band so it never collides with the green=positive convention */}
              <div style={{ width: (d.neutral / total) * 100 + '%', background: '#94a3b8', opacity: 0.5 }} title={`Neutral: ${d.neutral}`} />
              <div style={{ width: (d.negative / total) * 100 + '%', background: '#ef4444', opacity: 0.9 }} title={`Negative: ${d.negative}`} />
            </div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: '#cbd1dc', fontWeight: 600 }}>{d.mentions} mentions</div>
            <div className={'cell-delta ' + ((d.delta || 0) >= 0 ? 'up' : 'down')} style={{ textAlign: 'right' }}>
              {d.delta == null ? '—' : (d.delta >= 0 ? '▲' : '▼') + Math.abs(d.delta)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
