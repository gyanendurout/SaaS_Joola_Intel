import { pgColor, pgName } from '@/components/v2/PageShell'
import type { V2Brand } from '@/lib/v2/data'

// Brand cell for data tables — colored dot + brand name + optional handle.
export function BrandCell({
  slug,
  brands,
  handle,
}: {
  slug: string
  brands: V2Brand[]
  handle?: string
}) {
  const isJoola = slug === 'joola'
  const color   = pgColor(slug)
  const name    = pgName(slug, brands)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontWeight: 700, color: isJoola ? '#22c55e' : 'var(--fg)', fontSize: 12 }}>
          {name}
        </span>
        {handle && (
          <span style={{ fontSize: 10, color: 'var(--fg-4)' }}>@{handle.replace(/^@/, '')}</span>
        )}
      </div>
    </div>
  )
}
