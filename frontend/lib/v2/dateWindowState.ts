/**
 * Pure state logic behind DateRangeContext: parsing the persisted window,
 * choosing the initial window, and deriving the deprecated compat fields
 * (range / maxDays / mode / effectiveFrom / effectiveTo) from a From–To
 * window. No React, no storage access, no clock reads — callers pass
 * `today` / `anchor` / `now`.
 */

import {
  ALL_TIME_START,
  addDays,
  isValidIsoDay,
  matchPreset,
  normalizeWindow,
  presetWindow,
  toQueryBounds,
  type IsoDay,
} from './dateWindow'

export const STORAGE_KEY = 'joola-window-v2'
export const LEGACY_KEYS: readonly string[] = [
  'joola-date-range',
  'joola-date-mode',
  'joola-date-from',
  'joola-date-to',
]

/**
 * @deprecated Legacy preset key. `'custom'` means the window matches no
 * preset. Use `from` / `to` from `useDateRange()` instead.
 */
export type DateRangeKey = '7d' | '30d' | '90d' | '6mo' | '1y' | 'all' | 'custom'
/** @deprecated Use `from` / `to` and `matchPreset` instead. */
export type DateRangeMode = 'preset' | 'custom'

export type DayWindow = { from: IsoDay; to: IsoDay }

const DAY_MS = 24 * 60 * 60 * 1000
const LEGACY_LONG_DAYS = { '6mo': 180, '1y': 365 } as const

/** Whole calendar days from `a` to `b` (b - a). */
function dayDiff(a: IsoDay, b: IsoDay): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)
}

/** Validated `{from, to}` from the raw STORAGE_KEY value, or null. */
export function parseStoredWindow(raw: string | null): DayWindow | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const { from, to } = parsed as { from?: unknown; to?: unknown }
  if (!isValidIsoDay(from) || !isValidIsoDay(to)) return null
  return normalizeWindow(from as IsoDay, to as IsoDay)
}

/** Stored window if any (user-chosen), else the default 90 days ending on the anchor. */
export function initialWindow(
  stored: DayWindow | null,
  anchor: IsoDay,
): DayWindow & { userChosen: boolean } {
  if (stored) return { ...stored, userChosen: true }
  return { ...presetWindow('90d', anchor), userChosen: false }
}

/** Legacy key for a window: a shared preset, the old 6mo / 1y spans, or 'custom'. */
function legacyKeyFor(from: IsoDay, to: IsoDay, anchor: IsoDay): DateRangeKey {
  const preset = matchPreset(from, to, anchor)
  if (preset) return preset
  if (to === anchor) {
    const span = dayDiff(from, to) + 1
    if (span === LEGACY_LONG_DAYS['6mo']) return '6mo'
    if (span === LEGACY_LONG_DAYS['1y']) return '1y'
  }
  return 'custom'
}

export type CompatFields = {
  effectiveFrom: Date
  effectiveTo: Date
  maxDays: number | null
  range: DateRangeKey
  mode: DateRangeMode
}

/**
 * Deprecated fields derived from the window.
 * - effectiveFrom: instant of IST midnight of From.
 * - effectiveTo: last millisecond of the To day in IST, so `.lte()` callers
 *   include the whole To day.
 * - maxDays: inclusive days from From to `today` (null for all time), so
 *   day-age filters (`days <= maxDays`) reach back to From.
 * - range / mode: matched against `anchor` (defaults to `today`).
 */
export function compatFields(
  from: IsoDay,
  to: IsoDay,
  today: IsoDay,
  anchor: IsoDay = today,
): CompatFields {
  const win = normalizeWindow(from, to)
  const { gte, lt } = toQueryBounds(win.from, win.to)
  const range = legacyKeyFor(win.from, win.to, anchor)
  return {
    effectiveFrom: new Date(gte),
    effectiveTo: new Date(Date.parse(lt) - 1),
    maxDays: win.from === ALL_TIME_START ? null : Math.max(1, dayDiff(win.from, today) + 1),
    range,
    mode: range === 'custom' ? 'custom' : 'preset',
  }
}

/** Window for a legacy `setRange(key)` call; null for 'custom' (nothing to apply). */
export function presetFromLegacyKey(k: DateRangeKey, anchor: IsoDay): DayWindow | null {
  switch (k) {
    case '7d':
    case '30d':
    case '90d':
    case 'all':
      return presetWindow(k, anchor)
    case '6mo':
    case '1y':
      return { from: addDays(anchor, -(LEGACY_LONG_DAYS[k] - 1)), to: anchor }
    default:
      return null
  }
}

/**
 * Keep rows (each carrying `days` = whole days since posted, measured from
 * `now`) whose posting instant falls between `from` and `to` (either order).
 */
export function filterRowsByWindow<T extends { days: number }>(
  rows: T[],
  from: Date,
  to: Date,
  now: number,
): T[] {
  const a = Math.floor((now - from.getTime()) / DAY_MS)
  const b = Math.floor((now - to.getTime()) / DAY_MS)
  const upper = Math.max(a, b)
  const lower = Math.max(0, Math.min(a, b))
  return rows.filter((r) => r.days >= lower && r.days <= upper)
}
