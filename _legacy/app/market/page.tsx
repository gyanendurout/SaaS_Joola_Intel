'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/shared/supabase'
import { Card } from '@/components/v1/Card'
import { KPICard } from '@/components/v1/KPICard'
import { type MarketIntelItem, type BrandMentionExternal, type MarketTrend } from '@/types/market'
import { ContentGeneratorModal } from '@/components/v1/ContentGeneratorModal'
import { type DateFilterOption, DATE_FILTER_OPTIONS, getDateRange } from '@/lib/v1/dateFilter'

// ─── Date range options for Market Intel (today → last 1 year) ───────────────

const MARKET_DATE_OPTIONS = DATE_FILTER_OPTIONS.filter(o =>
  ['today', 'yesterday', 'last3days', 'thisWeek', 'thisMonth', 'thisQuarter', 'last6months', 'last1year'].includes(o.value)
)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr?: string): string {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const SOURCE_COLORS: Record<string, string> = {
  rss: 'bg-blue-500/15 text-blue-400',
  instagram: 'bg-purple-500/15 text-purple-400',
  reddit: 'bg-orange-500/15 text-orange-400',
  website: 'bg-slate-500/15 text-slate-400',
}

const SOURCE_ICON: Record<string, string> = {
  rss: '📰 RSS',
  instagram: '📸 Instagram',
  reddit: '💬 Reddit',
  website: '🌐 Website',
}

const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'bg-[#22c55e]/15 text-[#22c55e]',
  negative: 'bg-[#ef4444]/15 text-[#ef4444]',
  neutral: 'bg-[#e2e8f0]/15 text-[#e2e8f0]',
}

const COMPETITORS = [
  { slug: 'selkirk', name: 'Selkirk Sport' },
  { slug: 'paddletek', name: 'Paddletek' },
  { slug: 'crbn', name: 'CRBN Pickleball' },
  { slug: 'six-zero', name: 'Six Zero' },
  { slug: 'engage', name: 'Engage Pickleball' },
  { slug: 'onix', name: 'Onix Sports' },
  { slug: 'franklin', name: 'Franklin Pickleball' },
  { slug: 'head', name: 'Head Pickleball' },
  { slug: 'wilson', name: 'Wilson Pickleball' },
  { slug: 'gamma', name: 'Gamma Sports' },
]

// ─── Reusable date filter dropdown ──────────────────────────────────────────

function DateDropdown({ value, onChange }: { value: DateFilterOption; onChange: (v: DateFilterOption) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as DateFilterOption)}
      className="bg-[#1a1a24] border border-[#2a2a38] text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#22c55e]/50"
    >
      {MARKET_DATE_OPTIONS.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-16 text-center text-[#e2e8f0] text-sm">{message}</div>
  )
}

function IntelCard({ item, onGenerate }: { item: MarketIntelItem; onGenerate: (item: MarketIntelItem, type: 'blog_post' | 'instagram_post') => void }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`bg-[#1a1a24] border rounded-xl overflow-hidden flex flex-col ${item.is_crisis ? 'border-[#ef4444]/40' : 'border-[#2a2a38]'}`}>
      <div className="p-4 flex flex-col flex-1 gap-2">
        {/* Source badge + platform type + time */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide ${SOURCE_COLORS[item.source_type] || 'bg-[#2a2a38] text-[#e2e8f0]'}`}>
              {SOURCE_ICON[item.source_type] || item.source_type}
            </span>
            {item.source_name && item.source_name !== item.source_type && (
              <span className="text-[10px] text-[#e2e8f0]">{item.source_name}</span>
            )}
          </div>
          <span className="text-[11px] text-[#e2e8f0]">{timeAgo(item.published_at)}</span>
        </div>

        {/* Title */}
        <p className="text-sm font-semibold text-white leading-snug">{item.title || '—'}</p>

        {/* Summary with View More */}
        {item.summary && (
          <div>
            <p className={`text-xs text-[#e2e8f0] leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>{item.summary}</p>
            {item.summary.length > 120 && (
              <button
                onClick={() => setExpanded(v => !v)}
                className="text-[11px] text-[#22c55e] hover:text-[#4ade80] mt-1 font-semibold"
              >
                {expanded ? '↑ View less' : '↓ View more'}
              </button>
            )}
          </div>
        )}

        {/* Badges + link row */}
        <div className="flex flex-wrap items-center gap-1 mt-auto pt-2">
          {item.sentiment && <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${SENTIMENT_COLORS[item.sentiment]}`}>{item.sentiment}</span>}
          {item.mentions_joola && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#1a5cff]/15 text-[#5b8fff]">JOOLA</span>}
          {item.is_crisis && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#ef4444]/20 text-[#ef4444] animate-pulse">CRISIS</span>}
          {item.is_trending && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#06b6d4]/15 text-[#06b6d4]">TRENDING</span>}
          {item.is_opportunity && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#f59e0b]/15 text-[#f59e0b]">OPPORTUNITY</span>}
          {item.original_url && (
            <a
              href={item.original_url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-[11px] text-blue-400 hover:text-blue-300 hover:underline font-semibold flex items-center gap-1"
            >
              Read source →
            </a>
          )}
        </div>

        {/* Generate buttons */}
        <div className="flex gap-2 pt-1 border-t border-[#2a2a38] mt-1">
          <button
            onClick={() => onGenerate(item, 'blog_post')}
            className="flex-1 text-[11px] font-semibold py-1.5 rounded bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors"
          >
            ✍ Blog Post
          </button>
          <button
            onClick={() => onGenerate(item, 'instagram_post')}
            className="flex-1 text-[11px] font-semibold py-1.5 rounded bg-[#a855f7]/10 text-[#a855f7] hover:bg-[#a855f7]/20 transition-colors"
          >
            📸 Instagram
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Tab 1: Today's Feed ────────────────────────────────────────────────────

function TodayFeed({ onGenerate }: { onGenerate: (item: MarketIntelItem, type: 'blog_post' | 'instagram_post') => void }) {
  const [items, setItems] = useState<MarketIntelItem[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState<DateFilterOption>('thisQuarter')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [tagFilter, setTagFilter] = useState<string>('all')

  useEffect(() => {
    setLoading(true)
    const { from, to } = getDateRange(dateFilter)
    let q = supabase
      .from('market_intel_items')
      .select('*')
      .order('published_at', { ascending: false })
      .limit(100)
    if (from) q = q.gte('published_at', from)
    if (to) q = q.lt('published_at', to)
    q.then(({ data }) => { setItems(data || []); setLoading(false) })
  }, [dateFilter])

  const sources = Array.from(new Set(items.map(i => i.source_type)))

  const filtered = items.filter(item => {
    if (sourceFilter !== 'all' && item.source_type !== sourceFilter) return false
    if (tagFilter === 'joola' && !item.mentions_joola) return false
    if (tagFilter === 'crisis' && !item.is_crisis) return false
    if (tagFilter === 'opportunity' && !item.is_opportunity) return false
    return true
  })

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <DateDropdown value={dateFilter} onChange={v => { setDateFilter(v); }} />

        <div className="w-px h-5 bg-[#2a2a38]" />

        {(['all', 'joola', 'crisis', 'opportunity'] as const).map(t => (
          <button key={t} onClick={() => setTagFilter(t)}
            className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors ${tagFilter === t ? 'bg-[#22c55e]/20 text-[#22c55e]' : 'bg-[#1a1a24] text-[#e2e8f0] hover:text-white border border-[#2a2a38]'}`}>
            {t === 'all' ? 'All' : t === 'joola' ? 'JOOLA Mentions' : t === 'crisis' ? 'Crisis' : 'Opportunities'}
          </button>
        ))}

        <select
          value={sourceFilter}
          onChange={e => setSourceFilter(e.target.value)}
          className="ml-auto bg-[#1a1a24] border border-[#2a2a38] text-[#e2e8f0] text-xs rounded-lg px-3 py-1.5 focus:outline-none"
        >
          <option value="all">All Sources</option>
          {sources.map(s => <option key={s} value={s}>{SOURCE_ICON[s] || s.toUpperCase()}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-[#e2e8f0] text-sm py-20 text-center">Loading feed...</div>
      ) : filtered.length === 0 ? (
        <EmptyState message="No items found for this period. Data populates as the pipeline runs." />
      ) : (
        <>
          <p className="text-xs text-[#e2e8f0] mb-3">{filtered.length} item{filtered.length !== 1 ? 's' : ''}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map(item => <IntelCard key={item.id} item={item} onGenerate={onGenerate} />)}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Tab 2: JOOLA Mentions ──────────────────────────────────────────────────

function JoolaMentions() {
  const [items, setItems] = useState<MarketIntelItem[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState<DateFilterOption>('thisQuarter')
  const [crisisOnly, setCrisisOnly] = useState(false)

  useEffect(() => {
    setLoading(true)
    const { from, to } = getDateRange(dateFilter)
    let q = supabase
      .from('market_intel_items')
      .select('*')
      .eq('mentions_joola', true)
      .order('published_at', { ascending: false })
      .limit(100)
    if (from) q = q.gte('published_at', from)
    if (to) q = q.lt('published_at', to)
    q.then(({ data }) => { setItems(data || []); setLoading(false) })
  }, [dateFilter])

  const displayed = crisisOnly ? items.filter(i => i.is_crisis) : items

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <DateDropdown value={dateFilter} onChange={setDateFilter} />
        <button
          onClick={() => setCrisisOnly(v => !v)}
          className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors border ${crisisOnly ? 'bg-[#ef4444]/20 text-[#ef4444] border-[#ef4444]/40' : 'bg-[#1a1a24] text-[#e2e8f0] border-[#2a2a38] hover:text-white'}`}
        >
          Crisis Only
        </button>
        <span className="text-xs text-[#e2e8f0] ml-auto">{displayed.length} mention{displayed.length !== 1 ? 's' : ''}</span>
      </div>

      {loading ? (
        <div className="text-[#e2e8f0] text-sm py-20 text-center">Loading...</div>
      ) : displayed.length === 0 ? (
        <EmptyState message="No JOOLA mentions found for this period. Populates as the pipeline tags content." />
      ) : (
        <div className="space-y-3">
          {displayed.map(item => (
            <div key={item.id} className={`bg-[#1a1a24] border rounded-xl p-4 ${item.is_crisis ? 'border-[#ef4444]/40' : 'border-[#2a2a38]'}`}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${SOURCE_COLORS[item.source_type] || 'bg-[#2a2a38] text-[#e2e8f0]'}`}>
                    {SOURCE_ICON[item.source_type] || item.source_type}
                  </span>
                  {item.joola_sentiment && <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${SENTIMENT_COLORS[item.joola_sentiment]}`}>{item.joola_sentiment}</span>}
                  {item.is_crisis && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#ef4444]/20 text-[#ef4444] animate-pulse">CRISIS</span>}
                </div>
                <span className="text-[11px] text-[#e2e8f0] whitespace-nowrap">{formatDate(item.published_at)}</span>
              </div>
              <p className="text-sm font-semibold text-white mb-2">{item.title || '—'}</p>
              {item.joola_context && (
                <div className="bg-[#22c55e]/5 border border-[#22c55e]/20 rounded-lg px-3 py-2 mb-2">
                  <p className="text-xs text-[#e4e4e7] leading-relaxed">{item.joola_context}</p>
                </div>
              )}
              {item.original_url && (
                <a href={item.original_url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">Read source →</a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Tab 3: Competitor Intel ─────────────────────────────────────────────────

function CompetitorIntel() {
  const [selected, setSelected] = useState(COMPETITORS[0].slug)
  const [dateFilter, setDateFilter] = useState<DateFilterOption>('thisQuarter')
  const [mentions, setMentions] = useState<BrandMentionExternal[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (slug: string, df: DateFilterOption) => {
    setLoading(true)
    const { from, to } = getDateRange(df)
    let q = supabase
      .from('brand_mentions_external')
      .select('*, market_intel_items(original_url, source_type)')
      .eq('brand_slug', slug)
      .order('published_at', { ascending: false })
      .limit(100)
    if (from) q = q.gte('published_at', from)
    if (to) q = q.lt('published_at', to)
    const { data } = await q
    setMentions((data || []).map((m: any) => ({
      ...m,
      source_url: m.market_intel_items?.original_url,
      source_type: m.source_type || m.market_intel_items?.source_type,
    })))
    setLoading(false)
  }, [])

  useEffect(() => { load(selected, dateFilter) }, [selected, dateFilter, load])

  const total = mentions.length
  const positive = mentions.filter(m => m.sentiment === 'positive').length
  const negative = mentions.filter(m => m.sentiment === 'negative').length
  const crisis = mentions.filter(m => m.context_type === 'crisis').length
  const avgReach = mentions.length ? Math.round(mentions.reduce((s, m) => s + (m.reach_estimate || 0), 0) / mentions.length) : 0

  const CONTEXT_COLORS: Record<string, string> = {
    positive_press: 'bg-[#22c55e]/15 text-[#22c55e]',
    neutral: 'bg-[#e2e8f0]/15 text-[#e2e8f0]',
    negative: 'bg-[#ef4444]/15 text-[#ef4444]',
    crisis: 'bg-[#ef4444]/20 text-[#ef4444]',
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="text-xs text-[#e2e8f0] font-semibold">Competitor:</label>
        <select
          value={selected}
          onChange={e => setSelected(e.target.value)}
          className="bg-[#1a1a24] border border-[#2a2a38] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#22c55e]/50"
        >
          {COMPETITORS.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <DateDropdown value={dateFilter} onChange={setDateFilter} />
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <KPICard label="Total Mentions" value={total} />
        <KPICard label="Positive" value={positive} />
        <KPICard label="Negative" value={negative} />
        <KPICard label="Crisis" value={crisis} />
        <KPICard label="Avg Reach" value={avgReach > 0 ? avgReach.toLocaleString() : '—'} />
      </div>

      {loading ? (
        <div className="text-[#e2e8f0] text-sm py-20 text-center">Loading...</div>
      ) : mentions.length === 0 ? (
        <EmptyState message="No mentions found for this competitor in the selected period." />
      ) : (
        <Card title={`${COMPETITORS.find(c => c.slug === selected)?.name} — ${total} mention${total !== 1 ? 's' : ''}`}>
          <div className="space-y-3">
            {mentions.map(m => (
              <div key={m.id} className="border-b border-[#2a2a38]/50 pb-3 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${SOURCE_COLORS[m.source_type || ''] || 'bg-[#2a2a38] text-[#e2e8f0]'}`}>
                      {SOURCE_ICON[m.source_type || ''] || m.source_name || '—'}
                    </span>
                    {m.context_type && <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${CONTEXT_COLORS[m.context_type] || CONTEXT_COLORS.neutral}`}>{m.context_type.replace('_', ' ').toUpperCase()}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    {m.reach_estimate ? <span className="text-[11px] text-[#e2e8f0]">~{m.reach_estimate.toLocaleString()} reach</span> : null}
                    <span className="text-[11px] text-[#e2e8f0]">{formatDate(m.published_at)}</span>
                  </div>
                </div>
                {m.context_snippet && <p className="text-xs text-[#e4e4e7] leading-relaxed mb-1.5">{m.context_snippet}</p>}
                {m.source_url && (
                  <a href={m.source_url} target="_blank" rel="noreferrer" className="text-[11px] text-blue-400 hover:underline">
                    Read source →
                  </a>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

// ─── Tab 4: Trends ───────────────────────────────────────────────────────────

function Trends() {
  const [trends, setTrends] = useState<MarketTrend[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const now = new Date()
    supabase
      .from('market_trends')
      .select('*')
      .eq('year', now.getFullYear())
      .order('mention_count', { ascending: false })
      .limit(50)
      .then(({ data }) => { setTrends(data || []); setLoading(false) })
  }, [])

  if (loading) return <div className="text-[#e2e8f0] text-sm py-20 text-center">Loading...</div>

  return (
    <div>
      {/* Explanation */}
      <div className="bg-[#1a1a24] border border-[#2a2a38] rounded-xl p-4 mb-5">
        <p className="text-xs font-bold text-white mb-1 uppercase tracking-wide">What am I looking at?</p>
        <p className="text-xs text-[#e2e8f0] leading-relaxed">
          This shows the <span className="text-white">most-discussed keywords and topics</span> across pickleball content (news, social, forums) for {new Date().getFullYear()}.
          Each row is a keyword the pipeline detected in multiple sources. The <span className="text-white">bar shows relative volume</span> — how often that keyword appeared compared to the top trend.
          <span className="text-[#22c55e]"> Green border = JOOLA-relevant</span> (the topic directly relates to JOOLA's business).
          <span className="text-[#f59e0b]"> Amber badge</span> = pipeline flagged an opportunity (e.g. a content gap or sponsorship angle).
          Brand chips show which competitors are also mentioned alongside this keyword.
        </p>
      </div>

      {trends.length === 0 ? (
        <EmptyState message="No trend data yet. Populates after the first weekly pipeline run with trend analysis." />
      ) : (
        <div className="space-y-2">
          {(() => {
            const max = Math.max(...trends.map(x => x.mention_count), 1)
            return trends.map((t, idx) => (
              <div key={t.id} className={`bg-[#1a1a24] border rounded-xl p-4 ${t.is_joola_relevant ? 'border-l-2 border-l-[#22c55e] border-[#2a2a38]' : 'border-[#2a2a38]'}`}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold text-[#e2e8f0] w-6">#{idx + 1}</span>
                    <span className="font-semibold text-white text-sm">{t.keyword}</span>
                    {t.is_joola_relevant && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#22c55e]/15 text-[#22c55e]">JOOLA RELEVANT</span>}
                    {t.sentiment && <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${SENTIMENT_COLORS[t.sentiment] || SENTIMENT_COLORS.neutral}`}>{t.sentiment}</span>}
                    {t.opportunity_type && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#f59e0b]/15 text-[#f59e0b]">{t.opportunity_type}</span>}
                  </div>
                  <span className="text-xs text-[#e2e8f0] whitespace-nowrap font-semibold">{t.mention_count.toLocaleString()} mentions</span>
                </div>
                <div className="w-full bg-[#0f0f13] rounded-full h-1.5 mb-2">
                  <div
                    className={`h-1.5 rounded-full ${t.is_joola_relevant ? 'bg-[#22c55e]' : 'bg-[#06b6d4]'}`}
                    style={{ width: `${(t.mention_count / max) * 100}%` }}
                  />
                </div>
                {t.brands_associated && t.brands_associated.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    <span className="text-[10px] text-[#e2e8f0] mr-1">Also discussed with:</span>
                    {t.brands_associated.map(b => (
                      <span key={b} className="text-[10px] px-2 py-0.5 rounded bg-[#2a2a38] text-[#e2e8f0]">{b}</span>
                    ))}
                  </div>
                )}
              </div>
            ))
          })()}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

type Tab = 'feed' | 'joola' | 'competitor' | 'trends'

const TABS: { id: Tab; label: string }[] = [
  { id: 'feed', label: 'Intel Feed' },
  { id: 'joola', label: 'JOOLA Mentions' },
  { id: 'competitor', label: 'Competitor Intel' },
  { id: 'trends', label: 'Trends' },
]

export default function MarketIntelPage() {
  const [tab, setTab] = useState<Tab>('feed')
  const [modal, setModal] = useState<{ item: MarketIntelItem; type: 'blog_post' | 'instagram_post' } | null>(null)

  const handleGenerate = useCallback((item: MarketIntelItem, type: 'blog_post' | 'instagram_post') => {
    setModal({ item, type })
  }, [])

  return (
    <div className="max-w-[1100px]">
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-white">Market Intel</h1>
        <p className="text-xs text-[#e2e8f0] mt-1">Live intelligence feed — news, social signals, competitor moves, and trend analysis.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 bg-[#13131a] border border-[#2a2a38] rounded-xl p-1">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 text-sm font-semibold py-2 rounded-lg transition-all ${
              tab === t.id ? 'bg-[#22c55e]/15 text-[#22c55e]' : 'text-[#e2e8f0] hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'feed' && <TodayFeed onGenerate={handleGenerate} />}
      {tab === 'joola' && <JoolaMentions />}
      {tab === 'competitor' && <CompetitorIntel />}
      {tab === 'trends' && <Trends />}

      {modal && (
        <ContentGeneratorModal
          item={modal.item}
          contentType={modal.type}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
