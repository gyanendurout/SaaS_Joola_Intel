'use client'

/**
 * Ask Intel — Feedback Debug Admin Page
 *
 * Lists the last 50 Q&A turns from `ask_intel_qa_log` so the team can
 * surface failures (👎), tighten prompts, and grow the alias map.
 *
 * Filterable by feedback state. Defaults to "all".
 *
 * Note: this is internal-only at the moment. There's no auth on the page
 * itself — it just calls the existing GET /api/v2/ask-intel/feedback route
 * which uses the service role key. Wrap in real auth before exposing.
 */

import { useCallback, useEffect, useState } from 'react'
import { PageHead } from '@/components/v2/PageShell'

type QaLogRow = {
  id: string
  session_id: string | null
  question: string
  answer_summary: string | null
  visuals_count: number | null
  data_sources: string[] | null
  feedback: 'up' | 'down' | 'none'
  feedback_notes: string | null
  user_followup: string | null
  latency_ms: number | null
  confidence: number | null
  warnings: string[] | null
  error_message: string | null
  created_at: string
}

type Filter = 'all' | 'up' | 'down' | 'none'

export default function AskIntelFeedbackPage() {
  const [rows, setRows] = useState<QaLogRow[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = filter === 'all' ? '' : `&feedback=${filter}`
      const res = await fetch(`/api/v2/ask-intel/feedback?limit=50${qs}`)
      const json = await res.json()
      if (!json.ok) {
        setError(json.error || 'Failed to load feedback log.')
        setRows([])
      } else {
        setRows(json.rows || [])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    document.title = 'JOOLA INTEL — Ask Intel Feedback'
    load()
  }, [load])

  const counts = {
    all: rows.length,
    up: rows.filter((r) => r.feedback === 'up').length,
    down: rows.filter((r) => r.feedback === 'down').length,
    none: rows.filter((r) => r.feedback === 'none').length,
  }

  return (
    <div>
      <PageHead
        eyebrow="ASK INTEL · INTERNAL"
        title="Q&A Feedback Log"
        accent="for prompt iteration"
        sub="Every Ask Intel turn is logged with thumbs-up/down. Filter to 👎 to surface failures worth fixing."
        actions={
          <button className="btn" onClick={load} style={{ fontSize: 11 }}>
            Refresh
          </button>
        }
      />

      <div className="card" style={{ marginTop: 16, padding: 16 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          {(['all', 'down', 'up', 'none'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '5px 12px', fontSize: 11, borderRadius: 3, cursor: 'pointer',
                background: filter === f ? 'rgba(245,230,37,0.12)' : 'transparent',
                border: '1px solid ' + (filter === f ? 'rgba(245,230,37,0.4)' : 'rgba(255,255,255,0.1)'),
                color: filter === f ? '#F5E625' : 'var(--fg-3)',
                fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em',
              }}
            >
              {f === 'all' && `All (${counts.all})`}
              {f === 'down' && `👎 Down (${counts.down})`}
              {f === 'up' && `👍 Up (${counts.up})`}
              {f === 'none' && `No feedback (${counts.none})`}
            </button>
          ))}
        </div>

        {loading && <div style={{ color: 'var(--fg-4)', fontSize: 12 }}>Loading…</div>}
        {error && (
          <div style={{
            padding: 12, color: '#f59e0b', fontSize: 12,
            border: '1px solid rgba(245,158,11,0.3)', borderRadius: 3,
            background: 'rgba(245,158,11,0.05)',
          }}>
            {error}
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div style={{ color: 'var(--fg-4)', fontSize: 12 }}>No rows match this filter.</div>
        )}

        {!loading && rows.length > 0 && (
          <table className="data" style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ width: 60 }}>Feedback</th>
                <th>Question</th>
                <th style={{ width: 70 }}>Confidence</th>
                <th style={{ width: 60 }}>Visuals</th>
                <th style={{ width: 70 }}>Latency</th>
                <th style={{ width: 120 }}>When</th>
                <th style={{ width: 60 }}>Expand</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <FeedbackRow
                  key={r.id}
                  row={r}
                  expanded={expanded === r.id}
                  onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function FeedbackRow({
  row,
  expanded,
  onToggle,
}: {
  row: QaLogRow
  expanded: boolean
  onToggle: () => void
}) {
  const ts = new Date(row.created_at)
  return (
    <>
      <tr>
        <td style={{ textAlign: 'center', fontSize: 14 }}>
          {row.feedback === 'up' && <span style={{ color: '#22c55e' }}>👍</span>}
          {row.feedback === 'down' && <span style={{ color: '#ef4444' }}>👎</span>}
          {row.feedback === 'none' && <span style={{ color: 'var(--fg-4)' }}>—</span>}
        </td>
        <td style={{ maxWidth: 480 }}>
          <div style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: row.error_message ? '#ef4444' : 'var(--fg)',
          }} title={row.question}>{row.question}</div>
          {row.error_message && (
            <div style={{ fontSize: 10, color: '#ef4444', marginTop: 2 }}>
              {row.error_message}
            </div>
          )}
        </td>
        <td style={{ textAlign: 'right' }}>
          {typeof row.confidence === 'number' ? row.confidence.toFixed(2) : '—'}
        </td>
        <td style={{ textAlign: 'right' }}>{row.visuals_count ?? 0}</td>
        <td style={{ textAlign: 'right' }}>
          {row.latency_ms ? `${row.latency_ms}ms` : '—'}
        </td>
        <td style={{ color: 'var(--fg-4)', fontSize: 10 }}>
          {ts.toISOString().replace('T', ' ').slice(0, 16)}
        </td>
        <td style={{ textAlign: 'center' }}>
          <button onClick={onToggle} style={{
            background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
            color: 'var(--fg-3)', fontSize: 10, padding: '2px 6px', cursor: 'pointer',
            borderRadius: 3,
          }}>
            {expanded ? '▲' : '▼'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} style={{
            background: 'rgba(0,0,0,0.25)', padding: 12, fontSize: 11,
          }}>
            <DetailBlock label="Answer summary" value={row.answer_summary || '(empty)'} />
            <DetailBlock label="Data sources" value={(row.data_sources || []).join(', ') || '(none)'} />
            <DetailBlock label="Warnings" value={(row.warnings || []).join(' · ') || '(none)'} />
            <DetailBlock label="Feedback notes" value={row.feedback_notes || '(none)'} />
            <DetailBlock label="User follow-up" value={row.user_followup || '(none)'} />
            <DetailBlock label="Session id" value={row.session_id || '(none)'} />
          </td>
        </tr>
      )}
    </>
  )
}

function DetailBlock({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <span style={{
        color: 'var(--fg-4)', fontSize: 10, textTransform: 'uppercase',
        letterSpacing: '0.08em', marginRight: 8,
      }}>{label}:</span>
      <span style={{ color: 'var(--fg-2)', whiteSpace: 'pre-wrap' }}>{value}</span>
    </div>
  )
}
