'use client'

import type { VisualDonut } from '@/lib/v2/askIntel/types'
import { Donut } from '@/components/v2/charts'

const FALLBACK = ['#22c55e', '#F5E625', '#06b6d4', '#ec4899', '#a855f7', '#f59e0b', '#818cf8', '#ef4444']

export function VisualDonut({ visual }: { visual: VisualDonut }) {
  const data = (visual.data || []).map((d, i) => ({
    name: d.name,
    value: d.value,
    color: d.color || FALLBACK[i % FALLBACK.length],
  }))

  if (!data.length) return null

  return (
    <div style={{ marginTop: 12 }}>
      {visual.title && (
        <div style={{ fontSize: 11, color: 'var(--fg-4)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
          {visual.title}
        </div>
      )}
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <Donut data={data} size={220} thickness={38}
          centerLabel={visual.centerLabel} centerSub={visual.centerSub} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          {data.map((d) => (
            <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 99, background: d.color }} />
              <span style={{ color: 'var(--fg-2)' }}>{d.name}</span>
              <span style={{ color: 'var(--fg-4)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                {d.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
