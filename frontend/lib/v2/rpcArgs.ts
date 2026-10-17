/**
 * Pure helpers for calling dashboard Postgres functions (RPCs).
 *
 * Convention for every dashboard RPC:
 *   p_from   timestamptz  — window start, inclusive (DateRange `bounds.gte`)
 *   p_to     timestamptz  — window end, EXCLUSIVE   (DateRange `bounds.lt`)
 *   p_brands uuid[]       — brand filter; null means all brands
 */
import type { V2Brand } from './data'

export type RpcBounds = { gte: string; lt: string }
export type RpcArgs = Record<string, unknown> & {
  p_from: string
  p_to: string
  p_brands: string[] | null
}
export type RpcKey = readonly ['rpc', string, string]

/** Build RPC args. The window and brand params always win over `extra`. */
export function rpcArgs(
  bounds: RpcBounds,
  brandUuids: string[] | null,
  extra: Record<string, unknown> = {},
): RpcArgs {
  return {
    ...extra,
    p_from: bounds.gte,
    p_to: bounds.lt,
    p_brands: brandUuids === null ? null : [...brandUuids].sort(),
  }
}

/**
 * Brand param from the brand filter. Honours the `isFiltered` contract
 * (CLAUDE.md invariant 2): not filtered → null → the RPC returns all brands.
 */
export function brandParam(filteredBrands: V2Brand[], isFiltered: boolean): string[] | null {
  if (!isFiltered) return null
  return filteredBrands.map((b) => b.brand_id).sort()
}

/** JSON.stringify with object keys sorted at every depth (array order kept). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v
    const src = v as Record<string, unknown>
    return Object.keys(src)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => ({ ...acc, [k]: src[k] }), {})
  })
}

/** SWR cache key: identical args (in any key order) give an identical key. */
export function rpcKey(fn: string, args: Record<string, unknown>): RpcKey {
  return ['rpc', fn, stableStringify(args)] as const
}
