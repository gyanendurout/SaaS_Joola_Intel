'use client'

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'

export type DateRangeKey = '7d' | '30d' | '90d' | '6mo' | '1y' | 'all'
export type DateRangeMode = 'preset' | 'custom'

type DateRangeCtx = {
  // ─── Existing API (must remain backward-compatible) ──────────────
  range: DateRangeKey
  setRange: (r: DateRangeKey) => void
  /** Max age in days for filtering — null means no upper bound (all time). */
  maxDays: number | null

  // ─── Custom From/To extension ────────────────────────────────────
  mode: DateRangeMode
  customFrom: Date
  customTo: Date
  setCustomFrom: (d: Date) => void
  setCustomTo: (d: Date) => void
  /**
   * Resolved range regardless of preset vs custom mode. Pages that just
   * need a [from, to] window can read these directly without caring
   * about which input the user chose.
   */
  effectiveFrom: Date
  effectiveTo: Date
}

const KEY_TO_DAYS: Record<DateRangeKey, number | null> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '6mo': 180,
  '1y': 365,
  'all': null,
}

export const DATE_RANGE_LABEL: Record<DateRangeKey, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '6mo': 'Last 6 months',
  '1y': 'Last 12 months',
  'all': 'All time',
}

const DEFAULT_RANGE: DateRangeKey = '90d'

function todayLocal(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function daysAgo(n: number | null): Date {
  // null === "all time" → reach a very old anchor date instead.
  if (n === null) return new Date(2000, 0, 1)
  const d = todayLocal()
  d.setDate(d.getDate() - n)
  return d
}

const DEFAULT_FROM = daysAgo(KEY_TO_DAYS[DEFAULT_RANGE])
const DEFAULT_TO = todayLocal()

const DateRangeContext = createContext<DateRangeCtx>({
  range: DEFAULT_RANGE,
  setRange: () => {},
  maxDays: KEY_TO_DAYS[DEFAULT_RANGE],
  mode: 'preset',
  customFrom: DEFAULT_FROM,
  customTo: DEFAULT_TO,
  setCustomFrom: () => {},
  setCustomTo: () => {},
  effectiveFrom: DEFAULT_FROM,
  effectiveTo: DEFAULT_TO,
})

function readStored(): DateRangeKey {
  if (typeof window === 'undefined') return DEFAULT_RANGE
  try {
    const s = localStorage.getItem('joola-date-range')
    return s && (s as DateRangeKey) in KEY_TO_DAYS ? (s as DateRangeKey) : DEFAULT_RANGE
  } catch {
    return DEFAULT_RANGE
  }
}

function readStoredDate(key: string, fallback: Date): Date {
  if (typeof window === 'undefined') return fallback
  try {
    const s = localStorage.getItem(key)
    if (!s) return fallback
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? fallback : d
  } catch {
    return fallback
  }
}

function readStoredMode(): DateRangeMode {
  if (typeof window === 'undefined') return 'preset'
  try {
    const s = localStorage.getItem('joola-date-mode')
    return s === 'custom' ? 'custom' : 'preset'
  } catch {
    return 'preset'
  }
}

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [range, setRangeRaw] = useState<DateRangeKey>(readStored)
  const [mode, setMode] = useState<DateRangeMode>(readStoredMode)
  const [customFrom, setCustomFromRaw] = useState<Date>(() =>
    readStoredDate('joola-date-from', daysAgo(KEY_TO_DAYS[readStored()]))
  )
  const [customTo, setCustomToRaw] = useState<Date>(() =>
    readStoredDate('joola-date-to', todayLocal())
  )

  const setRange = useCallback((r: DateRangeKey) => {
    setRangeRaw(r)
    // Switching presets snaps the custom From/To window so the picker
    // stays in sync if the user toggles back to custom mode later.
    const nextFrom = daysAgo(KEY_TO_DAYS[r])
    const nextTo = todayLocal()
    setCustomFromRaw(nextFrom)
    setCustomToRaw(nextTo)
    setMode('preset')
    try {
      localStorage.setItem('joola-date-range', r)
      localStorage.setItem('joola-date-mode', 'preset')
      localStorage.setItem('joola-date-from', nextFrom.toISOString())
      localStorage.setItem('joola-date-to', nextTo.toISOString())
    } catch {}
  }, [])

  const setCustomFrom = useCallback((d: Date) => {
    setCustomFromRaw(d)
    setMode('custom')
    try {
      localStorage.setItem('joola-date-from', d.toISOString())
      localStorage.setItem('joola-date-mode', 'custom')
    } catch {}
  }, [])

  const setCustomTo = useCallback((d: Date) => {
    setCustomToRaw(d)
    setMode('custom')
    try {
      localStorage.setItem('joola-date-to', d.toISOString())
      localStorage.setItem('joola-date-mode', 'custom')
    } catch {}
  }, [])

  const { effectiveFrom, effectiveTo } = useMemo(() => {
    if (mode === 'custom') {
      return { effectiveFrom: customFrom, effectiveTo: customTo }
    }
    return {
      effectiveFrom: daysAgo(KEY_TO_DAYS[range]),
      effectiveTo: todayLocal(),
    }
  }, [mode, customFrom, customTo, range])

  return (
    <DateRangeContext.Provider value={{
      range,
      setRange,
      maxDays: KEY_TO_DAYS[range],
      mode,
      customFrom,
      customTo,
      setCustomFrom,
      setCustomTo,
      effectiveFrom,
      effectiveTo,
    }}>
      {children}
    </DateRangeContext.Provider>
  )
}

export function useDateRange() {
  return useContext(DateRangeContext)
}

/**
 * Filter any array of rows that expose `.days` (days since posted) by the
 * currently active date range. `null` maxDays = no filtering (all time).
 *
 * Backward-compatible: pages calling `applyDateRange(rows, maxDays)` keep
 * working unchanged. Use `applyDateRangeCustom` for the new From/To picker.
 */
export function applyDateRange<T extends { days: number }>(
  data: T[],
  maxDays: number | null,
): T[] {
  if (maxDays === null) return data
  return data.filter(d => d.days <= maxDays)
}

/**
 * Filter rows by an explicit calendar From/To window. Each row must
 * carry a `days` field (days since posted), measured against today.
 *
 * Mirrors `applyDateRange()` shape so call sites can swap freely.
 */
export function applyDateRangeCustom<T extends { days: number }>(
  data: T[],
  from: Date,
  to: Date,
): T[] {
  const today = todayLocal().getTime()
  const fromDays = Math.max(0, Math.floor((today - from.getTime()) / 86_400_000))
  const toDays = Math.max(0, Math.floor((today - to.getTime()) / 86_400_000))
  // `from` is older → larger days value; `to` is more recent → smaller days.
  const upper = Math.max(fromDays, toDays)
  const lower = Math.min(fromDays, toDays)
  return data.filter(d => d.days >= lower && d.days <= upper)
}
