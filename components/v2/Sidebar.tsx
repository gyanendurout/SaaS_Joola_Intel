'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

const I = {
  overview: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></svg>,
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
      { href: '/v2',             label: 'Executive Overview', ic: I.overview, badge: 'LIVE' },
      { href: '/v2/comments',    label: 'Comments Intel',     ic: I.comments },
      { href: '/v2/influencers', label: 'Influencer Network', ic: I.inf },
      { href: '/v2/ads',         label: 'Ads Library',        ic: I.ads },
      { href: '/v2/promotions',  label: 'Promotions',         ic: I.promo },
      { href: '/v2/products',    label: 'Product Catalog',    ic: I.product },
      { href: '/v2/products-intel', label: 'Product Intel', ic: I.trend, badge: 'NEW' },
      { href: '/v2/sales-intel',    label: 'Sales Intel',   ic: I.sales, badge: 'NEW' },
      { href: '/v2/market',      label: 'Market Intel',       ic: I.mkt },
      { href: '/v2/correlations', label: 'Correlations',     ic: I.corr,   badge: 'NEW' },
      { href: '/v2/changepoints', label: 'Changepoints',     ic: I.change, badge: 'NEW' },
      { href: '/v2/leaderboard',  label: 'Product Leaderboard', ic: I.board, badge: 'NEW' },
    ],
  },
  {
    heading: 'Social Media',
    items: [
      { href: '/v2/instagram', label: 'Instagram',          ic: I.ig },
      { href: '/v2/youtube',   label: 'YouTube',            ic: I.yt },
      { href: '/v2/reddit',    label: 'Reddit & Community', ic: I.reddit },
      { href: '/v2/twitter',   label: 'X / Twitter',        ic: I.tw, badge: 'NEW' },
      { href: '/v2/tiktok',    label: 'TikTok',             ic: I.tt, badge: 'NEW' },
    ],
  },
]

export function V2Sidebar() {
  const path = usePathname() || '/v2'
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', collapsed ? '60px' : '232px')
  }, [collapsed])

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
          {navGroups.map((group, gi) => (
            <div key={group.heading} className="nav-group" style={gi > 0 ? { marginTop: 12 } : undefined}>
              {!collapsed && <h6>{group.heading}</h6>}
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
                  </Link>
                )
              })}
            </div>
          ))}
        </div>

        {/* Collapse toggle — desktop only */}
        <button
          className="collapse-btn"
          onClick={() => setCollapsed(c => !c)}
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
