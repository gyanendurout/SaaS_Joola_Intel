/**
 * Ask Intel — Shared API contract types.
 *
 * Used by:
 *   • `frontend/app/api/v2/ask-intel/route.ts` (server)
 *   • `frontend/components/v2/askIntel/*` (client)
 *
 * Keep this file dependency-free so it can be imported safely from
 * either the edge runtime or the browser.
 */

import type { QueryPlan } from './sqlSafety'

// ─── Visuals (the AI can ask the renderer to draw these) ─────────────

export type KpiCard = {
  label: string
  value: string | number
  /** Optional caveat / unit shown beneath the value. */
  caption?: string
  /** Optional hex; defaults to JOOLA green when omitted. */
  color?: string
  /** Sparkline data when relevant. */
  spark?: number[]
}

export type VisualKpiCards = {
  type: 'kpi_cards'
  title?: string
  cards: KpiCard[]
}

export type VisualBarChart = {
  type: 'bar_chart'
  title?: string
  /** Each bar = one item. Use color "joola" or "#22c55e" to highlight JOOLA. */
  data: { label: string; value: number; color?: string }[]
  /** Optional axis suffix, e.g. "%", " mentions". */
  unitSuffix?: string
}

export type VisualLineChart = {
  type: 'line_chart'
  title?: string
  xLabels: string[]
  series: { id: string; label: string; color?: string; data: number[] }[]
  yLabel?: string
}

export type VisualDonut = {
  type: 'donut'
  title?: string
  data: { name: string; value: number; color?: string }[]
  centerLabel?: string
  centerSub?: string
}

export type VisualTable = {
  type: 'table'
  title?: string
  columns: { key: string; label: string; align?: 'left' | 'right' | 'center'; format?: 'number' | 'percent' | 'currency' | 'date' | 'text' }[]
  rows: Record<string, string | number | boolean | null>[]
  /** Highlight JOOLA rows when a row has brand === 'joola'. */
  joolaColumn?: string
}

export type Visual =
  | VisualKpiCards
  | VisualBarChart
  | VisualLineChart
  | VisualDonut
  | VisualTable

// ─── Suggested follow-up ─────────────────────────────────────────────

export type FollowUp = {
  label: string
  prompt: string
}

// ─── Conversation history (sent on every request) ────────────────────

export type ChatRole = 'user' | 'assistant' | 'system'

export type ChatTurn = {
  id: string
  role: ChatRole
  /** User question text OR AI response.answer text. */
  content: string
  /** Full structured response for assistant turns. */
  response?: AskIntelResponse
  /** ISO timestamp. */
  ts: string
  /** True if this turn is currently streaming / pending. */
  pending?: boolean
}

// ─── Request / response ──────────────────────────────────────────────

export type AskIntelRequest = {
  message: string
  conversationId?: string
  history?: { role: ChatRole; content: string }[]
  /** Optional brand-slug filter the user has set in the global filter bar. */
  brandSlugs?: string[]
}

export type QueryInfo = {
  plan: QueryPlan | null
  rawSql: string | null
  rowsReturned: number
  truncatedTo?: number
  elapsedMs: number
  /** Names of tables actually touched. */
  tablesUsed: string[]
}

export type AskIntelResponse = {
  answer: string
  /** Short headline (4–8 words) summarising the answer. */
  headline?: string
  visuals: Visual[]
  followups: FollowUp[]
  /** Data sources to credit beneath the response. */
  dataSources: string[]
  queryInfo: QueryInfo
  /** Soft warnings — empty result sets, partial coverage, classifier still calibrating, etc. */
  warnings: string[]
  /** Clarifying question — when set, the answer is just a clarification request. */
  clarification?: string
  /** Confidence score 0..1. */
  confidence: number
  /** Methodology — surfaced behind an accordion in the UI. */
  methodology?: string
  /** Server-assigned id of the ask_intel_qa_log row for this turn — used by
   * the thumbs-up/down feedback button to attach feedback after the answer
   * has been rendered. Null when the QA log insert failed (e.g. migration
   * 017 not applied). */
  messageId?: string | null
}

// ─── Suggested-prompt catalog (returned by /suggestions) ────────────

export type PromptCategory =
  | 'product'
  | 'community'
  | 'campaign'
  | 'influencer'
  | 'social'
  | 'sales'

export type Suggestion = {
  category: PromptCategory
  label: string
  prompt: string
}

export type SuggestionsResponse = {
  groups: { category: PromptCategory; title: string; items: Suggestion[] }[]
}

// ─── Data-coverage probe (returned by the page right rail) ──────────

export type DataCoverage = {
  brands: number
  products: number
  mentionFacts: number
  lastEnrichmentAt: string | null
  /** Per-channel mention counts in the last 30 days. */
  channels: { channel: string; total: number }[]
}
