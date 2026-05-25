'use client'

import type { PlaybookFinding } from '@/lib/v2/playbook'
import type { V2Brand } from '@/lib/v2/data'
import { pgColor, SectionInfo } from '@/components/v2/PageShell'

interface PlatformPlaybookProps {
  /** Title rendered in the section head — e.g. "Instagram Playbook". */
  title: string
  /** One-line description shown directly below the title. */
  sub?: string
  /** Rule-based findings — generators in lib/v2/playbook.ts. */
  findings: PlaybookFinding[]
  /** Brands list for resolving slugs → display names. */
  brands: V2Brand[]
}

/**
 * Reusable additive section for every social-platform page. Renders a
 * single table with the Competitor-move / Business-impact / Recommended-
 * action shape. Empty-state is silent — when no findings are produced
 * (insufficient data), the component renders a friendly placeholder.
 */
export function PlatformPlaybook({ title, sub, findings, brands }: PlatformPlaybookProps) {
  const brandName = (slug: string) => {
    if (slug === '—' || !slug) return '—'
    return brands.find((b) => b.id === slug)?.name || slug
  }

  return (
    <section style={{ marginBottom: 28 }}>
      <div className="section-head">
        <div>
          <h2>
            {title}
            <SectionInfo
              title={title}
              description="Rule-based findings derived from the same data the rest of this page renders. Each row is competitor-move + business impact + recommended JOOLA response. Findings only appear when the underlying signal is strong enough."
              source="lib/v2/playbook.ts · derived programmatically from existing data fetchers"
            />
          </h2>
          {sub && <div className="sub">{sub}</div>}
        </div>
      </div>
      <div className="card">
        {findings.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>
            Not enough data yet to surface defensible playbook findings.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: '25%' }}>Finding</th>
                  <th>Competitor</th>
                  <th style={{ width: '22%' }}>Evidence</th>
                  <th style={{ width: '20%' }}>JOOLA gap</th>
                  <th style={{ width: '22%' }}>Recommended action</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((f, i) => (
                  <tr key={i} className={f.competitor === 'joola' ? 'joola' : ''}>
                    <td style={{ fontSize: 12, color: 'var(--fg)' }}>{f.finding}</td>
                    <td>
                      {f.competitor === '—' ? (
                        <span style={{ color: 'var(--fg-4)', fontSize: 11 }}>cross-brand</span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className="brand-dot" style={{ background: pgColor(f.competitor) }} />
                          <span style={{ fontWeight: 700, fontSize: 12, color: f.competitor === 'joola' ? '#22c55e' : 'var(--fg)' }}>
                            {brandName(f.competitor)}
                          </span>
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--fg-3)' }}>{f.evidence}</td>
                    <td style={{ fontSize: 11, color: '#f59e0b' }}>{f.joolaGap}</td>
                    <td style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>{f.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
