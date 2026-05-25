'use client'

import { useState, useMemo } from 'react'
import { fmt } from '@/components/v2/charts'
import { SortTh, ColumnFilter } from '@/components/v2/PageShell'

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
  /** Hide the "Est. units sold" column entirely when no rows carry it. */
  showEstUnitsSold?: boolean
  /** Hide the "Best lag" column entirely when no rows carry it. */
  showBestLag?: boolean
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
  showEstUnitsSold = true,
  showBestLag = true,
}: LeaderboardTableProps) {
  const initialKey: SortKey = (sortBy as SortKey) || 'attention'
  const [sortKey, setSortKey] = useState<SortKey>(initialKey)
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [colFilter, setColFilter] = useState<Record<string, string>>({})

  const filteredRows = useMemo(() => {
    return rows.filter((r) =>
      Object.entries(colFilter).every(([k, q]) => {
        if (!q) return true
        const cell = String((r as unknown as Record<string, unknown>)[k] ?? '')
        return cell.toLowerCase().includes(q.toLowerCase())
      })
    )
  }, [rows, colFilter])

  const sorted = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av
      }
      const as = String(av ?? '')
      const bs = String(bv ?? '')
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
    })
  }, [filteredRows, sortKey, sortDir])

  function toggle(key: string) {
    const k = key as SortKey
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(k)
      setSortDir('desc')
    }
  }

  if (!rows.length) {
    return (
      <div style={{ padding: 48, color: 'var(--fg-4)', fontSize: 12, textAlign: 'center' }}>
        No leaderboard data available.
      </div>
    )
  }

  return (
    <div className="leaderboard-wrap">
      {interpretation && <div className="viz-note">{interpretation}</div>}
      <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
        <table className="data leaderboard-table" role="table" aria-label="Product leaderboard">
          <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
            <tr>
              <SortTh col="brand" label="Brand" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
              <SortTh col="product" label="Product" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
              <SortTh col="attention" label="Attention" sortKey={sortKey} sortDir={sortDir} toggle={toggle} style={{ textAlign: 'right' }} title="Attention score combines mentions, recency, and weighted product signals where available." />
              <SortTh col="mentions" label="Mentions" sortKey={sortKey} sortDir={sortDir} toggle={toggle} style={{ textAlign: 'right' }} />
              {/* Optional column: hidden when no rows carry est. units sold */}
              {showEstUnitsSold && (
                <SortTh col="estimatedUnitsSold" label="Est. units sold" sortKey={sortKey} sortDir={sortDir} toggle={toggle} style={{ textAlign: 'right' }} />
              )}
              {/* Optional column: hidden when no rows carry best-lag data */}
              {showBestLag && (
                <SortTh col="bestLagDays" label="Best lag" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
              )}
              <th style={{ textAlign: 'center' }}>Trend</th>
            </tr>
            <tr className="col-filter-row">
              <th><ColumnFilter col="brand" value={colFilter.brand} onChange={(v) => setColFilter((p) => ({ ...p, brand: v }))} placeholder="brand…" /></th>
              <th><ColumnFilter col="product" value={colFilter.product} onChange={(v) => setColFilter((p) => ({ ...p, product: v }))} placeholder="product…" /></th>
              <th colSpan={3 + (showEstUnitsSold ? 1 : 0) + (showBestLag ? 1 : 0)} />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={5 + (showEstUnitsSold ? 1 : 0) + (showBestLag ? 1 : 0)} style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>
                  No rows found for the selected filters.
                </td>
              </tr>
            ) : sorted.map((r, i) => {
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
                {showEstUnitsSold && (
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                    {r.estimatedUnitsSold !== undefined ? fmt(r.estimatedUnitsSold) : '—'}
                  </td>
                )}
                {showBestLag && (
                  <td
                    style={{
                      fontSize: 11,
                      color: r.bestLagDays !== undefined ? '#cbd1dc' : '#6b7280',
                      fontStyle: r.bestLagDays !== undefined ? 'normal' : 'italic',
                    }}
                  >
                    {lagText}
                  </td>
                )}
                <td style={{ textAlign: 'center', padding: '4px 8px' }}>
                  <MiniSpark data={r.sparkline} color={sparkColor} />
                </td>
              </tr>
            )
          })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default LeaderboardTable
