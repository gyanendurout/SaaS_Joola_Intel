'use client'

/**
 * Dashboard-wide date window: one From–To pair of IST days that every page
 * follows. The default is the 90 days ending on the latest data date
 * (`rpc_latest_data_date`), falling back to today (IST) when unknown.
 *
 * Persistence: STORAGE_KEY is written only after the user changes the
 * window, so the default keeps following new data until then.
 *
 * The deprecated fields (range, maxDays, mode, customFrom, ...) are derived
 * from the window so older pages keep working; new code should read
 * `from` / `to` / `bounds` / `label`.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/shared/supabase'
import {
  formatWindow,
  isValidIsoDay,
  isoDay,
  normalizeWindow,
  presetWindow,
  toQueryBounds,
  type IsoDay,
  type Preset,
} from './dateWindow'
import {
  LEGACY_KEYS,
  STORAGE_KEY,
  compatFields,
  filterRowsByWindow,
  parseStoredWindow,
  presetFromLegacyKey,
  type DateRangeKey,
  type DateRangeMode,
  type DayWindow,
} from './dateWindowState'

export type { DateRangeKey, DateRangeMode } from './dateWindowState'

type DateRangeCtx = {
  /** First IST day of the window (inclusive). */
  from: IsoDay
  /** Last IST day of the window (inclusive). */
  to: IsoDay
  /** Set an explicit window; invalid days are ignored, reversed ones swapped. */
  setWindow: (from: IsoDay, to: IsoDay) => void
  /** Select a preset window ending on `anchor`. */
  applyPreset: (p: Preset) => void
  /** Latest day with data, or null while loading / unknown. */
  latestDataDate: IsoDay | null
  /** Day presets end on: latestDataDate ?? today (IST). */
  anchor: IsoDay
  /** Today in IST. */
  today: IsoDay
  /** Human label, e.g. 'Jul 14 – Oct 12, 2026'. */
  label: string
  /** Half-open UTC bounds: `>= gte` and `< lt` (lt is EXCLUSIVE). */
  bounds: { gte: string; lt: string }

  /** @deprecated Legacy preset key ('custom' when no preset matches). Use `from` / `to`. */
  range: DateRangeKey
  /** @deprecated Use `applyPreset` / `setWindow`. */
  setRange: (r: DateRangeKey) => void
  /** @deprecated Inclusive days from From to today; null for all time. Use `bounds`. */
  maxDays: number | null
  /** @deprecated 'preset' when the window matches a preset. Use `matchPreset`. */
  mode: DateRangeMode
  /** @deprecated Same as `effectiveFrom`. Use `from`. */
  customFrom: Date
  /** @deprecated Same as `effectiveTo`. Use `to`. */
  customTo: Date
  /** @deprecated Use `setWindow(isoDay(d), to)`. */
  setCustomFrom: (d: Date) => void
  /** @deprecated Use `setWindow(from, isoDay(d))`. */
  setCustomTo: (d: Date) => void
  /** @deprecated IST midnight of From. Use `bounds.gte`. */
  effectiveFrom: Date
  /** @deprecated Last millisecond of the To day (IST). Use `bounds.lt` with `<`. */
  effectiveTo: Date
}

/** @deprecated Labels for the legacy preset keys. Use `label` from `useDateRange()`. */
export const DATE_RANGE_LABEL: Record<DateRangeKey, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '6mo': 'Last 6 months',
  '1y': 'Last 12 months',
  'all': 'All time',
  'custom': 'Custom range',
}

// ─── Latest data date (fetched once per browser session) ───────────────
let latestDataDateCache: Promise<IsoDay | null> | null = null

/** Latest data day from the DB, or null on error / no data. Never rejects. */
function fetchLatestDataDate(): Promise<IsoDay | null> {
  if (latestDataDateCache) return latestDataDateCache
  latestDataDateCache = (async () => {
    try {
      const { data, error } = await supabase.rpc('rpc_latest_data_date')
      if (error) return null
      const day = typeof data === 'string' ? data.slice(0, 10) : null
      return day && isValidIsoDay(day) ? day : null
    } catch {
      return null
    }
  })()
  return latestDataDateCache
}

// ─── Storage helpers (all failures are non-fatal) ──────────────────────
function readStored(): DayWindow | null {
  try {
    return parseStoredWindow(localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

function writeStored(win: DayWindow): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(win))
  } catch {}
}

function clearLegacyKeys(): void {
  try {
    for (const k of LEGACY_KEYS) localStorage.removeItem(k)
  } catch {}
}

type WindowState = DayWindow & { userChosen: boolean }

function defaultState(anchor: IsoDay): WindowState {
  return { ...presetWindow('90d', anchor), userChosen: false }
}

function buildValue(
  win: DayWindow,
  today: IsoDay,
  latestDataDate: IsoDay | null,
  setters: Pick<DateRangeCtx, 'setWindow' | 'applyPreset' | 'setRange' | 'setCustomFrom' | 'setCustomTo'>,
): DateRangeCtx {
  const anchor = latestDataDate ?? today
  const c = compatFields(win.from, win.to, today, anchor)
  return {
    from: win.from,
    to: win.to,
    latestDataDate,
    anchor,
    today,
    label: formatWindow(win.from, win.to),
    bounds: toQueryBounds(win.from, win.to),
    range: c.range,
    maxDays: c.maxDays,
    mode: c.mode,
    customFrom: c.effectiveFrom,
    customTo: c.effectiveTo,
    effectiveFrom: c.effectiveFrom,
    effectiveTo: c.effectiveTo,
    ...setters,
  }
}

const noop = () => {}
const MODULE_TODAY = isoDay(new Date())
const DateRangeContext = createContext<DateRangeCtx>(
  buildValue(defaultState(MODULE_TODAY), MODULE_TODAY, null, {
    setWindow: noop,
    applyPreset: noop,
    setRange: noop,
    setCustomFrom: noop,
    setCustomTo: noop,
  }),
)

export function DateRangeProvider({ children }: { children: ReactNode }) {
  // Deterministic start (today's 90d window); storage + anchor load in an effect.
  const [today] = useState<IsoDay>(() => isoDay(new Date()))
  const [win, setWin] = useState<WindowState>(() => defaultState(today))
  const [latestDataDate, setLatestDataDate] = useState<IsoDay | null>(null)
  const anchor = latestDataDate ?? today

  useEffect(() => {
    let cancelled = false
    clearLegacyKeys()
    const stored = readStored()
    if (stored) setWin({ ...stored, userChosen: true })
    fetchLatestDataDate().then((day) => {
      if (cancelled) return
      setLatestDataDate(day)
      // Re-derive the default window only if the user never chose one.
      setWin((prev) => (prev.userChosen ? prev : defaultState(day ?? today)))
    })
    return () => { cancelled = true }
  }, [today])

  // Persist only user-chosen windows.
  useEffect(() => {
    if (win.userChosen) writeStored({ from: win.from, to: win.to })
  }, [win])

  const setWindow = useCallback((from: IsoDay, to: IsoDay) => {
    if (!isValidIsoDay(from) || !isValidIsoDay(to)) return
    const next = normalizeWindow(from, to)
    setWin((prev) =>
      prev.userChosen && prev.from === next.from && prev.to === next.to ? prev : { ...next, userChosen: true },
    )
  }, [])

  const applyPreset = useCallback(
    (p: Preset) => {
      const w = presetWindow(p, anchor)
      setWindow(w.from, w.to)
    },
    [anchor, setWindow],
  )

  const setRange = useCallback(
    (r: DateRangeKey) => {
      const w = presetFromLegacyKey(r, anchor)
      if (w) setWindow(w.from, w.to)
    },
    [anchor, setWindow],
  )

  const setCustomFrom = useCallback((d: Date) => {
    if (Number.isNaN(d.getTime())) return
    const day = isoDay(d)
    setWin((prev) => ({ ...normalizeWindow(day, prev.to), userChosen: true }))
  }, [])

  const setCustomTo = useCallback((d: Date) => {
    if (Number.isNaN(d.getTime())) return
    const day = isoDay(d)
    setWin((prev) => ({ ...normalizeWindow(prev.from, day), userChosen: true }))
  }, [])

  // Date objects depend only on (from, to) so pages' effects keyed on
  // effectiveFrom / effectiveTo don't refetch when only the anchor changes.
  const { from, to } = win
  const dayWindow = useMemo(() => ({ from, to }), [from, to])
  const dates = useMemo(() => {
    const c = compatFields(dayWindow.from, dayWindow.to, today)
    return { effectiveFrom: c.effectiveFrom, effectiveTo: c.effectiveTo }
  }, [dayWindow, today])

  const value = useMemo<DateRangeCtx>(
    () => ({
      ...buildValue(dayWindow, today, latestDataDate, { setWindow, applyPreset, setRange, setCustomFrom, setCustomTo }),
      customFrom: dates.effectiveFrom,
      customTo: dates.effectiveTo,
      effectiveFrom: dates.effectiveFrom,
      effectiveTo: dates.effectiveTo,
    }),
    [dayWindow, today, latestDataDate, dates, setWindow, applyPreset, setRange, setCustomFrom, setCustomTo],
  )

  return <DateRangeContext.Provider value={value}>{children}</DateRangeContext.Provider>
}

export function useDateRange(): DateRangeCtx {
  return useContext(DateRangeContext)
}

/**
 * @deprecated Filter rows exposing `.days` (days since posted) by a max age.
 * `null` maxDays = no filtering. Prefer filtering by `bounds` in the query.
 */
export function applyDateRange<T extends { days: number }>(data: T[], maxDays: number | null): T[] {
  if (maxDays === null) return data
  return data.filter((d) => d.days <= maxDays)
}

/**
 * @deprecated Filter rows exposing `.days` (days since posted, measured from
 * now) to those posted between `from` and `to`. Prefer filtering by
 * `bounds` in the query.
 */
export function applyDateRangeCustom<T extends { days: number }>(data: T[], from: Date, to: Date): T[] {
  return filterRowsByWindow(data, from, to, Date.now())
}
