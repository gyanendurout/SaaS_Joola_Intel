'use client'
import { SectionInfo } from '@/components/v2/PageShell'
import type { AttentionSummaryRow } from '@/lib/v2/productIntel'

interface Props {
  rows: AttentionSummaryRow[]
}

const PERIOD_LABEL: Record<string, string> = {
  last_7d:  'Last 7 days',
  last_30d: 'Last 30 days',
  last_90d: 'Last 90 days',
  all_time: 'All time',
}
const PERIOD_ORDER = ['last_7d', 'last_30d', 'last_90d', 'all_time']

export function ProductPeriodMatrix({ rows }: Props) {
  if (!rows.length) return null

  const byPeriod: Record<string, AttentionSummaryRow> = {}
  rows.forEach(r => { byPeriod[r.period] = r })

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>
            Performance by period
            <SectionInfo
              title="Performance by Period"
              description="How much this product was mentioned across different time windows. Mentions = total community posts, comments, and threads. Gap = this product's mention lead or lag versus the top competitor product in the same category. Positive gap means this product leads; negative means it trails."
              source="product_attention_summary · all periods"
            />
          </h2>
          <div className="sub">Total mentions and competitive gap across 7D · 30D · 90D · All time</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {PERIOD_ORDER.map(period => {
          const r = byPeriod[period]
          if (!r) return (
            <div key={period} className="card card-pad">
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{PERIOD_LABEL[period]}</div>
              <div style={{ color: 'var(--fg-4)', fontSize: 12 }}>No data</div>
            </div>
          )
          const gap = r.gap_to_top_competitor
          return (
            <div key={period} className="card card-pad">
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>{PERIOD_LABEL[period]}</div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#F5E625', fontFamily: 'JetBrains Mono' }}>{r.total_mentions}</div>
                <div style={{ fontSize: 10, color: 'var(--fg-4)', marginTop: 3 }}>Total mentions</div>
              </div>
              {r.weighted_total > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#a78bfa', fontFamily: 'JetBrains Mono' }}>{r.weighted_total.toFixed(1)}</div>
                  <div style={{ fontSize: 10, color: 'var(--fg-4)', marginTop: 2 }}>Attention score</div>
                </div>
              )}
              {gap != null && (
                <div title="Mention gap vs top competitor in the same category. Positive = this product leads.">
                  <div style={{ fontSize: 14, fontWeight: 700, color: gap >= 0 ? '#22c55e' : '#ef4444', fontFamily: 'JetBrains Mono' }}>
                    {gap >= 0 ? '+' : ''}{gap.toFixed(1)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--fg-4)', marginTop: 2 }}>vs competitor</div>
                </div>
              )}
              {r.rank_in_category != null && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--fg-3)' }}>
                  Rank <b style={{ color: 'var(--fg)' }}>#{r.rank_in_category}</b> in category
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
