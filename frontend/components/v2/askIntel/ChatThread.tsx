'use client'

import { useEffect, useRef } from 'react'
import type { ChatTurn } from '@/lib/v2/askIntel/types'
import { ChatMessage } from './ChatMessage'

export function ChatThread({
  turns,
  onFollowup,
}: {
  turns: ChatTurn[]
  onFollowup: (prompt: string) => void
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns.length, turns[turns.length - 1]?.pending])

  return (
    <div
      role="log"
      aria-live="polite"
      aria-label="Ask Intel conversation"
      style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        padding: '12px 20px',
      }}
    >
      {turns.length === 0 && (
        <div style={{
          color: 'var(--fg-4)', textAlign: 'center', padding: 40, fontSize: 13,
        }}>
          Ask anything about brands, products, channels, or sentiment.
          <br />
          Try a starter prompt from the right panel.
        </div>
      )}
      {turns.map((t) => (
        <ChatMessage key={t.id} turn={t} onFollowup={onFollowup} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
