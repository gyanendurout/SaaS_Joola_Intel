'use client'

import { useState } from 'react'
import { fmt } from '@/components/v2/charts'

export interface SeriesPoint {
  date: string
  value: number
}

export interface Changepoint {
  date: string
  magnitude?: number
}

interface ChangepointTimelineProps {
  series: SeriesPoint[]
  changepoints: Changepoint[]
  seriesLabel: string
  width?: number
  height?: number
  smoothing?: number
  interpretation?: string
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${m}-${day}`
}

export function ChangepointTimeline({
  series,
  changepoints,
  seriesLabel,
  width = 720,
  height = 240,
  smoothing,
  interpretation,
}: ChangepointTimelineProps) {
  const [hovIdx, setHovIdx] = useState<number | null>(null)
  const [hovCp, setHovCp] = useState<number | null>(null)

  if (!series.length) {
    return (
      <div style={{ padding: 40, color: '#6b7280', fontSize: 12, textAlign: 'center' }}>
        No timeseries data available.
      </div>
    )
  }

  const padL = 48
  const padR = 24
  const padT = 24
  const padB = 36
  const innerW = width - padL - padR
  const innerH = height - padT - padB

  const N = series.length
  const yMax = Math.max(...series.map((p) => (isFinite(p.value) ? p.value : 0))) || 1
  const x = (i: number) => padL + (i / Math.max(1, N - 1)) * innerW
  const y = (v: number) => (isFinite(v) ? padT + innerH - (Math.max(0, v) / yMax) * innerH : padT + innerH)

  const path = series.map((p, i) => (i === 0 ? 'M' : 'L') + x(i) + ',' + y(p.value)).join(' ')

  // Map changepoint dates → series index
  const dateToIdx = new Map<string, number>()
  series.forEach((p, i) => dateToIdx.set(p.date, i))
  const cpResolved = changepoints
    .map((cp) => ({ ...cp, idx: dateToIdx.get(cp.date) }))
    .filter((cp): cp is Changepoint & { idx: number } => cp.idx !== undefined)

  const yTicks = 4
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => (yMax / yTicks) * i)

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const scaleX = width / rect.width
    const localX = (e.clientX - rect.left) * scaleX
    if (localX < padL || localX > padL + innerW) {
      setHovIdx(null)
      return
    }
    const i = Math.round(((localX - padL) / innerW) * (N - 1))
    setHovIdx(Math.max(0, Math.min(N - 1, i)))
  }

  const hovPoint = hovIdx !== null ? series[hovIdx] : null
  const hovCpData = hovCp !== null ? cpResolved[hovCp] : null

  return (
    <div className="scatter-wrap changepoint-timeline" style={{ position: 'relative' }}>
      {interpretation && <div className="viz-note">{interpretation}</div>}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`Timeseries of ${seriesLabel} with changepoint markers`}
        style={{ overflow: 'visible', display: 'block' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHovIdx(null)}
      >
        {/* Y grid */}
        {ticks.map((t, i) => (
          <g key={`yt-${i}`}>
            <line x1={padL} x2={padL + innerW} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.04)" />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="scatter-axis">
              {fmt(t)}
            </text>
          </g>
        ))}

        {/* X labels — first, mid, last + evenly spaced */}
        {[0, Math.floor(N / 4), Math.floor(N / 2), Math.floor((3 * N) / 4), N - 1].map((i) => (
          <text key={`xt-${i}`} x={x(i)} y={height - 12} textAnchor="middle" className="scatter-axis">
            {shortDate(series[i].date)}
          </text>
        ))}

        {/* Changepoint vertical lines */}
        {cpResolved.map((cp, ci) => (
          <g
            key={`cp-${ci}`}
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHovCp(ci)}
            onMouseLeave={() => setHovCp(null)}
          >
            <line
              x1={x(cp.idx)}
              x2={x(cp.idx)}
              y1={padT}
              y2={padT + innerH}
              stroke="#f59e0b"
              strokeWidth={hovCp === ci ? 2 : 1.4}
              strokeDasharray="5 4"
              className="changepoint-line"
            />
            {/* hit area + top marker */}
            <rect
              x={x(cp.idx) - 8}
              y={padT}
              width={16}
              height={innerH}
              fill="transparent"
            />
            <circle cx={x(cp.idx)} cy={padT - 4} r={hovCp === ci ? 5 : 4} fill="#f59e0b" />
          </g>
        ))}

        {/* Series path */}
        <path d={path} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinejoin="round" />

        {/* Hovered point marker */}
        {hovPoint && hovIdx !== null && (
          <>
            <line
              x1={x(hovIdx)}
              x2={x(hovIdx)}
              y1={padT}
              y2={padT + innerH}
              stroke="rgba(245,230,37,0.35)"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
            <circle cx={x(hovIdx)} cy={y(hovPoint.value)} r="4" fill="#22c55e" stroke="#fff" strokeWidth="1.5" />
          </>
        )}

        {/* Smoothing annotation */}
        {smoothing && smoothing > 1 && (
          <text x={width - padR} y={padT - 8} textAnchor="end" className="scatter-axis" style={{ fontStyle: 'italic', fill: '#8a93a4' }}>
            {smoothing}-day smoothing applied
          </text>
        )}

        {/* Series label */}
        <text x={padL} y={padT - 8} className="scatter-axis" style={{ fontWeight: 700, fill: '#e2e8f0' }}>
          {seriesLabel}
        </text>
      </svg>

      {/* Changepoint tooltip takes precedence */}
      {hovCpData && (
        <div
          className="tip"
          style={{
            left: (x(hovCpData.idx) / width) * 100 + '%',
            top: (padT / height) * 100 + '%',
            transform: 'translate(-50%, -120%)',
            whiteSpace: 'nowrap',
          }}
        >
          <div className="t-name" style={{ color: '#f59e0b' }}>Changepoint</div>
          <div style={{ fontSize: 11, color: '#fff' }}>{hovCpData.date}</div>
          {hovCpData.magnitude !== undefined && (
            <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#cbd1dc' }}>
              magnitude: {hovCpData.magnitude.toFixed(2)}
            </div>
          )}
        </div>
      )}
      {!hovCpData && hovPoint && hovIdx !== null && (
        <div
          className="tip"
          style={{
            left: (x(hovIdx) / width) * 100 + '%',
            top: (y(hovPoint.value) / height) * 100 + '%',
            transform: 'translate(-50%, -110%)',
            whiteSpace: 'nowrap',
          }}
        >
          <div className="t-name">{hovPoint.date}</div>
          <div style={{ fontSize: 11, color: '#fff' }}>
            {seriesLabel}: <span style={{ fontFamily: 'monospace', color: '#22c55e' }}>{fmt(hovPoint.value)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default ChangepointTimeline
