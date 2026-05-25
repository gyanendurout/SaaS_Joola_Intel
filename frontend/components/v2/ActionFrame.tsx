'use client'

/**
 * Shared "Competitor move / Business impact / Recommended JOOLA action"
 * 3-column framing block. Used under every new Product Intel + Sales Intel
 * data viz so every section closes with a how-to-act narrative.
 *
 * Pair with `<Caveat tables={[...]} />` for the source-tables footer line.
 */
export function ActionFrame({
  move, impact, action,
}: { move: string; impact: string; action: string }) {
  return (
    <div className="card" style={{ marginTop: 12, padding: 14, background: 'rgba(255,255,255,0.02)' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 14,
        }}
      >
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#ef4444', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
            Competitor move
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.5 }}>{move}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#F5E625', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
            Business impact
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.5 }}>{impact}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#22c55e', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
            Recommended JOOLA action
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.5 }}>{action}</div>
        </div>
      </div>
    </div>
  )
}

export function Caveat({ tables }: { tables: string[] }) {
  return (
    <div style={{ fontSize: 10, color: 'var(--fg-4)', padding: '6px 4px 0', lineHeight: 1.5 }}>
      <span style={{ fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Source:</span>{' '}
      {tables.join(' · ')} · refreshes weekly with the pipeline run.
    </div>
  )
}
