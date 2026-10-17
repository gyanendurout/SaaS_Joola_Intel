'use client'

/**
 * Typed SWR hook for dashboard Postgres functions. Sends the active date
 * window and brand filter as `p_from` / `p_to` (exclusive) / `p_brands`
 * (null = all brands), plus any `extra` params. Data changes at most weekly,
 * and the latest data date is part of the cache key, so cached results are
 * reused as-is: no refetch on focus, reconnect, or remount from cache.
 */
import { useMemo } from 'react'
import useSWR, { unstable_serialize, useSWRConfig, type SWRConfiguration, type SWRResponse } from 'swr'
import { supabase } from '@/lib/shared/supabase'
import { useDateRange } from './DateRangeContext'
import { useBrandFilter } from './BrandFilterContext'
import {
  brandParam,
  isRetryableRpcError,
  rpcArgs,
  rpcKey,
  stableStringify,
  type RpcArgs,
} from './rpcArgs'

const SIX_HOURS = 6 * 60 * 60 * 1000
const MAX_RETRIES = 2

/** PostgREST error surfaced by useRpc, with the HTTP status attached. */
export type RpcError = Error & { code?: string; details?: string; hint?: string; status?: number }

export type UseRpcResult<T> = SWRResponse<T, RpcError> & {
  /**
   * True while `data` belongs to a PREVIOUS key (an earlier date window or
   * brand selection) because `keepPreviousData` keeps it on screen until the
   * new result arrives (or if that fetch failed). Pages must dim or hide
   * filter-sensitive numbers — share of voice, ranks, totals — while
   * `isStale`, since they describe the old filter, not the current one.
   */
  isStale: boolean
}

const onErrorRetry: NonNullable<SWRConfiguration['onErrorRetry']> = (
  err, _key, config, revalidate, opts,
) => {
  if (!isRetryableRpcError(err)) return
  if (opts.retryCount > (config.errorRetryCount ?? MAX_RETRIES)) return
  setTimeout(revalidate, config.errorRetryInterval * 2 ** (opts.retryCount - 1), opts)
}

export function useRpc<T>(
  fn: string,
  extra: Record<string, unknown> = {},
  cfg: SWRConfiguration<T, RpcError> = {},
): UseRpcResult<T> {
  const { bounds: { gte, lt }, ready, latestDataDate } = useDateRange()
  const { filteredBrands, isFiltered } = useBrandFilter()
  const { cache } = useSWRConfig()

  // Memoize on value, not identity, so an inline `extra` literal doesn't churn.
  const extraKey = stableStringify(extra)
  const brandsKey = stableStringify(brandParam(filteredBrands, isFiltered))
  const { args, key } = useMemo(() => {
    const a: RpcArgs = rpcArgs(
      { gte, lt },
      JSON.parse(brandsKey) as string[] | null,
      JSON.parse(extraKey) as Record<string, unknown>,
    )
    return { args: a, key: rpcKey(fn, a, latestDataDate) }
  }, [fn, gte, lt, brandsKey, extraKey, latestDataDate])

  const activeKey = ready ? key : null
  const swr = useSWR<T, RpcError>(
    activeKey,
    async () => {
      const { data, error, status } = await supabase.rpc(fn, args)
      if (error) throw Object.assign(new Error(error.message), { ...error, status }) as RpcError
      return data as T
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      dedupingInterval: SIX_HOURS,
      keepPreviousData: true,
      errorRetryCount: MAX_RETRIES,
      onErrorRetry,
      ...cfg,
    },
  )

  // Data on screen but none cached for the current key → it is the previous key's.
  const isStale =
    activeKey !== null &&
    swr.data !== undefined &&
    cache.get(unstable_serialize(activeKey))?.data === undefined

  return { ...swr, isStale }
}
