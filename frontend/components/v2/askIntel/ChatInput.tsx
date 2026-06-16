'use client'

import { useState, useRef, useEffect, type KeyboardEvent } from 'react'

export function ChatInput({
  onSend,
  onStop,
  onClear,
  busy,
  value,
  setValue,
}: {
  onSend: (v: string) => void
  onStop: () => void
  onClear: () => void
  busy: boolean
  value: string
  setValue: (v: string) => void
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(180, el.scrollHeight) + 'px'
  }, [value])

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function submit() {
    const v = value.trim()
    if (!v || busy) return
    onSend(v)
    setValue('')
  }

  return (
    <div style={{
      borderTop: '1px solid var(--wb-6)',
      padding: 16,
      background: 'rgba(7,9,14,0.55)',
    }}>
      <div style={{
        display: 'flex', gap: 8, alignItems: 'flex-end',
        background: 'var(--wb-3)',
        border: '1px solid var(--wb-8)',
        borderRadius: 4, padding: 8,
      }}>
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask anything about brands, products, sentiment…"
          rows={1}
          style={{
            flex: 1, background: 'transparent', border: 'none',
            color: 'var(--fg)', fontFamily: 'inherit', fontSize: 13,
            resize: 'none', outline: 'none', lineHeight: 1.5,
            minHeight: 22, maxHeight: 180,
          }}
          aria-label="Ask Intel input"
        />
        {busy ? (
          <button
            onClick={onStop}
            style={{
              background: '#ef4444', color: '#fff', border: 'none',
              padding: '7px 14px', borderRadius: 3, cursor: 'pointer',
              fontSize: 12, fontWeight: 700,
            }}
          >Stop</button>
        ) : (
          <button
            onClick={submit}
            disabled={!value.trim()}
            style={{
              background: value.trim() ? '#22c55e' : 'var(--wb-6)',
              color: value.trim() ? '#000' : 'var(--fg-4)', border: 'none',
              padding: '7px 14px', borderRadius: 3,
              cursor: value.trim() ? 'pointer' : 'not-allowed',
              fontSize: 12, fontWeight: 700,
              transition: 'background 120ms',
            }}
          >Send</button>
        )}
        <button
          onClick={onClear}
          title="Clear conversation"
          style={{
            background: 'transparent',
            color: 'var(--fg-4)',
            border: '1px solid var(--wb-8)',
            padding: '6px 10px', borderRadius: 3,
            cursor: 'pointer', fontSize: 11, fontWeight: 600,
          }}
        >Clear</button>
      </div>
      <div style={{
        marginTop: 6, fontSize: 10, color: 'var(--fg-4)',
        textAlign: 'right',
      }}>
        Enter to send · Shift+Enter for new line
      </div>
    </div>
  )
}
