import { describe, it, expect } from 'vitest'
import { unstable_serialize } from 'swr'
import { dataVersionOf, parseStored, RecencyMap, selectEntriesToPersist } from './swrPersist'
import { rpcKey } from './rpcArgs'

const k = (fn: string, version?: string | null, args: Record<string, unknown> = { p_from: 'a"b' }) =>
  unstable_serialize(rpcKey(fn, args, version))
const ok = (data: unknown) => ({ data, isValidating: false, isLoading: false })

describe('dataVersionOf', () => {
  it('reads the version from a real serialised key, even with quotes in args', () => {
    expect(dataVersionOf(k('f', '2026-10-12'))).toBe('2026-10-12')
    expect(dataVersionOf(k('f'))).toBe('unknown')
  })
  it('returns null for non-rpc keys', () => {
    expect(dataVersionOf('$inf$foo')).toBeNull()
    expect(dataVersionOf('plain')).toBeNull()
  })
})

describe('selectEntriesToPersist', () => {
  it('keeps only settled rpc entries without errors', () => {
    const out = selectEntriesToPersist(
      [
        [k('a', 'v1'), ok(1)],
        [k('b', 'v1'), { data: undefined, isLoading: true }],
        [k('c', 'v1'), { data: 2, error: new Error('x') }],
        ['other-key', ok(3)],
      ],
      10,
    )
    expect(out).toEqual([[k('a', 'v1'), { data: 1 }]])
  })

  it('drops entries from older data versions', () => {
    const out = selectEntriesToPersist(
      [
        [k('a', '2026-10-05'), ok('old')],
        [k('a', '2026-10-12'), ok('new')],
        [k('b', 'unknown'), ok('unk')],
      ],
      10,
    )
    expect(out).toEqual([[k('a', '2026-10-12'), { data: 'new' }]])
  })

  it('falls back to unknown-version entries when no dated ones exist', () => {
    expect(selectEntriesToPersist([[k('a'), ok(1)]], 10)).toEqual([[k('a'), { data: 1 }]])
  })

  it('keeps the most recent `cap` entries, oldest-first', () => {
    const entries: [string, unknown][] = [1, 2, 3, 4].map((i) => [k(`f${i}`, 'v'), ok(i)])
    expect(selectEntriesToPersist(entries, 2).map(([, s]) => s.data)).toEqual([3, 4])
  })
})

describe('parseStored', () => {
  it('round-trips persisted entries', () => {
    const entries = selectEntriesToPersist([[k('a', 'v'), ok({ x: 1 })]], 10)
    expect(parseStored(JSON.stringify(entries))).toEqual(entries)
  })
  it('ignores corrupt, non-array and malformed payloads', () => {
    expect(parseStored(null)).toEqual([])
    expect(parseStored('{not json')).toEqual([])
    expect(parseStored('{"a":1}')).toEqual([])
    expect(parseStored(JSON.stringify([['plain', { data: 1 }], [k('a', 'v')], 5]))).toEqual([])
  })
})

describe('RecencyMap', () => {
  it('moves a re-written key to the end, so the cap keeps recently fetched entries', () => {
    const seed: [string, unknown][] = [[k('a', 'v'), ok(1)], [k('b', 'v'), ok(2)], [k('c', 'v'), ok(3)]]
    const m = new RecencyMap<unknown>(seed)
    m.set(k('a', 'v'), ok(10))
    expect(Array.from(m.keys())).toEqual([k('b', 'v'), k('c', 'v'), k('a', 'v')])
    expect(selectEntriesToPersist(m.entries(), 2).map(([, s]) => s.data)).toEqual([3, 10])
  })
})
