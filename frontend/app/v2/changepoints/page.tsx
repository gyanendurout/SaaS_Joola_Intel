'use client'

import { useEffect, useMemo, useState } from 'react'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import {
  fetchChangepoints,
  fetchTimeseries,
  type ChangepointRow,
  type TimeseriesRow,
} from '@/lib/v2/analytics'
import { PageHead, LoadingPage, SectionInfo, pgName, pgColor, SortTh, ColumnFilter } from '@/components/v2/PageShell'
import { ChangepointTimeline } from '@/components/v2/charts/ChangepointTimeline'

type SeriesName = 'attention_score' | 'estimated_units_sold' | 'ad_pressure_score'

const SERIES_OPTIONS: { key: SeriesName; label: string }[] = [
  { key: 'attention_score', label: 'Attention score' },
  { key: 'estimated_units_sold', label: 'Estimated units sold' },
  { key: 'ad_pressure_score', label: 'Ad pressure score' },
]

type CpEntry = {
  brandSlug: string
  productId: string | null
  productName: string | null
  seriesName: string
  dates: string[]
  smoothing: number | null
}

export default function ChangepointsPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [cps, setCps] = useState<ChangepointRow[]>([])
  const [series, setSeries] = useState<Record<string, TimeseriesRow[]>>({})
  const [loading, setLoading] = useState(true)
  const [brandSlug, setBrandSlug] = useState<string>('')
  const [activeSeries, setActiveSeries] = useState<SeriesName[]>(SERIES_OPTIONS.map((s) => s.key))
  const [logSortKey, setLogSortKey] = useState<string | null>('date')
  const [logSortDir, setLogSortDir] = useState<'asc' | 'desc'>('desc')
  const [logColFilter, setLogColFilter] = useState<Record<string, string>>({})

  function toggleLogSort(k: string) {
    if (logSortKey === k) setLogSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setLogSortKey(k); setLogSortDir('desc') }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const b = await fetchBrands()
        if (cancelled) return
        setBrands(b)
        const cpRows = await fetchChangepoints()
        if (cancelled) return
        setCps(cpRows)

        // Top distinct (brand, product) pairs by # of changepoints — fetch up to 8
        const seen = new Map<string, { brandSlug: string; productId: string | null }>()
        for (const r of cpRows) {
          if (!r.changepoint_dates.length) continue
          const key = `${r.brand_slug}::${r.product_id || ''}`
          if (!seen.has(key)) seen.set(key, { brandSlug: r.brand_slug, productId: r.product_id })
          if (seen.size >= 8) break
        }

        const seriesMap: Record<string, TimeseriesRow[]> = {}
        await Promise.all(
          Array.from(seen.entries()).map(async ([key, v]) => {
            const ts = await fetchTimeseries(v.brandSlug, v.productId || undefined, 120)
            seriesMap[key] = ts
          }),
        )
        if (!cancelled) setSeries(seriesMap)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[changepoints] failed to load', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    document.title = 'JOOLA INTEL — Changepoint Monitor'
  }, [])

  const availableBrandSlugs = useMemo(
    () => Array.from(new Set(cps.map((r) => r.brand_slug))).sort(),
    [cps],
  )

  // Group changepoints by (brand, product) key for visualization
  const grouped = useMemo<CpEntry[]>(() => {
    const map = new Map<string, CpEntry>()
    cps.forEach((r) => {
      if (!r.changepoint_dates.length) return
      if (brandSlug && r.brand_slug !== brandSlug) return
      const seriesKey = r.series_name as SeriesName
      if (!activeSeries.includes(seriesKey)) return
      const key = `${r.brand_slug}::${r.product_id || ''}::${r.series_name}`
      if (!map.has(key)) {
        map.set(key, {
          brandSlug: r.brand_slug,
          productId: r.product_id,
          productName: r.product_name,
          seriesName: r.series_name,
          dates: [],
          smoothing: r.smoothing_window,
        })
      }
      const entry = map.get(key)!
      entry.dates = Array.from(new Set([...entry.dates, ...r.changepoint_dates])).sort()
    })
    // Top N by number of changepoints
    return Array.from(map.values())
      .sort((a, b) => b.dates.length - a.dates.length)
      .slice(0, 8)
  }, [cps, brandSlug, activeSeries])

  // Chronological log across everything (most recent first)
  const cpLog = useMemo(() => {
    const flat: { brandSlug: string; productName: string | null; seriesName: string; date: string }[] = []
    cps.forEach((r) => {
      if (brandSlug && r.brand_slug !== brandSlug) return
      const seriesKey = r.series_name as SeriesName
      if (!activeSeries.includes(seriesKey)) return
      r.changepoint_dates.forEach((d) => {
        flat.push({
          brandSlug: r.brand_slug,
          productName: r.product_name,
          seriesName: r.series_name,
          date: d,
        })
      })
    })
    return flat.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 200)
  }, [cps, brandSlug, activeSeries])

  // Sort + filter the log for the table render
  const cpLogDisplay = useMemo(() => {
    const enriched = cpLog.map((r) => ({ ...r, brandName: pgName(r.brandSlug, brands) }))
    const filtered = enriched.filter((r) =>
      Object.entries(logColFilter).every(([k, q]) => {
        if (!q) return true
        const cell = String((r as unknown as Record<string, unknown>)[k] ?? '')
        return cell.toLowerCase().includes(q.toLowerCase())
      })
    )
    if (!logSortKey) return filtered
    return [...filtered].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[logSortKey]
      const bv = (b as unknown as Record<string, unknown>)[logSortKey]
      const as = String(av ?? ''), bs = String(bv ?? '')
      return logSortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
    })
  }, [cpLog, logColFilter, logSortKey, logSortDir, brands])

  if (loading) return <LoadingPage />

  const hasData = cps.length > 0
  const totalChangepoints = cps.reduce((s, r) => s + r.changepoint_dates.length, 0)
  const sub = hasData
    ? `${totalChangepoints} regime breaks detected across ${availableBrandSlugs.length} brands · investigate spikes flagged in orange.`
    : 'Regime-shift monitor ready. Awaiting analytics_backend pipeline output.'

  return (
    <>
      <PageHead
        eyebrow={`CHANGEPOINTS · ${totalChangepoints} REGIME BREAKS`}
        title="Changepoint"
        accent="monitor"
        sub={sub}
        actions={
          hasData ? (
            <select
              value={brandSlug}
              onChange={(e) => setBrandSlug(e.target.value)}
              className="page-select"
              aria-label="Filter by brand"
            >
              <option value="">All brands</option>
              {availableBrandSlugs.map((slug) => (
                <option key={slug} value={slug}>
                  {pgName(slug, brands)}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />

      <section>
        <div className="card" style={{ padding: 16, marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: '#F5E625',
              }}
            >
              How to read this
            </span>
            <SectionInfo
              title="Regime break"
              description="A changepoint is an algorithmically detected break in the statistical regime of a series — the mean, variance, or trend shifted enough that the data before and after look like they came from different processes. It does NOT identify the CAUSE; it just flags WHEN something changed so an analyst can investigate."
              source="lib/v2/analytics.ts · scripts/analytics_backend (changepoint, ruptures)"
            />
          </div>
          <div className="legend-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, fontSize: 12 }}>
            <div>
              <div style={{ color: '#f59e0b', fontWeight: 800, marginBottom: 4 }}>
                Regime break (dashed orange line)
              </div>
              <div style={{ color: '#8a93a4', lineHeight: 1.4 }}>
                The series&apos; behavior changed on this date. The penalty parameter (lambda) controls sensitivity — too low = noise picked up as breaks, too high = real shifts missed.
              </div>
            </div>
            <div>
              <div style={{ color: '#22c55e', fontWeight: 800, marginBottom: 4 }}>
                Smoothing window
              </div>
              <div style={{ color: '#8a93a4', lineHeight: 1.4 }}>
                Most series are smoothed with a rolling mean before detection to suppress single-day noise. The window length is shown on each chart.
              </div>
            </div>
          </div>

          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#8a93a4', alignSelf: 'center', marginRight: 6 }}>
              Series:
            </span>
            {SERIES_OPTIONS.map((s) => {
              const on = activeSeries.includes(s.key)
              return (
                <button
                  key={s.key}
                  onClick={() =>
                    setActiveSeries(
                      on
                        ? activeSeries.filter((x) => x !== s.key)
                        : Array.from(new Set([...activeSeries, s.key])),
                    )
                  }
                  className={'pill ' + (on ? 'pill-yellow' : 'pill-ghost')}
                  style={{ cursor: 'pointer', fontSize: 11 }}
                >
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {!hasData && (
        <section>
          <div className="card" style={{ textAlign: 'center', padding: 48 }}>
            <div style={{ fontSize: 14, color: 'var(--fg-2)', marginBottom: 8 }}>
              Changepoint analysis has not been generated yet.
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>
              This page will populate after the analytics pipeline runs.
            </div>
          </div>
        </section>
      )}

      {hasData && (
        <section>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>
            <div>
              {grouped.length === 0 ? (
                <div className="card" style={{ padding: 28, textAlign: 'center', color: '#8a93a4', fontSize: 12 }}>
                  No changepoints match the current filter.
                </div>
              ) : (
                grouped.map((entry) => {
                  const seriesKey = `${entry.brandSlug}::${entry.productId || ''}`
                  const tsRows = series[seriesKey] || []
                  const seriesPoints = tsRows
                    .map((r) => ({
                      date: r.date,
                      value: Number((r as unknown as Record<string, number | null>)[entry.seriesName] ?? 0),
                    }))
                    .filter((p) => isFinite(p.value))

                  return (
                    <div key={seriesKey + '::' + entry.seriesName} className="card" style={{ marginBottom: 14 }}>
                      <div className="card-pad">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className="brand-dot" style={{ background: pgColor(entry.brandSlug) }} />
                              <span style={{ fontWeight: 800, color: entry.brandSlug === 'joola' ? '#22c55e' : 'var(--fg)' }}>
                                {pgName(entry.brandSlug, brands)}
                              </span>
                              {entry.productName && (
                                <span style={{ color: '#8a93a4', fontSize: 12 }}>· {entry.productName}</span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: '#8a93a4', marginTop: 2 }}>
                              {entry.seriesName.replace(/_/g, ' ')} · {entry.dates.length} regime break{entry.dates.length === 1 ? '' : 's'}
                            </div>
                          </div>
                        </div>

                        {seriesPoints.length === 0 ? (
                          <div style={{ padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 11 }}>
                            Series data not available — joola_timeseries_daily missing or empty for this product.
                          </div>
                        ) : (
                          <ChangepointTimeline
                            series={seriesPoints}
                            changepoints={entry.dates.map((d) => ({ date: d }))}
                            seriesLabel={entry.seriesName.replace(/_/g, ' ')}
                            smoothing={entry.smoothing || undefined}
                          />
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <div>
              <div className="card">
                <div className="card-pad">
                  <h3 style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#cbd1dc', marginBottom: 12 }}>
                    Changepoint log <span style={{ color: '#6b7280', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· up to 200 most recent</span>
                  </h3>
                  <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
                    <table className="data" style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
                        <tr>
                          <SortTh col="date" label="Date" sortKey={logSortKey} sortDir={logSortDir} toggle={toggleLogSort} />
                          <SortTh col="brandName" label="Brand" sortKey={logSortKey} sortDir={logSortDir} toggle={toggleLogSort} />
                          <SortTh col="productName" label="Detail" sortKey={logSortKey} sortDir={logSortDir} toggle={toggleLogSort} />
                        </tr>
                        <tr className="col-filter-row">
                          <th />
                          <th><ColumnFilter col="brandName" value={logColFilter.brandName} onChange={(v) => setLogColFilter((p) => ({ ...p, brandName: v }))} placeholder="brand…" /></th>
                          <th><ColumnFilter col="productName" value={logColFilter.productName} onChange={(v) => setLogColFilter((p) => ({ ...p, productName: v }))} placeholder="product…" /></th>
                        </tr>
                      </thead>
                      <tbody>
                        {cpLogDisplay.length === 0 ? (
                          <tr>
                            <td colSpan={3} style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>
                              No rows found for the selected filters.
                            </td>
                          </tr>
                        ) : (
                          cpLogDisplay.map((entry, i) => (
                            <tr key={`${entry.brandSlug}-${entry.date}-${i}`}>
                              <td style={{ fontSize: 11, color: '#cbd1dc', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                <span style={{ display: 'inline-block', width: 4, height: 4, borderRadius: 99, background: '#f59e0b', marginRight: 6, verticalAlign: 'middle' }} />
                                {entry.date}
                              </td>
                              <td style={{ fontSize: 11 }}>
                                <span style={{ color: pgColor(entry.brandSlug), fontWeight: 700 }}>{entry.brandName}</span>
                              </td>
                              <td style={{ fontSize: 10, color: '#8a93a4' }}>
                                {entry.productName ? entry.productName + ' · ' : ''}{entry.seriesName.replace(/_/g, ' ')}
                                <a
                                  href={`/v2/correlations?brand=${entry.brandSlug}`}
                                  style={{ fontSize: 10, color: '#F5E625', textDecoration: 'none', marginLeft: 6 }}
                                >
                                  Investigate →
                                </a>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  )
}
