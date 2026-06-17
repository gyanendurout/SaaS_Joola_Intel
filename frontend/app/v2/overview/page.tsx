'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  fetchBrands, fetchIG, fetchYT, fetchReddit, fetchX, fetchTikTok, fetchAds, fetchInfluencers,
  fetchYTTrend, fetchRedditTrend,
  type V2Brand, type V2IGRow, type V2YTRow, type V2RedditRow,
  type V2XRow, type V2TikTokRow, type V2AdRow, type V2InfluencerRow,
} from '@/lib/v2/data'
import { fmt, Donut, SentimentBar, LineChart } from '@/components/v2/charts'
import { LoadingPage, pgColor, pgName, SectionInfo } from '@/components/v2/PageShell'

const NAV_SECTIONS = [
  { label: 'Ask Intel',         href: '/v2/ask-intel',            icon: '💬', color: '#818cf8' },
  { label: 'Community Intel',   href: '/v2/community-intel',      icon: '📡', color: '#22c55e' },
  { label: 'Influencer Intel',  href: '/v2/influencers',          icon: '⭐', color: '#F5E625' },
  { label: 'Campaign & Offers', href: '/v2/campaign-offer-intel', icon: '📢', color: '#fb923c' },
  { label: 'Product Intel',     href: '/v2/product-intel',        icon: '🏓', color: '#34d399' },
  { label: 'Sales Intel',       href: '/v2/sales-intel',          icon: '💰', color: '#f97316' },
  { label: 'Instagram',         href: '/v2/instagram',            icon: '📸', color: '#e1306c' },
  { label: 'YouTube',           href: '/v2/youtube',              icon: '▶',  color: '#ff0000' },
  { label: 'Reddit',            href: '/v2/reddit',               icon: '🔶', color: '#ff4500' },
  { label: 'X / Twitter',       href: '/v2/twitter',              icon: '𝕏',  color: '#fff'   },
  { label: 'TikTok',            href: '/v2/tiktok',               icon: '🎵', color: '#69c9d0' },
  { label: 'Market Intel',      href: '/v2/market',               icon: '📊', color: '#a78bfa' },
]

export default function OverviewPage() {
  const router = useRouter()
  const [brands, setBrands]           = useState<V2Brand[]>([])
  const [ig, setIg]                   = useState<V2IGRow[]>([])
  const [yt, setYt]                   = useState<V2YTRow[]>([])
  const [reddit, setReddit]           = useState<V2RedditRow[]>([])
  const [x, setX]                     = useState<V2XRow[]>([])
  const [tiktok, setTiktok]           = useState<V2TikTokRow[]>([])
  const [ads, setAds]                 = useState<V2AdRow[]>([])
  const [influencers, setInfluencers] = useState<V2InfluencerRow[]>([])
  const [ytTrend, setYtTrend]         = useState<Record<string, number[]>>({})
  const [rdTrend, setRdTrend]         = useState<Record<string, number[]>>({})
  const [loading, setLoading]         = useState(true)

  useEffect(() => {
    document.title = 'JOOLA INTEL — Overview'
    fetchBrands().then(async (b) => {
      const [igD, ytD, rdD, xD, ttD, adD, infD, ytTr, rdTr] = await Promise.all([
        fetchIG(b), fetchYT(b), fetchReddit(b), fetchX(b),
        fetchTikTok(b), fetchAds(b), fetchInfluencers(b),
        fetchYTTrend(b), fetchRedditTrend(b),
      ])
      setBrands(b); setIg(igD); setYt(ytD); setReddit(rdD)
      setX(xD); setTiktok(ttD); setAds(adD); setInfluencers(infD)
      setYtTrend(ytTr); setRdTrend(rdTr)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  if (loading) return <LoadingPage />

  const name  = (s: string) => pgName(s, brands)
  const color = (s: string) => pgColor(s)

  // ── Derived data ─────────────────────────────────────────────────
  const totalAds    = ads.reduce((s, r) => s + r.total, 0)
  const joolaIG     = ig.find(r => r.brand === 'joola')
  const joolaYT     = yt.find(r => r.brand === 'joola')
  const joolaReddit = reddit.find(r => r.brand === 'joola')
  const joolaAds    = ads.find(r => r.brand === 'joola')
  const joolaSoV    = totalAds > 0 && joolaAds ? (joolaAds.total / totalAds * 100).toFixed(1) : '—'

  // Donut: Ad Share of Voice
  const adDonutData = [...ads]
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .map(r => ({ name: name(r.brand), value: r.total, color: color(r.brand) }))

  // Instagram brand comparison (followers + ER, filtered outliers)
  const igComparison = [...ig]
    .filter(r => r.followers >= 50 && r.engRate <= 20)
    .sort((a, b) => {
      if (a.brand === 'joola') return -1
      if (b.brand === 'joola') return 1
      return b.followers - a.followers
    })
  const maxIGFollowers = Math.max(1, ...igComparison.map(r => r.followers))
  const maxIGER        = Math.max(1, ...igComparison.map(r => r.engRate))

  // Sentiment bar data
  const sentimentData = reddit
    .filter(r => r.mentions > 0)
    .sort((a, b) => {
      if (a.brand === 'joola') return -1
      if (b.brand === 'joola') return 1
      return b.mentions - a.mentions
    })
    .slice(0, 8)
    .map(r => ({
      brand: r.brand, name: name(r.brand), color: color(r.brand),
      positive: r.positive, neutral: r.neutral, negative: r.negative,
      mentions: r.mentions, delta: r.delta,
    }))

  // Brand social reach horizontal bars
  const reachData = brands.map(b => {
    const igF  = ig.find(r => r.brand === b.id)?.followers || 0
    const ytS  = yt.find(r => r.brand === b.id)?.subs || 0
    const xF   = x.find(r => r.brand === b.id)?.followers || 0
    const ttF  = tiktok.find(r => r.brand === b.id)?.followers || 0
    return { brand: b.id, igF, ytS, xF, ttF, total: igF + ytS + xF + ttF }
  }).sort((a, b) => {
    if (a.brand === 'joola') return -1
    if (b.brand === 'joola') return 1
    return b.total - a.total
  })
  const maxReach = Math.max(1, ...reachData.map(r => r.total))

  // YT subscriber trend line chart — top 5 brands by subs
  const topYTBrands = [...yt].sort((a, b) => b.subs - a.subs).slice(0, 5).map(r => r.brand)
  const ytTrendSeries = topYTBrands
    .map(b => ({ id: b, label: name(b), color: color(b), data: ytTrend[b] || [] }))
    .filter(s => s.data.length > 1)
  const ytTrendLen  = ytTrendSeries[0]?.data.length || 8
  const ytTrendLabels = Array.from({ length: ytTrendLen }, (_, i) => `W${i + 1}`)

  // Reddit mention trend — top 5 brands
  const topRdBrands = [...reddit].sort((a, b) => b.mentions - a.mentions).slice(0, 5).map(r => r.brand)
  const rdTrendSeries = topRdBrands
    .map(b => ({ id: b, label: name(b), color: color(b), data: rdTrend[b] || [] }))
    .filter(s => s.data.length > 1)
  const rdTrendLen    = rdTrendSeries[0]?.data.length || 8
  const rdTrendLabels = Array.from({ length: rdTrendLen }, (_, i) => `W${i + 1}`)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* ── Hero ── */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 6 }}>JOOLA INTEL · Dashboard</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#fff', margin: '0 0 20px', letterSpacing: '-0.02em' }}>
          Competitive <span style={{ color: '#22c55e' }}>Overview</span>
        </h1>
        {/* JOOLA KPI strip — full width row, well below the fixed topbar */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {[
            { label: 'IG Followers',    value: joolaIG     ? fmt(joolaIG.followers)        : '—', sub: joolaIG     ? `${joolaIG.engRate.toFixed(2)}% ER`                                                  : '',  color: '#e1306c' },
            { label: 'YT Subscribers',  value: joolaYT     ? fmt(joolaYT.subs)             : '—', sub: joolaYT     ? `${fmt(joolaYT.views)} views`                                                        : '',  color: '#ff0000' },
            { label: 'Ad SOV',          value: joolaSoV + '%',                                     sub: `of ${fmt(totalAds)} ads in market`,                                                               color: '#F5E625' },
            { label: 'Reddit Mentions', value: joolaReddit ? fmt(joolaReddit.mentions)     : '—', sub: joolaReddit ? `${Math.round((joolaReddit.positive / Math.max(1, joolaReddit.mentions)) * 100)}% positive` : '', color: '#ff4500' },
            { label: 'Athletes',        value: String(influencers.filter(i => i.brand === 'joola').length), sub: 'sponsored athletes',                                                                     color: '#818cf8' },
          ].map(({ label, value, sub, color: c }) => (
            <div key={label} style={{ background: 'var(--wb-3)', border: `1px solid ${c}33`, borderRadius: 10, padding: '14px 16px', borderTop: `3px solid ${c}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 8 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: c, fontFamily: 'JetBrains Mono', lineHeight: 1 }}>{value}</div>
              {sub && <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 6 }}>{sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* ── Row 1: Ad SOV Donut + Social Reach Bars ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16 }}>

        {/* Ad Share of Voice Donut */}
        <div className="card"><div className="card-pad">
          <h6 style={{ marginTop: 0, marginBottom: 4 }}>
            Ad Share of Voice
            <SectionInfo title="Ad Share of Voice" description="How each brand's ad spend compares across Meta and Google. Larger slice = more paid reach." source="marketing_ads · total active ads per brand" />
          </h6>
          <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 16 }}>{ads.filter(r => r.total > 0).length} brands running ads</div>
          {adDonutData.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>No ad data available.</div>
          ) : (
            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <Donut data={adDonutData} size={180} thickness={32} centerLabel={fmt(totalAds)} centerSub="total ads" />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7, minWidth: 120 }}>
                {adDonutData.slice(0, 8).map((d, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 11, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: d.color, fontFamily: 'JetBrains Mono' }}>
                      {totalAds > 0 ? Math.round((d.value / totalAds) * 100) + '%' : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div></div>

        {/* Brand Social Reach horizontal bars */}
        <div className="card"><div className="card-pad">
          <h6 style={{ marginTop: 0, marginBottom: 4 }}>
            Brand Social Reach
            <SectionInfo title="Total Social Reach" description="Sum of Instagram followers + YouTube subscribers + X followers + TikTok followers per brand." source="ig_profiles_weekly · yt_channel_weekly · x_profiles_weekly · tiktok_profiles_weekly" />
          </h6>
          <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 14 }}>IG + YT + X + TikTok combined</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {reachData.map(r => {
              const isJ = r.brand === 'joola'
              const c   = color(r.brand)
              const segments = [
                { v: r.igF, label: 'IG',  c: '#e1306c' },
                { v: r.ytS, label: 'YT',  c: '#ff0000' },
                { v: r.xF,  label: 'X',   c: '#94a3b8' },
                { v: r.ttF, label: 'TT',  c: '#69c9d0' },
              ]
              return (
                <div key={r.brand} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 72px', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: isJ ? 800 : 600, color: isJ ? '#22c55e' : 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name(r.brand)}
                  </span>
                  <div style={{ height: 10, background: 'var(--wb-5)', borderRadius: 99, overflow: 'hidden', display: 'flex' }}>
                    {segments.map((seg, i) => (
                      seg.v > 0 ? (
                        <div key={i} style={{ height: '100%', width: `${(seg.v / maxReach) * 100}%`, background: seg.c, opacity: isJ ? 1 : 0.75 }}
                          title={`${seg.label}: ${fmt(seg.v)}`} />
                      ) : null
                    ))}
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: isJ ? '#22c55e' : c, fontFamily: 'JetBrains Mono', textAlign: 'right' }}>
                    {fmt(r.total)}
                  </span>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line-2)' }}>
            {[{ c: '#e1306c', l: 'Instagram' }, { c: '#ff0000', l: 'YouTube' }, { c: '#94a3b8', l: 'X' }, { c: '#69c9d0', l: 'TikTok' }].map(({ c: sc, l }) => (
              <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--fg-4)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: sc }} />{l}
              </span>
            ))}
          </div>
        </div></div>
      </div>

      {/* ── Row 2: Instagram Brand Comparison (full width) ── */}
      <div className="card"><div className="card-pad">
        <h6 style={{ marginTop: 0, marginBottom: 4 }}>
          Instagram Brand Comparison
          <SectionInfo title="Instagram Brand Comparison" description="Followers (audience size) and Engagement Rate (quality) per brand. Both metrics matter — big reach with low ER means low resonance." source="ig_profiles_weekly · latest snapshot" />
        </h6>
        <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 20 }}>
          Followers · Engagement Rate — sorted by audience size
        </div>
        {igComparison.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>No Instagram data available.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Column headers */}
            <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 80px 1fr 64px', gap: 12, alignItems: 'center', paddingBottom: 8, borderBottom: '1px solid var(--line-2)' }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Brand</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Followers</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'right' }}></span>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Eng. Rate</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'right' }}></span>
            </div>
            {igComparison.map(r => {
              const isJ   = r.brand === 'joola'
              const c     = color(r.brand)
              const flwPct = (r.followers / maxIGFollowers) * 100
              const erPct  = (r.engRate   / maxIGER)       * 100
              const erColor = r.engRate > 3 ? '#22c55e' : r.engRate > 1 ? '#F5E625' : '#ef4444'
              return (
                <div key={r.brand}
                  style={{ display: 'grid', gridTemplateColumns: '130px 1fr 80px 1fr 64px', gap: 12, alignItems: 'center', padding: '4px 8px', borderRadius: 6, cursor: 'pointer', transition: 'background 140ms' }}
                  onClick={() => router.push('/v2/instagram')}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--wb-3)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                >
                  {/* Brand name */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: isJ ? 800 : 600, color: isJ ? '#22c55e' : 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name(r.brand)}
                    </span>
                  </div>
                  {/* Followers bar */}
                  <div style={{ height: 8, background: 'var(--wb-5)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${flwPct}%`, background: c, opacity: isJ ? 1 : 0.7, borderRadius: 99, transition: 'width 0.5s ease' }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: isJ ? '#22c55e' : 'var(--fg-2)', fontFamily: 'JetBrains Mono', textAlign: 'right' }}>
                    {fmt(r.followers)}
                  </span>
                  {/* ER bar */}
                  <div style={{ height: 8, background: 'var(--wb-5)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${erPct}%`, background: erColor, borderRadius: 99, transition: 'width 0.5s ease' }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: erColor, fontFamily: 'JetBrains Mono', textAlign: 'right' }}>
                    {r.engRate.toFixed(2)}%
                  </span>
                </div>
              )
            })}
            {/* Legend */}
            <div style={{ display: 'flex', gap: 20, paddingTop: 10, borderTop: '1px solid var(--line-2)', fontSize: 10, color: 'var(--fg-4)' }}>
              <span>Engagement Rate: <span style={{ color: '#22c55e' }}>●</span> Excellent (&gt;3%)  <span style={{ color: '#F5E625' }}>●</span> Solid (1–3%)  <span style={{ color: '#ef4444' }}>●</span> Low (&lt;1%)</span>
              <span style={{ marginLeft: 'auto' }}>Click any row → Instagram page</span>
            </div>
          </div>
        )}
      </div></div>

      {/* ── Row 3: Reddit Sentiment + YT Subscriber Trend ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Reddit Sentiment */}
        <div className="card"><div className="card-pad">
          <h6 style={{ marginTop: 0, marginBottom: 4 }}>
            Community Sentiment · Reddit
            <SectionInfo title="Reddit Brand Sentiment" description="Positive vs neutral vs negative mention breakdown per brand from Reddit posts and comments. Sorted by total mentions." source="reddit_mentions · sentiment_label" />
          </h6>
          <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 14 }}>Positive / Neutral / Negative split</div>
          {sentimentData.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>No sentiment data yet.</div>
          ) : (
            <SentimentBar data={sentimentData} />
          )}
        </div></div>

        {/* YT Subscriber Trend */}
        <div className="card"><div className="card-pad">
          <h6 style={{ marginTop: 0, marginBottom: 4 }}>
            YouTube Subscriber Trend
            <SectionInfo title="YT Subscriber Trend" description="Weekly subscriber snapshots for the top 5 brands by subscriber count." source="yt_channel_weekly · weekly snapshots" />
          </h6>
          <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 8 }}>Top 5 brands · weekly snapshots</div>
          {ytTrendSeries.length < 2 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>Not enough trend data yet.</div>
          ) : (
            <LineChart series={ytTrendSeries} xLabels={ytTrendLabels} h={220} />
          )}
        </div></div>
      </div>

      {/* ── Row 4: Reddit Mention Trend (full width) ── */}
      {rdTrendSeries.length >= 2 && (
        <div className="card"><div className="card-pad">
          <h6 style={{ marginTop: 0, marginBottom: 4 }}>
            Reddit Mention Trend
            <SectionInfo title="Reddit Mention Trend" description="Weekly mention volume for the top 5 most-discussed brands. Spikes indicate viral posts, product launches, or controversy." source="reddit_mentions · weekly rollup" />
          </h6>
          <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 8 }}>Top 5 brands · weekly mention volume</div>
          <LineChart series={rdTrendSeries} xLabels={rdTrendLabels} h={200} />
        </div></div>
      )}

      {/* ── Quick nav ── */}
      <div>
        <h6 style={{ marginTop: 0, marginBottom: 12, fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          Jump to section
        </h6>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {NAV_SECTIONS.map(s => (
            <button key={s.href}
              onClick={() => router.push(s.href)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 8, cursor: 'pointer', textAlign: 'left', background: 'var(--wb-3)', border: '1px solid var(--line)', transition: 'all 180ms' }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = s.color + '66'; el.style.background = s.color + '12'; el.style.transform = 'translateY(-2px)' }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--line)'; el.style.background = 'var(--wb-3)'; el.style.transform = '' }}
            >
              <span style={{ fontSize: 16 }}>{s.icon}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-2)' }}>{s.label}</span>
            </button>
          ))}
        </div>
      </div>

    </div>
  )
}
