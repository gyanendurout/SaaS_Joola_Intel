'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/shared/supabase'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import {
  fetchLagScans,
  type LagScanRow,
  type LagScanPayloadPoint,
} from '@/lib/v2/analytics'
import { PageHead, LoadingPage, SectionInfo, pgName, pgColor, SortTh, ColumnFilter } from '@/components/v2/PageShell'
import { CorrelationHeatmap, type CorrelationCell } from '@/components/v2/charts/CorrelationHeatmap'
import { LagScanChart } from '@/components/v2/charts/LagScanChart'

type LeadingIndicatorRow = {
  kind: string
  driver: string
  target: string
  bestLag: number | null
  bestScore: number | null
  bestPvalue: number | null
}

function formatMetricName(s: string): string {
  if (!s) return '—'
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function whatItMeans(driver: string, target: string, bestLag: number | null): string {
  const lag = bestLag ?? 0
  const d = (driver || '').toLowerCase()
  if (d.includes('ad_pressure')) return `Competitor ad activity leads outcome by ${lag} days`
  if (d.includes('attention')) return `Attention signals lead outcome by ${lag} days`
  if (d.includes('promo')) return `Promo activity leads outcome by ${lag} days`
  return `${driver} leads ${target} by ${lag} days`
}

function businessMeaning(driver: string, target: string): { meaning: string; action: string } {
  const key = `${driver}->${target}`
  if (driver === 'ad_pressure_score' && target === 'attention_score') {
    return {
      meaning: 'Competitor ads are driving attention',
      action: 'Monitor their creatives and respond before the sales window closes',
    }
  }
  if (driver === 'promo_active_flag' && target === 'mentions_total') {
    return {
      meaning: 'Promos are creating buzz',
      action: 'Consider a counter-promotion',
    }
  }
  if (driver === 'attention_score' && target === 'estimated_units_sold') {
    return {
      meaning: 'Attention is converting to sales',
      action: 'Amplify high-attention products',
    }
  }
  return {
    meaning: 'Statistical relationship detected',
    action: `Investigate the ${driver} → ${target} pair (${key})`,
  }
}

const DEFAULT_TARGET = 'estimated_units_sold'

export default function CorrelationsPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [scans, setScans] = useState<LagScanRow[]>([])
  const [loading, setLoading] = useState(true)
  const [brandSlug, setBrandSlug] = useState<string>('')
  const [target, setTarget] = useState<string>(DEFAULT_TARGET)
  const [selectedDrivers, setSelectedDrivers] = useState<string[]>([])
  const [drill, setDrill] = useState<{ driver: string; target: string } | null>(null)
  const [tblSortKey, setTblSortKey] = useState<string | null>('absScore')
  const [tblSortDir, setTblSortDir] = useState<'asc' | 'desc'>('desc')
  const [tblColFilter, setTblColFilter] = useState<Record<string, string>>({})
  const [leadingRows, setLeadingRows] = useState<LeadingIndicatorRow[]>([])

  function toggleTblSort(k: string) {
    if (tblSortKey === k) setTblSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setTblSortKey(k); setTblSortDir('desc') }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const b = await fetchBrands()
        if (cancelled) return
        setBrands(b)
        const rows = await fetchLagScans()
        if (cancelled) return
        setScans(rows)

        // Leading-indicator / CCF rows for Sections "Leading Indicator Board" + "Action Translation".
        try {
          const { data: leadData } = await supabase
            .from('analysis_results')
            .select('kind,driver,target,best_lag,best_score,best_pvalue')
            .in('kind', ['lag_scan', 'ccf'])
            .order('best_score', { ascending: false, nullsFirst: false })
            .limit(20)
          if (!cancelled && Array.isArray(leadData)) {
            setLeadingRows(
              (leadData as Array<Record<string, unknown>>).map((r) => ({
                kind: String(r.kind ?? ''),
                driver: String(r.driver ?? ''),
                target: String(r.target ?? ''),
                bestLag: r.best_lag != null ? Number(r.best_lag) : null,
                bestScore: r.best_score != null ? Number(r.best_score) : null,
                bestPvalue: r.best_pvalue != null ? Number(r.best_pvalue) : null,
              })),
            )
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[correlations] leading indicators fetch failed', e)
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[correlations] failed to load', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    document.title = 'JOOLA INTEL — Lead/Lag Correlations'
  }, [])

  const availableTargets = useMemo(
    () => Array.from(new Set(scans.map((s) => s.target))).sort(),
    [scans],
  )
  const availableBrandSlugs = useMemo(
    () => Array.from(new Set(scans.map((s) => s.brand_slug))).sort(),
    [scans],
  )

  // If the default target ('estimated_units_sold') isn't in the available
  // targets (currently true — sales_estimates is empty so units_sold is
  // never produced), auto-pick the first available so the page isn't
  // permanently empty just because we don't have units-sold data yet.
  useEffect(() => {
    if (availableTargets.length === 0) return
    if (!availableTargets.includes(target)) {
      setTarget(availableTargets[0])
    }
  }, [availableTargets, target])

  // Filter scans by brand + target
  const filteredScans = useMemo(() => {
    return scans.filter((s) => {
      if (s.target !== target) return false
      if (brandSlug && s.brand_slug !== brandSlug) return false
      return true
    })
  }, [scans, brandSlug, target])

  const availableDrivers = useMemo(
    () => Array.from(new Set(filteredScans.map((s) => s.driver))).sort(),
    [filteredScans],
  )

  // If selectedDrivers is empty, show all available drivers (default state)
  const activeDrivers = selectedDrivers.length > 0
    ? selectedDrivers.filter((d) => availableDrivers.includes(d))
    : availableDrivers

  // Flatten payload points into heatmap cells (driver × lag)
  // When multiple brands/products share a driver, average correlation per (driver, lag).
  const heatmapCells: CorrelationCell[] = useMemo(() => {
    const acc = new Map<string, { rSum: number; pMin: number; n: number; count: number }>()
    filteredScans.forEach((s) => {
      if (!activeDrivers.includes(s.driver)) return
      const pts: LagScanPayloadPoint[] = s.payload?.points || []
      pts.forEach((pt) => {
        const key = `${s.driver}::${pt.lag}`
        const prev = acc.get(key)
        if (!prev) {
          acc.set(key, {
            rSum: pt.pearson_r,
            pMin: pt.pearson_p,
            n: pt.n ?? s.payload?.n_samples ?? 0,
            count: 1,
          })
        } else {
          prev.rSum += pt.pearson_r
          prev.pMin = Math.min(prev.pMin, pt.pearson_p)
          prev.n = Math.max(prev.n, pt.n ?? 0)
          prev.count += 1
        }
      })
    })
    return Array.from(acc.entries()).map(([key, v]) => {
      const [driver, lagStr] = key.split('::')
      return {
        driver,
        lag: Number(lagStr),
        correlation: v.rSum / Math.max(1, v.count),
        pValue: v.pMin,
        n: v.n,
      }
    })
  }, [filteredScans, activeDrivers])

  const drilldownScan = useMemo(() => {
    if (!drill) return null
    return filteredScans.find((s) => s.driver === drill.driver && s.target === drill.target) || null
  }, [drill, filteredScans])

  // Table rows for the "Drivers vs. {target}" detail table.
  const tableRowsRaw = useMemo(() => {
    return filteredScans
      .filter((s) => activeDrivers.includes(s.driver))
      .map((s) => ({
        brandSlug: s.brand_slug,
        brand: pgName(s.brand_slug, brands),
        product: s.product_name || '—',
        driver: s.driver,
        bestLag: s.best_lag,
        bestScore: s.best_score,
        absScore: s.best_score != null ? Math.abs(s.best_score) : 0,
        bestPvalue: s.best_pvalue,
        nSamples: s.payload?.n_samples ?? 0,
        sig: s.best_pvalue != null && s.best_pvalue < 0.05,
      }))
  }, [filteredScans, activeDrivers, brands])

  const tableRowsDisplay = useMemo(() => {
    const filtered = tableRowsRaw.filter((r) =>
      Object.entries(tblColFilter).every(([k, q]) => {
        if (!q) return true
        const cell = String((r as unknown as Record<string, unknown>)[k] ?? '')
        return cell.toLowerCase().includes(q.toLowerCase())
      })
    )
    if (!tblSortKey) return filtered.slice(0, 200)
    const sorted = [...filtered].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[tblSortKey]
      const bv = (b as unknown as Record<string, unknown>)[tblSortKey]
      if (typeof av === 'number' && typeof bv === 'number')
        return tblSortDir === 'asc' ? av - bv : bv - av
      const as = String(av ?? ''), bs = String(bv ?? '')
      return tblSortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
    })
    return sorted.slice(0, 200)
  }, [tableRowsRaw, tblColFilter, tblSortKey, tblSortDir])

  if (loading) return <LoadingPage />

  const hasData = scans.length > 0
  const sub = hasData
    ? `Found ${scans.length} lag scans across ${availableBrandSlugs.length} brands. Cells highlighted in yellow are statistically significant (p < 0.05).`
    : 'Predictive-causal screen ready. Awaiting analytics_backend pipeline output.'

  return (
    <>
      <PageHead
        eyebrow={`LEAD/LAG · ${scans.length} SCANS · ${availableTargets.length} TARGETS`}
        title="Correlation"
        accent="explorer"
        sub={sub}
        actions={
          hasData ? (
            <>
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
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="page-select"
                aria-label="Target metric"
              >
                {availableTargets.length === 0 && <option value={DEFAULT_TARGET}>{DEFAULT_TARGET}</option>}
                {availableTargets.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </>
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
              title="Predictive-causal screen"
              description="This is a SCREEN, not a proof. A strong correlation at lag L only tells you the two series moved together with L days of offset over the observed window. It does NOT prove the driver caused the target — confounders, seasonality, or shared upstream causes can produce the same pattern. Cells outlined in yellow are statistically significant (p < 0.05); investigate them, don't trust them blindly."
              source="lib/v2/analytics.ts · scripts/analytics_backend (lag_scan, granger)"
            />
          </div>
          <div className="legend-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, fontSize: 12 }}>
            <div>
              <div style={{ color: '#22c55e', fontWeight: 800, marginBottom: 4 }}>
                Correlated with
              </div>
              <div style={{ color: '#8a93a4', lineHeight: 1.4 }}>
                Two series moved up and down together. Lag = 0 means same-day; the correlation is contemporaneous.
              </div>
            </div>
            <div>
              <div style={{ color: '#F5E625', fontWeight: 800, marginBottom: 4 }}>
                Tended to lead by N days
              </div>
              <div style={{ color: '#8a93a4', lineHeight: 1.4 }}>
                Positive lag (+N) means the driver moved N days BEFORE the target. The peak lag is where past driver values best predict future target values.
              </div>
            </div>
            <div>
              <div style={{ color: '#ec4899', fontWeight: 800, marginBottom: 4 }}>
                Predictive-causal screen
              </div>
              <div style={{ color: '#8a93a4', lineHeight: 1.4 }}>
                Always pair correlation with a Granger test (kind=&apos;granger&apos;) and domain context before claiming causation. Spurious leads happen with seasonality and shared shocks.
              </div>
            </div>
          </div>
        </div>
      </section>

      {!hasData && (
        <section>
          <div className="card" style={{ textAlign: 'center', padding: 48 }}>
            <div style={{ fontSize: 14, color: 'var(--fg-2)', marginBottom: 8 }}>
              Lead/lag analysis has not been generated yet.
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>
              This page will populate after the analytics pipeline runs.
            </div>
          </div>
        </section>
      )}

      {hasData && (
        <section>
          <div className="section-head">
            <div>
              <h2>
                Drivers vs. {target}
                <SectionInfo
                  title="Driver multi-select"
                  description="Pick which driver candidates to show. By default we show every driver that had at least one lag scan against the chosen target."
                  source="analysis_results · kind=lag_scan"
                />
              </h2>
              <div className="sub">
                {activeDrivers.length} of {availableDrivers.length} drivers shown · click a cell to drill down.
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 540 }}>
              {availableDrivers.map((d) => {
                const on = activeDrivers.includes(d)
                return (
                  <button
                    key={d}
                    onClick={() => {
                      if (selectedDrivers.length === 0) {
                        // first interaction — initialize with current set minus this one
                        setSelectedDrivers(availableDrivers.filter((x) => x !== d))
                        return
                      }
                      setSelectedDrivers(
                        on
                          ? selectedDrivers.filter((x) => x !== d)
                          : Array.from(new Set([...selectedDrivers, d])),
                      )
                    }}
                    className={'pill ' + (on ? 'pill-yellow' : 'pill-ghost')}
                    style={{ cursor: 'pointer', fontSize: 11 }}
                    title={on ? 'Hide driver' : 'Show driver'}
                  >
                    {d}
                  </button>
                )
              })}
              {selectedDrivers.length > 0 && (
                <button
                  onClick={() => setSelectedDrivers([])}
                  className="pill pill-ghost"
                  style={{ cursor: 'pointer', fontSize: 11 }}
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: drill ? '1fr 420px' : '1fr', gap: 16 }}>
            <div className="card">
              <div className="card-pad">
                <div
                  onClick={(e) => {
                    // Bubble-up: cell hover sets the local state inside heatmap;
                    // we synthesize drill clicks via the rendered svg cell's data attrs.
                    const t = e.target as SVGElement
                    if (!t || t.tagName !== 'rect') return
                    // Walk DOM to find driver+lag via aria-label; not available — use cell title instead.
                  }}
                >
                  <HeatmapClickable
                    cells={heatmapCells}
                    target={target}
                    onCellClick={(driver) => setDrill({ driver, target })}
                  />
                </div>
              </div>
            </div>

            {drill && drilldownScan && (
              <div className="card">
                <div className="card-pad">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#F5E625' }}>
                        Drilldown
                      </div>
                      <div style={{ fontSize: 14, color: '#e2e8f0', fontWeight: 700, marginTop: 4 }}>
                        {drill.driver}
                      </div>
                      <div style={{ fontSize: 11, color: '#8a93a4' }}>
                        vs. {drill.target}
                        {drilldownScan.brand_slug && (
                          <>
                            {' · '}
                            <span style={{ color: pgColor(drilldownScan.brand_slug) }}>
                              {pgName(drilldownScan.brand_slug, brands)}
                            </span>
                          </>
                        )}
                        {drilldownScan.product_name && <> · {drilldownScan.product_name}</>}
                      </div>
                    </div>
                    <button
                      onClick={() => setDrill(null)}
                      className="pill pill-ghost"
                      style={{ cursor: 'pointer', fontSize: 11 }}
                      aria-label="Close drilldown"
                    >
                      × Close
                    </button>
                  </div>
                  <LagScanChart
                    data={drilldownScan.payload?.points || []}
                    driverLabel={drill.driver}
                    targetLabel={drill.target}
                    interpretation="Peak marks the lag with the strongest Pearson correlation. Stars = significance (* p<0.05, ** p<0.01, *** p<0.001)."
                  />
                  {drilldownScan.best_lag !== null && drilldownScan.best_score !== null && (
                    <div style={{ fontSize: 11, color: '#cbd1dc', marginTop: 8, fontFamily: 'monospace' }}>
                      best lag = {drilldownScan.best_lag > 0 ? '+' : ''}{drilldownScan.best_lag}d ·
                      r = {drilldownScan.best_score.toFixed(3)}
                      {drilldownScan.best_pvalue !== null && <> · p = {drilldownScan.best_pvalue.toFixed(3)}</>}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Drivers vs. target — sortable/filterable detail table (200-row standard) */}
          <div className="section-head" style={{ marginTop: 18 }}>
            <div>
              <h2>
                Driver scans · ranked
                <SectionInfo
                  title="Driver scan detail table"
                  description="One row per (brand × product × driver) lag scan for the current target. Sort by best |r| to surface the strongest signals. Significance flag = p < 0.05. This is a screen, not a proof; pair with Granger and domain context."
                  source="analysis_results · kind=lag_scan"
                />
              </h2>
              <div className="sub">
                Showing {tableRowsDisplay.length} of up to 200 · click headers to sort · use column filters to narrow.
              </div>
            </div>
          </div>
          <div className="card">
            <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
              <table className="data" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--sticky-bg)', zIndex: 2 }}>
                  <tr>
                    <SortTh col="brand" label="Brand" sortKey={tblSortKey} sortDir={tblSortDir} toggle={toggleTblSort} />
                    <SortTh col="product" label="Product" sortKey={tblSortKey} sortDir={tblSortDir} toggle={toggleTblSort} />
                    <SortTh col="driver" label="Driver" sortKey={tblSortKey} sortDir={tblSortDir} toggle={toggleTblSort} />
                    <SortTh col="bestLag" label="Best lag" sortKey={tblSortKey} sortDir={tblSortDir} toggle={toggleTblSort} style={{ textAlign: 'right' }} />
                    <SortTh col="absScore" label="|r|" sortKey={tblSortKey} sortDir={tblSortDir} toggle={toggleTblSort} style={{ textAlign: 'right' }} />
                    <SortTh col="bestScore" label="r (signed)" sortKey={tblSortKey} sortDir={tblSortDir} toggle={toggleTblSort} style={{ textAlign: 'right' }} />
                    <SortTh col="bestPvalue" label="p" sortKey={tblSortKey} sortDir={tblSortDir} toggle={toggleTblSort} style={{ textAlign: 'right' }} />
                    <SortTh col="nSamples" label="n" sortKey={tblSortKey} sortDir={tblSortDir} toggle={toggleTblSort} style={{ textAlign: 'right' }} />
                    <th style={{ textAlign: 'center' }}>Sig.</th>
                  </tr>
                  <tr className="col-filter-row">
                    <th><ColumnFilter col="brand" value={tblColFilter.brand} onChange={(v) => setTblColFilter((p) => ({ ...p, brand: v }))} placeholder="brand…" /></th>
                    <th><ColumnFilter col="product" value={tblColFilter.product} onChange={(v) => setTblColFilter((p) => ({ ...p, product: v }))} placeholder="product…" /></th>
                    <th><ColumnFilter col="driver" value={tblColFilter.driver} onChange={(v) => setTblColFilter((p) => ({ ...p, driver: v }))} placeholder="driver…" /></th>
                    <th colSpan={6} />
                  </tr>
                </thead>
                <tbody>
                  {tableRowsDisplay.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>
                        No rows found for the selected filters.
                      </td>
                    </tr>
                  ) : tableRowsDisplay.map((r, i) => (
                    <tr key={`${r.brandSlug}-${r.driver}-${i}`} className={r.brandSlug === 'joola' ? 'joola' : ''}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setDrill({ driver: r.driver, target })}
                      title={`Open drilldown for ${r.driver}`}
                    >
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className="brand-dot" style={{ background: pgColor(r.brandSlug) }} />
                          <span style={{ fontWeight: 700, color: r.brandSlug === 'joola' ? '#22c55e' : 'var(--fg)' }}>{r.brand}</span>
                        </span>
                      </td>
                      <td style={{ color: 'var(--fg-3)' }}>{r.product}</td>
                      <td style={{ color: 'var(--fg)' }}>{r.driver}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                        {r.bestLag !== null ? `${r.bestLag > 0 ? '+' : ''}${r.bestLag}d` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                        {r.bestScore !== null ? r.absScore.toFixed(3) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: r.bestScore !== null && r.bestScore < 0 ? '#ef4444' : '#22c55e' }}>
                        {r.bestScore !== null ? (r.bestScore >= 0 ? '+' : '') + r.bestScore.toFixed(3) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                        {r.bestPvalue !== null ? r.bestPvalue.toFixed(3) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--fg-3)' }}>{r.nSamples || '—'}</td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={'pill ' + (r.sig ? 'pill-green' : 'pill-ghost')} style={{ fontSize: 10 }}>
                          {r.sig ? 'p<0.05' : 'ns'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ── Leading Indicator Board ───────────────────────────── */}
      <section style={{ marginTop: 24 }}>
        <div className="section-head">
          <div>
            <h2>
              Leading Indicator Board
              <SectionInfo
                title="Leading Indicator Board"
                description="Top 20 strongest leading-indicator scans (lag_scan + cross-correlation). Read each row as: when DRIVER moves, OUTCOME follows N days later with the given confidence score."
                source="analysis_results · kind in (lag_scan, ccf)"
              />
            </h2>
            <div className="sub">
              Top {leadingRows.length} signals ranked by |r|. Use this to spot which competitor levers your KPIs respond to and on what time horizon.
            </div>
          </div>
        </div>
        <div className="card">
          {leadingRows.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>
              Run <code style={{ background: 'var(--wb-5)', padding: '2px 6px', borderRadius: 3 }}>python -m analytics_backend.run --module all</code> to populate analysis results.
            </div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 480, overflowY: 'auto' }}>
              <table className="data" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--sticky-bg)', zIndex: 2 }}>
                  <tr>
                    <th>Outcome</th>
                    <th>Leading signal</th>
                    <th style={{ textAlign: 'right' }}>Lag (days)</th>
                    <th style={{ textAlign: 'right' }}>Confidence</th>
                    <th>What it means</th>
                  </tr>
                </thead>
                <tbody>
                  {leadingRows.map((r, i) => (
                    <tr key={`${r.driver}-${r.target}-${i}`}>
                      <td style={{ color: 'var(--fg)', fontWeight: 700 }}>{formatMetricName(r.target)}</td>
                      <td style={{ color: 'var(--fg-2)' }}>{formatMetricName(r.driver)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                        {r.bestLag != null ? `${r.bestLag > 0 ? '+' : ''}${r.bestLag}d` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                        <span
                          className={
                            'pill ' +
                            (r.bestPvalue != null && r.bestPvalue < 0.05 ? 'pill-green' : 'pill-ghost')
                          }
                          style={{ fontSize: 10 }}
                        >
                          {r.bestScore != null ? r.bestScore.toFixed(3) : '—'}
                          {r.bestPvalue != null && r.bestPvalue < 0.05 ? ' · sig' : ''}
                        </span>
                      </td>
                      <td style={{ color: 'var(--fg-2)', fontSize: 12 }}>
                        {whatItMeans(r.driver, r.target, r.bestLag)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ── Action Translation ───────────────────────────── */}
      <section style={{ marginTop: 24 }}>
        <div className="section-head">
          <div>
            <h2>
              Action Translation
              <SectionInfo
                title="Action Translation"
                description="Statistically significant (p < 0.05) findings translated into plain-English business meaning + a recommended next step the team can actually run with."
                source="analysis_results · kind in (lag_scan, ccf) · p_value < 0.05"
              />
            </h2>
            <div className="sub">
              Significant findings only. Every row is a finding the analytics pipeline thinks is worth acting on.
            </div>
          </div>
        </div>
        <div className="card">
          {leadingRows.filter((r) => r.bestPvalue != null && r.bestPvalue < 0.05).length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>
              No statistically significant findings yet. Run <code style={{ background: 'var(--wb-5)', padding: '2px 6px', borderRadius: 3 }}>python -m analytics_backend.run --module all</code> to populate analysis results.
            </div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 480, overflowY: 'auto' }}>
              <table className="data" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--sticky-bg)', zIndex: 2 }}>
                  <tr>
                    <th>Finding</th>
                    <th>Business meaning</th>
                    <th>Recommended action</th>
                  </tr>
                </thead>
                <tbody>
                  {leadingRows
                    .filter((r) => r.bestPvalue != null && r.bestPvalue < 0.05)
                    .map((r, i) => {
                      const tr = businessMeaning(r.driver, r.target)
                      return (
                        <tr key={`act-${r.driver}-${r.target}-${i}`}>
                          <td style={{ color: 'var(--fg)', fontWeight: 600, fontSize: 12 }}>
                            {formatMetricName(r.driver)} → {formatMetricName(r.target)}
                            <div style={{ fontSize: 10, color: 'var(--fg-4)', fontFamily: 'monospace', marginTop: 2 }}>
                              r = {r.bestScore != null ? r.bestScore.toFixed(3) : '—'} · p = {r.bestPvalue != null ? r.bestPvalue.toFixed(3) : '—'} · lag = {r.bestLag != null ? `${r.bestLag > 0 ? '+' : ''}${r.bestLag}d` : '—'}
                            </div>
                          </td>
                          <td style={{ color: 'var(--fg-2)', fontSize: 12 }}>{tr.meaning}</td>
                          <td style={{ color: '#22c55e', fontSize: 12, fontWeight: 600 }}>{tr.action}</td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  )
}

// Wraps CorrelationHeatmap to make cells clickable (the chart already
// handles hover; we add a delegated click on the SVG to capture the
// driver row under the pointer).
function HeatmapClickable({
  cells,
  target,
  onCellClick,
}: {
  cells: CorrelationCell[]
  target: string
  onCellClick: (driver: string) => void
}) {
  const drivers = Array.from(new Set(cells.map((c) => c.driver)))
  return (
    <div
      onClick={(e) => {
        const target = e.target as Element
        const rectEl = target.closest('rect.heatmap-cell') as SVGRectElement | null
        if (!rectEl) return
        const svg = rectEl.ownerSVGElement
        if (!svg) return
        const allCells = Array.from(svg.querySelectorAll('rect.heatmap-cell'))
        const idx = allCells.indexOf(rectEl)
        if (idx < 0) return
        const lags = Array.from(new Set(cells.map((c) => c.lag))).sort((a, b) => a - b)
        const driverIdx = Math.floor(idx / lags.length)
        const driver = drivers[driverIdx]
        if (driver) onCellClick(driver)
      }}
      style={{ cursor: 'pointer' }}
    >
      <CorrelationHeatmap
        data={cells}
        targetLabel={target}
        interpretation="Rows = driver candidates · Columns = lag in days · Color = Pearson r (red negative → green positive) · Yellow outline = p < 0.05."
      />
    </div>
  )
}
