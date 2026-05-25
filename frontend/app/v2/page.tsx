'use client'

import { useEffect, useState, useMemo } from 'react'
import { fetchOverview, type V2Overview } from '@/lib/v2/data'
import { fmt, fmtPct, Sparkline, Delta, ScatterChart, Donut, BoxPlot, SentimentBar } from '@/components/v2/charts'
import { SectionInfo, FilterBanner, displayBrandName, SortTh, ColumnFilter } from '@/components/v2/PageShell'
import { useBrandFilter, applyBrandFilter } from '@/lib/v2/BrandFilterContext'

// ─── Page header ─────────────────────────────────────────────────────
function PageHeader() {
  return (
    <header className="page-head">
      <div>
        <div className="eyebrow">
          <span style={{ width: 6, height: 6, borderRadius: 99, background: '#F5E625', boxShadow: '0 0 0 4px rgba(245,230,37,0.18)' }} />
          LIVE INTELLIGENCE · MON 7:00 AM IST
        </div>
        <h1>Executive <em>overview</em></h1>
        <div className="sub">JOOLA's competitive position across the tracked brand set, refreshed every Monday. What changed, what it means, and what to do.</div>
      </div>
    </header>
  )
}

// ─── Section navigation ──────────────────────────────────────────────
function SectionNav() {
  const items = [
    ['briefing', "Today's briefing"],
    ['pulse', 'Pulse'],
    ['movers', 'Movers'],
    ['matrix', 'Engagement matrix'],
    ['ads', 'Ads & spend'],
    ['promos', 'Pricing war'],
    ['reddit', 'Community'],
    ['influencers', 'Influencers'],
    ['products', 'Catalog'],
    ['opps', 'Opportunities'],
  ]
  return (
    <nav className="section-nav">
      {items.map(([id, label]) => (
        <a key={id} href={'#' + id} className="snav-item">{label}</a>
      ))}
    </nav>
  )
}

// ─── Auto briefing cards ─────────────────────────────────────────────
function Briefing({ d }: { d: V2Overview }) {
  const cards = useMemo(() => {
    const out: { kind: 'crisis' | 'threat' | 'opportunity' | 'watch'; tag: string; title: string; body: string; action: string; href: string }[] = []

    const adsSorted = [...d.ads].sort((a, b) => b.total - a.total)
    const top = adsSorted[0]
    const joolaAd = d.ads.find((a) => a.brand === 'joola')
    if (top && joolaAd && top.brand !== 'joola' && top.total > joolaAd.total) {
      out.push({
        kind: 'crisis', tag: '🔴 Ad pressure',
        title: `${cap(top.brand)} runs ${top.total} ads — outpacing JOOLA by ${top.total - joolaAd.total}.`,
        body: `${cap(top.brand)} holds ${top.share.toFixed(1)}% share of tracked ads vs JOOLA's ${joolaAd.share.toFixed(1)}%. Active: ${top.active} creatives.`,
        action: 'Open ad creative comparison', href: '/v2/ads',
      })
    }
    const joolaPromos = d.promos.find((p) => p.brand === 'joola')?.count || 0
    const promoLeader = d.promos[0]
    if (joolaPromos === 0 && promoLeader && promoLeader.count > 0) {
      out.push({
        kind: 'threat', tag: '🟡 Pricing pressure',
        title: `JOOLA has 0 active promotions; ${cap(promoLeader.brand)} runs ${promoLeader.count}.`,
        body: `${promoLeader.pct.toFixed(1)}% of tracked discounts come from ${cap(promoLeader.brand)}. JOOLA is invisible on price-sensitive search.`,
        action: 'Draft promo plan', href: '/v2/promotions',
      })
    }
    const joolaIG = d.ig.find((r) => r.brand === 'joola')
    if (joolaIG) {
      const beating = d.ig.filter((r) => r.brand !== 'joola' && r.followers >= 50 && r.followers < joolaIG.followers && r.engRate > joolaIG.engRate)
      if (beating.length >= 1) {
        const leader = [...beating].sort((a, b) => b.engRate - a.engRate)[0]
        const erRatio = leader.engRate / Math.max(0.01, joolaIG.engRate)
        out.push({
          kind: 'threat', tag: '🟡 Engagement gap',
          title: `${cap(leader.brand)}'s engagement rate (${leader.engRate.toFixed(2)}%) is ${erRatio.toFixed(1)}× JOOLA's (${joolaIG.engRate.toFixed(2)}%) on a smaller audience.`,
          body: `${beating.length} smaller brand${beating.length === 1 ? '' : 's'} outperform JOOLA on engagement rate despite lower reach.`,
          action: 'Run content-format audit', href: '/v2/instagram',
        })
      }
    }
    const topComment = d.topComments[0]
    if (topComment) {
      out.push({
        kind: 'opportunity', tag: '🟢 Audience signal',
        title: `Top comment: "${truncate(topComment.text, 60)}"`,
        body: `${topComment.user} on ${cap(topComment.brand)} (${topComment.platform.toUpperCase()}) — ${fmt(topComment.likes)} likes. Surface this in messaging.`,
        action: 'Open comments intel', href: '/v2/comments',
      })
    }
    return out.slice(0, 4)
  }, [d])

  return (
    <section id="briefing">
      <div className="section-head">
        <div>
          <h2>
            Today's briefing
            <SectionInfo
              title="Auto-generated briefing"
              description="These cards are computed live from this week's scraped data — no manual curation. Each signal fires when a threshold is crossed (e.g., competitor outspends JOOLA on ads, engagement gap detected)."
              source="All Supabase tables — ig_profiles_weekly, marketing_ads, promotions, ig_posts"
            />
          </h2>
          <div className="sub">Auto-generated signals derived from this week's Supabase data — read in 30 seconds.</div>
        </div>
        <div className="actions">
          <span className="pill pill-yellow">AUTO · LIVE</span>
        </div>
      </div>
      <div className="briefing-strip">
        {cards.length === 0 ? (
          <div className="brief-card watch" style={{ gridColumn: '1 / -1' }}>
            <div className="severity" />
            <div className="tag">⚪ No signals yet</div>
            <h4>Need more snapshots to detect deltas.</h4>
            <p>Run the pipeline twice (a week apart) to unlock week-over-week briefings.</p>
          </div>
        ) : (
          cards.map((c, i) => (
            <div key={i} className={'brief-card fade-up ' + c.kind}>
              <div className="severity" />
              <div className="tag">{c.tag}</div>
              <h4>{c.title}</h4>
              <p>{c.body}</p>
              <a href={c.href} className="action">{c.action} →</a>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

// ─── KPI strip ───────────────────────────────────────────────────────
function KpiStrip({ d }: { d: V2Overview }) {
  const joolaIG = d.ig.find((r) => r.brand === 'joola')
  const joolaAd = d.ads.find((a) => a.brand === 'joola')
  const joolaProd = d.products.find((p) => p.brand === 'joola')
  const totalAds = d.ads.reduce((s, a) => s + a.total, 0)
  const joolaPromos = d.promos.find((p) => p.brand === 'joola')?.count || 0
  const totalPromos = d.promos.reduce((s, p) => s + p.count, 0)

  const tiles = [
    {
      label: 'IG followers',
      value: fmt(joolaIG?.followers || 0),
      tooltip: 'JOOLA\'s total Instagram follower count. Source: scraped weekly from @joolapickleball.',
      delta: joolaIG?.delta ?? null,
      pct: joolaIG?.deltaPct ?? null,
      spark: joolaIG?.trend || [],
      cls: 'joola',
      src: 'Instagram weekly',
    },
    {
      label: 'Engagement rate',
      value: (joolaIG?.engRate || 0).toFixed(2) + '%',
      tooltip: 'Average (likes + comments) per post divided by followers, across all JOOLA posts tracked.',
      delta: null, pct: null, cls: '',
      src: 'Instagram posts',
    },
    {
      label: 'Active ads',
      value: joolaAd?.active.toString() || '0',
      tooltip: 'Number of JOOLA ad creatives currently active in the Meta and Google Ads Library.',
      delta: null, pct: null, cls: 'warn',
      src: 'Meta & Google Ads',
    },
    {
      label: 'Total ads tracked',
      value: fmt(totalAds),
      tooltip: 'Total ad creatives tracked across the tracked brand set (Meta + Google combined). JOOLA\'s share of voice = ' + (joolaAd ? joolaAd.share.toFixed(1) : '0') + '%.',
      cls: '',
      src: 'Meta & Google Ads',
    },
    {
      label: joolaPromos === 0 ? 'Active promos (market)' : 'Active promos',
      value: joolaPromos === 0 ? `0 / ${totalPromos}` : joolaPromos.toString(),
      tooltip: joolaPromos === 0
        ? `JOOLA has 0 active promotions. The market total is ${totalPromos} across all competitors. This is a competitive gap.`
        : `JOOLA has ${joolaPromos} active promotions out of ${totalPromos} market-wide.`,
      cls: 'danger',
      src: 'Promotions',
    },
    {
      label: 'Catalog size',
      value: joolaProd?.count.toString() || '—',
      tooltip: 'Number of JOOLA paddle SKUs tracked in the product catalog.',
      cls: '',
      src: 'Product catalog',
    },
  ]
  return (
    <section id="pulse">
      <div className="section-head">
        <div>
          <h2>
            Pulse
            <SectionInfo
              title="JOOLA vitals"
              description="Key performance indicators for JOOLA specifically — follower count, engagement, ad presence, and product catalog size. Updated every Monday from scraped data."
              source="ig_profiles_weekly, marketing_ads, promotions, products"
            />
          </h2>
          <div className="sub">JOOLA's vitals — current snapshot.</div>
        </div>
      </div>
      <div className="kpi-grid">
        {tiles.map((t, i) => (
          <div key={i} className={'kpi ' + t.cls} title={t.tooltip}>
            <div className="label">
              <span>{t.label}</span>
              <span className="src">{t.src}</span>
            </div>
            <div className="row">
              <div className="value">{t.value}</div>
              {t.spark && t.spark.length > 1 && <Sparkline data={t.spark} color="#22c55e" />}
            </div>
            {t.delta !== undefined && t.delta !== null && (
              <Delta value={t.delta} pct={t.pct ?? undefined} />
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Movers ──────────────────────────────────────────────────────────
function MoversAndSignals({ d }: { d: V2Overview }) {
  const followerMovers = useMemo(
    () => [...d.ig].filter((r) => r.delta != null).sort((a, b) => (b.delta || 0) - (a.delta || 0)).slice(0, 6),
    [d.ig],
  )
  const engRanked = useMemo(
    () => [...d.ig].filter((r) => r.followers >= 50).sort((a, b) => b.engRate - a.engRate).slice(0, 6),
    [d.ig],
  )
  return (
    <section id="movers">
      <div className="section-head">
        <div>
          <h2>
            Movers
            <SectionInfo
              title="Week-on-week movers"
              description="Left: who gained/lost the most followers this week vs. last. Right: who converts followers into engagement most efficiently. Higher engagement rate = better content quality signal."
              source="ig_profiles_weekly (two consecutive weekly snapshots)"
            />
          </h2>
          <div className="sub">Who's gaining and who's converting.</div>
        </div>
      </div>
      <div className="movers">
        <div className="card">
          <div className="card-head"><h3>Followers — week-on-week</h3></div>
          <div className="card-pad">
            {followerMovers.length === 0 ? (
              <div style={{ color: '#8a93a4', fontSize: 12 }}>Need two snapshots to compute deltas.</div>
            ) : followerMovers.map((m, i) => (
              <div key={m.brand} className={'mover-row ' + (m.brand === 'joola' ? 'joola' : '')}>
                <div className="rank">{(i + 1).toString().padStart(2, '0')}</div>
                <div className="brand">
                  <span className="brand-dot" style={{ background: brandColor(d, m.brand) }} />
                  <span className="name">{cap(m.brand)}</span>
                </div>
                <div className="value">{fmt(m.followers)}</div>
                <div className={'delta ' + ((m.delta || 0) >= 0 ? 'up' : 'down')}>
                  {(m.delta || 0) >= 0 ? '▲' : '▼'} {fmt(Math.abs(m.delta || 0))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Engagement rate — ranking</h3></div>
          <div className="card-pad">
            {engRanked.map((m, i) => (
              <div key={m.brand} className={'mover-row ' + (m.brand === 'joola' ? 'joola' : '')}>
                <div className="rank">{(i + 1).toString().padStart(2, '0')}</div>
                <div className="brand">
                  <span className="brand-dot" style={{ background: brandColor(d, m.brand) }} />
                  <span className="name">{cap(m.brand)}</span>
                </div>
                <div className="value">{m.engRate.toFixed(2)}%</div>
                <div className="metric">{fmt(m.followers)} foll</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Engagement matrix ───────────────────────────────────────────────
function EngagementMatrix({ d }: { d: V2Overview }) {
  const points = useMemo(
    () => d.ig.map((r) => ({
      brand: r.brand, name: cap(r.brand), followers: r.followers,
      engRate: r.engRate, color: brandColor(d, r.brand), posts: 30,
    })).filter((p) => p.followers >= 50),
    [d],
  )
  return (
    <section id="matrix">
      <div className="section-head">
        <div>
          <h2>
            Engagement matrix
            <SectionInfo
              title="Reach × engagement"
              description="X-axis = total followers (reach). Y-axis = engagement rate (resonance). Brands in the top-right quadrant have both: large audience AND high engagement per post. That's the winning position."
              source="ig_profiles_weekly, ig_posts"
            />
          </h2>
          <div className="sub">Reach × engagement rate. Bubble size ≈ posts cadence.</div>
        </div>
      </div>
      <div className="card card-pad-lg">
        <ScatterChart data={points} />
      </div>
    </section>
  )
}

// ─── Ads section ─────────────────────────────────────────────────────
function AdsSection({ d }: { d: V2Overview }) {
  const totalAds = d.ads.reduce((s, a) => s + a.total, 0)
  const totalMeta = d.ads.reduce((s, a) => s + a.meta, 0)
  const donutData = d.ads.filter((a) => a.total > 0).slice(0, 6).map((a) => ({ name: cap(a.brand), value: a.total, color: brandColor(d, a.brand) }))
  return (
    <section id="ads">
      <div className="section-head">
        <div>
          <h2>
            Ads &amp; spend
            <SectionInfo
              title="Paid media tracker"
              description="Total ad creatives (Meta + Google) per brand. 'Share of voice' = this brand's ads as a % of all tracked ads. More ads = bigger spend commitment. Active = currently running creatives."
              source="marketing_ads table — scraped from Meta Ads Library + Google Ads"
            />
          </h2>
          <div className="sub">Where the market's putting paid media. Active campaigns only.</div>
        </div>
        <div className="actions"><a href="/v2/ads" className="section-link">Open ads library →</a></div>
      </div>
      <div className="two-col">
        <div className="card card-pad">
          <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em', color: '#cbd1dc', margin: 0, marginBottom: 12 }}>
            Total ads · share of voice
          </h3>
          {d.ads.slice(0, 8).map((a) => {
            const isJ = a.brand === 'joola'
            return (
              <div key={a.brand} className={'bar-row ' + (isJ ? 'joola' : '')}>
                <div className="lbl">{cap(a.brand)}</div>
                <div className="track">
                  <div className="fill" style={{ width: Math.max(2, (a.total / (d.ads[0]?.total || 1)) * 100) + '%', background: brandColor(d, a.brand) }} />
                </div>
                <div className="spark-mini" style={{ fontWeight: 700, textAlign: 'right' }}>{a.total}</div>
                <div className="delta-mini flat">{a.share.toFixed(1)}% · M:{a.meta}/G:{a.google}</div>
              </div>
            )
          })}
        </div>
        <div className="card card-pad-lg" style={{ display: 'grid', placeItems: 'center', gap: 14 }}>
          <Donut data={donutData} centerLabel={fmt(totalAds)} centerSub="active ads" />
          <div className="legend">
            {donutData.map((s) => (
              <div key={s.name} className="item">
                <span className="swatch" style={{ background: s.color }} />{s.name}
              </div>
            ))}
          </div>
          <div style={{ color: '#8a93a4', fontSize: 11, fontFamily: 'JetBrains Mono' }}>
            Meta: {totalMeta} · Google: {totalAds - totalMeta}
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Promos section ──────────────────────────────────────────────────
function PromosSection({ d }: { d: V2Overview }) {
  const promoLeader = d.promos[0]
  const joola = d.promos.find((p) => p.brand === 'joola')
  return (
    <section id="promos">
      <div className="section-head">
        <div>
          <h2>
            Pricing war
            <SectionInfo
              title="Promotion & discount tracker"
              description="Active promotional campaigns detected on brand websites (e.g. 'Save 20%', 'Free shipping', 'Bundle deals'). Brands with more promos are more visible on price-sensitive searches and marketplaces."
              source="promotions table — scraped weekly from brand websites via Playwright"
            />
          </h2>
          <div className="sub">Who's discounting and how much shelf attention they're capturing.</div>
        </div>
        <div className="actions"><a href="/v2/promotions" className="section-link">Open promo log →</a></div>
      </div>
      {promoLeader && joola && joola.count === 0 && (
        <div className="price-war">
          <div className="icn">!</div>
          <div>
            <h4>JOOLA is the only top-3 brand with zero active promos.</h4>
            <p>{cap(promoLeader.brand)} owns {promoLeader.pct.toFixed(1)}% of the visible discount layer with {promoLeader.count} active promos. JOOLA cedes share-of-voice on every price-sensitive query.</p>
          </div>
          <div className="stat">{promoLeader.count}<span className="sub">{cap(promoLeader.brand)} active</span></div>
        </div>
      )}
      <div className="card card-pad">
        {d.promos.filter((p) => p.count > 0).map((p) => {
          const isJ = p.brand === 'joola'
          const maxCount = d.promos[0]?.count || 1
          return (
            <div key={p.brand} className={'bar-row ' + (isJ ? 'joola' : '')}>
              <div className="lbl">{cap(p.brand)}</div>
              <div className="track">
                <div className="fill" style={{ width: Math.max(2, (p.count / maxCount) * 100) + '%', background: brandColor(d, p.brand) }} />
              </div>
              <div className="spark-mini" style={{ fontWeight: 700, textAlign: 'right' }}>{p.count}</div>
              <div className="delta-mini flat">{p.pct.toFixed(1)}% · {p.types.slice(0, 2).join(', ') || '—'}</div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ─── Community ───────────────────────────────────────────────────────
function CommunitySection({ d }: { d: V2Overview }) {
  const rd = d.reddit.map((r) => ({
    brand: r.brand, name: cap(r.brand),
    positive: r.positive, neutral: r.neutral, negative: r.negative,
    mentions: r.mentions, delta: r.delta,
  }))
  const sentimentMissing = rd.length > 0 && rd.every((r) => r.positive === 0 && r.negative === 0)
  return (
    <section id="reddit">
      <div className="section-head">
        <div>
          <h2>
            Community
            <SectionInfo
              title="Reddit mention tracker"
              description="How much each brand gets talked about in r/pickleball and related subreddits. Bars show sentiment split: green = positive posts, gray = neutral, red = negative. More mentions = stronger community presence."
              source="reddit_mentions table — scraped from Reddit via trudax/reddit-scraper-lite"
            />
          </h2>
          <div className="sub">Reddit mention volume by brand + sentiment split.</div>
        </div>
        <div className="actions"><a href="/v2/reddit" className="section-link">Open community →</a></div>
      </div>
      {sentimentMissing && (
        <div style={{
          fontSize: 11, color: '#cbd1dc', background: 'rgba(245,230,37,0.06)',
          border: '1px solid rgba(245,230,37,0.2)', borderRadius: 6,
          padding: '8px 12px', marginBottom: 12,
        }}>
          ⚠ Sentiment classifier in calibration — bars currently render as 100% neutral. Mention volume is accurate.
        </div>
      )}
      <div className="card card-pad">
        {rd.length === 0 ? (
          <div style={{ color: '#8a93a4', fontSize: 12 }}>No reddit data yet.</div>
        ) : <SentimentBar data={rd} />}
      </div>
    </section>
  )
}

// ─── Influencers ─────────────────────────────────────────────────────
function InfluencersSection({ d }: { d: V2Overview }) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [colFilter, setColFilter] = useState<Record<string, string>>({})

  function toggle(key: string) {
    if (sortKey === key) setSortDir(s => s === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  // Bump to 200 rows (standardization)
  const allRows = d.influencers.slice(0, 200).map(i => ({ ...i, brandName: cap(i.brand) }))
  const filtered = allRows.filter(r => {
    const rec = r as unknown as Record<string, unknown>
    return Object.entries(colFilter).every(([col, q]) => {
      if (!q) return true
      const cell = col === 'brand' ? r.brandName : String(rec[col] ?? '')
      return cell.toLowerCase().includes(q.toLowerCase())
    })
  })
  const sorted = sortKey ? [...filtered].sort((a, b) => {
    const av = (a as Record<string, unknown>)[sortKey]
    const bv = (b as Record<string, unknown>)[sortKey]
    if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av
    return sortDir === 'asc' ? String(av ?? '').localeCompare(String(bv ?? '')) : String(bv ?? '').localeCompare(String(av ?? ''))
  }) : filtered

  return (
    <section id="influencers">
      <div className="section-head">
        <div>
          <h2>
            Influencers
            <SectionInfo
              title="Athlete engagement leaders"
              description="Top athletes ranked by engagement rate — (likes + comments) ÷ followers. Engagement rate is a better ROI signal than follower count alone: a smaller athlete with 8% engagement beats a mega-influencer at 0.5%."
              source="influencers, influencer_posts, influencer_snapshots tables"
            />
          </h2>
          <div className="sub">
            Showing <strong style={{ color: 'var(--fg)' }}>{sorted.length}</strong> of up to 200 · click column headers to sort.
          </div>
        </div>
        <div className="actions"><a href="/v2/influencers" className="section-link">Open network →</a></div>
      </div>
      <div className="card">
        {sorted.length > 0 ? (
          <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
            <table className="data">
              <thead style={{ position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)', zIndex: 2 }}>
                <tr>
                  <SortTh col="name" label="Athlete" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
                  <SortTh col="brand" label="Brand" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
                  <SortTh col="followers" label="Followers" sortKey={sortKey} sortDir={sortDir} toggle={toggle} style={{ textAlign: 'right' }} />
                  <SortTh col="posts" label="Posts" sortKey={sortKey} sortDir={sortDir} toggle={toggle} style={{ textAlign: 'right' }} />
                  <SortTh col="avgLikes" label="Avg Likes" sortKey={sortKey} sortDir={sortDir} toggle={toggle} style={{ textAlign: 'right' }} />
                  <SortTh col="engRate" label="Eng Rate" sortKey={sortKey} sortDir={sortDir} toggle={toggle} style={{ textAlign: 'right' }} />
                </tr>
                <tr className="col-filter-row">
                  <th><ColumnFilter col="name" value={colFilter.name} onChange={v => setColFilter(p => ({ ...p, name: v }))} placeholder="athlete…" /></th>
                  <th><ColumnFilter col="brand" value={colFilter.brand} onChange={v => setColFilter(p => ({ ...p, brand: v }))} placeholder="brand…" /></th>
                  <th colSpan={4} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((i, idx) => (
                  <tr key={idx} className={i.brand === 'joola' ? 'joola' : ''}>
                    <td>
                      <div className="athlete-row">
                        <span className="athlete-avatar">{i.init}</span>
                        <span>{i.name}</span>
                      </div>
                    </td>
                    <td>
                      <span className="brand-dot" style={{ background: brandColor(d, i.brand), display: 'inline-block', marginRight: 6 }} />
                      {i.brandName}
                    </td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(i.followers)}</td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{i.posts}</td>
                    <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(i.avgLikes)}</td>
                    <td className="cell-num" style={{ textAlign: 'right', color: i.engRate > 5 ? '#22c55e' : i.engRate > 1 ? '#F5E625' : '#cbd1dc' }}>
                      {i.engRate.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>No rows found for the selected filters.</div>
        )}
      </div>
    </section>
  )
}

// ─── Products ────────────────────────────────────────────────────────
function ProductsSection({ d }: { d: V2Overview }) {
  const boxData = d.products.slice(0, 10).map((p) => ({
    brand: p.brand, name: cap(p.brand), color: brandColor(d, p.brand),
    min: p.min, med: p.med, max: p.max, avg: p.avg, count: p.count,
  }))
  return (
    <section id="products">
      <div className="section-head">
        <div>
          <h2>
            Catalog
            <SectionInfo
              title="Price distribution per brand"
              description="For each brand, the horizontal bar shows min price (left whisker), median (center line), average ±15% (box), and max (right whisker). Use this to spot if JOOLA is in premium, mid-tier, or value territory vs. competitors."
              source="products table — scraped from brand e-commerce sites"
            />
          </h2>
          <div className="sub">Price distribution per brand. Whiskers = min/max, box = ±15% of avg, line = median.</div>
        </div>
        <div className="actions"><a href="/v2/products" className="section-link">Open catalog →</a></div>
      </div>
      <div className="card card-pad-lg">
        <BoxPlot data={boxData} />
      </div>
    </section>
  )
}

// ─── Opportunities ────────────────────────────────────────────────────
function Opportunities({ d }: { d: V2Overview }) {
  const [assigned, setAssigned] = useState<Set<number>>(new Set())

  const cards = useMemo(() => {
    const out: { tag: string; color: string; title: string; body: string; why: string; href: string }[] = []
    const joolaIG = d.ig.find((r) => r.brand === 'joola')
    const joolaPromos = d.promos.find((p) => p.brand === 'joola')?.count || 0
    const promoLeader = d.promos[0]
    if (joolaPromos === 0 && promoLeader) {
      out.push({
        tag: 'Pricing', color: '#F5E625',
        title: `Launch a Memorial Day promo to match ${cap(promoLeader.brand)}.`,
        body: `${cap(promoLeader.brand)} runs ${promoLeader.count} active promos (${promoLeader.pct.toFixed(1)}% of tracked). JOOLA: 0. Match the cadence or cede share.`,
        why: `0 of ${d.promos.reduce((s, p) => s + p.count, 0)} active promos · ${cap(promoLeader.brand)} owns ${promoLeader.pct.toFixed(1)}%`,
        href: '/v2/promotions',
      })
    }
    if (joolaIG) {
      const beating = d.ig.filter((r) => r.brand !== 'joola' && r.followers >= 50 && r.followers < joolaIG.followers && r.engRate > joolaIG.engRate).sort((a, b) => b.engRate - a.engRate)
      if (beating.length > 0) {
        const leader = beating[0]
        out.push({
          tag: 'Content', color: '#22c55e',
          title: `Study ${cap(leader.brand)}'s content — they convert 1 follower into ${(leader.engRate / Math.max(0.001, joolaIG.engRate)).toFixed(1)}× the engagement.`,
          body: `Engagement rate ${leader.engRate.toFixed(2)}% on ${fmt(leader.followers)} followers vs. JOOLA ${joolaIG.engRate.toFixed(2)}% on ${fmt(joolaIG.followers)}.`,
          why: `${cap(leader.brand)} ${leader.engRate.toFixed(2)}% · JOOLA ${joolaIG.engRate.toFixed(2)}%`,
          href: '/v2/instagram',
        })
      }
    }
    const topInfluencer = d.influencers.find((i) => i.brand !== 'joola' && i.engRate >= 5)
    if (topInfluencer) {
      out.push({
        tag: 'Influencer', color: '#818cf8',
        title: `Watch ${topInfluencer.name} (${topInfluencer.engRate.toFixed(1)}% eng) — ${cap(topInfluencer.brand)} signed.`,
        body: `${fmt(topInfluencer.followers)} followers and engagement rate beating ${d.influencers.filter((x) => x.engRate < topInfluencer.engRate).length} other tracked athletes.`,
        why: `${topInfluencer.engRate.toFixed(2)}% eng rate · sub-tier cost`,
        href: '/v2/influencers',
      })
    }
    const topAd = d.ads.find((a) => a.brand !== 'joola' && a.active > 50)
    if (topAd) {
      out.push({
        tag: 'Watch', color: '#06b6d4',
        title: `${cap(topAd.brand)} runs ${topAd.active} active campaigns — biggest ad presence.`,
        body: `Meta: ${topAd.meta} · Google: ${topAd.google}. Pulling ${topAd.share.toFixed(0)}% of tracked ad share.`,
        why: `${topAd.total} ads · ${topAd.share.toFixed(0)}% share`,
        href: '/v2/ads',
      })
    }
    return out.slice(0, 6)
  }, [d])

  return (
    <section id="opps">
      <div className="section-head">
        <div>
          <h2>
            Strategic opportunities
            <SectionInfo
              title="Data-driven action items"
              description="Each card is auto-generated from a data gap or competitive signal. Numbered in priority order. 'Assign' marks an item as in-progress. 'Open Playbook' navigates to the relevant data page for deeper analysis."
              source="All tables — logic runs on latest ig, ads, promotions, influencer data"
            />
          </h2>
          <div className="sub">Actions ranked by leverage. Each derived from this week's data.</div>
        </div>
        <div className="actions">
          <button className="btn btn-yellow" onClick={() => setAssigned(new Set(cards.map((_, i) => i)))}>Assign all →</button>
        </div>
      </div>
      <div className="opps">
        {cards.map((c, i) => (
          <div key={i} className="opp-card fade-up" style={{ opacity: assigned.has(i) ? 0.45 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div className="num">{String(i + 1).padStart(2, '0')}</div>
              <span className="pill" style={{ background: c.color + '20', color: c.color, border: '1px solid ' + c.color + '44' }}>{c.tag}</span>
            </div>
            <h4>{c.title}</h4>
            <p>{c.body}</p>
            <div className="why">▸ {c.why}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <a href={c.href} className="cta">Open playbook →</a>
              <span
                className={'pill ' + (assigned.has(i) ? 'pill-green' : 'pill-ghost')}
                style={{ cursor: 'pointer', transition: 'all 200ms ease' }}
                onClick={() => setAssigned((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })}
              >
                {assigned.has(i) ? '✓ Assigned' : 'Assign →'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────
function cap(s: string) { return displayBrandName(s, s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())) }
function truncate(s: string, n: number) { return s.length > n ? s.slice(0, n) + '…' : s }
function brandColor(d: V2Overview, brandId: string): string { return d.brands.find((b) => b.id === brandId)?.color || '#888' }

// ─── Root page ───────────────────────────────────────────────────────
export default function V2OverviewPage() {
  const [data, setData] = useState<V2Overview | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()

  useEffect(() => {
    fetchOverview().then((d) => {
      setData(d)
      setAllBrands(d.brands)
    }).catch((err) => {
      console.error('Overview fetch failed', err)
      setFetchError('Unable to load data. Please refresh the page.')
    })
  }, [setAllBrands])

  useEffect(() => { document.title = 'JOOLA INTEL — Executive Briefing' }, [])

  if (!data && !fetchError) {
    return (
      <div style={{ padding: '120px 0', textAlign: 'center', color: '#cbd1dc' }}>
        <div style={{ width: 32, height: 32, borderRadius: 999, border: '2px solid #F5E625', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
        <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase' }}>Loading executive briefing…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }
  if (fetchError) {
    return (
      <div style={{ padding: '80px 32px', textAlign: 'center' }}>
        <div style={{ color: '#ef4444', fontSize: 14, marginBottom: 16 }}>{fetchError}</div>
        <button className="btn btn-yellow" onClick={() => window.location.reload()}>Refresh page</button>
      </div>
    )
  }

  const raw = data!
  const d: V2Overview = isFiltered ? {
    ...raw,
    ig: applyBrandFilter(raw.ig, filteredBrands, isFiltered),
    ads: applyBrandFilter(raw.ads, filteredBrands, isFiltered),
    promos: applyBrandFilter(raw.promos, filteredBrands, isFiltered),
    products: applyBrandFilter(raw.products, filteredBrands, isFiltered),
    yt: applyBrandFilter(raw.yt, filteredBrands, isFiltered),
    reddit: applyBrandFilter(raw.reddit, filteredBrands, isFiltered),
    influencers: applyBrandFilter(raw.influencers, filteredBrands, isFiltered),
    adSample: applyBrandFilter(raw.adSample, filteredBrands, isFiltered),
    topIGPosts: applyBrandFilter(raw.topIGPosts, filteredBrands, isFiltered),
    topYTVideos: applyBrandFilter(raw.topYTVideos, filteredBrands, isFiltered),
    topComments: applyBrandFilter(raw.topComments, filteredBrands, isFiltered),
  } : raw

  return (
    <>
      <PageHeader />
      <SectionNav />
      <FilterBanner />
      <Briefing d={d} />
      <KpiStrip d={d} />
      <MoversAndSignals d={d} />
      <EngagementMatrix d={d} />
      <AdsSection d={d} />
      <PromosSection d={d} />
      <CommunitySection d={d} />
      <InfluencersSection d={d} />
      <ProductsSection d={d} />
      <Opportunities d={d} />
    </>
  )
}
