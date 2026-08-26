'use client'

/**
 * v2 crisis adapter — reads cross-channel crisis flags from `mention_facts`.
 *
 * `mention_facts` is the unified table populated by scripts/scraping/facts/
 * mention_facts.py. Every enriched row from reddit, ig_comments, yt_comments,
 * x_posts, tiktok_videos, influencer_x_posts that the LLM flagged as
 * is_crisis=true lands here with brand_id, product_id, text_snippet,
 * posted_at, channel, source_table, source_id.
 *
 * Every fetcher returns [] (with a one-shot console.warn) when the table is
 * missing, so the page renders an empty "no crises detected" state without
 * crashing.
 */

import { supabase } from '@/lib/shared/supabase'
import { fetchPagedResult } from './paged'

// ─── Shapes ───────────────────────────────────────────────────────────

export type CrisisIncident = {
  id: string
  channel: string                // 'reddit' | 'ig_comments' | 'yt_comments' | ...
  source_table: string
  source_id: string
  brand_id: string
  brand_slug: string             // resolved from brands
  product_id: string | null
  athlete_id: string | null
  sentiment_score: number | null
  sentiment_label: string | null
  text_snippet: string | null
  posted_at: string              // ISO timestamp
}

export type CrisisCountByBrand = {
  brand_slug: string
  total: number
  last_7d: number
  last_30d: number
}

export type CrisisCountByChannel = {
  channel: string
  total: number
}

export type CrisisCountByBrandChannel = {
  brand_slug: string
  channel: string
  count: number
}

export type CrisisDailyPoint = {
  date: string                   // YYYY-MM-DD
  count: number
}

// ─── Internals ────────────────────────────────────────────────────────

// Missing-table / RLS detection now lives in `fetchPagedResult`, which logs the
// failing page and reports it through `ok`. We only need the one-shot guard so
// a broken table doesn't spam the console on every re-render.
let warnedMissing = false

function dayKey(iso: string | null | undefined): string {
  if (!iso) return ''
  // YYYY-MM-DD slice; ISO timestamps from Postgres are always UTC-normalised.
  return iso.slice(0, 10)
}

function daysAgo(n: number): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - n)
  return d
}

// ─── Fetchers ─────────────────────────────────────────────────────────

/**
 * All crisis incidents (is_crisis=true) within the last `days` window.
 * Joined to brands so the UI gets brand_slug directly.
 *
 * Default 90 days. Every `aggregate*` helper below counts these rows, so the
 * read is PAGED: PostgREST caps a single response at 1,000 rows whatever
 * `.limit()` says, and this predicate matches ~1,100 rows today — enough that
 * the un-paged version was already dropping incidents from every rollup.
 * `maxRows` stays a real ceiling on browser payload; `fetchPagedResult` logs a
 * warning naming this call site if it is ever hit.
 */
export async function fetchCrisisIncidents(opts?: {
  days?: number
  limit?: number
}): Promise<CrisisIncident[]> {
  const days = opts?.days ?? 90
  const maxRows = opts?.limit ?? 10_000
  const since = daysAgo(days).toISOString()

  const { data, ok } = await fetchPagedResult<any>(
    () => supabase
      .from('mention_facts')
      .select(
        'id,channel,source_table,source_id,brand_id,product_id,athlete_id,' +
        'sentiment_score,sentiment_label,text_snippet,posted_at,' +
        'brands!inner(slug)',
      )
      .eq('is_crisis', true)
      .gte('posted_at', since)
      .order('posted_at', { ascending: false })
      // `id` tiebreak keeps range-paging stable when timestamps collide.
      .order('id', { ascending: true }),
    { maxRows, label: 'crisis.incidents' },
  )

  if (!ok && data.length === 0) {
    if (!warnedMissing) {
      // eslint-disable-next-line no-console
      console.warn('[crisis] mention_facts unreadable — returning []')
      warnedMissing = true
    }
    return []
  }

  return data.map((r: any) => ({
    id: r.id,
    channel: r.channel,
    source_table: r.source_table,
    source_id: r.source_id,
    brand_id: r.brand_id,
    brand_slug: r.brands?.slug || '',
    product_id: r.product_id ?? null,
    athlete_id: r.athlete_id ?? null,
    sentiment_score: r.sentiment_score ?? null,
    sentiment_label: r.sentiment_label ?? null,
    text_snippet: r.text_snippet ?? null,
    posted_at: r.posted_at,
  }))
}

/**
 * Crisis count rollup per brand: total / last 7d / last 30d.
 * Derived in-memory from `fetchCrisisIncidents(days=30)` to keep the
 * pipeline tight (one network round-trip for the whole dashboard).
 */
export function aggregateByBrand(incidents: CrisisIncident[]): CrisisCountByBrand[] {
  const cutoff7 = daysAgo(7).getTime()
  const cutoff30 = daysAgo(30).getTime()
  const acc = new Map<string, CrisisCountByBrand>()

  for (const inc of incidents) {
    const slug = inc.brand_slug || 'unknown'
    if (!acc.has(slug)) {
      acc.set(slug, { brand_slug: slug, total: 0, last_7d: 0, last_30d: 0 })
    }
    const row = acc.get(slug)!
    row.total += 1
    const t = new Date(inc.posted_at).getTime()
    if (t >= cutoff7) row.last_7d += 1
    if (t >= cutoff30) row.last_30d += 1
  }

  return Array.from(acc.values()).sort((a, b) => b.last_30d - a.last_30d)
}

/**
 * Crisis count rollup per channel.
 */
export function aggregateByChannel(incidents: CrisisIncident[]): CrisisCountByChannel[] {
  const acc = new Map<string, number>()
  for (const inc of incidents) {
    acc.set(inc.channel, (acc.get(inc.channel) || 0) + 1)
  }
  return Array.from(acc.entries())
    .map(([channel, total]) => ({ channel, total }))
    .sort((a, b) => b.total - a.total)
}

/**
 * Brand × channel matrix (for heatmap cells).
 */
export function aggregateByBrandChannel(
  incidents: CrisisIncident[],
): CrisisCountByBrandChannel[] {
  const acc = new Map<string, CrisisCountByBrandChannel>()
  for (const inc of incidents) {
    const slug = inc.brand_slug || 'unknown'
    const key = `${slug}::${inc.channel}`
    if (!acc.has(key)) {
      acc.set(key, { brand_slug: slug, channel: inc.channel, count: 0 })
    }
    acc.get(key)!.count += 1
  }
  return Array.from(acc.values())
}

/**
 * Daily crisis trend over the last `days` days. Empty days are filled with 0
 * so the line chart shows a continuous spine.
 */
export function aggregateDaily(
  incidents: CrisisIncident[],
  days: number = 30,
): CrisisDailyPoint[] {
  const counts = new Map<string, number>()
  for (const inc of incidents) {
    const k = dayKey(inc.posted_at)
    if (k) counts.set(k, (counts.get(k) || 0) + 1)
  }

  const out: CrisisDailyPoint[] = []
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    const k = d.toISOString().slice(0, 10)
    out.push({ date: k, count: counts.get(k) || 0 })
  }
  return out
}

// ─── Channel display helpers ──────────────────────────────────────────

const CHANNEL_LABEL: Record<string, string> = {
  reddit: 'Reddit',
  reddit_mentions: 'Reddit (posts)',
  reddit_comments: 'Reddit (comments)',
  ig_comments: 'Instagram',
  yt_comments: 'YouTube',
  x: 'X / Twitter',
  x_posts: 'X / Twitter',
  tiktok: 'TikTok',
  tiktok_videos: 'TikTok',
  x_influencer: 'X (athletes)',
  influencer_x_posts: 'X (athletes)',
}

export function channelLabel(channel: string): string {
  return CHANNEL_LABEL[channel] || channel
}

const CHANNEL_COLOR: Record<string, string> = {
  reddit: '#ff4500',
  reddit_mentions: '#ff4500',
  reddit_comments: '#ff7849',
  ig_comments: '#e1306c',
  yt_comments: '#ff0000',
  x: '#1d9bf0',
  x_posts: '#1d9bf0',
  tiktok: '#69c9d0',
  tiktok_videos: '#69c9d0',
  x_influencer: '#a78bfa',
  influencer_x_posts: '#a78bfa',
}

export function channelColor(channel: string): string {
  return CHANNEL_COLOR[channel] || '#94a3b8'
}
