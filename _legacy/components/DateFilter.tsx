'use client'

import { DATE_FILTER_OPTIONS, type DateFilterOption } from '@/lib/v1/dateFilter'

interface DateFilterProps {
  value: DateFilterOption
  onChange: (value: DateFilterOption) => void
}

export function DateFilter({ value, onChange }: DateFilterProps) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as DateFilterOption)}
      className="cursor-pointer text-[13px] font-medium focus:outline-none transition-colors duration-150"
      style={{
        background: 'rgba(10,15,25,0.9)',
        border: '1px solid rgba(255,255,255,0.1)',
        color: '#ffffff',
        borderRadius: '10px',
        padding: '8px 12px',
        backdropFilter: 'blur(12px)',
      }}
    >
      {DATE_FILTER_OPTIONS.map(opt => (
        <option key={opt.value} value={opt.value} style={{ background: '#0b1018' }}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}
