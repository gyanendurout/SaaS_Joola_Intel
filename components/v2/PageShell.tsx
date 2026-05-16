'use client'

import { useState, useMemo, useEffect, useRef, type CSSProperties } from 'react'
import { BRAND_COLORS, type V2Brand } from '@/lib/v2/data'
import { Sparkline } from '@/components/v2/charts'
import { useBrandFilter } from '@/lib/v2/BrandFilterContext'

export function pgColor(slug: string): string {
  return BRAND_COLORS[slug] || '#888'
}

export function pgName(slug: string, brands: V2Brand[]): string {
  return brands.find((b) => b.id === slug)?.name || slug
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

export function PageHead({
  eyebrow, title, accent, sub, actions,
}: {
  eyebrow: string; title: string; accent: string; sub: string; actions?: React.ReactNode
}) {
  return (
    <header className="page-head">
      <div>
        <div className="eyebrow">
          <span style={{ width: 6, height: 6, borderRadius: 99, background: '#F5E625', boxShadow: '0 0 0 4px rgba(245,230,37,0.18)', display: 'inline-block' }} />
          {eyebrow}
        </div>
        <h1>{title} <em>{accent}</em></h1>
        <div className="sub">{sub}</div>
      </div>
      {actions && <div className="head-actions">{actions}</div>}
    </header>
  )
}

export function MiniKpi({
  label, value, delta, deltaPct, color, spark, src, customVs, flavor,
}: {
  label: string; value: string | number; delta?: number | null; deltaPct?: number | null;
  color?: string; spark?: number[]; src?: string; customVs?: string; flavor?: string
}) {
  const c = color || '#22c55e'
  return (
    <div className={'kpi ' + (flavor || '')}>
      <div className="label">
        <span>{label}</span>
        {src && <span className="src" title={src}>{src}</span>}
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
  const ref = useRef<HTMLSpanElement | null>(null)

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

  return (
    <span
      ref={ref}
      className={'section-info' + (pinned ? ' is-pinned' : '')}
      aria-label={title}
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); setPinned(p => !p) }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPinned(p => !p) } }}
    >
      ?
      <span className="si-popup" onClick={(e) => e.stopPropagation()}>
        <div className="si-title">{title}</div>
        <div className="si-body">{description}</div>
        <div className="si-source">Source: {source}</div>
      </span>
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

// ─── Sort-aware <th> ─────────────────────────────────────────────────
export function SortTh({
  col, label, sortKey, sortDir, toggle, style,
}: {
  col: string; label: string; sortKey: string | null; sortDir: 'asc' | 'desc';
  toggle: (k: string) => void; style?: CSSProperties
}) {
  const active = sortKey === col
  const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
  return (
    <th
      className={'sortable' + (active ? ' sort-' + sortDir : '')}
      onClick={() => toggle(col)}
      style={style}
      aria-sort={ariaSort}
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
  setTimeout(onDone, 2800)
  return (
    <div className={'toast' + (err ? ' toast-err' : '')}>
      <span className="toast-dot" />
      {msg}
    </div>
  )
}
