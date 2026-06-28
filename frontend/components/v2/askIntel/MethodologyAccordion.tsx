'use client'

import { useState } from 'react'
import type { AskIntelResponse } from '@/lib/v2/askIntel/types'

export function MethodologyAccordion({ response }: { response: AskIntelResponse }) {
  const [open, setOpen] = useState(false)
  const q = response.queryInfo
  const filterCount = q.plan?.filters?.length || 0

  return (
    <div style={{ marginTop: 12, fontSize: 11, color: 'var(--fg-4)' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: 'transparent', border: '1px solid var(--wb-8)',
          color: 'var(--fg-3)', borderRadius: 3, padding: '4px 10px',
          fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
          cursor: 'pointer', fontWeight: 600,
        }}
      >
        {open ? '▼' : '▶'} Methodology
      </button>
      {open && (
        <div style={{
          marginTop: 8, padding: 12, background: 'rgba(255,255,255,0.02)',
          border: '1px solid var(--wb-6)', borderRadius: 4,
          display: 'grid', gap: 6,
        }}>
          {response.methodology && (
            <div><strong style={{ color: 'var(--fg-3)' }}>How:</strong> {response.methodology}</div>
          )}
          <div><strong style={{ color: 'var(--fg-3)' }}>Tables:</strong> {q.tablesUsed.join(', ') || '—'}</div>
          <div><strong style={{ color: 'var(--fg-3)' }}>Rows:</strong> {q.rowsReturned}{q.truncatedTo ? ` (truncated to ${q.truncatedTo})` : ''}</div>
          <div><strong style={{ color: 'var(--fg-3)' }}>Filters applied:</strong> {filterCount}</div>
          <div><strong style={{ color: 'var(--fg-3)' }}>Latency:</strong> {q.elapsedMs} ms</div>
          <div><strong style={{ color: 'var(--fg-3)' }}>Sources:</strong> {response.dataSources.join(', ')}</div>
          <div><strong style={{ color: 'var(--fg-3)' }}>Confidence:</strong> {Math.round(response.confidence * 100)}%</div>
        </div>
      )}
    </div>
  )
}
