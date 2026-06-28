'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  fetchBrands, fetchIG, fetchYT, fetchReddit, fetchX, fetchTikTok, fetchAds, fetchInfluencers,
  fetchYTTrend, fetchRedditTrend,
  type V2Brand, type V2IGRow, type V2YTRow, type V2RedditRow,
  type V2XRow, type V2TikTokRow, type V2AdRow, type V2InfluencerRow,
} from '@/lib/v2/data'
import { fmt, Donut, SentimentBar, LineChart } from '@/components/v2/charts'
import { LoadingPage, pgColor, pgName, SectionInfo } from '@/components/v2/PageShell'

// ─── Animation utilities ────────────────────────────────────────────────────

function useCountUp(target: number, duration = 1150) {
  const [val, setVal] = useState(0)
  const rafRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (target === 0) { setVal(0); return }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const ease = 1 - (1 - t) ** 3        // easeOutCubic
      setVal(Math.round(ease * target))
      if (t < 1) { rafRef.current = requestAnimationFrame(tick) }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [target, duration])
  return val
}

function useReveal(threshold = 0.1) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [vis, setVis] = useState(false)
  // callback ref fires every time the element mounts — works correctly after loading→false
  const ref = (node: HTMLDivElement | null) => setEl(node)
  useEffect(() => {
    if (!el || vis) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVis(true); obs.disconnect() } },
      { threshold }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [el, vis, threshold])
  return { ref, vis }
}

// ─── Page constants ────────────────────────────────────────────────────────

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

// ─── Page component ────────────────────────────────────────────────────────

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

  // ── Derived values needed before early return (for hooks) ─────────────────
  const totalAds          = ads.reduce((s, r) => s + r.total, 0)
  const joolaIG           = ig.find(r => r.brand === 'joola')
  const joolaYT           = yt.find(r => r.brand === 'joola')
  const joolaReddit       = reddit.find(r => r.brand === 'joola')
  const joolaAds          = ads.find(r => r.brand === 'joola')
  const joolaSoV          = totalAds > 0 && joolaAds ? (joolaAds.total / totalAds * 100).toFixed(1) : '—'
  const joolaAthleteCount = influencers.filter(i => i.brand === 'joola').length

  // ── Count-up animations (one hook per KPI) ────────────────────────────────
  const igFollowersCnt = useCountUp(joolaIG?.followers ?? 0)
  const ytSubsCnt      = useCountUp(joolaYT?.subs ?? 0)
  // Multiply SOV by 10 so we can animate the decimal (143 → display as 14.3%)
  const sovCnt         = useCountUp(joolaSoV !== '—' ? Math.round(parseFloat(joolaSoV) * 10) : 0)
  const redditCnt      = useCountUp(joolaReddit?.mentions ?? 0)
  const athletesCnt    = useCountUp(joolaAthleteCount)

  // ── Bar reveal animation ──────────────────────────────────────────────────
  // Bars start at 0 and grow to their target once data is loaded
  const [barsReady, setBarsReady] = useState(false)
  useEffect(() => {
    if (!loading) {
      const t = setTimeout(() => setBarsReady(true), 380)
      return () => clearTimeout(t)
    }
  }, [loading])

  // ── Scroll-reveal refs (one per major section) ────────────────────────────
  const row1   = useReveal()
  const row2   = useReveal()
  const row3   = useReveal()
  const row4   = useReveal()
  const row5   = useReveal()
  const row6   = useReveal()
  const row7   = useReveal()
  const navRow = useReveal()

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

  // ── Remaining derived data ────────────────────────────────────────────────
  // (totalAds, joolaIG, joolaYT, joolaReddit, joolaAds, joolaSoV computed above)

  const adDonutData = [...ads]
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .map(r => ({ name: name(r.brand), value: r.total, color: color(r.brand) }))

  const igComparison = [...ig]
    .filter(r => r.followers >= 50 && r.engRate <= 20)
    .sort((a, b) => {
      if (a.brand === 'joola') return -1
      if (b.brand === 'joola') return 1
      return b.followers - a.followers
    })
  const maxIGFollowers = Math.max(1, ...igComparison.map(r => r.followers))
  const maxIGER        = Math.max(1, ...igComparison.map(r => r.engRate))

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

  const topIGBrands = [...ig].filter(r => r.followers >= 50 && r.trend.length > 1)
    .sort((a, b) => b.followers - a.followers).slice(0, 6)
  const igTrendSeries = topIGBrands.map(r => ({
    id: r.brand, label: name(r.brand), color: color(r.brand), data: r.trend,
  }))
  const igTrendLabels = Array.from({ length: Math.max(...igTrendSeries.map(s => s.data.length), 2) }, (_, i) => `W${i + 1}`)

  const erComparison = [...ig]
    .filter(r => r.followers >= 50 && r.engRate > 0 && r.engRate <= 20)
    .sort((a, b) => {
      if (a.brand === 'joola') return -1
      if (b.brand === 'joola') return 1
      return b.engRate - a.engRate
    })
  const maxER = Math.max(1, ...erComparison.map(r => r.engRate))

  const tiktokSorted = [...tiktok]
    .filter(r => r.followers > 0)
    .sort((a, b) => {
      if (a.brand === 'joola') return -1
      if (b.brand === 'joola') return 1
      return b.followers - a.followers
    })
  const maxTTFollowers = Math.max(1, ...tiktokSorted.map(r => r.followers))
  const maxTTHearts    = Math.max(1, ...tiktokSorted.map(r => r.totalHearts))

  const xSorted = [...x]
    .filter(r => r.followers > 0)
    .sort((a, b) => {
      if (a.brand === 'joola') return -1
      if (b.brand === 'joola') return 1
      return b.followers - a.followers
    })
  const maxXFollowers = Math.max(1, ...xSorted.map(r => r.followers))

  const athleteReach = brands.map(b => ({
    brand: b.id,
    reach: influencers.filter(i => i.brand === b.id).reduce((s, i) => s + (i.followers || 0), 0),
    count: influencers.filter(i => i.brand === b.id).length,
    avgER: (() => {
      const athletes = influencers.filter(i => i.brand === b.id && i.engRate > 0)
      return athletes.length ? athletes.reduce((s, i) => s + i.engRate, 0) / athletes.length : 0
    })(),
  })).filter(r => r.reach > 0).sort((a, b) => {
    if (a.brand === 'joola') return -1
    if (b.brand === 'joola') return 1
    return b.reach - a.reach
  })
  const maxAthleteReach = Math.max(1, ...athleteReach.map(r => r.reach))

  const topYTBrands = [...yt].sort((a, b) => b.subs - a.subs).slice(0, 5).map(r => r.brand)
  const ytTrendSeries = topYTBrands
    .map(b => ({ id: b, label: name(b), color: color(b), data: ytTrend[b] || [] }))
    .filter(s => s.data.length > 1)
  const ytTrendLen    = ytTrendSeries[0]?.data.length || 8
  const ytTrendLabels = Array.from({ length: ytTrendLen }, (_, i) => `W${i + 1}`)

  const topRdBrands = [...reddit].sort((a, b) => b.mentions - a.mentions).slice(0, 5).map(r => r.brand)
  const rdTrendSeries = topRdBrands
    .map(b => ({ id: b, label: name(b), color: color(b), data: rdTrend[b] || [] }))
    .filter(s => s.data.length > 1)
  const rdTrendLen    = rdTrendSeries[0]?.data.length || 8
  const rdTrendLabels = Array.from({ length: rdTrendLen }, (_, i) => `W${i + 1}`)

  // ── KPI items (count-up values) ───────────────────────────────────────────
  const kpiItems = [
    {
      label: 'IG Followers',
      value: joolaIG ? fmt(igFollowersCnt) : '—',
      sub:   joolaIG ? `${joolaIG.engRate.toFixed(2)}% ER` : '',
      color: '#e1306c', href: '/v2/instagram',
    },
    {
      label: 'YT Subscribers',
      value: joolaYT ? fmt(ytSubsCnt) : '—',
      sub:   joolaYT ? `${fmt(joolaYT.views)} views` : '',
      color: '#ff0000', href: '/v2/youtube',
    },
    {
      label: 'Ad SOV',
      value: joolaSoV !== '—' ? `${(sovCnt / 10).toFixed(1)}%` : '—',
      sub:   `of ${fmt(totalAds)} ads in market`,
      color: '#F5E625', href: '/v2/campaign-offer-intel',
    },
    {
      label: 'Reddit Mentions',
      value: joolaReddit ? fmt(redditCnt) : '—',
      sub:   joolaReddit
        ? `${Math.round((joolaReddit.positive / Math.max(1, joolaReddit.mentions)) * 100)}% positive`
        : '',
      color: '#ff4500', href: '/v2/reddit',
    },
    {
      label: 'Athletes',
      value: String(athletesCnt),
      sub:   'sponsored athletes',
      color: '#818cf8', href: '/v2/influencers',
    },
  ]

  // ─── Bar helper: returns width style with staggered grow transition ────────
  const barStyle = (pct: number, rowIdx: number, colIdx = 0): React.CSSProperties => ({
    height: '100%',
    width: barsReady ? `${pct}%` : '0%',
    borderRadius: 99,
    transition: `width 0.85s cubic-bezier(0.22, 1, 0.36, 1) ${rowIdx * 55 + colIdx * 18}ms`,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* ── Hero ── */}
      <div>
        <div
          className="ov-eyebrow"
          style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 6 }}
        >
          JOOLA INTEL · Dashboard
        </div>
        <h1
          className="ov-title"
          style={{ fontSize: 26, fontWeight: 800, color: '#fff', margin: '0 0 20px', letterSpacing: '-0.02em' }}
        >
          Competitive <span style={{ color: '#22c55e' }}>Overview</span>
        </h1>

        {/* ── KPI strip ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {kpiItems.map(({ label, value, sub, color: c, href }, i) => (
            <div
              key={label}
              className="ov-kpi"
              onClick={() => router.push(href)}
              style={{
                '--ov-d': `${160 + i * 75}ms`,
                background: 'var(--wb-3)',
                border: `1px solid ${c}33`,
                borderRadius: 10,
                padding: '14px 16px',
                borderTop: `3px solid ${c}`,
                cursor: 'pointer',
                transition: 'background 200ms, transform 200ms, box-shadow 200ms',
              } as React.CSSProperties}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLElement
                el.style.background = c + '14'
                el.style.transform  = 'translateY(-3px)'
                el.style.boxShadow  = `0 10px 28px ${c}28`
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLElement
                el.style.background = 'var(--wb-3)'
                el.style.transform  = ''
                el.style.boxShadow  = ''
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 8 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: c, fontFamily: 'JetBrains Mono', lineHeight: 1 }}>{value}</div>
              {sub && <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 6 }}>{sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* ── Row 1: Ad SOV Donut + Social Reach Bars ── */}
      <div
        ref={row1.ref}
        className={`ov-reveal${row1.vis ? ' is-vis' : ''}`}
        style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16 } as React.CSSProperties}
      >
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
            {reachData.map((r, ri) => {
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
                    {segments.map((seg, si) =>
                      seg.v > 0 ? (
                        <div
                          key={si}
                          style={{
                            ...barStyle((seg.v / maxReach) * 100, ri, si),
                            background: seg.c,
                            opacity: isJ ? 1 : 0.75,
                            borderRadius: 0,
                          }}
                          title={`${seg.label}: ${fmt(seg.v)}`}
                        />
                      ) : null
                    )}
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
      <div
        ref={row2.ref}
        className={`ov-reveal${row2.vis ? ' is-vis' : ''}`}
        style={{ '--ov-d': '60ms' } as React.CSSProperties}
      >
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
              <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 80px 1fr 64px', gap: 12, alignItems: 'center', paddingBottom: 8, borderBottom: '1px solid var(--line-2)' }}>
                {['Brand', 'Followers', '', 'Eng. Rate', ''].map((h, i) => (
                  <span key={i} style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: i >= 2 ? 'right' : 'left' }}>{h}</span>
                ))}
              </div>
              {igComparison.map((r, idx) => {
                const isJ    = r.brand === 'joola'
                const c      = color(r.brand)
                const flwPct = (r.followers / maxIGFollowers) * 100
                const erPct  = (r.engRate   / maxIGER)       * 100
                const erColor = r.engRate > 3 ? '#22c55e' : r.engRate > 1 ? '#F5E625' : '#ef4444'
                return (
                  <div
                    key={r.brand}
                    style={{ display: 'grid', gridTemplateColumns: '130px 1fr 80px 1fr 64px', gap: 12, alignItems: 'center', padding: '4px 8px', borderRadius: 6, cursor: 'pointer', transition: 'background 140ms' }}
                    onClick={() => router.push('/v2/instagram')}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--wb-3)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: isJ ? 800 : 600, color: isJ ? '#22c55e' : 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name(r.brand)}
                      </span>
                    </div>
                    <div style={{ height: 8, background: 'var(--wb-5)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ ...barStyle(flwPct, idx, 0), background: c, opacity: isJ ? 1 : 0.7 }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: isJ ? '#22c55e' : 'var(--fg-2)', fontFamily: 'JetBrains Mono', textAlign: 'right' }}>
                      {fmt(r.followers)}
                    </span>
                    <div style={{ height: 8, background: 'var(--wb-5)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ ...barStyle(erPct, idx, 1), background: erColor }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: erColor, fontFamily: 'JetBrains Mono', textAlign: 'right' }}>
                      {r.engRate.toFixed(2)}%
                    </span>
                  </div>
                )
              })}
              <div style={{ display: 'flex', gap: 20, paddingTop: 10, borderTop: '1px solid var(--line-2)', fontSize: 10, color: 'var(--fg-4)' }}>
                <span>Engagement Rate: <span style={{ color: '#22c55e' }}>●</span> Excellent (&gt;3%)  <span style={{ color: '#F5E625' }}>●</span> Solid (1–3%)  <span style={{ color: '#ef4444' }}>●</span> Low (&lt;1%)</span>
                <span style={{ marginLeft: 'auto' }}>Click any row → Instagram page</span>
              </div>
            </div>
          )}
        </div></div>
      </div>

      {/* ── Row 3: Reddit Sentiment + YT Subscriber Trend ── */}
      <div
        ref={row3.ref}
        className={`ov-reveal${row3.vis ? ' is-vis' : ''}`}
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } as React.CSSProperties}
      >
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
        <div
          ref={row4.ref}
          className={`ov-reveal${row4.vis ? ' is-vis' : ''}`}
        >
          <div className="card"><div className="card-pad">
            <h6 style={{ marginTop: 0, marginBottom: 4 }}>
              Reddit Mention Trend
              <SectionInfo title="Reddit Mention Trend" description="Weekly mention volume for the top 5 most-discussed brands. Spikes indicate viral posts, product launches, or controversy." source="reddit_mentions · weekly rollup" />
            </h6>
            <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 8 }}>Top 5 brands · weekly mention volume</div>
            <LineChart series={rdTrendSeries} xLabels={rdTrendLabels} h={200} />
          </div></div>
        </div>
      )}

      {/* ── Row 5: IG Follower Growth Trend ── */}
      {igTrendSeries.length >= 2 && (
        <div
          ref={row5.ref}
          className={`ov-reveal${row5.vis ? ' is-vis' : ''}`}
        >
          <div className="card"><div className="card-pad">
            <h6 style={{ marginTop: 0, marginBottom: 4 }}>
              Instagram Follower Growth Trend
              <SectionInfo title="IG Follower Growth" description="Weekly follower snapshots for the top 6 brands by Instagram audience size. Rising lines = growing brand presence." source="ig_profiles_weekly · weekly snapshots" />
            </h6>
            <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 8 }}>Top 6 brands · weekly follower count</div>
            <LineChart series={igTrendSeries} xLabels={igTrendLabels} h={220} />
          </div></div>
        </div>
      )}

      {/* ── Row 6: Platform ER Comparison + Brand Athlete Reach ── */}
      <div
        ref={row6.ref}
        className={`ov-reveal${row6.vis ? ' is-vis' : ''}`}
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } as React.CSSProperties}
      >
        {/* IG Engagement Rate per brand */}
        <div className="card"><div className="card-pad">
          <h6 style={{ marginTop: 0, marginBottom: 4 }}>
            Instagram Engagement Rate
            <SectionInfo title="IG Engagement Rate" description="Engagement rate per brand — (avg likes + comments) / followers. Above 3% is excellent. Sorted highest to lowest." source="ig_profiles_weekly · latest snapshot" />
          </h6>
          <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 14 }}>% ER — click to open Instagram page</div>
          {erComparison.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>No ER data available.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {erComparison.map((r, idx) => {
                const isJ     = r.brand === 'joola'
                const c       = color(r.brand)
                const erColor = r.engRate > 3 ? '#22c55e' : r.engRate > 1 ? '#F5E625' : '#ef4444'
                const pct     = (r.engRate / maxER) * 100
                return (
                  <div
                    key={r.brand}
                    style={{ display: 'grid', gridTemplateColumns: '110px 1fr 54px', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '3px 6px', borderRadius: 6, transition: 'background 140ms' }}
                    onClick={() => router.push('/v2/instagram')}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--wb-3)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, fontWeight: isJ ? 800 : 600, color: isJ ? '#22c55e' : 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name(r.brand)}</span>
                    </div>
                    <div style={{ height: 8, background: 'var(--wb-5)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{
                        ...barStyle(pct, idx),
                        background: erColor,
                        boxShadow: isJ ? `0 0 6px ${erColor}88` : 'none',
                      }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: erColor, fontFamily: 'JetBrains Mono', textAlign: 'right' }}>
                      {r.engRate.toFixed(2)}%
                    </span>
                  </div>
                )
              })}
              <div style={{ display: 'flex', gap: 14, paddingTop: 8, borderTop: '1px solid var(--line-2)', fontSize: 10, color: 'var(--fg-4)' }}>
                <span style={{ color: '#22c55e' }}>● &gt;3% Excellent</span>
                <span style={{ color: '#F5E625' }}>● 1–3% Solid</span>
                <span style={{ color: '#ef4444' }}>● &lt;1% Low</span>
              </div>
            </div>
          )}
        </div></div>

        {/* Brand Athlete Reach */}
        <div className="card"><div className="card-pad">
          <h6 style={{ marginTop: 0, marginBottom: 4 }}>
            Athlete Influencer Reach
            <SectionInfo title="Athlete Influencer Reach" description="Combined Instagram follower count of all sponsored athletes per brand. Bigger bar = larger ambassador audience. Number of athletes shown in brackets." source="influencers · follower_count_ig" />
          </h6>
          <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 14 }}>Total athlete follower reach · click to explore</div>
          {athleteReach.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>No athlete data available.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {athleteReach.map((r, idx) => {
                const isJ = r.brand === 'joola'
                const c   = color(r.brand)
                const pct = (r.reach / maxAthleteReach) * 100
                return (
                  <div
                    key={r.brand}
                    style={{ display: 'grid', gridTemplateColumns: '110px 1fr 72px', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '3px 6px', borderRadius: 6, transition: 'background 140ms' }}
                    onClick={() => router.push('/v2/influencers')}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--wb-3)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, fontWeight: isJ ? 800 : 600, color: isJ ? '#22c55e' : 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name(r.brand)}</span>
                      <span style={{ fontSize: 9, color: 'var(--fg-4)' }}>[{r.count}]</span>
                    </div>
                    <div style={{ height: 8, background: 'var(--wb-5)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{
                        ...barStyle(pct, idx),
                        background: isJ ? '#22c55e' : c,
                        opacity: isJ ? 1 : 0.75,
                      }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: isJ ? '#22c55e' : 'var(--fg-2)', fontFamily: 'JetBrains Mono' }}>{fmt(r.reach)}</span>
                      {r.avgER > 0 && <span style={{ fontSize: 9, color: 'var(--fg-4)' }}>{r.avgER.toFixed(1)}% ER</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div></div>
      </div>

      {/* ── Row 7: TikTok Presence + X / Twitter Presence ── */}
      <div
        ref={row7.ref}
        className={`ov-reveal${row7.vis ? ' is-vis' : ''}`}
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } as React.CSSProperties}
      >
        {/* TikTok */}
        <div className="card"><div className="card-pad">
          <h6 style={{ marginTop: 0, marginBottom: 4 }}>
            TikTok Presence
            <SectionInfo title="TikTok Brand Presence" description="Follower count and total hearts (likes across all videos) per brand. Hearts reflect lifetime content love — a proxy for brand resonance on short video." source="tiktok_profiles_weekly · latest snapshot" />
          </h6>
          <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 14 }}>Followers · Total Hearts — click to open TikTok page</div>
          {tiktokSorted.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>No TikTok data available.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {tiktokSorted.map((r, idx) => {
                const isJ  = r.brand === 'joola'
                const c    = color(r.brand)
                const fPct = (r.followers / maxTTFollowers) * 100
                const hPct = (r.totalHearts / maxTTHearts)  * 100
                return (
                  <div
                    key={r.brand}
                    style={{ cursor: 'pointer', padding: '3px 6px', borderRadius: 6, transition: 'background 140ms' }}
                    onClick={() => router.push('/v2/tiktok')}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--wb-3)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
                        <span style={{ fontSize: 11, fontWeight: isJ ? 800 : 600, color: isJ ? '#22c55e' : 'var(--fg)' }}>{name(r.brand)}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 12, fontSize: 10, fontFamily: 'JetBrains Mono' }}>
                        <span style={{ color: '#69c9d0', fontWeight: 700 }}>{fmt(r.followers)}</span>
                        <span style={{ color: '#f97316' }}>♥ {fmt(r.totalHearts)}</span>
                      </div>
                    </div>
                    <div style={{ height: 5, background: 'var(--wb-5)', borderRadius: 99, overflow: 'hidden', marginBottom: 2 }}>
                      <div style={{
                        ...barStyle(fPct, idx, 0),
                        height: '100%',
                        background: isJ ? '#22c55e' : '#69c9d0',
                        opacity: isJ ? 1 : 0.75,
                      }} />
                    </div>
                    <div style={{ height: 3, background: 'var(--wb-5)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{
                        ...barStyle(hPct, idx, 1),
                        height: '100%',
                        background: '#f97316',
                        opacity: 0.65,
                      }} />
                    </div>
                  </div>
                )
              })}
              <div style={{ display: 'flex', gap: 14, paddingTop: 8, borderTop: '1px solid var(--line-2)', fontSize: 10, color: 'var(--fg-4)' }}>
                <span><span style={{ color: '#69c9d0' }}>──</span> Followers</span>
                <span><span style={{ color: '#f97316' }}>──</span> Total Hearts</span>
              </div>
            </div>
          )}
        </div></div>

        {/* X / Twitter */}
        <div className="card"><div className="card-pad">
          <h6 style={{ marginTop: 0, marginBottom: 4 }}>
            X / Twitter Presence
            <SectionInfo title="X / Twitter Brand Presence" description="Follower count per brand on X (formerly Twitter). Engagement rate derived from post interactions." source="x_profiles_weekly · latest snapshot" />
          </h6>
          <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 14 }}>Followers · Eng Rate — click to open X page</div>
          {xSorted.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>No X / Twitter data available.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {xSorted.map((r, idx) => {
                const isJ    = r.brand === 'joola'
                const c      = color(r.brand)
                const fPct   = (r.followers / maxXFollowers) * 100
                const erColor = r.engRate > 3 ? '#22c55e' : r.engRate > 1 ? '#F5E625' : '#94a3b8'
                return (
                  <div
                    key={r.brand}
                    style={{ display: 'grid', gridTemplateColumns: '110px 1fr 100px', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '3px 6px', borderRadius: 6, transition: 'background 140ms' }}
                    onClick={() => router.push('/v2/twitter')}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--wb-3)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, fontWeight: isJ ? 800 : 600, color: isJ ? '#22c55e' : 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name(r.brand)}</span>
                    </div>
                    <div style={{ height: 8, background: 'var(--wb-5)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{
                        ...barStyle(fPct, idx),
                        background: isJ ? '#22c55e' : c,
                        opacity: isJ ? 1 : 0.75,
                      }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: isJ ? '#22c55e' : 'var(--fg-2)', fontFamily: 'JetBrains Mono' }}>{fmt(r.followers)}</span>
                      {r.engRate > 0 && <span style={{ fontSize: 9, color: erColor, fontFamily: 'JetBrains Mono', fontWeight: 700 }}>{r.engRate.toFixed(1)}%</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div></div>
      </div>

      {/* ── Quick nav ── */}
      <div
        ref={navRow.ref}
        className={`ov-reveal${navRow.vis ? ' is-vis' : ''}`}
      >
        <h6 style={{ marginTop: 0, marginBottom: 12, fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          Jump to section
        </h6>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {NAV_SECTIONS.map((s, i) => (
            <button
              key={s.href}
              className={navRow.vis ? 'ov-nav-btn' : ''}
              onClick={() => router.push(s.href)}
              style={{
                '--ov-d': `${i * 45}ms`,
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', borderRadius: 8,
                cursor: 'pointer', textAlign: 'left',
                background: 'var(--wb-3)', border: '1px solid var(--line)',
                transition: 'all 180ms',
              } as React.CSSProperties}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLElement
                el.style.borderColor = s.color + '66'
                el.style.background  = s.color + '12'
                el.style.transform   = 'translateY(-2px)'
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLElement
                el.style.borderColor = 'var(--line)'
                el.style.background  = 'var(--wb-3)'
                el.style.transform   = ''
              }}
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
