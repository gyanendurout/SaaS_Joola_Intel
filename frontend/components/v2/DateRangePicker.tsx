'use client'

import { useDateRange } from '@/lib/v2/DateRangeContext'
import { isValidIsoDay, matchPreset, type IsoDay, type Preset } from '@/lib/v2/dateWindow'

const PRESET_BUTTONS: ReadonlyArray<{ p: Preset; label: string; title: string }> = [
  { p: '7d', label: '7D', title: 'Last 7 days of data' },
  { p: '30d', label: '30D', title: 'Last 30 days of data' },
  { p: '90d', label: '90D', title: 'Last 90 days of data' },
  { p: 'all', label: 'ALL', title: 'All available data' },
]

const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function formatMonthDay(day: IsoDay): string {
  return MONTH_DAY.format(Date.parse(`${day}T00:00:00Z`))
}

export function DateRangePicker() {
  const { from, to, setWindow, applyPreset, anchor, today, latestDataDate } = useDateRange()
  const active = matchPreset(from, to, anchor)

  return (
    <div className="drd-bar">
      <div className="drd-presets" role="group" aria-label="Quick date ranges">
        {PRESET_BUTTONS.map(({ p, label, title }) => (
          <button
            key={p}
            type="button"
            className={'drd-preset' + (active === p ? ' is-active' : '')}
            aria-pressed={active === p}
            title={title}
            onClick={() => applyPreset(p)}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className={'drd-wrap' + (active === null ? ' is-filtered' : '')}
        role="group"
        aria-label="Date range"
      >
        <div className="drd-segment">
          <label className="drd-label-inline" htmlFor="v2-date-from">From</label>
          <input
            id="v2-date-from"
            type="date"
            className="drd-date"
            value={from}
            max={to}
            onChange={(e) => {
              const v = e.target.value
              if (isValidIsoDay(v)) setWindow(v, to)
            }}
            aria-label="From date"
          />
        </div>

        <span className="drd-arrow" aria-hidden="true">→</span>

        <div className="drd-segment">
          <label className="drd-label-inline" htmlFor="v2-date-to">To</label>
          <input
            id="v2-date-to"
            type="date"
            className="drd-date"
            value={to}
            min={from}
            max={today}
            onChange={(e) => {
              const v = e.target.value
              if (isValidIsoDay(v) && v <= today) setWindow(from, v)
            }}
            aria-label="To date"
          />
        </div>
      </div>

      {latestDataDate && (
        <span className="drd-hint" title="Latest data refresh">
          Data through {formatMonthDay(latestDataDate)}
        </span>
      )}
    </div>
  )
}
