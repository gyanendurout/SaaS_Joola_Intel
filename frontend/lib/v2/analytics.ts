'use client'

/**
 * v2 analytics adapter — reads the outputs of the analytics_backend
 * pipeline (lag scans, changepoints, granger causality) plus the
 * joola_timeseries_daily materialized view defined in migration 013.
 *
 * The schema may not yet exist on every Supabase project — every
 * fetcher here gracefully returns [] (and console.warn's once) so
 * pages can render a friendly "not yet available" state.
 *
 * Brand slug == brands.slug to match the rest of the v2 layer.
 */

import { supabase } from '@/lib/shared/supabase'

// ─── Shared shapes ────────────────────────────────────────────────────

export type LagScanPayloadPoint = {
  lag: number
  pearson_r: number
  pearson_p: number
  spearman_rho: number
  spearman_p: number
  n?: number
}

export type LagScanPayload = {
  driver: string
  target: string
  points: LagScanPayloadPoint[]
  best_lag: number | null
  best_score: number | null
  best_pvalue: number | null
  n_samples: number | null
}

export type LagScanRow = {
  brand_id: string
  brand_slug: string
  product_id: string | null
  product_name: string | null
  driver: string
  target: string
  best_lag: number | null
  best_score: number | null
  best_pvalue: number | null
  payload: LagScanPayload | null
}

export type ChangepointRow = {
  brand_id: string
  brand_slug: string
  product_id: string | null
  product_name: string | null
  series_name: string
  changepoint_dates: string[]
  smoothing_window: number | null
  penalty: number | null
}

export type GrangerRow = {
  brand_id: string
  brand_slug: string
  product_id: string | null
  product_name: string | null
  driver: string
  target: string
  best_lag: number | null
  best_pvalue: number | null
  ssr_ftest_p: number | null
  lrtest_p: number | null
  integration_order_driver: number | null
  integration_order_target: number | null
  n_samples: number | null
}

export type TimeseriesRow = {
  brand_id: string
  brand_slug: string
  product_id: string | null
  product_name: string | null
  date: string
  attention_score: number | null
  mentions: number | null
  estimated_units_sold: number | null
  ad_pressure_score: number | null
  promo_active: boolean | null
}

// ─── Internals ────────────────────────────────────────────────────────

const MISSING_TABLE_RE = /(does not exist|42P01|relation .* does not exist|Could not find the table)/i

let warnedAnalyticsResults = false
let warnedTimeseries = false

function isMissingTable(error: unknown): boolean {
  if (!error) return false
  const msg = String((error as { message?: string }).message || error)
  return MISSING_TABLE_RE.test(msg)
}

async function fetchBrandLookup(): Promise<{
  slugByBid: Record<string, string>
  nameByPid: Record<string, string>
}> {
  const [{ data: brandRows }, { data: productRows }] = await Promise.all([
    supabase.from('brands').select('id,slug'),
    supabase.from('products_catalog').select('id,display_name'),
  ])
  const slugByBid: Record<string, string> = {}
  ;(brandRows || []).forEach((b: { id: string; slug: string }) => {
    slugByBid[b.id] = b.slug
  })
  const nameByPid: Record<string, string> = {}
  ;(productRows || []).forEach((p: { id: string; display_name: string | null }) => {
    nameByPid[p.id] = p.display_name || ''
  })
  return { slugByBid, nameByPid }
}

// ─── analysis_results readers ─────────────────────────────────────────
//
// analysis_results columns (migration 013):
//   id, kind, brand_id, product_id, driver, target, series_name,
//   best_lag, best_score, best_pvalue, payload (jsonb), created_at,
//   smoothing_window, penalty, integration_order_driver,
//   integration_order_target, ssr_ftest_p, lrtest_p, n_samples,
//   changepoint_dates (text[])
//
// Older drafts only had a payload column — every reader below uses
// payload fallbacks for missing top-level fields so we don't break.

type RawAnalysisRow = {
  brand_id: string
  product_id: string | null
  driver: string | null
  target: string | null
  series_name: string | null
  best_lag: number | null
  best_score: number | null
  best_pvalue: number | null
  payload: unknown
  smoothing_window: number | null
  penalty: number | null
  ssr_ftest_p: number | null
  lrtest_p: number | null
  integration_order_driver: number | null
  integration_order_target: number | null
  n_samples: number | null
  changepoint_dates: string[] | null
}

async function fetchAnalysisRows(
  kind: 'lag_scan' | 'changepoint' | 'granger',
  brandSlug?: string,
  productId?: string,
): Promise<{ rows: RawAnalysisRow[]; slugByBid: Record<string, string>; nameByPid: Record<string, string> }> {
  const { slugByBid, nameByPid } = await fetchBrandLookup()
  const bidBySlug: Record<string, string> = Object.fromEntries(
    Object.entries(slugByBid).map(([bid, slug]) => [slug, bid]),
  )

  let query = supabase
    .from('analysis_results')
    .select(
      'brand_id,product_id,driver,target,series_name,best_lag,best_score,best_pvalue,payload,smoothing_window,penalty,ssr_ftest_p,lrtest_p,integration_order_driver,integration_order_target,n_samples,changepoint_dates',
    )
    .eq('kind', kind)
    .order('best_score', { ascending: false, nullsFirst: false })
    .limit(2000)

  if (brandSlug && bidBySlug[brandSlug]) {
    query = query.eq('brand_id', bidBySlug[brandSlug])
  }
  if (productId) {
    query = query.eq('product_id', productId)
  }

  const { data, error } = await query
  if (error) {
    if (isMissingTable(error) && !warnedAnalyticsResults) {
      warnedAnalyticsResults = true
      // eslint-disable-next-line no-console
      console.warn(
        '[analytics] analysis_results table missing — apply migration 013 and run the analytics_backend pipeline to populate.',
      )
    } else if (!isMissingTable(error)) {
      // eslint-disable-next-line no-console
      console.warn('[analytics] failed to load analysis_results:', error)
    }
    return { rows: [], slugByBid, nameByPid }
  }

  return { rows: (data as RawAnalysisRow[]) || [], slugByBid, nameByPid }
}

// ─── Lag scans ────────────────────────────────────────────────────────

export async function fetchLagScans(
  brandSlug?: string,
  productId?: string,
): Promise<LagScanRow[]> {
  const { rows, slugByBid, nameByPid } = await fetchAnalysisRows('lag_scan', brandSlug, productId)

  return rows
    .map((r): LagScanRow | null => {
      const payload = (r.payload && typeof r.payload === 'object') ? (r.payload as Record<string, unknown>) : null
      const points: LagScanPayloadPoint[] = Array.isArray(payload?.points)
        ? (payload!.points as LagScanPayloadPoint[])
        : []
      const driver = r.driver || (payload?.driver as string) || ''
      const target = r.target || (payload?.target as string) || ''
      if (!driver || !target) return null

      const lagPayload: LagScanPayload = {
        driver,
        target,
        points,
        best_lag: r.best_lag ?? (payload?.best_lag as number | null) ?? null,
        best_score: r.best_score ?? (payload?.best_score as number | null) ?? null,
        best_pvalue: r.best_pvalue ?? (payload?.best_pvalue as number | null) ?? null,
        n_samples: r.n_samples ?? (payload?.n_samples as number | null) ?? null,
      }

      return {
        brand_id: r.brand_id,
        brand_slug: slugByBid[r.brand_id] || 'unknown',
        product_id: r.product_id,
        product_name: r.product_id ? nameByPid[r.product_id] || null : null,
        driver,
        target,
        best_lag: lagPayload.best_lag,
        best_score: lagPayload.best_score,
        best_pvalue: lagPayload.best_pvalue,
        payload: lagPayload,
      }
    })
    .filter((r): r is LagScanRow => r !== null)
}

// ─── Changepoints ─────────────────────────────────────────────────────

export async function fetchChangepoints(
  brandSlug?: string,
  productId?: string,
): Promise<ChangepointRow[]> {
  const { rows, slugByBid, nameByPid } = await fetchAnalysisRows('changepoint', brandSlug, productId)

  return rows
    .map((r): ChangepointRow | null => {
      const payload = (r.payload && typeof r.payload === 'object') ? (r.payload as Record<string, unknown>) : null
      const dates: string[] = Array.isArray(r.changepoint_dates)
        ? r.changepoint_dates
        : Array.isArray(payload?.changepoint_dates)
          ? (payload!.changepoint_dates as string[])
          : []
      const seriesName = r.series_name || (payload?.series_name as string) || ''
      if (!seriesName) return null

      return {
        brand_id: r.brand_id,
        brand_slug: slugByBid[r.brand_id] || 'unknown',
        product_id: r.product_id,
        product_name: r.product_id ? nameByPid[r.product_id] || null : null,
        series_name: seriesName,
        changepoint_dates: dates,
        smoothing_window: r.smoothing_window ?? (payload?.smoothing_window as number | null) ?? null,
        penalty: r.penalty ?? (payload?.penalty as number | null) ?? null,
      }
    })
    .filter((r): r is ChangepointRow => r !== null)
}

// ─── Granger causality ────────────────────────────────────────────────

export async function fetchGrangerResults(brandSlug?: string): Promise<GrangerRow[]> {
  const { rows, slugByBid, nameByPid } = await fetchAnalysisRows('granger', brandSlug)

  return rows
    .map((r): GrangerRow | null => {
      const payload = (r.payload && typeof r.payload === 'object') ? (r.payload as Record<string, unknown>) : null
      const driver = r.driver || (payload?.driver as string) || ''
      const target = r.target || (payload?.target as string) || ''
      if (!driver || !target) return null

      return {
        brand_id: r.brand_id,
        brand_slug: slugByBid[r.brand_id] || 'unknown',
        product_id: r.product_id,
        product_name: r.product_id ? nameByPid[r.product_id] || null : null,
        driver,
        target,
        best_lag: r.best_lag ?? (payload?.best_lag as number | null) ?? null,
        best_pvalue: r.best_pvalue ?? (payload?.best_pvalue as number | null) ?? null,
        ssr_ftest_p: r.ssr_ftest_p ?? (payload?.ssr_ftest_p as number | null) ?? null,
        lrtest_p: r.lrtest_p ?? (payload?.lrtest_p as number | null) ?? null,
        integration_order_driver: r.integration_order_driver ?? (payload?.integration_order_driver as number | null) ?? null,
        integration_order_target: r.integration_order_target ?? (payload?.integration_order_target as number | null) ?? null,
        n_samples: r.n_samples ?? (payload?.n_samples as number | null) ?? null,
      }
    })
    .filter((r): r is GrangerRow => r !== null)
}

// ─── Timeseries (joola_timeseries_daily MV) ──────────────────────────

export async function fetchTimeseries(
  brandSlug: string,
  productId?: string,
  days: number = 90,
): Promise<TimeseriesRow[]> {
  if (!brandSlug) return []
  const { slugByBid, nameByPid } = await fetchBrandLookup()
  const bidBySlug: Record<string, string> = Object.fromEntries(
    Object.entries(slugByBid).map(([bid, slug]) => [slug, bid]),
  )
  const brandId = bidBySlug[brandSlug]
  if (!brandId) return []

  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

  // Migration 013 column names:
  //   metric_date              (was: date)
  //   canonical_product_id     (was: product_id)
  //   mention_count            (was: mentions)
  //   promo_active_flag        (smallint 0/1, was: promo_active boolean)
  let query = supabase
    .from('joola_timeseries_daily')
    .select(
      'brand_id,canonical_product_id,metric_date,attention_score,mention_count,estimated_units_sold,ad_pressure_score,promo_active_flag',
    )
    .eq('brand_id', brandId)
    .gte('metric_date', cutoff)
    .order('metric_date', { ascending: true })
    .limit(days * 50)

  if (productId) {
    query = query.eq('canonical_product_id', productId)
  }

  const { data, error } = await query
  if (error) {
    if (isMissingTable(error) && !warnedTimeseries) {
      warnedTimeseries = true
      // eslint-disable-next-line no-console
      console.warn(
        '[analytics] joola_timeseries_daily view missing — apply migration 013 and refresh the materialized view.',
      )
    } else if (!isMissingTable(error)) {
      // eslint-disable-next-line no-console
      console.warn('[analytics] failed to load joola_timeseries_daily:', error)
    }
    return []
  }

  return (data as Array<Record<string, unknown>>).map((r): TimeseriesRow => ({
    brand_id: String(r.brand_id),
    brand_slug: slugByBid[String(r.brand_id)] || 'unknown',
    product_id: (r.canonical_product_id as string | null) ?? null,
    product_name: r.canonical_product_id ? nameByPid[String(r.canonical_product_id)] || null : null,
    date: String(r.metric_date).slice(0, 10),
    attention_score: r.attention_score != null ? Number(r.attention_score) : null,
    mentions: r.mention_count != null ? Number(r.mention_count) : null,
    estimated_units_sold: r.estimated_units_sold != null ? Number(r.estimated_units_sold) : null,
    ad_pressure_score: r.ad_pressure_score != null ? Number(r.ad_pressure_score) : null,
    promo_active: r.promo_active_flag != null ? Number(r.promo_active_flag) > 0 : null,
  }))
}
