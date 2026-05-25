'use client'

import { useEffect, useState } from 'react'
import {
  fetchBrands, fetchReddit, fetchRedditTrend, fetchRedditSubreddits, fetchTopRedditMentions,
  fetchRedditViral, fetchRedditRemoved, fetchRedditCrisisClusters, fetchRedditReplyVsOp,
  type V2Brand, type V2RedditRow, type V2Subreddit, type V2RedditMention,
  type V2RedditViral, type V2RedditRemoved, type V2RedditCrisisCluster, type V2RedditReplyVsOp,
} from '@/lib/v2/data'
import { fmt, LineChart, SentimentBar } from '@/components/v2/charts'
import { PageHead, MiniKpi, pgColor, pgName, LoadingPage, SectionInfo, SortTh, ColumnFilter, FilterBanner } from '@/components/v2/PageShell'
import { PlatformPlaybook } from '@/components/v2/PlatformPlaybook'
import { redditPlaybook } from '@/lib/v2/playbook'
import { useBrandFilter, applyBrandFilter, applyBrandFilterRecord } from '@/lib/v2/BrandFilterContext'
import { useDateRange, applyDateRange, DATE_RANGE_LABEL } from '@/lib/v2/DateRangeContext'
import { formatCalendarDateFromDaysAgo } from '@/lib/v2/format'

/** Relative caption ("3 days ago") kept only for the title tooltip on date cells. */
function relativeLabel(days: number): string {
  return days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
}

/** Short calendar label for the trend chart x-axis (e.g. "Apr 28"). */
function weekLabel(weeksAgo: number): string {
  const d = new Date(Date.now() - weeksAgo * 7 * 86400000)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function RedditPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [reddit, setReddit] = useState<V2RedditRow[]>([])
  const [trend, setTrend] = useState<Record<string, number[]>>({})
  const [subreddits, setSubreddits] = useState<V2Subreddit[]>([])
  const [mentions, setMentions] = useState<V2RedditMention[]>([])
  const [viral, setViral] = useState<V2RedditViral[]>([])
  const [removed, setRemoved] = useState<V2RedditRemoved[]>([])
  const [crisisClusters, setCrisisClusters] = useState<V2RedditCrisisCluster[]>([])
  const [replyVsOp, setReplyVsOp] = useState<V2RedditReplyVsOp[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [colFilter, setColFilter] = useState<Record<string, string>>({})
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()
  const { range, maxDays } = useDateRange()

  useEffect(() => {
    document.title = 'JOOLA INTEL — Reddit Community'
  }, [])

  useEffect(() => {
    fetchBrands().then(async (b) => {
      try {
        const [r, t, s, m, vi, rm, cc, rv] = await Promise.all([
          fetchReddit(b),
          fetchRedditTrend(b),
          fetchRedditSubreddits(b),
          fetchTopRedditMentions(b, 20),
          fetchRedditViral(b, 20),
          fetchRedditRemoved(b),
          fetchRedditCrisisClusters(b, 20),
          fetchRedditReplyVsOp(b, 120),
        ])
        setBrands(b); setAllBrands(b); setReddit(r); setTrend(t); setSubreddits(s); setMentions(m)
        setViral(vi); setRemoved(rm); setCrisisClusters(cc); setReplyVsOp(rv)
        setLoading(false)
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

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const displayReddit = applyBrandFilter(reddit, filteredBrands, isFiltered)
  const displayTrend = applyBrandFilterRecord(trend, filteredBrands, isFiltered)
  const displayMentionsAll = applyBrandFilter(mentions, filteredBrands, isFiltered)
  const displayMentions = applyDateRange(displayMentionsAll, maxDays)

  const name = (s: string) => pgName(s, brands)
  const joolaR = displayReddit.find((d) => d.brand === 'joola')
  const totalMentions = displayReddit.reduce((s, d) => s + d.mentions, 0)
  const joolaPositivePct = joolaR ? Math.round((joolaR.positive / Math.max(1, joolaR.mentions)) * 100) : 0
  const joolaNegativePct = joolaR ? Math.round((joolaR.negative / Math.max(1, joolaR.mentions)) * 100) : 0
  const netScore = joolaR ? ((joolaR.positive - joolaR.negative) / Math.max(1, joolaR.mentions)).toFixed(2) : '0'
  const allNeutral = joolaR ? (joolaR.positive === 0 && joolaR.negative === 0) : true
  const sentimentMissing = displayReddit.length > 0 && displayReddit.every(r => r.positive === 0 && r.negative === 0)

  const lineSeries = Object.entries(displayTrend)
    .filter(([, data]) => data.some((v) => v > 0))
    .slice(0, 8)
    .map(([id, data]) => ({ id, label: name(id), color: pgColor(id), data }))

  // Build calendar-date x-axis labels: oldest = index 0, most recent = index N-1
  const trendWeeks = lineSeries[0]?.data.length || 8
  const xLabels = Array.from({ length: trendWeeks }, (_, i) => weekLabel(trendWeeks - 1 - i))

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

  // Top subreddit across displayed brands. Subreddit totals are global (not brand-sliced),
  // so we just take the leader of the existing list — accurate when no filter is applied,
  // an acceptable best-effort otherwise.
  const topSubreddit = subreddits[0]
  const maxSubMentions = topSubreddit?.mentions || 1

  // Apply per-column filters to mentions before sorting.
  const filteredMentions = displayMentions.filter(m => {
    const rec = m as unknown as Record<string, unknown>
    return Object.entries(colFilter).every(([col, q]) => {
      if (!q) return true
      const cell = col === 'brand' ? name(m.brand) : String(rec[col] ?? '')
      return cell.toLowerCase().includes(q.toLowerCase())
    })
  })

  const sortedMentions = sortKey ? [...filteredMentions].sort((a, b) => {
    const av = (a as Record<string, unknown>)[sortKey]
    const bv = (b as Record<string, unknown>)[sortKey]
    if (typeof av === 'number' && typeof bv === 'number')
      return sortDir === 'asc' ? av - bv : bv - av
    return sortDir === 'asc'
      ? String(av ?? '').localeCompare(String(bv ?? ''))
      : String(bv ?? '').localeCompare(String(av ?? ''))
  }) : filteredMentions

  return (
    <>
      <PageHead
        eyebrow={`REDDIT · ${totalMentions} MENTIONS · ${subreddits.length} SUBREDDITS`}
        title="Community"
        accent="sentiment"
        sub={`JOOLA's share of voice, sentiment breakdown, and trending discussion across r/pickleball and related communities. Showing ${sortedMentions.length} mentions · ${DATE_RANGE_LABEL[range].toLowerCase()}.`}
        actions={<>
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
            value={allNeutral ? '—' : (parseFloat(netScore) >= 0 ? '+' : '') + netScore}
            color="#22c55e"
            customVs={allNeutral ? 'Sentiment classifier still calibrating — bars render 100% neutral until next enrichment pass' : `${joolaPositivePct}% positive · ${joolaNegativePct}% negative`}
          />
          <MiniKpi
            label="Total mentions" src="Reddit data"
            value={fmt(totalMentions)}
            color="#F5E625"
            customVs={`across ${displayReddit.length} brands`}
          />
          <MiniKpi
            label="Top subreddit" src="distribution"
            value={topSubreddit ? topSubreddit.name : '—'}
            color="#818cf8"
            customVs={topSubreddit ? `${fmt(topSubreddit.mentions)} mentions` : 'No subreddit data'}
          />
        </div>
      </section>

      {sentimentMissing && (
        <section>
          <div style={{
            fontSize: 11, color: '#cbd1dc', background: 'rgba(245,230,37,0.06)',
            border: '1px solid rgba(245,230,37,0.2)', borderRadius: 6,
            padding: '8px 12px',
          }}>
            ⚠ Sentiment classifier in calibration — bars currently render as 100% neutral. Mention volume is accurate.
          </div>
        </section>
      )}

      <section>
        <div className="section-head">
          <div>
            <h2>
              Mention volume
              <SectionInfo
                title="Brand Mention Volume"
                description="How many times each brand was mentioned on Reddit across all tracked subreddits. A brand with many mentions has strong community presence — could mean product launches, controversy, or organic discussion. Tone breakdown is still calibrating."
                source="Reddit data · scraped via trudax/reddit-scraper-lite from r/pickleball and related subreddits"
              />
            </h2>
            <div className="sub">Tone breakdown coming soon — sentiment classifier calibrating.</div>
          </div>
        </div>
        <div className="card"><div className="card-pad">
          <SentimentBar data={sentimentData} />
          <div className="legend" style={{ marginTop: 14 }}>
            <span className="item"><span className="swatch" style={{ background: '#22c55e' }} />Positive</span>
            <span className="item"><span className="swatch" style={{ background: '#94a3b8', opacity: 0.5 }} />Neutral</span>
            <span className="item"><span className="swatch" style={{ background: '#ef4444' }} />Negative</span>
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
                  description="How many times each brand was mentioned per week across all tracked subreddits. X-axis shows the start of each week. A spike means the community was discussing that brand more than usual — product launch, controversy, tournament result, or viral post."
                  source="Reddit data · post timestamps from trudax/reddit-scraper-lite, grouped by ISO week"
                />
              </h2>
              <div className="sub">Weekly mention counts · most recent week on the right.</div>
            </div>
          </div>
          <div className="card"><div className="card-pad">
            <LineChart series={lineSeries} xLabels={xLabels} />
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
              {subreddits.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>No rows found for the selected filters.</div>
              ) : subreddits.map((s, i) => (
                <div key={i} className="bar-row"
                  title={`${s.name}: ${s.mentions} mentions · JOOLA share ${s.joolaShare}%`}
                  style={{ gridTemplateColumns: '180px 1fr 70px 70px' }}>
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
                    }} />
                  </div>
                  <div className="spark-mini" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--fg)' }}>
                    {s.mentions}
                  </div>
                  <div className="delta-mini flat" style={{ textAlign: 'right', color: s.joolaShare > 20 ? '#22c55e' : 'var(--fg-3)' }}>
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
                  source={`Reddit data · scraped via trudax/reddit-scraper-lite · ${DATE_RANGE_LABEL[range].toLowerCase()}`}
                />
              </h2>
              <div className="sub">Ranked by total community discussion volume.</div>
            </div></div>
            <div className="card"><div className="card-pad">
              {displayReddit.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>No rows found for the selected filters.</div>
              ) : displayReddit.slice(0, 10).map((d, i) => {
                const sharePct = Math.round((d.mentions / Math.max(1, displayReddit[0]?.mentions || 1)) * 100)
                const posPct = Math.round((d.positive / Math.max(1, d.mentions)) * 100)
                const negPct = Math.round((d.negative / Math.max(1, d.mentions)) * 100)
                return (
                  <div key={i}
                    className={'trend-row ' + (d.brand === 'joola' ? 'joola' : '')}
                    style={{ cursor: 'pointer' }}
                    title={`${name(d.brand)} · ${d.mentions} mentions · ${posPct}% positive · ${negPct}% negative · ${sharePct}% of #1 · click to filter the mentions table`}
                    onClick={() => {
                      setColFilter(p => ({ ...p, brand: name(d.brand) }))
                      document.getElementById('reddit-mentions-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }}
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

      <section id="reddit-mentions-table">
        <div className="section-head"><div>
          <h2>
            Top {sortedMentions.length} mentions · by score
            <SectionInfo
              title="Top Reddit Mentions"
              description="Up to the 20 highest-scoring Reddit posts that mention the tracked brands. Narrow with the brand filter (top right), the date range (top right), or per-column search below. A high score means the community upvoted that thread — strong organic signal."
              source="reddit_mentions · scraped via trudax/reddit-scraper-lite. Click column headers to sort."
            />
          </h2>
          <div className="sub">
            Showing <strong style={{ color: 'var(--fg)' }}>{sortedMentions.length}</strong> of up to 20 ·
            {' '}sorted by score · {DATE_RANGE_LABEL[range].toLowerCase()} · click column headers to sort.
          </div>
        </div></div>
        <div className="card">
          {sortedMentions.length > 0 ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <SortTh col="brand" label="Brand" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                    <SortTh col="subreddit" label="Subreddit" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                    <SortTh col="title" label="Title" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ width: '40%' }} />
                    <SortTh col="score" label="Score" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                    <SortTh col="comments" label="Comments" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                    <SortTh col="days" label="Posted" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                  </tr>
                  <tr className="col-filter-row">
                    <th><ColumnFilter col="brand" value={colFilter.brand} onChange={v => setColFilter(p => ({ ...p, brand: v }))} placeholder="brand…" /></th>
                    <th><ColumnFilter col="subreddit" value={colFilter.subreddit} onChange={v => setColFilter(p => ({ ...p, subreddit: v }))} placeholder="subreddit…" /></th>
                    <th><ColumnFilter col="title" value={colFilter.title} onChange={v => setColFilter(p => ({ ...p, title: v }))} placeholder="search title…" /></th>
                    <th colSpan={3} />
                  </tr>
                </thead>
                <tbody>
                  {sortedMentions.map((m, i) => {
                    const subLabel = m.subreddit ? (m.subreddit.startsWith('r/') ? m.subreddit : `r/${m.subreddit}`) : '—'
                    return (
                      <tr key={i} className={m.brand === 'joola' ? 'joola' : ''}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="brand-dot" style={{ background: pgColor(m.brand) }} />
                            <span style={{ fontWeight: 700, color: m.brand === 'joola' ? '#22c55e' : 'var(--fg)' }}>{name(m.brand)}</span>
                          </div>
                        </td>
                        <td style={{ fontFamily: 'JetBrains Mono', fontSize: 12, color: 'var(--fg-3)' }}>
                          {subLabel !== '—' ? (
                            <a
                              href={`https://www.reddit.com/${subLabel.replace(/^\//, '')}/`}
                              target="_blank" rel="noopener noreferrer"
                              style={{ color: 'inherit', textDecoration: 'none' }}
                              onClick={e => e.stopPropagation()}
                            >{subLabel}</a>
                          ) : subLabel}
                        </td>
                        <td style={{ color: 'var(--fg)' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                            <span style={{ fontSize: 12 }}>{m.title?.slice(0, 90) || '—'}</span>
                            {m.url && (
                              <a href={m.url} target="_blank" rel="noopener noreferrer" className="ext-link" style={{ marginTop: 1, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                                Open
                                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625' }}>{fmt(m.score)}</td>
                        <td className="cell-num" style={{ textAlign: 'right' }}>{fmt(m.comments)}</td>
                        <td className="cell-num" title={relativeLabel(m.days)}>{formatCalendarDateFromDaysAgo(m.days)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-4)' }}>
              <div style={{ fontSize: 13, marginBottom: 8 }}>No mentions match the current filters.</div>
              <div style={{ fontSize: 11 }}>
                Try widening the date range (top right){displayMentionsAll.length > 0 ? `, expanding the brand filter, or clearing the column search.` : ' or check back after the next weekly refresh.'}
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
