'use client'

import type { VisualLineChart } from '@/lib/v2/askIntel/types'
import { LineChart, type LineSeries } from '@/components/v2/charts'

const FALLBACK = ['#22c55e', '#F5E625', '#06b6d4', '#ec4899', '#a855f7', '#f59e0b', '#818cf8', '#ef4444']

export function VisualLineChart({ visual }: { visual: VisualLineChart }) {
  const series: LineSeries[] = (visual.series || []).map((s, i) => ({
    id: s.id || `s${i}`,
    label: s.label,
    color: s.color || FALLBACK[i % FALLBACK.length],
    data: s.data || [],
  }))

  if (!series.length) return null

  return (
    <div style={{ marginTop: 12 }}>
      {visual.title && (
        <div style={{ fontSize: 11, color: 'var(--fg-4)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
          {visual.title}
        </div>
      )}
      <LineChart series={series} xLabels={visual.xLabels} yLabel={visual.yLabel} />
    </div>
  )
}
