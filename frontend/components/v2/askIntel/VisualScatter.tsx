'use client'

import type { Visual } from '@/lib/v2/askIntel/types'
import { ScatterChart, type ScatterDatum } from '@/components/v2/charts'

/**
 * Scatter visual — uses ScatterChart primitive. The Ask Intel visual schema
 * does not currently model a dedicated scatter, but the answerer is allowed
 * to emit one shaped like a table with x/y/label keys. We translate here.
 */
type ScatterShape = {
  type: 'scatter'
  title?: string
  data: { brand?: string; name: string; x: number; y: number; color?: string; size?: number }[]
}

export function VisualScatter({ visual }: { visual: Visual & { type?: string } }) {
  const v = visual as unknown as ScatterShape
  if (!v.data?.length) return null
  const data: ScatterDatum[] = v.data.map((d) => ({
    brand: d.brand || d.name.toLowerCase(),
    name: d.name,
    followers: d.x,
    engRate: d.y,
    color: d.color || '#22c55e',
    posts: d.size,
  }))
  return (
    <div style={{ marginTop: 12 }}>
      {v.title && (
        <div style={{ fontSize: 11, color: 'var(--fg-4)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
          {v.title}
        </div>
      )}
      <ScatterChart data={data} />
    </div>
  )
}
