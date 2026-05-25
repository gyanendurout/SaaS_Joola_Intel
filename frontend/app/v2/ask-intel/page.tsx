'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHead } from '@/components/v2/PageShell'
import { useBrandFilter } from '@/lib/v2/BrandFilterContext'
import type {
  AskIntelRequest,
  AskIntelResponse,
  ChatTurn,
} from '@/lib/v2/askIntel/types'
import { ChatThread } from '@/components/v2/askIntel/ChatThread'
import { ChatInput } from '@/components/v2/askIntel/ChatInput'
import { DataCoveragePanel } from '@/components/v2/askIntel/DataCoveragePanel'
import { PromptChips } from '@/components/v2/askIntel/PromptChips'

function uid(): string {
  return 't_' + Math.random().toString(36).slice(2, 10)
}

export default function AskIntelPage() {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [rightOpen, setRightOpen] = useState(true)
  const abortRef = useRef<AbortController | null>(null)
  const { selectedSlugs } = useBrandFilter()

  useEffect(() => {
    document.title = 'JOOLA INTEL — Ask Intel'
  }, [])

  const sendMessage = useCallback(async (text: string) => {
    const userTurn: ChatTurn = {
      id: uid(), role: 'user', content: text, ts: new Date().toISOString(),
    }
    const pendingTurn: ChatTurn = {
      id: uid(), role: 'assistant', content: '', ts: new Date().toISOString(),
      pending: true,
    }
    setTurns((t) => [...t, userTurn, pendingTurn])
    setBusy(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const body: AskIntelRequest = {
        message: text,
        history: turns.slice(-6).map((t) => ({
          role: t.role,
          content: t.role === 'assistant' && t.response ? t.response.answer : t.content,
        })),
        brandSlugs: selectedSlugs,
      }
      const res = await fetch('/api/v2/ask-intel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => 'Request failed')
        throw new Error(text || `HTTP ${res.status}`)
      }
      const data = (await res.json()) as AskIntelResponse
      setTurns((t) => t.map((turn) => turn.id === pendingTurn.id
        ? { ...turn, pending: false, content: data.answer, response: data }
        : turn))
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError'
      const msg = aborted ? 'Request cancelled.' : (err instanceof Error ? err.message : 'Unknown error')
      setTurns((t) => t.map((turn) => turn.id === pendingTurn.id
        ? {
          ...turn,
          pending: false,
          content: msg,
          response: {
            answer: msg, visuals: [], followups: [], dataSources: [], warnings: [msg],
            confidence: 0,
            queryInfo: { plan: null, rawSql: null, rowsReturned: 0, elapsedMs: 0, tablesUsed: [] },
          },
        }
        : turn))
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }, [turns, selectedSlugs])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const handleClear = useCallback(() => {
    if (busy) abortRef.current?.abort()
    setTurns([])
  }, [busy])

  const handleFollowup = useCallback((prompt: string) => {
    if (busy) return
    sendMessage(prompt)
  }, [busy, sendMessage])

  const handleChip = useCallback((prompt: string) => {
    setInput(prompt)
  }, [])

  return (
    <div>
      <PageHead
        eyebrow="ASK INTEL"
        title="Ask anything"
        accent="about your competitive landscape"
        sub="Natural-language Q&A across 25+ tracked tables. Powered by GPT-4o-mini with safe, schema-aware SQL planning."
        actions={
          <button
            className="btn"
            onClick={() => setRightOpen((o) => !o)}
            style={{ fontSize: 11 }}
            title="Toggle prompts / data panel"
          >
            {rightOpen ? 'Hide' : 'Show'} prompts
          </button>
        }
      />

      <div className="card" style={{
        padding: 0, marginTop: 16, overflow: 'hidden',
        display: 'grid',
        gridTemplateColumns: rightOpen ? 'minmax(0, 1fr) 320px' : 'minmax(0, 1fr)',
        height: 'calc(100vh - 280px)', minHeight: 540,
      }}>
        {/* LEFT — chat thread + input */}
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <ChatThread turns={turns} onFollowup={handleFollowup} />
          <ChatInput
            value={input}
            setValue={setInput}
            onSend={sendMessage}
            onStop={handleStop}
            onClear={handleClear}
            busy={busy}
          />
        </div>

        {/* RIGHT — prompts + coverage + methodology */}
        {rightOpen && (
          <aside style={{
            borderLeft: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(0,0,0,0.2)',
            padding: 16, overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 18,
          }}>
            <DataCoveragePanel />

            <div>
              <div style={{
                fontSize: 10, color: 'var(--fg-4)',
                letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8,
                fontWeight: 700,
              }}>Starter Prompts</div>
              <PromptChips onPick={handleChip} />
            </div>

            <div>
              <div style={{
                fontSize: 10, color: 'var(--fg-4)',
                letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6,
                fontWeight: 700,
              }}>Methodology</div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)', lineHeight: 1.5 }}>
                Two-step planner / answerer flow. The planner emits a structured
                query plan against the whitelisted schema (no raw SQL), the
                executor runs it via typed Supabase calls, then a second model
                summarises results into the visuals and narrative above.
                Per-response details live in the "Methodology" accordion under each answer.
              </div>
              <div style={{
                marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 5,
              }}>
                <Badge>GPT-4o-mini</Badge>
                <Badge>Schema-safe</Badge>
                <Badge>Server-only key</Badge>
                <Badge tone="joola">JOOLA-tuned</Badge>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: 'joola' }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
      padding: '3px 7px', borderRadius: 99,
      background: tone === 'joola' ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.05)',
      border: '1px solid ' + (tone === 'joola' ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)'),
      color: tone === 'joola' ? '#22c55e' : 'var(--fg-3)',
    }}>{children}</span>
  )
}
