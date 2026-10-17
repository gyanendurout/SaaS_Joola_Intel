'use client'

/**
 * App-wide SWR cache, persisted per tab in sessionStorage so navigating
 * between v2 pages (or reloading) doesn't refetch dashboard RPCs.
 *
 * - Seeds the cache from sessionStorage on first render (malformed entries
 *   are dropped; see `parseStored`).
 * - Writes back on `pagehide` / `beforeunload` via `selectEntriesToPersist`:
 *   settled `useRpc` entries of the newest data version only, the
 *   MAX_ENTRIES most recently written, skipped if larger than MAX_BYTES.
 * - The cache Map moves a key to the end whenever SWR writes it, so
 *   insertion order is recency order.
 * - Listeners are registered once per page (module flag) and always save the
 *   cache of the most recently mounted provider, so React strict mode's
 *   double-invoked initialiser can't stack duplicate handlers.
 * - Every storage access is in try/catch; persistence is best-effort.
 */
import { SWRConfig, type Cache } from 'swr'
import { parseStored, RecencyMap, selectEntriesToPersist } from './swrPersist'

const STORAGE_KEY = 'joola-swr-v1'
const MAX_ENTRIES = 200
const MAX_BYTES = 2 * 1024 * 1024

let activeCache: RecencyMap<unknown> | null = null
let listenersRegistered = false

function readStored(): ReturnType<typeof parseStored> {
  try {
    return parseStored(window.sessionStorage.getItem(STORAGE_KEY))
  } catch {
    return []
  }
}

function persistActiveCache() {
  if (!activeCache) return
  try {
    const json = JSON.stringify(selectEntriesToPersist(activeCache.entries(), MAX_ENTRIES))
    if (json.length > MAX_BYTES) {
      window.sessionStorage.removeItem(STORAGE_KEY)
      return
    }
    window.sessionStorage.setItem(STORAGE_KEY, json)
  } catch {
    // Quota exceeded or storage blocked: persistence is best-effort.
  }
}

function cacheProvider(): Cache {
  if (typeof window === 'undefined') return new Map() as Cache
  const map = new RecencyMap<unknown>(readStored())
  activeCache = map
  if (!listenersRegistered) {
    window.addEventListener('pagehide', persistActiveCache)
    window.addEventListener('beforeunload', persistActiveCache)
    listenersRegistered = true
  }
  return map as Cache
}

export function SwrProvider({ children }: { children: React.ReactNode }) {
  return <SWRConfig value={{ provider: cacheProvider }}>{children}</SWRConfig>
}
