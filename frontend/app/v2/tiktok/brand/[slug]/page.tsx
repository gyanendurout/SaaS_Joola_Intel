'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  fetchBrands, fetchTikTok, fetchTopTikTokVideos, fetchTikTokCommentStats,
  fetchTikTokPaddleMentions, fetchTikTokTrend,
  type V2Brand, type V2TikTokRow, type V2TikTokVideo,
  type V2TikTokCommentStats, type V2TikTokPaddleMention,
} from '@/lib/v2/data'
import { fmt, LineChart } from '@/components/v2/charts'
import { LoadingPage, pgColor, pgName } from '@/components/v2/PageShell'
import { formatCalendarDateFromDaysAgo } from '@/lib/v2/format'

const TIKTOK_HANDLES: Record<string, string> = {
  joola: 'joolapickleball', selkirk: 'selkirksport', crbn: 'crbnpickleball',
  paddletek: 'paddletek', 'six-zero': 'sixzeropickleball', engage: 'engage_pickleball',
  onix: 'onix_pickleball', franklin: 'franklinsports', head: 'headpickleball',
  wilson: 'wilsonsportinggoods', gamma: 'gammasports',
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: '16px 20px', flex: 1, minWidth: 110 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || '#fff', fontFamily: 'JetBrains Mono', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

function VideoCard({ v, color }: { v: V2TikTokVideo; color: string }) {
  return (
    <a href={v.video_url || `https://www.tiktok.com/@${v.handle}`} target="_blank" rel="noopener noreferrer"
      style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: 10, borderRadius: 12, padding: '14px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', transition: 'transform 0.18s, box-shadow 0.18s, border-color 0.18s' }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.transform = 'translateY(-3px)'; el.style.boxShadow = `0 10px 32px ${color}33`; el.style.borderColor = color + '55' }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.transform = ''; el.style.boxShadow = ''; el.style.borderColor = 'rgba(255,255,255,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill={color}><path d="M19.59 6.69a4.83 4.83 0 01-3.77-2.47 12 12 0 00-11.64 0A4.83 4.83 0 01.41 6.69 49.11 49.11 0 000 12a49.11 49.11 0 00.41 5.31 4.83 4.83 0 003.77 2.47 12 12 0 0011.64 0 4.83 4.83 0 003.77-2.47A49.11 49.11 0 0024 12a49.11 49.11 0 00-.41-5.31zM9.75 15.02V8.98l6 3.02z"/></svg>
        <span style={{ fontSize: 10, color: 'var(--fg-4)' }}>{formatCalendarDateFromDaysAgo(v.days)}</span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--fg)', lineHeight: 1.5, margin: 0, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{v.text || '—'}</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ fontSize: 11, color: '#F5E625', fontFamily: 'JetBrains Mono', fontWeight: 700 }}>👁 {fmt(v.views)}</span>
        <span style={{ fontSize: 11, color: '#f97316', fontFamily: 'JetBrains Mono' }}>♥ {fmt(v.likes)}</span>
        <span style={{ fontSize: 11, color: '#a78bfa', fontFamily: 'JetBrains Mono' }}>💬 {fmt(v.comments)}</span>
        <span style={{ fontSize: 11, color: '#34d399', fontFamily: 'JetBrains Mono' }}>↗ {fmt(v.shares)}</span>
      </div>
    </a>
  )
}

export default function TikTokBrandPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const brandSlug = decodeURIComponent(slug)

  const [brands, setBrands] = useState<V2Brand[]>([])
  const [ttRow, setTtRow] = useState<V2TikTokRow | null>(null)
  const [videos, setVideos] = useState<V2TikTokVideo[]>([])
  const [commentStats, setCommentStats] = useState<V2TikTokCommentStats | null>(null)
  const [paddleMentions, setPaddleMentions] = useState<V2TikTokPaddleMention[]>([])
  const [trend, setTrend] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<'views' | 'likes' | 'comments' | 'shares' | 'days'>('views')

  useEffect(() => {
    fetchBrands().then(async (b) => {
      const [ttData, vids, cs, pm, tr] = await Promise.all([
        fetchTikTok(b),
        fetchTopTikTokVideos(b, 500),
        fetchTikTokCommentStats(b),
        fetchTikTokPaddleMentions(b, 50),
        fetchTikTokTrend(b),
      ])
      setBrands(b)
      setTtRow(ttData.find(r => r.brand === brandSlug) ?? null)
      setVideos(vids.filter(v => v.brand === brandSlug))
      setCommentStats(cs.find(c => c.brand === brandSlug) ?? null)
      setPaddleMentions(pm.filter(p => p.brand === brandSlug))
      setTrend(tr[brandSlug] ?? [])
      setLoading(false)
    })
  }, [brandSlug])

  if (loading) return <LoadingPage />

  const brandName = pgName(brandSlug, brands)
  const color = pgColor(brandSlug)
  const isJ = brandSlug === 'joola'
  const handle = TIKTOK_HANDLES[brandSlug] || ttRow?.handle

  const sortedVideos = [...videos].sort((a, b) =>
    sortKey === 'days' ? a.days - b.days : b[sortKey] - a[sortKey]
  )

  const trendSeries = trend.length > 1
    ? [{ id: brandSlug, label: brandName, color, data: trend }]
    : []
  const trendLabels = trend.map((_, i) => `W${i + 1}`)

  const topByViews    = [...videos].sort((a, b) => b.views - a.views)[0]
  const topByLikes    = [...videos].sort((a, b) => b.likes - a.likes)[0]
  const topByShares   = [...videos].sort((a, b) => b.shares - a.shares)[0]

  const totalComments = commentStats?.total ?? 0
  const sentPos = totalComments > 0 ? Math.round(((commentStats?.positive ?? 0) / totalComments) * 100) : 0
  const sentNeg = totalComments > 0 ? Math.round(((commentStats?.negative ?? 0) / totalComments) * 100) : 0
  const sentNeu = 100 - sentPos - sentNeg

  const maxPaddle = paddleMentions.length > 0 ? Math.max(...paddleMentions.map(p => p.mentions)) : 1

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* Hero */}
      <div style={{ background: `linear-gradient(135deg, ${color}22 0%, rgba(13,17,23,0) 60%), linear-gradient(180deg, ${color}18 0%, rgba(13,17,23,0.95) 100%)`, borderBottom: `1px solid ${color}33`, padding: '28px 0 32px', marginBottom: 32 }}>
        <div style={{ marginBottom: 20 }}>
          <button onClick={() => router.back()} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '6px 14px', color: 'var(--fg-3)', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>← Back</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: color, boxShadow: `0 0 28px ${color}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-2.47 12 12 0 00-11.64 0A4.83 4.83 0 01.41 6.69 49.11 49.11 0 000 12a49.11 49.11 0 00.41 5.31 4.83 4.83 0 003.77 2.47 12 12 0 0011.64 0 4.83 4.83 0 003.77-2.47A49.11 49.11 0 0024 12a49.11 49.11 0 00-.41-5.31zM9.75 15.02V8.98l6 3.02z"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, color: isJ ? '#22c55e' : '#fff', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{brandName}</div>
              {handle && <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>@{handle} · TikTok</div>}
            </div>
          </div>
          {handle && (
            <a href={`https://www.tiktok.com/@${handle}`} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#000', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, padding: '9px 18px', color: '#fff', fontWeight: 700, fontSize: 13, textDecoration: 'none', flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-2.47 12 12 0 00-11.64 0A4.83 4.83 0 01.41 6.69 49.11 49.11 0 000 12a49.11 49.11 0 00.41 5.31 4.83 4.83 0 003.77 2.47 12 12 0 0011.64 0 4.83 4.83 0 003.77-2.47A49.11 49.11 0 0024 12a49.11 49.11 0 00-.41-5.31zM9.75 15.02V8.98l6 3.02z"/></svg>
              View Profile ↗
            </a>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <StatCard label="Followers" value={ttRow?.followers ? fmt(ttRow.followers) : '—'} sub="current snapshot" color={isJ ? '#22c55e' : color} />
          <StatCard label="Flw Growth (wk)" value={ttRow?.delta != null ? (ttRow.delta >= 0 ? '+' : '') + fmt(ttRow.delta) : '—'} color={ttRow?.delta != null ? (ttRow.delta >= 0 ? '#22c55e' : '#ef4444') : undefined} />
          <StatCard label="Total Videos" value={ttRow?.videos ? String(ttRow.videos) : '—'} sub="all uploads" />
          <StatCard label="Total Hearts" value={ttRow?.totalHearts ? fmt(ttRow.totalHearts) : '—'} color="#f97316" />
          <StatCard label="Avg Views/Video" value={ttRow?.avgViews ? fmt(ttRow.avgViews) : '—'} color="#F5E625" />
          <StatCard label="Videos Tracked" value={String(videos.length)} sub="in window" />
        </div>
      </div>

      {/* Trend */}
      {trendSeries.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <div className="section-head"><h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>Follower growth trend</h2><div className="sub">{trend.length} weekly snapshots</div></div>
          <div className="card"><div className="card-pad"><LineChart series={trendSeries} xLabels={trendLabels} h={180} /></div></div>
        </section>
      )}

      {/* Top performers */}
      {videos.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <div className="section-head"><h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>Top performers</h2></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {[
              { label: '👁 Most Viewed', video: topByViews, val: fmt(topByViews?.views), c: '#F5E625' },
              { label: '♥ Most Liked', video: topByLikes, val: fmt(topByLikes?.likes), c: '#f97316' },
              { label: '↗ Most Shared', video: topByShares, val: fmt(topByShares?.shares), c: '#34d399' },
            ].map(({ label, video, val, c }) => video ? (
              <a key={label} href={video.video_url || '#'} target="_blank" rel="noopener noreferrer"
                style={{ textDecoration: 'none', background: 'rgba(255,255,255,0.04)', border: `1px solid ${c}22`, borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, transition: 'transform 0.15s, box-shadow 0.15s' }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.transform = 'translateY(-3px)'; el.style.boxShadow = `0 8px 28px ${c}22` }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.transform = ''; el.style.boxShadow = '' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: c, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{video.text}</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: c, fontFamily: 'JetBrains Mono' }}>{val}</span>
              </a>
            ) : null)}
          </div>
        </section>
      )}

      {/* Sentiment + Paddle mentions */}
      {(commentStats || paddleMentions.length > 0) && (
        <section style={{ marginBottom: 32 }}>
          <div style={{ display: 'grid', gridTemplateColumns: paddleMentions.length > 0 ? '1fr 1fr' : '1fr', gap: 16 }}>
            {commentStats && totalComments > 0 && (
              <div className="card"><div className="card-pad">
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Comment sentiment · {fmt(totalComments)} comments</div>
                {[{ label: 'Positive', pct: sentPos, color: '#22c55e' }, { label: 'Neutral', pct: sentNeu, color: '#94a3b8' }, { label: 'Negative', pct: sentNeg, color: '#ef4444' }].map(s => (
                  <div key={s.label} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 12 }}>
                      <span style={{ color: s.color, fontWeight: 700 }}>{s.label}</span>
                      <span style={{ color: 'var(--fg-3)', fontFamily: 'JetBrains Mono' }}>{s.pct}%</span>
                    </div>
                    <div style={{ height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${s.pct}%`, background: s.color, borderRadius: 99, transition: 'width 0.5s ease' }} />
                    </div>
                  </div>
                ))}
              </div></div>
            )}
            {paddleMentions.length > 0 && (
              <div className="card"><div className="card-pad">
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Paddle mentions in TikTok comments</div>
                {paddleMentions.slice(0, 8).map((p, i) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                      <span style={{ color: 'var(--fg-2)', fontWeight: 600 }}>{p.paddle}</span>
                      <span style={{ color, fontFamily: 'JetBrains Mono', fontWeight: 700 }}>{p.mentions}</span>
                    </div>
                    <div style={{ height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(p.mentions / maxPaddle) * 100}%`, background: color, borderRadius: 99 }} />
                    </div>
                  </div>
                ))}
              </div></div>
            )}
          </div>
        </section>
      )}

      {/* Video grid */}
      <section>
        <div className="section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>Videos · {videos.length} tracked</h2>
            <div className="sub">Sorted by {sortKey} · click a card to open on TikTok</div>
          </div>
          <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 3 }}>
            {(['views', 'likes', 'comments', 'shares', 'days'] as const).map(k => (
              <button key={k} onClick={() => setSortKey(k)} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: sortKey === k ? 'rgba(255,255,255,0.12)' : 'transparent', color: sortKey === k ? 'var(--fg)' : 'var(--fg-4)', border: 'none' }}>
                {k === 'days' ? 'Recent' : k.charAt(0).toUpperCase() + k.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {sortedVideos.length === 0 ? (
          <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)', fontSize: 13 }}>No videos tracked for this brand yet.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
            {sortedVideos.map((v, i) => <VideoCard key={i} v={v} color={color} />)}
          </div>
        )}
      </section>
    </div>
  )
}
