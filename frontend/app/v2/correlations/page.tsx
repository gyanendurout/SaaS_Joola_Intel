'use client'

import { useEffect, useMemo, useState } from 'react'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import {
  fetchLagScans,
  type LagScanRow,
  type LagScanPayloadPoint,
} from '@/lib/v2/analytics'
import { PageHead, LoadingPage, SectionInfo, pgName, pgColor } from '@/components/v2/PageShell'
import { CorrelationHeatmap, type CorrelationCell } from '@/components/v2/charts/CorrelationHeatmap'
import { LagScanChart } from '@/components/v2/charts/LagScanChart'

const DEFAULT_TARGET = 'estimated_units_sold'

export default function CorrelationsPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [scans, setScans] = useState<LagScanRow[]>([])
  const [loading, setLoading] = useState(true)
  const [brandSlug, setBrandSlug] = useState<string>('')
  const [target, setTarget] = useState<string>(DEFAULT_TARGET)
  const [selectedDrivers, setSelectedDrivers] = useState<string[]>([])
  const [drill, setDrill] = useState<{ driver: string; target: string } | null>(null)

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
          <div className="card" style={{ padding: 36, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: '#cbd1dc', marginBottom: 8 }}>
              No lag scans yet.
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', fontFamily: 'monospace' }}>
              Run <span style={{ color: '#F5E625' }}>python -m scripts.analytics_backend.run --module statistics</span> after applying migration 013.
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
        </section>
      )}
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
