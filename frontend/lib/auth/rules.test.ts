import { describe, it, expect } from 'vitest'
import {
  normalizeEmail, isAllowedEmail, parseAllowedEmail, isSessionExpired, SESSION_MAX_MS,
} from './rules'

describe('isAllowedEmail', () => {
  it('accepts joola.com and joola.in, any case, trimmed', () => {
    expect(isAllowedEmail('A.B@JOOLA.com')).toBe(true)
    expect(isAllowedEmail('  x@joola.in ')).toBe(true)
  })
  it('rejects other domains and lookalikes', () => {
    for (const e of ['x@gmail.com', 'x@joola.com.evil.io', 'x@notjoola.com',
                     'x@sub.joola.com', 'joola.com@gmail.com', 'x@joola.co', '', 'x', 'a@b@joola.com'])
      expect(isAllowedEmail(e)).toBe(false)
  })
  it('rejects malformed local parts and domain tricks', () => {
    for (const e of ['x y@joola.com', 'x\u0000@joola.com', 'x@joola.com.',
                     'x@joоla.com', '"a"@joola.com'])
      expect(isAllowedEmail(e)).toBe(false)
  })
  it('rejects addresses longer than 254 chars', () => {
    const domain = '@joola.com'
    const long = 'a'.repeat(255 - domain.length) + domain
    expect(long).toHaveLength(255)
    expect(isAllowedEmail(long)).toBe(false)
    expect(isAllowedEmail(long.slice(1))).toBe(true)
  })
})

describe('parseAllowedEmail', () => {
  it('returns the normalized email when allowed', () =>
    expect(parseAllowedEmail(' A@JOOLA.in ')).toBe('a@joola.in'))
  it('returns null when not allowed', () =>
    expect(parseAllowedEmail('x@gmail.com')).toBeNull())
})

describe('normalizeEmail', () => {
  it('trims and lowercases', () => expect(normalizeEmail(' A@Joola.IN ')).toBe('a@joola.in'))
})

describe('isSessionExpired', () => {
  const now = Date.parse('2026-10-20T00:00:00Z')
  const iso = (ms: number) => new Date(ms).toISOString()
  it('is false inside 7 days', () =>
    expect(isSessionExpired(iso(now - SESSION_MAX_MS + 1000), now)).toBe(false))
  it('is true after 7 days', () =>
    expect(isSessionExpired(iso(now - SESSION_MAX_MS - 1000), now)).toBe(true))
  it('treats a missing or unparseable timestamp as expired', () => {
    expect(isSessionExpired(undefined, now)).toBe(true)
    expect(isSessionExpired(null, now)).toBe(true)
    expect(isSessionExpired('', now)).toBe(true)
    expect(isSessionExpired('garbage', now)).toBe(true)
  })
  it('treats a future timestamp as expired (clock skew / bad data)', () =>
    expect(isSessionExpired(iso(now + 60 * 60 * 1000), now)).toBe(true))
  it('accepts a real Supabase-style ISO timestamp', () =>
    expect(isSessionExpired('2026-10-17T08:00:00.000Z', now)).toBe(false))
})
