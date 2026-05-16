'use client'

import { useEffect, useState, useMemo } from 'react'
import {
  fetchSeoData,
  type V2SeoData,
  type V2KeywordTrend,
  type V2CrawlSummary,
  type V2BriefStats,
  type V2OnPageTrend,
  BRAND_COLORS,
} from '@/lib/v2/data'
import { fmt, Sparkline, LineChart, type LineSeries, Donut } from '@/components/v2/charts'
import { SectionInfo, FilterBanner } from '@/components/v2/PageShell'
import { useBrandFilter } from '@/lib/v2/BrandFilterContext'

// ─── Helpers ──────────────────────────────────────────────────────────
function cap(s: string) { return s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) }

function brandColor(brand: string): string { return BRAND_COLORS[brand] || '#888' }

function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e'
  if (score >= 60) return '#F5E625'
  return '#ef4444'
}

function positionColor(pos: number | null): string {
  if (pos === null) return '#6b7280'
  if (pos <= 3) return '#22c55e'
  if (pos <= 10) return '#F5E625'
  if (pos <= 20) return '#f59e0b'
  return '#ef4444'
}

// ─── KPI strip ────────────────────────────────────────────────────────
function KpiStrip({ d }: { d: V2SeoData }) {
  const totalKeywords = d.keywordTrends.length
  const avgPosition = useMemo(() => {
    const valid = d.keywordTrends.filter((k) => k.latestPosition !== null)
    if (!valid.length) return null
    return Math.round(valid.reduce((s, k) => s + (k.latestPosition || 0), 0) / valid.length)
  }, [d.keywordTrends])

  const totalPages = d.crawlSummary.reduce((s, c) => s + c.total, 0)
  const avgOnPage = useMemo(() => {
    const crawled = d.crawlSummary.filter((c) => c.avgOnPageScore > 0)
    if (!crawled.length) return null
    return Math.round(crawled.reduce((s, c) => s + c.avgOnPageScore, 0) / crawled.length)
  }, [d.crawlSummary])

  const totalBriefs = d.briefStats.reduce((s, b) => s + b.total, 0)
  const publishedBriefs = d.briefStats.reduce((s, b) => s + b.published, 0)
  const completionRate = totalBriefs > 0 ? Math.round((publishedBriefs / totalBriefs) * 100) : null

  const tiles = [
    {
      label: 'Keywords tracked',
      value: totalKeywords > 0 ? fmt(totalKeywords) : '—',
      tooltip: 'Total unique keyword-brand pairs with at least one recorded position.',
      src: 'keyword_rankings',
      cls: '',
    },
    {
      label: 'Avg. rank position',
      value: avgPosition !== null ? `#${avgPosition}` : '—',
      tooltip: 'Average SERP position across all tracked keywords. Lower is better.',
      src: 'keyword_rankings',
      cls: avgPosition !== null && avgPosition <= 10 ? 'joola' : '',
    },
    {
      label: 'Pages crawled',
      value: totalPages > 0 ? fmt(totalPages) : '—',
      tooltip: 'Total pages indexed in the latest crawl runs across all tracked brands.',
      src: 'crawl_pages',
      cls: '',
    },
    {
      label: 'Avg. on-page score',
      value: avgOnPage !== null ? `${avgOnPage}/100` : '—',
      tooltip: 'Average on-page SEO score (0–100) across all crawled pages. 80+ is healthy.',
      src: 'crawl_pages',
      cls: avgOnPage !== null && avgOnPage >= 80 ? 'joola' : avgOnPage !== null && avgOnPage < 60 ? 'danger' : 'warn',
    },
    {
      label: 'Briefs published',
      value: completionRate !== null ? `${completionRate}%` : '—',
      tooltip: `${publishedBriefs} of ${totalBriefs} content briefs published. Completion rate = published ÷ total.`,
      src: 'content_briefs',
      cls: completionRate !== null && completionRate >= 70 ? 'joola' : '',
    },
  ]

  return (
    <div className="kpi-grid">
      {tiles.map((t, i) => (
        <div key={i} className={'kpi ' + t.cls} title={t.tooltip}>
          <div className="label">
            <span>{t.label}</span>
            <span className="src">{t.src}</span>
          </div>
          <div className="row">
            <div className="value">{t.value}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Keyword rankings table ────────────────────────────────────────────
function KeywordRankingsTable({ trends, brands }: { trends: V2KeywordTrend[]; brands: V2SeoData['brands'] }) {
  const joolaKeywords = trends.filter((k) => k.brand === 'joola')
  const topKeywords = trends.slice(0, 25)
  const display = joolaKeywords.length > 0 ? joolaKeywords.slice(0, 25) : topKeywords

  if (display.length === 0) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#6b7280', fontSize: 12 }}>
        No keyword ranking data yet. Run the keyword rank-tracking agent to populate.
      </div>
    )
  }

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Keyword</th>
            <th>Brand</th>
            <th style={{ textAlign: 'right' }}>Position</th>
            <th style={{ textAlign: 'right' }}>Volume</th>
            <th style={{ textAlign: 'right' }}>Difficulty</th>
            <th>Trend</th>
          </tr>
        </thead>
        <tbody>
          {display.map((k, i) => {
            const sparkData = k.history
              .filter((h) => h.position !== null)
              .map((h) => 101 - (h.position || 101))
            const posColor = positionColor(k.latestPosition)
            const diffColor = k.difficulty >= 70 ? '#ef4444' : k.difficulty >= 40 ? '#f59e0b' : '#22c55e'
            return (
              <tr key={i}>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{k.keyword}</td>
                <td>
                  <span className="brand-dot" style={{ background: brandColor(k.brand), display: 'inline-block', marginRight: 6 }} />
                  {cap(k.brand)}
                </td>
                <td style={{ textAlign: 'right', color: posColor, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                  {k.latestPosition !== null ? `#${k.latestPosition}` : '—'}
                </td>
                <td style={{ textAlign: 'right', color: '#9aa2b0' }}>{fmt(k.volume)}</td>
                <td style={{ textAlign: 'right' }}>
                  <span style={{ color: diffColor, fontFamily: 'var(--font-mono)' }}>{k.difficulty || '—'}</span>
                </td>
                <td>
                  {sparkData.length > 1
                    ? <Sparkline data={sparkData} w={64} h={24} color={posColor} fill={false} />
                    : <span style={{ color: '#6b7280', fontSize: 11 }}>1 snapshot</span>
                  }
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Keyword rank chart (top 6 keywords over time, inverted Y) ───────
function KeywordRankChart({ trends, brands }: { trends: V2KeywordTrend[]; brands: V2SeoData['brands'] }) {
  const topSix = useMemo(() => {
    return trends
      .filter((k) => k.history.length >= 2 && k.latestPosition !== null)
      .slice(0, 6)
  }, [trends])

  if (topSix.length === 0) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', color: '#6b7280', fontSize: 12 }}>
        No multi-snapshot data yet. Rankings chart will appear after two or more crawl runs.
      </div>
    )
  }

  // Invert positions so higher chart = better rank (position 1 → value 100)
  const series: LineSeries[] = topSix.map((k, i) => {
    const colors = ['#22c55e', '#F5E625', '#818cf8', '#06b6d4', '#f59e0b', '#ec4899']
    return {
      id: `${k.brand}-${k.keyword}`,
      label: k.keyword,
      color: brandColor(k.brand) || colors[i % colors.length],
      data: k.history.map((h) => h.position !== null ? 101 - h.position : 0),
    }
  })

  return <LineChart series={series} h={220} yLabel="Rank (higher = better)" />
}

// ─── Crawl coverage section ────────────────────────────────────────────
function CrawlCoverage({ crawl }: { crawl: V2CrawlSummary[] }) {
  const totals = useMemo(() => ({
    ok: crawl.reduce((s, c) => s + c.ok, 0),
    redirect: crawl.reduce((s, c) => s + c.redirect, 0),
    clientErr: crawl.reduce((s, c) => s + c.clientErr, 0),
    serverErr: crawl.reduce((s, c) => s + c.serverErr, 0),
    total: crawl.reduce((s, c) => s + c.total, 0),
  }), [crawl])

  const donutData = [
    { name: '2xx OK', value: totals.ok, color: '#22c55e' },
    { name: '3xx Redirect', value: totals.redirect, color: '#F5E625' },
    { name: '4xx Client error', value: totals.clientErr, color: '#ef4444' },
    { name: '5xx Server error', value: totals.serverErr, color: '#818cf8' },
  ].filter((d) => d.value > 0)

  if (totals.total === 0) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#6b7280', fontSize: 12 }}>
        No crawl data yet. Run the site crawler agent to populate coverage.
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
      <div className="card card-pad-lg" style={{ display: 'grid', placeItems: 'center', gap: 14 }}>
        <Donut data={donutData} centerLabel={fmt(totals.total)} centerSub="pages crawled" />
        <div className="legend">
          {donutData.map((s) => (
            <div key={s.name} className="item">
              <span className="swatch" style={{ background: s.color }} />{s.name}
            </div>
          ))}
        </div>
      </div>
      <div className="card card-pad">
        <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em', color: '#cbd1dc', margin: '0 0 16px' }}>
          Coverage by brand
        </h3>
        {crawl.slice(0, 8).map((c) => {
          const healthPct = c.total > 0 ? (c.ok / c.total) * 100 : 0
          const errPct = c.total > 0 ? ((c.clientErr + c.serverErr) / c.total) * 100 : 0
          return (
            <div key={c.brand} className={'bar-row ' + (c.brand === 'joola' ? 'joola' : '')}>
              <div className="lbl">{cap(c.brand)}</div>
              <div className="track">
                <div className="fill" style={{ width: Math.max(4, healthPct) + '%', background: brandColor(c.brand) }}>
                  {c.total}
                </div>
              </div>
              <div className="spark-mini">Score: {c.avgOnPageScore || '—'}</div>
              <div className={'delta-mini ' + (errPct > 10 ? 'down' : 'flat')}>
                {errPct > 0 ? `${errPct.toFixed(0)}% err` : 'clean'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── On-page score trend chart ────────────────────────────────────────
function OnPageScoreTrend({ trend }: { trend: V2OnPageTrend[] }) {
  const hasData = trend.some((t) => t.scores.length > 0)

  if (!hasData) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', color: '#6b7280', fontSize: 12 }}>
        No on-page score history yet. Populate crawl_pages to see trends.
      </div>
    )
  }

  const maxLen = Math.max(...trend.map((t) => t.dates.length))
  const series: LineSeries[] = trend
    .filter((t) => t.scores.length >= 2)
    .slice(0, 6)
    .map((t) => ({
      id: t.brand,
      label: cap(t.brand),
      color: brandColor(t.brand),
      data: t.scores,
    }))

  if (series.length === 0) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#6b7280', fontSize: 12 }}>
        Need two or more crawl dates to render trend. Only one crawl snapshot found.
      </div>
    )
  }

  return <LineChart series={series} h={220} yLabel="On-page score (0–100)" />
}

// ─── Content brief pipeline ───────────────────────────────────────────
function ContentBriefPipeline({ stats }: { stats: V2BriefStats[] }) {
  const totals = useMemo(() => ({
    pending: stats.reduce((s, b) => s + b.pending, 0),
    drafted: stats.reduce((s, b) => s + b.drafted, 0),
    published: stats.reduce((s, b) => s + b.published, 0),
    cancelled: stats.reduce((s, b) => s + b.cancelled, 0),
    total: stats.reduce((s, b) => s + b.total, 0),
  }), [stats])

  if (totals.total === 0) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#6b7280', fontSize: 12 }}>
        No content brief data yet. The content brief agent will populate this table.
      </div>
    )
  }

  const stages = [
    { label: 'Pending', value: totals.pending, color: '#9aa2b0' },
    { label: 'Drafted', value: totals.drafted, color: '#F5E625' },
    { label: 'Published', value: totals.published, color: '#22c55e' },
    { label: 'Cancelled', value: totals.cancelled, color: '#ef444444' },
  ].filter((s) => s.value > 0)

  const completionRate = totals.total > 0 ? Math.round((totals.published / totals.total) * 100) : 0

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
      <div className="card card-pad">
        <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em', color: '#cbd1dc', margin: '0 0 16px' }}>
          Pipeline stages — all brands
        </h3>
        {stages.map((s) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <div style={{ width: 80, color: '#9aa2b0', fontSize: 12 }}>{s.label}</div>
            <div style={{ flex: 1, background: 'rgba(255,255,255,0.04)', borderRadius: 4, height: 24, overflow: 'hidden' }}>
              <div style={{
                width: Math.max(4, (s.value / totals.total) * 100) + '%',
                height: '100%',
                background: s.color,
                display: 'flex',
                alignItems: 'center',
                paddingLeft: 8,
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                color: '#000',
                fontWeight: 700,
                transition: 'width 600ms ease',
              }}>
                {s.value}
              </div>
            </div>
            <div style={{ width: 40, textAlign: 'right', color: '#9aa2b0', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
              {Math.round((s.value / totals.total) * 100)}%
            </div>
          </div>
        ))}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#9aa2b0', fontSize: 12 }}>Completion rate</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: completionRate >= 70 ? '#22c55e' : completionRate >= 40 ? '#F5E625' : '#ef4444' }}>
            {completionRate}%
          </span>
        </div>
      </div>
      <div className="card card-pad">
        <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em', color: '#cbd1dc', margin: '0 0 16px' }}>
          By brand
        </h3>
        {stats.slice(0, 8).map((b) => (
          <div key={b.brand} className={'bar-row ' + (b.brand === 'joola' ? 'joola' : '')}>
            <div className="lbl">{cap(b.brand)}</div>
            <div className="track">
              <div className="fill" style={{ width: Math.max(4, b.completionRate) + '%', background: brandColor(b.brand) }}>
                {b.published}/{b.total}
              </div>
            </div>
            <div className="spark-mini">{b.pending} pending</div>
            <div className={'delta-mini ' + (b.completionRate >= 70 ? 'up' : b.completionRate >= 40 ? 'flat' : 'down')}>
              {b.completionRate}%
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Empty state notice ───────────────────────────────────────────────
function EmptyStateBanner() {
  return (
    <div style={{
      background: 'rgba(245,230,37,0.06)', border: '1px solid rgba(245,230,37,0.2)',
      borderRadius: 10, padding: '20px 24px', marginBottom: 28,
      display: 'flex', alignItems: 'flex-start', gap: 16,
    }}>
      <div style={{ fontSize: 20, flexShrink: 0 }}>ℹ</div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#F5E625', marginBottom: 4 }}>No SEO pipeline data yet</div>
        <div style={{ color: '#9aa2b0', fontSize: 12, lineHeight: 1.6 }}>
          This dashboard reads from three Supabase tables written by SEO agents:{' '}
          <code style={{ fontFamily: 'var(--font-mono)', color: '#cbd1dc' }}>keyword_rankings</code>,{' '}
          <code style={{ fontFamily: 'var(--font-mono)', color: '#cbd1dc' }}>crawl_pages</code>, and{' '}
          <code style={{ fontFamily: 'var(--font-mono)', color: '#cbd1dc' }}>content_briefs</code>.{' '}
          Run the keyword rank-tracker, site crawler, and content brief agent to start seeing data.
          Migration: <code style={{ fontFamily: 'var(--font-mono)', color: '#cbd1dc' }}>migrations/002_seo_reporting.sql</code>.
        </div>
      </div>
    </div>
  )
}

// ─── Root page ────────────────────────────────────────────────────────
export default function SeoPage() {
  const [data, setData] = useState<V2SeoData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { setAllBrands } = useBrandFilter()

  useEffect(() => {
    fetchSeoData()
      .then((d) => {
        setData(d)
        setAllBrands(d.brands)
        setLoading(false)
      })
      .catch((err) => {
        console.error('SEO data fetch failed', err)
        setError('Unable to load SEO data. Check Supabase connection.')
        setLoading(false)
      })
  }, [setAllBrands])

  useEffect(() => { document.title = 'JOOLA INTEL — SEO Reporting' }, [])

  if (loading) {
    return (
      <div style={{ padding: '120px 0', textAlign: 'center', color: '#cbd1dc' }}>
        <div style={{ width: 32, height: 32, borderRadius: 999, border: '2px solid #F5E625', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
        <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase' }}>Loading SEO data…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '80px 32px', textAlign: 'center' }}>
        <div style={{ color: '#ef4444', fontSize: 14, marginBottom: 16 }}>{error}</div>
        <button className="btn btn-yellow" onClick={() => window.location.reload()}>Refresh</button>
      </div>
    )
  }

  const d = data!
  const isEmpty = d.keywordTrends.length === 0 && d.crawlSummary.length === 0 && d.briefStats.length === 0

  return (
    <>
      <header className="page-head">
        <div>
          <div className="eyebrow">
            <span style={{ width: 6, height: 6, borderRadius: 99, background: '#22c55e', boxShadow: '0 0 0 4px rgba(34,197,94,0.18)' }} />
            SEO INTELLIGENCE
          </div>
          <h1>SEO <em>reporting</em></h1>
          <div className="sub">Keyword rankings, crawl coverage, content brief pipeline, and on-page score trends — pulled from agent pipeline outputs.</div>
        </div>
      </header>

      <FilterBanner />

      {isEmpty && <EmptyStateBanner />}

      {/* KPIs */}
      <section id="kpis">
        <div className="section-head">
          <div>
            <h2>
              Overview
              <SectionInfo
                title="SEO KPIs"
                description="Aggregate metrics across keyword tracking, crawl health, and content pipeline. Data written by the SEO agent pipeline and read here in real time."
                source="keyword_rankings, crawl_pages, content_briefs"
              />
            </h2>
            <div className="sub">Key signals from the SEO agent pipeline.</div>
          </div>
        </div>
        <KpiStrip d={d} />
      </section>

      {/* Keyword rankings */}
      <section id="keywords">
        <div className="section-head">
          <div>
            <h2>
              Keyword rankings
              <SectionInfo
                title="SERP position tracking"
                description="SERP positions for tracked keywords over time. Positions 1–3 = top of page (green), 4–10 = first page (yellow), 11–20 = second page (orange), 20+ = further back (red). The trend sparkline shows direction from first to latest snapshot."
                source="keyword_rankings table — written by rank-tracking agent"
              />
            </h2>
            <div className="sub">Position over time. Lower rank number = better. Sparkline shows trajectory.</div>
          </div>
        </div>
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-head"><h3>Top keywords — rank trend (chart)</h3></div>
          <div style={{ padding: '8px 16px 16px' }}>
            <KeywordRankChart trends={d.keywordTrends} brands={d.brands} />
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Rankings table</h3></div>
          <KeywordRankingsTable trends={d.keywordTrends} brands={d.brands} />
        </div>
      </section>

      {/* Crawl coverage */}
      <section id="crawl">
        <div className="section-head">
          <div>
            <h2>
              Crawl coverage
              <SectionInfo
                title="Site crawl health"
                description="HTTP status distribution across crawled pages. 2xx = healthy, 3xx = redirects (expected but should be audited), 4xx = broken pages (need fixing), 5xx = server errors (urgent). On-page score = composite of title, meta, H1, word count, and other on-page signals."
                source="crawl_pages table — written by site crawler agent"
              />
            </h2>
            <div className="sub">Page health by HTTP status and average on-page score.</div>
          </div>
        </div>
        <CrawlCoverage crawl={d.crawlSummary} />
      </section>

      {/* On-page score trend */}
      <section id="onpage">
        <div className="section-head">
          <div>
            <h2>
              On-page score trend
              <SectionInfo
                title="On-page quality over time"
                description="Average on-page SEO score per brand across crawl runs. Score = composite of title tag, meta description, H1 presence, word count, and structured data signals. 80+ is healthy; below 60 needs attention."
                source="crawl_pages table — aggregated by crawl_date"
              />
            </h2>
            <div className="sub">Average on-page score per brand over crawl history. 80+ is target.</div>
          </div>
        </div>
        <div className="card card-pad-lg">
          <OnPageScoreTrend trend={d.onPageTrend} />
        </div>
      </section>

      {/* Content brief pipeline */}
      <section id="briefs">
        <div className="section-head">
          <div>
            <h2>
              Content brief pipeline
              <SectionInfo
                title="Brief completion funnel"
                description="Tracks content briefs from initial keyword assignment through drafting to publication. Completion rate = published ÷ total briefs. Pending briefs are waiting for a writer; drafted are ready for review; published are live and indexed."
                source="content_briefs table — written by content brief agent"
              />
            </h2>
            <div className="sub">Brief completion rate and per-brand pipeline health.</div>
          </div>
        </div>
        <ContentBriefPipeline stats={d.briefStats} />
      </section>
    </>
  )
}
