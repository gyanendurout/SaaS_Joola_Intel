export function BrandBadge({ name, isJoola }: { name: string; isJoola?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-semibold"
      style={isJoola ? {
        background: 'rgba(34,197,94,0.1)',
        color: '#22c55e',
        border: '1px solid rgba(34,197,94,0.2)',
      } : {
        background: 'rgba(255,255,255,0.05)',
        color: '#e2e8f0',
        border: '1px solid rgba(255,255,255,0.08)',
      }}>
      {isJoola && (
        <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] inline-block" />
      )}
      {name}
    </span>
  )
}
