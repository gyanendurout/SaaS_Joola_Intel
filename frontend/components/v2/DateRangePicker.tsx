'use client'

import { useDateRange } from '@/lib/v2/DateRangeContext'

function toInputValue(d: Date): string {
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

  const todayStr = toInputValue(new Date())

  // Clamp a stale "To" date that somehow ended up in the future
  const clampedTo = customTo > new Date() ? new Date() : customTo

  return (
    <div
      className={'drd-wrap' + (isFiltered ? ' is-filtered' : '')}
      role="group"
      aria-label="Date range"
    >
      {/* From segment */}
      <div className="drd-segment">
        <label className="drd-label-inline" htmlFor="v2-date-from">From</label>
        <input
          id="v2-date-from"
          type="date"
          className="drd-date"
          value={toInputValue(customFrom)}
          max={toInputValue(clampedTo)}
          onChange={(e) => {
            const d = fromInputValue(e.target.value)
            if (d) setCustomFrom(d)
          }}
          aria-label="From date"
        />
      </div>

      {/* Divider */}
      <span className="drd-arrow" aria-hidden="true">→</span>

      {/* To segment */}
      <div className="drd-segment">
        <label className="drd-label-inline" htmlFor="v2-date-to">To</label>
        <input
          id="v2-date-to"
          type="date"
          className="drd-date"
          value={toInputValue(clampedTo)}
          min={toInputValue(customFrom)}
          max={todayStr}
          onChange={(e) => {
            const d = fromInputValue(e.target.value)
            if (d) setCustomTo(d)
          }}
          aria-label="To date"
        />
      </div>
    </div>
  )
}
