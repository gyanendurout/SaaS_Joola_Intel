interface KPICardProps {
  label: string
  value: string | number
  accent?: boolean
  sub?: string
  trend?: 'up' | 'down' | 'neutral'
  color?: 'green' | 'indigo' | 'amber' | 'default'
}

const colorMap = {
  green:   { border: 'rgba(34,197,94,0.25)',  glow: 'rgba(34,197,94,0.08)',  text: '#22c55e',  bg: 'rgba(34,197,94,0.06)'  },
  indigo:  { border: 'rgba(129,140,248,0.25)', glow: 'rgba(129,140,248,0.08)', text: '#818cf8', bg: 'rgba(129,140,248,0.06)' },
  amber:   { border: 'rgba(245,158,11,0.25)',  glow: 'rgba(245,158,11,0.08)',  text: '#f59e0b', bg: 'rgba(245,158,11,0.06)'  },
  default: { border: 'rgba(255,255,255,0.08)', glow: 'transparent',            text: '#f1f5f9', bg: 'transparent'            },
}

function TrendUp() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
      <path d="M2 11l4-4 3 3 5-5" stroke="#22c55e" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 5h4v4" stroke="#22c55e" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function TrendDown() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
      <path d="M2 5l4 4 3-3 5 5" stroke="#ef4444" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 11h4V7" stroke="#ef4444" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function KPICard({ label, value, accent, sub, trend, color = 'default' }: KPICardProps) {
  const scheme = accent ? colorMap.green : colorMap[color]
  return (
    <div className="relative rounded-2xl p-5 overflow-hidden cursor-default transition-all duration-200 group"
      style={{
        background: 'rgba(10,15,25,0.8)',
        backdropFilter: 'blur(16px)',
        border: `1px solid ${scheme.border}`,
        boxShadow: `0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)`,
      }}>
      {/* Subtle top gradient line */}
      <div className="absolute top-0 left-0 right-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${scheme.text}, transparent)`, opacity: 0.4 }} />

      {/* Background glow blob */}
      {accent && (
        <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full pointer-events-none"
          style={{ background: scheme.glow, filter: 'blur(20px)' }} />
      )}

      <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: '#cbd5e1' }}>{label}</p>

      <div className="flex items-end justify-between gap-2">
        <p className="stat-number text-[28px] font-black leading-none" style={{ color: scheme.text }}>
          {value}
        </p>
        {trend && (
          <div className="mb-1">{trend === 'up' ? <TrendUp /> : <TrendDown />}</div>
        )}
      </div>

      {sub && (
        <p className="text-[11px] mt-2" style={{ color: '#cbd5e1' }}>{sub}</p>
      )}
    </div>
  )
}
