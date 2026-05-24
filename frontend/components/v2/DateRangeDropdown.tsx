'use client'

import { useDateRange, DATE_RANGE_LABEL, type DateRangeKey } from '@/lib/v2/DateRangeContext'

/**
 * Top-right date-range selector. Mounted once in `app/v2/layout.tsx` next to
 * `<BrandFilterDropdown />` so it's a global control across every v2 page.
 *
 * Pages that respect the range pull `maxDays` from `useDateRange()` and run
 * arrays of `{ days: number }` rows through `applyDateRange()`. Pages that
 * don't yet consume it are unaffected — opt-in by design.
 */
export function DateRangeDropdown() {
  const { range, setRange } = useDateRange()

  const isFiltered = range !== 'all'

  return (
    <div className="drd-wrap">
      <svg className="drd-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 3v4M16 3v4" />
      </svg>
      <select
        className={'drd-select' + (isFiltered ? ' is-filtered' : '')}
        value={range}
        onChange={e => setRange(e.target.value as DateRangeKey)}
        aria-label={`Date range: ${DATE_RANGE_LABEL[range]}`}
      >
        {(Object.keys(DATE_RANGE_LABEL) as DateRangeKey[]).map(k => (
          <option key={k} value={k}>{DATE_RANGE_LABEL[k]}</option>
        ))}
      </select>
    </div>
  )
}
