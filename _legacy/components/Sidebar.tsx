'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

function IconGrid() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}
function IconCamera() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}
function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <circle cx="12" cy="12" r="10" />
      <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
    </svg>
  )
}
function IconMessage() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  )
}
function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    </svg>
  )
}
function IconTrending() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  )
}
function IconStar() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}
function IconMegaphone() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M3 11l18-8v18L3 13v-2z" />
      <path d="M11.6 16.8a3 3 0 11-5.8-1.6" />
    </svg>
  )
}
function IconTag() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M20.59 13.41L13.42 20.58a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  )
}
function IconChat() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
    </svg>
  )
}

const nav = [
  { href: '/',             label: 'Overview',    sub: 'Insights & Strategy',   icon: <IconGrid /> },
  { href: '/instagram',    label: 'Instagram',   sub: 'Social analytics',      icon: <IconCamera /> },
  { href: '/youtube',      label: 'YouTube',     sub: 'Video performance',     icon: <IconPlay /> },
  { href: '/reddit',       label: 'Reddit',      sub: 'Community signals',     icon: <IconMessage /> },
  { href: '/comments',     label: 'Comments',    sub: 'IG + YT comment intel', icon: <IconChat /> },
  { href: '/influencers',  label: 'Influencers', sub: 'Ambassador network',    icon: <IconUsers /> },
  { href: '/ads',          label: 'Ads Library', sub: 'Meta + Google ads',     icon: <IconMegaphone /> },
  { href: '/promotions',   label: 'Promotions',  sub: 'Discount & banners',    icon: <IconTag /> },
  { href: '/products',     label: 'Products',    sub: 'Catalog & pricing',     icon: <IconStar /> },
  { href: '/market',       label: 'Market Intel',sub: 'Competitive landscape', icon: <IconTrending /> },
]

export function Sidebar() {
  const path = usePathname()
  return (
    <aside className="fixed top-0 left-0 w-[228px] min-h-screen flex flex-col z-50"
      style={{ background: 'rgba(6,9,15,0.96)', borderRight: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(24px)' }}>

      {/* Logo */}
      <div className="px-5 pt-6 pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #22c55e, #818cf8)', boxShadow: '0 0 16px rgba(34,197,94,0.35)' }}>
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
              <path d="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 5.5a2.5 2.5 0 105 0 2.5 2.5 0 00-5 0z" fill="white"/>
            </svg>
          </div>
          <div>
            <span className="font-black text-[15px] tracking-tight text-white">JOOLA</span>
            <span className="font-black text-[15px] tracking-tight text-gradient-green">INTEL</span>
          </div>
        </div>
        <p className="text-[11px] tracking-wide" style={{ color: '#94a3b8', paddingLeft: '36px' }}>Pickleball Intelligence</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest px-3 pt-1 pb-2" style={{ color: '#94a3b8' }}>Channels</p>
        {nav.map(item => {
          const active = path === item.href
          return (
            <Link key={item.href} href={item.href} className="cursor-pointer block">
              <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                active
                  ? 'text-[#22c55e]'
                  : 'text-[#94a3b8] hover:text-[#94a3b8] hover:bg-white/[0.04]'
              }`}
                style={active ? {
                  background: 'rgba(34,197,94,0.08)',
                  border: '1px solid rgba(34,197,94,0.15)',
                  boxShadow: '0 0 12px rgba(34,197,94,0.08)',
                } : { border: '1px solid transparent' }}>
                <span className={active ? 'text-[#22c55e]' : 'text-[#94a3b8]'}>{item.icon}</span>
                <div className="min-w-0">
                  <p className={`text-[13px] font-semibold leading-tight ${active ? 'text-[#22c55e]' : ''}`}>{item.label}</p>
                  <p className="text-[10px] leading-tight mt-0.5 truncate" style={{ color: active ? 'rgba(34,197,94,0.6)' : '#94a3b8' }}>{item.sub}</p>
                </div>
                {active && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse-dot flex-shrink-0" />
                )}
              </div>
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse-dot" />
          <span className="text-[11px] font-medium" style={{ color: '#22c55e' }}>Live Data</span>
        </div>
        <p className="text-[11px]" style={{ color: '#94a3b8' }}>
          Refreshes <span style={{ color: '#94a3b8', fontWeight: 600 }}>Monday 7:00 AM IST</span>
        </p>
      </div>
    </aside>
  )
}
