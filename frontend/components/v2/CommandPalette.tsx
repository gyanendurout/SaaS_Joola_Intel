'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { SPONSORED_PLAYER_ROSTER } from '@/lib/v2/playerRoster'
import { BRAND_COLORS } from '@/lib/v2/data'

// ─── Static data ────────────────────────────────────────────────────────────

const PAGES: { label: string; href: string; keywords?: string }[] = [
  { label: 'Ask Intel',              href: '/v2/ask-intel',            keywords: 'ai chat gpt question' },
  { label: 'Community Intel',        href: '/v2/community-intel',      keywords: 'community sentiment reddit comments' },
  { label: 'Influencer Intel',       href: '/v2/influencers',          keywords: 'athletes players influencers bubble' },
  { label: 'Campaign & Offer Intel', href: '/v2/campaign-offer-intel', keywords: 'campaign offer promotions deals' },
  { label: 'Product Intel',          href: '/v2/product-intel',        keywords: 'products paddles catalog' },
  { label: 'Sales Intel',            href: '/v2/sales-intel',          keywords: 'sales revenue market' },
  { label: 'Market Intel',           href: '/v2/market',               keywords: 'market share overview competitive' },
  { label: 'Correlations',           href: '/v2/correlations',         keywords: 'correlation analysis stats' },
  { label: 'Changepoints',           href: '/v2/changepoints',         keywords: 'changepoints anomaly trend detection' },
  { label: 'Data Health',            href: '/v2/data-health',          keywords: 'data quality health pipeline' },
  { label: 'Instagram',              href: '/v2/instagram',            keywords: 'instagram social ig posts reels' },
  { label: 'YouTube',                href: '/v2/youtube',              keywords: 'youtube video yt channel' },
  { label: 'Reddit',                 href: '/v2/reddit',               keywords: 'reddit community discussion' },
  { label: 'X / Twitter',           href: '/v2/twitter',              keywords: 'twitter x tweets social' },
  { label: 'TikTok',                 href: '/v2/tiktok',              keywords: 'tiktok short video social' },
]

const BRAND_SLUGS = [
  'joola', 'selkirk', 'paddletek', 'crbn', 'six-zero',
  'engage', 'onix', 'franklin', 'head', 'wilson', 'gamma',
]

const BRAND_DISPLAY_NAMES: Record<string, string> = {
  joola: 'JOOLA',
  selkirk: 'Selkirk',
  paddletek: 'Paddletek',
  crbn: 'CRBN',
  'six-zero': 'Six Zero',
  engage: 'Engage',
  onix: 'Onix',
  franklin: 'Franklin Pickleball',
  head: 'Head',
  wilson: 'Wilson',
  gamma: 'Gamma',
}

// ─── Types ───────────────────────────────────────────────────────────────────

type ResultKind = 'page' | 'brand' | 'athlete'

interface Result {
  kind: ResultKind
  label: string
  sub?: string
  href: string
  slug?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildAllResults(): Result[] {
  const pages: Result[] = PAGES.map(p => ({
    kind: 'page',
    label: p.label,
    href: p.href,
  }))

  const brands: Result[] = BRAND_SLUGS.map(slug => ({
    kind: 'brand',
    label: BRAND_DISPLAY_NAMES[slug] || slug,
    sub: slug,
    href: `/v2/brands/${slug}`,
    slug,
  }))

  const athletes: Result[] = SPONSORED_PLAYER_ROSTER.map(r => ({
    kind: 'athlete',
    label: r.player,
    sub: BRAND_DISPLAY_NAMES[r.brandSlug] || r.brandSlug,
    href: `/v2/influencers`,
    slug: r.brandSlug,
  }))

  return [...pages, ...brands, ...athletes]
}

const ALL_RESULTS = buildAllResults()

function filterResults(query: string): Result[] {
  if (!query.trim()) return ALL_RESULTS
  const q = query.toLowerCase()
  return ALL_RESULTS.filter(r => {
    if (r.label.toLowerCase().includes(q)) return true
    if (r.sub?.toLowerCase().includes(q)) return true
    // For pages, also check keywords
    if (r.kind === 'page') {
      const page = PAGES.find(p => p.href === r.href)
      if (page?.keywords?.toLowerCase().includes(q)) return true
    }
    return false
  })
}

function groupResults(results: Result[]): { pages: Result[]; brands: Result[]; athletes: Result[] } {
  return {
    pages:    results.filter(r => r.kind === 'page'),
    brands:   results.filter(r => r.kind === 'brand'),
    athletes: results.filter(r => r.kind === 'athlete'),
  }
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function GroupLabel({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 700,
      color: 'rgba(255,255,255,0.3)',
      textTransform: 'uppercase',
      letterSpacing: '0.12em',
      padding: '10px 16px 4px',
    }}>
      {label}
    </div>
  )
}

function ResultItem({
  result,
  selected,
  onHover,
  onClick,
}: {
  result: Result
  selected: boolean
  onHover: () => void
  onClick: () => void
}) {
  const color = result.slug ? (BRAND_COLORS[result.slug] || '#888') : undefined

  const icon = result.kind === 'page'
    ? (
      <span style={{
        width: 18,
        height: 18,
        borderRadius: 4,
        background: 'rgba(245,230,37,0.12)',
        border: '1px solid rgba(245,230,37,0.25)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: 9,
        color: '#F5E625',
        fontWeight: 700,
      }}>
        ⌘
      </span>
    )
    : (
      <span style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: color || 'rgba(255,255,255,0.3)',
        flexShrink: 0,
        boxShadow: color ? `0 0 6px ${color}55` : undefined,
      }} />
    )

  return (
    <div
      onMouseEnter={onHover}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 16px',
        cursor: 'pointer',
        background: selected ? 'rgba(255,255,255,0.07)' : 'transparent',
        borderRadius: 6,
        margin: '1px 6px',
        transition: 'background 80ms',
      }}
    >
      {icon}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: '#fff', fontSize: 13, fontWeight: result.kind === 'page' ? 600 : 400 }}>
          {result.label}
        </span>
        {result.sub && (
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginLeft: 8 }}>
            {result.sub}
          </span>
        )}
      </span>
      {result.kind === 'page' && (
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>
          page
        </span>
      )}
      {result.kind === 'brand' && (
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>
          brand
        </span>
      )}
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const results = filterResults(query)
  const grouped = groupResults(results)

  // Flat ordered list for keyboard nav
  const flatResults: Result[] = [
    ...grouped.pages,
    ...grouped.brands,
    ...grouped.athletes,
  ]

  // ── Open / close helpers ─────────────────────────────────────────────────

  const openPalette = useCallback(() => {
    setOpen(true)
    setQuery('')
    setSelectedIdx(0)
  }, [])

  const closePalette = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])

  const navigate = useCallback((result: Result) => {
    closePalette()
    router.push(result.href)
  }, [closePalette, router])

  // ── Global keyboard handler ──────────────────────────────────────────────

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName

      // Cmd+K / Ctrl+K — open palette regardless of focus
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (open) {
          closePalette()
        } else {
          openPalette()
        }
        return
      }

      // Shortcuts that only fire when NOT in an input/textarea
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
        || (e.target as HTMLElement).isContentEditable

      if (!inInput && !open) {
        if (e.key === 't' || e.key === 'T') {
          e.preventDefault()
          document.documentElement.classList.toggle('theme-light')
          return
        }
        if (e.key === 'c' || e.key === 'C') {
          e.preventDefault()
          document.documentElement.classList.toggle('density-compact')
          return
        }
      }

      // Keys that only matter when palette is open
      if (!open) return

      if (e.key === 'Escape') {
        e.preventDefault()
        closePalette()
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIdx(i => Math.min(i + 1, flatResults.length - 1))
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIdx(i => Math.max(i - 1, 0))
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        const result = flatResults[selectedIdx]
        if (result) navigate(result)
        return
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, flatResults, selectedIdx, navigate, openPalette, closePalette])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      // Defer by one frame to ensure DOM is ready
      const id = requestAnimationFrame(() => inputRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [open])

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIdx(0)
  }, [query])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const item = listRef.current.querySelectorAll<HTMLElement>('[data-result-item]')[selectedIdx]
    item?.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx])

  if (!open) return null

  const showPages    = grouped.pages.length > 0
  const showBrands   = grouped.brands.length > 0
  const showAthletes = grouped.athletes.length > 0
  const noResults    = flatResults.length === 0

  // Running index for flat navigation mapping
  let flatIdx = 0

  return (
    // Overlay
    <div
      onClick={closePalette}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(0,0,0,0.72)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      {/* Dialog */}
      <div
        onClick={e => e.stopPropagation()}
        className="cmd-dialog"
        style={{
          maxWidth: 580,
          width: '100%',
          background: 'var(--bg-2)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 14,
          boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
          margin: '15vh auto 0',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '60vh',
        }}
      >
        {/* Search row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          {/* Search icon */}
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" style={{ flexShrink: 0, opacity: 0.4 }}>
            <circle cx="6.5" cy="6.5" r="4.5" stroke="white" strokeWidth="1.4" />
            <line x1="10" y1="10" x2="14" y2="14" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search pages, brands, athletes…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              padding: '16px 4px',
              fontSize: 15,
              color: '#fff',
              outline: 'none',
            }}
          />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', flexShrink: 0, display: 'flex', gap: 4 }}>
            <kbd style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 5px', borderRadius: 4, fontFamily: 'inherit' }}>ESC</kbd>
          </span>
        </div>

        {/* Results list */}
        <div ref={listRef} style={{ overflowY: 'auto', flex: 1, padding: '6px 0' }}>
          {noResults && (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', padding: '32px 16px' }}>
              No results for &ldquo;{query}&rdquo;
            </div>
          )}

          {showPages && (
            <>
              <GroupLabel label="Pages" />
              {grouped.pages.map(r => {
                const idx = flatIdx++
                return (
                  <div key={`page-${r.href}`} data-result-item>
                    <ResultItem
                      result={r}
                      selected={selectedIdx === idx}
                      onHover={() => setSelectedIdx(idx)}
                      onClick={() => navigate(r)}
                    />
                  </div>
                )
              })}
            </>
          )}

          {showBrands && (
            <>
              <GroupLabel label="Brands" />
              {grouped.brands.map(r => {
                const idx = flatIdx++
                return (
                  <div key={`brand-${r.slug}`} data-result-item>
                    <ResultItem
                      result={r}
                      selected={selectedIdx === idx}
                      onHover={() => setSelectedIdx(idx)}
                      onClick={() => navigate(r)}
                    />
                  </div>
                )
              })}
            </>
          )}

          {showAthletes && (
            <>
              <GroupLabel label="Athletes" />
              {grouped.athletes.map((r, i) => {
                const idx = flatIdx++
                return (
                  <div key={`athlete-${r.label}-${r.slug}-${i}`} data-result-item>
                    <ResultItem
                      result={r}
                      selected={selectedIdx === idx}
                      onHover={() => setSelectedIdx(idx)}
                      onClick={() => navigate(r)}
                    />
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.06)',
          padding: '8px 16px',
          display: 'flex',
          gap: 16,
          alignItems: 'center',
          fontSize: 10,
          color: 'rgba(255,255,255,0.25)',
        }}>
          <span>
            <kbd style={{ background: 'rgba(255,255,255,0.07)', padding: '1px 4px', borderRadius: 3, fontFamily: 'inherit', marginRight: 4 }}>↑↓</kbd>
            navigate
          </span>
          <span>
            <kbd style={{ background: 'rgba(255,255,255,0.07)', padding: '1px 4px', borderRadius: 3, fontFamily: 'inherit', marginRight: 4 }}>↵</kbd>
            open
          </span>
          <span>
            <kbd style={{ background: 'rgba(255,255,255,0.07)', padding: '1px 4px', borderRadius: 3, fontFamily: 'inherit', marginRight: 4 }}>T</kbd>
            theme
          </span>
          <span>
            <kbd style={{ background: 'rgba(255,255,255,0.07)', padding: '1px 4px', borderRadius: 3, fontFamily: 'inherit', marginRight: 4 }}>C</kbd>
            density
          </span>
          <span style={{ marginLeft: 'auto' }}>{flatResults.length} results</span>
        </div>
      </div>
    </div>
  )
}
