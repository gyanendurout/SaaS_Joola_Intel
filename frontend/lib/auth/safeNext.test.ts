import { describe, it, expect } from 'vitest'
import { safeNext, DEFAULT_NEXT } from './safeNext'

describe('safeNext', () => {
  it('keeps same-origin dashboard paths', () => {
    expect(safeNext('/v2/reddit?x=1')).toBe('/v2/reddit?x=1')
    expect(safeNext('/v2')).toBe('/v2')
    expect(safeNext('/')).toBe('/')
    expect(safeNext('/v2/%0d%0a')).toBe('/v2/%0d%0a')
    // Starts with /v2 and has no scheme: a harmless same-origin path.
    expect(safeNext('/v2@evil.com')).toBe('/v2@evil.com')
  })

  it('defaults when missing', () => {
    expect(DEFAULT_NEXT).toBe('/v2/overview')
    expect(safeNext(null)).toBe(DEFAULT_NEXT)
    expect(safeNext(undefined)).toBe(DEFAULT_NEXT)
    expect(safeNext('')).toBe(DEFAULT_NEXT)
  })

  it('rejects protocol-relative, backslash and absolute URLs', () => {
    expect(safeNext('//evil.com')).toBe(DEFAULT_NEXT)
    expect(safeNext('/\\evil.com')).toBe(DEFAULT_NEXT)
    expect(safeNext('/v2\\..\\evil')).toBe(DEFAULT_NEXT)
    expect(safeNext('https://evil.com')).toBe(DEFAULT_NEXT)
    expect(safeNext('/v2/x?u=https://evil.com')).toBe(DEFAULT_NEXT)
    expect(safeNext('javascript:alert(1)')).toBe(DEFAULT_NEXT)
  })

  it('rejects control characters', () => {
    expect(safeNext('/v2/\r\nx')).toBe(DEFAULT_NEXT)
    expect(safeNext('/v2/\tx')).toBe(DEFAULT_NEXT)
    expect(safeNext('/v2/\u007fx')).toBe(DEFAULT_NEXT)
  })

  it('rejects paths outside the dashboard', () => {
    expect(safeNext('/login')).toBe(DEFAULT_NEXT)
    expect(safeNext('/api/x')).toBe(DEFAULT_NEXT)
    expect(safeNext('/v2x')).toBe('/v2x') // documented: prefix match on /v2
    expect(safeNext('v2/overview')).toBe(DEFAULT_NEXT)
  })
})
