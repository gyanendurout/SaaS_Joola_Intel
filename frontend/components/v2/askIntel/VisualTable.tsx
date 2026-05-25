'use client'

import { useMemo, useState } from 'react'
import type { VisualTable } from '@/lib/v2/askIntel/types'
import { SortTh } from '@/components/v2/PageShell'
import { fmt } from '@/components/v2/charts'

function formatCell(value: unknown, fmtType?: string): string {
  if (value === null || value === undefined || value === '') return '—'
  switch (fmtType) {
    case 'number':
      return typeof value === 'number' ? fmt(value) : String(value)
    case 'percent':
      return typeof value === 'number' ? value.toFixed(1) + '%' : String(value)
    case 'currency':
      return typeof value === 'number' ? '$' + value.toFixed(0) : String(value)
    case 'date':
      try { return new Date(String(value)).toISOString().slice(0, 10) }
      catch { return String(value) }
    default:
      return String(value)
  }
}

export function VisualTable({ visual }: { visual: VisualTable }) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const rows = useMemo(() => {
    const r = [...(visual.rows || [])]
    if (!sortKey) return r
    return r.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av
      }
      const as = String(av ?? ''), bs = String(bv ?? '')
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
    })
  }, [visual.rows, sortKey, sortDir])

  function toggle(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir('desc') }
  }

  if (!visual.columns?.length) return null

  return (
    <div style={{ marginTop: 12 }}>
      {visual.title && (
        <div style={{ fontSize: 11, color: 'var(--fg-4)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
          {visual.title}
        </div>
      )}
      <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 4 }}>
        <table className="data" style={{ width: '100%' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'rgba(13,17,23,0.95)' }}>
            <tr>
              {visual.columns.map((c) => (
                <SortTh
                  key={c.key}
                  col={c.key}
                  label={c.label}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  toggle={toggle}
                  style={c.align ? { textAlign: c.align } : undefined}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isJoola = visual.joolaColumn && r[visual.joolaColumn] === 'joola'
              return (
                <tr key={i} style={isJoola ? { background: 'rgba(34,197,94,0.06)' } : undefined}>
                  {visual.columns.map((c) => {
                    const v = formatCell(r[c.key], c.format)
                    const align = c.align || (c.format === 'number' || c.format === 'currency' || c.format === 'percent' ? 'right' : 'left')
                    return (
                      <td key={c.key} style={{
                        textAlign: align,
                        fontFamily: align === 'right' ? 'JetBrains Mono, monospace' : undefined,
                        fontWeight: isJoola && c.key === visual.joolaColumn ? 700 : undefined,
                        color: isJoola && c.key === visual.joolaColumn ? '#22c55e' : undefined,
                      }}>{v}</td>
                    )
                  })}
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={visual.columns.length} style={{ textAlign: 'center', padding: 24, color: 'var(--fg-4)' }}>No rows.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
