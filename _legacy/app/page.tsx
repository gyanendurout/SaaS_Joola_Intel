'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/shared/supabase'
import { KPICard } from '@/components/v1/KPICard'
import { Card } from '@/components/v1/Card'
import { CSSBar } from '@/components/v1/CSSBar'
import { BrandBadge } from '@/components/v1/BrandBadge'
import { DataTable } from '@/components/v1/DataTable'
import { SectionDivider } from '@/components/v1/SectionDivider'
import { DateFilter } from '@/components/v1/DateFilter'
import { fmt, fmtDate } from '@/lib/v1/utils'
import { type DateFilterOption, getDateRange } from '@/lib/v1/dateFilter'

const positioningData = [
  { brand:'JOOLA', price:'Premium ($49–$299)', identity:'Performance + Heritage (Agassi, Graf, Ben Johns)', community:'Large Reach / Modest Engagement', assessment:'Market leader by followers — engagement uplift is the #1 priority.', isJoola:true },
  { brand:'Selkirk', price:'Premium ($80–$333)', identity:"Lifestyle + Performance ('We Are Pickleball')", community:'Large Reach / Below-Avg Engagement', assessment:'Well-funded ($30M); comprehensive content but community not activated.' },
  { brand:'CRBN', price:'Premium ($169–$279)', identity:"Performance + Attitude ('Relentless by Design')", community:'Med Reach / EXCEPTIONAL Engagement', assessment:'Best-in-class community play. VIP funnel + giveaway machine. Blueprint for JOOLA.' },
  { brand:'Paddletek', price:'Mid-Premium ($60–$249)', identity:"Performance Heritage ('Inventors of polymer core')", community:'Large Reach / Avg Engagement', assessment:'Solid legacy brand. Major 2026 signings: Riley Newman, Zane Navratil, Connor Garnett.' },
  { brand:'Six Zero', price:'Premium ($89–$250)', identity:"International Premium ('Engineered in Australia')", community:'Small but Growing / Avg Engagement', assessment:'Growing global traction. Signed Blaine Hovenier + Gabe Joseph in 2026.' },
  { brand:'Engage', price:'Mid-Premium ($80–$259)', identity:"Performance + Education ('Play Like The Pros')", community:'Small Reach / Best Ratio', assessment:'Tutorial content strategy is best practice. Added Eric Oncins from JOOLA in 2026.' },
  { brand:'Onix', price:'Value/Declining ($89–$269)', identity:"Product Utility ('Cloud Control Tech')", community:'Low Reach / Lowest Engagement', assessment:'Heavy discounting + low engagement = brand distress. Competitor weakness to exploit.' },
]

const contentGaps = [
  { num:'01', gap:'Tutorial / Educational Reels', who:'Engage (@engagepickleball)', opportunity:'Engage gets 14x engagement on drill tutorials vs product posts. Ben Johns running tutorials = massive organic reach.', impact:'HIGH' },
  { num:'02', gap:'VIP Instagram Funnel', who:'CRBN (crbnpickleball.com/insta-VIPs)', opportunity:"JOOLA's bio link is generic. Dedicated IG landing page with Pro V demo offer can convert followers to buyers.", impact:'HIGH' },
  { num:'03', gap:'India / Asia Regional Handles', who:'Engage (@engagepickleball_in)', opportunity:'Titans Tour 2026 goes to Asia. No dedicated Asia/India Instagram handle.', impact:'HIGH' },
  { num:'04', gap:'Celebrity / Crossover Athlete Activation', who:'Paddletek (Trae Young), Selkirk (Jack Sock)', opportunity:'JOOLA has Agassi + Graf but neither activated on Instagram. One Agassi/Graf Reel = viral event.', impact:'HIGH' },
  { num:'05', gap:'Comment-Gating Automation', who:"Engage ('Comment GEAR, get DM')", opportunity:'Comment-to-DM automation boosts engagement and drives direct 1:1 conversations.', impact:'HIGH' },
  { num:'06', gap:'Loyalty / VIP Program Promotion', who:'Selkirk (VIP $99/year)', opportunity:"Selkirk heavily promotes VIP membership. JOOLA doesn't mention any membership tier.", impact:'MED' },
  { num:'07', gap:'Academy / Education Content Hub', who:'Selkirk (Selkirk Academy)', opportunity:"A 'JOOLA Academy' could be the brand's content moat.", impact:'MED' },
  { num:'08', gap:'Collegiate Ambassador Program', who:'CRBN + Six Zero', opportunity:'Both brands actively promote collegiate ambassador programs creating massive authentic UGC.', impact:'MED' },
]

const growthOps = [
  { num:'01', title:'Launch Tutorial / Educational Reels', timing:'IMMEDIATE', impact:'HIGH IMPACT', body:"Engage's drill content generates 14x higher engagement than product posts. JOOLA has the ultimate asset: Ben Johns, the #1 ranked player.", action:"Launch '2x/week Ben Johns Teaches' Reel series. Formats: serve technique, dinking, ATP shots, mental game." },
  { num:'02', title:'Activate India & Asia Digital Presence', timing:'IMMEDIATE', impact:'HIGH IMPACT', body:'JOOLA Titans Tour 2026 is coming to Asia — a massive content moment with no dedicated regional Instagram presence.', action:'Launch @joolapickleball_india and @joolapickleball_asia. Use Titans Tour 2026 as the launch campaign.' },
  { num:'03', title:'Convert Instagram to VIP Conversion Funnel', timing:'IMMEDIATE', impact:'HIGH IMPACT', body:"CRBN drives highest-value customers through a dedicated Instagram landing page. JOOLA's bio link goes to a generic homepage.", action:'Build joola.com/instagram with exclusive Pro V demo offer, early R4LLy shoe access, and email capture.' },
  { num:'04', title:'Agassi / Graf Legacy Activation', timing:'SHORT-TERM', impact:'VIRAL POTENTIAL', body:"Andre Agassi and Steffi Graf are JOOLA ambassadors — but neither appears in JOOLA's Instagram content.", action:"Monthly 'Legends of the Court' Reel series — Agassi and Graf playing pickleball. First post would be category-defining." },
  { num:'05', title:'Comment-Gating + Giveaway Cadence', timing:'SHORT-TERM', impact:'PROVEN ROI', body:"JOOLA's 100K follower giveaway generated 5,169 comments — the brand's single best-performing post.", action:"Monthly micro-giveaway. Example: 'Comment TITANS for early access to 2026 tour tickets.' Target: 1,000+ comments monthly." },
]

function IconChart() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <line x1="2" y1="14" x2="2" y2="6" /><line x1="6" y1="14" x2="6" y2="2" />
      <line x1="10" y1="14" x2="10" y2="8" /><line x1="14" y1="14" x2="14" y2="4" />
    </svg>
  )
}
function IconMap() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <polygon points="1 3 6 1 10 3 15 1 15 13 10 15 6 13 1 15" /><line x1="6" y1="1" x2="6" y2="13" /><line x1="10" y1="3" x2="10" y2="15" />
    </svg>
  )
}
function IconZap() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <polygon points="13 2 7 9 10 9 3 14 9 7 6 7 13 2" />
    </svg>
  )
}
function IconRefresh() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <polyline points="1 4 1 10 7 10" /><path d="M3.51 15A9 9 0 1 0 2 9.9" />
    </svg>
  )
}

export default function OverviewPage() {
  const [filter, setFilter] = useState<DateFilterOption>('thisQuarter')
  const [brands, setBrands] = useState<any[]>([])
  const [igProfiles, setIgProfiles] = useState<any[]>([])
  const [igPosts, setIgPosts] = useState<any[]>([])
  const [ytVideos, setYtVideos] = useState<any[]>([])
  const [redditMentions, setRedditMentions] = useState<any[]>([])
  const [influencers, setInfluencers] = useState<any[]>([])
  const [ads, setAds] = useState<any[]>([])
  const [promos, setPromos] = useState<any[]>([])
  const [igComments, setIgComments] = useState<any[]>([])
  const [ytComments, setYtComments] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [lastUpdated, setLastUpdated] = useState<string>('Not yet run')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { from, to } = getDateRange(filter)

      let igPostsQuery = supabase.from('ig_posts').select('brand_id,like_count,comment_count,view_count,posted_at').limit(500)
      if (from) igPostsQuery = igPostsQuery.gte('posted_at', from)
      if (to) igPostsQuery = igPostsQuery.lt('posted_at', to)

      let ytQuery = supabase.from('yt_videos').select('brand_id,view_count').limit(500)
      if (from) ytQuery = ytQuery.gte('published_at', from)
      if (to) ytQuery = ytQuery.lt('published_at', to)

      let rdQuery = supabase.from('reddit_mentions').select('brand_id')
      if (from) rdQuery = rdQuery.gte('posted_at', from)
      if (to) rdQuery = rdQuery.lt('posted_at', to)

      const [
        { data: brandsData },
        { data: igProfilesData },
        { data: igPostsData },
        { data: ytVideosData },
        { data: rdData },
        { data: infData },
        { data: adsData },
        { data: promosData },
        { data: igCmtData },
        { data: ytCmtData },
        { data: prodData },
        { data: runLog },
      ] = await Promise.all([
        supabase.from('brands').select('*').order('name'),
        supabase.from('ig_profiles_weekly').select('*').order('followers', { ascending: false }),
        igPostsQuery,
        ytQuery,
        rdQuery,
        supabase.from('influencers').select('brand_id').eq('is_active', true),
        supabase.from('marketing_ads').select('brand_id,platform,is_active,captured_at').limit(2000),
        supabase.from('promotions').select('brand_id,promo_type,discount_pct,banner_text,detected_at').order('detected_at', { ascending: false }).limit(200),
        supabase.from('ig_comments').select('brand_id').limit(3000),
        supabase.from('yt_comments').select('brand_id').limit(2000),
        supabase.from('products').select('brand_id,price_usd,in_stock').limit(500),
        supabase.from('weekly_run_log').select('completed_at').order('completed_at', { ascending: false }).limit(1),
      ])

      setBrands(brandsData || [])
      setIgProfiles(igProfilesData || [])
      setIgPosts(igPostsData || [])
      setYtVideos(ytVideosData || [])
      setRedditMentions(rdData || [])
      setInfluencers(infData || [])
      setAds(adsData || [])
      setPromos(promosData || [])
      setIgComments(igCmtData || [])
      setYtComments(ytCmtData || [])
      setProducts(prodData || [])
      setLastUpdated(runLog?.[0]?.completed_at ? fmtDate(runLog[0].completed_at) : 'Not yet run')
      setLoading(false)
    }
    load()
  }, [filter])

  const brandMap = Object.fromEntries(brands.map(b => [b.id, b]))
  const totalFollowers = igProfiles.reduce((s, p) => s + (p.followers || 0), 0)

  const seenBrands = new Set<string>()
  const uniqueProfiles = igProfiles.filter(p => { if (seenBrands.has(p.brand_id)) return false; seenBrands.add(p.brand_id); return true })

  const brandPostsMap: Record<string, any[]> = {}
  igPosts.forEach(p => { if (!brandPostsMap[p.brand_id]) brandPostsMap[p.brand_id] = []; brandPostsMap[p.brand_id].push(p) })

  const metrics = uniqueProfiles.map(profile => {
    const brand = brandMap[profile.brand_id] || {}
    const bp = brandPostsMap[profile.brand_id] || []
    const followers = profile.followers || 0
    const avgLikes = bp.length ? bp.reduce((s, p) => s + (p.like_count || 0), 0) / bp.length : 0
    const avgComments = bp.length ? bp.reduce((s, p) => s + (p.comment_count || 0), 0) / bp.length : 0
    const engRate = followers > 0 ? ((avgLikes + avgComments) / followers) * 100 : 0
    const sov = totalFollowers > 0 ? (followers / totalFollowers) * 100 : 0
    return { brand, followers, avgLikes, avgComments, engRate, sov, postCount: bp.length }
  }).sort((a, b) => b.followers - a.followers)

  const ytByBrand: Record<string, { count: number; views: number }> = {}
  ytVideos.forEach(v => {
    if (!ytByBrand[v.brand_id]) ytByBrand[v.brand_id] = { count: 0, views: 0 }
    ytByBrand[v.brand_id].count++
    ytByBrand[v.brand_id].views += (v.view_count || 0)
  })
  const rdByBrand: Record<string, number> = {}
  redditMentions.forEach(r => { rdByBrand[r.brand_id] = (rdByBrand[r.brand_id] || 0) + 1 })
  const infByBrand: Record<string, number> = {}
  influencers.forEach(i => { infByBrand[i.brand_id] = (infByBrand[i.brand_id] || 0) + 1 })

  // New datasets — aggregations by brand
  const adsByBrand: Record<string, { total: number; active: number; meta: number; google: number }> = {}
  ads.forEach(a => {
    if (!adsByBrand[a.brand_id]) adsByBrand[a.brand_id] = { total: 0, active: 0, meta: 0, google: 0 }
    adsByBrand[a.brand_id].total++
    if (a.is_active) adsByBrand[a.brand_id].active++
    if (a.platform === 'meta') adsByBrand[a.brand_id].meta++
    if (a.platform === 'google') adsByBrand[a.brand_id].google++
  })
  const promosByBrand: Record<string, number> = {}
  promos.forEach(p => { promosByBrand[p.brand_id] = (promosByBrand[p.brand_id] || 0) + 1 })
  const commentsByBrand: Record<string, number> = {}
  igComments.forEach(c => { commentsByBrand[c.brand_id] = (commentsByBrand[c.brand_id] || 0) + 1 })
  ytComments.forEach(c => { commentsByBrand[c.brand_id] = (commentsByBrand[c.brand_id] || 0) + 1 })
  const prodByBrand: Record<string, { count: number; prices: number[] }> = {}
  products.forEach(p => {
    if (!prodByBrand[p.brand_id]) prodByBrand[p.brand_id] = { count: 0, prices: [] }
    prodByBrand[p.brand_id].count++
    if (p.price_usd != null) prodByBrand[p.brand_id].prices.push(p.price_usd)
  })

  const summaryRows = brands.map(b => {
    const ig = uniqueProfiles.find(p => p.brand_id === b.id)
    return {
      b,
      followers: ig?.followers || 0,
      yt: ytByBrand[b.id]?.count || 0,
      ytViews: ytByBrand[b.id]?.views || 0,
      rd: rdByBrand[b.id] || 0,
      inf: infByBrand[b.id] || 0,
      ads: adsByBrand[b.id]?.total || 0,
      adsActive: adsByBrand[b.id]?.active || 0,
      promos: promosByBrand[b.id] || 0,
      comments: commentsByBrand[b.id] || 0,
      products: prodByBrand[b.id]?.count || 0,
    }
  }).sort((a, b) => b.followers - a.followers)

  // Activity feed — combined recent events across datasets
  const activityFeed = useMemo(() => {
    const events: { kind: string; brand_id: string; text: string; ts: string | null; color: string }[] = []
    promos.slice(0, 30).forEach(p => events.push({
      kind: 'PROMO',
      brand_id: p.brand_id,
      text: `${p.discount_pct ? `−${p.discount_pct.toFixed(0)}% off` : 'New promo'} · "${(p.banner_text || '').slice(0, 80)}${(p.banner_text || '').length > 80 ? '…' : ''}"`,
      ts: p.detected_at,
      color: '#ef4444',
    }))
    ads.slice(0, 40).forEach(a => {
      if (!a.captured_at) return
      events.push({
        kind: a.platform === 'meta' ? 'META AD' : 'GOOGLE AD',
        brand_id: a.brand_id,
        text: a.is_active ? 'Active ad creative' : 'Ad creative (paused)',
        ts: a.captured_at,
        color: a.platform === 'meta' ? '#5b8def' : '#e57368',
      })
    })
    return events
      .filter(e => e.ts)
      .sort((a, b) => new Date(b.ts!).getTime() - new Date(a.ts!).getTime())
      .slice(0, 14)
  }, [promos, ads])

  // Totals for hero KPIs
  const totalAds = ads.length
  const activeAds = ads.filter(a => a.is_active).length
  const totalComments = igComments.length + ytComments.length
  const totalPromos = promos.length

  const maxFollowers = Math.max(...uniqueProfiles.map(p => p.followers || 0), 1)

  return (
    <div className="max-w-[1100px] animate-fade-up">

      {/* ── Page Header ─────────────────────────────── */}
      <div className="flex items-start justify-between mb-8 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full"
              style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.2)' }}>
              Live Intelligence
            </span>
          </div>
          <h1 className="text-[32px] font-black tracking-tight leading-tight mb-1">
            <span className="text-gradient-white">Overview &amp; </span>
            <span className="text-gradient-green">Insights</span>
          </h1>
          <p className="text-[14px]" style={{ color: '#cbd5e1' }}>
            Pickleball competitor intelligence · Tracking {brands.length} brands across social channels
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: 'rgba(10,15,25,0.8)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <span style={{ color: '#cbd5e1' }}><IconRefresh /></span>
            <span className="text-[12px]" style={{ color: '#cbd5e1' }}>
              Updated <span className="font-semibold" style={{ color: '#e2e8f0' }}>{lastUpdated}</span>
            </span>
          </div>
          <DateFilter value={filter} onChange={setFilter} />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <div className="w-8 h-8 rounded-full border-2 border-[#22c55e] border-t-transparent animate-spin mx-auto mb-4" />
            <p className="text-[13px]" style={{ color: '#cbd5e1' }}>Loading intelligence data…</p>
          </div>
        </div>
      ) : (
        <>
          {/* ── KPIs (Row 1: reach) ───────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
            <KPICard label="Brands Tracked"    value={brands.length}           accent color="green" />
            <KPICard label="IG Followers"       value={fmt(totalFollowers)}      color="indigo" />
            <KPICard label="YT Videos"          value={fmt(ytVideos.length)}     color="default" />
            <KPICard label="IG Posts Tracked"   value={fmt(igPosts.length)}      color="default" />
            <KPICard label="Reddit Mentions"    value={redditMentions.length}    color="amber" />
          </div>

          {/* ── KPIs (Row 2: marketing intel — NEW) ───── */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <KPICard label="Marketing Ads"    value={fmt(totalAds)}        color="amber" sub={`${activeAds} active`} />
            <KPICard label="Active Promos"    value={totalPromos}          color="green" />
            <KPICard label="Audience Comments" value={fmt(totalComments)}  color="indigo" sub={`${fmt(igComments.length)} IG · ${fmt(ytComments.length)} YT`} />
            <KPICard label="Products Tracked" value={fmt(products.length)} color="default" />
            <KPICard label="Influencers"      value={influencers.length}   color="default" />
          </div>

          {/* ── Competitor Activity Feed ──────────────── */}
          {activityFeed.length > 0 && (
            <Card title="Competitor Activity — Latest Signals" className="mb-4" accent="amber">
              <div className="space-y-2">
                {activityFeed.map((ev, i) => {
                  const brand = brandMap[ev.brand_id]
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-3 p-2.5 rounded-xl"
                      style={{
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.04)',
                      }}
                    >
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0"
                        style={{ background: `${ev.color}1a`, color: ev.color, border: `1px solid ${ev.color}33` }}
                      >
                        {ev.kind}
                      </span>
                      <div className="flex-shrink-0">
                        <BrandBadge name={brand?.name || '?'} isJoola={brand?.is_joola} />
                      </div>
                      <span className="text-[12px] truncate flex-1" style={{ color: '#e2e8f0' }}>
                        {ev.text}
                      </span>
                      <span className="text-[10px] flex-shrink-0" style={{ color: '#94a3b8' }}>
                        {ev.ts ? fmtDate(ev.ts) : '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* ── IG Followers Bar ──────────────────────── */}
          <Card title="Instagram Followers by Brand" className="mb-4">
            <p className="text-[12px] mb-4" style={{ color: '#cbd5e1' }}>Current snapshot — not affected by date filter.</p>
            <CSSBar items={uniqueProfiles.sort((a, b) => b.followers - a.followers).map(p => ({
              label: brandMap[p.brand_id]?.name || '?',
              value: p.followers || 0,
              isJoola: brandMap[p.brand_id]?.is_joola || false,
            }))} />
          </Card>

          {/* ── Summary Table ────────────────────────── */}
          <Card title="Brand Intelligence Summary" className="mb-4">
            <DataTable
              columns={[
                { key: 'b',         label: 'Brand',      render: (b) => <BrandBadge name={b.name} isJoola={b.is_joola} />, sortValue: (r) => r.b?.name || '' },
                { key: 'followers', label: 'IG Followers', render: (v) => <span className="stat-number font-semibold">{fmt(v)}</span> },
                { key: 'yt',        label: 'YT Videos' },
                { key: 'rd',        label: 'Reddit' },
                { key: 'inf',       label: 'Influencers' },
                { key: 'products',  label: 'Products' },
                { key: 'ads',       label: 'Ads', render: (v, r) => (
                  <span className="stat-number font-semibold" style={{ color: v > 0 ? '#f59e0b' : '#94a3b8' }}>
                    {v}{r.adsActive > 0 && <span className="text-[10px] ml-1 text-[#22c55e]">({r.adsActive} active)</span>}
                  </span>
                )},
                { key: 'promos',    label: 'Promos', render: (v) => <span className="stat-number" style={{ color: v > 0 ? '#ef4444' : '#94a3b8' }}>{v}</span> },
                { key: 'comments',  label: 'Comments', render: (v) => <span className="stat-number">{fmt(v)}</span> },
              ]}
              rows={summaryRows}
              isJoolaRow={(r) => r.b?.is_joola}
            />
          </Card>

          <SectionDivider label="Engagement Analysis" icon={<IconChart />} />

          {/* ── Engagement Benchmarking ───────────────── */}
          <Card title="Instagram Engagement Benchmarking" className="mb-4">
            <p className="text-[12px] mb-4" style={{ color: '#cbd5e1' }}>
              Engagement rate = (avg likes + avg comments) / followers × 100. Calculated from {igPosts.length} scraped posts.
            </p>
            <DataTable
              columns={[
                { key: 'brand',       label: 'Brand',          render: (_, r) => <BrandBadge name={r.brand?.name || '?'} isJoola={r.brand?.is_joola} />, sortValue: (r) => r.brand?.name || '' },
                { key: 'followers',   label: 'Followers',      render: (_, r) => <span className="stat-number">{fmt(r.followers)}</span> },
                { key: 'avgLikes',    label: 'Avg Likes',      render: (_, r) => <span className="stat-number">{r.avgLikes.toFixed(0)}</span> },
                { key: 'avgComments', label: 'Avg Comments',   render: (_, r) => <span className="stat-number">{r.avgComments.toFixed(0)}</span> },
                { key: 'engRate',     label: 'Eng. Rate',      render: (_, r) => (
                  <span className="stat-number font-bold" style={{ color: r.engRate > 3 ? '#22c55e' : r.engRate > 1 ? '#f59e0b' : '#cbd5e1' }}>
                    {r.engRate.toFixed(2)}%
                  </span>
                )},
                { key: 'postCount',   label: 'Posts Analyzed' },
                { key: 'sov',         label: 'Share of Voice', render: (_, r) => <span className="stat-number font-semibold">{r.sov.toFixed(1)}%</span> },
              ]}
              rows={metrics}
              isJoolaRow={(r) => r.brand?.is_joola}
            />
          </Card>

          {/* ── SOV + Eng Rate ───────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <Card title="Share of Voice (%)">
              <CSSBar items={metrics.map(m => ({ label: m.brand?.name || '?', value: m.sov, isJoola: m.brand?.is_joola, formatted: m.sov.toFixed(1) + '%' }))} />
            </Card>
            <Card title="Engagement Rate by Brand">
              <CSSBar
                items={[...metrics].sort((a, b) => b.engRate - a.engRate).map(m => ({
                  label: m.brand?.name || '?', value: m.engRate,
                  isJoola: m.brand?.is_joola, color: '#f59e0b', formatted: m.engRate.toFixed(2) + '%',
                }))}
                defaultColor="#f59e0b"
              />
            </Card>
          </div>

          {/* ── Engagement Quality Matrix ─────────────── */}
          <Card title="Engagement Quality Matrix" className="mb-4">
            <DataTable
              columns={[
                { key: 'brand',     label: 'Brand',     render: (_, r) => <BrandBadge name={r.brand?.name || '?'} isJoola={r.brand?.is_joola} />, sortValue: (r) => r.brand?.name || '' },
                { key: 'followers', label: 'Followers', render: (_, r) => <span className="stat-number">{fmt(r.followers)}</span> },
                { key: 'engRate',   label: 'Eng. Rate', render: (_, r) => (
                  <span className="stat-number font-bold" style={{ color: r.engRate > 3 ? '#22c55e' : r.engRate > 1 ? '#f59e0b' : '#ef4444' }}>
                    {r.engRate.toFixed(2)}%
                  </span>
                )},
                { key: 'quad', label: 'Quadrant', render: (_, r) => {
                  const hf = r.followers > maxFollowers * 0.4, he = r.engRate > 1
                  const { l, c } = hf && he ? { l: 'Large Reach + High Quality', c: '#22c55e' }
                    : hf && !he ? { l: 'Large Reach / Avg Quality', c: '#f59e0b' }
                    : !hf && he ? { l: 'High Quality / Niche Reach', c: '#818cf8' }
                    : { l: 'Low Reach / Low Quality', c: '#ef4444' }
                  return (
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c }} />
                      <span style={{ color: c }}>{l}</span>
                    </span>
                  )
                }},
                { key: 'assess', label: 'Assessment', render: (_, r) => (
                  <span className="text-[12px]" style={{ color: '#cbd5e1' }}>
                    {r.brand?.is_joola ? 'Market leader — engagement uplift is the #1 priority'
                      : r.engRate > 5 ? 'High-quality community — watch closely'
                      : r.engRate > 1 ? 'Solid performer'
                      : 'Low engagement — weakness to exploit'}
                  </span>
                )},
              ]}
              rows={[...metrics].sort((a, b) => b.engRate - a.engRate)}
              isJoolaRow={(r) => r.brand?.is_joola}
            />

            {/* Strategic Insight Box */}
            <div className="mt-5 p-4 rounded-xl"
              style={{ background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)' }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
                <p className="text-[12px] font-bold" style={{ color: '#22c55e' }}>Strategic Insight</p>
              </div>
              <p className="text-[13px] leading-relaxed" style={{ color: '#cbd5e1' }}>
                JOOLA has the largest reach but sits in the average engagement zone. CRBN demonstrates that a focused community strategy can generate outsized engagement on a smaller base. JOOLA's opportunity is to import CRBN's tactics (VIP funnels, comment gating, giveaways) while leveraging its superior reach advantage.
              </p>
            </div>
          </Card>

          <SectionDivider label="Competitive Positioning" icon={<IconMap />} />

          <Card title="Competitive Positioning Map" className="mb-4">
            <DataTable
              columns={[
                { key: 'brand',      label: 'Brand',    render: (b, r) => <BrandBadge name={b} isJoola={r.isJoola} /> },
                { key: 'price',      label: 'Price',    render: (v) => <span className="text-[12px]" style={{ color: '#cbd5e1' }}>{v}</span> },
                { key: 'identity',   label: 'Identity', render: (v) => <span className="text-[12px]" style={{ color: '#cbd5e1' }}>{v}</span> },
                { key: 'community',  label: 'Community',render: (v) => <span className="text-[12px]" style={{ color: '#cbd5e1' }}>{v}</span> },
                { key: 'assessment', label: 'Assessment',render: (v) => <span className="text-[12px]" style={{ color: '#e2e8f0' }}>{v}</span> },
              ]}
              rows={positioningData}
              isJoolaRow={(r) => r.isJoola}
            />
          </Card>

          <SectionDivider label="Strategy & Opportunities" icon={<IconZap />} />

          {/* ── Content Gap Analysis ──────────────────── */}
          <Card title="Content Strategy Gap Analysis — 8 Gaps" className="mb-4">
            <DataTable
              columns={[
                { key: 'num', label: '#', render: (v) => <span className="font-black text-[#22c55e]">{v}</span> },
                { key: 'gap', label: 'Gap', render: (v) => <span className="text-[13px] font-semibold" style={{ color: '#f1f5f9', whiteSpace: 'nowrap' }}>{v}</span> },
                { key: 'who', label: 'Who Does It', render: (v) => <span className="text-[12px]" style={{ color: '#cbd5e1' }}>{v}</span> },
                { key: 'opportunity', label: 'JOOLA Opportunity', render: (v) => <span className="text-[12px]" style={{ color: '#e2e8f0' }}>{v}</span> },
                { key: 'impact', label: 'Impact', render: (v) => (
                  <span className={v === 'HIGH' ? 'pill-green' : 'pill-amber'}>{v}</span>
                )},
              ]}
              rows={contentGaps}
            />
          </Card>

          {/* ── Growth Ops ───────────────────────────── */}
          <div className="mb-6">
            <p className="text-[11px] font-bold uppercase tracking-widest mb-4" style={{ color: '#cbd5e1' }}>
              Top 5 Growth Opportunities for JOOLA
            </p>
            <div className="space-y-3">
              {growthOps.map((op, i) => (
                <div key={i} className="rounded-2xl overflow-hidden flex transition-all duration-200 cursor-default group"
                  style={{
                    background: 'rgba(10,15,25,0.8)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    backdropFilter: 'blur(16px)',
                  }}>
                  {/* Number block */}
                  <div className="w-16 min-w-[64px] flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(34,197,94,0.06)', borderRight: '1px solid rgba(34,197,94,0.12)' }}>
                    <span className="text-[22px] font-black stat-number" style={{ color: 'rgba(34,197,94,0.6)' }}>{op.num}</span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 p-4">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-[14px] font-bold" style={{ color: '#f1f5f9' }}>{op.title}</span>
                      <span className="pill-green">{op.timing}</span>
                      <span className="pill-amber">{op.impact}</span>
                    </div>
                    <p className="text-[13px] leading-relaxed mb-3" style={{ color: '#cbd5e1' }}>{op.body}</p>
                    <div className="rounded-xl p-3"
                      style={{ background: 'rgba(34,197,94,0.05)', borderLeft: '2px solid rgba(34,197,94,0.4)' }}>
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#22c55e' }}>Action: </span>
                      <span className="text-[13px]" style={{ color: '#e2e8f0' }}>{op.action}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
