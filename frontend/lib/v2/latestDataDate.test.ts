import { describe, it, expect, vi, afterEach } from 'vitest'
import { cacheSuccessful, parseRpcDay, withTimeout } from './latestDataDate'

describe('parseRpcDay', () => {
  it('accepts a date string', () => {
    expect(parseRpcDay('2026-10-12')).toBe('2026-10-12')
  })
  it('trims a timestamp to its day', () => {
    expect(parseRpcDay('2026-10-12T00:00:00')).toBe('2026-10-12')
  })
  it('rejects null, non-strings and invalid days', () => {
    expect(parseRpcDay(null)).toBeNull()
    expect(parseRpcDay(20261012)).toBeNull()
    expect(parseRpcDay('2026-02-30')).toBeNull()
  })
})

describe('cacheSuccessful', () => {
  it('shares one in-flight call and caches a success', async () => {
    const load = vi.fn().mockResolvedValue('2026-10-12')
    const get = cacheSuccessful(load)
    const [a, b] = await Promise.all([get(), get()])
    expect(a).toBe('2026-10-12')
    expect(b).toBe('2026-10-12')
    expect(await get()).toBe('2026-10-12')
    expect(load).toHaveBeenCalledTimes(1)
  })
  it('does not cache null, so a later call retries', async () => {
    const load = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('2026-10-12')
    const get = cacheSuccessful(load)
    expect(await get()).toBeNull()
    expect(await get()).toBe('2026-10-12')
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('turns a rejection into null and retries later', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('rpc down')).mockResolvedValueOnce('2026-10-12')
    const get = cacheSuccessful(load)
    expect(await get()).toBeNull()
    expect(await get()).toBe('2026-10-12')
  })
})

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })
  it('resolves with the value when it arrives in time', async () => {
    expect(await withTimeout(Promise.resolve('x'), 1500, 'fallback')).toBe('x')
  })
  it('resolves with the fallback after the timeout', async () => {
    vi.useFakeTimers()
    const never = new Promise<string>(() => {})
    const p = withTimeout(never, 1500, 'fallback')
    await vi.advanceTimersByTimeAsync(1500)
    expect(await p).toBe('fallback')
  })
})
