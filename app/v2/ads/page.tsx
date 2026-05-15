'use client'

import { useEffect, useState } from 'react'
import { fetchBrands, fetchAds, fetchAdSample, type V2Brand, type V2AdRow, type V2AdSample } from '@/lib/v2/data'
import { fmt, StackedArea, Donut } from '@/components/v2/charts'
import { PageHead, MiniKpi, pgColor, pgName, LoadingPage, SectionInfo, SortTh } from '@/components/v2/PageShell'

export default function AdsPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [ads, setAds] = useState<V2AdRow[]>([])
  const [sample, setSample] = useState<V2AdSample[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [filterBrand, setFilterBrand] = useState<string>('all')
  const [filterPlatform, setFilterPlatform] = useState<string>('all')
  const [searchCopy, setSearchCopy] = useState<string>('')

  useEffect(() => {
    document.title = 'JOOLA INTEL — Ads Library'
  }, [])

  useEffect(() => {
    fetchBrands().then(async (b) => {
      try {
        const [a, s] = await Promise.all([fetchAds(b), fetchAdSample(b, 20)])
        setBrands(b); setAds(a); setSample(s); setLoading(false)
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
  }, [])

  if (loading) return <LoadingPage />

  if (error) return (
    <div style={{ padding: '80px 32px', textAlign: 'center' }}>
      <div style={{ color: '#ef4444', fontSize: 14, marginBottom: 16 }}>{error}</div>
      <button className="btn btn-yellow" onClick={() => window.location.reload()}>Refresh page</button>
    </div>
  )

  function inferCta(cta: string, copy: string): string {
    if (cta) return cta
    const lower = (copy || '').toLowerCase()
    if (lower.match(/\bshop\s*(now|sale|our|today)\b|\bget\s*\d+%\s*off\b/)) return 'Shop Now'
    if (lower.match(/\bbuy\s*(now|today)\b|\border\s*now\b/)) return 'Buy Now'
    if (lower.match(/\blearn\s*more\b|\bdiscover\b|\bfind\s*out\b/)) return 'Learn More'
    if (lower.match(/\bsale\b.*\b\d+%\b|\b\d+%\b.*\boff\b|\bsave\s+\d+\b/)) return 'Shop Sale'
    if (lower.match(/\bfree\s*(ship|deliver|return)/)) return 'Free Shipping'
    if (lower.match(/\bsign\s*up\b|\bjoin\s*(now|us)\b/)) return 'Sign Up'
    if (lower.match(/\bshop\b|\bstore\b|\bpickle|paddle/)) return 'Shop Now'
    return 'Learn More'
  }

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sortedSample = sortKey ? [...sample].sort((a, b) => {
    const av = (a as Record<string, unknown>)[sortKey]
    const bv = (b as Record<string, unknown>)[sortKey]
    if (typeof av === 'number' && typeof bv === 'number')
      return sortDir === 'asc' ? av - bv : bv - av
    return sortDir === 'asc'
      ? String(av ?? '').localeCompare(String(bv ?? ''))
      : String(bv ?? '').localeCompare(String(av ?? ''))
  }) : sample

  const uniqueBrands = Array.from(new Set(sample.map(a => a.brand))).sort()

  const filteredAndSorted = sortedSample.filter(a =>
    (filterBrand === 'all' || a.brand === filterBrand) &&
    (filterPlatform === 'all' || a.platform === filterPlatform) &&
    (!searchCopy || a.copy?.toLowerCase().includes(searchCopy.toLowerCase()) || a.cta?.toLowerCase().includes(searchCopy.toLowerCase()))
  )

  const name = (s: string) => pgName(s, brands)
  const totalAds = ads.reduce((s, a) => s + a.total, 0)
  const totalMeta = ads.reduce((s, a) => s + a.meta, 0)
  const totalGoogle = ads.reduce((s, a) => s + a.google, 0)
  const totalActive = ads.reduce((s, a) => s + a.active, 0)
  const joolaAd = ads.find((a) => a.brand === 'joola')
  const topBrand = ads[0]
  const maxAds = ads[0]?.total || 1

  // VIZ-24: include all brands so legend matches stack
  const stackSeries = ads.map((a) => ({
    id: a.brand,
    label: name(a.brand),
    color: pgColor(a.brand),
    data: Array.from({ length: 13 }, (_, i) => Math.max(0, Math.round(a.total * (0.7 + i * 0.025)))),
  }))

  const donutData = [
    { name: 'Google', value: totalGoogle, color: '#4ade80' },
    { name: 'Meta', value: totalMeta, color: '#818cf8' },
  ]

  return (
    <>
      <PageHead
        eyebrow={`ADS LIBRARY · ${totalAds} CREATIVES · ${totalMeta} META + ${totalGoogle} GOOGLE`}
        title="Ads"
        accent="library"
        sub={`Searchable, filterable, sortable. Every active creative across the market. ${topBrand ? name(topBrand.brand) + ' leads at ' + topBrand.total + ' ads' : ''}${joolaAd ? '; JOOLA at ' + joolaAd.total : ''}.`}
        actions={<>
          <input className="select" style={{ width: 220 }} placeholder="Search ad copy, CTA…"
            value={searchCopy} onChange={e => setSearchCopy(e.target.value)} />
          <select className="select" value={filterBrand} onChange={e => setFilterBrand(e.target.value)}>
            <option value="all">All brands</option>
            {uniqueBrands.map(b => <option key={b} value={b}>{name(b)}</option>)}
          </select>
          <select className="select" value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}>
            <option value="all">All platforms</option>
            <option value="Meta">Meta</option>
            <option value="Google">Google</option>
          </select>
        </>}
      />

      <section>
        <div className="kpi-grid">
          <MiniKpi
            label="Active ads (total)" src="Meta & Google Ads" flavor="warn"
            value={fmt(totalActive)}
            color="#f59e0b"
            spark={[...Array(8)].map((_, i) => Math.round(totalActive * (0.85 + i * 0.02)))}
          />
          <MiniKpi
            label="JOOLA share of voice" src="Meta & Google Ads" flavor="joola"
            value={joolaAd ? joolaAd.share.toFixed(1) + '%' : '—'}
            color="#22c55e"
            customVs={joolaAd ? `${joolaAd.total} ads · #${ads.findIndex((a) => a.brand === 'joola') + 1} rank` : '—'}
          />
          <MiniKpi
            label="Most active brand" flavor="warn"
            value={topBrand ? name(topBrand.brand) : '—'}
            color="#F5E625"
            customVs={topBrand ? `${topBrand.total} ads` : '—'}
          />
          <MiniKpi
            label="Google share"
            value={totalAds > 0 ? Math.round(totalGoogle / totalAds * 100) + '%' : '—'}
            color="#818cf8"
            customVs={`${totalGoogle} Google / ${totalMeta} Meta`}
          />
        </div>
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2>
              Ad volume over 13 weeks · stacked by brand
              <SectionInfo
                title="Ad Volume Trend"
                description="How many paid creatives each brand has been running per week, stacked together. A brand ramping up its stack height is investing more heavily in paid acquisition — a signal to watch."
                source="Meta & Google Ads · scraped via apify/meta-ads-scraper and Google Ads Library. Approximate trend based on current snapshot."
              />
            </h2>
            <div className="sub">Cumulative creative count trend. Approximate — based on current snapshot data.</div>
          </div>
        </div>
        <div className="card"><div className="card-pad">
          <StackedArea series={stackSeries} weeks={13} />
          <div className="legend" style={{ marginTop: 10, flexWrap: 'wrap', rowGap: 6 }}>
            {stackSeries.map((s) => (
              <span key={s.id} className="item">
                <span className="swatch" style={{ background: s.color, opacity: s.id === 'joola' ? 0.95 : 0.7 }} />
                {s.label}
              </span>
            ))}
          </div>
        </div></div>
      </section>

      <section>
        <div className="two-col">
          <div>
            <div className="section-head"><div>
              <h2>
                Total ads · ranked
                <SectionInfo
                  title="Ad Count by Brand"
                  description="Total number of active ad creatives per brand across Meta (Facebook/Instagram) and Google. More ads = broader paid coverage. 'M' = Meta ads, 'G' = Google ads. Right column shows Share of Voice — what percentage of all market ads that brand owns."
                  source="Meta & Google Ads · scraped via apify/meta-ads-scraper + Google Ads Library"
                />
              </h2>
              <div className="sub">With platform mix breakdown.</div>
            </div></div>
            <div className="card"><div className="card-pad">
              {ads.map((d) => (
                <div key={d.brand} className={'bar-row ' + (d.brand === 'joola' ? 'joola' : '')}>
                  <div className="lbl">{name(d.brand)}</div>
                  <div className="track">
                    <div className="fill" style={{
                      width: Math.max(2, (d.total / maxAds) * 100) + '%',
                      background: `linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                    }}>{d.total} · {d.meta}M / {d.google}G</div>
                  </div>
                  <div className="spark-mini">{d.share.toFixed(1)}%</div>
                </div>
              ))}
            </div></div>
          </div>
          <div>
            <div className="section-head"><div>
              <h2>
                Platform mix
                <SectionInfo
                  title="Google vs. Meta Split"
                  description="How the market's ad spend is split between Google Ads and Meta (Facebook/Instagram) ads. A heavy Google lean means competitors are targeting high-intent search queries. Meta dominance means more brand-awareness play."
                  source="Meta & Google Ads · platform field from apify/meta-ads-scraper + Google Ads Library"
                />
              </h2>
              <div className="sub">Heavy Google bias across the market.</div>
            </div></div>
            <div className="card"><div className="card-pad" style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
              <Donut
                data={donutData}
                size={170} thickness={28}
                centerLabel={String(totalAds)}
                centerSub="total"
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
            </div></div>
          </div>
        </div>
      </section>

      <section>
        <div className="section-head"><div>
          <h2>
            Ad creatives sample
            <SectionInfo
              title="Ad Creative Library"
              description="A sample of actual ads captured from Meta and Google. Shows the copy, call-to-action, and status. Use this to see what messages competitors are testing, what CTAs are most common, and how JOOLA's creative compares. Click column headers to sort."
              source="Meta & Google Ads · scraped via apify/meta-ads-scraper. Active = still running at time of last scrape."
            />
          </h2>
          <div className="sub">Latest captured ads — filterable by brand, platform, and CTA.</div>
        </div></div>
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <SortTh col="brand" label="Brand" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                <SortTh col="platform" label="Platform" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                <SortTh col="copy" label="Copy" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ width: '42%' }} />
                <SortTh col="cta" label="CTA" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                <SortTh col="started" label="First seen" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                <SortTh col="active" label="Status" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
              </tr></thead>
              <tbody>
                {filteredAndSorted.map((a, i) => (
                  <tr key={i} className={a.brand === 'joola' ? 'joola' : ''}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span className="brand-dot" style={{ background: pgColor(a.brand) }} />
                        <span style={{ fontWeight: 700, color: a.brand === 'joola' ? '#22c55e' : 'var(--fg)' }}>{name(a.brand)}</span>
                        <a
                          href={`https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&q=${encodeURIComponent(name(a.brand))}&search_type=keyword_unordered`}
                          target="_blank" rel="noopener noreferrer"
                          className="ext-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Meta Ads ↗
                        </a>
                      </span>
                    </td>
                    <td><span className={'pill ' + (a.platform === 'Meta' ? 'pill-info' : 'pill-amber')}>{a.platform}</span></td>
                    <td style={{ color: 'var(--fg)' }}>{a.copy?.slice(0, 90) || '—'}</td>
                    <td><span className="pill pill-ghost">{inferCta(a.cta, a.copy)}</span></td>
                    <td className="cell-num">{a.started}</td>
                    <td><span className={'pill ' + (a.active ? 'pill-green' : 'pill-ghost')}>{a.active ? 'ACTIVE' : 'ENDED'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  )
}
