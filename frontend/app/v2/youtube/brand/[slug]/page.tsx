'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  fetchBrands, fetchYT, fetchTopYTVideos, fetchYTVideoAnalysis, fetchYTTrend,
  type V2Brand, type V2YTRow, type V2TopYTVideo, type V2YTVideoAnalysis,
} from '@/lib/v2/data'
import { fmt, LineChart, Donut } from '@/components/v2/charts'
import { LoadingPage, pgColor, pgName } from '@/components/v2/PageShell'
import { StatCard } from '@/components/v2/StatCard'
import { BackButton } from '@/components/v2/BackButton'
import { formatCalendarDateFromDaysAgo } from '@/lib/v2/format'
import { Breadcrumb } from '@/components/v2/Breadcrumb'
import { useReveal, revealCls } from '@/lib/v2/animations'

const YT_HANDLES: Record<string, string> = {
  joola: 'joolapickleball', selkirk: 'SelkirkSport', crbn: 'CRBNPickleball',
  franklin: 'FranklinSports', engage: 'EngagePickleball', paddletek: 'Paddletek',
  'six-zero': 'sixzeropickleball', onix: 'OnixPickleball', wilson: 'WilsonSportingGoods',
  gamma: 'GammaSports', head: 'HEADPickleball',
}

function AnalysisRow({ a, color }: { a: V2YTVideoAnalysis; color: string }) {
  return (
    <div title={a.performanceThesis || undefined}
      style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'start', padding: '10px 12px', borderRadius: 8, background: 'var(--wb-3)', border: '1px solid var(--wb-6)', cursor: 'help' }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', marginBottom: 4, lineHeight: 1.35 }}>
          {a.url
            ? <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }} onClick={e => e.stopPropagation()}>{a.title.slice(0, 72)}{a.title.length > 72 ? '…' : ''}</a>
            : a.title.slice(0, 72)}
        </div>
        {a.performanceThesis && (
          <div style={{ fontSize: 11, color: 'var(--fg-3)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {a.performanceThesis}
          </div>
        )}
        {a.productsMentioned.length > 0 && (
          <div style={{ marginTop: 6, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {a.productsMentioned.slice(0, 4).map(p => (
              <span key={p} style={{ fontSize: 9, padding: '2px 7px', borderRadius: 4, background: color + '18', color, border: `1px solid ${color}33`, fontWeight: 600 }}>{p}</span>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#F5E625', fontFamily: 'JetBrains Mono' }}>{fmt(a.views)}</span>
        {a.contentType && (
          <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 4, background: 'var(--wb-6)', color: 'var(--fg-3)', fontWeight: 600, whiteSpace: 'nowrap' }}>{a.contentType}</span>
        )}
      </div>
    </div>
  )
}

function VideoCard({ v, color }: { v: V2TopYTVideo; color: string }) {
  const [imgErr, setImgErr] = useState(false)
  const thumbUrl = v.video_id && !imgErr
    ? `https://img.youtube.com/vi/${v.video_id}/mqdefault.jpg`
    : null
  const watchHref = v.url || (v.video_id
    ? `https://www.youtube.com/watch?v=${v.video_id}`
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(v.title)}`)
  const likeRatio = v.views > 0 ? ((v.likes / v.views) * 100).toFixed(2) : '0'
  return (
    <a href={watchHref} target="_blank" rel="noopener noreferrer"
      style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', borderRadius: 12, overflow: 'hidden', background: 'var(--line-2)', border: '1px solid var(--wb-8)', transition: 'transform 0.18s, box-shadow 0.18s, border-color 0.18s', cursor: 'pointer' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)'; (e.currentTarget as HTMLElement).style.boxShadow = `0 12px 40px ${color}33`; (e.currentTarget as HTMLElement).style.borderColor = color + '55' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; (e.currentTarget as HTMLElement).style.borderColor = 'var(--wb-8)' }}
    >
      {/* Thumbnail */}
      <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%', background: 'var(--wb-3)', flexShrink: 0 }}>
        {thumbUrl ? (
          <img src={thumbUrl} alt={v.title} onError={() => setImgErr(true)}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill={color} opacity={0.3}><path d="M10 16.5l6-4.5-6-4.5v9zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>
          </div>
        )}
        {/* Duration pill */}
        <div style={{ position: 'absolute', bottom: 6, right: 6, background: 'rgba(0,0,0,0.82)', borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 700, color: '#fff', fontFamily: 'JetBrains Mono' }}>
          {v.is_short ? 'SHORT' : v.duration}
        </div>
        {v.is_short && (
          <div style={{ position: 'absolute', top: 6, left: 6, background: '#ef4444', borderRadius: 4, padding: '2px 7px', fontSize: 9, fontWeight: 800, color: '#fff', letterSpacing: '0.05em' }}>
            #SHORT
          </div>
        )}
      </div>
      {/* Body */}
      <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {v.title || '—'}
        </div>
        {/* Stats row */}
        <div style={{ display: 'flex', gap: 12, marginTop: 'auto', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#F5E625', fontFamily: 'JetBrains Mono' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
            {fmt(v.views)}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#f97316', fontFamily: 'JetBrains Mono' }}>
            ♥ {fmt(v.likes)}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#a78bfa', fontFamily: 'JetBrains Mono' }}>
            💬 {fmt(v.comments)}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--fg-4)' }}>{formatCalendarDateFromDaysAgo(v.days)}</span>
          <span style={{ fontSize: 9, color: color, fontWeight: 700 }}>{likeRatio}% like rate</span>
        </div>
      </div>
    </a>
  )
}

export default function YoutubeBrandPage() {
  const { slug } = useParams<{ slug: string }>()
  const brandSlug = decodeURIComponent(slug)

  const [brands, setBrands] = useState<V2Brand[]>([])
  const [ytRow, setYtRow] = useState<V2YTRow | null>(null)
  const [videos, setVideos] = useState<V2TopYTVideo[]>([])
  const [analyses, setAnalyses] = useState<V2YTVideoAnalysis[]>([])
  const [trend, setTrend] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<'views' | 'likes' | 'comments' | 'days'>('views')
  const [typeFilter, setTypeFilter] = useState<'all' | 'short' | 'long'>('all')
  const [showAllAnalyses, setShowAllAnalyses] = useState(false)

  useEffect(() => {
    fetchBrands().then(async (b) => {
      const [yt, vids, ana, tr] = await Promise.all([
        fetchYT(b),
        fetchTopYTVideos(b, 500),
        fetchYTVideoAnalysis(b, 100),
        fetchYTTrend(b),
      ])
      setBrands(b)
      setYtRow(yt.find(r => r.brand === brandSlug) ?? null)
      setVideos(vids.filter(v => v.brand === brandSlug))
      setAnalyses(ana.filter(a => a.brand === brandSlug))
      setTrend(tr[brandSlug] ?? [])
      setLoading(false)
    })
  }, [brandSlug])

  const sec1 = useReveal()
  const sec2 = useReveal()
  const sec3 = useReveal()

  if (loading) return <LoadingPage />

  const brandName = pgName(brandSlug, brands)
  const color = pgColor(brandSlug)
  const isJ = brandSlug === 'joola'
  const handle = YT_HANDLES[brandSlug]
  const avgViews = ytRow && ytRow.videos > 0 ? Math.round(ytRow.views / ytRow.videos) : 0

  const filteredVideos = videos.filter(v =>
    typeFilter === 'all' ? true : typeFilter === 'short' ? v.is_short : !v.is_short
  )
  const sortedVideos = [...filteredVideos].sort((a, b) =>
    sortKey === 'days' ? a.days - b.days : b[sortKey] - a[sortKey]
  )

  // Content type breakdown from analyses
  const typeCounts: Record<string, number> = {}
  analyses.forEach(a => {
    const t = a.contentType || 'Unknown'
    typeCounts[t] = (typeCounts[t] || 0) + 1
  })
  const typeEntries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])

  // Trend series for line chart
  const trendSeries = trend.length > 1
    ? [{ id: brandSlug, label: brandName, color, data: trend }]
    : []
  const trendLabels = trend.map((_, i) => `W${i + 1}`)

  // Top performers
  const topByViews    = [...videos].sort((a, b) => b.views - a.views)[0]
  const topByLikes    = [...videos].sort((a, b) => b.likes - a.likes)[0]
  const topByComments = [...videos].sort((a, b) => b.comments - a.comments)[0]

  return (
    <div className="ov-page-enter" style={{ minHeight: '100vh' }}>
      {/* ── Hero ── */}
      <div style={{
        background: `linear-gradient(135deg, ${color}22 0%, transparent 60%), linear-gradient(180deg, ${color}18 0%, var(--sticky-bg) 100%)`,
        borderBottom: `1px solid ${color}33`,
        padding: '28px 0 32px',
        marginBottom: 32,
        position: 'relative',
      }}>
        {/* Back nav */}
        <div style={{ marginBottom: 20 }}>
          <Breadcrumb crumbs={[
            { label: 'YouTube', href: '/v2/youtube' },
            { label: brandName },
          ]} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <BackButton />
            <button
              onClick={() => window.print()}
              className="btn btn-ghost"
              aria-label="Print or save as PDF"
              style={{ fontSize: 11 }}
            >
              ⎙ Print
            </button>
          </div>
        </div>

        {/* Brand identity */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: color, boxShadow: `0 0 28px ${color}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><path d="M10 16.5l6-4.5-6-4.5v9zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>
            </div>
            <div>
              <div className="ov-title" style={{ fontSize: 28, fontWeight: 800, color: isJ ? '#22c55e' : 'var(--fg)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{brandName}</div>
              {handle && <div className="ov-eyebrow" style={{ fontSize: 13, color: 'var(--fg-4)', marginTop: 4 }}>@{handle} · YouTube</div>}
            </div>
          </div>
          {handle && (
            <a href={`https://www.youtube.com/@${handle}`} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#ff0000', borderRadius: 8, padding: '9px 18px', color: '#fff', fontWeight: 700, fontSize: 13, textDecoration: 'none', flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-2.47 12 12 0 00-11.64 0A4.83 4.83 0 01.41 6.69 49.11 49.11 0 000 12a49.11 49.11 0 00.41 5.31 4.83 4.83 0 003.77 2.47 12 12 0 0011.64 0 4.83 4.83 0 003.77-2.47A49.11 49.11 0 0024 12a49.11 49.11 0 00-.41-5.31zM9.75 15.02V8.98l6 3.02z"/></svg>
              View Channel ↗
            </a>
          )}
        </div>

        {/* KPI stat cards */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {[
            <StatCard key="subs" label="Subscribers" value={ytRow?.subs ? fmt(ytRow.subs) : '—'} sub="current snapshot" color={isJ ? '#22c55e' : color} />,
            <StatCard key="growth" label="Sub Growth (wk)" value={ytRow?.delta != null ? (ytRow.delta >= 0 ? '+' : '') + fmt(ytRow.delta) : '—'} sub="vs previous week" color={ytRow?.delta != null ? (ytRow.delta >= 0 ? '#22c55e' : '#ef4444') : undefined} />,
            <StatCard key="videos" label="Total Videos" value={ytRow?.videos ? String(ytRow.videos) : '—'} sub="all uploads" />,
            <StatCard key="views" label="Total Views" value={ytRow?.views ? fmt(ytRow.views) : '—'} sub="channel lifetime" color="#F5E625" />,
            <StatCard key="avg" label="Avg Views / Video" value={avgViews > 0 ? fmt(avgViews) : '—'} sub="efficiency score" color={isJ ? '#22c55e' : '#a78bfa'} />,
            <StatCard key="tracked" label="Videos Tracked" value={String(videos.length)} sub="in current window" />,
          ].map((card, i) => (
            <div key={i} className="ov-kpi" style={{ '--ov-d': `${160 + i * 75}ms` } as React.CSSProperties}>
              {card}
            </div>
          ))}
        </div>
      </div>

      {/* ── Subscriber Trend ── */}
      {trendSeries.length > 0 && (
        <section ref={sec1.ref} className={revealCls(sec1.vis)} style={{ marginBottom: 32 }}>
          <div className="section-head">
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>Subscriber growth trend</h2>
            <div className="sub">{trend.length} weekly snapshots · {fmt(trend[0])} → {fmt(trend[trend.length - 1])}</div>
          </div>
          <div className="card"><div className="card-pad">
            <LineChart series={trendSeries} xLabels={trendLabels} h={180} />
          </div></div>
        </section>
      )}

      {/* ── Top Performers ── */}
      {videos.length > 0 && (
        <section ref={sec2.ref} className={revealCls(sec2.vis)} style={{ marginBottom: 32 }}>
          <div className="section-head">
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>Top performers</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {[
              { label: '👁 Most Viewed', video: topByViews, val: fmt(topByViews?.views), metricColor: '#F5E625' },
              { label: '♥ Most Liked', video: topByLikes, val: fmt(topByLikes?.likes), metricColor: '#f97316' },
              { label: '💬 Most Discussed', video: topByComments, val: fmt(topByComments?.comments), metricColor: '#a78bfa' },
            ].map(({ label, video, val, metricColor }) => video ? (
              <a key={label} href={video.url || '#'} target="_blank" rel="noopener noreferrer"
                style={{ textDecoration: 'none', background: 'var(--line-2)', border: `1px solid ${color}33`, borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, transition: 'transform 0.15s, box-shadow 0.15s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)'; (e.currentTarget as HTMLElement).style.boxShadow = `0 8px 28px ${color}22` }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = '' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{video.title}</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: metricColor, fontFamily: 'JetBrains Mono' }}>{val}</span>
              </a>
            ) : null)}
          </div>
        </section>
      )}

      {/* ── Content Analysis ── */}
      {(analyses.length > 0 || typeEntries.length > 0) && (
        <section ref={sec3.ref} className={revealCls(sec3.vis)} style={{ marginBottom: 32 }}>
          <div className="section-head">
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>Content analysis · AI performance theses</h2>
            <div className="sub">{analyses.length} videos analysed · showing top 5 · hover a row for full thesis</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: typeEntries.length > 0 ? '1fr 340px' : '1fr', gap: 16 }}>
            {/* Theses list — first 3 + View All modal */}
            <div className="card"><div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {analyses.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>No AI analysis available for this brand yet.</div>
              ) : (
                <>
                  {analyses.slice(0, 5).map((a, i) => (
                    <AnalysisRow key={i} a={a} color={color} />
                  ))}
                  {analyses.length > 5 && (
                    <button
                      onClick={() => setShowAllAnalyses(true)}
                      style={{ marginTop: 4, padding: '9px 0', background: 'var(--line-2)', border: `1px solid ${color}44`, borderRadius: 8, color, fontSize: 12, fontWeight: 700, cursor: 'pointer', width: '100%', transition: 'background 0.15s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = color + '14' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--line-2)' }}
                    >
                      View all {analyses.length} analyses ↗
                    </button>
                  )}
                </>
              )}
            </div></div>

            {/* Modal */}
            {showAllAnalyses && (
              <div
                onClick={() => setShowAllAnalyses(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                <div
                  onClick={e => e.stopPropagation()}
                  style={{ background: 'var(--bg)', border: `1px solid ${color}44`, borderRadius: 16, width: '100%', maxWidth: 780, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: `0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px ${color}22` }}>
                  {/* Modal header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: `1px solid var(--wb-8)`, flexShrink: 0 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)' }}>Content analysis · AI performance theses</div>
                      <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 3 }}>{analyses.length} videos analysed for {brandName}</div>
                    </div>
                    <button
                      onClick={() => setShowAllAnalyses(false)}
                      style={{ background: 'var(--line)', border: '1px solid var(--wb-12)', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--fg-3)', fontSize: 18, lineHeight: 1, flexShrink: 0 }}>
                      ×
                    </button>
                  </div>
                  {/* Modal body */}
                  <div style={{ overflowY: 'auto', padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {analyses.map((a, i) => (
                      <AnalysisRow key={i} a={a} color={color} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Content type breakdown */}
            {typeEntries.length > 0 && (() => {
              const PALETTE = ['#22c55e','#818cf8','#F5E625','#fb923c','#34d399','#f472b6','#38bdf8','#a78bfa']
              const donutData = typeEntries.map(([type, count], i) => ({
                name: type, value: count, color: PALETTE[i % PALETTE.length],
              }))
              const total = typeEntries.reduce((s, [, n]) => s + n, 0)
              return (
                <div className="card"><div className="card-pad">
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Content types</div>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                    <Donut data={donutData} size={220} thickness={36} centerLabel={String(total)} centerSub="videos" />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {donutData.map(d => (
                      <div key={d.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 12, color: 'var(--fg-2)', fontWeight: 600 }}>{d.name}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>{Math.round((d.value / total) * 100)}%</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: d.color, fontFamily: 'JetBrains Mono', minWidth: 16, textAlign: 'right' }}>{d.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div></div>
              )
            })()}
          </div>
        </section>
      )}

      {/* ── Video Grid ── */}
      <section>
        <div className="section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>
              Video library · {filteredVideos.length} videos
            </h2>
            <div className="sub">All tracked videos for {brandName} · sorted by {sortKey}</div>
          </div>
          {/* Controls */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Type filter */}
            <div style={{ display: 'flex', gap: 4, background: 'var(--wb-5)', borderRadius: 8, padding: 3 }}>
              {(['all', 'long', 'short'] as const).map(t => (
                <button key={t} onClick={() => setTypeFilter(t)} style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  background: typeFilter === t ? color : 'transparent',
                  color: typeFilter === t ? '#000' : 'var(--fg-4)',
                  border: 'none',
                }}>
                  {t === 'all' ? 'All' : t === 'long' ? 'Long-form' : 'Shorts'}
                </button>
              ))}
            </div>
            {/* Sort */}
            <div style={{ display: 'flex', gap: 4, background: 'var(--wb-5)', borderRadius: 8, padding: 3 }}>
              {([['views', 'Views'], ['likes', 'Likes'], ['comments', 'Comments'], ['days', 'Recent']] as const).map(([key, lbl]) => (
                <button key={key} onClick={() => setSortKey(key)} style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  background: sortKey === key ? 'var(--wb-12)' : 'transparent',
                  color: sortKey === key ? 'var(--fg)' : 'var(--fg-4)',
                  border: 'none',
                }}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        </div>

        {sortedVideos.length === 0 ? (
          <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)', fontSize: 13 }}>
            No videos found for the current filter.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
            {sortedVideos.map((v, i) => <VideoCard key={i} v={v} color={color} />)}
          </div>
        )}
      </section>
    </div>
  )
}
