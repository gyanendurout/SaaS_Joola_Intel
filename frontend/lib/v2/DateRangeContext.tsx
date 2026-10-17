'use client'

/**
 * Dashboard-wide date window: one From–To pair of IST days that every page
 * follows. The default is the 90 days ending on the latest data date
 * (`rpc_latest_data_date`), falling back to today (IST) when unknown.
 *
 * State is a WindowChoice: a preset (re-resolved against the anchor, so it
 * follows new data) or a fixed custom window. It is persisted under
 * STORAGE_KEY only when the user changes it.
 *
 * `DateRangeReady` holds page content until the final window is known (stored choice read,
 * and for presets the anchor fetched or timed out), so pages fetch once.
 *
 * The deprecated fields (range, maxDays, mode, customFrom, ...) are derived
 * from the window so older pages keep working; new code should read
 * `from` / `to` / `bounds` / `label`.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/shared/supabase'
import { formatWindow, isValidIsoDay, isoDay, toQueryBounds, type IsoDay, type Preset } from './dateWindow'
import {
  DEFAULT_CHOICE,
  LEGACY_KEYS,
  LEGACY_V2_KEY,
  STORAGE_KEY,
  choiceForWindow,
  compatFields,
  effectiveDates,
  filterRowsByWindow,
  loadStoredChoice,
  parseStoredChoice,
  presetFromLegacyKey,
  resolveWindow,
  type DateRangeKey,
  type DateRangeMode,
  type DayWindow,
  type WindowChoice,
} from './dateWindowState'
import { cacheSuccessful, parseRpcDay, withTimeout } from './latestDataDate'

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
  /** False until the stored choice is read and (for presets) the anchor is known. */
  ready: boolean

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

// ─── Latest data date (successful result cached per browser session) ───
const ANCHOR_TIMEOUT_MS = 1500

const fetchLatestDataDate = cacheSuccessful<IsoDay>(async () => {
  const { data, error } = await supabase.rpc('rpc_latest_data_date')
  return error ? null : parseRpcDay(data)
})

// ─── Storage helpers (all failures are non-fatal) ──────────────────────
/** Reads the persisted choice; migrates a legacy v2 window into v3; deletes legacy keys. */
function loadChoiceFromStorage(): WindowChoice | null {
  try {
    const v3Raw = localStorage.getItem(STORAGE_KEY)
    const choice = loadStoredChoice(v3Raw, localStorage.getItem(LEGACY_V2_KEY))
    // Migration only: carry a v2 window forward; drop old keys only once v3 holds it.
    const migrated = choice !== null && !parseStoredChoice(v3Raw)
    if (!migrated || writeStored(choice)) {
      for (const k of LEGACY_KEYS) localStorage.removeItem(k)
    }
    return choice
  } catch {
    return null
  }
}

/** Writes the choice; false when storage is unavailable or full. */
function writeStored(choice: WindowChoice): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice))
    return true
  } catch {
    return false
  }
}

type ChoiceState = { choice: WindowChoice; persist: boolean }

type Setters = Pick<DateRangeCtx, 'setWindow' | 'applyPreset' | 'setRange' | 'setCustomFrom' | 'setCustomTo'>

function buildValue(win: DayWindow, today: IsoDay, latestDataDate: IsoDay | null, setters: Setters): DateRangeCtx {
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
    ready: true,
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

// ─── Context default (used only outside a provider) ────────────────────
let warnedNoProvider = false
function warnNoProvider(): void {
  if (process.env.NODE_ENV === 'production' || warnedNoProvider) return
  warnedNoProvider = true
  // eslint-disable-next-line no-console
  console.warn('[DateRangeContext] date setter called outside <DateRangeProvider>; the change is ignored.')
}

const MODULE_TODAY = isoDay(new Date())
const DateRangeContext = createContext<DateRangeCtx>(
  buildValue(resolveWindow(DEFAULT_CHOICE, MODULE_TODAY), MODULE_TODAY, null, {
    setWindow: warnNoProvider,
    applyPreset: warnNoProvider,
    setRange: warnNoProvider,
    setCustomFrom: warnNoProvider,
    setCustomTo: warnNoProvider,
  }),
)

function legacyKeyChoice(r: DateRangeKey, anchor: IsoDay): WindowChoice | null {
  if (r === '7d' || r === '30d' || r === '90d' || r === 'all') return { kind: 'preset', preset: r }
  const w = presetFromLegacyKey(r, anchor)
  return w ? choiceForWindow(w.from, w.to, anchor) : null
}

/** Today (IST), refreshed when the tab becomes visible on a new day. */
function useTodayIst(): IsoDay {
  const [today, setToday] = useState<IsoDay>(() => isoDay(new Date()))
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const t = isoDay(new Date())
      setToday((prev) => (prev === t ? prev : t))
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
  return today
}

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const today = useTodayIst()
  const [state, setState] = useState<ChoiceState>({ choice: DEFAULT_CHOICE, persist: false })
  const [latestDataDate, setLatestDataDate] = useState<IsoDay | null>(null)
  // Children wait until the final window is known, so pages fetch once.
  const [ready, setReady] = useState(false)
  const anchor = latestDataDate ?? today

  useEffect(() => {
    let cancelled = false
    const stored = loadChoiceFromStorage()
    if (stored) setState({ choice: stored, persist: false })
    const lookup = fetchLatestDataDate()
    const applyLate = (day: IsoDay | null) => {
      if (!cancelled && day) setLatestDataDate(day)
    }
    if (stored?.kind === 'custom') {
      // A fixed window doesn't depend on the anchor; only the hint does.
      setReady(true)
      lookup.then(applyLate)
    } else {
      withTimeout(lookup, ANCHOR_TIMEOUT_MS, null).then((day) => {
        if (cancelled) return
        setLatestDataDate(day)
        setReady(true)
        if (day === null) lookup.then(applyLate)
      })
    }
    return () => { cancelled = true }
  }, [])

  // Persist only choices made by the user (never on load).
  useEffect(() => {
    if (state.persist) writeStored(state.choice)
  }, [state])

  const applyPreset = useCallback((p: Preset) => {
    setState({ choice: { kind: 'preset', preset: p }, persist: true })
  }, [])

  const setWindow = useCallback(
    (from: IsoDay, to: IsoDay) => {
      if (!isValidIsoDay(from) || !isValidIsoDay(to)) return
      setState({ choice: choiceForWindow(from, to, anchor), persist: true })
    },
    [anchor],
  )

  const setRange = useCallback(
    (r: DateRangeKey) => {
      const choice = legacyKeyChoice(r, anchor)
      if (choice) setState({ choice, persist: true })
    },
    [anchor],
  )

  const setCustomFrom = useCallback(
    (d: Date) => {
      if (Number.isNaN(d.getTime())) return
      const day = isoDay(d)
      setState((prev) => {
        const w = resolveWindow(prev.choice, anchor)
        return { choice: choiceForWindow(day, w.to, anchor), persist: true }
      })
    },
    [anchor],
  )

  const setCustomTo = useCallback(
    (d: Date) => {
      if (Number.isNaN(d.getTime())) return
      const day = isoDay(d)
      setState((prev) => {
        const w = resolveWindow(prev.choice, anchor)
        return { choice: choiceForWindow(w.from, day, anchor), persist: true }
      })
    },
    [anchor],
  )

  // Date objects depend only on (from, to) so pages' effects keyed on
  // effectiveFrom / effectiveTo don't refetch when nothing moved.
  const { from, to } = resolveWindow(state.choice, anchor)
  const dayWindow = useMemo(() => ({ from, to }), [from, to])
  const dates = useMemo(() => effectiveDates(dayWindow.from, dayWindow.to), [dayWindow])

  const value = useMemo<DateRangeCtx>(
    () => ({
      ...buildValue(dayWindow, today, latestDataDate, { setWindow, applyPreset, setRange, setCustomFrom, setCustomTo }),
      ready,
      customFrom: dates.effectiveFrom,
      customTo: dates.effectiveTo,
      effectiveFrom: dates.effectiveFrom,
      effectiveTo: dates.effectiveTo,
    }),
    [dayWindow, today, latestDataDate, ready, dates, setWindow, applyPreset, setRange, setCustomFrom, setCustomTo],
  )

  return <DateRangeContext.Provider value={value}>{children}</DateRangeContext.Provider>
}

/**
 * Renders its children once the initial window is final (so pages fetch
 * once); until then a placeholder sized to the content area.
 */
export function DateRangeReady({ children }: { children: ReactNode }) {
  const { ready } = useDateRange()
  return ready ? <>{children}</> : <div className="drp-pending" aria-busy="true" />
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
