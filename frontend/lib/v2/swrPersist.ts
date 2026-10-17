/**
 * Pure helpers for SwrProvider's sessionStorage persistence (kept separate
 * so they can be unit-tested without a browser).
 *
 * useRpc keys are ['rpc', fn, argsJson, dataVersion]; SWR serialises them as
 *   @"rpc","<fn>","<escaped args json>","<dataVersion>",
 * so the data version is always the last quoted element.
 */
export const RPC_KEY_PREFIX = '@"rpc",'
const UNKNOWN_VERSION = 'unknown'

export type PersistedEntry = [string, { data: unknown }]

/** Map whose iteration order is "least recently written first". */
export class RecencyMap<V> extends Map<string, V> {
  set(key: string, value: V): this {
    super.delete(key)
    return super.set(key, value)
  }
}

/** The data version (latest data date) baked into a serialised useRpc key. */
export function dataVersionOf(serializedKey: string): string | null {
  if (!serializedKey.startsWith(RPC_KEY_PREFIX)) return null
  const m = /"([^"\\]*)",$/.exec(serializedKey)
  return m ? m[1] : null
}

function isPersistable(key: string, state: unknown): boolean {
  if (!key.startsWith(RPC_KEY_PREFIX) || dataVersionOf(key) === null) return false
  const s = state as { data?: unknown; error?: unknown } | null | undefined
  return !!s && s.data !== undefined && !s.error
}

/**
 * Choose what to persist from cache entries in insertion (oldest-first)
 * order: settled useRpc entries for the newest data version only, keeping the
 * `cap` most recent. Returns entries oldest-first so a reload restores order.
 */
export function selectEntriesToPersist(
  // The array member is redundant at runtime but lets literal tuples type-check.
  entries: ReadonlyArray<readonly [string, unknown]> | Iterable<readonly [string, unknown]>,
  cap: number,
): PersistedEntry[] {
  const settled = Array.from(entries).filter(([k, s]) => isPersistable(k, s))
  const versions = settled.map(([k]) => dataVersionOf(k) as string)
  const known = versions.filter((v) => v !== UNKNOWN_VERSION).sort()
  const newest = known.length > 0 ? known[known.length - 1] : UNKNOWN_VERSION
  const current = settled.filter((_, i) => versions[i] === newest)
  return current
    .slice(Math.max(0, current.length - cap))
    .map(([k, s]): PersistedEntry => [k, { data: (s as { data: unknown }).data }])
}

/** Parse the stored payload, dropping anything malformed. Never throws. */
export function parseStored(raw: string | null): PersistedEntry[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is PersistedEntry =>
        Array.isArray(e) && typeof e[0] === 'string' && dataVersionOf(e[0]) !== null &&
        typeof e[1] === 'object' && e[1] !== null && 'data' in e[1],
    )
  } catch {
    return []
  }
}
