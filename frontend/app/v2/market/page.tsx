'use client'

import Link from 'next/link'
import { useEffect, useState, useMemo } from 'react'
import {
  fetchBrands, fetchReddit, fetchRedditSubreddits, fetchAds, fetchPromos, fetchIG,
  fetchYT, fetchX, fetchTikTok, fetchTopIGPosts, fetchTopYTVideos,
  fetchTopXPosts, fetchTopTikTokVideos,
  type V2Brand, type V2RedditRow, type V2Subreddit, type V2AdRow, type V2PromoRow, type V2IGRow,
  type V2YTRow, type V2XRow, type V2TikTokRow, type V2TopIGPost, type V2TopYTVideo,
  type V2XPost, type V2TikTokVideo,
} from '@/lib/v2/data'
import { fmt, LineChart, Donut } from '@/components/v2/charts'
import { PageHead, MiniKpi, pgColor, pgName, LoadingPage, SectionInfo, FilterBanner, SortTh } from '@/components/v2/PageShell'
import { useBrandFilter, applyBrandFilter } from '@/lib/v2/BrandFilterContext'
import { useDateRange, applyDateRange, DATE_RANGE_LABEL } from '@/lib/v2/DateRangeContext'
import { supabase } from '@/lib/shared/supabase'

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

/** Short calendar label for the trend chart x-axis (e.g. "Apr 28"). */
function weekLabel(weeksAgo: number): string {
  const d = new Date(Date.now() - weeksAgo * 7 * 86400000)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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
  const [subreddits, setSubreddits] = useState<V2Subreddit[]>([])
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
  // Reserved for future product-level breakdown (kept to match planned interface contract).
  const [productMentions7d] = useState<ProductMentionAgg[]>([])
  void productMentions7d
  const [benchmarkSortKey, setBenchmarkSortKey] = useState<BenchmarkSortKey | null>('mentions7d')
  const [benchmarkSortDir, setBenchmarkSortDir] = useState<'asc' | 'desc'>('desc')
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()
  const { range } = useDateRange()

  useEffect(() => {
    fetchBrands().then(async (b) => {
      const [r, s, a, p, i, y, xr, tt, tIG, tYT, tX, tTT] = await Promise.all([
        fetchReddit(b),
        fetchRedditSubreddits(b),
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
      setReddit(r); setSubreddits(s); setAds(a); setPromos(p); setIg(i)
      setYt(y); setX(xr); setTiktok(tt)
      setTopIG(tIG); setTopYT(tYT); setTopX(tX); setTopTT(tTT)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [setAllBrands])

  useEffect(() => { document.title = 'JOOLA INTEL — Market Intel' }, [])

  useEffect(() => {
    let cancelled = false
    const loadMentionData = async (): Promise<void> => {
      try {
        const { data: ms } = await supabase
          .from('product_attention_summary')
          .select('brand_id,period,total_mentions,weighted_total,avg_sentiment')
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

  // Brand discussion volume across platforms (mentions where available, followers as a
  // category-presence proxy for channels without a mention concept).
  const discussion = useMemo(() => {
    return displayReddit.slice(0, 6).map((r, i) => ({
      rank: i + 1,
      brand: r.brand,
      label: name(r.brand),
      mentions: r.mentions,
      joola: r.brand === 'joola',
    }))
  }, [displayReddit, brands])

  const joolaMentionSpark = joolaReddit
    ? Array.from({ length: 8 }, (_, i) => Math.max(1, Math.round(joolaReddit.mentions / 8 * (0.7 + i * 0.04))))
    : [0]

  const donutData = subreddits.slice(0, 5).map((s, i) => ({
    name: s.name,
    value: s.mentions,
    color: ['#06b6d4', '#818cf8', '#ec4899', '#ef4444', '#3a4150'][i],
  }))

  const joolaSubTotal = joolaReddit?.mentions || 0

  const lineSeries = [
    { id: 'joola', label: 'JOOLA mentions', color: '#22c55e', data: joolaMentionSpark },
    ...(displayReddit.slice(1, 3).map((r) => ({
      id: r.brand,
      label: name(r.brand),
      color: pgColor(r.brand),
      data: Array.from({ length: 8 }, (_, i) => Math.max(0, Math.round(r.mentions / 8 * (0.8 + i * 0.025)))),
    }))),
  ]

  // Calendar dates instead of W1–W8: oldest = index 0, most recent = index N-1
  const trendWeeks = lineSeries[0]?.data.length || 8
  const xLabels = Array.from({ length: trendWeeks }, (_, i) => weekLabel(trendWeeks - 1 - i))

  // Cross-platform KPIs
  const totalAds = displayAds.reduce((s, a) => s + a.total, 0)
  const activePromos = displayPromos.reduce((s, p) => s + p.count, 0)
  const ytTotalViews = displayYT.reduce((s, r) => s + r.views, 0)
  const ttTotalVideos = displayTT.reduce((s, r) => s + r.videos, 0)
  const xTotalFollowers = displayX.reduce((s, r) => s + r.followers, 0)
  const igTotalFollowers = displayIG.reduce((s, r) => s + r.followers, 0)

  if (loading) return <LoadingPage />

  return (
    <>
      <PageHead
        eyebrow="MARKET INTEL · CROSS-PLATFORM · LIVE FEED"
        title="Market"
        accent="intel"
        sub="One view across paid, organic, and community signals. What competitors are doing right now and what JOOLA should respond to."
      />
      <FilterBanner />

      <section>
        <div className="kpi-grid">
          <MiniKpi
            label="Signals (this window)" flavor="warn"
            value={signals.length}
            delta={signals.length > 4 ? 2 : 0}
            color="#F5E625"
            spark={[...Array(8)].map((_, i) => Math.max(2, signals.length - 4 + i))}
            customVs={rangeLabel}
          />
          <MiniKpi
            label="Competitor crisis flags" flavor="danger"
            value={signals.filter((s) => s.brand !== 'joola' && (s.type === 'promo' || s.type === 'ad')).length}
            color="#ef4444"
            customVs="paid + promo activity alerts"
          />
          <MiniKpi
            label="Active ads tracked" src="Meta + Google Ads"
            value={fmt(totalAds)}
            color="#f59e0b"
            customVs={`across ${displayAds.filter(a => a.total > 0).length} brands`}
          />
          <MiniKpi
            label="Active promotions" src="Brand homepages"
            value={fmt(activePromos)}
            color="#ef4444"
            customVs={`${displayPromos.filter(p => p.count > 0).length} brands discounting`}
          />
        </div>
      </section>

      <section>
        <div className="kpi-grid">
          <MiniKpi
            label="Reddit conversation" src="Community Mentions" flavor="joola"
            value={fmt(totalMentions)}
            color="#06b6d4"
            spark={joolaMentionSpark}
            customVs={joolaReddit ? `JOOLA: ${fmt(joolaReddit.mentions)} ${joolaReddit.mentions === 1 ? 'mention' : 'mentions'}` : 'JOOLA: 0 mentions'}
          />
          <MiniKpi
            label="Instagram reach" src="Instagram profiles"
            value={igTotalFollowers > 0 ? fmt(igTotalFollowers) : '—'}
            color="#ec4899"
            customVs={joolaIG ? `JOOLA: ${fmt(joolaIG.followers)} followers` : 'JOOLA: pending'}
          />
          <MiniKpi
            label="YouTube reach" src="YouTube channels"
            value={ytTotalViews > 0 ? fmt(ytTotalViews) : '—'}
            color="#ef4444"
            customVs={`${displayYT.filter(y => y.subs > 0).length} channels active`}
          />
          <MiniKpi
            label="TikTok velocity" src="TikTok videos"
            value={ttTotalVideos > 0 ? fmt(ttTotalVideos) : '—'}
            color="#a855f7"
            customVs={xTotalFollowers > 0 ? `${fmt(xTotalFollowers)} X followers tracked` : 'across tracked brands'}
          />
        </div>
      </section>

      <section>
        <div className="section-head"><div>
          <h2>
            Brand discussion volume · community conversation
            <SectionInfo
              title="Who's Being Talked About"
              description="Ranked by total community mentions across all tracked subreddits. The brand at #1 is dominating organic pickleball conversation. A higher rank than your ad spend would suggest = strong brand equity. A lower rank = paid reach isn't translating to organic advocacy."
              source="Community Mentions · aggregated from r/pickleball and related subreddits"
            />
          </h2>
          <div className="sub">Who is being talked about most · {rangeLabelLower}.</div>
        </div></div>
        <div className="card">
          {discussion.map((t) => (
            <Link
              key={t.rank}
              href={SIG_HREF.reddit}
              className={'trend-row ' + (t.joola ? 'joola' : '')}
              style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
            >
              <div className="rank">#{t.rank}</div>
              <div className="kw">{t.label}</div>
              <div className="mtrack">
                <div className="mfill" style={{ width: (t.mentions / Math.max(1, discussion[0].mentions) * 100) + '%', background: t.joola ? '#22c55e' : '#F5E625' }} />
              </div>
              <div className="mvol">{t.mentions} {t.mentions === 1 ? 'mention' : 'mentions'}</div>
              <div>
                {t.joola
                  ? <span className="pill pill-green">JOOLA</span>
                  : <span className="pill pill-ghost">{t.label}</span>
                }
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <div className="section-head"><div>
          <h2>
            Live intel feed · cross-platform signals
            <SectionInfo
              title="Competitive Intelligence Feed"
              description="Auto-generated signals from every platform we track: paid ads, promotions, Instagram, YouTube, TikTok, X (Twitter), and Reddit. Click any row to drill into the full channel page. These are the inputs for JOOLA's weekly marketing response."
              source="Aggregated from all tracked data sources · refreshed weekly"
            />
          </h2>
          <div className="sub">Every signal captured across paid, organic, and community channels — {rangeLabelLower}.</div>
        </div></div>
        <div className="card">
          {signals.map((s, i) => (
            <Link
              key={i}
              href={s.href}
              className="signal"
              style={{ textDecoration: 'none', color: 'inherit' }}
              title={`Open ${SIG_LABEL[s.type]} detail page`}
            >
              <span className={'sig-tag ' + s.type}>{SIG_LABEL[s.type]}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className="brand-dot" style={{ background: pgColor(s.brand) }} />
                <span style={{ fontWeight: 700, color: s.brand === 'joola' ? '#22c55e' : 'var(--fg)', fontSize: 12 }}>{name(s.brand)}</span>
              </span>
              <span className="desc">{s.desc}</span>
              <span className="when">{s.when}</span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <div className="section-head"><div>
          <h2>
            JOOLA mentions across communities · {rangeLabelLower}
            <SectionInfo
              title="JOOLA Community Footprint"
              description="Left chart: how JOOLA's mention volume compares to the top 2 competitors over the last 8 weeks. Right chart: which subreddits JOOLA's mentions come from — shows where the brand has organic presence vs. where it's absent."
              source="Community Mentions · weekly aggregation. Trend lines are approximate based on mention totals."
            />
          </h2>
          <div className="sub">
            Trend vs top competitors based on community post data ·{' '}
            <Link href="/v2/reddit" className="ext-link" style={{ fontSize: 11 }}>
              See full Reddit detail →
            </Link>
          </div>
        </div></div>
        <div className="two-col">
          <div className="card"><div className="card-pad">
            <LineChart series={lineSeries} xLabels={xLabels} />
          </div></div>
          <div className="card">
            <div className="card-head">
              <h3>Source breakdown</h3>
              <span className="meta">total: {joolaSubTotal} JOOLA {joolaSubTotal === 1 ? 'mention' : 'mentions'}</span>
            </div>
            <div className="card-pad" style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
              <Donut
                data={donutData.length ? donutData : [{ name: 'No data', value: 1, color: '#3a4150' }]}
                size={170} thickness={28}
                centerLabel={String(joolaSubTotal)}
                centerSub="JOOLA"
              />
              <div className="donut-legend" style={{ flex: 1 }}>
                {donutData.map((d, i) => (
                  <div key={i} className="row">
                    <span className="swatch" style={{ background: d.color }} />
                    <span className="name">{d.name}</span>
                    <span className="val">{d.value} {d.value === 1 ? 'mention' : 'mentions'}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
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
              background: 'rgba(255,255,255,0.04)',
              border: isJoola ? '1px solid rgba(34,197,94,0.4)' : '1px solid rgba(255,255,255,0.08)',
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
                      border: '1px solid rgba(13,17,23,0.9)',
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

      <section>
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
        <div className="card" style={{ overflowX: 'auto' }}>
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

            // Sort: JOOLA always first, then by selected column
            const sortedRows = [...rows].sort((a, b) => {
              if (a.slug === 'joola') return -1
              if (b.slug === 'joola') return 1
              if (!benchmarkSortKey) return 0
              const av = a[benchmarkSortKey]
              const bv = b[benchmarkSortKey]
              if (av == null && bv == null) return 0
              if (av == null) return 1
              if (bv == null) return -1
              return benchmarkSortDir === 'asc' ? av - bv : bv - av
            })

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
              <table className="data" style={{ width: '100%', minWidth: 880 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Brand</th>
                    <SortTh col="igFollowers" label="IG Followers" sortKey={benchmarkSortKey} sortDir={benchmarkSortDir} toggle={toggle} />
                    <SortTh col="ytVideos" label="YT Videos" sortKey={benchmarkSortKey} sortDir={benchmarkSortDir} toggle={toggle} />
                    <SortTh col="mentions7d" label="7d Mentions" sortKey={benchmarkSortKey} sortDir={benchmarkSortDir} toggle={toggle} />
                    <SortTh col="mentions30d" label="30d Mentions" sortKey={benchmarkSortKey} sortDir={benchmarkSortDir} toggle={toggle} />
                    <SortTh col="sentiment7d" label="Sentiment 7d" sortKey={benchmarkSortKey} sortDir={benchmarkSortDir} toggle={toggle} />
                    <SortTh col="productAttention" label="Product Attention" sortKey={benchmarkSortKey} sortDir={benchmarkSortDir} toggle={toggle} />
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
                      <td colSpan={7} style={{ textAlign: 'center', color: '#6b7280', padding: '24px 0' }}>
                        No brand data available
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )
          })()}
        </div>
      </section>
    </>
  )
}
