import { describe, it, expect } from 'vitest'
import { normalizeEmail, isAllowedEmail, isSessionExpired, SESSION_MAX_MS } from './rules'

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
})

describe('normalizeEmail', () => {
  it('trims and lowercases', () => expect(normalizeEmail(' A@Joola.IN ')).toBe('a@joola.in'))
})

describe('isSessionExpired', () => {
  const now = Date.parse('2026-10-20T00:00:00Z')
  it('is false inside 7 days', () =>
    expect(isSessionExpired(String(now - SESSION_MAX_MS + 1000), now)).toBe(false))
  it('is true after 7 days', () =>
    expect(isSessionExpired(String(now - SESSION_MAX_MS - 1), now)).toBe(true))
  it('treats a missing or garbage cookie as expired', () => {
    expect(isSessionExpired(undefined, now)).toBe(true)
    expect(isSessionExpired('abc', now)).toBe(true)
  })
  it('treats a future timestamp as expired (tampered/clock skew)', () =>
    expect(isSessionExpired(String(now + 60 * 60 * 1000), now)).toBe(true))
})
