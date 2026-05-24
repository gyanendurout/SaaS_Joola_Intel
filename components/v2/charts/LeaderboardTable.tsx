'use client'

import { useState, useMemo } from 'react'
import { fmt } from '@/components/v2/charts'

export interface LeaderboardRow {
  brand: string
  product: string
  attention: number
  mentions: number
  estimatedUnitsSold?: number
  bestLagDays?: number
  bestLagDriver?: string
  sparkline: number[]
}

interface LeaderboardTableProps {
  rows: LeaderboardRow[]
  sortBy?: string
  onRowClick?: (brand: string, product: string) => void
  interpretation?: string
}

type SortKey = 'brand' | 'product' | 'attention' | 'mentions' | 'estimatedUnitsSold' | 'bestLagDays'
type SortDir = 'asc' | 'desc'

function MiniSpark({ data, color }: { data: number[]; color: string }) {
  const w = 80
  const h = 20
  if (!data || data.length === 0) return <svg width={w} height={h} />
  const safe = data.map((v) => (isFinite(v) ? v : 0))
  const min = Math.min(...safe)
  const max = Math.max(...safe)
  const range = max - min || 1
  const pad = 2
  const pts = safe.map((v, i) => {
    const x = pad + (i / Math.max(1, safe.length - 1)) * (w - pad * 2)
    const y = h - pad - ((v - min) / range) * (h - pad * 2)
    return [x, y] as const
  })
  const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2" fill={color} />
    </svg>
  )
}

export function LeaderboardTable({
  rows,
  sortBy,
  onRowClick,
  interpretation,
}: LeaderboardTableProps) {
  const initialKey: SortKey = (sortBy as SortKey) || 'attention'
  const [sortKey, setSortKey] = useState<SortKey>(initialKey)
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av
      }
      const as = String(av ?? '')
      const bs = String(bv ?? '')
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
    })
  }, [rows, sortKey, sortDir])

  function toggle(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const cols: { key: SortKey; label: string; numeric?: boolean }[] = [
    { key: 'brand', label: 'Brand' },
    { key: 'product', label: 'Product' },
    { key: 'attention', label: 'Attention', numeric: true },
    { key: 'mentions', label: 'Mentions', numeric: true },
    { key: 'estimatedUnitsSold', label: 'Est. units sold', numeric: true },
    { key: 'bestLagDays', label: 'Best lag' },
  ]

  function Arrow({ k }: { k: SortKey }) {
    const active = sortKey === k
    if (!active) return <span style={{ opacity: 0.25, marginLeft: 4 }}>↕</span>
    return (
      <span style={{ marginLeft: 4, color: '#F5E625', fontWeight: 800 }}>
        {sortDir === 'asc' ? '▲' : '▼'}
      </span>
    )
  }

  if (!rows.length) {
    return (
      <div style={{ padding: 40, color: '#6b7280', fontSize: 12, textAlign: 'center' }}>
        No leaderboard data available.
      </div>
    )
  }

  return (
    <div className="leaderboard-wrap">
      {interpretation && <div className="viz-note">{interpretation}</div>}
      <table className="data leaderboard-table" role="table" aria-label="Product leaderboard">
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c.key}
                className="sortable"
                onClick={() => toggle(c.key)}
                aria-sort={sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                style={{ cursor: 'pointer', textAlign: c.numeric ? 'right' : 'left' }}
              >
                {c.label}
                <Arrow k={c.key} />
              </th>
            ))}
            <th style={{ textAlign: 'center' }}>Trend</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            const isJ = r.brand.toLowerCase() === 'joola'
            const sparkColor = isJ ? '#22c55e' : '#94a3b8'
            const lagText =
              r.bestLagDays !== undefined && r.bestLagDriver
                ? `${r.bestLagDriver} ${r.bestLagDays > 0 ? '+' : ''}${r.bestLagDays}d`
                : 'no signal'
            return (
              <tr
                key={`${r.brand}-${r.product}-${i}`}
                className={'leaderboard-row' + (isJ ? ' leaderboard-row-joola' : '')}
                onClick={() => onRowClick && onRowClick(r.brand, r.product)}
                style={{ cursor: onRowClick ? 'pointer' : 'default' }}
                tabIndex={onRowClick ? 0 : -1}
                onKeyDown={(e) => {
                  if (onRowClick && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault()
                    onRowClick(r.brand, r.product)
                  }
                }}
                aria-label={`${r.brand} ${r.product}`}
              >
                <td style={{ fontWeight: isJ ? 800 : 600, color: isJ ? '#22c55e' : '#e2e8f0' }}>
                  {r.brand}
                </td>
                <td style={{ color: '#cbd1dc' }}>{r.product}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(r.attention)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(r.mentions)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                  {r.estimatedUnitsSold !== undefined ? fmt(r.estimatedUnitsSold) : '—'}
                </td>
                <td
                  style={{
                    fontSize: 11,
                    color: r.bestLagDays !== undefined ? '#cbd1dc' : '#6b7280',
                    fontStyle: r.bestLagDays !== undefined ? 'normal' : 'italic',
                  }}
                >
                  {lagText}
                </td>
                <td style={{ textAlign: 'center', padding: '4px 8px' }}>
                  <MiniSpark data={r.sparkline} color={sparkColor} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default LeaderboardTable
