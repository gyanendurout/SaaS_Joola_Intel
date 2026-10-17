/**
 * Pure date-window helpers for the date picker.
 *
 * A "day" is an IST (Asia/Kolkata) calendar day as `YYYY-MM-DD`. Database
 * timestamps are UTC, so windows are converted to half-open UTC bounds
 * (`>= start of From`, `< start of the day after To`) for queries.
 *
 * IST is a fixed UTC+05:30 with no DST, so a constant offset is exact.
 * No function here reads the current time — callers pass the anchor day.
 */

export type IsoDay = string
export type Preset = '7d' | '30d' | '90d' | 'all'

export const ALL_TIME_START: IsoDay = '2000-01-01'

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const PRESET_DAYS: Record<Exclude<Preset, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 }
const PRESETS: readonly Preset[] = ['7d', '30d', '90d', 'all']

const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const MONTH_DAY_YEAR = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

/** UTC midnight of the given calendar day (used as a zone-free calendar value). */
function utcMidnight(day: IsoDay): number {
  return Date.parse(`${day}T00:00:00.000Z`)
}

/** The IST calendar day of instant `d`. */
export function isoDay(d: Date): IsoDay {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/** Calendar arithmetic: `day` shifted by `n` days (n may be negative). */
export function addDays(day: IsoDay, n: number): IsoDay {
  return new Date(utcMidnight(day) + n * DAY_MS).toISOString().slice(0, 10)
}

/** Half-open UTC bounds covering IST days From..To inclusive. Swaps reversed input. */
export function toQueryBounds(from: IsoDay, to: IsoDay): { gte: string; lt: string } {
  const [start, end] = from <= to ? [from, to] : [to, from]
  return {
    gte: new Date(utcMidnight(start) - IST_OFFSET_MS).toISOString(),
    lt: new Date(utcMidnight(addDays(end, 1)) - IST_OFFSET_MS).toISOString(),
  }
}

/** The window a preset button selects, ending on `anchor` inclusive. */
export function presetWindow(p: Preset, anchor: IsoDay): { from: IsoDay; to: IsoDay } {
  if (p === 'all') return { from: ALL_TIME_START, to: anchor }
  return { from: addDays(anchor, -(PRESET_DAYS[p] - 1)), to: anchor }
}

/** Which preset (if any) exactly matches the window. */
export function matchPreset(from: IsoDay, to: IsoDay, anchor: IsoDay): Preset | null {
  for (const p of PRESETS) {
    const w = presetWindow(p, anchor)
    if (w.from === from && w.to === to) return p
  }
  return null
}

/** Human label, e.g. 'Jul 14 – Oct 12, 2026' or 'All time to Oct 12, 2026'. */
export function formatWindow(from: IsoDay, to: IsoDay): string {
  const toLabel = MONTH_DAY_YEAR.format(utcMidnight(to))
  if (from === ALL_TIME_START) return `All time to ${toLabel}`
  if (from === to) return toLabel
  const sameYear = from.slice(0, 4) === to.slice(0, 4)
  const fromLabel = (sameYear ? MONTH_DAY : MONTH_DAY_YEAR).format(utcMidnight(from))
  return `${fromLabel} – ${toLabel}`
}

/** Strict `YYYY-MM-DD` that names a real calendar day. */
export function isValidIsoDay(s: unknown): s is IsoDay {
  if (typeof s !== 'string' || !ISO_DAY_RE.test(s)) return false
  const t = utcMidnight(s)
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s
}
