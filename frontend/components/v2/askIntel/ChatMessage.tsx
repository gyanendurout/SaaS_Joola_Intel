'use client'

import type { ChatTurn, FollowUp } from '@/lib/v2/askIntel/types'
import { ResponseRenderer } from './ResponseRenderer'
import { MethodologyAccordion } from './MethodologyAccordion'

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
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
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
          </>
        ) : (
          <div style={{ color: 'var(--fg-4)', fontSize: 12 }}>{turn.content}</div>
        )}
      </div>
    </div>
  )
}
