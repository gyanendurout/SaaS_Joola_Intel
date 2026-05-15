export function SectionDivider({ label, icon }: { label: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 my-8">
      <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08))' }} />
      <div className="flex items-center gap-2 px-4 py-1.5 rounded-full"
        style={{
          background: 'rgba(10,15,25,0.8)',
          border: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(12px)',
        }}>
        {icon && <span style={{ color: '#22c55e' }}>{icon}</span>}
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] whitespace-nowrap" style={{ color: '#e2e8f0' }}>{label}</span>
      </div>
      <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.08), transparent)' }} />
    </div>
  )
}
