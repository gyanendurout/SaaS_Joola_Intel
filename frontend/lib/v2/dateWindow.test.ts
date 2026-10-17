import { describe, it, expect } from 'vitest'
import {
  ALL_TIME_START,
  addDays,
  formatWindow,
  isValidIsoDay,
  isoDay,
  matchPreset,
  presetWindow,
  toQueryBounds,
} from './dateWindow'

describe('isoDay', () => {
  it('returns the IST calendar day after IST midnight', () => {
    expect(isoDay(new Date('2026-10-12T20:00:00Z'))).toBe('2026-10-13')
  })
  it('returns the previous IST day one second before IST midnight', () => {
    expect(isoDay(new Date('2026-10-12T18:29:59Z'))).toBe('2026-10-12')
  })
  it('flips exactly at IST midnight', () => {
    expect(isoDay(new Date('2026-10-12T18:30:00Z'))).toBe('2026-10-13')
  })
})

describe('addDays', () => {
  it('crosses a month end', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
  })
  it('lands on a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })
  it('handles negative n', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('crosses a year end', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
  })
  it('returns the same day for n = 0', () => {
    expect(addDays('2026-10-12', 0)).toBe('2026-10-12')
  })
})

describe('toQueryBounds', () => {
  it('covers the whole IST To day (half-open)', () => {
    expect(toQueryBounds('2026-10-12', '2026-10-12')).toEqual({
      gte: '2026-10-11T18:30:00.000Z',
      lt: '2026-10-12T18:30:00.000Z',
    })
  })
  it('spans a multi-day window', () => {
    expect(toQueryBounds('2026-10-01', '2026-10-12')).toEqual({
      gte: '2026-09-30T18:30:00.000Z',
      lt: '2026-10-12T18:30:00.000Z',
    })
  })
  it('swaps reversed input', () => {
    expect(toQueryBounds('2026-10-12', '2026-10-01')).toEqual(
      toQueryBounds('2026-10-01', '2026-10-12'),
    )
  })
})

describe('presetWindow', () => {
  const anchor = '2026-10-12'
  it('7d is 7 inclusive days', () => {
    expect(presetWindow('7d', anchor)).toEqual({ from: '2026-10-06', to: anchor })
  })
  it('30d is 30 inclusive days', () => {
    expect(presetWindow('30d', anchor)).toEqual({ from: '2026-09-13', to: anchor })
  })
  it('90d is 90 inclusive days', () => {
    expect(presetWindow('90d', anchor)).toEqual({ from: '2026-07-15', to: anchor })
  })
  it('all starts at ALL_TIME_START', () => {
    expect(presetWindow('all', anchor)).toEqual({ from: ALL_TIME_START, to: anchor })
  })
})

describe('matchPreset', () => {
  const anchor = '2026-10-12'
  it('recognises every preset window', () => {
    for (const p of ['7d', '30d', '90d', 'all'] as const) {
      const w = presetWindow(p, anchor)
      expect(matchPreset(w.from, w.to, anchor)).toBe(p)
    }
  })
  it('returns null for a custom window', () => {
    expect(matchPreset('2026-10-01', '2026-10-05', anchor)).toBeNull()
  })
  it('returns null when To is not the anchor', () => {
    expect(matchPreset('2026-10-05', '2026-10-11', anchor)).toBeNull()
  })
})

describe('formatWindow', () => {
  it('prints the year once when both days share it', () => {
    expect(formatWindow('2026-07-14', '2026-10-12')).toBe('Jul 14 – Oct 12, 2026')
  })
  it('prints both years when they differ', () => {
    expect(formatWindow('2025-12-20', '2026-01-05')).toBe('Dec 20, 2025 – Jan 5, 2026')
  })
  it('prints a single day once', () => {
    expect(formatWindow('2026-10-12', '2026-10-12')).toBe('Oct 12, 2026')
  })
  it('prints all-time windows', () => {
    expect(formatWindow(ALL_TIME_START, '2026-10-12')).toBe('All time to Oct 12, 2026')
  })
})

describe('isValidIsoDay', () => {
  it('accepts a real day', () => {
    expect(isValidIsoDay('2026-10-12')).toBe(true)
    expect(isValidIsoDay('2028-02-29')).toBe(true)
  })
  it.each(['2026-13-01', '2026-02-30', '26-10-12', '', '2026-1-01', '2027-02-29'])(
    'rejects %j',
    (s) => {
      expect(isValidIsoDay(s)).toBe(false)
    },
  )
  it('rejects non-strings', () => {
    expect(isValidIsoDay(123)).toBe(false)
    expect(isValidIsoDay(null)).toBe(false)
    expect(isValidIsoDay(undefined)).toBe(false)
  })
})
