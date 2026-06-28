'use client'

import { useState } from 'react'
import type { ChatTurn, FollowUp } from '@/lib/v2/askIntel/types'
import { ResponseRenderer } from './ResponseRenderer'
import { MethodologyAccordion } from './MethodologyAccordion'

type FeedbackState = 'idle' | 'sending' | 'thanks' | 'error'

export function ChatMessage({
  turn,
  onFollowup,
}: {
  turn: ChatTurn
  onFollowup: (prompt: string) => void
}) {
  if (turn.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <div style={{
          maxWidth: '78%',
          background: 'rgba(245,230,37,0.06)',
          border: '1px solid rgba(245,230,37,0.18)',
          padding: '10px 14px', borderRadius: 4,
          color: 'var(--fg)', fontSize: 13, lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
        }}>{turn.content}</div>
      </div>
    )
  }

  const r = turn.response
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        background: 'var(--wb-3)',
        border: '1px solid var(--line)',
        borderRadius: 4, padding: 16,
      }}>
        {turn.pending ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--fg-4)', fontSize: 12 }}>
            <span className="ask-pulse" style={{
              width: 8, height: 8, borderRadius: 99, background: '#22c55e', display: 'inline-block',
            }} />
            <span>JOOLA Intel is thinking…</span>
          </div>
        ) : r ? (
          <>
            {r.headline && (
              <div style={{
                fontSize: 11, color: '#22c55e', fontWeight: 700,
                letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6,
              }}>{r.headline}</div>
            )}
            <div style={{
              fontSize: 14, color: 'var(--fg)', lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
            }}>{r.answer}</div>

            {r.clarification && (
              <div style={{
                marginTop: 10, padding: 10,
                background: 'rgba(245,230,37,0.05)', border: '1px solid rgba(245,230,37,0.2)',
                borderRadius: 3, fontSize: 12, color: '#F5E625',
              }}>{r.clarification}</div>
            )}

            <ResponseRenderer visuals={r.visuals} />

            {r.warnings.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {r.warnings.map((w, i) => (
                  <div key={i} style={{
                    fontSize: 11, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <span style={{
                      display: 'inline-block', width: 4, height: 4, borderRadius: 99, background: '#f59e0b',
                    }} />
                    {w}
                  </div>
                ))}
              </div>
            )}

            {r.followups.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{
                  fontSize: 10, color: 'var(--fg-4)',
                  letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6,
                }}>Suggested follow-ups</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {r.followups.map((f: FollowUp, i) => (
                    <button
                      key={i}
                      onClick={() => onFollowup(f.prompt)}
                      style={{
                        background: 'transparent',
                        border: '1px solid rgba(34,197,94,0.3)',
                        color: '#22c55e',
                        borderRadius: 3, padding: '5px 10px',
                        fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        transition: 'background 120ms',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(34,197,94,0.08)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                    >{f.label}</button>
                  ))}
                </div>
              </div>
            )}

            <MethodologyAccordion response={r} />

            <FeedbackButtons
              messageId={r.messageId ?? null}
              question={r.answer ?? turn.content ?? ''}
            />
          </>
        ) : (
          <div style={{ color: 'var(--fg-4)', fontSize: 12 }}>{turn.content}</div>
        )}
      </div>
    </div>
  )
}

/**
 * Thumbs-up/down feedback widget. ALWAYS rendered on AI messages.
 * On click:
 *  1. Always writes a JSON entry to localStorage under
 *     `ask_intel_feedback_log` (capped to last 500 entries).
 *  2. If `messageId` is present (migration 017 applied + QA log row
 *     created), additionally POSTs to /api/v2/ask-intel/feedback.
 *     API failures are swallowed so the widget still flips to
 *     "thanks" — the localStorage fallback is the source of truth
 *     when the server-side log isn't available.
 */
function FeedbackButtons({
  messageId,
  question,
}: {
  messageId: string | null
  question: string
}) {
  const [state, setState] = useState<FeedbackState>('idle')
  const [picked, setPicked] = useState<'up' | 'down' | null>(null)

  const send = async (kind: 'up' | 'down') => {
    if (state === 'sending' || state === 'thanks') return
    setState('sending')
    setPicked(kind)

    const synthId =
      messageId ||
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `local-${Date.now()}`)
    const entry = {
      messageId: synthId,
      question,
      feedback: kind,
      timestamp: new Date().toISOString(),
    }

    // Always log to localStorage (fallback when migration 017 not applied).
    try {
      const existing = JSON.parse(
        localStorage.getItem('ask_intel_feedback_log') || '[]',
      ) as unknown[]
      existing.push(entry)
      localStorage.setItem(
        'ask_intel_feedback_log',
        JSON.stringify(existing.slice(-500)),
      )
    } catch {
      // localStorage may be unavailable (SSR / privacy mode); swallow.
    }

    // Best-effort server-side log. Silently ignore failures.
    if (messageId) {
      try {
        await fetch('/api/v2/ask-intel/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId, feedback: kind }),
        })
      } catch {
        // ignore — localStorage entry is the durable record.
      }
    }

    setState('thanks')
  }

  return (
    <div style={{
      marginTop: 12, display: 'flex', alignItems: 'center', gap: 8,
      paddingTop: 10,
      borderTop: '1px dashed var(--wb-6)',
    }}>
      <span style={{
        fontSize: 10, color: 'var(--fg-4)',
        letterSpacing: '0.1em', textTransform: 'uppercase',
      }}>Was this helpful?</span>
      <button
        onClick={() => send('up')}
        disabled={state === 'sending' || state === 'thanks'}
        title="Helpful"
        style={{
          background: picked === 'up' ? 'rgba(34,197,94,0.18)' : 'transparent',
          border: '1px solid ' + (picked === 'up' ? 'rgba(34,197,94,0.5)' : 'var(--wb-12)'),
          color: picked === 'up' ? '#22c55e' : 'var(--fg-3)',
          padding: '3px 8px', borderRadius: 3, fontSize: 12, cursor: 'pointer',
        }}
      >👍</button>
      <button
        onClick={() => send('down')}
        disabled={state === 'sending' || state === 'thanks'}
        title="Not helpful"
        style={{
          background: picked === 'down' ? 'rgba(239,68,68,0.18)' : 'transparent',
          border: '1px solid ' + (picked === 'down' ? 'rgba(239,68,68,0.5)' : 'var(--wb-12)'),
          color: picked === 'down' ? '#ef4444' : 'var(--fg-3)',
          padding: '3px 8px', borderRadius: 3, fontSize: 12, cursor: 'pointer',
        }}
      >👎</button>
      {state === 'thanks' && (
        <span style={{ fontSize: 10, color: '#22c55e' }}>Thanks — logged.</span>
      )}
      {state === 'error' && (
        <span style={{ fontSize: 10, color: '#ef4444' }}>Couldn't save feedback.</span>
      )}
    </div>
  )
}
