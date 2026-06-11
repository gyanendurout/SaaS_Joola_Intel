'use client'
import { SectionInfo } from '@/components/v2/PageShell'
import { fmt, Sparkline } from '@/components/v2/charts'
import type { LeaderboardRow } from '@/components/v2/charts/LeaderboardTable'

interface Props {
  row: LeaderboardRow | null
  brandColor: string
}

export function ProductAttention({ row, brandColor }: Props) {
  if (!row) return (
    <section>
      <div className="section-head">
        <div>
          <h2>Community attention <SectionInfo title="Community Attention" description="7-day rolling attention score and mention data for this product. No data means this product has not yet appeared in tracked community channels in the current date window." source="product_attention_daily" /></h2>
        </div>
      </div>
      <div className="card"><div style={{ padding: '24px', textAlign: 'center', color: 'var(--fg-4)', fontSize: 13 }}>
        No community attention data for this product in the current window. Try expanding the date range.
      </div></div>
    </section>
  )

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>
            Community attention
            <SectionInfo
              title="Community Attention"
              description="How much the community is talking about this product right now. Attention = 7-day rolling composite score (mentions + engagement weight + estimated sales signals). Sparkline shows the 28-day trend."
              source="product_attention_daily · 28-day window"
            />
          </h2>
          <div className="sub">7-day rolling attention score · 28-day mention trend</div>
        </div>
      </div>
      <div className="card card-pad">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
          {[
            { label: 'Attention score', value: row.attention > 0 ? row.attention.toFixed(2) : '0', color: '#F5E625', tip: '7-day rolling attention score — composite of mention volume, engagement weight, and estimated sales signals. Higher = more community buzz right now.' },
            { label: 'Total mentions',  value: fmt(row.mentions),                                   color: '#60a5fa', tip: 'Total community mentions for this product in the active date window across all tracked channels.' },
            { label: 'Est. units sold', value: row.estimatedUnitsSold != null ? fmt(row.estimatedUnitsSold) : '—', color: '#22c55e', tip: 'AI-estimated units sold based on attention score and historical signal patterns. Directional only — not actual sales data.' },
          ].map(m => (
            <div key={m.label} title={m.tip} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px', cursor: 'help' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{m.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: m.value === '—' ? 'var(--fg-4)' : m.color, fontFamily: 'JetBrains Mono' }}>{m.value}</div>
            </div>
          ))}
        </div>
        {row.sparkline?.length > 1 && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--fg-4)', marginBottom: 6, fontWeight: 600 }}>28-DAY MENTION TREND</div>
            <Sparkline data={row.sparkline} color={brandColor} w={400} h={40} />
          </div>
        )}
      </div>
    </section>
  )
}
