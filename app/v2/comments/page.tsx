'use client'

import { useEffect, useState } from 'react'
import {
  fetchBrands, fetchTopComments, fetchCommentCounts,
  type V2Brand, type V2TopComment, type V2CommentCount,
} from '@/lib/v2/data'
import { fmt } from '@/components/v2/charts'
import { PageHead, MiniKpi, pgColor, pgName, LoadingPage, SectionInfo, FilterBanner } from '@/components/v2/PageShell'
import { useBrandFilter, applyBrandFilter } from '@/lib/v2/BrandFilterContext'

export default function CommentsPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [comments, setComments] = useState<V2TopComment[]>([])
  const [counts, setCounts] = useState<V2CommentCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'ig' | 'yt' | 'joola'>('all')
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()

  useEffect(() => {
    document.title = 'JOOLA INTEL — Comments Intel'
  }, [])

  useEffect(() => {
    fetchBrands().then(async (b) => {
      try {
        const [c, cn] = await Promise.all([fetchTopComments(b, 30), fetchCommentCounts(b)])
        setBrands(b); setAllBrands(b); setComments(c); setCounts(cn); setLoading(false)
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

  const displayComments = applyBrandFilter(comments, filteredBrands, isFiltered)
  const displayCounts = applyBrandFilter(counts, filteredBrands, isFiltered)

  const name = (s: string) => pgName(s, brands)
  const joolaCount = displayCounts.find((c) => c.brand === 'joola')
  const totalIG = displayCounts.reduce((s, c) => s + c.ig, 0)
  const totalYT = displayCounts.reduce((s, c) => s + c.yt, 0)
  const maxTotal = displayCounts[0]?.total || 1

  const filtered = displayComments.filter((c) => {
    if (filter === 'ig') return c.platform === 'ig'
    if (filter === 'yt') return c.platform === 'yt'
    if (filter === 'joola') return c.brand === 'joola'
    return true
  })

  return (
    <>
      <PageHead
        eyebrow={`COMMENTS INTEL · ${totalIG} IG · ${totalYT} YT`}
        title="Comments"
        accent="intelligence"
        sub="Real fan voice across Instagram and YouTube. Surface ambassadors, catch product issues, learn what's resonating."
        actions={<>
          <select className="select"><option>IG + YT</option></select>
          <select className="select"><option>All {displayCounts.length} brands</option></select>
        </>}
      />
      <FilterBanner />

      <section>
        <div className="kpi-grid">
          <MiniKpi
            label="JOOLA IG comments" src="Instagram comments" flavor="joola"
            value={joolaCount ? fmt(joolaCount.ig) : '0'}
            color="#22c55e"
            spark={[...Array(8)].map((_, i) => Math.max(0, (joolaCount?.ig || 0) - i * 20))}
          />
          <MiniKpi
            label="Most commented brand" src="Instagram comments"
            value={displayCounts[0] ? name(displayCounts[0].brand) : '—'}
            color="#F5E625"
            customVs={`${displayCounts[0]?.ig || 0} IG comments`}
            flavor="warn"
          />
          <MiniKpi
            label="JOOLA YT comments" src="YouTube comments"
            value={joolaCount ? fmt(joolaCount.yt) : '0'}
            color="#22c55e" flavor="joola"
            customVs={(!joolaCount || joolaCount.yt === 0) ? 'YouTube channel not yet fully tracked' : undefined}
          />
          <MiniKpi
            label="Total comments" src="ig + yt"
            value={fmt(totalIG + totalYT)}
            color="#818cf8"
            customVs={`across ${displayCounts.length} brands`}
          />
        </div>
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2>
              Comments volume by brand
              <SectionInfo
                title="Audience Engagement Volume"
                description="How many comments each brand's content receives across Instagram and YouTube combined. High comment volume signals an active, engaged community — people don't just watch, they respond. Brands with proportionally more comments relative to followers have especially vocal fans."
                source="Instagram comments + YouTube comments · scraped via apify/instagram-profile-scraper and streamers/youtube-scraper"
              />
            </h2>
            <div className="sub">Instagram and YouTube combined. High per-follower comment rate signals audience resonance.</div>
          </div>
        </div>
        <div className="card"><div className="card-pad">
          {displayCounts.map((d) => (
            <div key={d.brand} className={'bar-row ' + (d.brand === 'joola' ? 'joola' : '')} style={{ gridTemplateColumns: '110px 1fr 80px' }}>
              <div className="lbl">{name(d.brand)}</div>
              <div className="track" style={{ display: 'flex' }}>
                {d.ig > 0 && (
                  <div style={{
                    width: (d.ig / maxTotal * 70) + '%',
                    background: 'linear-gradient(90deg, #818cf8, rgba(129,140,248,0.7))',
                    height: '100%',
                    display: 'flex', alignItems: 'center', padding: '0 8px',
                    fontFamily: 'JetBrains Mono', fontSize: 10, color: '#000', fontWeight: 700,
                    minWidth: d.ig > 0 ? 36 : 0,
                  }}>IG {d.ig}</div>
                )}
                {d.yt > 0 && (
                  <div style={{
                    width: (d.yt / maxTotal * 70) + '%',
                    background: 'linear-gradient(90deg, #ef4444, rgba(239,68,68,0.7))',
                    height: '100%',
                    display: 'flex', alignItems: 'center', padding: '0 8px',
                    fontFamily: 'JetBrains Mono', fontSize: 10, color: '#000', fontWeight: 700,
                    minWidth: d.yt > 0 ? 36 : 0,
                  }}>YT {d.yt}</div>
                )}
              </div>
              <div className="spark-mini" style={{ textAlign: 'right' }}>{d.total}</div>
            </div>
          ))}
          <div className="legend" style={{ marginTop: 14 }}>
            <span className="item"><span className="swatch" style={{ background: '#818cf8' }} />Instagram</span>
            <span className="item"><span className="swatch" style={{ background: '#ef4444' }} />YouTube</span>
          </div>
        </div></div>
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2>
              Top comments · all brands
              <SectionInfo
                title="Highest-Liked Fan Comments"
                description="The most-liked comments across all tracked Instagram and YouTube posts — real fan voice, surfaced by the community itself. High-like comments reveal shared opinions, pain points, praise, or product requests. Use this to find ambassadors, flag complaints, and copy what's working."
                source="Instagram comments + YouTube comments · scraped via apify/instagram-profile-scraper and streamers/youtube-scraper. Sentiment tagged by keyword matching."
              />
            </h2>
            <div className="sub">Sorted by likes. Tag ambassadors, flag complaints, copy what's working.</div>
          </div>
          <div className="actions">
            <div className="chip-row">
              <button className={'chip ' + (filter === 'all' ? 'on' : '')} onClick={() => setFilter('all')}>All</button>
              <button className={'chip ' + (filter === 'ig' ? 'on' : '')} onClick={() => setFilter('ig')}>Instagram</button>
              <button className={'chip ' + (filter === 'yt' ? 'on' : '')} onClick={() => setFilter('yt')}>YouTube</button>
              <button className={'chip ' + (filter === 'joola' ? 'on' : '')} onClick={() => setFilter('joola')}>JOOLA only</button>
            </div>
          </div>
        </div>
        <div className="card">
          {filtered.map((c, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: 'auto auto 1fr auto auto',
              gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--line-2)', alignItems: 'center',
            }}>
              <span className={'pill ' + (c.platform === 'ig' ? 'pill-info' : 'pill-red')} style={{ fontFamily: 'JetBrains Mono' }}>
                {c.platform.toUpperCase()}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className="brand-dot" style={{ background: pgColor(c.brand) }} />
                <span style={{ fontWeight: 700, color: c.brand === 'joola' ? '#22c55e' : 'var(--fg)', fontSize: 12 }}>
                  {name(c.brand)}
                </span>
              </span>
              <div>
                <div style={{ fontSize: 13, color: 'var(--fg)', marginBottom: 2 }}>"{c.text?.slice(0, 120) || '—'}"</div>
                <div style={{ fontSize: 10, color: 'var(--fg-4)', fontFamily: 'JetBrains Mono', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <a
                    href={c.platform === 'ig'
                      ? `https://www.instagram.com/${c.user.replace(/^@/, '')}/`
                      : `https://www.youtube.com/@${c.user.replace(/^@/, '')}`}
                    target="_blank" rel="noopener noreferrer"
                    className="cta-link"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {c.user}
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  </a>
                  <span className={'pill ' + (c.platform === 'ig' ? 'pill-info' : 'pill-red')} style={{ fontFamily: 'JetBrains Mono', fontSize: 9, padding: '1px 5px' }}>
                    {c.platform === 'ig' ? 'IG' : 'YT'}
                  </span>
                  · {c.days}d ago
                </div>
              </div>
              <span className={'pill ' + (c.sentiment === 'positive' ? 'pill-green' : c.sentiment === 'negative' ? 'pill-red' : 'pill-ghost')}>
                {c.sentiment}
              </span>
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: 'var(--fg-3)', fontWeight: 600 }}>♥ {c.likes}</span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-4)' }}>No comments found for this filter.</div>
          )}
        </div>
      </section>
    </>
  )
}
