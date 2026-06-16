'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/shared/supabase'
import { PageHead, LoadingPage } from '@/components/v2/PageShell'

type HealthStatus = 'green' | 'amber' | 'red' | 'grey'

type HealthRow = {
  area: string
  table: string
  status: HealthStatus
  lastRefresh: string | null
  coverage: string
  issue: string
  action: string
}

type TableSpec = readonly [area: string, table: string, dateCol: string | null]

const TABLES: ReadonlyArray<TableSpec> = [
  ['Cross-channel mentions', 'mention_facts', 'posted_at'],
  ['Product attention rollups', 'product_attention_summary', 'period_end'],
  ['Product attention daily', 'product_attention_daily', 'attention_date'],
  ['Scraped products', 'products', 'last_scraped_at'],
  ['Product reviews', 'product_reviews', 'scraped_at'],
  ['Promotions', 'promotions', 'detected_at'],
  ['Marketing ads', 'marketing_ads', 'captured_at'],
  ['IG weekly profiles', 'ig_profiles_weekly', 'scraped_at'],
  ['YT weekly channels', 'yt_channel_weekly', 'scraped_at'],
  ['TikTok weekly profiles', 'tiktok_profiles_weekly', 'scraped_at'],
  ['X weekly profiles', 'x_profiles_weekly', 'scraped_at'],
  ['TikTok comments', 'tiktok_comments', 'scraped_at'],
  ['Topic lifecycle', 'topic_lifecycle', null],
  ['Brand replies', 'brand_replies', 'replied_at'],
  ['Analysis results', 'analysis_results', 'metric_date'],
  ['Inventory events', 'inventory_events', 'event_time'],
  ['Sales facts daily', 'sales_facts_daily', 'date'],
]

export default function DataHealthPage() {
  const [rows, setRows] = useState<HealthRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = 'JOOLA INTEL — Data Health'
    let cancelled = false

    async function probe() {
      const out: HealthRow[] = []
      for (const [area, table, dateCol] of TABLES) {
        try {
          // Row count
          const { count, error: cErr } = await supabase
            .from(table)
            .select('*', { count: 'exact', head: true })
          if (cErr) throw cErr

          // Most recent date
          let lastRefresh: string | null = null
          if (dateCol && (count ?? 0) > 0) {
            const { data: latest } = await supabase
              .from(table)
              .select(dateCol)
              .order(dateCol, { ascending: false })
              .limit(1)
            const v = (latest?.[0] as Record<string, string> | undefined)?.[dateCol]
            if (v) lastRefresh = String(v).slice(0, 10)
          }
          const ageDays = lastRefresh
            ? Math.floor((Date.now() - new Date(lastRefresh).getTime()) / 86400000)
            : Infinity
          const status: HealthStatus =
            (count ?? 0) === 0
              ? 'red'
              : ageDays > 30
                ? 'amber'
                : ageDays > 7
                  ? 'amber'
                  : 'green'
          const issue =
            (count ?? 0) === 0
              ? 'Empty table — pipeline pending'
              : ageDays > 30
                ? `Stale (${ageDays}d old)`
                : ageDays > 7
                  ? `Refresh due (${ageDays}d)`
                  : ''
          const action =
            (count ?? 0) === 0
              ? 'Activate writer module'
              : ageDays > 7
                ? 'Run next pipeline cycle'
                : 'OK'
          out.push({
            area,
            table,
            status,
            lastRefresh,
            coverage: `${count ?? 0} rows`,
            issue,
            action,
          })
        } catch (e) {
          out.push({
            area,
            table,
            status: 'red',
            lastRefresh: null,
            coverage: '—',
            issue: `Probe failed: ${(e as Error).message.slice(0, 80)}`,
            action: 'Check schema / connection',
          })
        }
      }
      if (!cancelled) {
        setRows(out)
        setLoading(false)
      }
    }

    probe()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) return <LoadingPage />

  return (
    <>
      <PageHead title="DATA HEALTH" />
      <section>
        <div className="section-head">
          <div>
            <h2>Pipeline diagnostic · {rows.length} tables probed</h2>
            <div className="sub">
              Live status of every important table. Green = fresh, amber = stale, red = empty/broken.
            </div>
          </div>
        </div>
        <div className="card">
          <div className="table-wrap" style={{ maxHeight: 720, overflowY: 'auto' }}>
            <table className="data" style={{ width: '100%' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--sticky-bg)' }}>
                <tr>
                  <th>Area</th>
                  <th>Table</th>
                  <th>Status</th>
                  <th>Last refresh</th>
                  <th style={{ textAlign: 'right' }}>Coverage</th>
                  <th>Issue</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.table}>
                    <td style={{ color: 'var(--fg)', fontWeight: 600 }}>{r.area}</td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--fg-3)' }}>
                      {r.table}
                    </td>
                    <td>
                      <span
                        className={
                          r.status === 'green'
                            ? 'pill pill-green'
                            : r.status === 'amber'
                              ? 'pill pill-amber'
                              : r.status === 'red'
                                ? 'pill pill-red'
                                : 'pill pill-ghost'
                        }
                      >
                        {r.status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ color: 'var(--fg-3)', fontSize: 12 }}>{r.lastRefresh || '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{r.coverage}</td>
                    <td style={{ color: r.issue ? 'var(--fg-2)' : 'var(--fg-4)', fontSize: 12 }}>{r.issue || '—'}</td>
                    <td style={{ color: 'var(--fg-2)', fontSize: 12 }}>{r.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  )
}
