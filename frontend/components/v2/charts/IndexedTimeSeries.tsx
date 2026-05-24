'use client'

import { useState, useMemo } from 'react'

export interface IndexedSeriesPoint {
  date: string
  value: number
}

export interface IndexedSeries {
  label: string
  color: string
  points: IndexedSeriesPoint[]
}

export type EventType = 'promo' | 'ad-burst' | 'video' | 'changepoint'

export interface TimelineEvent {
  date: string
  type: EventType
  label: string
}

interface IndexedTimeSeriesProps {
  series: IndexedSeries[]
  baseDate?: string
  events?: TimelineEvent[]
  width?: number
  height?: number
  interpretation?: string
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${m}-${day}`
}

export function IndexedTimeSeries({
  series,
  baseDate,
  events = [],
  width = 720,
  height = 320,
  interpretation,
}: IndexedTimeSeriesProps) {
  const [hovIdx, setHovIdx] = useState<number | null>(null)

  // Build union of dates (sorted) across all series
  const allDates = useMemo(() => {
    const set = new Set<string>()
    series.forEach((s) => s.points.forEach((p) => set.add(p.date)))
    return Array.from(set).sort()
  }, [series])

  // Resolve baseDate (default: first date in union)
  const base = baseDate && allDates.includes(baseDate) ? baseDate : allDates[0]

  // Re-index each series to baseDate=100; align values to allDates
  const indexed = useMemo(() => {
    return series.map((s) => {
      const byDate = new Map(s.points.map((p) => [p.date, p.value]))
      const baseVal = byDate.get(base) ?? s.points[0]?.value ?? 0
      const safeBase = baseVal === 0 || !isFinite(baseVal) ? 1 : baseVal
      const values = allDates.map((d) => {
        const v = byDate.get(d)
        return v !== undefined && isFinite(v) ? (v / safeBase) * 100 : null
      })
      return { ...s, values }
    })
  }, [series, allDates, base])

  if (!allDates.length || !indexed.length) {
    return (
      <div style={{ padding: 40, color: '#6b7280', fontSize: 12, textAlign: 'center' }}>
        No timeseries data available.
      </div>
    )
  }

  const legendH = 30
  const padL = 48
  const padR = 24
  const padT = legendH + 18
  const padB = 40
  const innerW = width - padL - padR
  const innerH = height - padT - padB

  const N = allDates.length
  const allVals = indexed.flatMap((s) => s.values.filter((v): v is number => v !== null))
  const yMin = Math.min(60, ...allVals)
  const yMax = Math.max(140, ...allVals)
  const yRange = yMax - yMin || 1

  const x = (i: number) => padL + (i / Math.max(1, N - 1)) * innerW
  const y = (v: number) => padT + innerH - ((v - yMin) / yRange) * innerH

  const yTicks = [yMin, 100, yMax]
  // Insert quarters between
  const allYTicks = [yMin, yMin + yRange * 0.25, 100, yMin + yRange * 0.75, yMax]

  const dateToIdx = new Map<string, number>()
  allDates.forEach((d, i) => dateToIdx.set(d, i))

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

  // Group promo events into contiguous bands (same date treated singly)
  const promoEvents = events.filter((e) => e.type === 'promo')
  const adBurstEvents = events.filter((e) => e.type === 'ad-burst')
  const videoEvents = events.filter((e) => e.type === 'video')
  const cpEvents = events.filter((e) => e.type === 'changepoint')

  const hovDate = hovIdx !== null ? allDates[hovIdx] : null
  const hovEvents = hovDate ? events.filter((e) => e.date === hovDate) : []

  return (
    <div className="scatter-wrap indexed-series" style={{ position: 'relative' }}>
      {interpretation && <div className="viz-note">{interpretation}</div>}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Indexed timeseries with event annotations"
        style={{ overflow: 'visible', display: 'block' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHovIdx(null)}
      >
        {/* Legend */}
        <g transform={`translate(${padL}, 14)`}>
          {indexed.map((s, i) => {
            const colW = Math.min(140, innerW / Math.max(1, indexed.length))
            const xOff = i * colW
            return (
              <g key={s.label} transform={`translate(${xOff}, 0)`}>
                <rect x="0" y="-6" width="12" height="12" fill={s.color} rx="2" />
                <text
                  x="18"
                  y="3"
                  className="scatter-axis"
                  style={{ fontWeight: 700, fill: '#cbd1dc', fontSize: 11 }}
                >
                  {s.label}
                </text>
              </g>
            )
          })}
        </g>

        {/* Promo bands */}
        {promoEvents.map((ev, i) => {
          const idx = dateToIdx.get(ev.date)
          if (idx === undefined) return null
          const xCenter = x(idx)
          const bandW = innerW / Math.max(1, N - 1)
          return (
            <rect
              key={`promo-${i}`}
              x={xCenter - bandW / 2}
              y={padT}
              width={bandW}
              height={innerH}
              fill="#ec4899"
              opacity="0.18"
            >
              <title>Promo: {ev.label}</title>
            </rect>
          )
        })}

        {/* Changepoint dashed verticals */}
        {cpEvents.map((ev, i) => {
          const idx = dateToIdx.get(ev.date)
          if (idx === undefined) return null
          return (
            <line
              key={`cp-${i}`}
              x1={x(idx)}
              x2={x(idx)}
              y1={padT}
              y2={padT + innerH}
              stroke="#f59e0b"
              strokeWidth="1.5"
              strokeDasharray="5 4"
            >
              <title>Changepoint: {ev.label}</title>
            </line>
          )
        })}

        {/* Y grid + ticks */}
        {allYTicks.map((t, i) => (
          <g key={`yt-${i}`}>
            <line
              x1={padL}
              x2={padL + innerW}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 100 ? 'rgba(245,230,37,0.3)' : 'rgba(255,255,255,0.04)'}
              strokeDasharray={t === 100 ? '4 3' : undefined}
            />
            <text
              x={padL - 6}
              y={y(t) + 3}
              textAnchor="end"
              className="scatter-axis"
              style={{ fontWeight: t === 100 ? 800 : 500, fill: t === 100 ? '#F5E625' : '#8a93a4' }}
            >
              {Math.round(t)}
            </text>
          </g>
        ))}

        {/* X labels — 5 evenly spaced */}
        {[0, Math.floor(N / 4), Math.floor(N / 2), Math.floor((3 * N) / 4), N - 1].map((i) => (
          <text key={`xt-${i}`} x={x(i)} y={height - 18} textAnchor="middle" className="scatter-axis">
            {shortDate(allDates[i])}
          </text>
        ))}
        <text
          x={padL + innerW / 2}
          y={height - 4}
          textAnchor="middle"
          className="scatter-axis"
          style={{ fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}
        >
          Date · base = {shortDate(base)} = 100
        </text>

        {/* Series lines */}
        {indexed.map((s) => {
          // Build path skipping nulls
          let path = ''
          let started = false
          s.values.forEach((v, i) => {
            if (v === null || !isFinite(v)) {
              started = false
              return
            }
            path += (started ? 'L' : 'M') + x(i) + ',' + y(v) + ' '
            started = true
          })
          return (
            <path
              key={s.label}
              d={path.trim()}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
            />
          )
        })}

        {/* Ad-burst circle markers above chart */}
        {adBurstEvents.map((ev, i) => {
          const idx = dateToIdx.get(ev.date)
          if (idx === undefined) return null
          return (
            <circle key={`ad-${i}`} cx={x(idx)} cy={padT - 12} r="4" fill="#60a5fa" stroke="#fff" strokeWidth="1">
              <title>Ad burst: {ev.label}</title>
            </circle>
          )
        })}

        {/* Video triangle markers */}
        {videoEvents.map((ev, i) => {
          const idx = dateToIdx.get(ev.date)
          if (idx === undefined) return null
          const cx = x(idx)
          const cy = padT - 12
          const path = `M ${cx} ${cy - 5} L ${cx - 5} ${cy + 4} L ${cx + 5} ${cy + 4} Z`
          return (
            <path key={`vid-${i}`} d={path} fill="#a78bfa" stroke="#fff" strokeWidth="1">
              <title>Video: {ev.label}</title>
            </path>
          )
        })}

        {/* Crosshair */}
        {hovIdx !== null && (
          <line
            x1={x(hovIdx)}
            x2={x(hovIdx)}
            y1={padT}
            y2={padT + innerH}
            stroke="rgba(245,230,37,0.35)"
            strokeDasharray="3 3"
            strokeWidth="1"
          />
        )}
      </svg>

      {hovIdx !== null && hovDate && (
        <div
          className="tip"
          style={{
            left: (x(hovIdx) / width) * 100 + '%',
            top: (padT / height) * 100 + '%',
            transform: 'translate(-50%, -100%)',
            whiteSpace: 'nowrap',
          }}
        >
          <div className="t-name">{hovDate}</div>
          {indexed.map((s) => {
            const v = s.values[hovIdx]
            return (
              <div
                key={s.label}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 10.5 }}
              >
                <span style={{ color: s.color, fontWeight: 700 }}>● {s.label}</span>
                <span style={{ color: '#fff', fontFamily: 'monospace' }}>
                  {v === null || !isFinite(v) ? '—' : v.toFixed(1)}
                </span>
              </div>
            )
          })}
          {hovEvents.length > 0 && (
            <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              {hovEvents.map((ev, i) => (
                <div key={i} style={{ fontSize: 10, color: '#cbd1dc' }}>
                  <span style={{ color: ev.type === 'promo' ? '#ec4899' : ev.type === 'ad-burst' ? '#60a5fa' : ev.type === 'video' ? '#a78bfa' : '#f59e0b' }}>●</span>{' '}
                  {ev.type}: {ev.label}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default IndexedTimeSeries
