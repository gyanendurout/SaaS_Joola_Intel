// Small colored pill badge — for content type labels, status tags, format labels.
export function StatusBadge({
  label, color, fontSize = 9,
}: {
  label: string
  color: string
  fontSize?: number
}) {
  return (
    <span style={{
      fontSize,
      fontWeight: 700,
      padding: '2px 7px',
      borderRadius: 4,
      background: color + '18',
      color,
      border: `1px solid ${color}44`,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}
