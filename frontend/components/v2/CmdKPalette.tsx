'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

const PAGES = [
  { label: 'Ask Intel',          href: '/v2/ask-intel',            icon: '💬', keywords: 'ai chat sql query' },
  { label: 'Community Intel',    href: '/v2/community-intel',      icon: '📡', keywords: 'reddit sentiment defection crisis' },
  { label: 'Influencer Intel',   href: '/v2/influencers',          icon: '⭐', keywords: 'athletes players sponsored roster' },
  { label: 'Campaign & Offers',  href: '/v2/campaign-offer-intel', icon: '📢', keywords: 'ads promotions discounts campaigns' },
  { label: 'Product Intel',      href: '/v2/product-intel',        icon: '🏓', keywords: 'paddles products leaderboard attention' },
  { label: 'Sales Intel',        href: '/v2/sales-intel',          icon: '💰', keywords: 'inventory price sales revenue' },
  { label: 'Market Intel',       href: '/v2/market',               icon: '📊', keywords: 'market positioning signals' },
  { label: 'Instagram',          href: '/v2/instagram',            icon: '📸', keywords: 'ig engagement followers posts reels' },
  { label: 'YouTube',            href: '/v2/youtube',              icon: '▶',  keywords: 'yt videos subscribers views' },
  { label: 'Reddit & Community', href: '/v2/reddit',               icon: '🔶', keywords: 'reddit mentions subreddit community' },
  { label: 'X / Twitter',        href: '/v2/twitter',              icon: '𝕏',  keywords: 'twitter x tweets followers' },
  { label: 'TikTok',             href: '/v2/tiktok',               icon: '🎵', keywords: 'tiktok videos hearts viral' },
  { label: 'Correlations',       href: '/v2/correlations',         icon: '🔗', keywords: 'lag correlation cross-channel' },
  { label: 'Changepoints',       href: '/v2/changepoints',         icon: '📈', keywords: 'statistical changepoint detection' },
  { label: 'Data Health',        href: '/v2/data-health',          icon: '🩺', keywords: 'data freshness tables counts health' },
  { label: 'Overview',           href: '/v2/overview',             icon: '🏠', keywords: 'home dashboard overview summary' },
]

export function CmdKPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setOpen(o => !o); setQuery(''); setActiveIdx(0) }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 60) }, [open])

  const filtered = query.trim()
    ? PAGES.filter(p => p.label.toLowerCase().includes(query.toLowerCase()) || p.keywords.includes(query.toLowerCase()))
    : PAGES

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter') { const p = filtered[activeIdx]; if (p) { router.push(p.href); setOpen(false); setQuery('') } }
  }

  if (!open) return null

  return (
    <>
      <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 9998 }} />
      <div style={{ position: 'fixed', top: '15vh', left: '50%', transform: 'translateX(-50%)', width: 'min(560px, 90vw)', zIndex: 9999, borderRadius: 14, background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 24px 64px rgba(0,0,0,0.7)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input ref={inputRef} value={query}
            onChange={e => { setQuery(e.target.value); setActiveIdx(0) }}
            onKeyDown={onKeyDown}
            placeholder="Jump to page…" autoComplete="off"
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#f0f6fc', fontSize: 15, fontWeight: 500 }} />
          <kbd style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.08)', color: '#6b7280', border: '1px solid rgba(255,255,255,0.12)', fontFamily: 'monospace' }}>ESC</kbd>
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto', padding: '6px 0' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>No pages match &quot;{query}&quot;</div>
          ) : filtered.map((p, i) => (
            <div key={p.href}
              onClick={() => { router.push(p.href); setOpen(false); setQuery('') }}
              onMouseEnter={() => setActiveIdx(i)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', cursor: 'pointer', background: i === activeIdx ? 'rgba(34,197,94,0.08)' : 'transparent', borderLeft: i === activeIdx ? '3px solid #22c55e' : '3px solid transparent', transition: 'background 80ms' }}>
              <span style={{ fontSize: 16, width: 22, textAlign: 'center' }}>{p.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: i === activeIdx ? '#22c55e' : '#e2e8f0' }}>{p.label}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: '8px 18px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 16, fontSize: 10, color: '#4b5563' }}>
          <span>↑↓ navigate</span><span>↵ open</span><span>⌘K toggle</span>
        </div>
      </div>
    </>
  )
}
