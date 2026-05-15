interface BarItem {
  label: string
  value: number
  isJoola?: boolean
  color?: string
  formatted?: string
}

function fmtNum(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toString()
}

export function CSSBar({ items, defaultColor = '#818cf8' }: { items: BarItem[]; defaultColor?: string }) {
  if (!items || items.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-[13px]" style={{ color: '#cbd5e1' }}>No data available yet.</p>
      </div>
    )
  }

  const max = Math.max(...items.map(i => i.value), 1)

  return (
    <div className="space-y-2.5">
      {items.map((item, i) => {
        const pct = (item.value / max) * 100
        const isJoola = item.isJoola
        const baseColor = isJoola ? '#22c55e' : (item.color || defaultColor)
        const gradientEnd = isJoola ? '#86efac' : (item.color ? item.color : '#c7d2fe')
        const displayVal = item.formatted ?? fmtNum(item.value)

        return (
          <div key={i} className="flex items-center gap-3 group">
            {/* Label */}
            <div className="w-[130px] min-w-[130px] text-right">
              <span className="text-[13px] font-medium truncate block"
                style={{ color: isJoola ? '#22c55e' : '#e2e8f0' }}>
                {item.label}
              </span>
            </div>

            {/* Bar track */}
            <div className="flex-1 h-6 rounded-md overflow-hidden relative"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.04)' }}>
              <div
                className="h-full rounded-md transition-all duration-700"
                style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${baseColor}, ${gradientEnd})`,
                  opacity: isJoola ? 1 : 0.7,
                  minWidth: item.value > 0 ? '4px' : '0',
                  boxShadow: isJoola ? `0 0 8px ${baseColor}40` : 'none',
                }}
              />
            </div>

            {/* Value */}
            <div className="w-[52px] min-w-[52px] text-right">
              <span className="text-[13px] font-bold stat-number"
                style={{ color: isJoola ? '#22c55e' : '#f1f5f9' }}>
                {displayVal}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
