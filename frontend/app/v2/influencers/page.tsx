'use client'

/**
 * Influencer Intel — sponsored-player intelligence dashboard.
 *
 * Route: /v2/influencers  (DO NOT create a new route)
 *
 * Sections (13 total — ordered top-to-bottom):
 *  1.  Influencer Intel Summary (inline strip)
 *  2.  Sponsored player roster by brand
 *  3.  Player impact map (bubble chart)
 *  4.  Cross-platform player attention
 *  5.  Athlete roster performance
 *  6.  Brand sponsored-player strength
 *  7.  Top performing player content
 *  8.  Player mentions in community conversation
 *  9.  JOOLA sponsored player focus
 * 10.  Player ↔ paddle connections
 * 11.  Influencer data coverage
 * 12.  Pending / Needs data pipeline
 * 13.  Review required
 *
 * Data layer: lib/v2/influencerIntel.ts (single fetcher).
 * Sponsored-player mapping: lib/v2/playerRoster.ts (config-driven).
 */

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  PageHead, MiniKpi, SortTh, ColumnFilter, LoadingPage, SectionInfo,
  FilterBanner, pgColor, pgName,
} from '@/components/v2/PageShell'
import { fmt } from '@/components/v2/charts'
import { useBrandFilter, applyBrandFilter } from '@/lib/v2/BrandFilterContext'
import { useDateRange, applyDateRangeCustom, DATE_RANGE_LABEL, type DateRangeKey } from '@/lib/v2/DateRangeContext'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import {
  fetchInfluencerIntel,
  fetchAthleteImpact,
  fetchSponsoredVsOrganic,
  fetchAthleteProductPull,
  fetchCompetitorAthleteThreats,
  platformLabel, platformShort,
  type InfluencerIntelData,
  type InfluencerRow,
  type InfluencerPostRow,
  type RosterRow,
  type PlatformAttention,
  type BrandPlayerStats,
  type CommunityMention,
  type JoolaPlayerFocus,
  type PlayerProductConnection,
  type IntelPlatform,
  type IntelSentiment,
  type AthleteImpactRow,
  type SponsoredOrganicRow,
  type AthleteProductPullRow,
  type CompetitorThreatRow,
} from '@/lib/v2/influencerIntel'
import { formatCalendarDate } from '@/lib/v2/format'

type PlatformKey = 'all' | IntelPlatform
type SentimentKey = 'all' | IntelSentiment
type ContentTypeKey = 'all' | 'image' | 'video' | 'reel' | 'short'

const PLATFORM_FILTER_LABEL: Record<PlatformKey, string> = {
  all: 'All platforms',
  ig: 'Instagram',
  yt: 'YouTube',
  tiktok: 'TikTok',
  x: 'X / Twitter',
  reddit: 'Reddit',
}

const SENTIMENT_LABEL: Record<SentimentKey, string> = {
  all: 'All sentiment',
  positive: 'Positive',
  neutral: 'Neutral',
  negative: 'Negative',
  unknown: 'Unknown',
}

const SENT_PILL: Record<IntelSentiment, string> = {
  positive: 'pill-green',
  neutral: 'pill-ghost',
  negative: 'pill-red',
  unknown: 'pill-ghost',
}

const STATUS_COLOR: Record<RosterRow['status'], string> = {
  'business-mapping': '#22c55e',
  'confirmed-from-data': '#22c55e',
  'needs-verification': '#F5E625',
  'roster-not-confirmed': '#94a3b8',
}

const STATUS_LABEL: Record<RosterRow['status'], string> = {
  'business-mapping': 'Business mapping',
  'confirmed-from-data': 'Confirmed from data',
  'needs-verification': 'Needs verification',
  'roster-not-confirmed': 'Roster not confirmed',
}

const STATUS_DESC: Record<RosterRow['status'], string> = {
  'business-mapping': 'We know this player is sponsored by this brand based on our records, but we haven\'t yet seen it confirmed on their social media posts or official athlete pages.',
  'confirmed-from-data': 'This sponsorship has been confirmed — the player has publicly posted or been listed as a sponsored athlete for this brand on social media.',
  'needs-verification': 'This player may be linked to more than one brand, or there\'s conflicting information. Someone should manually check which brand actually sponsors them.',
  'roster-not-confirmed': 'This player is in our records as a sponsored athlete, but we couldn\'t find them on the brand\'s public influencer or athlete pages. The deal may have ended, or their profile name may have changed.',
}

const VERIFICATION_DESC: Record<string, string> = {
  'verified': 'We found this player\'s social media account and it matches our records exactly. You can trust the profile links shown here.',
  'matched': 'We found a social media account that looks like this player, but the name was slightly different. The links are probably correct — worth a quick check.',
  'unmatched': 'We couldn\'t find a confirmed social media account for this player. The profile links shown (if any) are our best guess and may not be accurate.',
}

function tierFromFollowers(n: number): { label: string; color: string } {
  if (n >= 500_000) return { label: 'MEGA', color: '#F5E625' }
  if (n >= 100_000) return { label: 'MACRO', color: '#22c55e' }
  if (n >= 10_000) return { label: 'MICRO', color: '#818cf8' }
  return { label: 'NANO', color: '#94a3b8' }
}

function sortBy<T>(rows: T[], key: keyof T | null, dir: 'asc' | 'desc'): T[] {
  if (!key) return rows
  return [...rows].sort((a, b) => {
    const av = a[key] as unknown
    const bv = b[key] as unknown
    if (typeof av === 'number' && typeof bv === 'number') {
      return dir === 'asc' ? av - bv : bv - av
    }
    const as = String(av ?? ''), bs = String(bv ?? '')
    return dir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
  })
}

export default function InfluencerIntelPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [data, setData] = useState<InfluencerIntelData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ─── Extended-section state ────────────────────────────────────────
  const [athleteImpact, setAthleteImpact] = useState<AthleteImpactRow[]>([])
  const [sponsoredOrganic, setSponsoredOrganic] = useState<SponsoredOrganicRow[]>([])
  const [athletePull, setAthletePull] = useState<AthleteProductPullRow[]>([])
  const [competitorThreats, setCompetitorThreats] = useState<CompetitorThreatRow[]>([])
  const [pullJoolaOnly, setPullJoolaOnly] = useState(false)

  const router = useRouter()
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()
  const { range, setRange, mode, customFrom, customTo, setCustomFrom, setCustomTo, effectiveFrom, effectiveTo } = useDateRange()

  // ── Filters ────────────────────────────────────────────────────────
  const [playerQuery, setPlayerQuery] = useState('')
  const [platformFilter, setPlatformFilter] = useState<PlatformKey>('all')
  const [sentimentFilter, setSentimentFilter] = useState<SentimentKey>('all')
  const [contentTypeFilter, setContentTypeFilter] = useState<ContentTypeKey>('all')

  // ── Sort state per table ───────────────────────────────────────────
  const [rosterSort, setRosterSort] = useState<{ key: keyof RosterRow | null; dir: 'asc' | 'desc' }>({ key: 'brandSlug', dir: 'asc' })
  const [rosterColFilter, setRosterColFilter] = useState<Record<string, string>>({})
  const [drillRoster, setDrillRoster] = useState<RosterRow | null>(null)
  const [drillContent, setDrillContent] = useState<InfluencerPostRow | null>(null)
  const [drillImpact, setDrillImpact] = useState<AthleteImpactRow | null>(null)
  const [drillRosterPosts, setDrillRosterPosts] = useState<{ player: string; posts: InfluencerPostRow[] } | null>(null)
  const [attentionSort, setAttentionSort] = useState<{ key: keyof PlatformAttention | null; dir: 'asc' | 'desc' }>({ key: 'total', dir: 'desc' })
  const [attentionColFilter, setAttentionColFilter] = useState<Record<string, string>>({})
  const [perfSort, setPerfSort] = useState<{ key: keyof InfluencerRow | null; dir: 'asc' | 'desc' }>({ key: 'engRate', dir: 'desc' })
  const [perfColFilter, setPerfColFilter] = useState<Record<string, string>>({})
  const [brandStatsSort, setBrandStatsSort] = useState<{ key: keyof BrandPlayerStats | null; dir: 'asc' | 'desc' }>({ key: 'totalEngagement', dir: 'desc' })
  const [contentSort, setContentSort] = useState<{ key: keyof InfluencerPostRow | null; dir: 'asc' | 'desc' }>({ key: 'engagement', dir: 'desc' })
  const [contentColFilter, setContentColFilter] = useState<Record<string, string>>({})
  const [mentionSort, setMentionSort] = useState<{ key: keyof CommunityMention | null; dir: 'asc' | 'desc' }>({ key: 'days', dir: 'asc' })
  const [mentionColFilter, setMentionColFilter] = useState<Record<string, string>>({})

  useEffect(() => { document.title = 'JOOLA INTEL — Influencer Intel' }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const b = await fetchBrands()
        if (cancelled) return
        setBrands(b)
        setAllBrands(b)
        const d = await fetchInfluencerIntel(b, { from: effectiveFrom, to: effectiveTo })
        if (cancelled) return
        setData(d)

        // Extended sections: athlete impact, sponsored/organic, athlete-product pull, threats.
        const [impactRows, sponsoredRows, pullRows] = await Promise.all([
          fetchAthleteImpact(b).catch(() => [] as AthleteImpactRow[]),
          fetchSponsoredVsOrganic(b).catch(() => [] as SponsoredOrganicRow[]),
          fetchAthleteProductPull(b).catch(() => [] as AthleteProductPullRow[]),
        ])
        if (cancelled) return
        const threatRows = await fetchCompetitorAthleteThreats(b, impactRows, d.platformStats, d.playerProductConnections)
          .catch(() => [] as CompetitorThreatRow[])
        if (cancelled) return
        setAthleteImpact(impactRows)
        setSponsoredOrganic(sponsoredRows)
        setAthletePull(pullRows)
        setCompetitorThreats(threatRows)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[influencer-intel] load failed', err)
        if (!cancelled) setError('Unable to load Influencer Intel. Refresh the page to retry.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [effectiveFrom, effectiveTo, setAllBrands])

  const name = (s: string) => pgName(s, brands)

  // ── Filter helpers ─────────────────────────────────────────────────
  const playerQueryLc = playerQuery.trim().toLowerCase()
  function passesPlayerSearch(player: string): boolean {
    if (!playerQueryLc) return true
    return player.toLowerCase().includes(playerQueryLc)
  }
  function passesPlatform(p: IntelPlatform): boolean {
    if (platformFilter === 'all') return true
    return p === platformFilter
  }
  function passesSentiment(s: IntelSentiment): boolean {
    if (sentimentFilter === 'all') return true
    return s === sentimentFilter
  }
  function passesContentType(t: string): boolean {
    if (contentTypeFilter === 'all') return true
    const lc = String(t || '').toLowerCase()
    if (contentTypeFilter === 'image') return lc.includes('image') || lc === 'photo'
    if (contentTypeFilter === 'video') return lc.includes('video')
    if (contentTypeFilter === 'reel') return lc.includes('reel')
    if (contentTypeFilter === 'short') return lc.includes('short')
    return true
  }

  // ── Derived rows (always called even when loading to keep hook order)
  const filteredRoster: RosterRow[] = useMemo(() => {
    if (!data) return []
    return data.rosterRows.filter(r =>
      applyBrandFilter([{ brand: r.brandSlug }], filteredBrands, isFiltered).length > 0
      && passesPlayerSearch(r.player)
      && Object.entries(rosterColFilter).every(([k, q]) =>
        !q || String((r as unknown as Record<string, unknown>)[k] ?? '').toLowerCase().includes(q.toLowerCase()))
    )
  }, [data, filteredBrands, isFiltered, playerQueryLc, rosterColFilter])

  const filteredInfluencers: InfluencerRow[] = useMemo(() => {
    if (!data) return []
    return applyBrandFilter(data.influencers.map(i => ({ ...i, brand: i.brandSlug })), filteredBrands, isFiltered)
      .map(i => i as unknown as InfluencerRow)
      .filter(i => passesPlayerSearch(i.name))
      .filter(i => Object.entries(perfColFilter).every(([k, q]) =>
        !q || String((i as unknown as Record<string, unknown>)[k] ?? '').toLowerCase().includes(q.toLowerCase())))
  }, [data, filteredBrands, isFiltered, playerQueryLc, perfColFilter])

  const filteredAttention: PlatformAttention[] = useMemo(() => {
    if (!data) return []
    return data.platformStats
      .filter(r => applyBrandFilter([{ brand: r.brandSlug }], filteredBrands, isFiltered).length > 0)
      .filter(r => passesPlayerSearch(r.player))
      .filter(r => {
        if (platformFilter === 'all') return true
        return r[platformFilter] > 0
      })
      .filter(r => Object.entries(attentionColFilter).every(([k, q]) =>
        !q || String((r as unknown as Record<string, unknown>)[k] ?? '').toLowerCase().includes(q.toLowerCase())))
  }, [data, filteredBrands, isFiltered, playerQueryLc, platformFilter, attentionColFilter])

  const filteredContent: InfluencerPostRow[] = useMemo(() => {
    if (!data) return []
    const inRange = applyDateRangeCustom(data.topPlayerContent, effectiveFrom, effectiveTo)
    return applyBrandFilter(inRange.map(p => ({ ...p, brand: p.brandSlug })), filteredBrands, isFiltered)
      .map(p => p as unknown as InfluencerPostRow)
      .filter(p => passesPlayerSearch(p.athleteName))
      .filter(p => passesPlatform(p.platform))
      .filter(p => passesSentiment(p.sentiment))
      .filter(p => passesContentType(p.type))
      .filter(p => Object.entries(contentColFilter).every(([k, q]) =>
        !q || String((p as unknown as Record<string, unknown>)[k] ?? '').toLowerCase().includes(q.toLowerCase())))
  }, [data, effectiveFrom, effectiveTo, filteredBrands, isFiltered, playerQueryLc, platformFilter, sentimentFilter, contentTypeFilter, contentColFilter])

  const filteredMentions: CommunityMention[] = useMemo(() => {
    if (!data) return []
    const inRange = applyDateRangeCustom(data.communityMentions, effectiveFrom, effectiveTo)
    return applyBrandFilter(inRange.map(m => ({ ...m, brand: m.brandSlug })), filteredBrands, isFiltered)
      .map(m => m as unknown as CommunityMention)
      .filter(m => passesPlayerSearch(m.player))
      .filter(m => passesSentiment(m.sentiment))
      .filter(m => Object.entries(mentionColFilter).every(([k, q]) =>
        !q || String((m as unknown as Record<string, unknown>)[k] ?? '').toLowerCase().includes(q.toLowerCase())))
  }, [data, effectiveFrom, effectiveTo, filteredBrands, isFiltered, playerQueryLc, sentimentFilter, mentionColFilter])

  const filteredBrandStats: BrandPlayerStats[] = useMemo(() => {
    if (!data) return []
    return data.brandPlayerStats
      .filter(s => applyBrandFilter([{ brand: s.brandSlug }], filteredBrands, isFiltered).length > 0)
  }, [data, filteredBrands, isFiltered])

  // ── Summary numbers ────────────────────────────────────────────────
  const summary = useMemo(() => {
    if (!data) return null
    const top = data.platformStats[0]
    const sumEr = filteredInfluencers.reduce((s, i) => s + i.engRate, 0)
    const avgEr = filteredInfluencers.length > 0 ? sumEr / filteredInfluencers.length : 0
    return {
      sponsoredPlayers: data.dataStatus.sponsoredPlayers,
      activeBrands: data.dataStatus.activeBrands,
      platformsWithData: data.dataStatus.platformsWithData.length,
      playerSignals: data.platformStats.reduce((s, p) => s + p.total, 0),
      joolaPlayers: data.sponsoredPlayerMap.filter(r => r.brandSlug === 'joola').length,
      topPlayer: top?.player || null,
      topPlayerSignals: top?.total || 0,
      avgER: avgEr,
    }
  }, [data, filteredInfluencers])

  // ── Bubble chart (player impact map) ───────────────────────────────
  const bubblePool = useMemo(() => {
    if (!data) return []
    return data.platformStats
      .filter(p => applyBrandFilter([{ brand: p.brandSlug }], filteredBrands, isFiltered).length > 0)
      .map(p => {
        const inf = data.influencers.find(i => i.name === p.player && i.brandSlug === p.brandSlug)
          || data.influencers.find(i => i.name === p.player)
        const reach = inf?.followers || 0
        const er = inf?.engRate || 0
        return {
          name: p.player,
          brandSlug: p.brandSlug,
          reach,
          er,
          total: p.total,
        }
      })
      .filter(p => p.reach > 0 && p.er > 0)
  }, [data, filteredBrands, isFiltered])

  if (loading) return <LoadingPage />
  if (error || !data) {
    return (
      <div style={{ padding: '80px 32px', textAlign: 'center' }}>
        <div style={{ color: '#ef4444', fontSize: 14, marginBottom: 16 }}>{error || 'No data'}</div>
        <button className="btn btn-yellow" onClick={() => window.location.reload()} aria-label="Refresh page">Refresh page</button>
      </div>
    )
  }

  return (
    <>
      {drillRosterPosts && (
        <PlayerPostsDialog
          player={drillRosterPosts.player}
          posts={drillRosterPosts.posts}
          onPostClick={(p) => { setDrillRosterPosts(null); setDrillContent(p) }}
          onClose={() => setDrillRosterPosts(null)}
        />
      )}
      {drillRoster && (() => {
        const allPosts = filteredContent.filter(p => p.athleteName === drillRoster.player).sort((a, b) => b.engagement - a.engagement)
        return (
          <RosterDetailDialog
            row={drillRoster}
            brands={brands}
            attention={filteredAttention.find(a => a.player === drillRoster.player && a.brandSlug === drillRoster.brandSlug) || null}
            influencer={filteredInfluencers.find(i => i.name === drillRoster.player && i.brandSlug === drillRoster.brandSlug) || null}
            topPosts={allPosts.slice(0, 3)}
            totalPosts={allPosts.length}
            onViewAllPosts={() => { setDrillRoster(null); setDrillRosterPosts({ player: drillRoster.player, posts: allPosts }) }}
            onPostClick={(p) => { setDrillRoster(null); setDrillContent(p) }}
            onClose={() => setDrillRoster(null)}
          />
        )
      })()}
      {drillContent && (
        <ContentDetailDialog post={drillContent} brands={brands} onClose={() => setDrillContent(null)} />
      )}
      {drillImpact && (
        <ImpactDetailDialog row={drillImpact} brands={brands} onClose={() => setDrillImpact(null)} />
      )}
      <PageHead title="INFLUENCER INTEL" />
      <FilterBanner />

      {/* ── Section 1 — Summary strip ─────────────────────────── */}
      {summary && (
        <section style={{ marginBottom: 16 }}>
          <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-evenly',
            padding: '12px 16px', borderRadius: 10,
            background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.20)',
            fontSize: 12, color: 'var(--fg-2)',
          }}>
            <SummaryStat label="Sponsored players" value={summary.sponsoredPlayers} accent="#22c55e" />
            <SummaryStat label="Brands" value={summary.activeBrands} />
            <SummaryStat label="Platforms with data" value={summary.platformsWithData} />
            <SummaryStat label="Player signals" value={fmt(summary.playerSignals)} />
            <SummaryStat label="JOOLA players" value={summary.joolaPlayers} accent="#22c55e" />
            <SummaryStat label="Top player" value={summary.topPlayer || '—'} sub={summary.topPlayer ? `${fmt(summary.topPlayerSignals)} signals` : ''} />
            <SummaryStat label="Avg ER" value={summary.avgER.toFixed(2) + '%'} />
          </div>
        </section>
      )}

      {/* ── Section 2 — Sponsored athletes by brand ──────── */}
      <Section id="roster"
        title="Sponsored players by brand"
        info="A complete list of every player sponsored by each pickleball brand. The verification status shows whether we have confirmed their sponsorship from their own social media posts. Players appearing under more than one brand are flagged for review."
        source="lib/v2/playerRoster.ts (business mapping) + influencers (scraped)"
        sub={`${filteredRoster.length} rows · ${data.dataStatus.activeBrands} brands`}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 10, fontSize: 11, color: 'var(--fg-3)' }}>
          {[
            { color: STATUS_COLOR['business-mapping'],    label: 'Business mapping',     desc: 'Known from our records, not yet confirmed on social media' },
            { color: STATUS_COLOR['confirmed-from-data'], label: 'Confirmed from data',  desc: 'Confirmed by their social media posts' },
            { color: STATUS_COLOR['needs-verification'],  label: 'Needs verification',   desc: 'Appears under multiple brands — needs review' },
            { color: STATUS_COLOR['roster-not-confirmed'],label: 'Roster not confirmed', desc: 'Not found on the brand\'s public athlete pages' },
          ].map(s => (
            <span key={s.label} title={s.desc} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'help' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
              {s.label}
            </span>
          ))}
          <span style={{ marginLeft: 'auto', color: 'var(--fg-4)' }}>Hover Status or Verification cells for details · Click any row to open player details</span>
        </div>
        <ScrollTable maxHeight={580}>
          <table className="data">
            <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#141821' }}>
              <tr>
                <SortTh col="brandSlug" label="Brand" sortKey={rosterSort.key as string | null} sortDir={rosterSort.dir} toggle={(k) => setRosterSort(s => ({ key: k as keyof RosterRow, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} />
                <SortTh col="player" label="Player" sortKey={rosterSort.key as string | null} sortDir={rosterSort.dir} toggle={(k) => setRosterSort(s => ({ key: k as keyof RosterRow, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} />
                <SortTh col="status" label="Status" sortKey={rosterSort.key as string | null} sortDir={rosterSort.dir} toggle={(k) => setRosterSort(s => ({ key: k as keyof RosterRow, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} />
                <th>IG</th>
                <th>YT</th>
                <th>TikTok</th>
                <th>X</th>
                <th>Reddit</th>
                <SortTh col="verification" label="Verification" sortKey={rosterSort.key as string | null} sortDir={rosterSort.dir} toggle={(k) => setRosterSort(s => ({ key: k as keyof RosterRow, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} />
                <SortTh col="lastSeenDays" label="Last seen" sortKey={rosterSort.key as string | null} sortDir={rosterSort.dir} toggle={(k) => setRosterSort(s => ({ key: k as keyof RosterRow, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} />
              </tr>
              <tr className="col-filter-row">
                <th><ColumnFilter col="brandSlug" value={rosterColFilter.brandSlug} onChange={v => setRosterColFilter(p => ({ ...p, brandSlug: v }))} /></th>
                <th><ColumnFilter col="player" value={rosterColFilter.player} onChange={v => setRosterColFilter(p => ({ ...p, player: v }))} /></th>
                <th colSpan={8} />
              </tr>
            </thead>
            <tbody>
              {sortBy(filteredRoster, rosterSort.key, rosterSort.dir).map((r, i) => (
                <tr
                    key={`${r.brandSlug}-${r.player}-${i}`}
                    className={r.brandSlug === 'joola' ? 'joola' : ''}
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => { if ((e.target as HTMLElement).closest('a')) return; router.push(`/v2/influencers/player/${encodeURIComponent(r.brandSlug + '--' + r.player)}`) }}
                  >
                  <td><BrandCell slug={r.brandSlug} brands={brands} /></td>
                  <td style={{ fontWeight: 700 }}>{r.player}</td>
                  <td title={STATUS_DESC[r.status]}>
                    <span className="pill" style={{ background: STATUS_COLOR[r.status] + '22', color: STATUS_COLOR[r.status], border: `1px solid ${STATUS_COLOR[r.status]}55`, fontSize: 10, padding: '2px 8px', borderRadius: 99, fontWeight: 700, cursor: 'pointer' }}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td>{r.igHandle ? <a className="ext-link" href={`https://www.instagram.com/${r.igHandle.replace(/^@/, '')}/`} target="_blank" rel="noopener noreferrer">@{r.igHandle.replace(/^@/, '')}</a> : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                  <td><span style={{ color: 'var(--fg-4)' }}>—</span></td>
                  <td><span style={{ color: 'var(--fg-4)' }}>—</span></td>
                  <td>{r.xHandle ? <a className="ext-link" href={`https://x.com/${r.xHandle}`} target="_blank" rel="noreferrer">@{r.xHandle}</a> : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                  <td><span style={{ color: 'var(--fg-4)' }}>—</span></td>
                  <td title={VERIFICATION_DESC[r.verification] ?? `Verification status: ${r.verification}`}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, cursor: 'pointer',
                      color: r.verification === 'verified' ? '#22c55e' : r.verification === 'matched' ? '#F5E625' : '#94a3b8',
                    }}>{r.verification}</span>
                  </td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>
                    {r.lastSeenDays !== null
                      ? formatCalendarDate(new Date(Date.now() - r.lastSeenDays * 86_400_000))
                      : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                  </td>
                </tr>
              ))}
              {filteredRoster.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 24, color: 'var(--fg-4)' }}>No sponsored players match current filters.</td></tr>
              )}
            </tbody>
          </table>
        </ScrollTable>
      </Section>

      {/* ── Section 3 — Player impact map ─────────────────────── */}
      <Section id="impact-map"
        title="Player impact map"
        info="Each bubble is one athlete. X-axis: reach (Instagram followers). Y-axis: engagement rate. Bubble size: total signals (posts + mentions). JOOLA athletes outlined in white. Athletes with no engagement data are omitted."
        source="influencers + influencer_posts + mention_facts"
        sub="Hover any bubble to see details · Stars = protect · Micro = best ROI · Celebrity = reconsider"
      >
        <div className="card" style={{ padding: '20px 24px', overflow: 'visible' }}>
          <ImpactBubbleMap bubbles={bubblePool} brands={brands} />
        </div>
      </Section>

      {/* ── Section 4 — Cross-platform player attention ───────── */}
      <Section id="attention"
        title="Cross-platform player attention"
        info="See which players are getting the most fan attention. Total = their posts + fan mentions across all platforms. Click any column to sort and compare."
        source="Instagram posts · YouTube · TikTok · X · Reddit"
        sub={`${filteredAttention.length > 200 ? `top 200 of ${filteredAttention.length}` : filteredAttention.length} players · sorted by total`}
      >
        <ScrollTable maxHeight={520}>
          <table className="data">
            <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#0d1117' }}>
              <tr>
                <th>#</th>
                <SortTh col="player" label="Player" sortKey={attentionSort.key as string | null} sortDir={attentionSort.dir} toggle={(k) => setAttentionSort(s => ({ key: k as keyof PlatformAttention, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} />
                <SortTh col="brandSlug" label="Brand" sortKey={attentionSort.key as string | null} sortDir={attentionSort.dir} toggle={(k) => setAttentionSort(s => ({ key: k as keyof PlatformAttention, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} />
                <SortTh col="total" label="Total" sortKey={attentionSort.key as string | null} sortDir={attentionSort.dir} toggle={(k) => setAttentionSort(s => ({ key: k as keyof PlatformAttention, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <SortTh col="ig" label="IG" sortKey={attentionSort.key as string | null} sortDir={attentionSort.dir} toggle={(k) => setAttentionSort(s => ({ key: k as keyof PlatformAttention, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} title="Instagram posts and mentions" />
                <SortTh col="yt" label="YT" sortKey={attentionSort.key as string | null} sortDir={attentionSort.dir} toggle={(k) => setAttentionSort(s => ({ key: k as keyof PlatformAttention, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} title="YouTube — data collection pending for most athletes" />
                <SortTh col="tiktok" label="TikTok" sortKey={attentionSort.key as string | null} sortDir={attentionSort.dir} toggle={(k) => setAttentionSort(s => ({ key: k as keyof PlatformAttention, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} title="TikTok — data collection pending for most athletes" />
                <SortTh col="x" label="X" sortKey={attentionSort.key as string | null} sortDir={attentionSort.dir} toggle={(k) => setAttentionSort(s => ({ key: k as keyof PlatformAttention, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} title="X (Twitter) — data collection pending for most athletes" />
                <SortTh col="reddit" label="Reddit" sortKey={attentionSort.key as string | null} sortDir={attentionSort.dir} toggle={(k) => setAttentionSort(s => ({ key: k as keyof PlatformAttention, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} title="Reddit — data collection pending for most athletes" />
                <SortTh col="engagement" label="Engagement" sortKey={attentionSort.key as string | null} sortDir={attentionSort.dir} toggle={(k) => setAttentionSort(s => ({ key: k as keyof PlatformAttention, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <th>Sentiment</th>
                <th>Trend</th>
              </tr>
              <tr className="col-filter-row">
                <th />
                <th><ColumnFilter col="player" value={attentionColFilter.player} onChange={v => setAttentionColFilter(p => ({ ...p, player: v }))} /></th>
                <th><ColumnFilter col="brandSlug" value={attentionColFilter.brandSlug} onChange={v => setAttentionColFilter(p => ({ ...p, brandSlug: v }))} /></th>
                <th colSpan={9} />
              </tr>
            </thead>
            <tbody>
              {sortBy(filteredAttention, attentionSort.key, attentionSort.dir).slice(0, 200).map((r, i) => (
                <tr key={`${r.player}-${r.brandSlug}`} className={r.brandSlug === 'joola' ? 'joola' : ''}
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => { if ((e.target as HTMLElement).closest('a')) return; router.push(`/v2/influencers/player/${encodeURIComponent(r.brandSlug + '--' + r.player)}`) }}>
                  <td className="cell-num">{i + 1}</td>
                  <td style={{ fontWeight: 700 }}>{r.player}</td>
                  <td><BrandCell slug={r.brandSlug} brands={brands} /></td>
                  <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625', fontWeight: 700 }}>{fmt(r.total)}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{r.ig > 0 ? fmt(r.ig) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{r.yt > 0 ? fmt(r.yt) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{r.tiktok > 0 ? fmt(r.tiktok) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{r.x > 0 ? fmt(r.x) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{r.reddit > 0 ? fmt(r.reddit) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(r.engagement)}</td>
                  <td>
                    <SentimentMix positive={r.positive} negative={r.negative} total={r.total} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {r.trend === 'up'   && <span style={{ color: '#22c55e', fontWeight: 700, fontSize: 13 }} title="Trending up — more signals in the last 14 days vs prior 14 days">▲</span>}
                    {r.trend === 'down' && <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 13 }} title="Trending down — fewer signals in the last 14 days vs prior 14 days">▼</span>}
                    {r.trend === 'flat' && <span style={{ color: '#94a3b8', fontWeight: 700, fontSize: 11 }} title="Stable — similar signal volume over the last 28 days">▬</span>}
                    {r.trend === 'unknown' && <span style={{ color: 'var(--fg-4)', fontSize: 11 }} title="Not enough data to determine trend">—</span>}
                  </td>
                </tr>
              ))}
              {filteredAttention.length === 0 && (
                <tr><td colSpan={12} style={{ textAlign: 'center', padding: 24, color: 'var(--fg-4)' }}>No player attention rows match current filters.</td></tr>
              )}
            </tbody>
          </table>
        </ScrollTable>
      </Section>

      {/* ── Section 5 — Athlete performance ──────────────────── */}
      <Section id="performance"
        title="Player performance"
        info="Every scraped athlete with rolled-up post stats. Engagement rate above 8% (highlighted in yellow) is exceptional. Athletes with no posts in the current window are sorted to the bottom."
        source="influencers + influencer_posts"
        sub={`${filteredInfluencers.length} athletes`}
      >
        <ScrollTable maxHeight={520}>
          <table className="data">
            <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#0d1117' }}>
              <tr>
                <th>#</th>
                <SortTh col="name" label="Athlete" sortKey={perfSort.key as string | null} sortDir={perfSort.dir} toggle={(k) => setPerfSort(s => ({ key: k as keyof InfluencerRow, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} />
                <SortTh col="brandSlug" label="Brand" sortKey={perfSort.key as string | null} sortDir={perfSort.dir} toggle={(k) => setPerfSort(s => ({ key: k as keyof InfluencerRow, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} />
                <th>Platforms</th>
                <SortTh col="followers" label="Followers" sortKey={perfSort.key as string | null} sortDir={perfSort.dir} toggle={(k) => setPerfSort(s => ({ key: k as keyof InfluencerRow, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <SortTh col="posts" label="Posts" sortKey={perfSort.key as string | null} sortDir={perfSort.dir} toggle={(k) => setPerfSort(s => ({ key: k as keyof InfluencerRow, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <SortTh col="avgLikes" label="Avg likes" sortKey={perfSort.key as string | null} sortDir={perfSort.dir} toggle={(k) => setPerfSort(s => ({ key: k as keyof InfluencerRow, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <SortTh col="avgComments" label="Avg comments" sortKey={perfSort.key as string | null} sortDir={perfSort.dir} toggle={(k) => setPerfSort(s => ({ key: k as keyof InfluencerRow, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <SortTh col="engRate" label="ER" sortKey={perfSort.key as string | null} sortDir={perfSort.dir} toggle={(k) => setPerfSort(s => ({ key: k as keyof InfluencerRow, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <th>Tier</th>
                <th>Status</th>
              </tr>
              <tr className="col-filter-row">
                <th />
                <th><ColumnFilter col="name" value={perfColFilter.name} onChange={v => setPerfColFilter(p => ({ ...p, name: v }))} /></th>
                <th><ColumnFilter col="brandSlug" value={perfColFilter.brandSlug} onChange={v => setPerfColFilter(p => ({ ...p, brandSlug: v }))} /></th>
                <th colSpan={8} />
              </tr>
            </thead>
            <tbody>
              {sortBy(filteredInfluencers, perfSort.key, perfSort.dir).map((r, i) => {
                const t = tierFromFollowers(r.followers)
                const active = r.posts > 0
                return (
                  <tr key={r.id} className={r.brandSlug === 'joola' ? 'joola' : ''}
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => { if ((e.target as HTMLElement).closest('a')) return; router.push(`/v2/influencers/player/${encodeURIComponent(r.brandSlug + '--' + r.name)}`) }}>
                    <td className="cell-num">{i + 1}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 22, height: 22, borderRadius: 6, background: pgColor(r.brandSlug) + '33', color: pgColor(r.brandSlug), border: `1px solid ${pgColor(r.brandSlug)}55`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800 }}>{r.init}</span>
                        <span style={{ fontWeight: 700 }}>{r.name}</span>
                      </div>
                    </td>
                    <td><BrandCell slug={r.brandSlug} brands={brands} /></td>
                    <td>
                      <div style={{ display: 'inline-flex', gap: 3 }}>
                        {r.igHandle && <PlatformPill p="ig" />}
                        {r.xHandle && <PlatformPill p="x" />}
                        {!r.igHandle && !r.xHandle && <span style={{ color: 'var(--fg-4)', fontSize: 11 }}>—</span>}
                      </div>
                    </td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(r.followers)}</td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{r.posts || <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{r.avgLikes > 0 ? fmt(r.avgLikes) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{r.avgComments > 0 ? fmt(r.avgComments) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                    <td className="cell-num" style={{ textAlign: 'right', color: r.engRate > 8 ? '#F5E625' : r.engRate === 0 ? 'var(--fg-4)' : 'var(--fg)' }}>
                      {r.engRate > 0 ? r.engRate.toFixed(2) + '%' : '—'}
                    </td>
                    <td><span style={{ fontSize: 10, fontWeight: 800, color: t.color, letterSpacing: '0.06em' }}>{t.label}</span></td>
                    <td>
                      <span style={{
                        fontSize: 10, fontWeight: 700,
                        color: active ? '#22c55e' : '#94a3b8',
                        padding: '2px 8px', borderRadius: 99,
                        background: active ? 'rgba(34,197,94,0.10)' : 'rgba(148,163,184,0.10)',
                        border: `1px solid ${active ? 'rgba(34,197,94,0.30)' : 'rgba(148,163,184,0.30)'}`,
                      }}>{active ? 'Active' : 'Inactive'}</span>
                    </td>
                  </tr>
                )
              })}
              {filteredInfluencers.length === 0 && (
                <tr><td colSpan={11} style={{ textAlign: 'center', padding: 24, color: 'var(--fg-4)' }}>No athletes match current filters.</td></tr>
              )}
            </tbody>
          </table>
        </ScrollTable>
      </Section>

      {/* ── Section 6 — Brand sponsored-player strength ──────── */}
      <Section id="brand-strength"
        title="Brand sponsored-player strength"
        info="Per-brand roll-up: total players sponsored, how many are actively producing data, total reach and engagement, plus the per-platform mention breakdown. Sort by Engagement to see which brand's athletes are driving the most attention."
        source="playerRoster.ts + influencers + influencer_posts + mention_facts"
        sub={`${filteredBrandStats.length} brands`}
      >
        <ScrollTable>
          <table className="data">
            <thead>
              <tr>
                <SortTh col="brandSlug" label="Brand" sortKey={brandStatsSort.key as string | null} sortDir={brandStatsSort.dir} toggle={(k) => setBrandStatsSort(s => ({ key: k as keyof BrandPlayerStats, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} />
                <SortTh col="playersTracked" label="Players" sortKey={brandStatsSort.key as string | null} sortDir={brandStatsSort.dir} toggle={(k) => setBrandStatsSort(s => ({ key: k as keyof BrandPlayerStats, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <SortTh col="playersActive" label="Active" sortKey={brandStatsSort.key as string | null} sortDir={brandStatsSort.dir} toggle={(k) => setBrandStatsSort(s => ({ key: k as keyof BrandPlayerStats, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <SortTh col="totalMentions" label="Mentions" sortKey={brandStatsSort.key as string | null} sortDir={brandStatsSort.dir} toggle={(k) => setBrandStatsSort(s => ({ key: k as keyof BrandPlayerStats, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <SortTh col="totalReach" label="Reach" sortKey={brandStatsSort.key as string | null} sortDir={brandStatsSort.dir} toggle={(k) => setBrandStatsSort(s => ({ key: k as keyof BrandPlayerStats, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <SortTh col="avgEngRate" label="Avg ER" sortKey={brandStatsSort.key as string | null} sortDir={brandStatsSort.dir} toggle={(k) => setBrandStatsSort(s => ({ key: k as keyof BrandPlayerStats, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <SortTh col="totalEngagement" label="Engagement" sortKey={brandStatsSort.key as string | null} sortDir={brandStatsSort.dir} toggle={(k) => setBrandStatsSort(s => ({ key: k as keyof BrandPlayerStats, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <SortTh col="ig" label="IG" sortKey={brandStatsSort.key as string | null} sortDir={brandStatsSort.dir} toggle={(k) => setBrandStatsSort(s => ({ key: k as keyof BrandPlayerStats, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <SortTh col="yt" label="YT" sortKey={brandStatsSort.key as string | null} sortDir={brandStatsSort.dir} toggle={(k) => setBrandStatsSort(s => ({ key: k as keyof BrandPlayerStats, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <SortTh col="tiktok" label="TikTok" sortKey={brandStatsSort.key as string | null} sortDir={brandStatsSort.dir} toggle={(k) => setBrandStatsSort(s => ({ key: k as keyof BrandPlayerStats, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <SortTh col="x" label="X" sortKey={brandStatsSort.key as string | null} sortDir={brandStatsSort.dir} toggle={(k) => setBrandStatsSort(s => ({ key: k as keyof BrandPlayerStats, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <SortTh col="reddit" label="Reddit" sortKey={brandStatsSort.key as string | null} sortDir={brandStatsSort.dir} toggle={(k) => setBrandStatsSort(s => ({ key: k as keyof BrandPlayerStats, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <SortTh col="negativePct" label="Negative %" sortKey={brandStatsSort.key as string | null} sortDir={brandStatsSort.dir} toggle={(k) => setBrandStatsSort(s => ({ key: k as keyof BrandPlayerStats, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
              </tr>
            </thead>
            <tbody>
              {sortBy(filteredBrandStats, brandStatsSort.key, brandStatsSort.dir).map(r => (
                <tr key={r.brandSlug} className={r.brandSlug === 'joola' ? 'joola' : ''}
                  style={{ cursor: 'pointer' }}
                  onClick={() => router.push(`/v2/influencers/brand/${encodeURIComponent(r.brandSlug)}`)}>
                  <td><BrandCell slug={r.brandSlug} brands={brands} /></td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{r.playersTracked}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{r.playersActive}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(r.totalMentions)}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(r.totalReach)}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{r.avgEngRate > 0 ? r.avgEngRate.toFixed(2) + '%' : '—'}</td>
                  <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625', fontWeight: 700 }}>{fmt(r.totalEngagement)}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{r.ig > 0 ? fmt(r.ig) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{r.yt > 0 ? fmt(r.yt) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{r.tiktok > 0 ? fmt(r.tiktok) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{r.x > 0 ? fmt(r.x) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{r.reddit > 0 ? fmt(r.reddit) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                  <td className="cell-num" style={{ textAlign: 'right', color: r.negativePct > 20 ? '#ef4444' : 'var(--fg)' }}>{r.negativePct > 0 ? r.negativePct.toFixed(1) + '%' : '—'}</td>
                </tr>
              ))}
              {filteredBrandStats.length === 0 && (
                <tr><td colSpan={13} style={{ textAlign: 'center', padding: 24, color: 'var(--fg-4)' }}>No brand stats match current filters.</td></tr>
              )}
            </tbody>
          </table>
        </ScrollTable>
      </Section>

      {/* ── Section 7 — Top performing player content ────────── */}
      <Section id="top-content"
        title="Top performing player content"
        info="Highest-engagement posts from tracked athletes in the selected window. Sourced from influencer_posts; today this is Instagram only. Add platform-specific scrapers and the table fills automatically."
        source="influencer_posts"
        sub={`${filteredContent.length > 200 ? `showing 200 of ${filteredContent.length}` : filteredContent.length} posts`}
      >
        <ScrollTable maxHeight={520}>
          <table className="data">
            <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#0d1117' }}>
              <tr>
                <th>Platform</th>
                <SortTh col="athleteName" label="Player" sortKey={contentSort.key as string | null} sortDir={contentSort.dir} toggle={(k) => setContentSort(s => ({ key: k as keyof InfluencerPostRow, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} />
                <SortTh col="brandSlug" label="Brand" sortKey={contentSort.key as string | null} sortDir={contentSort.dir} toggle={(k) => setContentSort(s => ({ key: k as keyof InfluencerPostRow, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} />
                <th style={{ width: '24%' }}>Caption</th>
                <th>Type</th>
                <SortTh col="views" label="Views" sortKey={contentSort.key as string | null} sortDir={contentSort.dir} toggle={(k) => setContentSort(s => ({ key: k as keyof InfluencerPostRow, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <SortTh col="likes" label="Likes" sortKey={contentSort.key as string | null} sortDir={contentSort.dir} toggle={(k) => setContentSort(s => ({ key: k as keyof InfluencerPostRow, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <SortTh col="comments" label="Comments" sortKey={contentSort.key as string | null} sortDir={contentSort.dir} toggle={(k) => setContentSort(s => ({ key: k as keyof InfluencerPostRow, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <SortTh col="shares" label="Shares" sortKey={contentSort.key as string | null} sortDir={contentSort.dir} toggle={(k) => setContentSort(s => ({ key: k as keyof InfluencerPostRow, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <SortTh col="engagement" label="Engagement" sortKey={contentSort.key as string | null} sortDir={contentSort.dir} toggle={(k) => setContentSort(s => ({ key: k as keyof InfluencerPostRow, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <SortTh col="engRate" label="ER" sortKey={contentSort.key as string | null} sortDir={contentSort.dir} toggle={(k) => setContentSort(s => ({ key: k as keyof InfluencerPostRow, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                <th>Sentiment</th>
                <SortTh col="days" label="Posted" sortKey={contentSort.key as string | null} sortDir={contentSort.dir} toggle={(k) => setContentSort(s => ({ key: k as keyof InfluencerPostRow, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} />
                <th>Link</th>
              </tr>
              <tr className="col-filter-row">
                <th />
                <th><ColumnFilter col="athleteName" value={contentColFilter.athleteName} onChange={v => setContentColFilter(p => ({ ...p, athleteName: v }))} /></th>
                <th><ColumnFilter col="brandSlug" value={contentColFilter.brandSlug} onChange={v => setContentColFilter(p => ({ ...p, brandSlug: v }))} /></th>
                <th><ColumnFilter col="caption" value={contentColFilter.caption} onChange={v => setContentColFilter(p => ({ ...p, caption: v }))} /></th>
                <th colSpan={9} />
              </tr>
            </thead>
            <tbody>
              {sortBy(filteredContent, contentSort.key, contentSort.dir).slice(0, 200).map((p) => (
                <tr
                    key={p.id}
                    className={p.brandSlug === 'joola' ? 'joola' : ''}
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => { if ((e.target as HTMLElement).closest('a')) return; setDrillContent(p) }}
                  >
                  <td><PlatformPill p={p.platform} /></td>
                  <td style={{ fontWeight: 700 }}>{p.athleteName}</td>
                  <td><BrandCell slug={p.brandSlug} brands={brands} /></td>
                  <td title={p.caption} style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.caption || '—'}</td>
                  <td><span style={{ fontSize: 10, color: 'var(--fg-3)' }}>{p.type || '—'}</span></td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{p.views > 0 ? fmt(p.views) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(p.likes)}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(p.comments)}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{p.shares > 0 ? fmt(p.shares) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                  <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625' }}>{fmt(p.engagement)}</td>
                  <td className="cell-num" style={{ textAlign: 'right' }}>{p.engRate > 0 ? p.engRate.toFixed(2) + '%' : '—'}</td>
                  <td>
                    <span className={'pill ' + SENT_PILL[p.sentiment]} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, fontWeight: 700 }}>{p.sentiment}</span>
                  </td>
                  <td className="cell-num">{p.postedAt ? formatCalendarDate(p.postedAt) : '—'}</td>
                  <td>{p.url ? <a className="ext-link" href={p.url} target="_blank" rel="noreferrer">View</a> : '—'}</td>
                </tr>
              ))}
              {filteredContent.length === 0 && (
                <tr><td colSpan={14} style={{ textAlign: 'center', padding: 24, color: 'var(--fg-4)' }}>No content matches current filters (try widening the date range).</td></tr>
              )}
            </tbody>
          </table>
        </ScrollTable>
      </Section>

      {/* ── Section 8 — Player mentions in community ──────────── */}
      <Section id="community-mentions"
        title="Player mentions in community conversation"
        info="Cross-channel mention_facts rows where athlete_id is set. Today this is dominated by ig_comments; YouTube / TikTok / X / Reddit player extraction is pending — see Section 12."
        source="mention_facts (athlete_id not null)"
        sub={`${filteredMentions.length > 200 ? `showing 200 of ${filteredMentions.length}` : filteredMentions.length} mentions`}
      >
        {filteredMentions.length === 0 ? (
          <div className="card"><div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-4)' }}>
            <div style={{ fontSize: 13, marginBottom: 6 }}>No player mentions in mention_facts for the current window.</div>
            <div style={{ fontSize: 11 }}>Pending: extend enrichment to populate athlete_id from yt_comments, reddit_mentions, tiktok_videos, x_posts.</div>
          </div></div>
        ) : (
          <ScrollTable maxHeight={520}>
            <table className="data">
              <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#0d1117' }}>
                <tr>
                  <SortTh col="player" label="Player" sortKey={mentionSort.key as string | null} sortDir={mentionSort.dir} toggle={(k) => setMentionSort(s => ({ key: k as keyof CommunityMention, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} />
                  <SortTh col="brandSlug" label="Brand" sortKey={mentionSort.key as string | null} sortDir={mentionSort.dir} toggle={(k) => setMentionSort(s => ({ key: k as keyof CommunityMention, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} />
                  <SortTh col="channelLabel" label="Channel" sortKey={mentionSort.key as string | null} sortDir={mentionSort.dir} toggle={(k) => setMentionSort(s => ({ key: k as keyof CommunityMention, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} />
                  <th style={{ width: '34%' }}>Mention</th>
                  <th>Sentiment</th>
                  <th>Product</th>
                  <SortTh col="engagement" label="Eng." sortKey={mentionSort.key as string | null} sortDir={mentionSort.dir} toggle={(k) => setMentionSort(s => ({ key: k as keyof CommunityMention, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} style={{ textAlign: 'right' }} />
                  <SortTh col="days" label="Date" sortKey={mentionSort.key as string | null} sortDir={mentionSort.dir} toggle={(k) => setMentionSort(s => ({ key: k as keyof CommunityMention, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }))} />
                  <th>Link</th>
                </tr>
                <tr className="col-filter-row">
                  <th><ColumnFilter col="player" value={mentionColFilter.player} onChange={v => setMentionColFilter(p => ({ ...p, player: v }))} /></th>
                  <th><ColumnFilter col="brandSlug" value={mentionColFilter.brandSlug} onChange={v => setMentionColFilter(p => ({ ...p, brandSlug: v }))} /></th>
                  <th colSpan={7} />
                </tr>
              </thead>
              <tbody>
                {sortBy(filteredMentions, mentionSort.key, mentionSort.dir).slice(0, 200).map(m => (
                  <tr key={m.id} className={m.brandSlug === 'joola' ? 'joola' : ''}>
                    <td style={{ fontWeight: 700 }}>{m.player}</td>
                    <td><BrandCell slug={m.brandSlug} brands={brands} /></td>
                    <td><span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{m.channelLabel}</span></td>
                    <td title={m.mentionText} style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.mentionText || '—'}</td>
                    <td>
                      <span className={'pill ' + SENT_PILL[m.sentiment]} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, fontWeight: 700 }}>{m.sentiment}</span>
                    </td>
                    <td>{m.productName ? <span style={{ fontSize: 11 }}>{m.productName}</span> : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{m.engagement > 0 ? fmt(m.engagement) : '—'}</td>
                    <td className="cell-num">{m.postedAt ? formatCalendarDate(m.postedAt) : '—'}</td>
                    <td>{m.link ? <a className="ext-link" href={m.link} target="_blank" rel="noreferrer">View</a> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        )}
      </Section>

      {/* ── Section 9 — JOOLA focus ───────────────────────────── */}
      <Section id="joola-focus"
        title="JOOLA sponsored player focus"
        info="A side-by-side view of every JOOLA-sponsored athlete — how many people follow them, how engaged their audience is, their most popular post, and whether any paddle is being mentioned alongside them."
        source="Instagram · influencer posts · community mentions"
        sub={`${data.joolaPlayerStats.length} athletes`}
      >
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Player</th>
                  <th style={{ textAlign: 'right' }}>Signals</th>
                  <th style={{ textAlign: 'right' }}>IG</th>
                  <th style={{ textAlign: 'right' }}>YT</th>
                  <th style={{ textAlign: 'right' }}>TikTok</th>
                  <th style={{ textAlign: 'right' }}>X</th>
                  <th style={{ textAlign: 'right' }}>Reddit</th>
                  <th style={{ textAlign: 'right' }}>Reach</th>
                  <th style={{ textAlign: 'right' }}>ER</th>
                  <th>Top content</th>
                  <th>Sentiment</th>
                  <th>Related paddle</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                {data.joolaPlayerStats.map(j => (
                  <tr key={j.player} className="joola"
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => { if ((e.target as HTMLElement).closest('a')) return; router.push(`/v2/influencers/player/${encodeURIComponent('joola--' + j.player)}`) }}>
                    <td style={{ fontWeight: 700, color: '#22c55e' }}>{j.player}</td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{j.signals > 0 ? fmt(j.signals) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{j.ig > 0 ? fmt(j.ig) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{j.yt > 0 ? fmt(j.yt) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{j.tiktok > 0 ? fmt(j.tiktok) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{j.x > 0 ? fmt(j.x) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{j.reddit > 0 ? fmt(j.reddit) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{j.reach > 0 ? fmt(j.reach) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{j.engRate > 0 ? j.engRate.toFixed(2) + '%' : '—'}</td>
                    <td title={j.topContent || ''} style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {j.topContent
                        ? (j.topContentUrl ? <a className="ext-link" href={j.topContentUrl} target="_blank" rel="noreferrer">{j.topContent}</a> : j.topContent)
                        : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                    </td>
                    <td>
                      {j.sentiment === 'no-data'
                        ? <span style={{ color: 'var(--fg-4)', fontSize: 11 }}>—</span>
                        : <span
                            className={'pill ' + (SENT_PILL[j.sentiment as keyof typeof SENT_PILL] || (j.sentiment === 'mixed' ? 'pill-amber' : 'pill-ghost'))}
                            style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, fontWeight: 700 }}
                          >{j.sentiment}</span>
                      }
                    </td>
                    <td>{j.relatedPaddle ? <span style={{ fontSize: 11 }}>{j.relatedPaddle}</span> : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                    <td><span style={{ color: 'var(--fg-4)', fontSize: 11 }}>—</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      {/* ── Section 10 — Player ↔ paddle connections ──────────── */}
      <Section id="player-paddle"
        title="Player and paddle connections"
        info="Rows where mention_facts links an athlete AND a product in the same enriched message. Empty state expected until the enrichment prompt is tightened — see Section 12."
        source="mention_facts (athlete_id AND product_id non-null)"
        sub={`${data.playerProductConnections.length} connections`}
      >
        {data.playerProductConnections.length === 0 ? (
          <div className="card"><div style={{ padding: 24, color: 'var(--fg-4)' }}>
            <div style={{ fontSize: 13, marginBottom: 6 }}>No player ↔ paddle connections in mention_facts yet.</div>
            <div style={{ fontSize: 11 }}>This section becomes useful once enrichment extracts both athlete_id AND product_id from the same comment / mention. Recommended fix: see Section 12.</div>
          </div></div>
        ) : (
          <ScrollTable maxHeight={420}>
            <table className="data">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Brand</th>
                  <th>Paddle</th>
                  <th style={{ textAlign: 'right' }}>Mentions</th>
                  <th>Channel</th>
                  <th>Sentiment</th>
                  <th style={{ textAlign: 'right' }}>Attention</th>
                </tr>
              </thead>
              <tbody>
                {data.playerProductConnections.slice(0, 200).map((r, i) => (
                  <tr key={i} className={r.brandSlug === 'joola' ? 'joola' : ''}>
                    <td style={{ fontWeight: 700 }}>{r.player}</td>
                    <td><BrandCell slug={r.brandSlug} brands={brands} /></td>
                    <td><span style={{ fontSize: 12 }}>{r.productName}</span></td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(r.mentions)}</td>
                    <td><span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{r.channelLabel}</span></td>
                    <td><SentimentMix positive={r.positive} negative={r.negative} total={r.mentions} /></td>
                    <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625' }}>{r.attentionScore.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        )}
      </Section>

      {/* ── Section 11 — Data coverage diagnostic ─────────────── */}
      <Section id="coverage"
        title="Influencer data coverage"
        info="What's currently flowing into Influencer Intel. Items marked No are not bugs — they tell you which pipeline pieces to wire up next."
        source="Derived from fetched data"
      >
        <div className="card"><div className="card-pad-lg" style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <CoveragePill label="IG players"           value={data.dataCoverage.igRoster ? 'Yes' : 'No'}     ok={data.dataCoverage.igRoster}           tip="We have scraped Instagram profiles for the sponsored athletes. Green = at least one athlete's IG account is tracked." />
          <CoveragePill label="IG posts"            value={String(data.dataCoverage.igPosts)}             ok={data.dataCoverage.igPosts > 0}        tip={`Number of Instagram posts collected from sponsored athletes. ${data.dataCoverage.igPosts > 0 ? 'Data is flowing.' : 'No posts collected yet — run the scraper.'}`} />
          <CoveragePill label="YT mentions"         value={String(data.dataCoverage.ytMentions)}          ok={data.dataCoverage.ytMentions > 0}     tip={`YouTube comments or videos that mention a tracked athlete. ${data.dataCoverage.ytMentions > 0 ? 'Data available.' : 'Pending — YouTube athlete extraction not yet running.'}`} />
          <CoveragePill label="TikTok mentions"     value={String(data.dataCoverage.tiktokMentions)}      ok={data.dataCoverage.tiktokMentions > 0} tip={`TikTok posts or comments mentioning a tracked athlete. ${data.dataCoverage.tiktokMentions > 0 ? 'Data available.' : 'Pending — TikTok athlete extraction not yet running.'}`} />
          <CoveragePill label="X mentions"          value={String(data.dataCoverage.xMentions)}           ok={data.dataCoverage.xMentions > 0}      tip={`X (Twitter) posts that mention a tracked athlete. ${data.dataCoverage.xMentions > 0 ? 'Data available.' : 'Pending — X athlete extraction not yet running.'}`} />
          <CoveragePill label="Reddit mentions"     value={String(data.dataCoverage.redditMentions)}      ok={data.dataCoverage.redditMentions > 0} tip={`Reddit posts or comments mentioning a tracked athlete. ${data.dataCoverage.redditMentions > 0 ? 'Data available.' : 'Pending — Reddit athlete extraction not yet running.'}`} />
          <CoveragePill label="Comment mentions"    value={data.dataCoverage.commentLevelMentions ? 'Yes' : 'No'} ok={data.dataCoverage.commentLevelMentions} tip="Whether we are extracting athlete mentions from individual comments (not just top-level posts). Enables more granular fan conversation tracking." />
          <CoveragePill label="Name matching"       value={data.dataCoverage.aliasMatching ? 'Yes' : 'No'} ok={data.dataCoverage.aliasMatching}     tip="Whether the system can match alternative player names (e.g. 'Ben J' → 'Ben Johns'). Improves mention accuracy." />
          <CoveragePill label="Sponsorship check"   value={data.dataCoverage.sponsorshipVerification ? 'Yes' : 'No'} ok={data.dataCoverage.sponsorshipVerification} tip="Whether we have cross-checked each athlete's sponsorship against their scraped social profiles to confirm the deal is current." />
        </div></div>
      </Section>

      {/* ── Section 12 — Pending pipeline work ────────────────── */}
      <Section id="pending"
        title="Sections waiting for more data"
        info="These sections are empty or incomplete because we haven't collected enough data yet. Each card explains what's missing and what needs to happen to fill it in."
        source="Data coverage check"
      >
        {data.pending.length === 0 ? (
          <div className="card"><div style={{ padding: 20, color: '#22c55e', fontSize: 13 }}>✓ All sections have data — nothing waiting.</div></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.pending.map((p, i) => (
              <div key={i} className="card"><div className="card-pad-lg">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-accent)', fontSize: 13 }}>{p.section}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-accent)', fontWeight: 700, background: 'var(--text-accent-bg, rgba(245,230,37,0.12))', padding: '2px 8px', borderRadius: 99, border: '1px solid var(--text-accent-border, rgba(245,230,37,0.3))' }}>WAITING FOR DATA</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--fg-2)', marginBottom: 6 }}><strong>Why it&apos;s empty:</strong> {p.why}</div>
                <div style={{ fontSize: 12, color: 'var(--fg-2)', marginBottom: 6 }}><strong>What&apos;s needed:</strong> {p.requiredSource}</div>
                <div style={{ fontSize: 12, color: '#60a5fa' }}><strong>Next step:</strong> {p.recommendation}</div>
              </div></div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Section E — Athlete Impact Score ──────────────────── */}
      <Section id="athlete-impact"
        title="Athlete impact score"
        info="A single score ranking each athlete by their overall impact — combining how often they post, how engaged their audience is, how many fans mention them, how much their following is growing, and how positive the sentiment is around them. Higher score = greater brand value."
        source="Instagram posts · community mentions · follower snapshots"
        sub={`${athleteImpact.length > 100 ? `top 100 of ${athleteImpact.length}` : athleteImpact.length} athletes scored`}
      >
        <ScrollTable maxHeight={520}>
          <table className="data">
            <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#0d1117' }}>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Brand</th>
                <th style={{ textAlign: 'right' }}>Posts (30d)</th>
                <th style={{ textAlign: 'right' }}>Avg eng</th>
                <th style={{ textAlign: 'right' }}>Mentions</th>
                <th style={{ textAlign: 'right' }}>Growth %</th>
                <th style={{ textAlign: 'right' }}>Product mentions</th>
                <th style={{ textAlign: 'right' }}>Positive %</th>
                <th style={{ textAlign: 'right' }}>Impact score</th>
                <th>Class</th>
              </tr>
            </thead>
            <tbody>
              {athleteImpact.length === 0 && (
                <tr><td colSpan={11} style={{ textAlign: 'center', padding: 24, color: 'var(--fg-4)' }}>No athletes scored yet.</td></tr>
              )}
              {athleteImpact.slice(0, 100).map((r, i) => {
                const maxScore = athleteImpact[0]?.impactScore || 100
                const barPct = Math.min(100, (r.impactScore / maxScore) * 100)
                return (
                  <tr key={r.athleteId} className={r.brandSlug === 'joola' ? 'joola' : ''} style={{ cursor: 'pointer' }} onClick={() => setDrillImpact(r)}>
                    <td className="cell-num">{i + 1}</td>
                    <td style={{ fontWeight: 700 }}>{r.player}</td>
                    <td><BrandCell slug={r.brandSlug} brands={brands} /></td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{r.posts30d}</td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(r.avgEngagement)}</td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(r.mentions)}</td>
                    <td className="cell-num" style={{ textAlign: 'right', color: r.followerGrowthPct > 0 ? '#22c55e' : r.followerGrowthPct < 0 ? '#ef4444' : 'var(--fg-4)' }}>
                      {r.followerGrowthPct === 0 ? '—' : `${r.followerGrowthPct > 0 ? '+' : ''}${r.followerGrowthPct}%`}
                    </td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(r.productMentions)}</td>
                    <td className="cell-num" style={{ textAlign: 'right', color: r.positivePct >= 60 ? '#22c55e' : 'var(--fg)' }}>{r.positivePct}%</td>
                    <td className="cell-num" style={{ textAlign: 'right', verticalAlign: 'middle' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                        <span style={{ fontWeight: 800, color: '#F5E625' }}>{r.impactScore.toFixed(1)}</span>
                        <div style={{ width: 80, height: 5, background: 'var(--wb-5)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${barPct}%`, height: '100%', background: r.brandSlug === 'joola' ? '#22c55e' : '#F5E625' }} />
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{
                        fontSize: 10, fontWeight: 700,
                        color: r.classification === 'rising' ? '#22c55e' : r.classification === 'underperforming' ? '#ef4444' : 'var(--fg-3)',
                        padding: '2px 8px', borderRadius: 99,
                        background: r.classification === 'rising' ? 'rgba(34,197,94,0.10)' : r.classification === 'underperforming' ? 'rgba(239,68,68,0.10)' : 'rgba(148,163,184,0.10)',
                        border: `1px solid ${r.classification === 'rising' ? 'rgba(34,197,94,0.30)' : r.classification === 'underperforming' ? 'rgba(239,68,68,0.30)' : 'rgba(148,163,184,0.30)'}`,
                      }}>{r.classification.toUpperCase()}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </ScrollTable>
      </Section>

      {/* ── Section F — Sponsored vs Organic ──────────────────── */}
      <Section id="sponsored-vs-organic"
        title="Sponsored vs organic performance"
        info="Compares engagement rate on each athlete's sponsored posts vs organic posts (influencer_posts.is_sponsored). ER capped at 100%."
        source="influencer_posts (is_sponsored split)"
        sub={`${sponsoredOrganic.length > 100 ? `showing 100 of ${sponsoredOrganic.length}` : sponsoredOrganic.length} athletes with comparable data`}
      >
        {sponsoredOrganic.length === 0 ? (
          <div className="card"><div style={{ padding: 24, color: 'var(--fg-4)', textAlign: 'center' }}>
            <div style={{ fontSize: 13, marginBottom: 6 }}>No sponsored/organic split data yet.</div>
            <div style={{ fontSize: 11 }}>Becomes meaningful once influencer_posts has a healthy mix of is_sponsored=true/false rows.</div>
          </div></div>
        ) : (
          <ScrollTable maxHeight={520}>
            <table className="data">
              <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#0d1117' }}>
                <tr>
                  <th>Player</th>
                  <th>Brand</th>
                  <th style={{ textAlign: 'right' }}>Sponsored posts</th>
                  <th style={{ textAlign: 'right' }}>Organic posts</th>
                  <th style={{ textAlign: 'right' }}>Sponsored ER</th>
                  <th style={{ textAlign: 'right' }}>Organic ER</th>
                  <th style={{ textAlign: 'right' }}>Δ</th>
                  <th>Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {sponsoredOrganic.slice(0, 100).map(r => (
                  <tr key={r.athleteId} className={r.brandSlug === 'joola' ? 'joola' : ''}>
                    <td style={{ fontWeight: 700 }}>{r.player}</td>
                    <td><BrandCell slug={r.brandSlug} brands={brands} /></td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{r.sponsoredPosts}</td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{r.organicPosts}</td>
                    <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625' }}>{r.sponsoredER.toFixed(2)}%</td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{r.organicER.toFixed(2)}%</td>
                    <td className="cell-num" style={{ textAlign: 'right', color: r.difference > 0 ? '#22c55e' : r.difference < 0 ? '#ef4444' : 'var(--fg-4)', fontWeight: 700 }}>
                      {r.difference > 0 ? '+' : ''}{r.difference.toFixed(2)}%
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--fg-3)' }}>{r.recommendation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        )}
        <ImpactCards
          competitorMove="Competitor sponsored posts are increasingly transparent (is_sponsored=true)."
          businessImpact="When sponsored ER lags organic, the partnership is burning cash without earned reach."
          recommendedAction="Pause spend on athletes with sponsored ER < 50% of organic; double down on those above 150%."
        />
      </Section>

      {/* ── Section G — Athlete-to-Product Pull ──────────────── */}
      <Section id="athlete-product-pull"
        title="Athlete-to-product pull"
        info="Pairs of (athlete, product) where mention_facts has both athlete_id AND product_id set. Sales-likelihood comes from product_attention_summary (last_30d period) when available."
        source="mention_facts (athlete_id + product_id) + product_attention_summary"
        sub={`${athletePull.length} (player × product) pairs`}
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button
            className={'chip ' + (pullJoolaOnly ? 'on' : '')}
            aria-label="Filter to JOOLA athletes only"
            aria-pressed={pullJoolaOnly}
            onClick={() => setPullJoolaOnly(v => !v)}
            style={{
              padding: '6px 12px', borderRadius: 99, fontSize: 11, fontWeight: 700,
              background: pullJoolaOnly ? 'rgba(34,197,94,0.20)' : 'var(--wb-5)',
              border: `1px solid ${pullJoolaOnly ? 'rgba(34,197,94,0.45)' : 'var(--wb-10)'}`,
              color: pullJoolaOnly ? '#22c55e' : 'var(--fg-2)',
              cursor: 'pointer',
            }}
          >
            JOOLA only
          </button>
        </div>
        {athletePull.length === 0 ? (
          <div className="card"><div style={{ padding: 24, color: 'var(--fg-4)', textAlign: 'center' }}>
            <div style={{ fontSize: 13, marginBottom: 6 }}>No (athlete × product) pairs in mention_facts yet.</div>
            <div style={{ fontSize: 11 }}>Becomes useful once enrichment extracts both athlete + product from the same mention.</div>
          </div></div>
        ) : (
          <ScrollTable maxHeight={520}>
            <table className="data">
              <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#0d1117' }}>
                <tr>
                  <th>Player</th>
                  <th>Brand</th>
                  <th>Product mentioned</th>
                  <th style={{ textAlign: 'right' }}>Mentions</th>
                  <th style={{ textAlign: 'right' }}>Engagement</th>
                  <th style={{ textAlign: 'right' }}>Sales likelihood</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {athletePull
                  .filter(r => !pullJoolaOnly || r.brandSlug === 'joola' || r.productBrandSlug === 'joola')
                  .slice(0, 200)
                  .map((r, i) => {
                    const isJoolaPlayer = r.brandSlug === 'joola'
                    return (
                      <tr key={`${r.athleteId}-${i}`} className={isJoolaPlayer ? 'joola' : ''}>
                        <td style={{ fontWeight: 700 }}>{r.player}</td>
                        <td><BrandCell slug={r.brandSlug} brands={brands} /></td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span className="brand-dot" style={{ background: pgColor(r.productBrandSlug) }} />
                            <span style={{ fontSize: 12 }}>{r.productName}</span>
                          </span>
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(r.mentions)}</td>
                        <td className="cell-num" style={{ textAlign: 'right' }}>{r.engagement > 0 ? fmt(r.engagement) : '—'}</td>
                        <td className="cell-num" style={{ textAlign: 'right', color: r.salesLikelihood > 60 ? '#22c55e' : r.salesLikelihood > 30 ? '#F5E625' : 'var(--fg-3)' }}>
                          {r.salesLikelihood > 0 ? r.salesLikelihood.toFixed(1) : '—'}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--fg-3)' }}>{r.action}</td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </ScrollTable>
        )}
        <ImpactCards
          competitorMove="Competitor athletes are publicly linking themselves to specific paddle SKUs."
          businessImpact="(Player × paddle) pairs predict sales lift weeks before inventory data confirms."
          recommendedAction="Brief JOOLA players to name the specific paddle in 1-of-3 posts; flag competitor pairings for sales-team intel."
        />
      </Section>

      {/* ── Section H — Competitor Athlete Threats ────────────── */}
      <Section id="competitor-threats"
        title="Competitor athlete threats"
        info="Top 10 competitor athletes ranked by impact score, with their dominant platform and any product they're tied to. Threat level reflects percentile rank within their own brand's player pool."
        source="influencers (brand != joola) + impact score + platformStats + product connections"
        sub="Top 10 watch list"
      >
        {competitorThreats.length === 0 ? (
          <div className="card"><div style={{ padding: 24, color: 'var(--fg-4)', textAlign: 'center' }}>No competitor athletes scored yet.</div></div>
        ) : (
          <ScrollTable>
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Brand</th>
                  <th>Top platform</th>
                  <th style={{ textAlign: 'right' }}>Engagement</th>
                  <th>Product mentioned</th>
                  <th style={{ textAlign: 'right' }}>Impact score</th>
                  <th>Threat level</th>
                </tr>
              </thead>
              <tbody>
                {competitorThreats.map((r, i) => {
                  const threatColor = r.threatLevel === 'critical' ? '#ef4444'
                    : r.threatLevel === 'high' ? '#fb923c'
                      : r.threatLevel === 'moderate' ? '#F5E625' : '#94a3b8'
                  return (
                    <tr key={r.athleteId}>
                      <td className="cell-num">{i + 1}</td>
                      <td style={{ fontWeight: 700 }}>{r.player}</td>
                      <td><BrandCell slug={r.brandSlug} brands={brands} /></td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <PlatformPill p={r.topPlatform} />
                          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{r.topPlatformCount}</span>
                        </span>
                      </td>
                      <td className="cell-num" style={{ textAlign: 'right' }}>{r.engagement > 0 ? fmt(r.engagement) : '—'}</td>
                      <td style={{ fontSize: 12 }}>{r.productMentioned || <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                      <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625', fontWeight: 700 }}>{r.impactScore.toFixed(1)}</td>
                      <td>
                        <span style={{
                          fontSize: 10, fontWeight: 800, letterSpacing: '0.06em',
                          color: threatColor,
                          padding: '2px 8px', borderRadius: 99,
                          background: `${threatColor}22`,
                          border: `1px solid ${threatColor}55`,
                        }}>{r.threatLevel.toUpperCase()}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </ScrollTable>
        )}
        <ImpactCards
          competitorMove="Competitor brands are concentrating engagement around a small set of high-impact athletes."
          businessImpact="One critical-threat athlete can outweigh ten organic JOOLA athletes' combined reach."
          recommendedAction="Run a counter-content sprint or partnership outreach against the top-3 critical threats this quarter."
        />
      </Section>

      {/* ── Section 13 — Review required ──────────────────────── */}
      {data.reviewRequired.length > 0 && (
        <Section id="review"
          title="Review required"
          info="Items that need a human verdict — typically because the source data is ambiguous (player under multiple brands) or the sponsorship list disagrees with scraped data."
          source="Derived from sponsored player list vs. scraped data"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.reviewRequired.map((r, i) => (
              <div key={i} className="card"><div className="card-pad-lg">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, color: '#fb923c', fontSize: 13 }}>{r.section}</span>
                  <span style={{ fontSize: 10, color: 'var(--fg-4)', fontWeight: 700, letterSpacing: '0.08em' }}>REVIEW</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>{r.detail}</div>
              </div></div>
            ))}
          </div>
        </Section>
      )}
    </>
  )
}

// ─── Small inline components ─────────────────────────────────────────

function Section({ id, title, info, source, sub, children }: {
  id: string; title: string; info: string; source: string; sub?: string; children: React.ReactNode
}) {
  return (
    <section id={id} style={{ marginTop: 24 }}>
      <div className="section-head">
        <div>
          <h2>
            {title}
            <SectionInfo title={title} description={info} source={source} />
          </h2>
          {sub && <div className="sub">{sub}</div>}
        </div>
      </div>
      {children}
    </section>
  )
}

function ScrollTable({ children, maxHeight }: { children: React.ReactNode; maxHeight?: number }) {
  return (
    <div
      className="card"
      style={maxHeight ? { maxHeight, overflowX: 'auto', overflowY: 'auto' } : undefined}
    >
      {children}
    </div>
  )
}

function SummaryStat({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 100 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 800, color: accent || 'var(--fg)' }}>{value}</span>
      {sub && <span style={{ fontSize: 10, color: 'var(--fg-4)' }}>{sub}</span>}
    </div>
  )
}

function BrandCell({ slug, brands }: { slug: string; brands: V2Brand[] }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span className="brand-dot" style={{ background: pgColor(slug) }} />
      <span style={{ fontWeight: 700, color: slug === 'joola' ? '#22c55e' : 'var(--fg)', fontSize: 12 }}>
        {pgName(slug, brands)}
      </span>
    </span>
  )
}

function PlatformPill({ p }: { p: IntelPlatform }) {
  const colorMap: Record<IntelPlatform, { bg: string; bd: string; fg: string }> = {
    ig:     { bg: 'rgba(236,72,153,0.14)', bd: 'rgba(236,72,153,0.35)', fg: '#ec4899' },
    yt:     { bg: 'rgba(239,68,68,0.14)',  bd: 'rgba(239,68,68,0.35)',  fg: '#ef4444' },
    tiktok: { bg: 'var(--wb-6)', bd: 'rgba(255,255,255,0.18)', fg: 'var(--fg-2)' },
    x:      { bg: 'var(--wb-6)', bd: 'rgba(255,255,255,0.18)', fg: 'var(--fg-2)' },
    reddit: { bg: 'rgba(251,146,60,0.14)', bd: 'rgba(251,146,60,0.35)', fg: '#fb923c' },
  }
  const c = colorMap[p]
  return (
    <span title={platformLabel(p)} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 28, height: 18, padding: '0 6px', borderRadius: 4,
      background: c.bg, border: `1px solid ${c.bd}`, color: c.fg,
      fontSize: 9, fontWeight: 800, letterSpacing: '0.04em',
    }}>{platformShort(p)}</span>
  )
}

function SentimentMix({ positive, negative, total }: { positive: number; negative: number; total: number }) {
  if (total === 0) return <span style={{ color: 'var(--fg-4)', fontSize: 11 }}>—</span>
  const pos = (positive / total) * 100
  const neg = (negative / total) * 100
  const neutral = total - positive - negative
  const neuPct = Math.round((neutral / total) * 100)
  const posPct = Math.round(pos)
  const negPct = Math.round(neg)
  const tip = [
    `Sentiment breakdown across ${total} signals`,
    ``,
    `✅ Positive  ${positive} signals (${posPct}%)`,
    `⬜ Neutral   ${neutral} signals (${neuPct}%)`,
    `🔴 Negative  ${negative} signals (${negPct}%)`,
    ``,
    `Net sentiment: ${positive - negative >= 0 ? '+' : ''}${positive - negative}`,
  ].join('\n')
  const ariaLabel = `Sentiment: ${posPct}% positive, ${neuPct}% neutral, ${negPct}% negative`
  return (
    <div title={tip} role="img" aria-label={ariaLabel} style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, minWidth: 70, cursor: 'help' }}>
      <div style={{ display: 'flex', height: 6, borderRadius: 99, overflow: 'hidden', background: 'var(--wb-6)' }}>
        <div style={{ width: pos + '%', background: '#22c55e' }} aria-hidden="true" />
        <div style={{ width: (100 - pos - neg) + '%', background: '#94a3b8' }} aria-hidden="true" />
        <div style={{ width: neg + '%', background: '#ef4444' }} aria-hidden="true" />
      </div>
      <div style={{ fontSize: 9, display: 'flex', gap: 4 }}>
        <span style={{ color: '#22c55e' }}>+{positive}</span>
        <span style={{ color: '#94a3b8' }}>{neutral}</span>
        <span style={{ color: '#ef4444' }}>−{negative}</span>
      </div>
    </div>
  )
}

/**
 * Reusable framing cards rendered below intel sections.
 * Three cards: Competitor move / Business impact / Recommended JOOLA action.
 */
function ImpactCards({
  competitorMove, businessImpact, recommendedAction,
}: {
  competitorMove: string; businessImpact: string; recommendedAction: string
}) {
  const card: React.CSSProperties = {
    padding: 14,
    background: 'var(--wb-3)',
    border: '1px solid var(--wb-8)',
    borderRadius: 8,
    fontSize: 12,
    color: 'var(--fg-2)',
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginTop: 12 }}>
      <div style={card}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#06b6d4', marginBottom: 4 }}>Competitor move</div>
        <div>{competitorMove}</div>
      </div>
      <div style={card}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#F5E625', marginBottom: 4 }}>Business impact</div>
        <div>{businessImpact}</div>
      </div>
      <div style={{ ...card, borderColor: 'rgba(34,197,94,0.30)', background: 'rgba(34,197,94,0.06)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#22c55e', marginBottom: 4 }}>Recommended JOOLA action</div>
        <div>{recommendedAction}</div>
      </div>
    </div>
  )
}

function CoveragePill({ label, value, ok, tip }: { label: string; value: string; ok: boolean; tip?: string }) {
  return (
    <div title={tip} style={{
      padding: '10px 14px', borderRadius: 8,
      background: ok ? 'rgba(34,197,94,0.08)' : 'rgba(148,163,184,0.06)',
      border: `1px solid ${ok ? 'rgba(34,197,94,0.30)' : 'rgba(148,163,184,0.20)'}`,
      minWidth: 140, cursor: tip ? 'help' : 'default',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: ok ? '#22c55e' : 'var(--fg-2)' }}>{value}</div>
    </div>
  )
}

// ─── Impact bubble map ─────────────────────────────────────────────────

interface Bubble { name: string; brandSlug: string; reach: number; er: number; total: number }

function ImpactBubbleMap({ bubbles, brands }: { bubbles: Bubble[]; brands: V2Brand[] }) {
  const [hov, setHov] = useState<{ b: Bubble; cx: number; cy: number } | null>(null)
  const [drillBubble, setDrillBubble] = useState<Bubble | null>(null)
  const w = 760, h = 380
  const padL = 64, padR = 30, padT = 30, padB = 46
  const innerW = w - padL - padR
  const innerH = h - padT - padB

  if (bubbles.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-4)' }}>
        <div style={{ fontSize: 13 }}>No athletes with both reach and engagement data in the current window.</div>
      </div>
    )
  }

  const maxReach = Math.max(500_000, ...bubbles.map(b => b.reach))
  const maxEr = Math.max(12, ...bubbles.map(b => b.er))
  const useLog = maxReach / Math.max(1, Math.min(...bubbles.map(b => b.reach || 1))) > 100

  const xScale = (v: number): number => {
    if (useLog) {
      const lv = Math.log10(Math.max(1, v))
      const lmax = Math.log10(Math.max(2, maxReach))
      return padL + (lv / lmax) * innerW
    }
    return padL + Math.sqrt(v / maxReach) * innerW
  }
  const yScale = (v: number): number => padT + innerH - (v / maxEr) * innerH

  type Placed = { b: Bubble; cx: number; cy: number; r: number }
  const placed: Placed[] = bubbles.map(b => ({
    b, cx: xScale(b.reach), cy: yScale(b.er),
    r: Math.max(5, Math.min(22, 5 + Math.sqrt(b.total) * 2)),
  }))

  // simple collision avoidance
  const gap = 2
  for (let iter = 0; iter < 40; iter++) {
    let moved = false
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const A = placed[i], B = placed[j]
        const dx = B.cx - A.cx, dy = B.cy - A.cy
        const dist = Math.hypot(dx, dy) || 0.001
        const min = A.r + B.r + gap
        if (dist < min) {
          const ov = (min - dist) / 2
          const ux = dx / dist, uy = dy / dist
          A.cx -= ux * ov; A.cy -= uy * ov
          B.cx += ux * ov; B.cy += uy * ov
          moved = true
        }
      }
    }
    if (!moved) break
  }

  // ─── Quadrant split lines: use median of the cohort so quadrants are always populated.
  const sortedReach = [...bubbles].map(b => b.reach).sort((a, b) => a - b)
  const sortedEr = [...bubbles].map(b => b.er).sort((a, b) => a - b)
  const medianReach = sortedReach.length > 0 ? sortedReach[Math.floor(sortedReach.length / 2)] : 0
  const medianEr = sortedEr.length > 0 ? sortedEr[Math.floor(sortedEr.length / 2)] : 0
  const splitX = xScale(medianReach)
  const splitY = yScale(medianEr)

  // Quadrant counts (data-driven)
  const counts = { stars: 0, micro: 0, vanity: 0, niche: 0 }
  for (const b of bubbles) {
    const hiR = b.reach >= medianReach
    const hiE = b.er >= medianEr
    if (hiR && hiE) counts.stars++
    else if (!hiR && hiE) counts.micro++
    else if (hiR && !hiE) counts.vanity++
    else counts.niche++
  }

  // Visual quadrant rectangles (tinted backgrounds)
  const quadrants = [
    { x: padL,            y: padT,             w: splitX - padL,            h: splitY - padT,          fill: 'rgba(180, 140, 255, 0.05)', label: 'Micro-influencers', desc: 'High ER · low reach · best ROI per spend', count: counts.micro, anchor: 'start',  tx: padL + 8,           ty: padT + 18 },
    { x: splitX,          y: padT,             w: padL + innerW - splitX,   h: splitY - padT,          fill: 'rgba(34, 197, 94, 0.07)',   label: 'Stars',             desc: 'High ER · high reach · brand-defining athletes', count: counts.stars, anchor: 'end',    tx: padL + innerW - 8,  ty: padT + 18 },
    { x: padL,            y: splitY,           w: splitX - padL,            h: padT + innerH - splitY, fill: 'rgba(148, 163, 184, 0.04)', label: 'Niche / quiet',     desc: 'Low ER · low reach · deprioritize', count: counts.niche, anchor: 'start',  tx: padL + 8,           ty: padT + innerH - 10 },
    { x: splitX,          y: splitY,           w: padL + innerW - splitX,   h: padT + innerH - splitY, fill: 'rgba(251, 146, 60, 0.05)',  label: 'Celebrity reach',   desc: 'High reach · low ER · vanity audience', count: counts.vanity, anchor: 'end',    tx: padL + innerW - 8,  ty: padT + innerH - 10 },
  ]

  const hovQuadLabel = hov
    ? (hov.b.reach >= medianReach && hov.b.er >= medianEr ? 'STAR'
      : hov.b.reach < medianReach && hov.b.er >= medianEr ? 'MICRO-INFLUENCER'
      : hov.b.reach >= medianReach && hov.b.er < medianEr ? 'CELEBRITY REACH'
      : 'NICHE / QUIET')
    : ''
  const hovQuadColor = hovQuadLabel === 'STAR' ? '#22c55e' : hovQuadLabel === 'MICRO-INFLUENCER' ? '#bba0ff' : hovQuadLabel === 'CELEBRITY REACH' ? '#fb923c' : '#94a3b8'

  return (
    <div className="scatter-wrap" style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
        {/* Quadrant tinted backgrounds */}
        {quadrants.map((q, i) => (
          <rect key={'qr' + i} x={q.x} y={q.y} width={q.w} height={q.h} fill={q.fill} />
        ))}
        {/* Grid */}
        <g className="scatter-grid">
          {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
            <line key={'gx' + i} x1={padL + t * innerW} x2={padL + t * innerW} y1={padT} y2={padT + innerH} stroke="var(--line-2)" />
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
            <line key={'gy' + i} y1={padT + t * innerH} y2={padT + t * innerH} x1={padL} x2={padL + innerW} stroke="var(--line-2)" />
          ))}
        </g>
        {/* Quadrant split lines (median reach + median ER) */}
        <line x1={splitX} x2={splitX} y1={padT} y2={padT + innerH} stroke="rgba(245,230,37,0.45)" strokeDasharray="4 4" strokeWidth={1} />
        <line y1={splitY} y2={splitY} x1={padL} x2={padL + innerW} stroke="rgba(245,230,37,0.45)" strokeDasharray="4 4" strokeWidth={1} />
        {/* Median labels on the split lines */}
        <text x={splitX + 4} y={padT + 11} fontSize={9} fill="rgba(245,230,37,0.75)" style={{ letterSpacing: '0.05em' }}>median reach</text>
        <text x={padL + innerW - 4} y={splitY - 4} fontSize={9} fill="rgba(245,230,37,0.75)" textAnchor="end" style={{ letterSpacing: '0.05em' }}>median ER</text>
        {/* Quadrant labels in corners */}
        {quadrants.map((q, i) => (
          <g key={'ql' + i}>
            <text x={q.tx} y={q.ty} textAnchor={q.anchor as 'start' | 'end'}
              fontSize={11} fontWeight={800} fill="#fff" opacity={0.85}
              style={{ letterSpacing: '0.06em', textTransform: 'uppercase', paintOrder: 'stroke', stroke: 'rgba(7,9,14,0.85)', strokeWidth: 3, strokeLinejoin: 'round' }}>
              {q.label} <tspan fontSize={10} fontWeight={600} fill="#cbd1dc" opacity={0.85}>· {q.count}</tspan>
            </text>
            <text x={q.tx} y={q.ty + 12} textAnchor={q.anchor as 'start' | 'end'}
              fontSize={9} fill="#9aa2b0" opacity={0.85}
              style={{ paintOrder: 'stroke', stroke: 'rgba(7,9,14,0.85)', strokeWidth: 2.5, strokeLinejoin: 'round' }}>
              {q.desc}
            </text>
          </g>
        ))}
        {/* Axis titles */}
        <text x={padL + innerW / 2} y={h - 8} textAnchor="middle" style={{ fontSize: 10, fill: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>REACH (followers) {useLog ? '· log scale' : ''} →</text>
        <text transform={`translate(14 ${padT + innerH / 2}) rotate(-90)`} textAnchor="middle" style={{ fontSize: 10, fill: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>ENGAGEMENT RATE ↑</text>
        {/* Bubbles */}
        {placed.map((p, i) => {
          const isJ = p.b.brandSlug === 'joola'
          const isHov = hov?.b === p.b
          return (
            <g key={i} style={{ cursor: 'pointer', outline: 'none' }}
              role="button"
              tabIndex={0}
              aria-label={`${p.b.name} — ${pgName(p.b.brandSlug, brands)} · ${fmt(p.b.reach)} followers · ${p.b.er.toFixed(2)}% engagement rate`}
              onMouseEnter={() => setHov({ b: p.b, cx: p.cx, cy: p.cy })}
              onMouseLeave={() => setHov(null)}
              onClick={() => { setHov(null); setDrillBubble(p.b) }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDrillBubble(p.b) } }}
              onFocus={() => setHov({ b: p.b, cx: p.cx, cy: p.cy })}
              onBlur={() => setHov(null)}
            >
              <circle cx={p.cx} cy={p.cy} r={p.r + 5} fill={pgColor(p.b.brandSlug)} opacity={isHov ? 0.25 : 0.08} />
              <circle cx={p.cx} cy={p.cy} r={p.r} fill={pgColor(p.b.brandSlug)}
                opacity={isJ ? 1 : 0.85}
                stroke={isJ ? '#fff' : isHov ? '#fff' : 'rgba(0,0,0,0.4)'}
                strokeWidth={isJ ? 2 : 1} />
              {(isJ || isHov) && (
                <text x={p.cx} y={p.cy - p.r - 6} textAnchor="middle" style={{
                  fontSize: isJ ? 11 : 10, fontWeight: 700,
                  fill: isJ ? '#22c55e' : '#fff',
                  paintOrder: 'stroke', stroke: 'rgba(7,9,14,0.85)', strokeWidth: 2.5, strokeLinejoin: 'round',
                }}>{p.b.name.split(' ')[0]}</text>
              )}
            </g>
          )
        })}
      </svg>
      {hov && (
        <div className="tip" style={{ left: (hov.cx / w) * 100 + '%', top: (hov.cy / h) * 100 + '%', whiteSpace: 'nowrap' }}>
          <div className="t-name">{hov.b.name}</div>
          <div style={{ color: '#94a3b8', fontSize: 10, marginBottom: 6 }}>{pgName(hov.b.brandSlug, brands)}</div>
          <div style={{ display: 'flex', gap: 10, fontSize: 11, marginBottom: 6 }}>
            <span>Reach: <b>{fmt(hov.b.reach)}</b></span>
            <span>ER: <b>{hov.b.er.toFixed(2)}%</b></span>
            <span>Signals: <b>{hov.b.total}</b></span>
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: hovQuadColor + '22', color: hovQuadColor, border: `1px solid ${hovQuadColor}44` }}>{hovQuadLabel}</span>
        </div>
      )}
      {drillBubble && (
        <BubbleDetailDialog
          bubble={drillBubble}
          brands={brands}
          medianReach={medianReach}
          medianEr={medianEr}
          onClose={() => setDrillBubble(null)}
        />
      )}
      {/* Legend — 4 insight cards in one row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 16 }}>
        {[
          { label: 'Stars', color: '#22c55e', bg: 'rgba(34,197,94,0.07)', border: 'rgba(34,197,94,0.2)', desc: 'High reach + high engagement', action: 'Protect & invest', count: counts.stars },
          { label: 'Micro-influencers', color: '#bba0ff', bg: 'rgba(180,140,255,0.07)', border: 'rgba(180,140,255,0.2)', desc: 'Small audience, very engaged', action: 'Best ROI per dollar', count: counts.micro },
          { label: 'Celebrity reach', color: '#fb923c', bg: 'rgba(251,146,60,0.07)', border: 'rgba(251,146,60,0.2)', desc: 'Big following, weak engagement', action: 'Reconsider spend', count: counts.vanity },
          { label: 'Niche / quiet', color: '#94a3b8', bg: 'rgba(148,163,184,0.05)', border: 'rgba(148,163,184,0.15)', desc: 'Low reach + low engagement', action: 'Deprioritize', count: counts.niche },
        ].map(q => (
          <div key={q.label} style={{ background: q.bg, border: `1px solid ${q.border}`, borderRadius: 10, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: q.color, flexShrink: 0 }} />
              <span style={{ fontWeight: 800, color: q.color, fontSize: 12 }}>{q.label}</span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{q.count}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{q.desc}</div>
            <div style={{ fontSize: 11, color: 'var(--fg-2)', fontWeight: 700 }}>→ {q.action}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Roster row detail dialog ─────────────────────────────────────────
function RosterDetailDialog({ row: r, brands, attention, influencer, topPosts, totalPosts, onViewAllPosts, onPostClick, onClose }: {
  row: RosterRow; brands: V2Brand[]; attention: PlatformAttention | null; influencer: InfluencerRow | null
  topPosts: InfluencerPostRow[]; totalPosts: number
  onViewAllPosts: () => void; onPostClick: (p: InfluencerPostRow) => void; onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const brandName = brands.find(b => b.id === r.brandSlug)?.name || r.brandSlug
  const brandColor = pgColor(r.brandSlug)

  const platforms: { label: string; handle: string | null; url: string }[] = [
    { label: 'Instagram', handle: r.igHandle, url: r.igHandle ? `https://www.instagram.com/${r.igHandle.replace(/^@/, '')}/` : '' },
    { label: 'X (Twitter)', handle: r.xHandle, url: r.xHandle ? `https://x.com/${r.xHandle.replace(/^@/, '')}` : '' },
    { label: 'YouTube', handle: r.ytHandle, url: r.ytHandle ? `https://www.youtube.com/@${r.ytHandle.replace(/^@/, '')}` : '' },
    { label: 'TikTok', handle: r.tiktokHandle, url: r.tiktokHandle ? `https://www.tiktok.com/@${r.tiktokHandle.replace(/^@/, '')}` : '' },
    { label: 'Reddit', handle: r.redditHandle, url: r.redditHandle ? `https://www.reddit.com/user/${r.redditHandle.replace(/^u\//, '')}` : '' },
  ]

  const verColor = r.verification === 'verified' ? '#22c55e' : r.verification === 'matched' ? '#F5E625' : '#94a3b8'

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#0d1117', border: '1px solid var(--wb-10)', borderRadius: 14, width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 32px 80px rgba(0,0,0,0.8)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: brandColor, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#fff' }}>{r.player}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{brandName}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Status + Verification */}
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 24 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Status</div>
            <span className="pill" style={{ background: STATUS_COLOR[r.status] + '22', color: STATUS_COLOR[r.status], border: `1px solid ${STATUS_COLOR[r.status]}55`, fontSize: 11, padding: '3px 10px', borderRadius: 99, fontWeight: 700 }}>
              {STATUS_LABEL[r.status]}
            </span>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8, maxWidth: 220, lineHeight: 1.5 }}>{STATUS_DESC[r.status]}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Verification</div>
            <span style={{ fontSize: 11, fontWeight: 700, color: verColor, textTransform: 'capitalize' }}>{r.verification}</span>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8, maxWidth: 220, lineHeight: 1.5 }}>{VERIFICATION_DESC[r.verification]}</div>
          </div>
        </div>

        {/* Performance Stats */}
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>Roster Performance</div>
          {!influencer ? (
            <div style={{ fontSize: 12, color: '#6b7280' }}>No scraped profile data found for this player.</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 8 }}>
                {[
                  { label: 'Followers', value: fmt(influencer.followers), color: '#60a5fa', tip: 'Current Instagram follower count' },
                  { label: 'Posts tracked', value: influencer.posts > 0 ? String(influencer.posts) : '—', color: '#94a3b8', tip: 'Number of posts collected in the tracking window' },
                  { label: 'Avg likes', value: influencer.avgLikes > 0 ? fmt(influencer.avgLikes) : '—', color: '#22c55e', tip: 'Average likes per post' },
                ].map(m => (
                  <div key={m.label} title={m.tip} style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px', textAlign: 'center', cursor: 'help' }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: m.value === '—' ? '#3a4150' : m.color, fontFamily: 'JetBrains Mono' }}>{m.value}</div>
                    <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{m.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {[
                  { label: 'Avg comments', value: influencer.avgComments > 0 ? fmt(influencer.avgComments) : '—', color: '#a78bfa', tip: 'Average comments per post' },
                  { label: 'Eng. rate', value: influencer.engRate > 0 ? influencer.engRate.toFixed(2) + '%' : '—', color: influencer.engRate > 8 ? '#F5E625' : '#94a3b8', tip: 'Engagement rate = (likes + comments) ÷ followers × 100. Above 8% is exceptional.' },
                  { label: 'Tier', value: tierFromFollowers(influencer.followers).label, color: tierFromFollowers(influencer.followers).color, tip: 'NANO < 10K · MICRO 10K–100K · MACRO 100K–500K · MEGA 500K+' },
                ].map(m => (
                  <div key={m.label} title={m.tip} style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px', textAlign: 'center', cursor: 'help' }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: m.value === '—' ? '#3a4150' : m.color, fontFamily: 'JetBrains Mono' }}>{m.value}</div>
                    <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{m.label}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Social Handles */}
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>Social Handles</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {platforms.map(p => (
              <div key={p.label} style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px' }}>
                <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4 }}>{p.label}</div>
                {p.handle
                  ? <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 600, color: '#60a5fa', textDecoration: 'none' }}>@{p.handle.replace(/^@/, '')}</a>
                  : <span style={{ fontSize: 12, color: '#3a4150' }}>—</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Cross-platform attention */}
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)' }}>
          {!attention ? (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Cross-Platform Attention</div>
              <div style={{ fontSize: 12, color: '#6b7280', padding: '10px 0' }}>No activity data found for this player yet — they may not have been active on tracked platforms in the current window.</div>
            </div>
          ) : (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>Cross-Platform Attention</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
              {[
                { label: 'Total', value: fmt(attention.total), color: '#F5E625', tip: 'Total posts + fan mentions across all platforms' },
                { label: 'Instagram', value: attention.ig > 0 ? fmt(attention.ig) : '—', color: '#e1306c', tip: 'Instagram posts and mentions' },
                { label: 'X (Twitter)', value: attention.x > 0 ? fmt(attention.x) : '—', color: '#1d9bf0', tip: 'X/Twitter mentions' },
                { label: 'Reddit', value: attention.reddit > 0 ? fmt(attention.reddit) : '—', color: '#ff4500', tip: 'Reddit mentions' },
              ].map(m => (
                <div key={m.label} title={m.tip} style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', textAlign: 'center', cursor: 'help' }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: m.value === '—' ? '#3a4150' : m.color, fontFamily: 'JetBrains Mono' }}>{m.value}</div>
                  <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{m.label}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[
                { label: 'Engagement', value: fmt(attention.engagement), color: '#F5E625', tip: 'Total likes + comments + shares' },
                { label: 'Sentiment', value: `+${attention.positive} / −${attention.negative}`, color: '#22c55e', tip: `${attention.positive} positive · ${attention.negative} negative mentions` },
                { label: 'Trend', value: attention.trend === 'up' ? '▲ Rising' : attention.trend === 'down' ? '▼ Falling' : attention.trend === 'flat' ? '▬ Stable' : '— Unknown', color: attention.trend === 'up' ? '#22c55e' : attention.trend === 'down' ? '#ef4444' : '#94a3b8', tip: 'Signal volume trend: last 14 days vs prior 14 days' },
              ].map(m => (
                <div key={m.label} title={m.tip} style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', textAlign: 'center', cursor: 'help' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: m.color, fontFamily: 'JetBrains Mono' }}>{m.value}</div>
                  <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{m.label}</div>
                </div>
              ))}
            </div>
          </div>
          )}
        </div>

        {/* Top Posts */}
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Top Performing Posts {totalPosts > 0 && <span style={{ color: '#3a4150' }}>· {totalPosts} total</span>}
            </span>
            {totalPosts > 3 && (
              <button onClick={onViewAllPosts} style={{ background: 'none', border: '1px solid rgba(96,165,250,0.3)', color: '#60a5fa', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                View all {totalPosts} posts →
              </button>
            )}
          </div>
          {topPosts.length === 0 ? (
            <div style={{ fontSize: 12, color: '#6b7280' }}>No posts collected for this player in the current window.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {topPosts.map(p => (
                <div key={p.id} onClick={() => onPostClick(p)} style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px', cursor: 'pointer', transition: 'border-color 150ms' }} onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(96,165,250,0.4)')} onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--line)')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <PlatformPill p={p.platform} />
                    <span style={{ fontSize: 10, color: '#6b7280' }}>{p.type}</span>
                    <span className={'pill ' + SENT_PILL[p.sentiment]} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 99, fontWeight: 700 }}>{p.sentiment}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: '#6b7280', fontFamily: 'JetBrains Mono' }}>{p.postedAt ? formatCalendarDate(p.postedAt) : '—'}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#cbd1dc', marginBottom: 8, lineHeight: 1.5 }}>{p.caption.slice(0, 120)}{p.caption.length > 120 ? '…' : ''}</div>
                  <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#94a3b8' }}>
                    <span>♥ <b style={{ color: '#22c55e' }}>{fmt(p.likes)}</b> likes</span>
                    <span>💬 <b>{fmt(p.comments)}</b> comments</span>
                    <span>⚡ <b style={{ color: '#F5E625' }}>{fmt(p.engagement)}</b> eng</span>
                    <span>ER <b style={{ color: p.engRate > 8 ? '#F5E625' : '#94a3b8' }}>{p.engRate.toFixed(2)}%</b></span>
                    {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', color: '#60a5fa', textDecoration: 'none', fontSize: 11 }}>View →</a>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Last Seen */}
        <div style={{ padding: '12px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            {r.lastSeenDays !== null
              ? `Last seen ${r.lastSeenDays} day${r.lastSeenDays !== 1 ? 's' : ''} ago`
              : 'Last seen: unknown'}
          </span>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Press Esc to close</span>
        </div>
      </div>
    </div>
  )
}

// ─── Bubble detail dialog ─────────────────────────────────────────────
function BubbleDetailDialog({ bubble: b, brands, medianReach, medianEr, onClose }: {
  bubble: Bubble; brands: V2Brand[]; medianReach: number; medianEr: number; onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const brandName = pgName(b.brandSlug, brands)
  const brandColor = pgColor(b.brandSlug)
  const isJoola = b.brandSlug === 'joola'

  const hiR = b.reach >= medianReach, hiE = b.er >= medianEr
  const quadrant = hiR && hiE ? 'Star' : !hiR && hiE ? 'Micro-influencer' : hiR && !hiE ? 'Celebrity reach' : 'Niche / quiet'
  const qColor = quadrant === 'Star' ? '#22c55e' : quadrant === 'Micro-influencer' ? '#bba0ff' : quadrant === 'Celebrity reach' ? '#fb923c' : '#94a3b8'
  const qDesc: Record<string, string> = {
    'Star': 'Large audience and high engagement — the ideal combination. Prioritize for campaigns and long-term deals.',
    'Micro-influencer': 'Smaller audience but highly engaged followers. Best return on sponsorship investment.',
    'Celebrity reach': 'Very large following but low engagement. Great for visibility, but monitor conversions carefully.',
    'Niche / quiet': 'Low reach and low engagement currently. Review content quality before investing.',
  }
  const metrics = [
    { label: 'Followers', value: fmt(b.reach), sub: b.reach >= medianReach ? 'Above median' : 'Below median', color: b.reach >= medianReach ? '#22c55e' : '#94a3b8' },
    { label: 'Engagement rate', value: b.er.toFixed(2) + '%', sub: b.er >= medianEr ? 'Above median' : 'Below median', color: b.er >= medianEr ? '#22c55e' : '#94a3b8' },
    { label: 'Total signals', value: fmt(b.total), sub: 'Posts + mentions', color: '#60a5fa' },
  ]
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={onClose}>
      <div style={{ background: '#0d1117', border: '1px solid var(--wb-10)', borderRadius: 14, width: '100%', maxWidth: 520, boxShadow: '0 32px 80px rgba(0,0,0,0.8)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: isJoola ? '#22c55e' : brandColor, flexShrink: 0, border: isJoola ? '2px solid #fff' : 'none' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: isJoola ? '#22c55e' : '#fff' }}>{b.name}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Sponsored by {brandName}</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: qColor + '22', color: qColor, border: `1px solid ${qColor}44` }}>{quadrant}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 22, cursor: 'pointer', lineHeight: 1, marginLeft: 4 }}>×</button>
        </div>
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)', background: qColor + '08' }}>
          <div style={{ fontSize: 12, color: '#cbd1dc', lineHeight: 1.6 }}>{qDesc[quadrant]}</div>
        </div>
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {metrics.map(m => (
            <div key={m.label} style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: m.color, fontFamily: 'JetBrains Mono' }}>{m.value}</div>
              <div style={{ fontSize: 11, color: '#fff', fontWeight: 600, marginTop: 2 }}>{m.label}</div>
              <div style={{ fontSize: 10, color: m.color, marginTop: 2 }}>{m.sub}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: '10px 22px', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Player Impact Map</span>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Press Esc to close</span>
        </div>
      </div>
    </div>
  )
}
// ─── Content post detail dialog ──────────────────────────────────────
function ContentDetailDialog({ post: p, brands, onClose }: {
  post: InfluencerPostRow; brands: V2Brand[]; onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const brandName = pgName(p.brandSlug, brands)
  const isJoola = p.brandSlug === 'joola'
  const SENT_COLOR: Record<string, string> = { positive: '#22c55e', negative: '#ef4444', neutral: '#94a3b8', unknown: '#6b7280' }
  const sentColor = SENT_COLOR[p.sentiment] || '#6b7280'
  const PLAT_COLOR: Record<string, string> = { ig: '#e1306c', yt: '#ff0000', tiktok: '#69c9d0', x: '#1d9bf0', reddit: '#ff4500' }
  const platColor = PLAT_COLOR[p.platform] || '#6b7280'

  const metrics = [
    { label: 'Views',      value: p.views > 0 ? fmt(p.views) : '—',      color: '#94a3b8' },
    { label: 'Likes',      value: fmt(p.likes),                            color: '#22c55e' },
    { label: 'Comments',   value: fmt(p.comments),                         color: '#60a5fa' },
    { label: 'Shares',     value: p.shares > 0 ? fmt(p.shares) : '—',     color: '#a78bfa' },
    { label: 'Engagement', value: fmt(p.engagement),                       color: '#F5E625' },
    { label: 'Eng. Rate',  value: p.engRate > 0 ? p.engRate.toFixed(2) + '%' : '—', color: p.engRate > 8 ? '#F5E625' : '#94a3b8' },
  ]

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={onClose}>
      <div style={{ background: '#0d1117', border: '1px solid var(--wb-10)', borderRadius: 14, width: '100%', maxWidth: 580, boxShadow: '0 32px 80px rgba(0,0,0,0.8)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: platColor + '22', color: platColor, border: `1px solid ${platColor}44`, textTransform: 'uppercase' }}>{p.platform}</span>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: sentColor + '18', color: sentColor, border: `1px solid ${sentColor}33` }}>{p.sentiment}</span>
          {p.type && <span style={{ fontSize: 10, color: '#6b7280' }}>{p.type}</span>}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b7280' }}>{p.postedAt ? formatCalendarDate(p.postedAt) : '—'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 22, cursor: 'pointer', lineHeight: 1, marginLeft: 8 }}>×</button>
        </div>

        {/* Athlete + Brand */}
        <div style={{ padding: '12px 22px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: isJoola ? '#22c55e' : pgColor(p.brandSlug), flexShrink: 0 }} />
          <span style={{ fontWeight: 800, fontSize: 14, color: isJoola ? '#22c55e' : '#fff' }}>{p.athleteName}</span>
          <span style={{ color: '#6b7280', fontSize: 12 }}>· {brandName}</span>
          {p.athleteHandle && <span style={{ fontSize: 11, color: '#60a5fa' }}>@{p.athleteHandle}</span>}
        </div>

        {/* Caption */}
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Caption</div>
          <div style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.65, background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {p.caption || '(no caption)'}
          </div>
        </div>

        {/* Metrics */}
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {metrics.map(m => (
            <div key={m.label} style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: m.color, fontFamily: 'JetBrains Mono' }}>{m.value}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{m.label}</div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Press Esc to close</span>
          {p.url
            ? <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa', textDecoration: 'none', padding: '5px 14px', border: '1px solid rgba(96,165,250,0.3)', borderRadius: 6, background: 'rgba(96,165,250,0.08)' }}>View original post →</a>
            : <span style={{ fontSize: 11, color: '#3a4150' }}>No source link</span>}
        </div>
      </div>
    </div>
  )
}
// ─── Athlete Impact Score detail dialog ──────────────────────────────
function ImpactDetailDialog({ row: r, brands, onClose }: {
  row: AthleteImpactRow; brands: V2Brand[]; onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const isJoola = r.brandSlug === 'joola'
  const clsColor = r.classification === 'rising' ? '#22c55e' : r.classification === 'underperforming' ? '#ef4444' : '#94a3b8'
  const clsBg = r.classification === 'rising' ? 'rgba(34,197,94,0.10)' : r.classification === 'underperforming' ? 'rgba(239,68,68,0.10)' : 'rgba(148,163,184,0.10)'

  const CLS_DESC: Record<string, string> = {
    rising: 'This athlete is showing strong and growing momentum — high posts, strong engagement, and increasing mentions. A priority for continued investment.',
    steady: 'Consistent performer with stable activity and engagement. Not surging but not declining. Good baseline sponsorship value.',
    underperforming: 'Low activity or declining engagement relative to peers. Consider reviewing the sponsorship terms or activating more campaigns.',
  }

  const metrics = [
    { label: 'Posts (30d)',       value: r.posts30d > 0 ? String(r.posts30d) : '—',                    color: '#60a5fa',  tip: 'Sponsored posts published in the last 30 days' },
    { label: 'Avg engagement',    value: r.avgEngagement > 0 ? fmt(r.avgEngagement) : '—',              color: '#F5E625',  tip: 'Average likes + comments + shares per post' },
    { label: 'Mentions',          value: r.mentions > 0 ? fmt(r.mentions) : '—',                        color: '#a78bfa',  tip: 'Times mentioned across all community channels' },
    { label: 'Product mentions',  value: r.productMentions > 0 ? String(r.productMentions) : '—',       color: '#fb923c',  tip: 'Times a specific paddle/product was mentioned alongside this athlete' },
    { label: 'Positive %',        value: r.positivePct > 0 ? r.positivePct.toFixed(0) + '%' : '—',      color: r.positivePct >= 60 ? '#22c55e' : '#94a3b8', tip: 'Share of signals about this athlete with positive sentiment' },
    { label: 'Impact score',      value: r.impactScore.toFixed(1),                                      color: clsColor,   tip: 'Composite ROI proxy: weighted sum of posts, engagement, mentions, product pulls, and sentiment' },
  ]

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={onClose}>
      <div style={{ background: '#0d1117', border: '1px solid var(--wb-10)', borderRadius: 14, width: '100%', maxWidth: 560, boxShadow: '0 32px 80px rgba(0,0,0,0.8)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: pgColor(r.brandSlug), flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: isJoola ? '#22c55e' : '#fff' }}>{r.player}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{pgName(r.brandSlug, brands)}</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: clsBg, color: clsColor, border: `1px solid ${clsColor}44`, textTransform: 'uppercase' }}>{r.classification}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 22, cursor: 'pointer', lineHeight: 1, marginLeft: 4 }}>×</button>
        </div>

        {/* Classification explanation */}
        <div style={{ padding: '12px 22px', borderBottom: '1px solid var(--line)', background: clsColor + '08' }}>
          <div style={{ fontSize: 12, color: '#cbd1dc', lineHeight: 1.6 }}>{CLS_DESC[r.classification]}</div>
        </div>

        {/* Metrics grid */}
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {metrics.map(m => (
            <div key={m.label} title={m.tip} style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', textAlign: 'center', cursor: 'help' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: m.color, fontFamily: 'JetBrains Mono' }}>{m.value}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3 }}>{m.label}</div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 22px', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Athlete Impact Score</span>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Press Esc to close</span>
        </div>
      </div>
    </div>
  )
}
// ─── Player all-posts dialog ──────────────────────────────────────────
function PlayerPostsDialog({ player, posts, onPostClick, onClose }: {
  player: string; posts: InfluencerPostRow[]; onPostClick: (p: InfluencerPostRow) => void; onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={onClose}>
      <div style={{ background: '#0d1117', border: '1px solid var(--wb-10)', borderRadius: 14, width: '100%', maxWidth: 720, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 32px 80px rgba(0,0,0,0.8)' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#fff' }}>{player}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{posts.length} posts · sorted by engagement</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Posts list */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {posts.map(p => (
            <div key={p.id} onClick={() => onPostClick(p)}
              style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px', cursor: 'pointer', transition: 'border-color 150ms' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(96,165,250,0.4)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--line)')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <PlatformPill p={p.platform} />
                <span className={'pill ' + SENT_PILL[p.sentiment]} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 99, fontWeight: 700 }}>{p.sentiment}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: '#6b7280', fontFamily: 'JetBrains Mono' }}>{p.postedAt ? formatCalendarDate(p.postedAt) : '—'}</span>
              </div>
              <div style={{ fontSize: 12, color: '#cbd1dc', marginBottom: 6, lineHeight: 1.5 }}>{p.caption.slice(0, 140)}{p.caption.length > 140 ? '…' : ''}</div>
              <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#94a3b8' }}>
                <span>♥ <b style={{ color: '#22c55e' }}>{fmt(p.likes)}</b></span>
                <span>💬 <b>{fmt(p.comments)}</b></span>
                <span>⚡ <b style={{ color: '#F5E625' }}>{fmt(p.engagement)}</b></span>
                <span>ER <b style={{ color: p.engRate > 8 ? '#F5E625' : '#94a3b8' }}>{p.engRate.toFixed(2)}%</b></span>
                <span style={{ marginLeft: 'auto', color: '#60a5fa', fontSize: 10 }}>Click to view details →</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: '10px 22px', borderTop: '1px solid var(--line)', fontSize: 11, color: '#6b7280', flexShrink: 0 }}>Press Esc to close</div>
      </div>
    </div>
  )
}