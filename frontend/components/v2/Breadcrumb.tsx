'use client'
import Link from 'next/link'

type Crumb = { label: string; href?: string }

export function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1
        return (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {i > 0 && <span style={{ color: 'var(--fg-4)', fontSize: 12 }}>›</span>}
            {c.href && !isLast ? (
              <Link href={c.href} style={{ fontSize: 12, color: 'var(--fg-4)', textDecoration: 'none', fontWeight: 500 }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--fg-2)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--fg-4)'}
              >{c.label}</Link>
            ) : (
              <span style={{ fontSize: 12, color: isLast ? 'var(--fg-2)' : 'var(--fg-4)', fontWeight: isLast ? 600 : 400 }}>{c.label}</span>
            )}
          </span>
        )
      })}
    </nav>
  )
}
