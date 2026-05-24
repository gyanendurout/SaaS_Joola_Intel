'use client'

import { useState } from 'react'

export interface LagScanPoint {
  lag: number
  pearson_r: number
  pearson_p: number
  spearman_rho: number
  spearman_p: number
}

interface LagScanChartProps {
  data: LagScanPoint[]
  driverLabel: string
  targetLabel: string
  width?: number
  height?: number
  interpretation?: string
}

function sigStars(p: number): string {
  if (!isFinite(p)) return ''
  if (p < 0.001) return '***'
  if (p < 0.01) return '**'
  if (p < 0.05) return '*'
  return ''
}

export function LagScanChart({
  data,
  driverLabel,
  targetLabel,
  width = 560,
  height = 280,
  interpretation,
}: LagScanChartProps) {
  const [hovIdx, setHovIdx] = useState<number | null>(null)

  if (!data.length) {
    return (
      <div style={{ padding: 40, color: '#6b7280', fontSize: 12, textAlign: 'center' }}>
        No lag-scan data available.
      </div>
    )
  }

  const sorted = [...data].sort((a, b) => a.lag - b.lag)
  const padL = 48
  const padR = 24
  const padT = 28
  const padB = 36
  const innerW = width - padL - padR
  const innerH = height - padT - padB

  const lagMin = sorted[0].lag
  const lagMax = sorted[sorted.length - 1].lag
  const lagRange = lagMax - lagMin || 1

  // Symmetric y-axis around 0, capped to [-1, 1]
  const allVals = sorted.flatMap((d) => [d.pearson_r, d.spearman_rho]).filter(isFinite)
  const yAbsMax = Math.min(1, Math.max(0.2, Math.max(...allVals.map(Math.abs))))

  const x = (lag: number) => padL + ((lag - lagMin) / lagRange) * innerW
  const y = (v: number) => padT + innerH / 2 - (v / yAbsMax) * (innerH / 2)

  const yTicks = [-yAbsMax, -yAbsMax / 2, 0, yAbsMax / 2, yAbsMax]

  // Peak markers — highest |pearson_r|
  const peak = sorted.reduce(
    (acc, d) => (Math.abs(d.pearson_r) > Math.abs(acc.pearson_r) ? d : acc),
    sorted[0]
  )

  const pearsonPath = sorted
    .map((d, i) => (i === 0 ? 'M' : 'L') + x(d.lag) + ',' + y(d.pearson_r))
    .join(' ')
  const spearmanPath = sorted
    .map((d, i) => (i === 0 ? 'M' : 'L') + x(d.lag) + ',' + y(d.spearman_rho))
    .join(' ')

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const scaleX = width / rect.width
    const localX = (e.clientX - rect.left) * scaleX
    if (localX < padL || localX > padL + innerW) {
      setHovIdx(null)
      return
    }
    const lagApprox = lagMin + ((localX - padL) / innerW) * lagRange
    let bestI = 0
    let bestD = Infinity
    for (let i = 0; i < sorted.length; i++) {
      const d = Math.abs(sorted[i].lag - lagApprox)
      if (d < bestD) {
        bestD = d
        bestI = i
      }
    }
    setHovIdx(bestI)
  }

  const hov = hovIdx !== null ? sorted[hovIdx] : null

  return (
    <div className="scatter-wrap lag-scan" style={{ position: 'relative' }}>
      {interpretation && <div className="viz-note">{interpretation}</div>}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`Lag scan: correlation between ${driverLabel} and ${targetLabel} at different lags`}
        style={{ overflow: 'visible', display: 'block' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHovIdx(null)}
      >
        {/* Y grid + ticks */}
        {yTicks.map((t, i) => (
          <g key={`yt-${i}`}>
            <line
              x1={padL}
              x2={padL + innerW}
              y1={y(t)}
              y2={y(t)}
              stroke="rgba(255,255,255,0.04)"
            />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="scatter-axis">
              {t.toFixed(2)}
            </text>
          </g>
        ))}

        {/* Zero horizontal dashed reference */}
        <line
          x1={padL}
          x2={padL + innerW}
          y1={y(0)}
          y2={y(0)}
          stroke="rgba(255,255,255,0.25)"
          strokeDasharray="4 4"
          strokeWidth="1"
        />
        {/* Zero vertical lag=0 dashed reference */}
        <line
          x1={x(0)}
          x2={x(0)}
          y1={padT}
          y2={padT + innerH}
          stroke="rgba(245,230,37,0.4)"
          strokeDasharray="4 3"
          strokeWidth="1"
        />

        {/* X-axis lag labels — every 7 days */}
        {sorted
          .filter((d) => d.lag % 7 === 0)
          .map((d) => (
            <text
              key={`xt-${d.lag}`}
              x={x(d.lag)}
              y={height - 16}
              textAnchor="middle"
              className="scatter-axis"
              style={{ fontWeight: d.lag === 0 ? 800 : 600, fill: d.lag === 0 ? '#F5E625' : '#8a93a4' }}
            >
              {d.lag > 0 ? `+${d.lag}` : d.lag}
            </text>
          ))}
        <text
          x={padL + innerW / 2}
          y={height - 2}
          textAnchor="middle"
          className="scatter-axis"
          style={{ fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}
        >
          Lag (days)
        </text>

        {/* Lines */}
        <path d={spearmanPath} fill="none" stroke="#F5E625" strokeWidth="2" opacity="0.9" />
        <path d={pearsonPath} fill="none" stroke="#22c55e" strokeWidth="2.4" />

        {/* Peak marker */}
        <circle
          cx={x(peak.lag)}
          cy={y(peak.pearson_r)}
          r="5"
          fill="#22c55e"
          stroke="#fff"
          strokeWidth="1.5"
        />
        <text
          x={x(peak.lag)}
          y={y(peak.pearson_r) - 10}
          textAnchor="middle"
          className="scatter-label"
          style={{ fontSize: 10, fontWeight: 800, fill: '#22c55e' }}
        >
          peak {peak.lag > 0 ? `+${peak.lag}` : peak.lag}d
        </text>

        {/* Crosshair */}
        {hov && (
          <line
            x1={x(hov.lag)}
            x2={x(hov.lag)}
            y1={padT}
            y2={padT + innerH}
            stroke="rgba(245,230,37,0.35)"
            strokeDasharray="3 3"
            strokeWidth="1"
          />
        )}

        {/* Legend */}
        <g transform={`translate(${padL + 6}, ${padT - 12})`}>
          <circle cx="4" cy="0" r="4" fill="#22c55e" />
          <text x="12" y="3" className="scatter-axis" style={{ fontWeight: 700, fill: '#cbd1dc' }}>
            Pearson r
          </text>
          <circle cx="84" cy="0" r="4" fill="#F5E625" />
          <text x="92" y="3" className="scatter-axis" style={{ fontWeight: 700, fill: '#cbd1dc' }}>
            Spearman ρ
          </text>
        </g>
      </svg>

      {hov && (
        <div
          className="tip"
          style={{
            left: (x(hov.lag) / width) * 100 + '%',
            top: (padT / height) * 100 + '%',
            transform: 'translate(-50%, -110%)',
            whiteSpace: 'nowrap',
          }}
        >
          <div className="t-name">Lag {hov.lag > 0 ? `+${hov.lag}` : hov.lag} days</div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#22c55e' }}>
            r = {hov.pearson_r.toFixed(3)} {sigStars(hov.pearson_p)}
          </div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#F5E625' }}>
            ρ = {hov.spearman_rho.toFixed(3)} {sigStars(hov.spearman_p)}
          </div>
        </div>
      )}
    </div>
  )
}

export default LagScanChart
