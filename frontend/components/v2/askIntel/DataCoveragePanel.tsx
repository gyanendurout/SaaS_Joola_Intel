'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/shared/supabase'
import type { DataCoverage } from '@/lib/v2/askIntel/types'
import { fmt } from '@/components/v2/charts'

async function probeCount(table: string): Promise<number> {
  try {
    const { count } = await supabase.from(table).select('*', { count: 'exact', head: true })
    return count || 0
  } catch {
    return 0
  }
}

async function probeLatestEnrichment(): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('mention_facts')
      .select('posted_at')
      .order('posted_at', { ascending: false })
      .limit(1)
    const row = (data || [])[0] as { posted_at?: string } | undefined
    return row?.posted_at || null
  } catch {
    return null
  }
}

async function probeChannelCounts(): Promise<{ channel: string; total: number }[]> {
  try {
    const since = new Date()
    since.setDate(since.getDate() - 30)
    const { data } = await supabase
      .from('mention_facts')
      .select('channel')
      .gte('posted_at', since.toISOString())
      .limit(5000)
    const counts = new Map<string, number>()
    for (const r of (data || []) as { channel: string }[]) {
      counts.set(r.channel, (counts.get(r.channel) || 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([channel, total]) => ({ channel, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8)
  } catch {
    return []
  }
}

export function DataCoveragePanel() {
  const [coverage, setCoverage] = useState<DataCoverage | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [brands, products, mentionFacts, lastEnrichmentAt, channels] = await Promise.all([
        probeCount('brands'),
        probeCount('products'),
        probeCount('mention_facts'),
        probeLatestEnrichment(),
        probeChannelCounts(),
      ])
      if (cancelled) return
      setCoverage({ brands, products, mentionFacts, lastEnrichmentAt, channels })
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div>
      <div style={{
        fontSize: 10, color: 'var(--fg-4)',
        letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8,
        fontWeight: 700,
      }}>Data Coverage</div>

      {loading || !coverage ? (
        <div style={{ color: 'var(--fg-4)', fontSize: 11 }}>Probing tables…</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Stat label="Brands" value={coverage.brands} />
            <Stat label="Products" value={fmt(coverage.products)} />
            <Stat label="Mentions" value={fmt(coverage.mentionFacts)} />
            <Stat label="Last data" value={coverage.lastEnrichmentAt ? new Date(coverage.lastEnrichmentAt).toISOString().slice(0, 10) : '—'} small />
          </div>

          {coverage.channels.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{
                fontSize: 9, color: 'var(--fg-4)',
                letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6,
              }}>Channels (last 30d)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {coverage.channels.map((c) => (
                  <div key={c.channel} style={{
                    display: 'flex', justifyContent: 'space-between', fontSize: 11,
                  }}>
                    <span style={{ color: 'var(--fg-3)' }}>{c.channel}</span>
                    <span style={{ color: 'var(--fg-2)', fontFamily: 'JetBrains Mono, monospace' }}>
                      {fmt(c.total)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div style={{
      background: 'var(--wb-3)',
      border: '1px solid var(--wb-6)',
      padding: 8, borderRadius: 3,
    }}>
      <div style={{
        fontSize: 9, color: 'var(--fg-4)', letterSpacing: '0.1em',
        textTransform: 'uppercase', marginBottom: 4,
      }}>{label}</div>
      <div style={{
        fontSize: small ? 11 : 16, fontWeight: 700, color: 'var(--fg)',
        fontFamily: small ? 'JetBrains Mono, monospace' : 'Archivo Black, sans-serif',
      }}>{value}</div>
    </div>
  )
}
