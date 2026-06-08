'use client'

import { useState, useMemo, useEffect, useRef, type CSSProperties } from 'react'
import { BRAND_COLORS, type V2Brand } from '@/lib/v2/data'
import { Sparkline } from '@/components/v2/charts'
import { useBrandFilter } from '@/lib/v2/BrandFilterContext'

export function pgColor(slug: string): string {
  return BRAND_COLORS[slug] || '#888'
}

/**
 * UI-only brand display-name override map.
 *
 * Keep this list short — it's the right place for *display* rebrands
 * (e.g. "Franklin Sports" → "Franklin Pickleball") that we do NOT want
 * to push into the database/seed migrations. The map is keyed by brand
 * slug, so any UI surface that asks for a brand label by slug picks up
 * the override automatically via `pgName()`.
 */
const BRAND_DISPLAY_OVERRIDES: Record<string, string> = {
  franklin: 'Franklin Pickleball',
}

export function displayBrandName(slug: string, fallback: string): string {
  return BRAND_DISPLAY_OVERRIDES[slug] || fallback
}

export function pgName(slug: string, brands: V2Brand[]): string {
  const fallback = brands.find((b) => b.id === slug)?.name || slug
  return displayBrandName(slug, fallback)
}

export function BrandPill({ slug, brands }: { slug: string; brands: V2Brand[] }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span className="brand-dot" style={{ background: pgColor(slug) }} />
      <span style={{ fontWeight: 700, color: slug === 'joola' ? '#22c55e' : 'var(--fg)', fontSize: 12 }}>
        {pgName(slug, brands)}
      </span>
    </span>
  )
}

interface PageHeadProps {
  title: string
  eyebrow?: string
  accent?: string
  sub?: string
  actions?: React.ReactNode
}

export function PageHead({ eyebrow, title, accent, sub, actions }: PageHeadProps) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && (
          <div className="eyebrow">
            <span style={{ width: 6, height: 6, borderRadius: 99, background: '#F5E625', boxShadow: '0 0 0 4px rgba(245,230,37,0.18)', display: 'inline-block' }} />
            {eyebrow}
          </div>
        )}
        <h1>{title}{accent && <> <em>{accent}</em></>}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="head-actions">{actions}</div>}
    </header>
  )
}

export function MiniKpi({
  label, value, delta, deltaPct, color, spark, src, customVs, flavor, tip,
}: {
  label: string; value: string | number; delta?: number | null; deltaPct?: number | null;
  color?: string; spark?: number[]; src?: string; customVs?: string; flavor?: string; tip?: string
}) {
  const c = color || '#22c55e'
  return (
    <div className={'kpi ' + (flavor || '')} title={tip}>
      <div className="label">
        <span>{label}</span>
        {tip && <SectionInfo title={label} description={tip} source={src || 'Live data'} />}
        {src && !tip && <span className="src" title={src}>{src}</span>}
      </div>
      <div className="row">
        <div className="value">{value}</div>
        {spark && spark.length > 0 && (
          <div className="spark">
            <Sparkline data={spark} color={c} />
          </div>
        )}
      </div>
      {delta !== undefined && delta !== null && (
        <div className={'delta ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat')}>
          {delta > 0 ? '▲' : delta < 0 ? '▼' : '▬'} {Math.abs(delta).toLocaleString()}
          {deltaPct !== undefined && deltaPct !== null && ` (${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%)`}
          <span className="vs">{customVs || 'vs. last wk'}</span>
        </div>
      )}
      {delta === undefined && customVs && (
        <div className="delta flat"><span className="vs">{customVs}</span></div>
      )}
    </div>
  )
}

// ─── Skeleton loading page ────────────────────────────────────────────
export function LoadingPage() {
  return (
    <div className="skeleton-page">
      <div className="sk-header" style={{ paddingBottom: 24, marginBottom: 24, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="skel sk-h12" style={{ width: 160, marginBottom: 12 }} />
        <div className="skel sk-h24" style={{ width: 320, marginBottom: 10 }} />
        <div className="skel sk-h12" style={{ width: 440 }} />
      </div>
      <div className="sk-kpis">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skel sk-h80" style={{ animationDelay: i * 0.06 + 's' }} />
        ))}
      </div>
      <div className="skel sk-h160" style={{ marginTop: 20, animationDelay: '0.2s' }} />
      <div className="sk-cards" style={{ marginTop: 14 }}>
        <div className="skel sk-h160" style={{ animationDelay: '0.25s' }} />
        <div className="skel sk-h160" style={{ animationDelay: '0.3s' }} />
      </div>
    </div>
  )
}

// ─── Section info tooltip (? icon) ───────────────────────────────────
export function SectionInfo({ title, description, source }: {
  title: string; description: string; source: string
}) {
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const ref = useRef<HTMLSpanElement | null>(null)

  const visible = pinned || hovered

  useEffect(() => {
    if (!pinned) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setPinned(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPinned(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [pinned])

  function calcPos() {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    const popupW = 268
    // Center popup on the icon, then clamp so it never overflows viewport edges
    const left = Math.max(8, Math.min(
      r.left + r.width / 2 - popupW / 2,
      window.innerWidth - popupW - 8,
    ))
    setPos({ left, top: r.bottom + 10 })
  }

  return (
    <span
      ref={ref}
      className={'section-info' + (visible ? ' is-pinned' : '')}
      aria-label={title}
      role="button"
      tabIndex={0}
      onMouseEnter={() => { calcPos(); setHovered(true) }}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => { e.stopPropagation(); calcPos(); setPinned(p => !p) }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          calcPos()
          setPinned(p => !p)
        }
      }}
    >
      ?
      {visible && (
        <span
          className="si-popup"
          style={{ position: 'fixed', left: pos.left, top: pos.top, transform: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="si-title">{title}</div>
          <div className="si-body">{description}</div>
          <div className="si-source">Source: {source}</div>
        </span>
      )}
    </span>
  )
}

// ─── Sortable table hook ──────────────────────────────────────────────
export function useSortTable<T extends Record<string, unknown>>(data: T[]) {
  const [sortKey, setSortKey] = useState<keyof T | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const sorted = useMemo(() => {
    if (!sortKey) return data
    return [...data].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av
      }
      const as = String(av ?? ''), bs = String(bv ?? '')
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
    })
  }, [data, sortKey, sortDir])

  function toggle(key: keyof T) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  return { sorted, sortKey, sortDir, toggle }
}

// ─── Per-column filter input (case-insensitive substring) ───────────
//
// Usage pattern (see app/v2/twitter & app/v2/tiktok for full example):
//
//   const [colFilter, setColFilter] = useState<Record<string, string>>({})
//   ...
//   <thead>
//     <tr>{ /* SortTh row */ }</tr>
//     <tr className="col-filter-row">
//       <th><ColumnFilter col="brand" value={colFilter.brand}
//                         onChange={v => setColFilter(p => ({...p, brand: v}))} /></th>
//       <th><ColumnFilter col="text" .../></th>
//       <th colSpan={4} />
//     </tr>
//   </thead>
//
//   // Filter rows before mapping:
//   const filtered = rows.filter(r => Object.entries(colFilter).every(([k, q]) =>
//     !q || String((r as any)[k] ?? '').toLowerCase().includes(q.toLowerCase())))
//
// Adopt on other table pages (instagram, youtube, reddit, ads, comments,
// influencers) by repeating the same shape.
export function ColumnFilter({
  col, value, onChange, placeholder,
}: {
  col: string; value?: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <input
      type="text"
      className="col-filter-input"
      placeholder={placeholder || 'filter…'}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Filter ${col}`}
    />
  )
}

// ─── Sort-aware <th> ─────────────────────────────────────────────────
export function SortTh({
  col, label, sortKey, sortDir, toggle, style, title,
}: {
  col: string; label: string; sortKey: string | null; sortDir: 'asc' | 'desc';
  toggle: (k: string) => void; style?: CSSProperties; title?: string
}) {
  const active = sortKey === col
  const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
  return (
    <th
      className={'sortable' + (active ? ' sort-' + sortDir : '')}
      onClick={() => toggle(col)}
      style={style}
      aria-sort={ariaSort}
      title={title}
    >
      <span className="sort-ic">
        {label}
        <span className="sort-arrows" aria-hidden="true">
          <span className="arr-up">▲</span>
          <span className="arr-down">▼</span>
        </span>
      </span>
    </th>
  )
}

// ─── Export to CSV helper ─────────────────────────────────────────────
export function exportCSV(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return
  const cols = Object.keys(rows[0])
  const lines = [
    cols.join(','),
    ...rows.map((r) =>
      cols.map((c) => {
        const v = r[c]
        const s = v == null ? '' : String(v)
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? '"' + s.replace(/"/g, '""') + '"'
          : s
      }).join(',')
    ),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ─── Active filter banner (shown at top of each page) ────────────────
export function FilterBanner() {
  const { filteredBrands, isFiltered, setSelectedSlugs } = useBrandFilter()
  if (!isFiltered) return null
  return (
    <div className="filter-banner">
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
        Showing
      </span>
      <span className="fb-brands">
        {filteredBrands.map(b => (
          <span key={b.id} className="fb-pill">
            <span style={{ width: 6, height: 6, borderRadius: 99, background: b.color, display: 'inline-block' }} />
            {b.name}
          </span>
        ))}
      </span>
      <button className="fb-clear" onClick={() => setSelectedSlugs([])}>× Clear filter</button>
    </div>
  )
}

// ─── Toast helper ─────────────────────────────────────────────────────
export function Toast({ msg, onDone, err }: { msg: string; onDone: () => void; err?: boolean }) {
  setTimeout(onDone, 1500)
  return (
    <div className={'toast' + (err ? ' toast-err' : '')}>
      <span className="toast-dot" />
      {msg}
    </div>
  )
}
