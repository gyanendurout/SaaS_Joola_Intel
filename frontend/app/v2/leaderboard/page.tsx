'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import { supabase } from '@/lib/shared/supabase'
import { fetchLagScans, type LagScanRow } from '@/lib/v2/analytics'
import { PageHead, LoadingPage, SectionInfo, pgName } from '@/components/v2/PageShell'
import { LeaderboardTable, type LeaderboardRow } from '@/components/v2/charts/LeaderboardTable'

type TimeseriesRaw = {
  brand_id: string
  product_id: string | null
  date: string
  attention_score: number | null
  mentions: number | null
  estimated_units_sold: number | null
}

const MV_MISSING_RE = /(does not exist|42P01|relation .* does not exist|Could not find the table)/i

async function fetchRecentTimeseries(days: number): Promise<TimeseriesRaw[]> {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('joola_timeseries_daily')
    .select('brand_id,product_id,date,attention_score,mentions,estimated_units_sold')
    .gte('date', cutoff)
    .order('date', { ascending: true })
    .limit(20000)

  if (error) {
    const msg = String((error as { message?: string }).message || error)
    if (MV_MISSING_RE.test(msg)) {
      // eslint-disable-next-line no-console
      console.warn('[leaderboard] joola_timeseries_daily missing — apply migration 013.')
    } else {
      // eslint-disable-next-line no-console
      console.warn('[leaderboard] failed to load joola_timeseries_daily:', error)
    }
    return []
  }
  return (data as TimeseriesRaw[]) || []
}

export default function LeaderboardPage() {
  const router = useRouter()
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [ts, setTs] = useState<TimeseriesRaw[]>([])
  const [scans, setScans] = useState<LagScanRow[]>([])
  const [productNames, setProductNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const b = await fetchBrands()
        if (cancelled) return
        setBrands(b)

        // Pull last 28 days of timeseries + all lag scans + product names in parallel
        const [tsRows, scanRows, { data: prodRows }] = await Promise.all([
          fetchRecentTimeseries(28),
          fetchLagScans(),
          supabase.from('products').select('id,name').limit(5000),
        ])
        if (cancelled) return
        setTs(tsRows)
        setScans(scanRows)
        const pMap: Record<string, string> = {}
        ;(prodRows || []).forEach((p: { id: string; name: string | null }) => {
          pMap[p.id] = p.name || ''
        })
        setProductNames(pMap)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[leaderboard] failed to load', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    document.title = 'JOOLA INTEL — Product Leaderboard'
  }, [])

  const brandSlugById = useMemo(() => {
    const m: Record<string, string> = {}
    brands.forEach((b) => {
      m[b.brand_id] = b.id
    })
    return m
  }, [brands])

  // Build leaderboard rows: aggregate timeseries per (brand, product) and join lag scans.
  const rows = useMemo<LeaderboardRow[]>(() => {
    if (!ts.length) return []

    // Group timeseries by brand+product → ordered series
    type Bucket = {
      brandSlug: string
      productId: string | null
      attentionPoints: { date: string; v: number }[]
      mentionsTotal: number
      unitsSoldTotal: number
    }
    const buckets = new Map<string, Bucket>()

    ts.forEach((r) => {
      const slug = brandSlugById[r.brand_id]
      if (!slug) return
      const key = `${slug}::${r.product_id || ''}`
      let b = buckets.get(key)
      if (!b) {
        b = {
          brandSlug: slug,
          productId: r.product_id,
          attentionPoints: [],
          mentionsTotal: 0,
          unitsSoldTotal: 0,
        }
        buckets.set(key, b)
      }
      if (r.attention_score != null && isFinite(Number(r.attention_score))) {
        b.attentionPoints.push({ date: r.date, v: Number(r.attention_score) })
      }
      if (r.mentions != null) b.mentionsTotal += Number(r.mentions)
      if (r.estimated_units_sold != null) b.unitsSoldTotal += Number(r.estimated_units_sold)
    })

    // Build best lag lookup per (brand, product)
    const bestLag = new Map<string, { driver: string; lag: number; score: number }>()
    scans.forEach((s) => {
      if (s.best_lag === null || s.best_score === null) return
      const key = `${s.brand_slug}::${s.product_id || ''}`
      const prev = bestLag.get(key)
      if (!prev || Math.abs(s.best_score) > Math.abs(prev.score)) {
        bestLag.set(key, { driver: s.driver, lag: s.best_lag, score: s.best_score })
      }
    })

    const out: LeaderboardRow[] = []
    buckets.forEach((b, key) => {
      const sorted = b.attentionPoints.slice().sort((a, c) => a.date.localeCompare(c.date))
      const last7 = sorted.slice(-7)
      const attentionMean =
        last7.length > 0 ? last7.reduce((s, p) => s + p.v, 0) / last7.length : 0
      const sparkline = sorted.slice(-28).map((p) => p.v)
      const productName = b.productId ? productNames[b.productId] || 'Unspecified' : 'All products'
      const lag = bestLag.get(key)
      out.push({
        brand: pgName(b.brandSlug, brands),
        product: productName,
        attention: Number(attentionMean.toFixed(2)),
        mentions: b.mentionsTotal,
        estimatedUnitsSold: b.unitsSoldTotal > 0 ? Math.round(b.unitsSoldTotal) : undefined,
        bestLagDays: lag?.lag,
        bestLagDriver: lag?.driver,
        sparkline,
      })
    })

    return out.sort((a, b) => b.attention - a.attention).slice(0, 50)
  }, [ts, scans, brandSlugById, productNames, brands])

  if (loading) return <LoadingPage />

  const hasData = ts.length > 0 || scans.length > 0
  const sub = hasData
    ? `Top ${rows.length} products by 28-day attention. Best lag column shows the driver-target pair with the strongest predictive correlation.`
    : 'Product leaderboard ready. Awaiting analytics_backend pipeline output.'

  return (
    <>
      <PageHead
        eyebrow={`LEADERBOARD · ${rows.length} PRODUCTS`}
        title="Product"
        accent="leaderboard"
        sub={sub}
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
              title="Attention, mentions, lag"
              description="Attention is the 7-day rolling mean of the product's attention_score from joola_timeseries_daily. Mentions is the 28-day total. Best lag is the strongest (driver, lag) pair from the lag scans — it's a screen, not a proof of causality."
              source="joola_timeseries_daily · analysis_results (lag_scan)"
            />
          </div>
          <div className="legend-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, fontSize: 12 }}>
            <div>
              <div style={{ color: '#22c55e', fontWeight: 800, marginBottom: 4 }}>
                Attention (7-day mean)
              </div>
              <div style={{ color: '#8a93a4', lineHeight: 1.4 }}>
                Rolling average of the product&apos;s attention_score across all channels. Smooths spikes and emphasizes sustained interest.
              </div>
            </div>
            <div>
              <div style={{ color: '#F5E625', fontWeight: 800, marginBottom: 4 }}>
                Best lag
              </div>
              <div style={{ color: '#8a93a4', lineHeight: 1.4 }}>
                The driver (Reddit mentions, ad pressure, etc.) whose past values best predict this product&apos;s outcome. Predictive-causal screen only.
              </div>
            </div>
            <div>
              <div style={{ color: '#94a3b8', fontWeight: 800, marginBottom: 4 }}>
                Sparkline
              </div>
              <div style={{ color: '#8a93a4', lineHeight: 1.4 }}>
                28-day attention trend. JOOLA rows are highlighted in green.
              </div>
            </div>
          </div>
        </div>
      </section>

      {!hasData && (
        <section>
          <div className="card" style={{ padding: 36, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: '#cbd1dc', marginBottom: 8 }}>
              No leaderboard data yet.
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', fontFamily: 'monospace' }}>
              Apply migration 013 then run <span style={{ color: '#F5E625' }}>python -m scripts.analytics_backend.run</span>.
            </div>
          </div>
        </section>
      )}

      {hasData && rows.length > 0 && (
        <section>
          <div className="card">
            <div className="card-pad">
              <LeaderboardTable
                rows={rows}
                sortBy="attention"
                onRowClick={(_brand, product) => {
                  // Find the product_id matching the product name
                  const pid = Object.entries(productNames).find(([, name]) => name === product)?.[0]
                  if (pid) router.push(`/v2/products/${pid}`)
                  else router.push('/v2/products')
                }}
                interpretation="Click any row to drill into the product page. Sort by clicking any column header."
              />
            </div>
          </div>
        </section>
      )}

      {hasData && rows.length === 0 && (
        <section>
          <div className="card" style={{ padding: 28, textAlign: 'center', color: '#8a93a4', fontSize: 12 }}>
            Pipeline output present but no per-product timeseries rows matched. Check that joola_timeseries_daily has been refreshed.
          </div>
        </section>
      )}
    </>
  )
}
