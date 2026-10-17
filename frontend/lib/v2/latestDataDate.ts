/**
 * Helpers for the latest-data-date lookup (`rpc_latest_data_date`).
 * Pure / injectable so they can be tested without Supabase.
 */

import { isValidIsoDay, type IsoDay } from './dateWindow'

/** The RPC's `date` result as an IsoDay, or null for anything unusable. */
export function parseRpcDay(data: unknown): IsoDay | null {
  if (typeof data !== 'string') return null
  const day = data.slice(0, 10)
  return isValidIsoDay(day) ? day : null
}

/**
 * Wrap a loader so concurrent callers share one in-flight call and a
 * non-null result is cached for the session. A null result or a rejection
 * resolves to null and clears the cache, so a later call retries.
 */
export function cacheSuccessful<T>(load: () => Promise<T | null>): () => Promise<T | null> {
  let cache: Promise<T | null> | null = null
  return () => {
    if (cache) return cache
    const p = load().then(
      (v) => v,
      () => null,
    )
    cache = p
    p.then((v) => {
      if (v === null && cache === p) cache = null
    })
    return p
  }
}

/** Resolves with `p`'s value, or with `fallback` if `p` takes longer than `ms`. Never rejects. */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      () => {
        clearTimeout(timer)
        resolve(fallback)
      },
    )
  })
}
