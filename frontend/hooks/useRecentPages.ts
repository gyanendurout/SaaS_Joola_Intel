'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

export type RecentPage = { href: string; label: string; icon: string }

const PAGE_META: Record<string, { label: string; icon: string }> = {
  '/v2/ask-intel':            { label: 'Ask Intel',          icon: '💬' },
  '/v2/community-intel':      { label: 'Community Intel',    icon: '📡' },
  '/v2/influencers':          { label: 'Influencer Intel',   icon: '⭐' },
  '/v2/campaign-offer-intel': { label: 'Campaign & Offers',  icon: '📢' },
  '/v2/product-intel':        { label: 'Product Intel',      icon: '🏓' },
  '/v2/sales-intel':          { label: 'Sales Intel',        icon: '💰' },
  '/v2/market':               { label: 'Market Intel',       icon: '📊' },
  '/v2/instagram':            { label: 'Instagram',          icon: '📸' },
  '/v2/youtube':              { label: 'YouTube',            icon: '▶'  },
  '/v2/reddit':               { label: 'Reddit',             icon: '🔶' },
  '/v2/twitter':              { label: 'X / Twitter',        icon: '𝕏'  },
  '/v2/tiktok':               { label: 'TikTok',             icon: '🎵' },
  '/v2/correlations':         { label: 'Correlations',       icon: '🔗' },
  '/v2/changepoints':         { label: 'Changepoints',       icon: '📈' },
  '/v2/data-health':          { label: 'Data Health',        icon: '🩺' },
  '/v2/overview':             { label: 'Overview',           icon: '🏠' },
}

const STORAGE_KEY = 'joola-recent-pages'
const MAX = 5

export function useRecentPages(): RecentPage[] {
  const pathname = usePathname()
  const [recent, setRecent] = useState<RecentPage[]>([])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) setRecent(JSON.parse(stored))
    } catch {}
  }, [])

  useEffect(() => {
    const meta = PAGE_META[pathname]
    if (!meta) return
    setRecent(prev => {
      const entry: RecentPage = { href: pathname, label: meta.label, icon: meta.icon }
      const filtered = prev.filter(p => p.href !== pathname)
      const next = [entry, ...filtered].slice(0, MAX)
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [pathname])

  return recent
}
