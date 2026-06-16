'use client'

import type { CSSProperties } from 'react'

interface TableSearchProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  width?: number | string
}

/**
 * Standardized text-search input for tables. Drop it directly above a
 * `<div className="table-wrap">` block. Reuses the existing
 * `.col-filter-input` styling so it visually matches the per-column
 * filters inside the table headers.
 */
export function TableSearch({
  value,
  onChange,
  placeholder = 'Search…',
  width = 240,
}: TableSearchProps) {
  const wrapStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    margin: '0 0 10px 0',
    background: 'rgba(0,0,0,0.25)',
    border: '1px solid var(--wb-10)',
    borderRadius: 6,
    width: typeof width === 'number' ? `${width}px` : width,
    maxWidth: '100%',
  }
  const inputStyle: CSSProperties = {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'var(--fg-2)',
    fontFamily: 'var(--font-sans, system-ui, sans-serif)',
    fontSize: 12,
    fontWeight: 500,
    padding: '2px 0',
  }
  return (
    <div className="table-search" style={wrapStyle}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ color: 'var(--fg-4)', flexShrink: 0 }}>
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
        aria-label={placeholder}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--fg-4)',
            cursor: 'pointer',
            padding: 0,
            fontSize: 14,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ×
        </button>
      )}
    </div>
  )
}
