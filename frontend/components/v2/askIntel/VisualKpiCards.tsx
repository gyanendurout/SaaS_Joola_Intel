'use client'

import type { VisualKpiCards } from '@/lib/v2/askIntel/types'
import { MiniKpi } from '@/components/v2/PageShell'
import { tipFor } from '@/lib/v2/tooltips'

export function VisualKpiCards({ visual }: { visual: VisualKpiCards }) {
  return (
    <div style={{ marginTop: 12 }}>
      {visual.title && (
        <div style={{ fontSize: 11, color: 'var(--fg-4)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
          {visual.title}
        </div>
      )}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(180px, 1fr))`,
        gap: 12,
      }}>
        {visual.cards.map((c, i) => (
          <MiniKpi
            key={i}
            label={c.label}
            // Column set is query-dependent; tipFor() explains the ones it knows.
            tip={tipFor(c.label)}
            value={c.value}
            color={c.color || '#22c55e'}
            customVs={c.caption}
            spark={c.spark}
          />
        ))}
      </div>
    </div>
  )
}
