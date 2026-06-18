'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

const I = {
  home: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  overview: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></svg>,
  health: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg>,
  ig: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" /></svg>,
  yt: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="3" /><path d="M10 9l5 3-5 3z" fill="currentColor" /></svg>,
  reddit: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="13" r="8" /><circle cx="9" cy="13" r="1" fill="currentColor" /><circle cx="15" cy="13" r="1" fill="currentColor" /><path d="M9 16c1 1 4 1 6 0" /></svg>,
  ads: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 11l16-6v14L3 13z" /><path d="M11 11v8" /></svg>,
  promo: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 4L8 16l-4-4" /><circle cx="6" cy="6" r="2" /></svg>,
  product: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7l9-4 9 4-9 4z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></svg>,
  inf: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="8" r="3" /><circle cx="17" cy="10" r="2" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5" /><path d="M15 19c0-2 2-3 4-3" /></svg>,
  mkt: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 17l5-5 4 4 8-9" /><path d="M14 7h6v6" /></svg>,
  comments: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a8 8 0 11-3.5-6.6L21 4l-1.4 3.4A8 8 0 0121 12z" /></svg>,
  tw:  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"/></svg>,
  tt:  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.22 8.22 0 004.83 1.55V6.79a4.85 4.85 0 01-1.06-.1z"/></svg>,
  trend: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>,
  sales: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  corr: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="6" height="6"/><rect x="9" y="9" width="6" height="6"/><rect x="15" y="15" width="6" height="6"/><rect x="15" y="3" width="6" height="6" strokeDasharray="2 2"/><rect x="3" y="15" width="6" height="6" strokeDasharray="2 2"/></svg>,
  change: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 17 9 11 13 15 21 7"/><line x1="13" y1="3" x2="13" y2="21" strokeDasharray="3 3"/></svg>,
  board: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="5" height="10"/><rect x="9.5" y="6" width="5" height="15"/><rect x="16" y="2" width="5" height="19"/></svg>,
  crisis: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  ask: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>,
}

const ChevronLeft = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="15 18 9 12 15 6" />
  </svg>
)
const ChevronRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

type NavItem = { href: string; label: string; ic: ReactNode; badge?: string }
type NavGroup = { heading: string; items: NavItem[] }

const navGroups: NavGroup[] = [
  {
    heading: 'Analytics',
    items: [
      { href: '/v2/ask-intel',   label: 'Ask Intel',          ic: I.ask },
      { href: '/v2/community-intel', label: 'Community Intel', ic: I.comments },
      { href: '/v2/influencers', label: 'Influencer Intel', ic: I.inf },
      { href: '/v2/campaign-offer-intel', label: 'Campaign & Offer Intel', ic: I.ads },
      { href: '/v2/product-intel', label: 'Product Intel', ic: I.product },
      { href: '/v2/sales-intel',    label: 'Sales Intel',   ic: I.sales },
      { href: '/v2/market',      label: 'Market Intel',       ic: I.mkt },
      { href: '/v2/correlations', label: 'Correlations',     ic: I.corr },
      { href: '/v2/changepoints', label: 'Changepoints',     ic: I.change },
      { href: '/v2/data-health',  label: 'Data Health',      ic: I.health },
    ],
  },
  {
    heading: 'Social Media',
    items: [
      { href: '/v2/instagram', label: 'Instagram',          ic: I.ig },
      { href: '/v2/youtube',   label: 'YouTube',            ic: I.yt },
      { href: '/v2/reddit',    label: 'Reddit & Community', ic: I.reddit },
      { href: '/v2/twitter',   label: 'X / Twitter',        ic: I.tw },
      { href: '/v2/tiktok',    label: 'TikTok',             ic: I.tt },
    ],
  },
]

const SunIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
)
const MoonIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
  </svg>
)

export function V2Sidebar() {
  const path = usePathname() || '/v2'
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable')
  const [crisisCount, setCrisisCount] = useState(0)

  useEffect(() => {
    import('@/lib/shared/supabase').then(({ supabase }) => {
      supabase
        .from('mention_facts')
        .select('id', { count: 'exact', head: true })
        .eq('is_crisis', true)
        .gte('posted_at', new Date(Date.now() - 7 * 86400000).toISOString())
        .then(({ count }) => { if (count) setCrisisCount(count) })
    })
  }, [])

  useEffect(() => {
    // Restore collapse state
    const savedCollapsed = localStorage.getItem('joola-sidebar-collapsed') === 'true'
    setCollapsed(savedCollapsed)
    document.documentElement.style.setProperty('--sidebar-w', savedCollapsed ? '60px' : '232px')
    // Restore theme
    const savedTheme = localStorage.getItem('joola-theme') as 'dark' | 'light' | null
    if (savedTheme) {
      setTheme(savedTheme)
      document.documentElement.classList.toggle('theme-light', savedTheme === 'light')
    }
    // Restore density
    const savedDensity = localStorage.getItem('joola-density') as 'comfortable' | 'compact' | null
    if (savedDensity) {
      setDensity(savedDensity)
      document.documentElement.classList.toggle('density-compact', savedDensity === 'compact')
    }
    // Restore group collapsed state
    try {
      const savedGroups = JSON.parse(localStorage.getItem('joola-nav-groups') || '{}')
      if (typeof savedGroups === 'object') setCollapsedGroups(savedGroups)
    } catch {}
  }, [])

  // Auto-expand the group that contains the current page
  useEffect(() => {
    setCollapsedGroups(prev => {
      let changed = false
      const next = { ...prev }
      navGroups.forEach(group => {
        if (next[group.heading]) {
          const hasActive = group.items.some(
            item => path === item.href || (item.href !== '/v2' && path.startsWith(item.href))
          )
          if (hasActive) { next[group.heading] = false; changed = true }
        }
      })
      if (!changed) return prev
      localStorage.setItem('joola-nav-groups', JSON.stringify(next))
      return next
    })
  }, [path])

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', collapsed ? '60px' : '232px')
  }, [collapsed])

  function toggleDensity() {
    const next = density === 'comfortable' ? 'compact' : 'comfortable'
    setDensity(next)
    document.documentElement.classList.toggle('density-compact', next === 'compact')
    localStorage.setItem('joola-density', next)
  }

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.classList.toggle('theme-light', next === 'light')
    localStorage.setItem('joola-theme', next)
  }

  return (
    <>
      {/* Hamburger — only visible on mobile via CSS */}
      <button className="mobile-menu-btn" onClick={() => setOpen(true)} aria-label="Open navigation">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/>
        </svg>
      </button>

      {/* Overlay — only rendered when open */}
      {open && <div className="sidebar-overlay" onClick={() => setOpen(false)} />}

      <aside className={'sidebar' + (open ? ' sidebar-open' : '') + (collapsed ? ' sidebar-collapsed' : '')}>
        <div className="brand">
          <div className="brand-mark" style={{ background: '#F5E625', color: '#000', fontFamily: 'Archivo Black', flexShrink: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 900 }}>J</span>
          </div>
          {!collapsed && (
            <div className="brand-text">
              <span className="a">JOOLA</span> <span className="b">INTEL</span>
              <span className="s">Pickleball Intelligence</span>
            </div>
          )}
          {/* Close button — hidden on desktop, shown on mobile via CSS */}
          <button className="sidebar-close-btn" onClick={() => setOpen(false)} aria-label="Close navigation">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="nav-section" style={{ flex: 1, overflowY: 'auto' }}>
          {/* Home entry — always at top */}
          <div className="nav-group">
            <Link
              href="/v2/overview"
              className={'nav-item ' + (path === '/v2' || path === '/v2/overview' ? 'active' : '')}
              onClick={() => setOpen(false)}
              title={collapsed ? 'Home' : undefined}
              aria-label="Home"
            >
              <span className="ic">{I.home}</span>
              {!collapsed && <span>Home</span>}
            </Link>
          </div>

          {navGroups.map((group, gi) => {
            const isGroupCollapsed = !collapsed && !!collapsedGroups[group.heading]
            function toggleGroup() {
              setCollapsedGroups(prev => {
                const next = { ...prev, [group.heading]: !prev[group.heading] }
                localStorage.setItem('joola-nav-groups', JSON.stringify(next))
                return next
              })
            }
            return (
              <div key={group.heading} className="nav-group" style={{ marginTop: gi === 0 ? 16 : 12 }}>
                {/* Clickable heading with chevron */}
                {!collapsed && (
                  <button
                    onClick={toggleGroup}
                    aria-expanded={!isGroupCollapsed}
                    aria-label={`${isGroupCollapsed ? 'Expand' : 'Collapse'} ${group.heading}`}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                      padding: '0 8px 4px', marginBottom: 2,
                    }}
                  >
                    <h6 style={{ margin: 0, pointerEvents: 'none' }}>{group.heading}</h6>
                    <svg
                      width="10" height="10" viewBox="0 0 24 24" fill="none"
                      stroke="rgba(255,255,255,0.3)" strokeWidth="2.5"
                      style={{
                        flexShrink: 0,
                        transition: 'transform 220ms ease',
                        transform: isGroupCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                      }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                )}
                {/* Items — slide up/down */}
                <div style={{
                  overflow: 'hidden',
                  maxHeight: isGroupCollapsed ? '0px' : '800px',
                  opacity: isGroupCollapsed ? 0 : 1,
                  transition: 'max-height 280ms cubic-bezier(0.4,0,0.2,1), opacity 200ms ease',
                }}>
                  {group.items.map(item => {
                    const active = path === item.href || (item.href !== '/v2' && path.startsWith(item.href))
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={'nav-item ' + (active ? 'active' : '')}
                        onClick={() => setOpen(false)}
                        title={collapsed ? item.label : undefined}
                      >
                        <span className="ic">{item.ic}</span>
                        {!collapsed && <span>{item.label}</span>}
                        {!collapsed && item.badge && <span className="badge">{item.badge}</span>}
                        {item.href === '/v2/community-intel' && crisisCount > 0 && !collapsed && (
                          <span className="crisis-badge" style={{
                            marginLeft: 'auto', fontSize: 9, fontWeight: 800,
                            background: '#ef4444', color: '#fff',
                            borderRadius: 99, padding: '1px 6px', minWidth: 16, textAlign: 'center',
                          }} title={`${crisisCount} crisis signals in last 7 days`}>
                            {crisisCount > 99 ? '99+' : crisisCount}
                          </span>
                        )}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Theme toggle */}
        <button
          className={`theme-toggle-btn${collapsed ? ' collapsed-mode' : ''}`}
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          {!collapsed && <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
        </button>

        {/* Density toggle */}
        <button
          className={`theme-toggle-btn${collapsed ? ' collapsed-mode' : ''}`}
          onClick={toggleDensity}
          title={density === 'comfortable' ? 'Switch to compact view' : 'Switch to comfortable view'}
          aria-label={density === 'comfortable' ? 'Switch to compact view' : 'Switch to comfortable view'}
        >
          {density === 'comfortable' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="5" x2="21" y2="5"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="13" x2="21" y2="13"/><line x1="3" y1="17" x2="21" y2="17"/><line x1="3" y1="21" x2="21" y2="21"/></svg>
          )}
          {!collapsed && <span>{density === 'comfortable' ? 'Compact view' : 'Comfortable view'}</span>}
        </button>

        {/* Collapse toggle — desktop only */}
        <button
          className="collapse-btn"
          onClick={() => setCollapsed(c => {
            const next = !c
            localStorage.setItem('joola-sidebar-collapsed', String(next))
            return next
          })}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight /> : <><ChevronLeft /><span>Collapse</span></>}
        </button>

        <div className="sidebar-foot">
          <span className="live-dot" />
          {!collapsed && (
            <div>
              <div style={{ color: '#cbd1dc', fontWeight: 600, fontSize: 12 }}>Live data</div>
              <div>Mon · 07:00 IST · synced</div>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
