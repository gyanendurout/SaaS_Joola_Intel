'use client'

import { useEffect, useState } from 'react'
import type { SuggestionsResponse } from '@/lib/v2/askIntel/types'

export function PromptChips({ onPick }: { onPick: (prompt: string) => void }) {
  const [groups, setGroups] = useState<SuggestionsResponse['groups']>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/v2/ask-intel/suggestions')
      .then((r) => r.json())
      .then((j: SuggestionsResponse) => {
        if (cancelled) return
        setGroups(j.groups || [])
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return <div style={{ color: 'var(--fg-4)', fontSize: 11, padding: 8 }}>Loading prompts…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {groups.map((g) => (
        <div key={g.category}>
          <div style={{
            fontSize: 10, color: 'var(--fg-4)',
            letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6,
            fontWeight: 700,
          }}>{g.title}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {g.items.map((it, i) => (
              <button
                key={i}
                onClick={() => onPick(it.prompt)}
                title={it.prompt}
                style={{
                  background: 'var(--wb-3)',
                  border: '1px solid var(--wb-8)',
                  color: 'var(--fg-2)',
                  borderRadius: 3, padding: '5px 9px',
                  fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  transition: 'all 120ms',
                  textAlign: 'left', lineHeight: 1.2,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(34,197,94,0.08)'
                  e.currentTarget.style.borderColor = 'rgba(34,197,94,0.3)'
                  e.currentTarget.style.color = '#22c55e'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--wb-3)'
                  e.currentTarget.style.borderColor = 'var(--wb-8)'
                  e.currentTarget.style.color = 'var(--fg-2)'
                }}
              >{it.label}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
