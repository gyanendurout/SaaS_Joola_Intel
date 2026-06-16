'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  fetchBrands, fetchReddit, fetchRedditTrend, fetchTopRedditMentions,
  fetchRedditViral, fetchRedditCrisisClusters,
  type V2Brand, type V2RedditRow, type V2RedditMention,
  type V2RedditViral, type V2RedditCrisisCluster,
} from '@/lib/v2/data'
import { fmt, LineChart } from '@/components/v2/charts'
import { LoadingPage, pgColor, pgName } from '@/components/v2/PageShell'
import { formatCalendarDateFromDaysAgo } from '@/lib/v2/format'

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: 'var(--wb-6)', border: '1px solid var(--wb-10)', borderRadius: 12, padding: '16px 20px', flex: 1, minWidth: 110 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || '#fff', fontFamily: 'JetBrains Mono', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

function PostCard({ m, color }: { m: V2RedditMention; color: string }) {
  return (
    <a href={m.url || `https://www.reddit.com/search/?q=${encodeURIComponent(m.title)}`} target="_blank" rel="noopener noreferrer"
      style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: 10, borderRadius: 12, padding: '14px 16px', background: 'var(--line-2)', border: '1px solid var(--wb-8)', transition: 'transform 0.18s, box-shadow 0.18s, border-color 0.18s' }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.transform = 'translateY(-3px)'; el.style.boxShadow = `0 10px 32px ${color}33`; el.style.borderColor = color + '55' }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.transform = ''; el.style.boxShadow = ''; el.style.borderColor = 'var(--wb-8)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color, background: color + '20', padding: '2px 8px', borderRadius: 4 }}>r/{m.subreddit}</span>
        <span style={{ fontSize: 10, color: 'var(--fg-4)' }}>{formatCalendarDateFromDaysAgo(m.days)}</span>
      </div>
      <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', lineHeight: 1.4, margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{m.title}</h3>
      {m.body && (
        <p style={{ fontSize: 11, color: 'var(--fg-4)', lineHeight: 1.5, margin: 0, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{m.body}</p>
      )}
      <div style={{ display: 'flex', gap: 14, paddingTop: 8, borderTop: '1px solid var(--wb-6)' }}>
        <span style={{ fontSize: 11, color: '#F5E625', fontFamily: 'JetBrains Mono', fontWeight: 700 }}>↑ {fmt(m.score)}</span>
        <span style={{ fontSize: 11, color: '#a78bfa', fontFamily: 'JetBrains Mono' }}>💬 {fmt(m.comments)}</span>
      </div>
    </a>
  )
}

export default function RedditBrandPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const brandSlug = decodeURIComponent(slug)

  const [brands, setBrands] = useState<V2Brand[]>([])
  const [redditRow, setRedditRow] = useState<V2RedditRow | null>(null)
  const [mentions, setMentions] = useState<V2RedditMention[]>([])
  const [viral, setViral] = useState<V2RedditViral[]>([])
  const [crisisClusters, setCrisisClusters] = useState<V2RedditCrisisCluster[]>([])
  const [trend, setTrend] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<'score' | 'comments' | 'days'>('score')

  useEffect(() => {
    fetchBrands().then(async (b) => {
      const [rd, tr, ment, vir, cc] = await Promise.all([
        fetchReddit(b),
        fetchRedditTrend(b),
        fetchTopRedditMentions(b, 200),
        fetchRedditViral(b, 50),
        fetchRedditCrisisClusters(b, 30),
      ])
      setBrands(b)
      setRedditRow(rd.find(r => r.brand === brandSlug) ?? null)
      setMentions(ment.filter(m => m.brand === brandSlug))
      setViral(vir.filter(v => v.brand === brandSlug))
      setCrisisClusters(cc.filter(c => c.brand === brandSlug))
      setTrend(tr[brandSlug] ?? [])
      setLoading(false)
    })
  }, [brandSlug])

  if (loading) return <LoadingPage />

  const brandName = pgName(brandSlug, brands)
  const color = pgColor(brandSlug)
  const isJ = brandSlug === 'joola'

  const sortedMentions = [...mentions].sort((a, b) =>
    sortKey === 'days' ? a.days - b.days : b[sortKey] - a[sortKey]
  )

  const total = redditRow?.mentions || 1
  const posPct = redditRow ? Math.round((redditRow.positive / total) * 100) : 0
  const negPct = redditRow ? Math.round((redditRow.negative / total) * 100) : 0
  const neuPct = 100 - posPct - negPct

  const trendSeries = trend.length > 1
    ? [{ id: brandSlug, label: brandName, color, data: trend }]
    : []
  const trendLabels = trend.map((_, i) => `W${i + 1}`)

  const subCounts: Record<string, number> = {}
  mentions.forEach(m => { if (m.subreddit) subCounts[m.subreddit] = (subCounts[m.subreddit] || 0) + 1 })
  const topSubreddits = Object.entries(subCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const subredditsUnique = Array.from(new Set(mentions.map(m => m.subreddit))).filter(Boolean)
  const maxSub = topSubreddits[0]?.[1] || 1

  const maxCrisis = crisisClusters.length > 0 ? Math.max(...crisisClusters.map(c => c.mentions)) : 1

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* Hero */}
      <div style={{ background: `linear-gradient(135deg, ${color}22 0%, rgba(13,17,23,0) 60%), linear-gradient(180deg, ${color}18 0%, var(--sticky-bg) 100%)`, borderBottom: `1px solid ${color}33`, padding: '28px 0 32px', marginBottom: 32 }}>
        <div style={{ marginBottom: 20 }}>
          <button onClick={() => router.back()} style={{ background: 'var(--line)', border: '1px solid var(--wb-12)', borderRadius: 8, padding: '6px 14px', color: 'var(--fg-3)', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>← Back</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: color, boxShadow: `0 0 28px ${color}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, color: isJ ? '#22c55e' : '#fff', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{brandName}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>Reddit · Community Intelligence</div>
            </div>
          </div>
          <a href={`https://www.reddit.com/search/?q=${encodeURIComponent(brandName)}&sort=top`} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#ff4500', borderRadius: 8, padding: '9px 18px', color: '#fff', fontWeight: 700, fontSize: 13, textDecoration: 'none', flexShrink: 0 }}>
            Search Reddit ↗
          </a>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <StatCard label="Total Mentions" value={redditRow ? String(redditRow.mentions) : '—'} sub="in tracked window" color={isJ ? '#22c55e' : color} />
          <StatCard label="Δ Mentions" value={redditRow?.delta != null ? (redditRow.delta >= 0 ? '+' : '') + String(redditRow.delta) : '—'} color={redditRow?.delta != null ? (redditRow.delta >= 0 ? '#22c55e' : '#ef4444') : undefined} />
          <StatCard label="Positive" value={redditRow?.mentions ? `${posPct}%` : '—'} color="#22c55e" sub={`${redditRow?.positive ?? 0} posts`} />
          <StatCard label="Neutral" value={redditRow?.mentions ? `${neuPct}%` : '—'} color="#94a3b8" sub={`${redditRow?.neutral ?? 0} posts`} />
          <StatCard label="Negative" value={redditRow?.mentions ? `${negPct}%` : '—'} color="#ef4444" sub={`${redditRow?.negative ?? 0} posts`} />
          <StatCard label="Posts Tracked" value={String(mentions.length)} sub="in window" />
        </div>
      </div>

      {/* Trend */}
      {trendSeries.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <div className="section-head"><h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>Mention trend</h2><div className="sub">{trend.length} weekly snapshots</div></div>
          <div className="card"><div className="card-pad"><LineChart series={trendSeries} xLabels={trendLabels} h={180} /></div></div>
        </section>
      )}

      {/* Sentiment bar */}
      {redditRow && redditRow.mentions > 0 && (
        <section style={{ marginBottom: 32 }}>
          <div className="section-head"><h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>Sentiment breakdown</h2></div>
          <div className="card"><div className="card-pad">
            <div style={{ height: 24, display: 'flex', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ width: `${posPct}%`, background: '#22c55e' }} title={`Positive ${posPct}%`} />
              <div style={{ width: `${neuPct}%`, background: '#94a3b8', opacity: 0.6 }} title={`Neutral ${neuPct}%`} />
              <div style={{ width: `${negPct}%`, background: '#ef4444' }} title={`Negative ${negPct}%`} />
            </div>
            <div style={{ display: 'flex', gap: 24 }}>
              {[
                { label: 'Positive', pct: posPct, c: '#22c55e', n: redditRow.positive },
                { label: 'Neutral', pct: neuPct, c: '#94a3b8', n: redditRow.neutral },
                { label: 'Negative', pct: negPct, c: '#ef4444', n: redditRow.negative },
              ].map(s => (
                <div key={s.label} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: s.c }} />
                  <span style={{ fontSize: 12, color: s.c, fontWeight: 700 }}>{s.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--fg-3)', fontFamily: 'JetBrains Mono' }}>{s.pct}% ({s.n})</span>
                </div>
              ))}
            </div>
          </div></div>
        </section>
      )}

      {/* Subreddits + Crisis clusters two-col */}
      {(topSubreddits.length > 0 || crisisClusters.length > 0) && (
        <section style={{ marginBottom: 32 }}>
          <div style={{ display: 'grid', gridTemplateColumns: crisisClusters.length > 0 ? '1fr 1fr' : '1fr', gap: 16 }}>
            {topSubreddits.length > 0 && (
              <div className="card"><div className="card-pad">
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>Active subreddits · {subredditsUnique.length} total</div>
                {topSubreddits.map(([sub, count]) => (
                  <div key={sub} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 12 }}>
                      <a href={`https://reddit.com/r/${sub}`} target="_blank" rel="noopener noreferrer" style={{ color: color, fontWeight: 600, textDecoration: 'none' }}>r/{sub}</a>
                      <span style={{ color: 'var(--fg-3)', fontFamily: 'JetBrains Mono' }}>{count}</span>
                    </div>
                    <div style={{ height: 5, background: 'var(--wb-5)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(count / maxSub) * 100}%`, background: color, borderRadius: 99 }} />
                    </div>
                  </div>
                ))}
              </div></div>
            )}
            {crisisClusters.length > 0 && (
              <div className="card"><div className="card-pad">
                <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>⚠ Crisis clusters · {crisisClusters.length} keywords</div>
                {crisisClusters.slice(0, 8).map((c, i) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 12 }}>
                      <span style={{ color: 'var(--fg-2)', fontWeight: 600 }}>"{c.keyword}"</span>
                      <span style={{ color: '#ef4444', fontFamily: 'JetBrains Mono', fontWeight: 700 }}>{c.mentions}</span>
                    </div>
                    <div style={{ height: 5, background: 'var(--wb-5)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(c.mentions / maxCrisis) * 100}%`, background: '#ef4444', borderRadius: 99 }} />
                    </div>
                  </div>
                ))}
              </div></div>
            )}
          </div>
        </section>
      )}

      {/* Viral posts */}
      {viral.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <div className="section-head"><h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>Viral posts · last 30 days</h2><div className="sub">{viral.length} high-velocity posts</div></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {viral.slice(0, 5).map((v, i) => (
              <a key={i} href={v.url} target="_blank" rel="noopener noreferrer"
                style={{ textDecoration: 'none', display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 14, alignItems: 'center', padding: '12px 16px', borderRadius: 10, background: 'var(--line-2)', border: `1px solid ${color}22`, transition: 'background 0.15s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${color}10` }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--line-2)' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color, background: color + '20', padding: '2px 8px', borderRadius: 4 }}>r/{v.subreddit}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.title}</span>
                <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: '#F5E625', fontFamily: 'JetBrains Mono' }}>⚡ {v.velocity.toFixed(1)}/h</span>
                  <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'JetBrains Mono' }}>↑ {fmt(v.score)}</span>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Posts grid */}
      <section>
        <div className="section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>Posts · {mentions.length} tracked</h2>
            <div className="sub">Sorted by {sortKey} · click a card to open on Reddit</div>
          </div>
          <div style={{ display: 'flex', gap: 4, background: 'var(--wb-5)', borderRadius: 8, padding: 3 }}>
            {(['score', 'comments', 'days'] as const).map(k => (
              <button key={k} onClick={() => setSortKey(k)} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: sortKey === k ? 'var(--wb-12)' : 'transparent', color: sortKey === k ? 'var(--fg)' : 'var(--fg-4)', border: 'none' }}>
                {k === 'days' ? 'Recent' : k === 'score' ? 'Score' : 'Comments'}
              </button>
            ))}
          </div>
        </div>
        {sortedMentions.length === 0 ? (
          <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)', fontSize: 13 }}>No posts tracked for this brand yet.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {sortedMentions.map((m, i) => <PostCard key={i} m={m} color={color} />)}
          </div>
        )}
      </section>
    </div>
  )
}
