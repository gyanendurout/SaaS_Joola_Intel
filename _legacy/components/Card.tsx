interface CardProps {
  title?: string
  children: React.ReactNode
  className?: string
  accent?: 'green' | 'indigo' | 'amber'
  titleIcon?: React.ReactNode
}

const accentColors = {
  green:  { line: '#22c55e', dim: 'rgba(34,197,94,0.5)' },
  indigo: { line: '#818cf8', dim: 'rgba(129,140,248,0.5)' },
  amber:  { line: '#f59e0b', dim: 'rgba(245,158,11,0.5)' },
}

export function Card({ title, children, className = '', accent, titleIcon }: CardProps) {
  const ac = accent ? accentColors[accent] : null

  return (
    <div className={`relative rounded-2xl overflow-hidden ${className}`}
      style={{
        background: 'rgba(10,15,25,0.8)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}>

      {/* Top accent line */}
      <div className="absolute top-0 left-0 right-0 h-px"
        style={{
          background: ac
            ? `linear-gradient(90deg, transparent, ${ac.line}, transparent)`
            : 'linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)',
          opacity: ac ? 0.6 : 1,
        }} />

      <div className="p-5">
        {title && (
          <div className="flex items-center gap-2 mb-4">
            {titleIcon && <span style={{ color: ac?.line || '#94a3b8' }}>{titleIcon}</span>}
            <h3 className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#e2e8f0' }}>{title}</h3>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
