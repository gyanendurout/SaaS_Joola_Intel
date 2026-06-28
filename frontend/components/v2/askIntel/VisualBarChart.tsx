'use client'

import type { VisualBarChart } from '@/lib/v2/askIntel/types'
import { fmt } from '@/components/v2/charts'

export function VisualBarChart({ visual }: { visual: VisualBarChart }) {
  const data = visual.data || []
  if (!data.length) return null
  const max = Math.max(...data.map((d) => d.value), 1)
  const suffix = visual.unitSuffix || ''

  return (
    <div style={{ marginTop: 12 }}>
      {visual.title && (
        <div style={{ fontSize: 11, color: 'var(--fg-4)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
          {visual.title}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.map((d, i) => {
          const pct = (d.value / max) * 100
          const color = d.color || '#22c55e'
          return (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '120px 1fr 70px', gap: 10, alignItems: 'center',
            }}>
              <div title={d.label} style={{
                fontSize: 12, fontWeight: 600, color: color === '#22c55e' ? '#22c55e' : 'var(--fg-2)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right',
              }}>{d.label}</div>
              <div style={{ background: 'var(--line-2)', height: 16, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  width: pct + '%', height: '100%', background: color, opacity: 0.85,
                  transition: 'width 240ms ease',
                }} />
              </div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--fg-2)', fontWeight: 600 }}>
                {fmt(d.value)}{suffix}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
