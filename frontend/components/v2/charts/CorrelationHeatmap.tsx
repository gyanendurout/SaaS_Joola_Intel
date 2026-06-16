'use client'

import { useState } from 'react'

export interface CorrelationCell {
  driver: string
  lag: number
  correlation: number
  pValue: number
  n: number
}

interface CorrelationHeatmapProps {
  data: CorrelationCell[]
  targetLabel: string
  width?: number
  height?: number
  interpretation?: string
}

// Diverging color: red (-1) → black (0) → green (+1)
function corrColor(r: number): string {
  if (!isFinite(r)) return '#222'
  const v = Math.max(-1, Math.min(1, r))
  if (v >= 0) {
    // black → green
    const g = Math.round(40 + v * 197)
    const rC = Math.round(20 + v * 14)
    const b = Math.round(28 + v * 16)
    return `rgb(${rC},${g},${b})`
  }
  // black → red
  const abs = Math.abs(v)
  const rC = Math.round(40 + abs * 199)
  const g = Math.round(28 + abs * 40)
  const b = Math.round(28 + abs * 40)
  return `rgb(${rC},${g},${b})`
}

export function CorrelationHeatmap({
  data,
  targetLabel,
  width = 720,
  height = 400,
  interpretation,
}: CorrelationHeatmapProps) {
  const [hov, setHov] = useState<CorrelationCell | null>(null)
  const [hovPos, setHovPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  const drivers = Array.from(new Set(data.map((d) => d.driver)))
  const lags = Array.from(new Set(data.map((d) => d.lag))).sort((a, b) => a - b)
  if (!drivers.length || !lags.length) {
    return (
      <div style={{ padding: 40, color: '#6b7280', fontSize: 12, textAlign: 'center' }}>
        No correlation data available.
      </div>
    )
  }

  const padL = 140
  const padR = 20
  const padT = 36
  const padB = 56
  const innerW = width - padL - padR
  const innerH = height - padT - padB
  const cellW = innerW / lags.length
  const cellH = innerH / drivers.length

  const cellAt = (driver: string, lag: number) =>
    data.find((d) => d.driver === driver && d.lag === lag) || null

  return (
    <div className="scatter-wrap heatmap-wrap" style={{ position: 'relative' }}>
      {interpretation && <div className="viz-note">{interpretation}</div>}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`Correlation heatmap of drivers versus ${targetLabel} across lags`}
        style={{ overflow: 'visible', display: 'block' }}
      >
        <text x={padL} y={18} className="scatter-label" style={{ fontSize: 12, fontWeight: 800, fill: '#e2e8f0' }}>
          Correlation with {targetLabel}
        </text>

        {/* x-axis lag labels — label every 7 days, tick all */}
        {lags.map((lag, i) => {
          const x = padL + i * cellW + cellW / 2
          const labeled = lag % 7 === 0
          return (
            <g key={`lag-${lag}`}>
              <line
                x1={x}
                x2={x}
                y1={padT + innerH}
                y2={padT + innerH + (labeled ? 6 : 3)}
                stroke="rgba(255,255,255,0.25)"
                strokeWidth={labeled ? 1 : 0.5}
              />
              {labeled && (
                <text
                  x={x}
                  y={padT + innerH + 18}
                  textAnchor="middle"
                  className="scatter-axis"
                  style={{ fontWeight: lag === 0 ? 800 : 600, fill: lag === 0 ? '#F5E625' : '#8a93a4' }}
                >
                  {lag > 0 ? `+${lag}` : lag}
                </text>
              )}
            </g>
          )
        })}
        <text
          x={padL + innerW / 2}
          y={height - 8}
          textAnchor="middle"
          className="scatter-axis"
          style={{ fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}
        >
          Lag (days) · driver leads →
        </text>

        {/* y-axis driver labels */}
        {drivers.map((driver, di) => {
          const y = padT + di * cellH + cellH / 2
          return (
            <text
              key={`driver-${driver}`}
              x={padL - 8}
              y={y + 3}
              textAnchor="end"
              className="scatter-label"
              style={{ fontSize: 11, fontWeight: 600, fill: '#cbd1dc' }}
            >
              {driver}
            </text>
          )
        })}

        {/* cells */}
        {drivers.map((driver, di) =>
          lags.map((lag, li) => {
            const cell = cellAt(driver, lag)
            const x = padL + li * cellW
            const y = padT + di * cellH
            if (!cell) {
              return (
                <rect
                  key={`empty-${driver}-${lag}`}
                  x={x}
                  y={y}
                  width={cellW}
                  height={cellH}
                  fill="rgba(255,255,255,0.02)"
                  stroke="var(--line-2)"
                />
              )
            }
            const isSig = cell.pValue < 0.05
            const isHov = hov === cell
            return (
              <rect
                key={`cell-${driver}-${lag}`}
                className="heatmap-cell"
                x={x + 0.5}
                y={y + 0.5}
                width={Math.max(0, cellW - 1)}
                height={Math.max(0, cellH - 1)}
                fill={corrColor(cell.correlation)}
                stroke={isSig ? '#F5E625' : 'var(--wb-6)'}
                strokeWidth={isSig ? (isHov ? 2 : 1.4) : isHov ? 1.5 : 0.5}
                opacity={hov && hov !== cell ? 0.55 : 1}
                style={{ cursor: 'pointer', transition: 'opacity 140ms, stroke-width 140ms' }}
                onMouseEnter={(e) => {
                  setHov(cell)
                  const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                  setHovPos({
                    x: ((x + cellW / 2) / width) * 100,
                    y: ((y + cellH / 2) / height) * 100,
                  })
                  void rect
                }}
                onMouseLeave={() => setHov(null)}
              />
            )
          })
        )}
      </svg>

      {hov && (
        <div
          className="tip"
          style={{
            left: hovPos.x + '%',
            top: hovPos.y + '%',
            transform: 'translate(-50%, -110%)',
            whiteSpace: 'nowrap',
          }}
        >
          <div className="t-name">{hov.driver}</div>
          <div style={{ fontSize: 11, color: '#fff' }}>
            Lag {hov.lag > 0 ? `+${hov.lag}` : hov.lag} days
          </div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#cbd1dc' }}>
            r = {hov.correlation.toFixed(3)} · p = {hov.pValue.toFixed(3)} · n = {hov.n}
          </div>
        </div>
      )}
    </div>
  )
}

export default CorrelationHeatmap
