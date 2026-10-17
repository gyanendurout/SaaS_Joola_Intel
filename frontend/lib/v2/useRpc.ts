'use client'

/**
 * Typed SWR hook for dashboard Postgres functions. Sends the active date
 * window and brand filter as `p_from` / `p_to` (exclusive) / `p_brands`
 * (null = all brands), plus any `extra` params. Data changes at most weekly,
 * so results are cached for hours and never refetched on focus/reconnect.
 */
import { useMemo } from 'react'
import useSWR, { type SWRConfiguration } from 'swr'
import { supabase } from '@/lib/shared/supabase'
import { useDateRange } from './DateRangeContext'
import { useBrandFilter } from './BrandFilterContext'
import { brandParam, rpcArgs, rpcKey, stableStringify, type RpcArgs } from './rpcArgs'

const SIX_HOURS = 6 * 60 * 60 * 1000

export function useRpc<T>(
  fn: string,
  extra: Record<string, unknown> = {},
  cfg: SWRConfiguration<T> = {},
) {
  const { bounds: { gte, lt }, ready, latestDataDate } = useDateRange()
  const { filteredBrands, isFiltered } = useBrandFilter()

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

  return useSWR<T>(
    ready ? key : null,
    async () => {
      const { data, error } = await supabase.rpc(fn, args)
      if (error) throw error
      return data as T
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: SIX_HOURS,
      keepPreviousData: true,
      ...cfg,
    },
  )
}
