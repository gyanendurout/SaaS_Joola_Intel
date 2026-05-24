'use client'

import { useState, useEffect, useRef } from 'react'
import { useBrandFilter } from '@/lib/v2/BrandFilterContext'

/**
 * Top-right floating brand filter dropdown.
 *
 * Replaces the old left-sidebar `<BrandFilter />` panel. Mounted once in
 * `app/v2/layout.tsx` so it sits on top of every v2 page.
 *
 * Logic is identical to the previous sidebar filter — checkbox list with
 * "only" shortcut, clear button, and select-all. We just render it as a
 * popover anchored to a header button.
 */
export function BrandFilterDropdown() {
  const { allBrands, selectedSlugs, setSelectedSlugs } = useBrandFilter()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click + Esc
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (allBrands.length === 0) return null

  const isFiltered = selectedSlugs.length > 0 && selectedSlugs.length < allBrands.length
  const activeCount = isFiltered ? selectedSlugs.length : allBrands.length

  function toggle(slug: string) {
    if (selectedSlugs.includes(slug)) {
      setSelectedSlugs(selectedSlugs.filter(s => s !== slug))
    } else {
      setSelectedSlugs([...selectedSlugs, slug])
    }
  }

  function selectAll() { setSelectedSlugs([]) }
  function selectOnly(slug: string) { setSelectedSlugs([slug]) }

  const buttonLabel = isFiltered
    ? `${activeCount} of ${allBrands.length} brands`
    : `All ${allBrands.length} brands`

  return (
    <div className="bfd-wrap" ref={wrapRef}>
      <button
        className={'bfd-trigger' + (open ? ' is-open' : '') + (isFiltered ? ' is-filtered' : '')}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Brand filter: ${buttonLabel}`}
        title={buttonLabel}
      >
        <svg className="bfd-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 5h18M6 12h12M10 19h4" />
        </svg>
        <span className="bfd-label">{buttonLabel}</span>
        <span className="bfd-chev" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="bfd-popover" role="dialog" aria-label="Filter brands">
          <div className="bfd-head">
            <span className="bfd-title">BRANDS</span>
            <span className={'bfd-count' + (isFiltered ? ' is-active' : '')}>
              {activeCount}/{allBrands.length}
            </span>
            {isFiltered && (
              <button className="bfd-clear" onClick={selectAll} title="Clear filter">× Clear</button>
            )}
          </div>
          <div className="bfd-list">
            {allBrands.map(b => {
              const checked = !isFiltered || selectedSlugs.includes(b.id)
              const isLastSelected = checked && selectedSlugs.length === 1 && selectedSlugs.includes(b.id)
              return (
                <label
                  key={b.id}
                  className={'bfd-item' + (checked ? ' is-on' : '')}
                  title={isLastSelected ? 'Removing last selection resets to all brands' : b.name}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(b.id)}
                    className="bfd-check"
                  />
                  <span className="brand-dot" style={{ background: b.color, flexShrink: 0 }} />
                  <span className="bfd-name">{b.name}</span>
                  <button
                    className="bfd-only"
                    onClick={(e) => { e.preventDefault(); selectOnly(b.id) }}
                    title={`Show only ${b.name}`}
                  >only</button>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
