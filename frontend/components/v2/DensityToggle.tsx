'use client'

import { useEffect, useState } from 'react'

const CompactIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="3" y1="5" x2="21" y2="5"/><line x1="3" y1="9" x2="21" y2="9"/>
    <line x1="3" y1="13" x2="21" y2="13"/><line x1="3" y1="17" x2="21" y2="17"/>
    <line x1="3" y1="21" x2="21" y2="21"/>
  </svg>
)

const ComfortableIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="3" y1="6" x2="21" y2="6"/>
    <line x1="3" y1="12" x2="21" y2="12"/>
    <line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
)

export function DensityToggle() {
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable')

  useEffect(() => {
    try {
      const stored = localStorage.getItem('joola-density') as 'comfortable' | 'compact' | null
      if (stored) {
        setDensity(stored)
        document.documentElement.classList.toggle('density-compact', stored === 'compact')
      }
    } catch {}
  }, [])

  function toggle() {
    const next = density === 'comfortable' ? 'compact' : 'comfortable'
    setDensity(next)
    document.documentElement.classList.toggle('density-compact', next === 'compact')
    try { localStorage.setItem('joola-density', next) } catch {}
  }

  const isCompact = density === 'compact'

  return (
    <button
      onClick={toggle}
      aria-label={isCompact ? 'Switch to comfortable view' : 'Switch to compact view'}
      title={isCompact ? 'Comfortable view' : 'Compact view'}
      style={{
        background: isCompact ? 'rgba(245,230,37,0.12)' : 'var(--wb-6)',
        border: `1px solid ${isCompact ? 'rgba(245,230,37,0.3)' : 'var(--wb-10)'}`,
        borderRadius: 6,
        width: 30,
        height: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: isCompact ? '#F5E625' : 'var(--fg-3)',
        flexShrink: 0,
        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
      }}
      onMouseEnter={e => { if (!isCompact) (e.currentTarget as HTMLElement).style.background = 'var(--wb-10)' }}
      onMouseLeave={e => { if (!isCompact) (e.currentTarget as HTMLElement).style.background = 'var(--wb-6)' }}
    >
      {isCompact ? <CompactIcon /> : <ComfortableIcon />}
    </button>
  )
}
