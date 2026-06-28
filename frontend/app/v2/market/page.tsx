'use client'

import Link from 'next/link'
import { useEffect, useState, useMemo } from 'react'
import {
  fetchBrands, fetchReddit, fetchAds, fetchPromos, fetchIG,
  fetchYT, fetchX, fetchTikTok, fetchTopIGPosts, fetchTopYTVideos,
  fetchTopXPosts, fetchTopTikTokVideos,
  type V2Brand, type V2RedditRow, type V2AdRow, type V2PromoRow, type V2IGRow,
  type V2YTRow, type V2XRow, type V2TikTokRow, type V2TopIGPost, type V2TopYTVideo,
  type V2XPost, type V2TikTokVideo,
} from '@/lib/v2/data'
import { fmt } from '@/components/v2/charts'
import { PageHead, MiniKpi, pgColor, pgName, LoadingPage, SectionInfo, FilterBanner, SortTh, ColumnFilter } from '@/components/v2/PageShell'
import { useBrandFilter, applyBrandFilter } from '@/lib/v2/BrandFilterContext'
import { useDateRange, applyDateRange, DATE_RANGE_LABEL } from '@/lib/v2/DateRangeContext'
import { supabase } from '@/lib/shared/supabase'
import { fetchMarketIntel, type MarketIntelData, type CommandCenterRow, type BrandStrategyCard } from '@/lib/v2/marketIntel'
import { useReveal, revealCls } from '@/lib/v2/animations'

interface MentionSummaryRow {
  brand_id: string
  period: string
  total_mentions: number
  weighted_total: number
  avg_sentiment: number | null
}

interface ProductMentionAgg {
  brand_id: string
  product_id: string
  mention_count: number
}

type BenchmarkSortKey =
  | 'igFollowers'
  | 'ytVideos'
  | 'mentions7d'
  | 'mentions30d'
  | 'sentiment7d'
  | 'productAttention'

/** Engagement-rate floor: brands with fewer than 50 followers can't produce a
 *  reliable engagement rate. The 1-follower / 1072% Paddletek artefact lives here. */
const ER_MIN_FOLLOWERS = 50

type SignalType = 'ad' | 'promo' | 'reddit' | 'instagram' | 'youtube' | 'tiktok' | 'twitter'
type Signal = {
  type: SignalType
  brand: string
  desc: string
  when: string
  href: string
}

const SIG_LABEL: Record<SignalType, string> = {
  ad: 'AD',
  promo: 'PROMO',
  reddit: 'REDDIT',
  instagram: 'IG',
  youtube: 'YT',
  tiktok: 'TIKTOK',
  twitter: 'X',
}

const SIG_HREF: Record<SignalType, string> = {
  ad: '/v2/ads',
  promo: '/v2/promotions',
  reddit: '/v2/reddit',
  instagram: '/v2/instagram',
  youtube: '/v2/youtube',
  tiktok: '/v2/tiktok',
  twitter: '/v2/twitter',
}

export default function MarketIntelPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [reddit, setReddit] = useState<V2RedditRow[]>([])
  const [ads, setAds] = useState<V2AdRow[]>([])
  const [promos, setPromos] = useState<V2PromoRow[]>([])
  const [ig, setIg] = useState<V2IGRow[]>([])
  const [yt, setYt] = useState<V2YTRow[]>([])
  const [x, setX] = useState<V2XRow[]>([])
  const [tiktok, setTiktok] = useState<V2TikTokRow[]>([])
  const [topIG, setTopIG] = useState<V2TopIGPost[]>([])
  const [topYT, setTopYT] = useState<V2TopYTVideo[]>([])
  const [topX, setTopX] = useState<V2XPost[]>([])
  const [topTT, setTopTT] = useState<V2TikTokVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [mentionSummary, setMentionSummary] = useState<MentionSummaryRow[]>([])
  const [marketIntel, setMarketIntel] = useState<MarketIntelData | null>(null)
  // Reserved for future product-level breakdown (kept to match planned interface contract).
  const [productMentions7d] = useState<ProductMentionAgg[]>([])
  void productMentions7d
  const [benchmarkSortKey, setBenchmarkSortKey] = useState<BenchmarkSortKey | null>('mentions7d')
  const [benchmarkSortDir, setBenchmarkSortDir] = useState<'asc' | 'desc'>('desc')
  const [benchmarkBrandFilter, setBenchmarkBrandFilter] = useState('')
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()
  const { range } = useDateRange()

  useEffect(() => {
    fetchBrands().then(async (b) => {
      const [r, a, p, i, y, xr, tt, tIG, tYT, tX, tTT] = await Promise.all([
        fetchReddit(b),
        fetchAds(b),
        fetchPromos(b),
        fetchIG(b),
        fetchYT(b),
        fetchX(b),
        fetchTikTok(b),
        fetchTopIGPosts(b, 5),
        fetchTopYTVideos(b, 5),
        fetchTopXPosts(b, 5),
        fetchTopTikTokVideos(b, 5),
      ])
      setBrands(b); setAllBrands(b)
      setReddit(r); setAds(a); setPromos(p); setIg(i)
      setYt(y); setX(xr); setTiktok(tt)
      setTopIG(tIG); setTopYT(tYT); setTopX(tX); setTopTT(tTT)
      setLoading(false)
      // Command-center summary — independent fetch so the page doesn't block on it
      fetchMarketIntel(b)
        .then((mi) => setMarketIntel(mi))
        // eslint-disable-next-line no-console
        .catch((err) => console.warn('[market] fetchMarketIntel failed', err))
    }).catch(() => setLoading(false))
  }, [setAllBrands])

  useEffect(() => { document.title = 'JOOLA INTEL — Market Intel' }, [])

  useEffect(() => {
    let cancelled = false
    const loadMentionData = async (): Promise<void> => {
      try {
        const { data: ms } = await supabase
          .from('product_attention_summary')
          .select('brand_id,period,total_mentions:mentions_total,weighted_total:attention_score,avg_sentiment:sales_likelihood_score')
          .in('period', ['last_7d', 'last_30d'])
          .limit(500)
        if (!cancelled && ms) {
          setMentionSummary(ms as MentionSummaryRow[])
        }
      } catch {
        // non-fatal — table or column may not exist; UI falls back to placeholders
      }
    }
    loadMentionData()
    return () => { cancelled = true }
  }, [])

  const displayReddit = applyBrandFilter(reddit, filteredBrands, isFiltered)
  const displayAds = applyBrandFilter(ads, filteredBrands, isFiltered)
  const displayPromos = applyBrandFilter(promos, filteredBrands, isFiltered)
  const displayIG = applyBrandFilter(ig, filteredBrands, isFiltered)
  const displayYT = applyBrandFilter(yt, filteredBrands, isFiltered)
  const displayX = applyBrandFilter(x, filteredBrands, isFiltered)
  const displayTT = applyBrandFilter(tiktok, filteredBrands, isFiltered)
  const displayTopIG = applyBrandFilter(topIG, filteredBrands, isFiltered)
  const displayTopYT = applyBrandFilter(topYT, filteredBrands, isFiltered)
  const displayTopX = applyBrandFilter(topX, filteredBrands, isFiltered)
  const displayTopTT = applyBrandFilter(topTT, filteredBrands, isFiltered)

  const name = (s: string) => pgName(s, brands)
  const joolaReddit = displayReddit.find((r) => r.brand === 'joola')
  const joolaIG = displayIG.find((r) => r.brand === 'joola')
  const totalMentions = displayReddit.reduce((s, r) => s + r.mentions, 0)
  const rangeLabel = DATE_RANGE_LABEL[range]
  const rangeLabelLower = rangeLabel.toLowerCase()

  const signals = useMemo((): Signal[] => {
    const out: Signal[] = []
    const window = rangeLabel

    // Ads — biggest non-JOOLA advertiser this window
    const topAd = displayAds.find((a) => a.brand !== 'joola' && a.total > 0)
    if (topAd) {
      out.push({
        type: 'ad',
        brand: topAd.brand,
        desc: `${name(topAd.brand)} is running ${fmt(topAd.total)} ads (${topAd.meta} Meta / ${topAd.google} Google) — ${topAd.share.toFixed(1)}% category share of voice`,
        when: window,
        href: SIG_HREF.ad,
      })
    }

    // Promos — top discounter + JOOLA gap
    const topPromo = displayPromos.find((p) => p.count > 0)
    if (topPromo && topPromo.brand !== 'joola') {
      out.push({
        type: 'promo',
        brand: topPromo.brand,
        desc: `${name(topPromo.brand)} has ${topPromo.count} active promotions — ${topPromo.pct.toFixed(0)}% of all tracked discounts`,
        when: window,
        href: SIG_HREF.promo,
      })
    }
    const joolaPromos = displayPromos.find((p) => p.brand === 'joola')
    if ((joolaPromos?.count || 0) === 0 && displayPromos.some((p) => p.count > 0)) {
      out.push({
        type: 'promo',
        brand: 'joola',
        desc: 'JOOLA has zero active promotions while competitors are discounting aggressively',
        when: window,
        href: SIG_HREF.promo,
      })
    }

    // Instagram — leader by engagement rate, with the 50-follower outlier filter applied
    const igEligible = displayIG.filter((r) => r.followers >= ER_MIN_FOLLOWERS)
    const topIGBrand = [...igEligible].sort((a, b) => b.engRate - a.engRate)[0]
    if (topIGBrand) {
      out.push({
        type: 'instagram',
        brand: topIGBrand.brand,
        desc: `${name(topIGBrand.brand)} leads Instagram engagement at ${topIGBrand.engRate.toFixed(2)}% — ${fmt(topIGBrand.followers)} followers`,
        when: window,
        href: SIG_HREF.instagram,
      })
    }
    if (joolaIG && joolaIG.followers >= ER_MIN_FOLLOWERS) {
      out.push({
        type: 'instagram',
        brand: 'joola',
        desc: `JOOLA Instagram: ${fmt(joolaIG.followers)} followers · ${joolaIG.engRate.toFixed(2)}% engagement rate`,
        when: window,
        href: SIG_HREF.instagram,
      })
    }

    // YouTube — most-watched video this window
    const topYTVid = displayTopYT[0]
    if (topYTVid) {
      out.push({
        type: 'youtube',
        brand: topYTVid.brand,
        desc: `${name(topYTVid.brand)} top YouTube video: "${topYTVid.title.slice(0, 60)}${topYTVid.title.length > 60 ? '…' : ''}" — ${fmt(topYTVid.views)} views`,
        when: window,
        href: SIG_HREF.youtube,
      })
    }

    // TikTok — most-watched video this window
    const topTTVid = displayTopTT[0]
    if (topTTVid) {
      out.push({
        type: 'tiktok',
        brand: topTTVid.brand,
        desc: `${name(topTTVid.brand)} top TikTok video: ${fmt(topTTVid.views)} views · ${fmt(topTTVid.likes)} likes`,
        when: window,
        href: SIG_HREF.tiktok,
      })
    }

    // X / Twitter — most-engaged post this window
    const topXPost = displayTopX[0]
    if (topXPost) {
      out.push({
        type: 'twitter',
        brand: topXPost.brand,
        desc: `${name(topXPost.brand)} top X post: ${fmt(topXPost.likes)} likes · ${fmt(topXPost.retweets)} retweets`,
        when: window,
        href: SIG_HREF.twitter,
      })
    }

    // Reddit — leader & JOOLA position
    const topRed = displayReddit[0]
    if (topRed) {
      out.push({
        type: 'reddit',
        brand: topRed.brand,
        desc: `${name(topRed.brand)} leads Reddit conversation with ${topRed.mentions} ${topRed.mentions === 1 ? 'mention' : 'mentions'}`,
        when: window,
        href: SIG_HREF.reddit,
      })
    }
    if (joolaReddit && joolaReddit.mentions > 0) {
      const positiveOnly = joolaReddit.positive === 0 && joolaReddit.negative === 0
      const posPct = Math.round(joolaReddit.positive / Math.max(1, joolaReddit.mentions) * 100)
      out.push({
        type: 'reddit',
        brand: 'joola',
        desc: positiveOnly
          ? `JOOLA Reddit: ${joolaReddit.mentions} ${joolaReddit.mentions === 1 ? 'mention' : 'mentions'} (sentiment calibration in progress)`
          : `JOOLA Reddit: ${joolaReddit.mentions} ${joolaReddit.mentions === 1 ? 'mention' : 'mentions'} · ${posPct}% positive`,
        when: window,
        href: SIG_HREF.reddit,
      })
    }
    return out.slice(0, 10)
  }, [
    displayAds, displayPromos, displayIG, displayReddit, displayTopYT,
    displayTopTT, displayTopX, joolaReddit, joolaIG, brands, rangeLabel,
  ])

  const joolaMentionSpark = joolaReddit
    ? Array.from({ length: 8 }, (_, i) => Math.max(1, Math.round(joolaReddit.mentions / 8 * (0.7 + i * 0.04))))
    : [0]

  // Cross-platform KPIs
  const ytTotalViews = displayYT.reduce((s, r) => s + r.views, 0)
  const ttTotalVideos = displayTT.reduce((s, r) => s + r.videos, 0)
  const xTotalFollowers = displayX.reduce((s, r) => s + r.followers, 0)
  const igTotalFollowers = displayIG.reduce((s, r) => s + r.followers, 0)

  const row1 = useReveal()
  const row2 = useReveal()
  const row3 = useReveal()
  const row4 = useReveal()
  const row5 = useReveal()

  if (loading) return <LoadingPage />

  return (
    <>
      <PageHead
        eyebrow="MARKET INTEL · CROSS-PLATFORM · LIVE FEED"
        title="Market"
        accent="intel"
        sub="One view across paid, organic, and community signals. What competitors are doing right now and what JOOLA should respond to."
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a href="https://www.facebook.com/ads/library/?q=pickleball&search_type=keyword_unordered" target="_blank" rel="noopener noreferrer" className="btn btn-ghost" aria-label="Meta Ads Library">
              Meta Ads ↗
            </a>
            <a href="https://www.reddit.com/r/pickleball/" target="_blank" rel="noopener noreferrer" className="btn btn-ghost" aria-label="r/pickleball on Reddit">
              r/pickleball ↗
            </a>
            <a href="https://www.joola.com" target="_blank" rel="noopener noreferrer" className="btn btn-ghost" aria-label="JOOLA website">
              joola.com ↗
            </a>
          </div>
        }
      />
      <FilterBanner />

      <section>
        <div ref={row1.ref} className={revealCls(row1.vis, 'kpi-grid')}>
          <MiniKpi
            label="Signals (this window)" flavor="warn"
            value={signals.length}
            delta={signals.length > 4 ? 2 : 0}
            color="#F5E625"
            spark={[...Array(8)].map((_, i) => Math.max(2, signals.length - 4 + i))}
            customVs={rangeLabel}
            tip="Total competitor + JOOLA 'moves' detected in the selected time window — new ads launched, promos started, crisis spikes, athlete posts, etc. A signal is any event JOOLA marketing should be aware of. Higher count = busier competitive landscape."
          />
          <MiniKpi
            label="Competitor crisis flags" flavor="danger"
            value={signals.filter((s) => s.brand !== 'joola' && (s.type === 'promo' || s.type === 'ad')).length}
            color="#ef4444"
            customVs="paid + promo activity alerts"
            tip="How many ad-launch or promo-start signals fired from JOOLA's 10 competitors in this window. Treat each as a potential threat or opening — e.g. a competitor running a 25% off promo might be clearing inventory (opportunity to gain SoV)."
          />
        </div>
      </section>

      <section>
        <div ref={row2.ref} className={revealCls(row2.vis, 'kpi-grid')}>
          <div className="ov-kpi" style={{ '--ov-d': '160ms' } as React.CSSProperties}>
            <MiniKpi
              label="Reddit conversation" src="Community Mentions" flavor="joola"
              value={fmt(totalMentions)}
              color="#06b6d4"
              spark={joolaMentionSpark}
              customVs={joolaReddit ? `JOOLA: ${fmt(joolaReddit.mentions)} ${joolaReddit.mentions === 1 ? 'mention' : 'mentions'}` : 'JOOLA: 0 mentions'}
              tip="Total Reddit mentions of paddle brands in this window (all 11 brands combined). JOOLA's slice is shown below for quick comparison. Reddit is the most candid signal — players talk freely about real product issues here."
            />
          </div>
          <div className="ov-kpi" style={{ '--ov-d': '235ms' } as React.CSSProperties}>
            <MiniKpi
              label="Instagram reach" src="Instagram profiles"
              value={igTotalFollowers > 0 ? fmt(igTotalFollowers) : '—'}
              color="#ec4899"
              customVs={joolaIG ? `JOOLA: ${fmt(joolaIG.followers)} followers` : 'JOOLA: pending'}
              tip="Combined Instagram follower count across all 11 tracked brand profiles. JOOLA's follower number is shown beneath. Big number = total addressable audience JOOLA is fighting for attention against on Instagram."
            />
          </div>
          <div className="ov-kpi" style={{ '--ov-d': '310ms' } as React.CSSProperties}>
            <MiniKpi
              label="YouTube reach" src="YouTube channels"
              value={ytTotalViews > 0 ? fmt(ytTotalViews) : '—'}
              color="#ef4444"
              customVs={`${displayYT.filter(y => y.subs > 0).length} channels active`}
              tip="Total YouTube views across all tracked brand channels in this window. The '#N channels active' tag = how many brands have actually posted videos lately (some brands go dormant on YouTube)."
            />
          </div>
          <div className="ov-kpi" style={{ '--ov-d': '385ms' } as React.CSSProperties}>
            <MiniKpi
              label="TikTok velocity" src="TikTok videos"
              value={ttTotalVideos > 0 ? fmt(ttTotalVideos) : '—'}
              color="#a855f7"
              customVs={xTotalFollowers > 0 ? `${fmt(xTotalFollowers)} X followers tracked` : 'across tracked brands'}
              tip="Total TikTok videos posted by all tracked paddle brands in this window. TikTok is where younger players discover paddles — high velocity here is a leading indicator of brand momentum among Gen Z / new-to-sport buyers."
            />
          </div>
        </div>
      </section>

      <section ref={row3.ref} className={revealCls(row3.vis)}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
          <div className="card" style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#F5E625', marginBottom: 4 }}>
                Community signals moved
              </div>
              <div style={{ color: '#cbd1dc', fontSize: 13 }}>
                Brand discussion volume, live community feed, and JOOLA community footprint now live in a single dedicated dashboard.
              </div>
            </div>
            <Link href="/v2/community-intel" className="btn btn-yellow" style={{ whiteSpace: 'nowrap' }}>
              View full Community Intel →
            </Link>
          </div>
          <div className="card" style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#F5E625', marginBottom: 4 }}>
                Ads & promos moved
              </div>
              <div style={{ color: '#cbd1dc', fontSize: 13 }}>
                Active ads, active promos, brand campaign pressure, and the full ad/offer detail tables now live in a single dedicated dashboard.
              </div>
            </div>
            <Link href="/v2/campaign-offer-intel" className="btn btn-yellow" style={{ whiteSpace: 'nowrap' }}>
              View full Campaign & Offer Intel →
            </Link>
          </div>
        </div>
      </section>

      <section ref={row4.ref} className={revealCls(row4.vis)}>
        <div className="section-head"><div>
          <h2>
            Brand Momentum Index
            <SectionInfo
              title="Brand Momentum Index"
              description="Composite score combining mention volume, weighted engagement, and sentiment (last 7 days). Score is normalized to a 0–100 range. The horizontal bar below each score shows sentiment polarity (red = negative, green = positive) with a dot at the brand's actual sentiment position."
              source="product_attention_summary · last_7d window"
            />
          </h2>
          <div className="sub">Composite momentum across all 11 tracked brands · last 7 days.</div>
        </div></div>
        <div
          className="card"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 12,
          }}
        >
          {(brands.length > 0 ? brands : Array.from({ length: 11 })).map((b, idx) => {
            const brandSlug = b && typeof b === 'object' && 'id' in b ? (b as V2Brand).id : ''
            const brandUuid = b && typeof b === 'object' && 'brand_id' in b ? (b as V2Brand).brand_id : ''
            const ms7 = mentionSummary.find(
              (r) => (r.brand_id === brandUuid || r.brand_id === brandSlug) && r.period === 'last_7d'
            )
            const weighted = ms7?.weighted_total ?? 0
            const sentiment = ms7?.avg_sentiment ?? 0
            const mentions = ms7?.total_mentions ?? 0
            const baseScore = Math.round(weighted / 10)
            const adjusted = baseScore + sentiment * 10
            const score = Math.max(0, Math.min(100, Math.round(adjusted)))
            const hasData = !!ms7
            const isJoola = brandSlug === 'joola'
            const displayName = brandSlug ? name(brandSlug) : '—'
            const dotColor = brandSlug ? pgColor(brandSlug) : '#3a4150'
            const sentimentLeft = ((sentiment + 1) / 2) * 100
            const cardStyle: React.CSSProperties = {
              background: 'var(--line-2)',
              border: isJoola ? '1px solid rgba(34,197,94,0.4)' : '1px solid var(--wb-8)',
              borderRadius: 12,
              padding: 14,
              boxShadow: isJoola ? '0 0 20px rgba(34,197,94,0.1)' : 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }
            return (
              <div key={brandSlug || `placeholder-${idx}`} style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: dotColor, display: 'inline-block' }} />
                  <span
                    style={{
                      fontWeight: 800,
                      fontSize: 12,
                      letterSpacing: 0.3,
                      color: isJoola ? '#22c55e' : 'var(--fg, #fff)',
                      textTransform: 'uppercase',
                    }}
                  >
                    {displayName}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 36, fontWeight: 800, color: '#fff', lineHeight: 1 }}>
                    {hasData ? score : '—'}
                  </span>
                  <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>pts</span>
                </div>
                <div style={{ position: 'relative', height: 6, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, width: '50%', height: '100%', background: 'rgba(239,68,68,0.35)' }} />
                  <div style={{ position: 'absolute', left: '50%', top: 0, width: '50%', height: '100%', background: 'rgba(34,197,94,0.35)' }} />
                  <div
                    style={{
                      position: 'absolute',
                      left: `calc(${sentimentLeft}% - 4px)`,
                      top: -1,
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: hasData ? (sentiment >= 0 ? '#22c55e' : '#ef4444') : '#6b7280',
                      border: '1px solid var(--sticky-bg)',
                    }}
                  />
                </div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>
                  {hasData ? `${fmt(mentions)} ${mentions === 1 ? 'mention' : 'mentions'} · 7d` : 'No mention data'}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section ref={row5.ref} className={revealCls(row5.vis)}>
        <div className="section-head"><div>
          <h2>
            Competitive Benchmark
            <SectionInfo
              title="Competitive Benchmark Matrix"
              description="Side-by-side comparison of key metrics across all 11 brands. Click any column header to sort. The highest value in each metric column is shaded green; the lowest is shaded red. JOOLA is pinned at the top for quick reference."
              source="Aggregated from Instagram, YouTube, and product_attention_summary"
            />
          </h2>
          <div className="sub">Cross-brand performance across all tracked metrics — {rangeLabelLower}.</div>
        </div></div>
        <div className="card">
          {(() => {
            // Build benchmark rows from existing state (brands + ig + yt + mentionSummary)
            const sourceBrands = isFiltered ? filteredBrands : brands
            type BenchmarkRow = {
              slug: string
              label: string
              color: string
              igFollowers: number | null
              ytVideos: number | null
              mentions7d: number | null
              mentions30d: number | null
              sentiment7d: number | null
              productAttention: number | null
            }
            const rows: BenchmarkRow[] = sourceBrands.map((b) => {
              const igRow = ig.find((r) => r.brand === b.id)
              const ytRow = yt.find((r) => r.brand === b.id)
              const ms7 = mentionSummary.find(
                (r) => (r.brand_id === b.brand_id || r.brand_id === b.id) && r.period === 'last_7d'
              )
              const ms30 = mentionSummary.find(
                (r) => (r.brand_id === b.brand_id || r.brand_id === b.id) && r.period === 'last_30d'
              )
              return {
                slug: b.id,
                label: name(b.id),
                color: pgColor(b.id),
                igFollowers: igRow ? igRow.followers : null,
                ytVideos: ytRow ? ytRow.videos : null,
                mentions7d: ms7 ? ms7.total_mentions : null,
                mentions30d: ms30 ? ms30.total_mentions : null,
                sentiment7d: ms7 ? ms7.avg_sentiment : null,
                productAttention: ms30 ? ms30.weighted_total : null,
              }
            })

            // Min/max for conditional formatting
            const numericValues = (key: BenchmarkSortKey): number[] =>
              rows.map((r) => r[key]).filter((v): v is number => typeof v === 'number')
            const minMax = (key: BenchmarkSortKey): { min: number; max: number } => {
              const vals = numericValues(key)
              if (vals.length === 0) return { min: 0, max: 0 }
              return { min: Math.min(...vals), max: Math.max(...vals) }
            }
            const cellBg = (val: number | null, key: BenchmarkSortKey): string => {
              if (val == null) return 'transparent'
              const { min, max } = minMax(key)
              if (min === max) return 'transparent'
              if (val === max) return 'rgba(34,197,94,0.15)'
              if (val === min) return 'rgba(239,68,68,0.1)'
              return 'transparent'
            }

            // Apply brand filter (case-insensitive substring) before sorting
            const q = benchmarkBrandFilter.trim().toLowerCase()
            const filteredRows = q
              ? rows.filter((r) => r.label.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q))
              : rows

            // Sort: JOOLA always first, then by selected column
            const sortedRows = [...filteredRows].sort((a, b) => {
              if (a.slug === 'joola') return -1
              if (b.slug === 'joola') return 1
              if (!benchmarkSortKey) return 0
              const av = a[benchmarkSortKey]
              const bv = b[benchmarkSortKey]
              if (av == null && bv == null) return 0
              if (av == null) return 1
              if (bv == null) return -1
              return benchmarkSortDir === 'asc' ? av - bv : bv - av
            }).slice(0, 200)

            const toggle = (k: string): void => {
              const key = k as BenchmarkSortKey
              if (benchmarkSortKey === key) {
                setBenchmarkSortDir(benchmarkSortDir === 'asc' ? 'desc' : 'asc')
              } else {
                setBenchmarkSortKey(key)
                setBenchmarkSortDir('desc')
              }
            }

            const sentimentPill = (v: number | null): JSX.Element => {
              if (v == null) return <span style={{ color: '#6b7280' }}>—</span>
              if (v > 0.2) return <span className="pill pill-green">Positive</span>
              if (v < -0.2) return <span className="pill" style={{ background: 'rgba(239,68,68,0.18)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.35)' }}>Negative</span>
              return <span className="pill pill-amber">Neutral</span>
            }

            const fmtOrDash = (v: number | null): string => (v == null ? '—' : fmt(v))

            return (
              <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto', overflowX: 'auto' }}>
              <table className="data" style={{ width: '100%', minWidth: 880 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--sticky-bg)', zIndex: 2 }}>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Brand</th>
                    <SortTh col="igFollowers" label="IG Followers" sortKey={benchmarkSortKey} sortDir={benchmarkSortDir} toggle={toggle} style={{ textAlign: 'right' }} />
                    <SortTh col="ytVideos" label="YT Videos" sortKey={benchmarkSortKey} sortDir={benchmarkSortDir} toggle={toggle} style={{ textAlign: 'right' }} />
                    <SortTh col="mentions7d" label="7d Mentions" sortKey={benchmarkSortKey} sortDir={benchmarkSortDir} toggle={toggle} style={{ textAlign: 'right' }} />
                    <SortTh col="mentions30d" label="30d Mentions" sortKey={benchmarkSortKey} sortDir={benchmarkSortDir} toggle={toggle} style={{ textAlign: 'right' }} />
                    <SortTh col="sentiment7d" label="Sentiment 7d" sortKey={benchmarkSortKey} sortDir={benchmarkSortDir} toggle={toggle} style={{ textAlign: 'center' }} />
                    <SortTh col="productAttention" label="Product Attention" sortKey={benchmarkSortKey} sortDir={benchmarkSortDir} toggle={toggle} style={{ textAlign: 'right' }} />
                  </tr>
                  <tr className="col-filter-row">
                    <th><ColumnFilter col="brand" value={benchmarkBrandFilter} onChange={setBenchmarkBrandFilter} placeholder="brand…" /></th>
                    <th colSpan={6} />
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => {
                    const isJoola = r.slug === 'joola'
                    const rowStyle: React.CSSProperties = isJoola
                      ? { borderLeft: '3px solid #22c55e', background: 'rgba(34,197,94,0.04)' }
                      : {}
                    return (
                      <tr key={r.slug} style={rowStyle}>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <span className="brand-dot" style={{ background: r.color, width: 8, height: 8, borderRadius: 999, display: 'inline-block' }} />
                            <span style={{ fontWeight: 700, color: isJoola ? '#22c55e' : 'inherit' }}>{r.label}</span>
                          </span>
                        </td>
                        <td style={{ background: cellBg(r.igFollowers, 'igFollowers'), textAlign: 'right' }}>{fmtOrDash(r.igFollowers)}</td>
                        <td style={{ background: cellBg(r.ytVideos, 'ytVideos'), textAlign: 'right' }}>{fmtOrDash(r.ytVideos)}</td>
                        <td style={{ background: cellBg(r.mentions7d, 'mentions7d'), textAlign: 'right' }}>{fmtOrDash(r.mentions7d)}</td>
                        <td style={{ background: cellBg(r.mentions30d, 'mentions30d'), textAlign: 'right' }}>{fmtOrDash(r.mentions30d)}</td>
                        <td style={{ textAlign: 'center' }}>{sentimentPill(r.sentiment7d)}</td>
                        <td style={{ background: cellBg(r.productAttention, 'productAttention'), textAlign: 'right' }}>{fmtOrDash(r.productAttention)}</td>
                      </tr>
                    )
                  })}
                  {sortedRows.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>
                        No rows found for the selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            )
          })()}
        </div>
      </section>

      {/* ─── Section D: Command Center Summary ──────────────────────── */}
      <section>
        <div className="section-head"><div>
          <h2>
            Command Center summary
            <SectionInfo
              title="Command Center summary"
              description="One row per domain — product attention, campaign pressure, community sentiment, influencer impact, and sales/stock movement. Winner = top brand on each metric over the last 30 days. JOOLA rank + biggest non-JOOLA threat + a rule-based recommended action. Hover the value cells to see the underlying metric."
              source="product_attention_summary + ad_pressure_daily + promotion_daily + mention_facts + inventory_events"
            />
          </h2>
          <div className="sub">Every tracked domain rolled up — what JOOLA should do this week.</div>
        </div></div>
        <div className="card">
          {marketIntel ? (
            <div className="table-wrap" style={{ overflowX: 'auto' }}>
              <table className="data" style={{ width: '100%', minWidth: 960 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--sticky-bg)', zIndex: 2 }}>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Area</th>
                    <th style={{ textAlign: 'left' }}>Winner</th>
                    <th style={{ textAlign: 'center' }}>JOOLA rank</th>
                    <th style={{ textAlign: 'left' }}>Biggest threat</th>
                    <th style={{ textAlign: 'left' }}>Recommended action</th>
                  </tr>
                </thead>
                <tbody>
                  {marketIntel.command.map((row: CommandCenterRow) => {
                    const winnerIsJoola = row.winnerBrand === 'joola'
                    const winnerVsJoola = row.joolaValue > 0
                      ? `${row.winnerLabel}: winner=${row.winnerValue.toFixed(2)} · JOOLA=${row.joolaValue.toFixed(2)}`
                      : `${row.winnerLabel}: winner=${row.winnerValue.toFixed(2)} · JOOLA=0`
                    return (
                      <tr key={row.area} style={winnerIsJoola ? { background: 'rgba(34,197,94,0.04)' } : {}}>
                        <td style={{ textAlign: 'left', fontWeight: 700 }}>
                          {row.areaLabel}
                          {row.caveat && (
                            <div style={{ marginTop: 4, fontSize: 10, color: '#F5E625', fontWeight: 400 }}>* {row.caveat}</div>
                          )}
                        </td>
                        <td style={{ textAlign: 'left' }} title={winnerVsJoola}>
                          {row.winnerBrand ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 8, height: 8, borderRadius: 99, background: pgColor(row.winnerBrand) }} />
                              <span style={{ fontWeight: 700, color: winnerIsJoola ? '#22c55e' : 'inherit' }}>{name(row.winnerBrand)}</span>
                            </span>
                          ) : (
                            <span style={{ color: '#6b7280' }}>—</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'center' }} title={`JOOLA value on "${row.winnerLabel}": ${row.joolaValue.toFixed(2)}`}>
                          {row.joolaRank ? (
                            <span className={'pill ' + (row.joolaRank === 1 ? 'pill-green' : row.joolaRank <= 3 ? 'pill-amber' : 'pill-ghost')} style={{ fontSize: 10 }}>
                              #{row.joolaRank}
                            </span>
                          ) : <span style={{ color: '#6b7280' }}>—</span>}
                        </td>
                        <td style={{ textAlign: 'left' }} title={`${row.winnerLabel}: ${row.threatValue.toFixed(2)}`}>
                          {row.threatBrand ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 8, height: 8, borderRadius: 99, background: pgColor(row.threatBrand) }} />
                              <span style={{ fontWeight: 600 }}>{name(row.threatBrand)}</span>
                            </span>
                          ) : (
                            <span style={{ color: '#6b7280' }}>—</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'left', fontSize: 12 }}>{row.recommendedAction}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-4)', fontSize: 13 }}>
              Loading command-center summary…
            </div>
          )}
        </div>
      </section>

      {/* ─── Section E: Competitor Strategy Summary ─────────────────── */}
      <section>
        <div className="section-head"><div>
          <h2>
            Competitor strategy summary
            <SectionInfo
              title="Competitor strategy summary"
              description="One card per non-JOOLA brand. Strategy label is rule-based, combining: their campaign quadrant (high/low ads × high/low promos), product attention rank, dominant Instagram content theme, and athlete-tied mentions. JOOLA counter-move is canned per strategy type."
              source="ad_pressure_daily + promotion_daily + product_attention_summary + mention_facts + ig_profiles_weekly"
            />
          </h2>
          <div className="sub">Live read on what each competitor is doing — and how JOOLA should respond.</div>
        </div></div>
        {marketIntel ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 12 }}>
            {marketIntel.strategies.map((card: BrandStrategyCard) => (
              <div
                key={card.brand}
                className="card"
                style={{
                  padding: 0,
                  display: 'grid',
                  gridTemplateColumns: '6px 1fr',
                  overflow: 'hidden',
                }}
              >
                <div style={{ background: pgColor(card.brand) }} />
                <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: 0.3 }}>{name(card.brand)}</span>
                    <span className="pill pill-ghost" style={{ fontSize: 9 }}>{card.campaignQuadrant.replace(/-/g, ' ')}</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#F5E625' }}>{card.strategyLabel}</div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Evidence</div>
                    <ul style={{ margin: 0, paddingLeft: 16, color: '#cbd1dc', fontSize: 12, lineHeight: 1.6 }}>
                      {card.evidence.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                  <div style={{ marginTop: 4, padding: 10, background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 6, fontSize: 12, color: '#cbd1dc' }}>
                    <span style={{ color: '#22c55e', fontWeight: 700 }}>JOOLA counter-move:</span> {card.joolaCounterMove}
                  </div>
                </div>
              </div>
            ))}
            {marketIntel.strategies.length === 0 && (
              <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--fg-4)', fontSize: 13 }}>
                No competitor strategy signals available yet.
              </div>
            )}
          </div>
        ) : (
          <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--fg-4)', fontSize: 13 }}>
            Loading competitor strategy summary…
          </div>
        )}
      </section>
    </>
  )
}
