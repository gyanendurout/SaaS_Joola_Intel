'use client'

import { useEffect, useState } from 'react'
import { fetchBrands, fetchProductStats, fetchProductsList, type V2Brand, type V2ProductRow, type V2ProductItem } from '@/lib/v2/data'
import { fmt, BoxPlot, ScatterChart } from '@/components/v2/charts'
import { PageHead, MiniKpi, pgColor, pgName, LoadingPage, SectionInfo, SortTh, FilterBanner } from '@/components/v2/PageShell'
import { useBrandFilter, applyBrandFilter } from '@/lib/v2/BrandFilterContext'

export default function ProductsPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [stats, setStats] = useState<V2ProductRow[]>([])
  const [products, setProducts] = useState<V2ProductItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filterBrand, setFilterBrand] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()

  useEffect(() => {
    fetchBrands().then(async (b) => {
      const [s, p] = await Promise.all([fetchProductStats(b), fetchProductsList(b)])
      setBrands(b); setAllBrands(b); setStats(s); setProducts(p); setLoading(false)
    }).catch(() => setLoading(false))
  }, [setAllBrands])

  useEffect(() => { document.title = 'JOOLA INTEL — Product Catalog' }, [])

  if (loading) return <LoadingPage />

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const displayStats = applyBrandFilter(stats, filteredBrands, isFiltered)
  const displayProductsAll = applyBrandFilter(products, filteredBrands, isFiltered)

  const name = (s: string) => pgName(s, brands)
  const totalProducts = displayStats.reduce((s, p) => s + p.count, 0)
  const joolaStat = displayStats.find((p) => p.brand === 'joola')
  const premiumLeader = [...displayStats].sort((a, b) => b.avg - a.avg)[0]
  const valueLeader = [...displayStats].filter((p) => p.avg > 0).sort((a, b) => a.avg - b.avg)[0]
  const maxCount = displayStats[0]?.count || 1

  const boxData = displayStats.map((p) => ({
    brand: p.brand, name: name(p.brand), color: pgColor(p.brand),
    min: p.min, med: p.med, max: p.max, avg: p.avg, count: p.count,
  }))

  const displayProducts = filterBrand
    ? displayProductsAll.filter((p) => p.brand === filterBrand)
    : displayProductsAll

  const sortedProducts = sortKey ? [...displayProducts].sort((a, b) => {
    const av = (a as Record<string, unknown>)[sortKey]
    const bv = (b as Record<string, unknown>)[sortKey]
    if (typeof av === 'number' && typeof bv === 'number')
      return sortDir === 'asc' ? av - bv : bv - av
    return sortDir === 'asc'
      ? String(av ?? '').localeCompare(String(bv ?? ''))
      : String(bv ?? '').localeCompare(String(av ?? ''))
  }) : displayProducts

  const BRAND_WEBSITES: Record<string, string> = {
    joola: 'https://www.joolausa.com/pickleball-paddles/',
    selkirk: 'https://www.selkirk.com/collections/pickleball-paddles',
    crbn: 'https://crbnpickleball.com/collections/paddles',
    franklin: 'https://www.franklinsports.com/pickleball',
    engage: 'https://engagepickleball.com/collections/all',
    paddletek: 'https://www.paddletek.com/collections/paddles',
    'six-zero': 'https://sixzeropickleball.com/collections/paddles',
    onix: 'https://www.onixsports.com/pickleball',
    wilson: 'https://www.wilson.com/en-us/pickleball',
    gamma: 'https://gammasports.com/pickleball',
    prokennex: 'https://prokennex.com/pickleball',
  }

  return (
    <>
      <PageHead
        eyebrow={`PRODUCT CATALOG · ${totalProducts} PADDLES TRACKED`}
        title="Catalog &"
        accent="pricing"
        sub={`JOOLA has ${joolaStat?.count || 0} paddles. ${premiumLeader ? name(premiumLeader.brand) + ' owns premium ($' + premiumLeader.avg + ' avg)' : ''}. ${valueLeader ? name(valueLeader.brand) + ' is in value territory ($' + valueLeader.avg + ' avg)' : ''}.`}
        actions={<>
          <select className="select" value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)}>
            <option value="">All brands</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className="select"><option>All categories</option></select>
        </>}
      />
      <FilterBanner />

      <section>
        <div className="kpi-grid">
          <MiniKpi
            label="JOOLA catalog" src="products" flavor="joola"
            value={joolaStat?.count || 0}
            color="#22c55e"
            customVs={joolaStat && joolaStat.count === displayStats[0]?.count ? 'largest in market' : `#${displayStats.findIndex(p => p.brand === 'joola') + 1} by catalog size`}
          />
          <MiniKpi
            label="JOOLA avg price" src="products"
            value={joolaStat ? '$' + joolaStat.avg : '—'}
            color="#818cf8"
            customVs={premiumLeader ? `mid-tier · vs $${premiumLeader.avg} ${name(premiumLeader.brand)}` : ''}
          />
          <MiniKpi
            label="Premium leader" flavor="warn"
            value={premiumLeader ? name(premiumLeader.brand) : '—'}
            color="#F5E625"
            customVs={premiumLeader ? `$${premiumLeader.avg} avg · ${premiumLeader.count} products` : '—'}
          />
          <MiniKpi
            label="Value leader" flavor="danger"
            value={valueLeader ? name(valueLeader.brand) : '—'}
            color="#ef4444"
            customVs={valueLeader ? `$${valueLeader.avg} avg` : '—'}
          />
        </div>
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2>
              Price distribution per brand
              <SectionInfo
                title="Price Range Box Plot"
                description="For each brand: the leftmost point is their cheapest paddle, the rightmost is their most expensive. The box in the middle shows where most prices cluster (the 'interquartile range'). The line inside the box is the median price. A wider spread = a brand covering more market segments."
                source="products · scraped from brand websites via apify/playwright-scraper"
              />
            </h2>
            <div className="sub">Min — median — avg — max per paddle. Box = IQR range.</div>
          </div>
        </div>
        <div className="card"><div className="card-pad">
          <BoxPlot data={boxData} />
        </div></div>
      </section>

      <section>
        <div className="two-col-even">
          <div>
            <div className="section-head"><div>
              <h2>
                Catalog size
                <SectionInfo
                  title="Number of Products"
                  description="How many distinct paddles each brand sells. A larger catalog means more SKUs to cover different player needs (beginner, intermediate, pro, power, control). The right column shows each brand's average selling price."
                  source="products · scraped from brand websites via apify/playwright-scraper"
                />
              </h2>
              <div className="sub">{totalProducts} paddles total across all brands.</div>
            </div></div>
            <div className="card"><div className="card-pad">
              {displayStats.map((p) => (
                <div key={p.brand} className={'bar-row ' + (p.brand === 'joola' ? 'joola' : '')}>
                  <div className="lbl">
                    {name(p.brand)}
                    {BRAND_WEBSITES[p.brand] && (
                      <a
                        href={BRAND_WEBSITES[p.brand]}
                        target="_blank" rel="noopener noreferrer"
                        className="ext-link"
                        style={{ marginLeft: 6 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        Shop ↗
                      </a>
                    )}
                  </div>
                  <div className="track">
                    <div className="fill" style={{
                      width: (p.count / maxCount * 100) + '%',
                      background: `linear-gradient(90deg, ${pgColor(p.brand)}, ${pgColor(p.brand)}99)`,
                    }}>{p.count}</div>
                  </div>
                  <div className="spark-mini">${p.avg} avg</div>
                  <div className="delta-mini flat">{((p.count / Math.max(1, totalProducts)) * 100).toFixed(1)}%</div>
                </div>
              ))}
            </div></div>
          </div>
          <div>
            <div className="section-head"><div>
              <h2>
                Price tiers breakdown
                <SectionInfo
                  title="Value vs. Mid vs. Premium Mix"
                  description="How each brand's lineup splits across three price tiers: Value (under $100), Mid-range ($100–199), and Premium ($200+). A brand heavy in premium products targets serious club players; a value-heavy brand chases beginners and recreational buyers."
                  source="products · prices scraped from brand websites via apify/playwright-scraper"
                />
              </h2>
              <div className="sub">Products bucketed by price point.</div>
            </div></div>
            <div className="card"><div className="card-pad">
              {displayStats.map((p) => {
                const tiers = [
                  { label: 'Value <$100', count: displayProductsAll.filter((x) => x.brand === p.brand && (x.price || 0) < 100).length, color: '#22c55e' },
                  { label: 'Mid $100–199', count: displayProductsAll.filter((x) => x.brand === p.brand && (x.price || 0) >= 100 && (x.price || 0) < 200).length, color: '#F5E625' },
                  { label: 'Premium $200+', count: displayProductsAll.filter((x) => x.brand === p.brand && (x.price || 0) >= 200).length, color: '#ef4444' },
                ]
                const total = tiers.reduce((s, t) => s + t.count, 0) || 1
                return (
                  <div key={p.brand} className="tier-row" style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: p.brand === 'joola' ? '#22c55e' : 'var(--fg)' }}>{name(p.brand)}</span>
                      <span style={{ fontSize: 10, color: 'var(--fg-4)' }}>{p.count} products</span>
                    </div>
                    <div style={{ display: 'flex', height: 12, borderRadius: 4, overflow: 'hidden' }}>
                      {tiers.map((t, i) => t.count > 0 ? (
                        <div key={i} className="tier-seg"
                          style={{ width: (t.count / total * 100) + '%', background: t.color, opacity: 0.8 }}
                          title={`${name(p.brand)} · ${t.label}: ${t.count} products`} />
                      ) : null)}
                    </div>
                  </div>
                )
              })}
              <div className="legend" style={{ marginTop: 12 }}>
                <span className="item"><span className="swatch" style={{ background: '#22c55e' }} />Value &lt;$100</span>
                <span className="item"><span className="swatch" style={{ background: '#F5E625' }} />Mid $100–199</span>
                <span className="item"><span className="swatch" style={{ background: '#ef4444' }} />Premium $200+</span>
              </div>
            </div></div>
          </div>
        </div>
      </section>

      <section>
        <div className="section-head"><div>
          <h2>
            Product catalog · {sortedProducts.length} items
            <SectionInfo
              title="Full Product List"
              description="Every scraped paddle with its price, category, and stock status. Click any column header to sort. Filter by brand using the dropdown at the top. Prices highlighted in yellow are $200+ (premium tier)."
              source="products · scraped from brand websites via apify/playwright-scraper. Updated every Monday."
            />
          </h2>
          <div className="sub">Click column headers to sort.</div>
        </div></div>
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <SortTh col="brand" label="Brand" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                <SortTh col="name" label="Product" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                <SortTh col="category" label="Category" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
                <SortTh col="price" label="Price" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} style={{ textAlign: 'right' }} />
                <SortTh col="inStock" label="Stock" sortKey={sortKey} sortDir={sortDir} toggle={toggleSort} />
              </tr></thead>
              <tbody>
                {sortedProducts.slice(0, 30).map((p, i) => (
                  <tr key={i} className={p.brand === 'joola' ? 'joola' : ''}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span className="brand-dot" style={{ background: pgColor(p.brand) }} />
                        <span style={{ fontWeight: 700, color: p.brand === 'joola' ? '#22c55e' : 'var(--fg)' }}>{name(p.brand)}</span>
                        {BRAND_WEBSITES[p.brand] && (
                          <a
                            href={BRAND_WEBSITES[p.brand]}
                            target="_blank" rel="noopener noreferrer"
                            className="ext-link"
                            style={{ marginLeft: 6 }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            Shop ↗
                          </a>
                        )}
                      </span>
                    </td>
                    <td style={{ color: 'var(--fg)', fontWeight: 600 }}>{p.name?.slice(0, 60) || '—'}</td>
                    <td>
                      <span className={'pill ' + (p.category === 'Pro' || p.category === 'Premium' ? 'pill-yellow' : p.category === 'Mid' ? 'pill-info' : 'pill-ghost')}>
                        {p.category || 'General'}
                      </span>
                    </td>
                    <td className="cell-num" style={{ textAlign: 'right', color: (p.price || 0) >= 200 ? '#F5E625' : 'var(--fg)' }}>
                      {p.price != null ? '$' + p.price.toFixed(0) : '—'}
                    </td>
                    <td>
                      <span className={'pill ' + (p.inStock ? 'pill-green' : 'pill-red')}>
                        {p.inStock ? 'In stock' : 'Out of stock'}
                      </span>
                    </td>
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
