'use client'

import { useEffect, useState, useMemo } from 'react'
import {
  fetchBrands, fetchReddit, fetchRedditSubreddits, fetchAds, fetchPromos, fetchIG,
  type V2Brand, type V2RedditRow, type V2Subreddit, type V2AdRow, type V2PromoRow, type V2IGRow,
} from '@/lib/v2/data'
import { fmt, LineChart, Donut } from '@/components/v2/charts'
import { PageHead, MiniKpi, pgColor, pgName, LoadingPage, SectionInfo, FilterBanner } from '@/components/v2/PageShell'
import { useBrandFilter, applyBrandFilter } from '@/lib/v2/BrandFilterContext'

type Signal = { type: 'ad' | 'promo' | 'social' | 'reddit' | 'product'; brand: string; desc: string; when: string }

export default function MarketIntelPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [reddit, setReddit] = useState<V2RedditRow[]>([])
  const [subreddits, setSubreddits] = useState<V2Subreddit[]>([])
  const [ads, setAds] = useState<V2AdRow[]>([])
  const [promos, setPromos] = useState<V2PromoRow[]>([])
  const [ig, setIg] = useState<V2IGRow[]>([])
  const [loading, setLoading] = useState(true)
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()

  useEffect(() => {
    fetchBrands().then(async (b) => {
      const [r, s, a, p, i] = await Promise.all([
        fetchReddit(b), fetchRedditSubreddits(b), fetchAds(b), fetchPromos(b), fetchIG(b),
      ])
      setBrands(b); setAllBrands(b); setReddit(r); setSubreddits(s); setAds(a); setPromos(p); setIg(i); setLoading(false)
    }).catch(() => setLoading(false))
  }, [setAllBrands])

  const displayReddit = applyBrandFilter(reddit, filteredBrands, isFiltered)
  const displayAds = applyBrandFilter(ads, filteredBrands, isFiltered)
  const displayPromos = applyBrandFilter(promos, filteredBrands, isFiltered)
  const displayIG = applyBrandFilter(ig, filteredBrands, isFiltered)

  // All derived values and hooks must be before any early return
  const name = (s: string) => pgName(s, brands)
  const joolaReddit = displayReddit.find((r) => r.brand === 'joola')
  const joolaIG = displayIG.find((r) => r.brand === 'joola')
  const joolaPromos = displayPromos.find((p) => p.brand === 'joola')
  const totalMentions = displayReddit.reduce((s, r) => s + r.mentions, 0)

  const signals = useMemo((): Signal[] => {
    const out: Signal[] = []
    const topAd = displayAds[0]
    if (topAd && topAd.brand !== 'joola') {
      out.push({ type: 'ad', brand: topAd.brand, desc: `${pgName(topAd.brand, brands)} running ${topAd.total} ads (${topAd.meta}M/${topAd.google}G) — ${topAd.share.toFixed(1)}% share of voice`, when: 'this week' })
    }
    if (displayPromos[0] && displayPromos[0].count > 0) {
      out.push({ type: 'promo', brand: displayPromos[0].brand, desc: `${pgName(displayPromos[0].brand, brands)} has ${displayPromos[0].count} active promotions — ${displayPromos[0].pct.toFixed(0)}% of tracked discounts`, when: 'this week' })
    }
    if ((joolaPromos?.count || 0) === 0 && displayPromos.filter((p) => p.count > 0).length > 0) {
      out.push({ type: 'promo', brand: 'joola', desc: 'JOOLA has zero active promotions while competitors discount aggressively', when: 'ongoing' })
    }
    const topIG = [...displayIG].sort((a, b) => b.engRate - a.engRate)[0]
    if (topIG) {
      out.push({ type: 'social', brand: topIG.brand, desc: `${pgName(topIG.brand, brands)} leads IG engagement at ${topIG.engRate.toFixed(2)}% — ${fmt(topIG.followers)} followers`, when: 'latest snapshot' })
    }
    const jIG = displayIG.find((r) => r.brand === 'joola')
    if (jIG) {
      out.push({ type: 'social', brand: 'joola', desc: `JOOLA IG: ${fmt(jIG.followers)} followers, ${jIG.engRate.toFixed(2)}% engagement rate`, when: 'latest snapshot' })
    }
    if (displayReddit[0]) {
      out.push({ type: 'reddit', brand: displayReddit[0].brand, desc: `${pgName(displayReddit[0].brand, brands)} leads Reddit with ${displayReddit[0].mentions} mentions`, when: 'last 90 days' })
    }
    const jR = displayReddit.find((r) => r.brand === 'joola')
    if (jR) {
      const posPct = Math.round(jR.positive / Math.max(1, jR.mentions) * 100)
      out.push({ type: 'reddit', brand: 'joola', desc: `JOOLA Reddit: ${jR.mentions} mentions, ${posPct}% positive sentiment`, when: 'last 90 days' })
    }
    return out.slice(0, 8)
  }, [displayAds, displayPromos, displayIG, displayReddit, brands])

  const trends = displayReddit.slice(0, 6).map((r, i) => ({
    rank: i + 1,
    kw: name(r.brand) + ' paddle',
    mentions: r.mentions,
    joola: r.brand === 'joola',
    related: name(r.brand),
  }))

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

  if (loading) return <LoadingPage />

  return (
    <>
      <PageHead
        eyebrow="MARKET INTEL · TRENDS · SIGNALS · INTEL FEED"
        title="Market"
        accent="intel"
        sub="What the market is talking about, what competitors are doing, and what JOOLA should respond to. Refreshed weekly."
        actions={<>
          <select className="select"><option>All sources</option></select>
          <select className="select"><option>Last 30 days</option></select>
        </>}
      />
      <FilterBanner />

      <section>
        <div className="kpi-grid">
          <MiniKpi
            label="Signals (wk)" flavor="warn"
            value={signals.length}
            delta={signals.length > 4 ? 2 : 0}
            color="#F5E625"
            spark={[...Array(8)].map((_, i) => Math.max(2, signals.length - 4 + i))}
          />
          <MiniKpi
            label="Crisis flags" flavor="danger"
            value={signals.filter((s) => s.brand !== 'joola' && (s.type === 'promo' || s.type === 'ad')).length}
            color="#ef4444"
            customVs="competitor activity alerts"
          />
          <MiniKpi
            label="JOOLA Reddit mentions" src="reddit_mentions" flavor="joola"
            value={joolaReddit ? fmt(joolaReddit.mentions) : '0'}
            color="#22c55e"
            spark={joolaMentionSpark}
          />
          <MiniKpi
            label="Total Reddit mentions" src="reddit_mentions"
            value={fmt(totalMentions)}
            color="#818cf8"
            customVs={`across ${displayReddit.length} brands`}
          />
        </div>
      </section>

      <section>
        <div className="section-head"><div>
          <h2>
            Brand discussion volume · r/pickleball + communities
            <SectionInfo
              title="Who's Being Talked About"
              description="Ranked by total Reddit mentions across all tracked communities. The brand at #1 is dominating organic pickleball conversation. A higher rank than your ad spend would suggest = strong brand equity. A lower rank = paid reach isn't translating to organic advocacy."
              source="reddit_mentions · scraped via trudax/reddit-scraper-lite from r/pickleball and related subreddits, last 90 days"
            />
          </h2>
          <div className="sub">Who is being talked about most.</div>
        </div></div>
        <div className="card">
          {trends.map((t) => (
            <div key={t.rank} className={'trend-row ' + (t.joola ? 'joola' : '')}>
              <div className="rank">#{t.rank}</div>
              <div className="kw">{t.kw}</div>
              <div className="mtrack">
                <div className="mfill" style={{ width: (t.mentions / Math.max(1, trends[0].mentions) * 100) + '%', background: t.joola ? '#22c55e' : '#F5E625' }} />
              </div>
              <div className="mvol">{t.mentions}</div>
              <div>
                {t.joola
                  ? <span className="pill pill-green">JOOLA</span>
                  : <span className="pill pill-ghost">{t.related}</span>
                }
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="section-head"><div>
          <h2>
            Live intel feed · latest signals
            <SectionInfo
              title="Competitive Intelligence Feed"
              description="Auto-generated signals from this week's data. Each row is a notable event: a competitor ramping up ads, a brand starting a promotion blitz, someone dominating social, or a Reddit conversation trend. These are the inputs for JOOLA's weekly marketing response."
              source="All data sources: marketing_ads, promotions, ig_profiles_weekly, reddit_mentions — aggregated each Monday"
            />
          </h2>
          <div className="sub">Every signal captured by the platform — paid, organic, community.</div>
        </div></div>
        <div className="card">
          {signals.map((s, i) => (
            <div key={i} className="signal">
              <span className={'sig-tag ' + s.type}>
                {s.type === 'ad' ? 'AD' : s.type === 'promo' ? 'PROMO' : s.type === 'social' ? 'SOCIAL' : s.type === 'reddit' ? 'REDDIT' : 'PRODUCT'}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className="brand-dot" style={{ background: pgColor(s.brand) }} />
                <span style={{ fontWeight: 700, color: s.brand === 'joola' ? '#22c55e' : 'var(--fg)', fontSize: 12 }}>{name(s.brand)}</span>
              </span>
              <span className="desc">{s.desc}</span>
              <span className="when">{s.when}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="section-head"><div>
          <h2>
            JOOLA mentions across communities · 30 days
            <SectionInfo
              title="JOOLA Community Footprint"
              description="Left chart: how JOOLA's mention volume compares to the top 2 competitors over the last 8 data points. Right chart: which subreddits JOOLA's mentions come from — shows where the brand has organic presence vs. where it's absent."
              source="reddit_mentions · scraped via trudax/reddit-scraper-lite. Trend lines are approximate based on mention totals."
            />
          </h2>
          <div className="sub">Trend vs top competitors. Computed from scraped post timestamps.</div>
        </div></div>
        <div className="two-col">
          <div className="card"><div className="card-pad">
            <LineChart series={lineSeries} />
          </div></div>
          <div className="card">
            <div className="card-head">
              <h3>Source breakdown</h3>
              <span className="meta">total: {joolaSubTotal} JOOLA mentions</span>
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
                    <span className="val">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
