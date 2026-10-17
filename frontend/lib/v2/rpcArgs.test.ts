import { describe, it, expect } from 'vitest'
import { rpcArgs, brandParam, rpcKey, stableStringify } from './rpcArgs'

const bounds = { gte: '2026-01-01T00:00:00.000Z', lt: '2026-02-01T00:00:00.000Z' }
const brand = (id: string, brand_id: string) => ({ id, brand_id }) as never

describe('rpcArgs', () => {
  it('maps bounds to p_from / p_to and passes null brands through', () => {
    expect(rpcArgs(bounds, null)).toEqual({ p_from: bounds.gte, p_to: bounds.lt, p_brands: null })
  })

  it('sorts brand uuids without mutating the input', () => {
    const input = ['c', 'a', 'b']
    expect(rpcArgs(bounds, input).p_brands).toEqual(['a', 'b', 'c'])
    expect(input).toEqual(['c', 'a', 'b'])
  })

  it('merges extra params but never lets them override the window or brands', () => {
    const args = rpcArgs(bounds, ['x'], { p_limit: 5, p_from: 'evil', p_to: 'evil', p_brands: ['evil'] })
    expect(args).toEqual({ p_limit: 5, p_from: bounds.gte, p_to: bounds.lt, p_brands: ['x'] })
  })
})

describe('brandParam', () => {
  const brands = [brand('joola', 'u2'), brand('selkirk', 'u1')]
  it('returns null when no filter is active', () => {
    expect(brandParam(brands, false)).toBeNull()
  })
  it('returns the sorted uuid list when filtered', () => {
    expect(brandParam(brands, true)).toEqual(['u1', 'u2'])
  })
})

describe('rpcKey', () => {
  it('is a tuple of rpc, fn and a stable args string', () => {
    const key = rpcKey('fn_x', { a: 1 })
    expect(key[0]).toBe('rpc')
    expect(key[1]).toBe('fn_x')
    expect(typeof key[2]).toBe('string')
  })

  it('is equal regardless of key insertion order, including nested objects', () => {
    const a = rpcKey('f', { p_to: 'b', p_from: 'a', nested: { z: 1, y: [2, { k: 1, j: 0 }] } })
    const b = rpcKey('f', { nested: { y: [2, { j: 0, k: 1 }], z: 1 }, p_from: 'a', p_to: 'b' })
    expect(a).toEqual(b)
  })

  it('differs when values differ', () => {
    expect(rpcKey('f', { a: 1 })).not.toEqual(rpcKey('f', { a: 2 }))
    expect(rpcKey('f', { a: 1 })).not.toEqual(rpcKey('g', { a: 1 }))
  })
})

describe('stableStringify', () => {
  it('drops undefined object values like JSON.stringify', () => {
    expect(stableStringify({ b: undefined, a: null })).toBe('{"a":null}')
  })
})
