'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { fetchBrands, fetchX, fetchTopXPosts, type V2Brand, type V2XRow, type V2XPost } from '@/lib/v2/data'
import { fmt, LineChart } from '@/components/v2/charts'
import { LoadingPage, pgColor, pgName } from '@/components/v2/PageShell'
import { formatCalendarDateFromDaysAgo } from '@/lib/v2/format'
import { Breadcrumb } from '@/components/v2/Breadcrumb'

const X_HANDLES: Record<string, string> = {
  joola: 'JOOLApickleball', selkirk: 'SelkirkSport', crbn: 'CRBNPickleball',
  paddletek: 'Paddletek', 'six-zero': 'SixZeroPB', engage: 'EngagePickleball',
  onix: 'ONIXPickleball', franklin: 'FranklinSports', head: 'HEADPickleball',
  wilson: 'WilsonSportingGoods', gamma: 'GammaSports',
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: 'var(--wb-6)', border: '1px solid var(--wb-10)', borderRadius: 12, padding: '16px 20px', flex: 1, minWidth: 110 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || '#fff', fontFamily: 'JetBrains Mono', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

function TweetCard({ p, color }: { p: V2XPost; color: string }) {
  return (
    <a href={p.post_url || `https://x.com/search?q=${encodeURIComponent(p.text.slice(0, 40))}`}
      target="_blank" rel="noopener noreferrer"
      style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: 12, borderRadius: 12, padding: '16px 18px', background: 'var(--line-2)', border: '1px solid var(--wb-8)', transition: 'transform 0.18s, box-shadow 0.18s, border-color 0.18s' }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.transform = 'translateY(-3px)'; el.style.boxShadow = `0 10px 32px ${color}33`; el.style.borderColor = color + '55' }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.transform = ''; el.style.boxShadow = ''; el.style.borderColor = 'var(--wb-8)' }}>
      {/* X logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill={color}><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.26 5.632 5.903-5.632z"/></svg>
        <span style={{ fontSize: 10, color: 'var(--fg-4)' }}>{formatCalendarDateFromDaysAgo(p.days)}</span>
      </div>
      <p style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.55, margin: 0, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.text}</p>
      <div style={{ display: 'flex', gap: 16, marginTop: 'auto', paddingTop: 8, borderTop: '1px solid var(--wb-6)' }}>
        <span style={{ fontSize: 11, color: '#f97316', fontFamily: 'JetBrains Mono', fontWeight: 700 }}>♥ {fmt(p.likes)}</span>
        <span style={{ fontSize: 11, color: '#22c55e', fontFamily: 'JetBrains Mono' }}>🔁 {fmt(p.retweets)}</span>
        <span style={{ fontSize: 11, color: '#a78bfa', fontFamily: 'JetBrains Mono' }}>💬 {fmt(p.replies)}</span>
        {p.views > 0 && <span style={{ fontSize: 11, color: '#F5E625', fontFamily: 'JetBrains Mono' }}>👁 {fmt(p.views)}</span>}
      </div>
    </a>
  )
}

export default function TwitterBrandPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const brandSlug = decodeURIComponent(slug)

  const [brands, setBrands] = useState<V2Brand[]>([])
  const [xRow, setXRow] = useState<V2XRow | null>(null)
  const [posts, setPosts] = useState<V2XPost[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<'likes' | 'retweets' | 'replies' | 'views' | 'days'>('likes')

  useEffect(() => {
    fetchBrands().then(async (b) => {
      const [xData, p] = await Promise.all([fetchX(b), fetchTopXPosts(b, 500)])
      setBrands(b)
      setXRow(xData.find(r => r.brand === brandSlug) ?? null)
      setPosts(p.filter(v => v.brand === brandSlug))
      setLoading(false)
    })
  }, [brandSlug])

  if (loading) return <LoadingPage />

  const brandName = pgName(brandSlug, brands)
  const color = pgColor(brandSlug)
  const isJ = brandSlug === 'joola'
  const handle = X_HANDLES[brandSlug] || xRow?.handle

  const sortedPosts = [...posts].sort((a, b) =>
    sortKey === 'days' ? a.days - b.days : b[sortKey] - a[sortKey]
  )

  const totalLikes    = posts.reduce((s, p) => s + p.likes, 0)
  const totalRetweets = posts.reduce((s, p) => s + p.retweets, 0)
  const totalReplies  = posts.reduce((s, p) => s + p.replies, 0)
  const totalViews    = posts.reduce((s, p) => s + p.views, 0)
  const topPost = [...posts].sort((a, b) => b.likes - a.likes)[0]

  const trendSeries = xRow && xRow.trend.length > 1
    ? [{ id: brandSlug, label: brandName, color, data: xRow.trend }]
    : []
  const trendLabels = (xRow?.trend ?? []).map((_, i) => `W${i + 1}`)

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* Hero */}
      <div style={{ background: `linear-gradient(135deg, ${color}22 0%, rgba(13,17,23,0) 60%), linear-gradient(180deg, ${color}18 0%, var(--sticky-bg) 100%)`, borderBottom: `1px solid ${color}33`, padding: '28px 0 32px', marginBottom: 32 }}>
        <div style={{ marginBottom: 20 }}>
          <Breadcrumb crumbs={[
            { label: 'X / Twitter', href: '/v2/twitter' },
            { label: brandName },
          ]} />
          <button onClick={() => router.back()} style={{ background: 'var(--line)', border: '1px solid var(--wb-12)', borderRadius: 8, padding: '6px 14px', color: 'var(--fg-3)', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>← Back</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: color, boxShadow: `0 0 28px ${color}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.26 5.632 5.903-5.632z"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, color: isJ ? '#22c55e' : '#fff', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{brandName}</div>
              {handle && <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>@{handle} · X / Twitter</div>}
            </div>
          </div>
          {handle && (
            <a href={`https://x.com/${handle}`} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#000', border: '1px solid var(--wb-14)', borderRadius: 8, padding: '9px 18px', color: '#fff', fontWeight: 700, fontSize: 13, textDecoration: 'none', flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.26 5.632 5.903-5.632z"/></svg>
              View Profile ↗
            </a>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <StatCard label="Followers" value={xRow?.followers ? fmt(xRow.followers) : '—'} sub="current snapshot" color={isJ ? '#22c55e' : color} />
          <StatCard label="Following" value={xRow?.following ? fmt(xRow.following) : '—'} sub="accounts followed" />
          <StatCard label="Flw Growth (wk)" value={xRow?.delta != null ? (xRow.delta >= 0 ? '+' : '') + fmt(xRow.delta) : '—'} color={xRow?.delta != null ? (xRow.delta >= 0 ? '#22c55e' : '#ef4444') : undefined} />
          <StatCard label="Tweets" value={xRow?.tweets ? String(xRow.tweets) : '—'} sub="total tweets" />
          <StatCard label="Eng Rate" value={xRow?.engRate ? xRow.engRate.toFixed(2) + '%' : '—'} color={xRow?.engRate && xRow.engRate > 3 ? '#22c55e' : xRow?.engRate && xRow.engRate > 1 ? '#F5E625' : '#ef4444'} />
          <StatCard label="Posts Tracked" value={String(posts.length)} sub="in window" />
        </div>
      </div>

      {/* Trend */}
      {trendSeries.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <div className="section-head"><h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>Follower growth trend</h2><div className="sub">{xRow!.trend.length} weekly snapshots</div></div>
          <div className="card"><div className="card-pad"><LineChart series={trendSeries} xLabels={trendLabels} h={180} /></div></div>
        </section>
      )}

      {/* Top performer highlight */}
      {topPost && (
        <section style={{ marginBottom: 32 }}>
          <div className="section-head"><h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>Best performing post</h2></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            {[{ label: '♥ Total Likes', val: fmt(totalLikes), c: '#f97316' }, { label: '🔁 Total Retweets', val: fmt(totalRetweets), c: '#22c55e' }, { label: '💬 Total Replies', val: fmt(totalReplies), c: '#a78bfa' }, { label: '👁 Total Views', val: totalViews > 0 ? fmt(totalViews) : '—', c: '#F5E625' }].map(({ label, val, c }) => (
              <div key={label} style={{ background: 'var(--line-2)', border: `1px solid ${c}22`, borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 10, color: 'var(--fg-4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: c, fontFamily: 'JetBrains Mono' }}>{val}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Posts grid */}
      <section>
        <div className="section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>Posts · {posts.length} tracked</h2>
            <div className="sub">Sorted by {sortKey} · click a card to open on X</div>
          </div>
          <div style={{ display: 'flex', gap: 4, background: 'var(--wb-5)', borderRadius: 8, padding: 3 }}>
            {(['likes', 'retweets', 'replies', 'views', 'days'] as const).map(k => (
              <button key={k} onClick={() => setSortKey(k)} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: sortKey === k ? 'var(--wb-12)' : 'transparent', color: sortKey === k ? 'var(--fg)' : 'var(--fg-4)', border: 'none' }}>
                {k === 'days' ? 'Recent' : k.charAt(0).toUpperCase() + k.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {sortedPosts.length === 0 ? (
          <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)', fontSize: 13 }}>No posts tracked for this brand yet.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {sortedPosts.map((p, i) => <TweetCard key={i} p={p} color={color} />)}
          </div>
        )}
      </section>
    </div>
  )
}
