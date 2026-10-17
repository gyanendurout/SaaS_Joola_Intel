import { describe, it, expect } from 'vitest'
import {
  LEGACY_KEYS,
  STORAGE_KEY,
  compatFields,
  filterRowsByWindow,
  initialWindow,
  parseStoredWindow,
  presetFromLegacyKey,
} from './dateWindowState'

describe('storage keys', () => {
  it('uses a fresh v2 key and lists every legacy key', () => {
    expect(STORAGE_KEY).toBe('joola-window-v2')
    expect(LEGACY_KEYS).toEqual(['joola-date-range', 'joola-date-mode', 'joola-date-from', 'joola-date-to'])
  })
})

describe('parseStoredWindow', () => {
  it('returns null for missing input', () => {
    expect(parseStoredWindow(null)).toBeNull()
    expect(parseStoredWindow('')).toBeNull()
  })
  it('returns null for malformed JSON', () => {
    expect(parseStoredWindow('{not json')).toBeNull()
  })
  it('returns null for non-object JSON', () => {
    expect(parseStoredWindow('"2026-10-01"')).toBeNull()
    expect(parseStoredWindow('null')).toBeNull()
    expect(parseStoredWindow('[1,2]')).toBeNull()
  })
  it('returns null when either day is invalid', () => {
    expect(parseStoredWindow(JSON.stringify({ from: '2026-02-30', to: '2026-03-01' }))).toBeNull()
    expect(parseStoredWindow(JSON.stringify({ from: '2026-02-01' }))).toBeNull()
    expect(parseStoredWindow(JSON.stringify({ from: 20260201, to: '2026-03-01' }))).toBeNull()
  })
  it('parses a valid window', () => {
    expect(parseStoredWindow(JSON.stringify({ from: '2026-09-01', to: '2026-09-30' }))).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    })
  })
  it('normalizes a reversed window', () => {
    expect(parseStoredWindow(JSON.stringify({ from: '2026-09-30', to: '2026-09-01' }))).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    })
  })
})

describe('initialWindow', () => {
  it('uses a stored window and marks it user-chosen', () => {
    expect(initialWindow({ from: '2026-09-01', to: '2026-09-30' }, '2026-10-12')).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      userChosen: true,
    })
  })
  it('falls back to the 90-day window ending on the anchor', () => {
    expect(initialWindow(null, '2026-10-12')).toEqual({
      from: '2026-07-15',
      to: '2026-10-12',
      userChosen: false,
    })
  })
})

describe('compatFields', () => {
  it('maps a 90d preset to the legacy key and preset mode', () => {
    const c = compatFields('2026-07-15', '2026-10-12', '2026-10-12')
    expect(c.range).toBe('90d')
    expect(c.mode).toBe('preset')
    expect(c.maxDays).toBe(90)
  })
  it('matches presets against the anchor, not today', () => {
    const c = compatFields('2026-10-06', '2026-10-12', '2026-10-17', '2026-10-12')
    expect(c.range).toBe('7d')
    expect(c.mode).toBe('preset')
    // maxDays still reaches back from today so day-age filters cover From.
    expect(c.maxDays).toBe(12)
  })
  it('recognises the legacy 6-month and 12-month windows', () => {
    expect(compatFields('2026-04-16', '2026-10-12', '2026-10-12').range).toBe('6mo')
    expect(compatFields('2025-10-13', '2026-10-12', '2026-10-12').range).toBe('1y')
  })
  it('reports custom for an arbitrary window', () => {
    const c = compatFields('2026-09-01', '2026-09-30', '2026-10-12')
    expect(c.range).toBe('custom')
    expect(c.mode).toBe('custom')
    expect(c.maxDays).toBe(42)
  })
  it('reports all-time with no day cap', () => {
    const c = compatFields('2000-01-01', '2026-10-12', '2026-10-12')
    expect(c.range).toBe('all')
    expect(c.maxDays).toBeNull()
  })
  it('effectiveFrom is IST midnight of From', () => {
    const c = compatFields('2026-10-01', '2026-10-12', '2026-10-12')
    expect(c.effectiveFrom.toISOString()).toBe('2026-09-30T18:30:00.000Z')
  })
  it('effectiveTo is the last millisecond of the To day in IST', () => {
    const c = compatFields('2026-10-01', '2026-10-12', '2026-10-12')
    expect(c.effectiveTo.toISOString()).toBe('2026-10-12T18:29:59.999Z')
  })
})

describe('presetFromLegacyKey', () => {
  const anchor = '2026-10-12'
  it('maps the shared presets', () => {
    expect(presetFromLegacyKey('7d', anchor)).toEqual({ from: '2026-10-06', to: anchor })
    expect(presetFromLegacyKey('30d', anchor)).toEqual({ from: '2026-09-13', to: anchor })
    expect(presetFromLegacyKey('90d', anchor)).toEqual({ from: '2026-07-15', to: anchor })
    expect(presetFromLegacyKey('all', anchor)).toEqual({ from: '2000-01-01', to: anchor })
  })
  it('maps 6mo to 180 inclusive days and 1y to 365', () => {
    expect(presetFromLegacyKey('6mo', anchor)).toEqual({ from: '2026-04-16', to: anchor })
    expect(presetFromLegacyKey('1y', anchor)).toEqual({ from: '2025-10-13', to: anchor })
  })
  it('returns null for custom (nothing to apply)', () => {
    expect(presetFromLegacyKey('custom', anchor)).toBeNull()
  })
})

describe('filterRowsByWindow', () => {
  const DAY = 86_400_000
  // now = 2026-10-17 06:30 UTC = 12:00 IST
  const now = Date.parse('2026-10-17T06:30:00.000Z')
  const rows = [0, 3, 4, 5, 10, 20].map((days) => ({ days }))
  it('keeps rows whose age falls inside the window', () => {
    const from = new Date('2026-10-06T18:30:00.000Z') // IST midnight Oct 7
    const to = new Date('2026-10-12T18:29:59.999Z') // end of Oct 12 IST
    const out = filterRowsByWindow(rows, from, to, now).map((r) => r.days)
    // ages 4..10 are within (now - to) .. (now - from)
    expect(out).toEqual([4, 5, 10])
  })
  it('keeps today-aged rows when To is today or later', () => {
    const from = new Date(now - 7 * DAY)
    const to = new Date(now + DAY)
    expect(filterRowsByWindow(rows, from, to, now).map((r) => r.days)).toEqual([0, 3, 4, 5])
  })
  it('accepts reversed bounds', () => {
    const a = new Date(now - 10 * DAY)
    const b = new Date(now - 3 * DAY)
    expect(filterRowsByWindow(rows, b, a, now).map((r) => r.days)).toEqual([3, 4, 5, 10])
  })
})
