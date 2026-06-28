'use client'

import { useEffect, useState } from 'react'
import {
  fetchBrands, fetchIG, fetchTopIGPosts, fetchPostFrequency, fetchIGCommentMentions,
  fetchIGDominantTheme,
  type V2Brand, type V2IGRow, type V2TopIGPost, type V2IGMentionRow, type V2IGTheme,
} from '@/lib/v2/data'
import { fmt, LineChart, EngagementQualityMatrix, Sparkline } from '@/components/v2/charts'
import { PageHead, pgColor, pgName, LoadingPage, SectionInfo, SortTh, FilterBanner, ColumnFilter, exportCSV } from '@/components/v2/PageShell'
import { PlatformPlaybook } from '@/components/v2/PlatformPlaybook'
import { instagramPlaybook } from '@/lib/v2/playbook'
import { useBrandFilter, applyBrandFilter, applyBrandFilterRecord } from '@/lib/v2/BrandFilterContext'
import { useDateRange, applyDateRangeCustom, DATE_RANGE_LABEL } from '@/lib/v2/DateRangeContext'
import { formatCalendarDateFromDaysAgo } from '@/lib/v2/format'
import { useReveal, revealCls } from '@/lib/v2/animations'

/** Relative caption ("3 days ago") kept only for the title tooltip on date cells. */
function relativeLabel(days: number): string {
  return days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
}

/** Map raw API/post format codes to human-friendly labels. */
const FORMAT_LABEL: Record<string, string> = {
  SIDECAR: 'Carousel',
  VIDEO: 'Video',
  IMAGE: 'Image',
  CAROUSEL: 'Carousel',
  REEL: 'Reel',
}

/** Minimum follower threshold for ER-based rankings — anything below is a scraping artifact. */
const ER_MIN_FOLLOWERS = 50

// brand-slug → IG handle (mirrors backend/scraping/config/brands.yaml)
const IG_HANDLES: Record<string, string> = {
  joola:       'joolapickleball',
  selkirk:     'selkirksport',
  paddletek:   'paddletek_pickleball',
  crbn:        'crbn_pickleball',
  'six-zero':  'sixzeropickleball',
  engage:      'engagepickleball',
  onix:        'onix_pickleball',
  franklin:    'franklinpickleball',
  head:        'headpickleball',
  wilson:      'wilsonsportinggoods',
  gamma:       'gammasportsusa',
}

const isVideoFormat = (f: string) => f === 'Video' || f === 'Reel' || f === 'VIDEO' || f === 'REEL'
const isCarouselFormat = (f: string) => f === 'Carousel' || f === 'CAROUSEL' || f === 'SIDECAR'
const isImageFormat = (f: string) => f === 'Image' || f === 'IMAGE'

export default function InstagramPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [ig, setIg] = useState<V2IGRow[]>([])
  const [posts, setPosts] = useState<V2TopIGPost[]>([])
  const [freq, setFreq] = useState<Record<string, number[][]>>({})
  const [paddleMentions, setPaddleMentions] = useState<V2IGMentionRow[]>([])
  const [playerMentions, setPlayerMentions] = useState<V2IGMentionRow[]>([])
  const [themes, setThemes] = useState<V2IGTheme[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [formatFilter, setFormatFilter] = useState<'all' | 'reels' | 'carousels' | 'images'>('all')
  const [colFilter, setColFilter] = useState<Record<string, string>>({})
  const [igDrillBrand, setIgDrillBrand] = useState<string | null>(null)
  const [selectedEQDot, setSelectedEQDot] = useState<import('@/components/v2/charts').EQMatrixDatum | null>(null)
  const [bwSortKey, setBwSortKey] = useState<string>('followers')
  const [bwSortDir, setBwSortDir] = useState<'asc' | 'desc'>('desc')
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()
  const { range, effectiveFrom, effectiveTo } = useDateRange()

  useEffect(() => { document.title = 'JOOLA INTEL — Instagram' }, [])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedEQDot(null) }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [])

  useEffect(() => {
    fetchBrands().then(async (b) => {
      try {
        const [i, p, f, pm, plm, th] = await Promise.all([
          fetchIG(b),
          fetchTopIGPosts(b, 200),
          fetchPostFrequency(b),
          fetchIGCommentMentions(b, 'paddle', 30),
          fetchIGCommentMentions(b, 'player', 30),
          fetchIGDominantTheme(b),
        ])
        setBrands(b); setAllBrands(b)
        setIg(i); setPosts(p); setFreq(f)
        setPaddleMentions(pm); setPlayerMentions(plm)
        setThemes(th)
        setLoading(false)
      } catch (err) {
        console.error('Instagram data fetch failed', err)
        setError('Unable to load Instagram data. Please refresh.')
        setLoading(false)
      }
    }).catch(err => {
      console.error('Brands fetch failed', err)
      setError('Unable to load data. Please refresh.')
      setLoading(false)
    })
  }, [setAllBrands])

  const sec1 = useReveal()
  const sec2 = useReveal()
  const sec3 = useReveal()

  if (loading) return <LoadingPage />
  if (error) return (
    <div style={{ padding: '80px 32px', textAlign: 'center' }}>
      <div style={{ color: '#ef4444', fontSize: 14, marginBottom: 16 }}>{error}</div>
      <button className="btn btn-yellow" onClick={() => window.location.reload()} aria-label="Refresh page">Refresh page</button>
    </div>
  )

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const name = (s: string) => pgName(s, brands)

  // ─── Brand + date filters ────────────────────────────────────────────
  const displayIg = applyBrandFilter(ig, filteredBrands, isFiltered)
  const displayPostsBrand = applyBrandFilter(posts, filteredBrands, isFiltered)
  const displayPosts = applyDateRangeCustom(displayPostsBrand, effectiveFrom, effectiveTo)
  const displayFreq = applyBrandFilterRecord(freq, filteredBrands, isFiltered)
  const displayPaddleMentions = applyBrandFilter(paddleMentions, filteredBrands, isFiltered)
  const displayPlayerMentions = applyBrandFilter(playerMentions, filteredBrands, isFiltered)

  // ─── ER (engagement rate) eligible brands ────────────────────────────
  // Two guards: (1) follower threshold filters out scraping artefacts,
  // (2) defensive 100% cap on display in case any DB-sourced engRate slips through.
  const erEligible = displayIg
    .filter(r => r.followers >= ER_MIN_FOLLOWERS)
    .map(r => {
      if (r.engRate > 100) {
        // eslint-disable-next-line no-console
        console.warn(`[Instagram] ${r.brand} engagement rate ${r.engRate.toFixed(1)}% exceeds 100% — excluding from matrix.`)
        return null
      }
      return { ...r, engRate: Math.min(100, r.engRate) }
    })
    .filter((r): r is V2IGRow => r !== null)
  const erSorted = [...erEligible].sort((a, b) => b.engRate - a.engRate)

  // ─── Top posts table (with ER calc) ─────────────────────────────────
  // Per-post ER is (likes + comments) / followers * 100 — cap at 100% so a
  // single freak post on a tiny account never renders an absurd number.
  const postsWithER = displayPosts.map((p) => {
    const igRow = displayIg.find((r) => r.brand === p.brand)
    const useFollowers = igRow && igRow.followers >= ER_MIN_FOLLOWERS
    const raw = useFollowers && igRow!.followers > 0
      ? ((p.likes + p.comments) / igRow!.followers) * 100
      : 0
    return { ...p, engRate: Math.min(100, raw) }
  })

  const filteredByFormat = formatFilter === 'all' ? postsWithER
    : formatFilter === 'reels'     ? postsWithER.filter(p => isVideoFormat(p.format))
    : formatFilter === 'carousels' ? postsWithER.filter(p => isCarouselFormat(p.format))
    : postsWithER.filter(p => isImageFormat(p.format))

  const filteredPosts = filteredByFormat.filter(v => {
    const rec = v as unknown as Record<string, unknown>
    return Object.entries(colFilter).every(([col, q]) => {
      if (!q) return true
      const cell = col === 'brand' ? name(v.brand) : String(rec[col] ?? '')
      return cell.toLowerCase().includes(q.toLowerCase())
    })
  })

  const sortedPosts = sortKey ? [...filteredPosts].sort((a, b) => {
    const av = (a as Record<string, unknown>)[sortKey]
    const bv = (b as Record<string, unknown>)[sortKey]
    if (typeof av === 'number' && typeof bv === 'number')
      return sortDir === 'asc' ? av - bv : bv - av
    return sortDir === 'asc'
      ? String(av ?? '').localeCompare(String(bv ?? ''))
      : String(bv ?? '').localeCompare(String(av ?? ''))
  }) : [...filteredPosts].sort((a, b) => b.engRate - a.engRate)

  // ─── Engagement Quality Matrix data ─────────────────────────────────
  // posts sampled per brand (real count, not the hard-coded 30 from before)
  const postsPerBrand: Record<string, number> = {}
  displayPosts.forEach(p => { postsPerBrand[p.brand] = (postsPerBrand[p.brand] || 0) + 1 })
  const eqData = erEligible.map((d) => ({
    brand: d.brand, name: name(d.brand), color: pgColor(d.brand),
    followers: d.followers, engRate: d.engRate,
    posts: postsPerBrand[d.brand] ?? 0,
  }))

  // ─── Follower trajectory (now in Additional Insights, compact) ──────
  const trendLen = Math.max(1, ...displayIg.slice(0, 7).map(d => d.trend.length))
  const xLabels = Array.from({ length: trendLen }, (_, i) =>
    new Date(Date.now() - (trendLen - 1 - i) * 7 * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  )
  const lineSeries = displayIg.slice(0, 7).map((d) => ({
    id: d.brand, label: name(d.brand), color: pgColor(d.brand), data: d.trend,
  }))

  const maxER = erSorted[0]?.engRate || 1
  const freqBrands = Object.keys(displayFreq).length > 0
    ? Object.keys(displayFreq)
    : ['joola', 'selkirk', 'crbn', 'engage', 'paddletek']

  // View count is only meaningful for video formats; image/carousel posts legitimately have 0 views.
  function renderViews(v: V2TopIGPost & { engRate: number }) {
    if (v.views > 0) return fmt(v.views)
    const isVid = isVideoFormat(v.format)
    return (
      <span title={isVid ? 'View count not available' : 'Views are only reported for videos and reels'} style={{ color: 'var(--fg-4)' }}>—</span>
    )
  }

  const maxPaddle = displayPaddleMentions[0]?.mentions || 1
  const maxPlayer = displayPlayerMentions[0]?.mentions || 1

  return (
    <div className="ov-page-enter">
      <PageHead
        title="INSTAGRAM"
        actions={
          <a
            href="https://www.instagram.com/joolapickleball"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost"
            aria-label="View JOOLA on Instagram"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ marginRight: 5 }}><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" stroke="none"/></svg>
            JOOLA on Instagram ↗
          </a>
        }
      />
      <FilterBanner />

      {/* ── Brand Details Modal ── */}
      {igDrillBrand && (() => {
        const igRow   = displayIg.find(r => r.brand === igDrillBrand)
        const bColor  = pgColor(igDrillBrand)
        const bName   = name(igDrillBrand)
        const isJ     = igDrillBrand === 'joola'
        const bPosts  = displayPosts.filter(p => p.brand === igDrillBrand)
        const topPosts = [...bPosts].sort((a, b) => b.likes - a.likes).slice(0, 5)
        const avgLikes    = bPosts.length ? Math.round(bPosts.reduce((s, p) => s + p.likes, 0) / bPosts.length) : 0
        const avgComments = bPosts.length ? Math.round(bPosts.reduce((s, p) => s + p.comments, 0) / bPosts.length) : 0
        const theme   = themes.find(t => t.brand === igDrillBrand)
        const erRank  = erSorted.findIndex(r => r.brand === igDrillBrand) + 1
        const freqGrid = displayFreq[igDrillBrand] || []
        type FmtB = { sum: number; n: number }
        const fa: Record<string, FmtB> = { reel: { sum: 0, n: 0 }, car: { sum: 0, n: 0 }, img: { sum: 0, n: 0 } }
        bPosts.forEach(p => {
          if (isVideoFormat(p.format))        { fa.reel.sum += p.likes; fa.reel.n++ }
          else if (isCarouselFormat(p.format)) { fa.car.sum  += p.likes; fa.car.n++  }
          else if (isImageFormat(p.format))    { fa.img.sum  += p.likes; fa.img.n++  }
        })
        const fmtAvg = { reel: fa.reel.n ? fa.reel.sum / fa.reel.n : 0, car: fa.car.n ? fa.car.sum / fa.car.n : 0, img: fa.img.n ? fa.img.sum / fa.img.n : 0 }
        const fmtMax = Math.max(1, fmtAvg.reel, fmtAvg.car, fmtAvg.img)
        const FMT_DEF = [
          { key: 'reel', label: 'Reels / Video', color: '#818cf8', n: fa.reel.n, avg: fmtAvg.reel },
          { key: 'car',  label: 'Carousel',      color: '#F5E625', n: fa.car.n,  avg: fmtAvg.car  },
          { key: 'img',  label: 'Image',          color: '#34d399', n: fa.img.n,  avg: fmtAvg.img  },
        ]
        const maxER = Math.max(1, ...erSorted.map(r => r.engRate))

        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={() => setIgDrillBrand(null)}>
            <div style={{ background: 'var(--bg)', border: `1px solid ${isJ ? 'rgba(34,197,94,0.3)' : 'var(--wb-10)'}`, borderRadius: 14, width: '100%', maxWidth: 920, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 32px 80px rgba(0,0,0,0.9)' }}
              onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: bColor }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 17, color: isJ ? '#22c55e' : '#fff' }}>{bName}</div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Instagram Intelligence · {bPosts.length} posts in window</div>
                </div>
                {igRow?.deltaPct != null && (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 5, background: igRow.deltaPct >= 0 ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: igRow.deltaPct >= 0 ? '#22c55e' : '#ef4444' }}>
                    {igRow.deltaPct >= 0 ? '▲' : '▼'} {Math.abs(igRow.deltaPct).toFixed(2)}% this week
                  </span>
                )}
                <button onClick={() => setIgDrillBrand(null)} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 24, cursor: 'pointer', lineHeight: 1 }}>×</button>
              </div>

              {/* Body */}
              <div style={{ overflowY: 'auto', flex: 1, padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 20 }}>

                {/* KPI strip */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px,1fr))', gap: 8 }}>
                  {[
                    { l: 'Followers',    v: igRow ? fmt(igRow.followers) : '—', c: isJ ? '#22c55e' : '#60a5fa', tip: 'Latest follower count' },
                    { l: 'Eng. Rate',    v: igRow ? `${igRow.engRate.toFixed(2)}%` : '—', c: igRow && igRow.engRate > 3 ? '#22c55e' : igRow && igRow.engRate > 1 ? '#F5E625' : '#ef4444', tip: '(avg likes+comments)÷followers×100' },
                    { l: 'ER Rank',      v: erRank > 0 ? `#${erRank} of ${erSorted.length}` : '—', c: '#F5E625', tip: 'Engagement rate rank among all tracked brands' },
                    { l: 'Posts',        v: String(bPosts.length), c: 'var(--fg)', tip: 'Posts in current date window' },
                    { l: 'Avg Likes',    v: avgLikes > 0 ? fmt(avgLikes) : '—', c: '#f97316', tip: 'Average likes per post' },
                    { l: 'Avg Comments', v: avgComments > 0 ? fmt(avgComments) : '—', c: '#a78bfa', tip: 'Average comments per post' },
                  ].map(m => (
                    <div key={m.l} title={m.tip} style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px', cursor: 'help' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>{m.l}</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: m.c, fontFamily: 'JetBrains Mono' }}>{m.v}</div>
                    </div>
                  ))}
                </div>

                {/* Follower trend */}
                {igRow && igRow.trend.length > 1 && (
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Follower trend · {igRow.trend.length} weeks</div>
                    <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 8, padding: '10px 12px' }}>
                      <Sparkline data={igRow.trend} color={isJ ? '#22c55e' : bColor} w={800} h={44} />
                    </div>
                  </div>
                )}

                {/* Content format mix */}
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Content format mix · avg likes per format</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {FMT_DEF.map(f => (
                      <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }} title={`${f.label}: avg ${fmt(Math.round(f.avg))} likes across ${f.n} posts`}>
                        <span style={{ width: 80, fontSize: 11, color: 'var(--fg-4)', textAlign: 'right', flexShrink: 0 }}>{f.label}</span>
                        <div style={{ flex: 1, height: 14, background: 'var(--line-2)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.max(f.avg > 0 ? 2 : 0, (f.avg / fmtMax) * 100)}%`, background: f.color, borderRadius: 3, opacity: 0.85 }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: f.avg > 0 ? f.color : 'var(--fg-4)', minWidth: 50, textAlign: 'right', fontFamily: 'JetBrains Mono' }}>{f.avg > 0 ? fmt(Math.round(f.avg)) : '—'}</span>
                        <span style={{ fontSize: 10, color: 'var(--fg-4)', minWidth: 30 }}>{f.n > 0 ? `${f.n}p` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ER vs all brands */}
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Engagement rate vs all brands</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {erSorted.map(r => (
                      <div key={r.brand} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: r.brand === igDrillBrand ? 1 : 0.55 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: pgColor(r.brand), flexShrink: 0 }} />
                        <span style={{ fontSize: 11, minWidth: 110, fontWeight: r.brand === igDrillBrand ? 800 : 400, color: r.brand === igDrillBrand ? (isJ ? '#22c55e' : bColor) : 'var(--fg-3)' }}>{name(r.brand)}</span>
                        <div style={{ flex: 1, height: 10, background: 'var(--line-2)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${(r.engRate / maxER) * 100}%`, background: r.brand === igDrillBrand ? (isJ ? '#22c55e' : bColor) : pgColor(r.brand), borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-3)', minWidth: 46, textAlign: 'right', fontFamily: 'JetBrains Mono' }}>{r.engRate.toFixed(2)}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Posting cadence */}
                {freqGrid.length > 0 && (
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Posting cadence · last 4 weeks</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                      {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
                        <div key={d} style={{ textAlign: 'center', fontSize: 9, color: '#6b7280', marginBottom: 2 }}>{d}</div>
                      ))}
                      {(freqGrid.flat ? freqGrid.flat() : []).map((v: number, i: number) => {
                        const dayIdx = i % 7
                        const weekIdx = Math.floor(i / 7)
                        const dayName = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][dayIdx]
                        return (
                          <div key={i} title={`Week ${weekIdx + 1} · ${dayName}: ${v} post${v !== 1 ? 's' : ''}`} style={{ height: 22, background: v === 0 ? 'var(--wb-3)' : bColor + (['00','55','88','bb','ff'][Math.min(v,4)]), borderRadius: 4, cursor: 'default' }} />
                        )
                      })}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#6b7280', marginTop: 4 }}>
                      <span>4 weeks ago</span><span>This week</span>
                    </div>
                  </div>
                )}

                {/* Dominant theme */}
                {theme?.theme && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.18)', borderRadius: 8 }}>
                    <span style={{ fontSize: 20 }}>📌</span>
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Dominant content theme</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#a78bfa', textTransform: 'capitalize', marginTop: 2 }}>{theme.theme}</div>
                    </div>
                    {theme.weekNumber && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#6b7280' }}>Week {theme.weekNumber}</span>}
                  </div>
                )}

                {/* Top posts */}
                {topPosts.length > 0 && (
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Top {topPosts.length} posts by likes</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {topPosts.map((p, i) => (
                        <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--wb-5)', borderRadius: 7 }}>
                          <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, minWidth: 16 }}>#{i+1}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, color: 'var(--fg-3)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                              {p.caption || '(no caption)'}
                            </div>
                            <div style={{ display: 'flex', gap: 12, marginTop: 5, fontSize: 11 }}>
                              <span style={{ color: '#f97316', fontWeight: 700 }}>♥ {fmt(p.likes)}</span>
                              <span style={{ color: '#a78bfa' }}>💬 {fmt(p.comments)}</span>
                              <span style={{ color: '#6b7280', fontSize: 10 }}>{p.format}</span>
                              {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', color: bColor, fontSize: 10, fontWeight: 600, textDecoration: 'none' }} onClick={e => e.stopPropagation()}>View ↗</a>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ padding: '10px 22px', borderTop: '1px solid var(--line)', fontSize: 11, color: '#6b7280', display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
                <span>Instagram Intelligence · {bName}</span>
                <span>Press Esc to close</span>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Brand-wise Analysis Table ── */}
      <section ref={sec1.ref} className={revealCls(sec1.vis)} style={{ marginBottom: 28 }}>
        <div className="section-head">
          <div>
            <h2>Brand-wise analysis <SectionInfo title="Brand-wise Instagram Analysis" description="Per-brand summary of all Instagram signals. Click any row for full details." source="ig_profiles_weekly · ig_posts" /></h2>
            <div className="sub">{displayIg.length} brands · click a row to view full brand intelligence</div>
          </div>
        </div>
        <div className="card">
          <div className="table-wrap">
            <table className="data" style={{ width: '100%' }}>
              <thead><tr>
                {(['brand','followers','deltaPct','engRate','erRank','posts','avgLikes','bestFmt','trend'] as const).map(k => {
                  const labelMap: Record<string, string> = { brand: 'Brand', followers: 'Followers', deltaPct: 'Follower Growth', engRate: 'Eng. Rate', erRank: 'ER Rank', posts: 'Posts', avgLikes: 'Avg Likes', bestFmt: 'Best Format', trend: 'Trend' }
                  return <SortTh key={k} col={k} label={labelMap[k]} sortKey={bwSortKey} sortDir={bwSortDir} toggle={(c) => { if (bwSortKey === c) setBwSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setBwSortKey(c); setBwSortDir('desc') } }} />
                })}
                <th style={{ textAlign: 'center' }}>Profile</th>
              </tr></thead>
              <tbody>
                {(() => {
                  const rows = displayIg.map(igRow => {
                    const bPosts = displayPosts.filter(p => p.brand === igRow.brand)
                    const avgLikes = bPosts.length ? Math.round(bPosts.reduce((s, p) => s + p.likes, 0) / bPosts.length) : 0
                    type FB = { sum: number; n: number }
                    const fa: Record<string, FB> = { reel: { sum: 0, n: 0 }, car: { sum: 0, n: 0 }, img: { sum: 0, n: 0 } }
                    bPosts.forEach(p => {
                      if (isVideoFormat(p.format))        { fa.reel.sum += p.likes; fa.reel.n++ }
                      else if (isCarouselFormat(p.format)) { fa.car.sum += p.likes; fa.car.n++ }
                      else if (isImageFormat(p.format))    { fa.img.sum += p.likes; fa.img.n++ }
                    })
                    const fmtAvg = { reel: fa.reel.n ? fa.reel.sum / fa.reel.n : 0, car: fa.car.n ? fa.car.sum / fa.car.n : 0, img: fa.img.n ? fa.img.sum / fa.img.n : 0 }
                    const bestFmtKey = fmtAvg.reel >= fmtAvg.car && fmtAvg.reel >= fmtAvg.img ? 'reel' : fmtAvg.car >= fmtAvg.img ? 'car' : 'img'
                    const bestFmtMap = { reel: { label: 'Reels', color: '#818cf8' }, car: { label: 'Carousel', color: '#F5E625' }, img: { label: 'Image', color: '#34d399' } }
                    const erRank = erSorted.findIndex(r => r.brand === igRow.brand) + 1
                    const theme = themes.find(t => t.brand === igRow.brand)
                    return { igRow, bPostsLen: bPosts.length, avgLikes, bestFmt: bestFmtMap[bestFmtKey], erRank, theme }
                  }).sort((a, b) => {
                    if (a.igRow.brand === 'joola') return -1
                    if (b.igRow.brand === 'joola') return 1
                    const getV = (x: typeof a): number | string => {
                      if (bwSortKey === 'followers') return x.igRow.followers
                      if (bwSortKey === 'deltaPct')  return x.igRow.deltaPct ?? -999
                      if (bwSortKey === 'engRate')   return x.igRow.engRate
                      if (bwSortKey === 'erRank')    return x.erRank
                      if (bwSortKey === 'posts')     return x.bPostsLen
                      if (bwSortKey === 'avgLikes')  return x.avgLikes
                      if (bwSortKey === 'brand')     return name(x.igRow.brand)
                      return 0
                    }
                    const av = getV(a), bv = getV(b)
                    if (typeof av === 'number' && typeof bv === 'number') return bwSortDir === 'asc' ? av - bv : bv - av
                    return bwSortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
                  })

                  return rows.map(({ igRow, bPostsLen, avgLikes, bestFmt, erRank, theme }) => {
                    const isJ = igRow.brand === 'joola'
                    return (
                      <tr key={igRow.brand}
                        style={{ cursor: 'pointer', borderLeft: isJ ? '3px solid #22c55e' : '3px solid transparent' }}
                        onClick={() => setIgDrillBrand(igRow.brand)}>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: pgColor(igRow.brand) }} />
                            <span style={{ fontWeight: 700, color: isJ ? '#22c55e' : 'var(--fg)' }}>{name(igRow.brand)}</span>
                          </span>
                        </td>
                        <td className="cell-num" style={{ fontWeight: 700, fontFamily: 'JetBrains Mono' }}>{fmt(igRow.followers)}</td>
                        <td className="cell-num">
                          {igRow.deltaPct != null ? (
                            <span style={{ fontWeight: 700, color: igRow.deltaPct >= 0 ? '#22c55e' : '#ef4444', fontFamily: 'JetBrains Mono', fontSize: 11 }}>
                              {igRow.deltaPct >= 0 ? '▲' : '▼'} {Math.abs(igRow.deltaPct).toFixed(2)}%
                            </span>
                          ) : '—'}
                        </td>
                        <td className="cell-num">
                          <span style={{ fontWeight: 700, color: igRow.engRate > 3 ? '#22c55e' : igRow.engRate > 1 ? '#F5E625' : '#ef4444', fontFamily: 'JetBrains Mono' }}>
                            {igRow.engRate.toFixed(2)}%
                          </span>
                        </td>
                        <td className="cell-num" style={{ color: '#F5E625', fontWeight: 700 }}>#{erRank}</td>
                        <td className="cell-num">{bPostsLen}</td>
                        <td className="cell-num" style={{ fontFamily: 'JetBrains Mono', color: '#f97316', fontWeight: 700 }}>{avgLikes > 0 ? fmt(avgLikes) : '—'}</td>
                        <td>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: bestFmt.color + '18', color: bestFmt.color, border: `1px solid ${bestFmt.color}33` }}>
                            {bestFmt.label}
                          </span>
                        </td>
                        <td>{igRow.trend.length > 1 ? <Sparkline data={igRow.trend} color={isJ ? '#22c55e' : pgColor(igRow.brand)} w={80} h={22} /> : '—'}</td>
                        <td onClick={e => e.stopPropagation()}>
                          {IG_HANDLES[igRow.brand] ? (
                            <a
                              href={`https://www.instagram.com/${IG_HANDLES[igRow.brand]}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-ghost"
                              style={{ fontSize: 10, padding: '3px 8px' }}
                            >
                              View ↗
                            </a>
                          ) : '—'}
                        </td>
                      </tr>
                    )
                  })
                })()}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <PlatformPlaybook
        title="Instagram Playbook"
        sub="Rule-derived competitor moves + recommended JOOLA actions, computed from the same data this page renders."
        findings={instagramPlaybook(brands, displayIg, displayPosts, themes)}
        brands={brands}
      />

      <section ref={sec2.ref} className={revealCls(sec2.vis)} style={{ marginBottom: 28 }}>
        <div className="two-col-even">
          <div>
            <div className="section-head">
              <div>
                <h2>
                  Content format mix · by brand
                  <SectionInfo
                    title="Best-performing format per brand"
                    description="Average likes per post grouped by Instagram post format (Reel/Video, Carousel, Image). Highlights which format earns the most engagement for each competitor — and where JOOLA may be under-investing."
                    source="ig_posts.post_format · GROUP BY (brand, format), AVG(like_count)"
                  />
                </h2>
                <div className="sub">Average likes per post by format · top 6 brands by sample size.</div>
              </div>
            </div>
            <div className="card"><div className="card-pad">
              {(() => {
                const FMT = [
                  { key: 'reel', label: 'Reels / Video', color: '#818cf8', tip: 'Average likes on Reels and video posts' },
                  { key: 'car',  label: 'Carousel',      color: '#F5E625', tip: 'Average likes on carousel (multi-image) posts' },
                  { key: 'img',  label: 'Image',          color: '#34d399', tip: 'Average likes on single-image posts' },
                ] as const
                type FmtAgg = { reel: { sum: number; n: number }; car: { sum: number; n: number }; img: { sum: number; n: number } }
                const agg: Record<string, FmtAgg> = {}
                displayPosts.forEach((p) => {
                  if (!agg[p.brand]) agg[p.brand] = { reel: { sum: 0, n: 0 }, car: { sum: 0, n: 0 }, img: { sum: 0, n: 0 } }
                  if (isVideoFormat(p.format))   { agg[p.brand].reel.sum += p.likes; agg[p.brand].reel.n++ }
                  else if (isCarouselFormat(p.format)) { agg[p.brand].car.sum += p.likes; agg[p.brand].car.n++ }
                  else if (isImageFormat(p.format))    { agg[p.brand].img.sum += p.likes; agg[p.brand].img.n++ }
                })
                const rows = Object.entries(agg).map(([brand, x]) => ({
                  brand,
                  reel: x.reel.n ? x.reel.sum / x.reel.n : 0,
                  car:  x.car.n  ? x.car.sum  / x.car.n  : 0,
                  img:  x.img.n  ? x.img.sum  / x.img.n  : 0,
                  reelN: x.reel.n, carN: x.car.n, imgN: x.img.n,
                  n: x.reel.n + x.car.n + x.img.n,
                })).filter((r) => r.n >= 3).sort((a, b) => {
                  if (a.brand === 'joola') return -1
                  if (b.brand === 'joola') return 1
                  return b.n - a.n
                }).slice(0, 6)
                if (rows.length === 0) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>No posts in current filter window.</div>
                const max = Math.max(1, ...rows.flatMap(r => [r.reel, r.car, r.img]))
                return (
                  <div>
                    {/* Legend */}
                    <div style={{ display: 'flex', gap: 20, marginBottom: 18, flexWrap: 'wrap' }}>
                      {FMT.map(f => (
                        <span key={f.key} title={f.tip} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg-3)', cursor: 'help' }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, background: f.color, flexShrink: 0 }} />
                          {f.label}
                        </span>
                      ))}
                      <span style={{ fontSize: 11, color: 'var(--fg-4)', marginLeft: 'auto' }}>Avg likes per post</span>
                    </div>

                    {/* Rows */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {rows.map((r) => {
                        const isJ = r.brand === 'joola'
                        const bestKey = r.reel >= r.car && r.reel >= r.img ? 'reel' : r.car >= r.img ? 'car' : 'img'
                        const bestFmt = FMT.find(f => f.key === bestKey)!
                        const counts: Record<string, number> = { reel: r.reelN, car: r.carN, img: r.imgN }
                        const vals:   Record<string, number> = { reel: r.reel,  car: r.car,  img: r.img  }
                        return (
                          <div key={r.brand}>
                            {/* Brand header row */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: pgColor(r.brand), flexShrink: 0 }} />
                              <span style={{ fontWeight: 700, fontSize: 12, color: isJ ? '#22c55e' : 'var(--fg)', minWidth: 110 }}>{name(r.brand)}</span>
                              <span style={{ fontSize: 10, color: 'var(--fg-4)' }}>{r.n} posts</span>
                              <span title={`Best format: ${bestFmt.label} with avg ${fmt(Math.round(vals[bestKey]))} likes`}
                                style={{ marginLeft: 4, fontSize: 9, fontWeight: 700, color: bestFmt.color, background: bestFmt.color + '18', border: `1px solid ${bestFmt.color}44`, borderRadius: 4, padding: '1px 6px', cursor: 'help' }}>
                                ★ Best: {bestFmt.label}
                              </span>
                            </div>
                            {/* 3 format bars */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 16 }}>
                              {FMT.map(f => {
                                const v = vals[f.key]
                                const n = counts[f.key]
                                const pct = Math.max(v > 0 ? 2 : 0, (v / max) * 100)
                                const isBest = f.key === bestKey && v > 0
                                return (
                                  <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                                    title={`${f.label}: avg ${fmt(Math.round(v))} likes across ${n} posts`}>
                                    <span style={{ fontSize: 10, color: 'var(--fg-4)', width: 68, textAlign: 'right', flexShrink: 0 }}>{f.label}</span>
                                    <div style={{ flex: 1, height: 14, background: 'var(--line-2)', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
                                      <div style={{
                                        height: '100%', width: pct + '%',
                                        background: v > 0 ? f.color : 'transparent',
                                        borderRadius: 3,
                                        opacity: isBest ? 1 : 0.55,
                                        transition: 'width 0.4s ease',
                                        boxShadow: isBest ? `0 0 8px ${f.color}66` : 'none',
                                      }} />
                                    </div>
                                    {v > 0 ? (
                                      <span style={{ fontSize: 11, fontWeight: isBest ? 800 : 600, color: isBest ? f.color : 'var(--fg-3)', minWidth: 44, textAlign: 'right', fontFamily: 'JetBrains Mono' }}>
                                        {fmt(Math.round(v))}
                                      </span>
                                    ) : (
                                      <span style={{ fontSize: 10, color: 'var(--fg-4)', minWidth: 44, textAlign: 'right' }}>no data</span>
                                    )}
                                    <span style={{ fontSize: 9, color: 'var(--fg-4)', minWidth: 36 }}>{n > 0 ? `${n}p` : ''}</span>
                                  </div>
                                )
                              })}
                            </div>
                            <div style={{ borderBottom: '1px solid var(--wb-5)', marginTop: 10 }} />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </div></div>
          </div>

          <div>
            <div className="section-head">
              <div>
                <h2>
                  Dominant content theme · by brand
                  <SectionInfo
                    title="AI-tagged dominant theme"
                    description="The single most frequent content theme detected by the GPT-4o-mini enricher over each brand's last 30 IG posts. Reveals each brand's editorial 'lane' on Instagram."
                    source="ig_profiles_weekly.dominant_content_theme · latest week per brand"
                  />
                </h2>
                <div className="sub">Latest weekly snapshot per brand.</div>
              </div>
            </div>
            <div className="card"><div className="card-pad">
              {(() => {
                const THEME_META: Record<string, { icon: string; color: string; desc: string }> = {
                  'pickleball':        { icon: '🏓', color: '#60a5fa', desc: 'General pickleball lifestyle & community content' },
                  'paddle-review':     { icon: '🎯', color: '#F5E625', desc: 'Paddle demos, comparisons & gear reviews' },
                  'tournament':        { icon: '🏆', color: '#f97316', desc: 'Tournament coverage, results & highlights' },
                  'athlete':           { icon: '⭐', color: '#a78bfa', desc: 'Pro player spotlights & ambassador content' },
                  'training':          { icon: '💪', color: '#34d399', desc: 'Drills, coaching tips & skill development' },
                  'product-launch':    { icon: '🚀', color: '#fb7185', desc: 'New product reveals, drops & campaigns' },
                  'lifestyle':         { icon: '🌅', color: '#fbbf24', desc: 'Brand lifestyle & culture storytelling' },
                  'community':         { icon: '🤝', color: '#38bdf8', desc: 'Fan engagement, UGC & community moments' },
                  'promotion':         { icon: '🏷️', color: '#4ade80', desc: 'Sales, discounts & limited-time offers' },
                }
                const getThemeMeta = (raw: string | null) => {
                  if (!raw) return { icon: '📌', color: '#6b7280', desc: 'Uncategorised content' }
                  const key = raw.toLowerCase().trim()
                  return THEME_META[key] || { icon: '📌', color: '#6b7280', desc: raw }
                }
                const filtered = themes.filter(t => t.theme)
                if (filtered.length === 0) return (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>
                    No dominant theme detected yet — re-run IG enrichment.
                  </div>
                )
                // Group by theme to show competitive clustering
                const themeGroups: Record<string, string[]> = {}
                filtered.forEach(t => {
                  const k = (t.theme || '').toLowerCase().trim()
                  if (!themeGroups[k]) themeGroups[k] = []
                  themeGroups[k].push(t.brand)
                })
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {filtered.map((t) => {
                      const meta = getThemeMeta(t.theme)
                      const isJ  = t.brand === 'joola'
                      const competitors = (themeGroups[(t.theme || '').toLowerCase().trim()] || []).filter(b => b !== t.brand)
                      return (
                        <div key={t.brand}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                            background: isJ ? 'rgba(34,197,94,0.05)' : 'rgba(255,255,255,0.025)',
                            border: `1px solid ${isJ ? 'rgba(34,197,94,0.2)' : 'var(--wb-6)'}`,
                            borderRadius: 10,
                          }}>
                          {/* Brand */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 130 }}>
                            <span style={{ width: 9, height: 9, borderRadius: '50%', background: pgColor(t.brand), flexShrink: 0 }} />
                            <span style={{ fontWeight: 700, fontSize: 12, color: isJ ? '#22c55e' : 'var(--fg)' }}>{name(t.brand)}</span>
                          </div>
                          {/* Theme pill */}
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            background: meta.color + '18', border: `1px solid ${meta.color}44`,
                            borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: meta.color,
                            flexShrink: 0,
                          }}>
                            <span>{meta.icon}</span>
                            <span style={{ textTransform: 'capitalize' }}>{t.theme}</span>
                          </span>
                          {/* Description */}
                          <span style={{ fontSize: 11, color: 'var(--fg-4)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {meta.desc}
                          </span>
                          {/* Competitors on same theme */}
                          {competitors.length > 0 && (
                            <span title={`Also: ${competitors.map(b => name(b)).join(', ')}`}
                              style={{ fontSize: 9, color: 'var(--fg-4)', background: 'var(--wb-5)', borderRadius: 4, padding: '2px 6px', flexShrink: 0, cursor: 'help' }}>
                              +{competitors.length} brand{competitors.length > 1 ? 's' : ''} same lane
                            </span>
                          )}
                          {/* Week */}
                          {t.weekNumber && (
                            <span style={{ fontSize: 9, color: 'var(--fg-4)', flexShrink: 0 }}>W{t.weekNumber}</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div></div>
          </div>
        </div>
      </section>

      <section id="instagram-posts-table" ref={sec3.ref} className={revealCls(sec3.vis)}>
        <div className="section-head">
          <div>
            <h2>
              Top {sortedPosts.length} posts · by engagement rate
              <SectionInfo
                title="Best Posts Across All Brands"
                description="Up to the 200 highest-engagement posts pulled from every tracked Instagram account, after de-duplicating shortcodes. Narrow by post format (right), brand filter (top right), date range (top right), or per-column search below. Sort by clicking any column header."
                source="ig_posts · refreshed every Monday. Engagement rate calculated locally as (likes + comments) ÷ followers × 100."
              />
            </h2>
            <div className="sub">
              Showing <strong style={{ color: 'var(--fg)' }}>{sortedPosts.length}</strong> of up to 200 ·
              {' '}{DATE_RANGE_LABEL[range].toLowerCase()} · click column headers to sort.
            </div>
          </div>
          <div className="actions">
            <div className="chip-row">
              <button className={'chip' + (formatFilter === 'all' ? ' on' : '')} onClick={() => setFormatFilter('all')}>All</button>
              <button className={'chip' + (formatFilter === 'reels' ? ' on' : '')} onClick={() => setFormatFilter('reels')}>Reels / Video</button>
              <button className={'chip' + (formatFilter === 'carousels' ? ' on' : '')} onClick={() => setFormatFilter('carousels')}>Carousel</button>
              <button className={'chip' + (formatFilter === 'images' ? ' on' : '')} onClick={() => setFormatFilter('images')}>Image</button>
            </div>
            <button
              onClick={() => exportCSV('joola-ig-posts.csv', sortedPosts as unknown as Record<string, unknown>[])}
              className="btn btn-ghost"
              aria-label="Export table as CSV"
              style={{ fontSize: 11 }}
            >
              ↓ CSV
            </button>
          </div>
        </div>
        <div className="card">
          {sortedPosts.length > 0 ? (
            <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
              <table className="data">
                <thead style={{ position: 'sticky', top: 0, background: 'var(--sticky-bg)', zIndex: 2 }}>
                  <tr>
                    <SortTh col="brand" label="Brand · handle" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                    <SortTh col="caption" label="Caption" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ width: '36%' }} />
                    <SortTh col="format" label="Format" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                    <SortTh col="likes" label="Likes" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                    <SortTh col="comments" label="Comments" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                    <SortTh col="views" label="Views" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                    <SortTh col="engRate" label="Eng. Rate" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                    <SortTh col="days" label="Posted" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                  </tr>
                  <tr className="col-filter-row">
                    <th><ColumnFilter col="brand" value={colFilter.brand} onChange={v => setColFilter(p => ({ ...p, brand: v }))} placeholder="brand…" /></th>
                    <th><ColumnFilter col="caption" value={colFilter.caption} onChange={v => setColFilter(p => ({ ...p, caption: v }))} placeholder="search caption…" /></th>
                    <th colSpan={6} />
                  </tr>
                </thead>
                <tbody>
                  {sortedPosts.map((v, i) => {
                    const formatLabel = FORMAT_LABEL[v.format] || v.format || 'Image'
                    const isVid = isVideoFormat(v.format)
                    const isCar = isCarouselFormat(v.format)
                    return (
                      <tr key={i} className={v.brand === 'joola' ? 'joola' : ''}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="brand-dot" style={{ background: pgColor(v.brand) }} />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontWeight: 700, color: v.brand === 'joola' ? '#22c55e' : 'var(--fg)', fontSize: 12 }}>{name(v.brand)}</span>
                              <a
                                href={`https://www.instagram.com/${v.handle.replace('@', '')}`}
                                target="_blank" rel="noopener noreferrer"
                                className="ext-link"
                                style={{ fontSize: 10 }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {v.handle}
                              </a>
                            </div>
                          </div>
                        </td>
                        <td style={{ color: 'var(--fg)' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                            <span style={{ fontSize: 12 }}>{v.caption?.slice(0, 80) || '—'}</span>
                            {v.url && (
                              <a href={v.url} target="_blank" rel="noopener noreferrer" className="ext-link" style={{ marginTop: 1, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                                View
                                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                              </a>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className={'pill ' + (isVid ? 'pill-info' : isCar ? 'pill-amber' : 'pill-ghost')}>
                            {formatLabel}
                          </span>
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(v.likes)}</td>
                        <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(v.comments)}</td>
                        <td className="cell-num" style={{ textAlign: 'right' }}>{renderViews(v)}</td>
                        <td className="cell-num" style={{ textAlign: 'right', color: v.engRate > 3 ? '#F5E625' : 'var(--fg)' }}>
                          {v.engRate.toFixed(2)}%
                        </td>
                        <td className="cell-num" title={relativeLabel(v.days)}>{formatCalendarDateFromDaysAgo(v.days)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>
              <div style={{ fontSize: 13, marginBottom: 8 }}>No posts match the current filters.</div>
              <div style={{ fontSize: 11 }}>
                Try widening the date range (top right){displayPostsBrand.length > 0 ? `, switching the format chip, or clearing the column search.` : ' or check back after the next weekly refresh.'}
              </div>
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2>
              Engagement quality matrix
              <SectionInfo
                title="Reach vs. Resonance Quadrant"
                description="X-axis = follower count (audience size). Y-axis = engagement rate (audience involvement). Top-right = winning both. Median crosshair divides the grid into the four quadrants; JOOLA's reference lines are green. Hover any dot for full stats and quadrant interpretation."
                source="ig_posts + ig_profiles_weekly · engagement rate = (avg likes + avg comments) ÷ followers × 100. Brands under 50 followers are excluded."
              />
            </h2>
            <div className="sub">
              Followers (reach) × engagement rate (resonance). Top-right = winning. Brands with under {ER_MIN_FOLLOWERS} followers are excluded — ER is unreliable on tiny audiences.
            </div>
          </div>
        </div>
        <div className="card"><div className="card-pad-lg">
          <EngagementQualityMatrix data={eqData} onBubbleClick={d => setSelectedEQDot(d)} />
        </div></div>

        {/* ── EQ dot detail modal ── */}
        {selectedEQDot && (() => {
          const d = selectedEQDot
          const bColor = pgColor(d.brand)
          const isJ = d.brand === 'joola'
          const igRow = displayIg.find(r => r.brand === d.brand)
          const erRank = erSorted.findIndex(r => r.brand === d.brand) + 1
          const erLabel = d.engRate > 3 ? 'Excellent' : d.engRate > 1 ? 'Solid' : 'Low'
          const erLabelColor = d.engRate > 3 ? '#22c55e' : d.engRate > 1 ? '#F5E625' : '#ef4444'
          const xMid = 150000 * 0.25
          const quadrant = d.followers > xMid && d.engRate > (d.engRate / 2)
            ? (d.followers > xMid ? (d.engRate > 1.25 ? 'High Value' : 'Big Reach · Low Eng') : (d.engRate > 1.25 ? 'High Eng · Small Reach' : 'Underperforming'))
            : 'Underperforming'
          const handle = IG_HANDLES[d.brand]
          return (
            <div onClick={() => setSelectedEQDot(null)}
              style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
              <div onClick={e => e.stopPropagation()}
                style={{ background: 'var(--bg)', border: `1px solid ${bColor}55`, borderRadius: 16, width: '100%', maxWidth: 500, overflow: 'hidden', boxShadow: `0 32px 80px rgba(0,0,0,0.65), 0 0 0 1px ${bColor}22` }}>

                {/* Header */}
                <div style={{ background: `linear-gradient(135deg, ${bColor}22 0%, transparent 70%)`, padding: '20px 22px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 42, height: 42, borderRadius: '50%', background: bColor, boxShadow: `0 0 18px ${bColor}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: isJ ? '#22c55e' : '#fff' }}>{d.name}</div>
                      {handle && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>@{handle} · Instagram</div>}
                    </div>
                  </div>
                  <button onClick={() => setSelectedEQDot(null)}
                    style={{ background: 'var(--line)', border: '1px solid var(--wb-12)', borderRadius: 8, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--fg-3)', fontSize: 18, flexShrink: 0 }}>×</button>
                </div>

                {/* Stats */}
                <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                    {[
                      { label: 'Followers',   value: fmt(d.followers),             color: isJ ? '#22c55e' : bColor },
                      { label: 'Eng Rate',    value: d.engRate.toFixed(2) + '%',   color: erLabelColor },
                      { label: 'ER Rank',     value: erRank > 0 ? `#${erRank}` : '—', color: '#F5E625' },
                      { label: 'Posts Sampled', value: d.posts ? String(d.posts) : '—', color: 'var(--fg-2)' },
                      { label: 'Flw Growth',  value: igRow?.deltaPct != null ? (igRow.deltaPct >= 0 ? '+' : '') + igRow.deltaPct.toFixed(2) + '%' : '—', color: igRow?.deltaPct != null ? (igRow.deltaPct >= 0 ? '#22c55e' : '#ef4444') : 'var(--fg-4)' },
                      { label: 'ER Tier',     value: erLabel,                       color: erLabelColor },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ background: 'var(--line-2)', border: `1px solid var(--line)`, borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ fontSize: 9, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color, fontFamily: 'JetBrains Mono', lineHeight: 1 }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Engagement rate bar */}
                  <div style={{ padding: '12px 14px', background: 'var(--wb-3)', borderRadius: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 11 }}>
                      <span style={{ color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.07em', fontSize: 9, fontWeight: 700 }}>Engagement rate vs best in class</span>
                      <span style={{ color: erLabelColor, fontWeight: 700, fontFamily: 'JetBrains Mono' }}>{d.engRate.toFixed(2)}%</span>
                    </div>
                    <div style={{ height: 8, background: 'var(--wb-6)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min(100, (d.engRate / Math.max(1, ...eqData.map(e => e.engRate))) * 100)}%`, background: erLabelColor, borderRadius: 99, transition: 'width 0.5s ease' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 9, color: 'var(--fg-4)' }}>
                      <span>0%</span><span style={{ color: '#F5E625' }}>3% excellent</span><span>{Math.max(...eqData.map(e => e.engRate)).toFixed(1)}% max</span>
                    </div>
                  </div>

                  {/* CTAs */}
                  <div style={{ display: 'flex', gap: 10 }}>
                    {handle && (
                      <a href={`https://www.instagram.com/${handle}`} target="_blank" rel="noopener noreferrer"
                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045)', borderRadius: 10, padding: '10px 0', color: '#fff', fontWeight: 700, fontSize: 12, textDecoration: 'none' }}>
                        View on Instagram ↗
                      </a>
                    )}
                    <button onClick={() => { setSelectedEQDot(null); setIgDrillBrand(d.brand) }}
                      style={{ flex: 1, background: bColor, border: 'none', borderRadius: 10, padding: '10px 0', color: '#000', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
                      Full Brand Detail →
                    </button>
                  </div>
                </div>

                <div style={{ padding: '8px 22px', borderTop: '1px solid var(--wb-6)', fontSize: 10, color: 'var(--fg-4)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>Instagram Intelligence · {d.name}</span>
                  <span>Esc or click outside to close</span>
                </div>
              </div>
            </div>
          )
        })()}
      </section>

      {/* ── Brand-wise Analysis ── */}

      <h3 style={{ marginTop: 56, marginBottom: 8, color: 'var(--fg)', fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        Additional Instagram Insights
      </h3>
      <div style={{ borderTop: '1px solid var(--line-2)', marginBottom: 16 }} />

      <section>
        <div className="two-col-even">
          <div>
            <div className="section-head">
              <div>
                <h2>
                  Follower trajectory
                  <SectionInfo
                    title="Follower Growth Over Time"
                    description="Each brand's Instagram follower count plotted week by week. Upward slopes show momentum."
                    source="ig_profiles_weekly · updated every Monday"
                  />
                </h2>
                <div className="sub">Weekly snapshot trend lines across tracked brands.</div>
              </div>
            </div>
            <div className="card"><div className="card-pad">
              <LineChart series={lineSeries} xLabels={xLabels} />
            </div></div>
          </div>
          <div>
            <div className="section-head">
              <div>
                <h2>
                  Engagement rate · benchmark
                  <SectionInfo
                    title="Engagement Rate Benchmark"
                    description="Ranked list — 1–3% is solid for large accounts; above 3% is excellent. Click a row to filter the posts table above."
                    source="ig_posts · (avg likes + avg comments) ÷ followers × 100"
                  />
                </h2>
                <div className="sub">Click a brand to filter the posts table above.</div>
              </div>
            </div>
            <div className="card"><div className="card-pad">
              {erSorted.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>
                  No engagement data yet — run the IG pipeline first.
                </div>
              ) : erSorted.map((d) => (
                <div
                  key={d.brand}
                  className={'bar-row ' + (d.brand === 'joola' ? 'joola' : '')}
                  style={{ gridTemplateColumns: '110px 1fr 70px 70px', cursor: 'pointer' }}
                  title={`Click to filter the posts table above to ${name(d.brand)}`}
                  onClick={() => {
                    setColFilter(p => ({ ...p, brand: name(d.brand) }))
                    document.getElementById('instagram-posts-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                >
                  <div className="lbl">{name(d.brand)} <span style={{ fontSize: 10, color: 'var(--fg-4)' }}>↓ filter</span></div>
                  <div className="track">
                    <div className="fill" style={{
                      width: (d.engRate / maxER * 100) + '%',
                      background: d.brand === 'joola' ? '#22c55e' : `linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                    }} />
                  </div>
                  <div className="spark-mini" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--fg)' }}>{d.engRate.toFixed(2)}%</div>
                  <div className="delta-mini flat">{fmt(d.followers)}</div>
                </div>
              ))}
            </div></div>
          </div>
        </div>
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2>
              Posting cadence · recent activity
              <SectionInfo
                title="Posting Frequency"
                description="Daily posts per brand over the last 4 weeks. Spikes reveal campaign bursts; flat lines indicate dormant periods. Consistent posting maintains algorithmic visibility."
                source="ig_posts · post timestamps refreshed every Monday"
              />
            </h2>
            <div className="sub">Daily posts per brand · last 4 weeks.</div>
          </div>
        </div>
        <div className="card"><div className="card-pad">
          {(() => {
            const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
            const cadenceLabels = Array.from({ length: 28 }, (_, i) =>
              `W${Math.floor(i / 7) + 1} ${DAY_NAMES[i % 7]}`
            )
            const cadenceSeries = freqBrands.map(b => ({
              id: b,
              label: name(b),
              color: pgColor(b),
              data: (displayFreq[b] || Array.from({ length: 4 }, () => Array(7).fill(0))).flat() as number[],
            }))
            return <PostingCadenceChart series={cadenceSeries} dayLabels={cadenceLabels} />
          })()}
        </div></div>
      </section>

      <section>
        <div className="two-col-even">
          <div>
            <div className="section-head">
              <div>
                <h2>
                  Paddle mentions · IG comments
                  <SectionInfo
                    title="Paddle Mentions in IG Comments"
                    description="Which paddles get talked about most in Instagram comments across all brand posts. Aggregated from the AI-enriched mention_facts table (channel = ig_comment, product_id extracted by GPT-4o NER)."
                    source="mention_facts · channel='ig_comment' · grouped by product_id × target brand"
                  />
                </h2>
                <div className="sub">Top paddles mentioned in IG comments · brand = mention target.</div>
              </div>
            </div>
            <div className="card"><div className="card-pad">
              {displayPaddleMentions.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>
                  No paddle mentions yet — run AI enrichment + populate_mention_facts.
                </div>
              ) : displayPaddleMentions.slice(0, 15).map((d, i) => (
                <div key={i} className={'bar-row ' + (d.brand === 'joola' ? 'joola' : '')}
                  style={{ gridTemplateColumns: '160px 1fr 50px 70px' }}>
                  <div className="lbl" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 12 }}>{d.entityName}</span>
                    <span style={{ fontSize: 10, color: 'var(--fg-4)' }}>{name(d.brand)}</span>
                  </div>
                  <div className="track">
                    <div className="fill" style={{
                      width: Math.max(2, d.mentions / maxPaddle * 100) + '%',
                      background: `linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                    }} />
                  </div>
                  <div className="spark-mini" style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(d.mentions)}</div>
                  <div className="delta-mini flat" title={`${d.positive} positive · ${d.negative} negative`}>
                    <span style={{ color: '#22c55e' }}>+{d.positive}</span>
                    {' / '}
                    <span style={{ color: '#ef4444' }}>-{d.negative}</span>
                  </div>
                </div>
              ))}
            </div></div>
          </div>
          <div>
            <div className="section-head">
              <div>
                <h2>
                  Player mentions · IG comments
                  <SectionInfo
                    title="Athlete Mentions in IG Comments"
                    description="Which sponsored players get name-checked most in Instagram comments. The brand column shows the player's sponsoring brand. Useful for measuring athlete ROI per dollar of sponsorship."
                    source="mention_facts · channel='ig_comment' · grouped by athlete_id × sponsoring brand"
                  />
                </h2>
                <div className="sub">Top players mentioned in IG comments · brand = sponsoring brand.</div>
              </div>
            </div>
            <div className="card"><div className="card-pad">
              {displayPlayerMentions.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>
                  No player mentions yet — run AI enrichment + populate_mention_facts.
                </div>
              ) : displayPlayerMentions.slice(0, 15).map((d, i) => (
                <div key={i} className={'bar-row ' + (d.brand === 'joola' ? 'joola' : '')}
                  style={{ gridTemplateColumns: '160px 1fr 50px 70px' }}>
                  <div className="lbl" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 12 }}>{d.entityName}</span>
                    <span style={{ fontSize: 10, color: 'var(--fg-4)' }}>{name(d.brand)}</span>
                  </div>
                  <div className="track">
                    <div className="fill" style={{
                      width: Math.max(2, d.mentions / maxPlayer * 100) + '%',
                      background: `linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                    }} />
                  </div>
                  <div className="spark-mini" style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(d.mentions)}</div>
                  <div className="delta-mini flat" title={`${d.positive} positive · ${d.negative} negative`}>
                    <span style={{ color: '#22c55e' }}>+{d.positive}</span>
                    {' / '}
                    <span style={{ color: '#ef4444' }}>-{d.negative}</span>
                  </div>
                </div>
              ))}
            </div></div>
          </div>
        </div>
      </section>

      <h3 style={{ marginTop: 56, marginBottom: 8, color: 'var(--fg)', fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        Review required — existing Instagram sections not included in this change request
      </h3>
      <div style={{ borderTop: '1px solid var(--line-2)', marginBottom: 16 }} />

      <section>
        <div className="card"><div className="card-pad">
          <table className="data" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Section</th>
                <th style={{ textAlign: 'left' }}>Original purpose</th>
                <th style={{ textAlign: 'left' }}>Data source</th>
                <th style={{ textAlign: 'left' }}>Status</th>
                <th style={{ textAlign: 'left' }}>Recommended action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>JOOLA followers KPI</td>
                <td>Headline number for JOOLA's IG follower count with WoW delta</td>
                <td>ig_profiles_weekly (latest)</td>
                <td><span className="pill pill-ghost">Working</span></td>
                <td>Keep later — duplicates info available in Engagement Benchmark</td>
              </tr>
              <tr>
                <td>JOOLA engagement rate KPI</td>
                <td>JOOLA's ER score with rank vs other brands</td>
                <td>ig_posts (avg likes+comments) / followers</td>
                <td><span className="pill pill-ghost">Working</span></td>
                <td>Keep later — already conveyed by the EQ Matrix + benchmark</td>
              </tr>
              <tr>
                <td>Total tracked posts KPI</td>
                <td>Count of all IG posts scraped across brands</td>
                <td>ig_posts.count</td>
                <td><span className="pill pill-ghost">Working</span></td>
                <td>Improve later — meaningful only if shown per-brand</td>
              </tr>
              <tr>
                <td>Total audience KPI</td>
                <td>Sum of all brand follower counts</td>
                <td>ig_profiles_weekly.followers SUM</td>
                <td><span className="pill pill-ghost">Working</span></td>
                <td>Remove later — sum across competitors is not actionable</td>
              </tr>
              <tr>
                <td>JOOLA chip filter</td>
                <td>Quick chip to filter the posts table to JOOLA only</td>
                <td>UI state</td>
                <td><span className="pill pill-info">Replaced</span></td>
                <td>Use the brand filter (top right) instead — clearer scope</td>
              </tr>
              <tr>
                <td>Caption search box</td>
                <td>Single search field hitting caption/handle/brand</td>
                <td>UI state</td>
                <td><span className="pill pill-info">Replaced</span></td>
                <td>Replaced by per-column ColumnFilter (brand + caption) on the table itself</td>
              </tr>
            </tbody>
          </table>
        </div></div>
      </section>
    </div>
  )
}

// ─── Posting Cadence — leaderboard + detail panel ────────────────────────────
function PostingCadenceChart({ series, dayLabels }: {
  series: { id: string; label: string; color: string; data: number[] }[]
  dayLabels: string[]
}) {
  const [activeBrand, setActiveBrand] = useState<string | null>(null)
  const [hovDay, setHovDay] = useState<number | null>(null)

  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  const brandStats = [...series].map(s => {
    const total = s.data.reduce((a, b) => a + b, 0)
    const weeks = [0, 1, 2, 3].map(w => s.data.slice(w * 7, w * 7 + 7).reduce((a, b) => a + b, 0))
    const lastWk = weeks[3], prevWk = weeks[2]
    const trend = lastWk > prevWk ? 'up' : lastWk < prevWk ? 'down' : 'flat'
    const activeDays = s.data.filter(v => v > 0).length
    const dayTotals = DAY_NAMES.map((_, di) =>
      [0, 1, 2, 3].reduce((acc, w) => acc + (s.data[w * 7 + di] || 0), 0)
    )
    const bestDayIdx = dayTotals.indexOf(Math.max(...dayTotals))
    const status: 'Active' | 'Moderate' | 'Sporadic' | 'Silent' =
      total === 0 ? 'Silent' : total < 7 ? 'Sporadic' : total < 21 ? 'Moderate' : 'Active'
    return { ...s, total, weeks, trend, activeDays, dayTotals, bestDayIdx, status }
  }).sort((a, b) => {
    if (a.id === 'joola') return -1
    if (b.id === 'joola') return 1
    return b.total - a.total
  })

  const maxWeek = Math.max(1, ...brandStats.flatMap(s => s.weeks))
  const activeData = activeBrand ? brandStats.find(s => s.id === activeBrand) ?? null : null

  const statusColor = (st: string) =>
    st === 'Active' ? '#22c55e' : st === 'Moderate' ? '#F5E625' : st === 'Sporadic' ? '#fb923c' : '#6b7280'

  return (
    <div>
      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '26px 140px 52px repeat(4, 44px) 72px 70px 1fr',
        gap: 8, padding: '0 10px 6px', borderBottom: '1px solid var(--wb-6)',
        marginBottom: 4,
      }}>
        {['', 'Brand', 'Total', 'W1', 'W2', 'W3', 'W4', 'Status', 'vs last wk', '28-day rhythm'].map((h, i) => (
          <span key={i} style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: i >= 2 && i <= 6 ? 'center' : 'left' }}>{h}</span>
        ))}
      </div>

      {/* Brand rows */}
      {brandStats.map((s, i) => {
        const isJ = s.id === 'joola'
        const isOpen = activeBrand === s.id
        const dayMax = Math.max(1, ...s.data)
        return (
          <div key={s.id}>
            <div
              onClick={() => setActiveBrand(isOpen ? null : s.id)}
              style={{
                display: 'grid',
                gridTemplateColumns: '26px 140px 52px repeat(4, 44px) 72px 70px 1fr',
                gap: 8, alignItems: 'center',
                padding: '7px 10px',
                borderRadius: 8,
                cursor: 'pointer',
                background: isOpen ? `${s.color}10` : 'transparent',
                border: isOpen ? `1px solid ${s.color}30` : '1px solid transparent',
                transition: 'background 0.15s',
                marginBottom: 2,
              }}>
              {/* Rank */}
              <span style={{ fontSize: 10, color: 'var(--fg-4)', fontFamily: 'JetBrains Mono' }}>#{i + 1}</span>

              {/* Brand */}
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: isJ ? 800 : 600, color: isJ ? '#22c55e' : 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.label}
                </span>
              </span>

              {/* Total */}
              <span style={{ fontSize: 12, fontWeight: 700, color: isJ ? '#22c55e' : 'var(--fg)', fontFamily: 'JetBrains Mono', textAlign: 'center' }}>{s.total}</span>

              {/* W1–W4 mini bars */}
              {s.weeks.map((wk, wi) => (
                <div key={wi} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <span style={{ fontSize: 9, color: wk > 0 ? 'var(--fg-3)' : 'var(--fg-4)', fontFamily: 'JetBrains Mono' }}>{wk}</span>
                  <div style={{ width: 28, height: 18, background: 'var(--line-2)', borderRadius: 3, display: 'flex', alignItems: 'flex-end', overflow: 'hidden' }}>
                    <div style={{
                      width: '100%',
                      height: `${(wk / maxWeek) * 100}%`,
                      minHeight: wk > 0 ? 3 : 0,
                      background: s.color,
                      opacity: isJ ? 1 : 0.72,
                      borderRadius: 2,
                      transition: 'height 0.4s ease',
                    }} />
                  </div>
                </div>
              ))}

              {/* Status badge */}
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap',
                background: statusColor(s.status) + '18',
                color: statusColor(s.status),
                border: `1px solid ${statusColor(s.status)}44`,
              }}>{s.status}</span>

              {/* Trend vs last week */}
              <span style={{ fontSize: 11, fontWeight: 700, color: s.trend === 'up' ? '#22c55e' : s.trend === 'down' ? '#ef4444' : '#6b7280' }}>
                {s.trend === 'up' ? `↑ +${s.weeks[3] - s.weeks[2]}` : s.trend === 'down' ? `↓ ${s.weeks[3] - s.weeks[2]}` : '→ same'}
              </span>

              {/* 28-day rhythm bar sparkline */}
              <div style={{ display: 'flex', gap: 1.5, alignItems: 'flex-end', height: 20 }}>
                {s.data.map((v, di) => (
                  <div key={di} style={{
                    flex: 1, height: v > 0 ? `${Math.max(20, (v / dayMax) * 100)}%` : '8%',
                    background: v > 0 ? s.color : 'var(--wb-5)',
                    borderRadius: 1,
                    opacity: v > 0 ? (isJ ? 1 : 0.75) : 0.3,
                    transition: 'height 0.3s',
                  }} title={`${DAY_NAMES[di % 7]} (${dayLabels[di]}): ${v} post${v === 1 ? '' : 's'}`} />
                ))}
              </div>
            </div>

            {/* Expanded detail panel */}
            {isOpen && activeData && activeData.id === s.id && (
              <div style={{
                margin: '0 0 10px',
                padding: '16px 20px',
                borderRadius: 10,
                background: `${s.color}08`,
                border: `1px solid ${s.color}22`,
              }}>
                {/* Stats row */}
                <div style={{ display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
                  {[
                    { label: 'Total posts', value: String(s.total) },
                    { label: 'Active days', value: `${s.activeDays} / 28` },
                    { label: 'Best day', value: DAY_NAMES[s.bestDayIdx] },
                    { label: 'Peak week', value: `W${s.weeks.indexOf(Math.max(...s.weeks)) + 1} (${Math.max(...s.weeks)} posts)` },
                    { label: 'Daily avg', value: (s.total / 28).toFixed(1) },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 9, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: isJ ? '#22c55e' : s.color, fontFamily: 'JetBrains Mono' }}>{value}</span>
                    </div>
                  ))}
                </div>

                {/* Day-by-day bar chart */}
                <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 60, marginBottom: 4 }}
                  onMouseLeave={() => setHovDay(null)}>
                  {s.data.map((v, di) => {
                    const isHov = hovDay === di
                    const isWeekBoundary = di > 0 && di % 7 === 0
                    return (
                      <div key={di} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, position: 'relative' }}>
                        {isWeekBoundary && (
                          <div style={{ position: 'absolute', left: -1, top: 0, bottom: 0, width: 1, background: 'var(--wb-8)' }} />
                        )}
                        {isHov && v > 0 && (
                          <span style={{
                            position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                            fontSize: 9, fontWeight: 700, color: s.color, whiteSpace: 'nowrap', marginBottom: 2,
                            background: 'var(--sticky-bg)', padding: '1px 4px', borderRadius: 3,
                          }}>{v}</span>
                        )}
                        <div
                          onMouseEnter={() => setHovDay(di)}
                          style={{
                            width: '100%',
                            height: v > 0 ? `${Math.max(6, (v / dayMax) * 100)}%` : 3,
                            background: v > 0 ? (isHov ? '#fff' : s.color) : 'var(--wb-5)',
                            borderRadius: 2,
                            transition: 'background 0.1s, height 0.2s',
                            cursor: 'default',
                            boxShadow: isHov && v > 0 ? `0 0 8px ${s.color}99` : 'none',
                          }} />
                      </div>
                    )
                  })}
                </div>

                {/* X-axis week labels */}
                <div style={{ display: 'flex' }}>
                  {[0, 1, 2, 3].map(w => (
                    <div key={w} style={{ flex: 7, textAlign: 'center', fontSize: 9, color: 'var(--fg-4)', fontWeight: 600 }}>
                      Week {w + 1} · {s.weeks[w]} posts
                    </div>
                  ))}
                </div>

                {/* Day-of-week breakdown */}
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--wb-6)' }}>
                  <span style={{ fontSize: 9, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 8 }}>Posts by day of week (4-week avg)</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {DAY_NAMES.map((day, di) => {
                      const avg = (s.dayTotals[di] / 4)
                      const maxAvg = Math.max(1, ...s.dayTotals) / 4
                      const isBest = di === s.bestDayIdx
                      return (
                        <div key={di} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          <div style={{ width: '100%', height: 36, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                            <div style={{
                              width: '60%', height: `${(avg / maxAvg) * 100}%`, minHeight: avg > 0 ? 4 : 0,
                              background: isBest ? s.color : s.color + '55',
                              borderRadius: 2,
                              boxShadow: isBest ? `0 0 6px ${s.color}88` : 'none',
                            }} />
                          </div>
                          <span style={{ fontSize: 9, color: isBest ? s.color : 'var(--fg-4)', fontWeight: isBest ? 700 : 400 }}>{day}</span>
                          <span style={{ fontSize: 9, color: 'var(--fg-3)', fontFamily: 'JetBrains Mono' }}>{avg.toFixed(1)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}

      <div style={{ display: 'flex', gap: 20, paddingTop: 10, borderTop: '1px solid var(--wb-6)', marginTop: 4, fontSize: 9, color: 'var(--fg-4)' }}>
        <span>Click any row to expand day-by-day detail</span>
        <span>W1–W4 bars show weekly post volume relative to the busiest week</span>
        <span>{series.length} brands · last 4 weeks</span>
      </div>
    </div>
  )
}
