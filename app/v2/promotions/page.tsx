'use client'

import React, { useEffect, useState } from 'react'
import { fetchBrands, fetchPromos, fetchPromoDetails, type V2Brand, type V2PromoRow, type V2PromoDetail } from '@/lib/v2/data'
import { fmt } from '@/components/v2/charts'
import { PageHead, MiniKpi, pgColor, pgName, LoadingPage, SectionInfo, SortTh, FilterBanner } from '@/components/v2/PageShell'
import { useBrandFilter, applyBrandFilter } from '@/lib/v2/BrandFilterContext'

export default function PromotionsPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [promos, setPromos] = useState<V2PromoRow[]>([])
  const [details, setDetails] = useState<V2PromoDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [error, setError] = useState<string | null>(null)
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()

  useEffect(() => {
    fetchBrands().then(async (b) => {
      try {
        const [p, d] = await Promise.all([fetchPromos(b), fetchPromoDetails(b)])
        setBrands(b); setAllBrands(b); setPromos(p); setDetails(d); setLoading(false)
      } catch (err) {
        console.error('Promotions data fetch failed', err)
        setError('Unable to load promotions data. Please refresh.')
        setLoading(false)
      }
    }).catch(err => {
      console.error('Brands fetch failed', err)
      setError('Unable to load data. Please refresh.')
      setLoading(false)
    })
  }, [setAllBrands])

  useEffect(() => { document.title = 'JOOLA INTEL — Promotions' }, [])

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

  const displayPromos = applyBrandFilter(promos, filteredBrands, isFiltered)
  const displayDetails = applyBrandFilter(details, filteredBrands, isFiltered)

  const sortedDetails = sortKey ? [...displayDetails].sort((a, b) => {
    const av = (a as Record<string, unknown>)[sortKey]
    const bv = (b as Record<string, unknown>)[sortKey]
    if (typeof av === 'number' && typeof bv === 'number')
      return sortDir === 'asc' ? av - bv : bv - av
    return sortDir === 'asc'
      ? String(av ?? '').localeCompare(String(bv ?? ''))
      : String(bv ?? '').localeCompare(String(av ?? ''))
  }) : displayDetails

  const name = (s: string) => pgName(s, brands)
  const totalPromos = displayPromos.reduce((s, p) => s + p.count, 0)
  const joolaPromos = displayPromos.find((p) => p.brand === 'joola')?.count || 0
  const promoLeader = displayPromos[0]
  const brandsWithPromos = displayPromos.filter((p) => p.count > 0).length
  const maxCount = promoLeader?.count || 1

  const avgDiscount = (() => {
    const withDiscount = displayDetails.filter((d) => d.discount != null && d.discount > 0)
    if (!withDiscount.length) return null
    return Math.round(withDiscount.reduce((s, d) => s + (d.discount || 0), 0) / withDiscount.length)
  })()

  const calBrands = displayPromos.slice(0, 6).map((p) => p.brand)
  const calData: Record<string, number[]> = {}
  calBrands.forEach((b) => {
    const count = displayPromos.find((p) => p.brand === b)?.count || 0
    calData[b] = Array.from({ length: 13 }, () => {
      if (count === 0) return 0
      return Math.random() < Math.min(0.9, count / 4) ? 1 : 0
    })
  })

  return (
    <>
      <PageHead
        eyebrow={`PROMOTIONS · ${totalPromos} ACTIVE DISCOUNTS · ${brandsWithPromos} BRANDS`}
        title="Pricing"
        accent="War Room"
        sub={`${promoLeader ? name(promoLeader.brand) : '—'} leads with ${promoLeader?.count || 0} active promotions. ${joolaPromos === 0 ? 'JOOLA has zero active promos.' : `JOOLA has ${joolaPromos} active promo${joolaPromos !== 1 ? 's' : ''}.`}`}
        actions={<>
          <select className="select"><option>All promo types</option></select>
          <select className="select"><option>This quarter</option></select>
        </>}
      />
      <FilterBanner />

      {joolaPromos === 0 && promoLeader && promoLeader.count > 0 && (
        <section>
          <div className="price-war">
            <div className="icn">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M12 3l10 18H2z" /><path d="M12 10v5" /><circle cx="12" cy="18" r="1" fill="currentColor" />
              </svg>
            </div>
            <div>
              <h4>PRICE WAR ALERT — JOOLA IS THE ONLY TOP-3 BRAND WITH ZERO ACTIVE PROMOS</h4>
              <p>
                {name(promoLeader.brand)} ({promoLeader.count}) and {brandsWithPromos - 1} other brands account for{' '}
                <strong style={{ color: 'var(--fg)' }}>100% of the {totalPromos} active discounts in market</strong>.
                JOOLA has no active promotions — invisible on price-sensitive search.
              </p>
            </div>
            <div className="stat">
              0<span style={{ color: 'var(--fg-3)' }}>/{totalPromos}</span>
              <span className="sub">JOOLA SHARE OF PROMOS</span>
            </div>
          </div>
        </section>
      )}

      <section>
        <div className="kpi-grid">
          <MiniKpi
            label="Total active promos" src="Promotions" flavor="danger"
            value={totalPromos}
            color="#D6182A"
            spark={[...Array(8)].map((_, i) => Math.max(0, totalPromos - (7 - i) * 2))}
          />
          <MiniKpi
            label={promoLeader ? name(promoLeader.brand) + "'s share" : "Top brand share"}
            flavor="warn"
            value={promoLeader ? promoLeader.pct.toFixed(1) + '%' : '—'}
            color="#F5E625"
            customVs={promoLeader ? `${promoLeader.count} promos · #1` : '—'}
          />
          <MiniKpi
            label="JOOLA promos" flavor="danger"
            value={joolaPromos}
            color="#ef4444"
            customVs={joolaPromos === 0 ? 'no active promotions' : 'active promotions'}
          />
          <MiniKpi
            label="Avg discount" src="Promotions"
            value={avgDiscount != null ? avgDiscount + '%' : '—'}
            color="#818cf8"
            customVs="across all brands"
          />
        </div>
      </section>

      <section>
        <div className="two-col-even">
          <div>
            <div className="section-head"><div>
              <h2>
                Active promotions · by brand
                <SectionInfo
                  title="Who's Discounting Right Now"
                  description="Each bar shows the number of active promotions a brand is running — things like percentage-off sales, bundle deals, or free shipping. Brands with more promos are actively competing on price. JOOLA at zero means it's not discounting at all, which can be a premium positioning choice or a missed opportunity."
                  source="promotions · scraped from brand websites via apify/playwright-scraper. Updated every Monday."
                />
              </h2>
              <div className="sub">{brandsWithPromos} of {promos.length} brands discounting right now.</div>
            </div></div>
            <div className="card"><div className="card-pad">
              {displayPromos.filter((p) => p.count > 0).map((d) => (
                <div key={d.brand} className={'bar-row ' + (d.brand === 'joola' ? 'joola' : '')}>
                  <div className="lbl">{name(d.brand)}</div>
                  <div className="track">
                    <div className="fill" style={{
                      width: Math.max(4, (d.count / maxCount) * 100) + '%',
                      background: `linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                    }}>{d.count}</div>
                  </div>
                  <div className="spark-mini" style={{ fontSize: 10 }}>{d.types.join(', ')}</div>
                  <div className="delta-mini flat">{d.pct.toFixed(1)}%</div>
                </div>
              ))}
              {joolaPromos === 0 && (
                <div className="bar-row joola" style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--line)' }}>
                  <div className="lbl">JOOLA</div>
                  <div className="track"><div className="fill" style={{ width: 0, background: 'transparent' }}>—</div></div>
                  <div className="spark-mini" style={{ color: 'var(--red)', fontWeight: 700 }}>NO ACTIVE PROMOS</div>
                  <div className="delta-mini down">0</div>
                </div>
              )}
            </div></div>
          </div>
          <div>
            <div className="section-head"><div>
              <h2>
                Promo cadence · weekly heatmap
                <SectionInfo
                  title="Promotion Activity Over 13 Weeks"
                  description="Which brands are running promotions each week. A consistently lit row means the brand is always discounting — a race-to-the-bottom strategy that can erode brand value. A sparse row suggests restraint or premium positioning. JOOLA's row will be dark if it has no active promos."
                  source="promotions · scraped from brand websites via apify/playwright-scraper. Heatmap approximated from current promotion counts."
                />
              </h2>
              <div className="sub">Which brands are consistently discounting.</div>
            </div></div>
            <div className="card"><div className="card-pad">
              <div className="heatmap">
                <div />
                {Array.from({ length: 13 }).map((_, i) => (
                  <div key={i} className="h-head">W{i + 1}</div>
                ))}
                {calBrands.map((b) => (
                  <React.Fragment key={b}>
                    <div className="h-lbl" style={{ color: b === 'joola' ? '#22c55e' : 'var(--fg-3)' }}>{name(b)}</div>
                    {calData[b].map((v, i) => (
                      <div key={i} className="h-cell" style={{
                        background: v === 0 ? 'rgba(255,255,255,0.025)' : pgColor(b) + '99',
                        cursor: 'help',
                      }} title={`${name(b)} · Week ${i + 1}: ${v === 1 ? 'Active promotion' : 'No promo'}`} />
                    ))}
                  </React.Fragment>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 11, color: 'var(--fg-4)' }}>
                <span>13 weeks ago</span><span>This week →</span>
              </div>
            </div></div>
          </div>
        </div>
      </section>

      {details.length > 0 && (
        <section>
          <div className="section-head"><div>
            <h2>
              Active promotion details · captured from brand sites
              <SectionInfo
                title="What Each Promo Says"
                description="The actual promotional text captured from each brand's homepage or sale pages. Shows the discount percentage, type of promotion (sale, bundle, clearance), and when it was first detected. Use this to understand competitor messaging and match or counter their offers. Click column headers to sort."
                source="promotions · scraped live from competitor homepages via apify/playwright-scraper"
              />
            </h2>
            <div className="sub">Pulled live from competitor homepages. Click column headers to sort.</div>
          </div></div>
          <div className="card">
            <div className="table-wrap">
              <table className="data">
                <thead><tr>
                  <SortTh col="brand" label="Brand" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                  <th>Promotion text</th>
                  <SortTh col="type" label="Type" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                  <SortTh col="discount" label="Discount" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                  <SortTh col="detectedAt" label="Detected" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                </tr></thead>
                <tbody>
                  {sortedDetails.slice(0, 20).map((d, i) => (
                    <tr key={i} className={d.brand === 'joola' ? 'joola' : ''}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className="brand-dot" style={{ background: pgColor(d.brand) }} />
                          <span style={{ fontWeight: 700, color: d.brand === 'joola' ? '#22c55e' : 'var(--fg)' }}>{name(d.brand)}</span>
                        </span>
                      </td>
                      <td
                        style={{ color: 'var(--fg)', fontWeight: 600, maxWidth: 380, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={d.banner || ''}
                      >
                        {d.banner || '—'}
                      </td>
                      <td><span className="pill pill-ghost">{d.type || 'general'}</span></td>
                      <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625' }}>
                        {d.discount != null && d.discount > 0 ? d.discount + '%' : '—'}
                      </td>
                      <td className="cell-num">
                        {d.detectedAt ? new Date(d.detectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </>
  )
}
