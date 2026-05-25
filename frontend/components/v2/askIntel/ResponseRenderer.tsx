'use client'

import type { Visual } from '@/lib/v2/askIntel/types'
import { VisualKpiCards } from './VisualKpiCards'
import { VisualBarChart } from './VisualBarChart'
import { VisualLineChart } from './VisualLineChart'
import { VisualDonut } from './VisualDonut'
import { VisualTable } from './VisualTable'
import { VisualScatter } from './VisualScatter'

export function ResponseRenderer({ visuals }: { visuals: Visual[] }) {
  if (!visuals?.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {visuals.map((v, i) => {
        switch (v.type) {
          case 'kpi_cards': return <VisualKpiCards key={i} visual={v} />
          case 'bar_chart': return <VisualBarChart key={i} visual={v} />
          case 'line_chart': return <VisualLineChart key={i} visual={v} />
          case 'donut': return <VisualDonut key={i} visual={v} />
          case 'table': return <VisualTable key={i} visual={v} />
          default:
            // Allow planner to request scatter via free-form 'type' field.
            if ((v as unknown as { type: string }).type === 'scatter') {
              return <VisualScatter key={i} visual={v} />
            }
            return null
        }
      })}
    </div>
  )
}
