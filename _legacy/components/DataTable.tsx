'use client'

import { useState } from 'react'

interface Column {
  key: string
  label: string
  render?: (val: any, row: any) => React.ReactNode
  sortValue?: (row: any) => any
}

function SortIcon({ direction }: { direction: 'asc' | 'desc' | null }) {
  return (
    <span className="inline-flex flex-col ml-1.5 gap-px align-middle opacity-60">
      <svg viewBox="0 0 8 5" className="w-2 h-2" style={{ opacity: direction === 'asc' ? 1 : 0.3 }}>
        <path d="M4 0L8 5H0L4 0z" fill="currentColor" />
      </svg>
      <svg viewBox="0 0 8 5" className="w-2 h-2" style={{ opacity: direction === 'desc' ? 1 : 0.3 }}>
        <path d="M4 5L0 0H8L4 5z" fill="currentColor" />
      </svg>
    </span>
  )
}

export function DataTable({
  columns,
  rows,
  isJoolaRow,
}: {
  columns: Column[]
  rows: any[]
  isJoolaRow?: (r: any) => boolean
}) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortCol = sortKey ? columns.find(c => c.key === sortKey) : null

  const sorted = sortKey
    ? [...rows].sort((a, b) => {
        const av = sortCol?.sortValue ? sortCol.sortValue(a) : (a[sortKey] ?? '')
        const bv = sortCol?.sortValue ? sortCol.sortValue(b) : (b[sortKey] ?? '')
        const cmp =
          typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true })
        return sortDir === 'asc' ? cmp : -cmp
      })
    : rows

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            {columns.map(c => (
              <th
                key={c.key}
                onClick={() => handleSort(c.key)}
                className="text-left px-3 py-2.5 whitespace-nowrap cursor-pointer select-none transition-colors duration-150"
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: '#ffffff',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                }}>
                {c.label}
                <SortIcon direction={sortKey === c.key ? sortDir : null} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={i}
              className="transition-colors duration-100 cursor-default"
              style={{
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                background: isJoolaRow?.(row) ? 'rgba(34,197,94,0.04)' : 'transparent',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = isJoolaRow?.(row) ? 'rgba(34,197,94,0.06)' : 'rgba(255,255,255,0.025)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isJoolaRow?.(row) ? 'rgba(34,197,94,0.04)' : 'transparent' }}
            >
              {columns.map(c => (
                <td key={c.key} className="px-3 py-2.5" style={{ color: '#ffffff', fontSize: '13px' }}>
                  {c.render ? c.render(row[c.key], row) : (row[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
