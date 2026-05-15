'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useDesignVersion, toggleVersionPath, type DesignVersion } from '@/lib/shared/useDesignVersion'

export function DesignToggle() {
  const router = useRouter()
  const pathname = usePathname() || '/'
  const [version, setVersion] = useDesignVersion()

  const switchTo = (next: DesignVersion) => {
    if (next === version) return
    setVersion(next)
    router.push(toggleVersionPath(pathname, next))
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        right: 16,
        zIndex: 100,
        display: 'inline-flex',
        background: 'rgba(10,13,18,0.92)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(245,230,37,0.30)',
        borderRadius: 8,
        padding: 3,
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
      role="group"
      aria-label="Design version toggle"
    >
      {(['v1', 'v2'] as const).map((v) => {
        const active = version === v
        return (
          <button
            key={v}
            onClick={() => switchTo(v)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              padding: '6px 12px',
              borderRadius: 5,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              transition: 'all 160ms',
              color: active ? '#000' : '#cbd5e1',
              background: active ? '#F5E625' : 'transparent',
            }}
            onMouseEnter={(e) => {
              if (!active) (e.currentTarget as HTMLElement).style.color = '#fff'
            }}
            onMouseLeave={(e) => {
              if (!active) (e.currentTarget as HTMLElement).style.color = '#cbd5e1'
            }}
          >
            {v === 'v1' ? 'Classic' : 'Executive'}
          </button>
        )
      })}
    </div>
  )
}
