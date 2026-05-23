'use client'

import { useDateRange } from '@/lib/v2/DateRangeContext'

/**
 * Top-right "From → To" calendar date picker. Replaces the preset-only
 * `<DateRangeDropdown />`. Mounted once in `app/v2/layout.tsx` so it
 * sits in the topbar across every v2 page.
 *
 * Reuses the existing `.drd-wrap` / `.drd-select` CSS so the topbar
 * visually stays unified with the brand-filter dropdown next to it.
 */
function toInputValue(d: Date): string {
  // Build YYYY-MM-DD in local time so the <input type="date"> reflects
  // what the user actually picked (toISOString() yields UTC and can shift
  // a day across the date line).
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fromInputValue(s: string): Date | null {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return null
  const out = new Date(y, m - 1, d)
  out.setHours(0, 0, 0, 0)
  return Number.isNaN(out.getTime()) ? null : out
}

export function DateRangePicker() {
  const { customFrom, customTo, setCustomFrom, setCustomTo, mode } = useDateRange()
  const isFiltered = mode === 'custom'

  return (
    <div className="drd-wrap" role="group" aria-label="Date range">
      <svg className="drd-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 3v4M16 3v4" />
      </svg>
      <label className="drd-label-inline" htmlFor="v2-date-from">From</label>
      <input
        id="v2-date-from"
        type="date"
        className={'drd-select drd-date' + (isFiltered ? ' is-filtered' : '')}
        value={toInputValue(customFrom)}
        max={toInputValue(customTo)}
        onChange={(e) => {
          const d = fromInputValue(e.target.value)
          if (d) setCustomFrom(d)
        }}
        aria-label="From date"
      />
      <span className="drd-arrow" aria-hidden="true">→</span>
      <label className="drd-label-inline" htmlFor="v2-date-to">To</label>
      <input
        id="v2-date-to"
        type="date"
        className={'drd-select drd-date' + (isFiltered ? ' is-filtered' : '')}
        value={toInputValue(customTo)}
        min={toInputValue(customFrom)}
        onChange={(e) => {
          const d = fromInputValue(e.target.value)
          if (d) setCustomTo(d)
        }}
        aria-label="To date"
      />
    </div>
  )
}
