'use client'

import { useEffect, useMemo, useState } from 'react'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import {
  fetchCrisisIncidents,
  aggregateByBrand,
  aggregateByChannel,
  aggregateByBrandChannel,
  aggregateDaily,
  channelLabel,
  channelColor,
  type CrisisIncident,
} from '@/lib/v2/crisis'
import {
  PageHead,
  LoadingPage,
  MiniKpi,
  SectionInfo,
  pgName,
  pgColor,
} from '@/components/v2/PageShell'

const WINDOW_DAYS = 30

export default function CrisisCenterPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [incidents, setIncidents] = useState<CrisisIncident[]>([])
  const [loading, setLoading] = useState(true)
  const [brandFilter, setBrandFilter] = useState<string>('')
  const [channelFilter, setChannelFilter] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const b = await fetchBrands()
        if (cancelled) return
        setBrands(b)
        const inc = await fetchCrisisIncidents({ days: 90, limit: 1000 })
        if (cancelled) return
        setIncidents(inc)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[crisis] failed to load', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    document.title = 'JOOLA INTEL — Crisis Center'
  }, [])

  // Filter applied across all derived data
  const filtered = useMemo(() => {
    return incidents.filter((i) => {
      if (brandFilter && i.brand_slug !== brandFilter) return false
      if (channelFilter && i.channel !== channelFilter) return false
      return true
    })
  }, [incidents, brandFilter, channelFilter])

  const last30 = useMemo(
    () => filtered.filter((i) => Date.now() - new Date(i.posted_at).getTime() < WINDOW_DAYS * 86400000),
    [filtered],
  )
  const prev30 = useMemo(
    () => filtered.filter((i) => {
      const age = Date.now() - new Date(i.posted_at).getTime()
      return age >= WINDOW_DAYS * 86400000 && age < 2 * WINDOW_DAYS * 86400000
    }),
    [filtered],
  )

  const byBrand = useMemo(() => aggregateByBrand(filtered), [filtered])
  const byChannel = useMemo(() => aggregateByChannel(last30), [last30])
  const byBrandChannel = useMemo(() => aggregateByBrandChannel(last30), [last30])
  const dailyTrend = useMemo(() => aggregateDaily(filtered, WINDOW_DAYS), [filtered])

  const availableBrandSlugs = useMemo(
    () => Array.from(new Set(incidents.map((i) => i.brand_slug))).filter(Boolean).sort(),
    [incidents],
  )
  const availableChannels = useMemo(
    () => Array.from(new Set(incidents.map((i) => i.channel))).sort(),
    [incidents],
  )

  if (loading) return <LoadingPage />

  const total = filtered.length
  const open30 = last30.length
  const prev30count = prev30.length
  const delta = open30 - prev30count
  const topBrand = byBrand[0]
  const topChannel = byChannel[0]

  const hasData = total > 0
  const sub = hasData
    ? `${open30} crisis signal${open30 === 1 ? '' : 's'} in the last ${WINDOW_DAYS} days across ${availableBrandSlugs.length} brand${availableBrandSlugs.length === 1 ? '' : 's'} and ${availableChannels.length} channel${availableChannels.length === 1 ? '' : 's'}.`
    : 'No crisis signals detected yet. Run the enrichment pipeline to populate `mention_facts.is_crisis`.'

  return (
    <>
      <PageHead
        eyebrow={`CRISIS · ${open30} OPEN · ${WINDOW_DAYS}D WINDOW`}
        title="Crisis"
        accent="center"
        sub={sub}
        actions={
          hasData ? (
            <>
              <select
                value={brandFilter}
                onChange={(e) => setBrandFilter(e.target.value)}
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
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                className="page-select"
                aria-label="Filter by channel"
              >
                <option value="">All channels</option>
                {availableChannels.map((c) => (
                  <option key={c} value={c}>
                    {channelLabel(c)}
                  </option>
                ))}
              </select>
            </>
          ) : undefined
        }
      />

      {/* Legend / how-to-read */}
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
              title="Crisis signal"
              description="A row in `mention_facts` flagged is_crisis=true by GPT-4o-mini at enrichment time. The model marks defect reports, recalls, warranty failures, fraud claims, delamination, breakage, and similar reputation-risk content. It does NOT assess severity — investigate each signal before treating it as an incident."
              source="mention_facts table · scripts/scraping/enrichment/ai_enricher.py"
            />
          </div>
          <div style={{ color: '#8a93a4', lineHeight: 1.5, fontSize: 12 }}>
            Signals roll up from <strong>reddit, ig_comments, yt_comments, x_posts, tiktok_videos, influencer_x_posts</strong> through <code style={{ background: 'rgba(255,255,255,0.04)', padding: '1px 4px', borderRadius: 3 }}>scripts/scraping/facts/mention_facts.py</code>. Window: last 30 days vs prior 30. A spike in any single brand × channel cell deserves drill-through to the source thread.
          </div>
        </div>
      </section>

      {/* KPI strip */}
      <section className="kpi-grid">
        <MiniKpi
          label="Open signals (30d)"
          value={open30}
          delta={delta}
          deltaPct={prev30count > 0 ? Math.round((delta / prev30count) * 100) : null}
          color={open30 > 0 ? '#ef4444' : '#22c55e'}
          src="mention_facts.is_crisis"
        />
        <MiniKpi
          label="Top brand at risk"
          value={topBrand ? pgName(topBrand.brand_slug, brands) : '—'}
          customVs={topBrand ? `${topBrand.last_30d} signals in 30d` : 'no data'}
          color={topBrand ? pgColor(topBrand.brand_slug) : undefined}
          src="aggregateByBrand"
        />
        <MiniKpi
          label="Top channel"
          value={topChannel ? channelLabel(topChannel.channel) : '—'}
          customVs={topChannel ? `${topChannel.total} signals` : 'no data'}
          color={topChannel ? channelColor(topChannel.channel) : undefined}
          src="aggregateByChannel"
        />
        <MiniKpi
          label="Total (90d)"
          value={total}
          src="mention_facts (90-day window)"
        />
      </section>

      {/* Two-up: daily trend + channel mix */}
      <section style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginTop: 18 }}>
        <div className="card" style={{ padding: 16 }}>
          <h6 style={{ marginTop: 0 }}>Daily crisis signal volume · last {WINDOW_DAYS} days</h6>
          <CrisisTrend points={dailyTrend} />
        </div>
        <div className="card" style={{ padding: 16 }}>
          <h6 style={{ marginTop: 0 }}>Channel mix · last {WINDOW_DAYS} days</h6>
          <ChannelMix rows={byChannel} />
        </div>
      </section>

      {/* Brand × channel heatmap */}
      <section style={{ marginTop: 18 }}>
        <div className="card" style={{ padding: 16 }}>
          <h6 style={{ marginTop: 0 }}>Brand × channel heatmap · last {WINDOW_DAYS} days</h6>
          <BrandChannelHeatmap
            rows={byBrandChannel}
            brandSlugs={availableBrandSlugs}
            channels={availableChannels}
            brands={brands}
          />
        </div>
      </section>

      {/* Incident feed */}
      <section style={{ marginTop: 18 }}>
        <div className="card" style={{ padding: 16 }}>
          <h6 style={{ marginTop: 0 }}>Recent incidents</h6>
          <IncidentFeed incidents={filtered.slice(0, 25)} brands={brands} />
        </div>
      </section>
    </>
  )
}

// ─── Daily trend (lightweight inline SVG sparkline+axis) ──────────────

function CrisisTrend({ points }: { points: { date: string; count: number }[] }) {
  const w = 560
  const h = 180
  const padL = 28
  const padR = 12
  const padT = 12
  const padB = 28

  const max = Math.max(1, ...points.map((p) => p.count))
  const xStep = (w - padL - padR) / Math.max(1, points.length - 1)
  const y = (v: number) => padT + (h - padT - padB) * (1 - v / max)

  if (points.every((p) => p.count === 0)) {
    return (
      <div style={{ color: '#6b7280', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
        No crisis signals in the window.
      </div>
    )
  }

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${padL + i * xStep} ${y(p.count)}`)
    .join(' ')

  const areaPath = `${linePath} L ${padL + (points.length - 1) * xStep} ${h - padB} L ${padL} ${h - padB} Z`

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      {/* y-axis ticks */}
      {[0, Math.ceil(max / 2), max].map((tick) => (
        <g key={tick}>
          <line
            x1={padL}
            x2={w - padR}
            y1={y(tick)}
            y2={y(tick)}
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="2 4"
          />
          <text x={padL - 6} y={y(tick) + 3} textAnchor="end" fontSize={10} fill="#6b7280">
            {tick}
          </text>
        </g>
      ))}
      {/* area + line */}
      <path d={areaPath} fill="rgba(239,68,68,0.12)" />
      <path d={linePath} fill="none" stroke="#ef4444" strokeWidth={2} />
      {/* dots — only mark non-zero days */}
      {points.map((p, i) =>
        p.count > 0 ? (
          <circle key={p.date} cx={padL + i * xStep} cy={y(p.count)} r={3} fill="#ef4444">
            <title>{`${p.date}: ${p.count} signal${p.count === 1 ? '' : 's'}`}</title>
          </circle>
        ) : null,
      )}
      {/* x-axis labels — first, middle, last */}
      {[0, Math.floor(points.length / 2), points.length - 1].map((i) =>
        points[i] ? (
          <text key={i} x={padL + i * xStep} y={h - padB + 16} textAnchor="middle" fontSize={10} fill="#6b7280">
            {points[i].date.slice(5)}
          </text>
        ) : null,
      )}
    </svg>
  )
}

// ─── Channel mix donut + legend ───────────────────────────────────────

function ChannelMix({ rows }: { rows: { channel: string; total: number }[] }) {
  const total = rows.reduce((s, r) => s + r.total, 0)
  if (total === 0) {
    return (
      <div style={{ color: '#6b7280', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
        No data
      </div>
    )
  }

  const size = 140
  const r = 54
  const inner = 32
  const cx = size / 2
  const cy = size / 2

  // Build arcs
  let acc = 0
  const arcs = rows.map((row) => {
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2
    acc += row.total
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2
    const large = row.total / total > 0.5 ? 1 : 0
    const x0 = cx + r * Math.cos(start)
    const y0 = cy + r * Math.sin(start)
    const x1 = cx + r * Math.cos(end)
    const y1 = cy + r * Math.sin(end)
    const x2 = cx + inner * Math.cos(end)
    const y2 = cy + inner * Math.sin(end)
    const x3 = cx + inner * Math.cos(start)
    const y3 = cy + inner * Math.sin(start)
    const d = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${inner} ${inner} 0 ${large} 0 ${x3} ${y3} Z`
    return { ...row, d, color: channelColor(row.channel) }
  })

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {arcs.map((a) => (
          <path key={a.channel} d={a.d} fill={a.color}>
            <title>{`${channelLabel(a.channel)}: ${a.total} (${Math.round((a.total / total) * 100)}%)`}</title>
          </path>
        ))}
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize={16} fontWeight={800} fill="#fff">
          {total}
        </text>
      </svg>
      <div style={{ display: 'grid', gap: 6, fontSize: 12, flex: 1, minWidth: 0 }}>
        {arcs.map((a) => (
          <div key={a.channel} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span
              style={{
                width: 10,
                height: 10,
                background: a.color,
                borderRadius: 2,
                flexShrink: 0,
              }}
            />
            <span style={{ color: '#cbd1dc', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {channelLabel(a.channel)}
            </span>
            <span style={{ color: '#fff', fontWeight: 700 }}>{a.total}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Brand × channel heatmap ──────────────────────────────────────────

function BrandChannelHeatmap({
  rows,
  brandSlugs,
  channels,
  brands,
}: {
  rows: { brand_slug: string; channel: string; count: number }[]
  brandSlugs: string[]
  channels: string[]
  brands: V2Brand[]
}) {
  if (rows.length === 0 || brandSlugs.length === 0 || channels.length === 0) {
    return (
      <div style={{ color: '#6b7280', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
        No data in the window.
      </div>
    )
  }

  const lookup = new Map<string, number>()
  for (const r of rows) lookup.set(`${r.brand_slug}::${r.channel}`, r.count)
  const max = Math.max(1, ...rows.map((r) => r.count))

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 12, minWidth: '100%' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#8a93a4', fontWeight: 600 }}>Brand</th>
            {channels.map((c) => (
              <th key={c} style={{ padding: '6px 8px', color: '#8a93a4', fontWeight: 600, textAlign: 'center' }}>
                {channelLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {brandSlugs.map((slug) => (
            <tr key={slug}>
              <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 99,
                      background: pgColor(slug),
                      display: 'inline-block',
                    }}
                  />
                  <span style={{ color: '#fff', fontWeight: 600 }}>{pgName(slug, brands)}</span>
                </span>
              </td>
              {channels.map((c) => {
                const v = lookup.get(`${slug}::${c}`) || 0
                const intensity = v / max
                const bg = v === 0 ? 'transparent' : `rgba(239,68,68,${0.15 + intensity * 0.65})`
                return (
                  <td
                    key={c}
                    style={{
                      padding: '4px 6px',
                      textAlign: 'center',
                      background: bg,
                      color: v > 0 ? '#fff' : '#3a4150',
                      fontWeight: v > 0 ? 700 : 400,
                      borderRadius: 4,
                      cursor: v > 0 ? 'pointer' : 'default',
                    }}
                    title={v > 0 ? `${pgName(slug, brands)} on ${channelLabel(c)}: ${v} signal${v === 1 ? '' : 's'}` : ''}
                  >
                    {v > 0 ? v : '·'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Incident feed ────────────────────────────────────────────────────

function IncidentFeed({ incidents, brands }: { incidents: CrisisIncident[]; brands: V2Brand[] }) {
  if (incidents.length === 0) {
    return (
      <div style={{ color: '#6b7280', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
        No incidents in the current filter.
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {incidents.map((inc) => (
        <div
          key={inc.id}
          className="signal"
          style={{
            padding: '10px 12px',
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto',
            gap: 12,
            alignItems: 'start',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              minWidth: 50,
              paddingTop: 2,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 99,
                background: pgColor(inc.brand_slug || ''),
                display: 'inline-block',
              }}
            />
            <span style={{ fontSize: 10, color: '#8a93a4', fontWeight: 700, textTransform: 'uppercase' }}>
              {channelLabel(inc.channel).split(' ')[0]}
            </span>
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: '#8a93a4', marginBottom: 3 }}>
              <span style={{ color: pgColor(inc.brand_slug || ''), fontWeight: 700 }}>
                {pgName(inc.brand_slug || '', brands)}
              </span>{' '}
              ·{' '}
              <span>{channelLabel(inc.channel)}</span>
              {inc.sentiment_label && (
                <>
                  {' '}·{' '}
                  <span style={{ color: inc.sentiment_label === 'negative' ? '#ef4444' : '#8a93a4' }}>
                    {inc.sentiment_label}
                  </span>
                </>
              )}
            </div>
            <div style={{ color: '#cbd1dc', fontSize: 13, lineHeight: 1.45 }}>
              {inc.text_snippet || <em style={{ color: '#6b7280' }}>(no text snippet)</em>}
            </div>
          </div>
          <span style={{ color: '#6b7280', fontSize: 11, whiteSpace: 'nowrap', paddingTop: 2 }}>
            {formatRelative(inc.posted_at)}
          </span>
        </div>
      ))}
    </div>
  )
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime()
  const ms = Date.now() - t
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.floor(hr / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toISOString().slice(0, 10)
}
