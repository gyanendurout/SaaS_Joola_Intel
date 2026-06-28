'use client'
import { useEffect, useState } from 'react'

export function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    try {
      const stored = localStorage.getItem('joola-theme') as 'dark' | 'light' | null
      const initial = stored || 'dark'
      setTheme(initial)
      document.documentElement.classList.toggle('theme-light', initial === 'light')
    } catch {}
  }, [])

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.classList.toggle('theme-light', next === 'light')
    try { localStorage.setItem('joola-theme', next) } catch {}
  }

  return (
    <button
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{ background: 'var(--wb-6)', border: '1px solid var(--wb-10)', borderRadius: 6, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--fg-3)', fontSize: 13, lineHeight: 1, flexShrink: 0, transition: 'background 0.15s' }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--wb-10)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--wb-6)'}>
      {theme === 'dark' ? '☀' : '🌙'}
    </button>
  )
}
