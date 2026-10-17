import { describe, it, expect } from 'vitest'
import {
  ALL_TIME_START,
  addDays,
  formatWindow,
  isValidIsoDay,
  isoDay,
  matchPreset,
  normalizeWindow,
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

describe('invalid IsoDay contract', () => {
  it('addDays throws RangeError on garbage', () => {
    expect(() => addDays('garbage', 1)).toThrow(RangeError)
  })
  it('toQueryBounds throws RangeError on garbage', () => {
    expect(() => toQueryBounds('x', '2026-10-12')).toThrow(RangeError)
  })
})

describe('normalizeWindow', () => {
  it('keeps an ordered window', () => {
    expect(normalizeWindow('2026-07-14', '2026-10-12')).toEqual({ from: '2026-07-14', to: '2026-10-12' })
  })
  it('swaps a reversed window', () => {
    expect(normalizeWindow('2026-10-12', '2026-07-14')).toEqual({ from: '2026-07-14', to: '2026-10-12' })
  })
})

describe('reversed input agreement', () => {
  it('formatWindow treats reversed input like ordered input', () => {
    expect(formatWindow('2026-10-12', '2026-07-14')).toBe(formatWindow('2026-07-14', '2026-10-12'))
  })
  it('matchPreset treats reversed input like ordered input', () => {
    expect(matchPreset('2026-10-12', '2026-10-06', '2026-10-12')).toBe('7d')
  })
})

describe('toQueryBounds edges', () => {
  it('spans a year end', () => {
    expect(toQueryBounds('2025-12-31', '2026-01-01')).toEqual({
      gte: '2025-12-30T18:30:00.000Z',
      lt: '2026-01-01T18:30:00.000Z',
    })
  })
  it('all-time start begins at 1999-12-31T18:30Z', () => {
    expect(toQueryBounds(ALL_TIME_START, '2026-10-12').gte).toBe('1999-12-31T18:30:00.000Z')
  })
})

describe('matchPreset edges', () => {
  it('returns null for a 7-day span not ending on the anchor', () => {
    expect(matchPreset('2026-10-04', '2026-10-10', '2026-10-12')).toBeNull()
  })
})
