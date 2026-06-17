'use client'

export function Pagination({
  total, page, pageSize, onChange,
}: {
  total: number; page: number; pageSize: number; onChange: (p: number) => void
}) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null
  const pages = Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
    if (totalPages <= 7) return i + 1
    if (page <= 4) return i + 1 <= 5 ? i + 1 : i + 1 === 6 ? -1 : totalPages
    if (page >= totalPages - 3) return i === 0 ? 1 : i === 1 ? -1 : totalPages - (6 - i)
    return i === 0 ? 1 : i === 1 ? -1 : i === 5 ? -1 : i === 6 ? totalPages : page + (i - 3)
  })
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center', padding: '16px 0', flexWrap: 'wrap' }}>
      <button onClick={() => onChange(page - 1)} disabled={page === 1} className="pagination-btn"
        style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--line)', background: 'transparent', color: page === 1 ? 'var(--fg-4)' : 'var(--fg-2)', cursor: page === 1 ? 'default' : 'pointer', fontSize: 12 }}>
        ←
      </button>
      {pages.map((p, i) => p === -1 ? (
        <span key={i} style={{ color: 'var(--fg-4)', fontSize: 12, padding: '0 4px' }}>…</span>
      ) : (
        <button key={i} onClick={() => onChange(p)} className="pagination-btn"
          style={{ width: 30, height: 28, borderRadius: 6, border: `1px solid ${p === page ? 'var(--yellow)' : 'var(--line)'}`, background: p === page ? 'var(--yellow)' : 'transparent', color: p === page ? '#000' : 'var(--fg-2)', cursor: 'pointer', fontSize: 12, fontWeight: p === page ? 700 : 400 }}>
          {p}
        </button>
      ))}
      <button onClick={() => onChange(page + 1)} disabled={page === totalPages} className="pagination-btn"
        style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--line)', background: 'transparent', color: page === totalPages ? 'var(--fg-4)' : 'var(--fg-2)', cursor: page === totalPages ? 'default' : 'pointer', fontSize: 12 }}>
        →
      </button>
      <span style={{ fontSize: 11, color: 'var(--fg-4)', marginLeft: 8 }}>{total} total · page {page} of {totalPages}</span>
    </div>
  )
}
