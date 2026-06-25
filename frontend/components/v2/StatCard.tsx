// Shared KPI stat card — used on all brand detail pages (YouTube, Twitter, TikTok, Reddit, etc.)
export function StatCard({
  label, value, sub, color, tip,
}: {
  label: string
  value: string
  sub?: string
  color?: string
  tip?: string
}) {
  return (
    <div title={tip}
      style={{
        background: 'var(--wb-6)',
        border: '1px solid var(--wb-10)',
        borderRadius: 12,
        padding: '16px 20px',
        flex: 1,
        minWidth: 110,
        cursor: tip ? 'help' : 'default',
      }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: value === '—' ? 'var(--fg-4)' : (color || 'var(--fg)'), fontFamily: 'JetBrains Mono', lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 6 }}>{sub}</div>}
    </div>
  )
}
