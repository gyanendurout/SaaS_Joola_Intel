'use client'

import { useEffect, useState } from 'react'
import {
  fetchBrands, fetchReddit, fetchRedditTrend, fetchRedditSubreddits,
  type V2Brand, type V2RedditRow, type V2Subreddit,
} from '@/lib/v2/data'
import { fmt, LineChart, SentimentBar } from '@/components/v2/charts'
import { PageHead, MiniKpi, pgColor, pgName, LoadingPage, SectionInfo, FilterBanner } from '@/components/v2/PageShell'
import { useBrandFilter, applyBrandFilter, applyBrandFilterRecord } from '@/lib/v2/BrandFilterContext'

export default function RedditPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [reddit, setReddit] = useState<V2RedditRow[]>([])
  const [trend, setTrend] = useState<Record<string, number[]>>({})
  const [subreddits, setSubreddits] = useState<V2Subreddit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()

  useEffect(() => {
    document.title = 'JOOLA INTEL — Reddit Community'
  }, [])

  useEffect(() => {
    fetchBrands().then(async (b) => {
      try {
        const [r, t, s] = await Promise.all([fetchReddit(b), fetchRedditTrend(b), fetchRedditSubreddits(b)])
        setBrands(b); setAllBrands(b); setReddit(r); setTrend(t); setSubreddits(s); setLoading(false)
      } catch (err) {
        console.error('Data fetch failed', err)
        setError('Unable to load data. Please refresh.')
        setLoading(false)
      }
    }).catch(err => {
      console.error('Brands fetch failed', err)
      setError('Unable to load data. Please refresh.')
      setLoading(false)
    })
  }, [setAllBrands])

  if (loading) return <LoadingPage />

  if (error) return (
    <div style={{ padding: '80px 32px', textAlign: 'center' }}>
      <div style={{ color: '#ef4444', fontSize: 14, marginBottom: 16 }}>{error}</div>
      <button className="btn btn-yellow" onClick={() => window.location.reload()}>Refresh page</button>
    </div>
  )

  const displayReddit = applyBrandFilter(reddit, filteredBrands, isFiltered)
  const displayTrend = applyBrandFilterRecord(trend, filteredBrands, isFiltered)

  const name = (s: string) => pgName(s, brands)
  const joolaR = displayReddit.find((d) => d.brand === 'joola')
  const totalMentions = displayReddit.reduce((s, d) => s + d.mentions, 0)
  const joolaPositivePct = joolaR ? Math.round((joolaR.positive / Math.max(1, joolaR.mentions)) * 100) : 0
  const joolaNegativePct = joolaR ? Math.round((joolaR.negative / Math.max(1, joolaR.mentions)) * 100) : 0
  const netScore = joolaR ? ((joolaR.positive - joolaR.negative) / Math.max(1, joolaR.mentions)).toFixed(2) : '0'
  const allNeutral = joolaR ? (joolaR.positive === 0 && joolaR.negative === 0) : true

  const lineSeries = Object.entries(displayTrend)
    .filter(([, data]) => data.some((v) => v > 0))
    .slice(0, 8)
    .map(([id, data]) => ({ id, label: name(id), color: pgColor(id), data }))

  const sentimentData = displayReddit.map((d) => ({
    brand: d.brand,
    name: name(d.brand),
    color: pgColor(d.brand),
    positive: d.positive,
    neutral: d.neutral,
    negative: d.negative,
    mentions: d.mentions,
    delta: d.delta,
  }))

  const maxSubMentions = subreddits[0]?.mentions || 1

  return (
    <>
      <PageHead
        eyebrow={`REDDIT · ${totalMentions} MENTIONS · ${subreddits.length} SUBREDDITS`}
        title="Community"
        accent="sentiment"
        sub="JOOLA's share of voice, sentiment breakdown, and trending discussion across r/pickleball and related communities."
        actions={<>
          <select className="select"><option>All {displayReddit.length} brands</option></select>
          <select className="select"><option>Last 90 days</option></select>
          <a href="https://www.reddit.com/r/pickleball" target="_blank" rel="noopener noreferrer" className="btn btn-ghost">r/pickleball ↗</a>
        </>}
      />
      <FilterBanner />

      <section>
        <div className="kpi-grid">
          <MiniKpi
            label="JOOLA mentions" src="Reddit data" flavor="joola"
            value={joolaR ? fmt(joolaR.mentions) : '0'}
            color="#22c55e"
            spark={displayTrend['joola'] || []}
            customVs={`#${displayReddit.findIndex((d) => d.brand === 'joola') + 1} of ${displayReddit.length} brands`}
          />
          <MiniKpi
            label="JOOLA sentiment" src="net score" flavor="joola"
            value={allNeutral ? 'N/A' : (parseFloat(netScore) >= 0 ? '+' : '') + netScore}
            color="#22c55e"
            customVs={allNeutral ? 'Sentiment classifier still being calibrated' : `${joolaPositivePct}% positive · ${joolaNegativePct}% negative`}
          />
          <MiniKpi
            label="Total mentions" src="Reddit data"
            value={fmt(totalMentions)}
            color="#F5E625"
            customVs={`across ${displayReddit.length} brands`}
          />
          <MiniKpi
            label="Most mentioned" src="market leader"
            value={name(displayReddit[0]?.brand || 'joola')}
            color="#818cf8"
            customVs={`${displayReddit[0]?.mentions || 0} mentions`}
          />
        </div>
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2>
              Mention volume + sentiment
              <SectionInfo
                title="Brand Mentions with Sentiment Breakdown"
                description="How many times each brand was mentioned on Reddit, broken down by whether those posts were positive (green), neutral (gray), or negative (red). A brand with many positive mentions has strong community advocacy. Note: sentiment is keyword-based — scores of 0% may mean data is still being populated."
                source="Reddit data · scraped via trudax/reddit-scraper-lite from r/pickleball and related subreddits"
              />
            </h2>
            <div className="sub">Stacked by tone. Green = positive, gray = neutral, red = negative.</div>
          </div>
        </div>
        <div className="card"><div className="card-pad">
          <SentimentBar data={sentimentData} />
          <div className="legend" style={{ marginTop: 14 }}>
            <span className="item"><span className="swatch" style={{ background: '#22c55e' }} />Positive</span>
            <span className="item"><span className="swatch" style={{ background: '#94a3b8', opacity: 0.5 }} />Neutral</span>
            <span className="item"><span className="swatch" style={{ background: '#ef4444' }} />Negative</span>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--fg-4)', fontStyle: 'italic' }}>
            Note: sentiment is keyword-based. Zero scores indicate the classifier is still being calibrated for pickleball-specific terminology.
          </div>
        </div></div>
      </section>

      {lineSeries.length > 0 && (
        <section>
          <div className="section-head">
            <div>
              <h2>
                Mention trend · weekly
                <SectionInfo
                  title="Weekly Mention Volume Over Time"
                  description="How many times each brand was mentioned per week across all tracked subreddits. A spike means the community was discussing that brand more than usual — could be a product launch, controversy, tournament result, or viral post."
                  source="Reddit data · post timestamps from trudax/reddit-scraper-lite, grouped by ISO week"
                />
              </h2>
              <div className="sub">Weekly mention counts computed from scraped post timestamps.</div>
            </div>
          </div>
          <div className="card"><div className="card-pad">
            <LineChart series={lineSeries} />
          </div></div>
        </section>
      )}

      <section>
        <div className="two-col">
          <div>
            <div className="section-head"><div>
              <h2>
                Subreddit distribution
                <SectionInfo
                  title="Where the Conversation Happens"
                  description="Which subreddits contain the most brand mentions. r/pickleball is the main hub, but activity also appears in equipment, sports, and regional subreddits. The 'JOOLA %' shows what fraction of that subreddit's mentions are about JOOLA."
                  source="Reddit data · subreddit field scraped via trudax/reddit-scraper-lite"
                />
              </h2>
              <div className="sub">Where the pickleball conversation lives.</div>
            </div></div>
            <div className="card"><div className="card-pad">
              {subreddits.map((s, i) => (
                <div key={i} className="bar-row"
                  title={`${s.name}: ${s.mentions} mentions · JOOLA share ${s.joolaShare}%`}
                  style={{ gridTemplateColumns: '180px 1fr 80px' }}>
                  <div className="lbl" style={{ fontFamily: 'JetBrains Mono', fontSize: 12 }}>
                    <a
                      href={`https://www.reddit.com/${s.name.replace(/^\//, '')}/`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ color: 'inherit', textDecoration: 'none' }}
                    >{s.name}</a>
                  </div>
                  <div className="track">
                    <div className="fill" style={{
                      width: (s.mentions / maxSubMentions * 100) + '%',
                      background: 'linear-gradient(90deg, #F5E625, rgba(245,230,37,0.6))',
                      color: '#000',
                    }}>{s.mentions}</div>
                  </div>
                  <div className="spark-mini" style={{ textAlign: 'right', color: s.joolaShare > 20 ? '#22c55e' : 'var(--fg-3)' }}>
                    JOOLA {s.joolaShare}%
                  </div>
                </div>
              ))}
            </div></div>
          </div>
          <div>
            <div className="section-head"><div>
              <h2>
                Brand mention breakdown
                <SectionInfo
                  title="Community Discussion Share"
                  description="Ranked by total Reddit mentions across all tracked subreddits. The brand at #1 is dominating organic pickleball conversation — which often correlates with product launches, pro player association, or viral posts. The pill shows JOOLA's own brand or competitor sentiment percentage."
                  source="Reddit data · scraped via trudax/reddit-scraper-lite, last 90 days"
                />
              </h2>
              <div className="sub">Ranked by total community discussion volume.</div>
            </div></div>
            <div className="card"><div className="card-pad">
              {displayReddit.slice(0, 10).map((d, i) => {
                const sharePct = Math.round((d.mentions / Math.max(1, displayReddit[0]?.mentions || 1)) * 100)
                const posPct = Math.round((d.positive / Math.max(1, d.mentions)) * 100)
                const negPct = Math.round((d.negative / Math.max(1, d.mentions)) * 100)
                return (
                  <div key={i}
                    className={'trend-row ' + (d.brand === 'joola' ? 'joola' : '')}
                    title={`${name(d.brand)} · ${d.mentions} mentions · ${posPct}% positive · ${negPct}% negative · ${sharePct}% of #1`}
                  >
                    <div className="rank">#{i + 1}</div>
                    <div className="kw" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span>{name(d.brand)}</span>
                      <a
                        href={`https://www.reddit.com/search/?q=${encodeURIComponent(name(d.brand) + ' pickleball')}&sort=top`}
                        target="_blank" rel="noopener noreferrer"
                        className="ext-link"
                        style={{ fontSize: 10 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        Reddit Search
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                      </a>
                    </div>
                    <div className="mtrack">
                      <div className="mfill" style={{
                        width: sharePct + '%',
                        background: `linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                      }} />
                    </div>
                    <div className="mvol">{d.mentions}</div>
                    <div>
                      {d.brand === 'joola'
                        ? <span className="pill pill-green">JOOLA</span>
                        : <span className="pill pill-ghost">{posPct}% pos</span>
                      }
                    </div>
                  </div>
                )
              })}
            </div></div>
          </div>
        </div>
      </section>
    </>
  )
}
