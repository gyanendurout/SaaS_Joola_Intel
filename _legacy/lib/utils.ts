export function fmt(n: number | null | undefined): string {
  if (!n) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toString()
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtPrice(p: number | null | undefined): string {
  if (!p) return '—'
  return '$' + p.toFixed(0)
}

export function categoryColor(cat: string | null): string {
  switch (cat) {
    case 'Pro': return 'text-red-400 bg-red-400/10'
    case 'Advanced': return 'text-amber-400 bg-amber-400/10'
    case 'Mid': return 'text-blue-400 bg-blue-400/10'
    default: return 'text-slate-400 bg-slate-400/10'
  }
}

export function ratingColor(r: number | null | undefined): string {
  if (!r) return 'text-[#8b8b9e]'
  if (r >= 4.5) return 'text-[#22c55e]'
  if (r >= 4.0) return 'text-[#f59e0b]'
  return 'text-[#ef4444]'
}
