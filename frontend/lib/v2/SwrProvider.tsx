'use client'

/**
 * App-wide SWR cache, persisted per tab in sessionStorage so navigating
 * between v2 pages (or reloading) doesn't refetch dashboard RPCs.
 *
 * - Seeds the cache Map from sessionStorage on first render.
 * - Writes back on `pagehide` / `beforeunload`: only `useRpc` entries
 *   (SWR serialises the ['rpc', fn, args] key as `@"rpc",...`), only settled
 *   data (no errors / in-flight flags), at most MAX_ENTRIES, and skipped
 *   entirely if the payload exceeds MAX_BYTES.
 * - Every storage access is in try/catch; corrupt or unavailable storage
 *   just means an empty cache.
 */
import { SWRConfig, type Cache } from 'swr'

const STORAGE_KEY = 'joola-swr-v1'
const RPC_KEY_PREFIX = '@"rpc",'
const MAX_ENTRIES = 200
const MAX_BYTES = 2 * 1024 * 1024

type Entry = [string, { data: unknown }]

function readStored(): Entry[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is Entry =>
        Array.isArray(e) && typeof e[0] === 'string' && e[0].startsWith(RPC_KEY_PREFIX) &&
        typeof e[1] === 'object' && e[1] !== null && 'data' in e[1],
    )
  } catch {
    return []
  }
}

function persist(map: Map<string, unknown>) {
  try {
    const entries: Entry[] = []
    map.forEach((state, key) => {
      if (entries.length >= MAX_ENTRIES || !key.startsWith(RPC_KEY_PREFIX)) return
      const s = state as { data?: unknown; error?: unknown } | undefined
      if (s && s.data !== undefined && !s.error) entries.push([key, { data: s.data }])
    })
    const json = JSON.stringify(entries)
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
  const map = new Map<string, unknown>(readStored())
  const save = () => persist(map)
  window.addEventListener('pagehide', save)
  window.addEventListener('beforeunload', save)
  return map as Cache
}

export function SwrProvider({ children }: { children: React.ReactNode }) {
  return <SWRConfig value={{ provider: cacheProvider }}>{children}</SWRConfig>
}
