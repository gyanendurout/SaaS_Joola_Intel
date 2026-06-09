'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { PageHead, LoadingPage, pgColor, pgName } from '@/components/v2/PageShell'
import { fmt } from '@/components/v2/charts'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import {
  fetchCampaignOfferIntel,
  buildOfferPlaybook,
  classifyAdTheme,
  type CampaignPressureStat,
  type ActiveOffer,
  type AdCreative,
  type OfferPlaybookRow,
  type ActivityTrendPoint,
} from '@/lib/v2/campaignOfferIntel'
import { formatCalendarDate } from '@/lib/v2/format'

const QUADRANT_LABEL: Record<string, string> = {
  'aggressive-growth': 'Aggressive Growth Push',
  'brand-building':    'Brand-Building / Premium',
  'price-sensitive':   'Price-Sensitive Sales Push',
  'quiet':             'Quiet / Low Activity',
}
const QUADRANT_COLOR: Record<string, string> = {
  'aggressive-growth': '#fb923c',
  'brand-building':    '#818cf8',
  'price-sensitive':   '#ef4444',
  'quiet':             '#64748b',
}
const QUADRANT_DESC: Record<string, string> = {
  'aggressive-growth': 'Spending heavily on both paid ads and promotions — maximum competitive pressure.',
  'brand-building':    'High paid ad investment with minimal discounting — confidence in premium positioning.',
  'price-sensitive':   'Competing primarily through discounts and promotions over paid reach.',
  'quiet':             'Low activity on both paid and promo fronts — either conserving budget or going organic.',
}

function StatCard({ label, value, sub, color, tip }: { label: string; value: string; sub?: string; color?: string; tip?: string }) {
  return (
    <div title={tip} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '14px 16px', cursor: tip ? 'help' : 'default' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: value === '—' ? '#3a4150' : (color || '#fff'), fontFamily: 'JetBrains Mono', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 5 }}>{sub}</div>}
    </div>
  )
}

export default function BrandCampaignPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const brandSlug = decodeURIComponent(slug)

  const [brands, setBrands] = useState<V2Brand[]>([])
  const [pressure, setPressure] = useState<CampaignPressureStat | null>(null)
  const [offers, setOffers] = useState<ActiveOffer[]>([])
  const [ads, setAds] = useState<AdCreative[]>([])
  const [trend, setTrend] = useState<ActivityTrendPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [adTab, setAdTab] = useState<'active' | 'all'>('active')
  const [promoTab, setPromoTab] = useState<'active' | 'all'>('active')

  useEffect(() => {
    if (!brandSlug) return
    document.title = `${brandSlug} — Campaign Intel`
    ;(async () => {
      try {
        const b = await fetchBrands()
        setBrands(b)
        const to = new Date()
        const from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000)
        const d = await fetchCampaignOfferIntel(b, { from, to })
        setPressure(d.campaignPressureStats.find(s => s.brand === brandSlug) || null)
        setOffers(d.activeOffers.filter(o => o.brand === brandSlug))
        setAds(d.adCreatives.filter(a => a.brand === brandSlug))
        setTrend(d.activityTrend || [])
      } finally { setLoading(false) }
    })()
  }, [brandSlug])

  const brandColor = pgColor(brandSlug)
  const brandName = pgName(brandSlug, brands)
  const isJoola = brandSlug === 'joola'

  const displayAds = adTab === 'active' ? ads.filter(a => a.active) : ads
  const displayOffers = promoTab === 'active' ? offers.filter(o => o.active) : offers
  const playbook = useMemo(() => buildOfferPlaybook(offers), [offers])
  const brandTrend = trend.map(p => ({ week: p.weekLabel, count: p.perBrandAds?.[brandSlug] || 0 }))
  const maxTrend = Math.max(1, ...brandTrend.map(p => p.count))

  // Theme breakdown
  const themeBreakdown = useMemo(() => {
    const map = new Map<string, number>()
    ads.forEach(a => { if (a.copy) { const { theme } = classifyAdTheme(a.copy); map.set(theme, (map.get(theme) || 0) + 1) } })
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [ads])

  // Quadrant
  const quadrant = pressure
    ? pressure.adShare >= 50 && pressure.promoShare >= 50 ? 'aggressive-growth'
      : pressure.adShare >= 50 ? 'brand-building'
      : pressure.promoShare >= 50 ? 'price-sensitive'
      : 'quiet'
    : null
  const qColor = quadrant ? QUADRANT_COLOR[quadrant] : '#6b7280'

  if (loading) return <LoadingPage />

  return (
    <>
      <PageHead
        eyebrow="Campaign & Offer Intel"
        title={brandName}
        sub="Brand campaign intelligence"
        actions={
          <button onClick={() => router.back()} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--fg-3)', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
            ← Back
          </button>
        }
      />

      {/* ── Hero stats strip ── */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: 20, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
        <StatCard label="Active Ads"     value={String(ads.filter(a => a.active).length)}        color="#818cf8" tip="Paid ad creatives currently running" />
        <StatCard label="Total Ads"      value={String(ads.length)}                               color="#60a5fa" tip="All ad creatives in the 90-day window" />
        <StatCard label="Active Promos"  value={String(offers.filter(o => o.active).length)}      color="#ef4444" tip="Active promotional offers on their storefront" />
        <StatCard label="Ad Share"       value={pressure ? `${pressure.adShare.toFixed(1)}%` : '—'} color="#a78bfa" tip="Share of all tracked brand ads" />
        <StatCard label="Avg Discount"   value={pressure?.avgDiscount ? `${pressure.avgDiscount}%` : '—'} color="#F5E625" tip="Average % discount across active promotions" />
        <StatCard label="Pressure Score"
          value={pressure ? pressure.pressure.toFixed(1) : '—'}
          color={pressure ? (pressure.pressure >= 50 ? '#ef4444' : pressure.pressure >= 25 ? '#F5E625' : '#22c55e') : '#6b7280'}
          sub={quadrant ? QUADRANT_LABEL[quadrant] : undefined}
          tip="Composite 0–100 competitive pressure score" />
      </div>

      {/* ── Two-column main layout ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>

        {/* Left: Weekly trend + quadrant */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Weekly ad trend */}
          <div className="card" style={{ padding: '16px 20px' }}>
            <h6 style={{ marginTop: 0, marginBottom: 14 }}>Weekly Ad Volume</h6>
            {brandTrend.some(p => p.count > 0) ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80, marginBottom: 8 }}>
                  {brandTrend.map((p, i) => (
                    <div key={i} title={`${p.week}: ${p.count} ads`} style={{ flex: 1, height: `${Math.max(4, (p.count / maxTrend) * 100)}%`, background: p.count > 0 ? brandColor : 'rgba(255,255,255,0.05)', borderRadius: '3px 3px 0 0', opacity: p.count > 0 ? 0.85 : 1, transition: 'height 400ms cubic-bezier(0.16,1,0.3,1)', cursor: 'default', minHeight: 4 }} />
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#4b5563' }}>
                  {[0, Math.floor(brandTrend.length / 2), brandTrend.length - 1].map(i => brandTrend[i] ? (
                    <span key={i}>{brandTrend[i].week}</span>
                  ) : null)}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'center', padding: '20px 0' }}>No ad activity in the 90-day window</div>
            )}
          </div>

          {/* Strategy quadrant */}
          {quadrant && (
            <div className="card" style={{ padding: '16px 20px', borderLeft: `3px solid ${qColor}` }}>
              <h6 style={{ marginTop: 0, color: qColor }}>{QUADRANT_LABEL[quadrant]}</h6>
              <p style={{ fontSize: 12, color: '#cbd1dc', lineHeight: 1.65, margin: 0 }}>{QUADRANT_DESC[quadrant]}</p>
            </div>
          )}

          {/* Ad theme breakdown */}
          {themeBreakdown.length > 0 && (
            <div className="card" style={{ padding: '16px 20px' }}>
              <h6 style={{ marginTop: 0, marginBottom: 12 }}>Ad Message Themes</h6>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {themeBreakdown.map(([theme, count]) => {
                  const pct = Math.round((count / ads.filter(a => a.copy).length) * 100)
                  return (
                    <div key={theme} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 40px', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, color: '#cbd1dc', textTransform: 'capitalize' }}>{theme.replace('-', ' ')}</span>
                      <div style={{ height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: brandColor, borderRadius: 99, opacity: 0.8 }} />
                      </div>
                      <span style={{ fontSize: 11, color: '#6b7280', textAlign: 'right' }}>{count}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: Promo breakdown */}
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h6 style={{ margin: 0 }}>Promotions</h6>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['active', 'all'] as const).map(t => (
                <button key={t} onClick={() => setPromoTab(t)} style={{ background: promoTab === t ? 'rgba(255,255,255,0.08)' : 'none', border: `1px solid ${promoTab === t ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)'}`, color: promoTab === t ? '#fff' : '#6b7280', borderRadius: 6, padding: '3px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                  {t === 'active' ? `Active (${offers.filter(o => o.active).length})` : `All (${offers.length})`}
                </button>
              ))}
            </div>
          </div>
          {displayOffers.length === 0 ? (
            <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'center', padding: '24px 0' }}>No {promoTab} promotions</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
              {displayOffers.map(o => (
                <div key={o.id} style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                    <span className="pill pill-ghost" style={{ fontSize: 9, padding: '1px 6px' }}>{o.type}</span>
                    {o.discount && o.discount > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#F5E625' }}>{o.discount}% off</span>}
                    <span className={'pill ' + (o.active ? 'pill-green' : 'pill-ghost')} style={{ fontSize: 9, marginLeft: 'auto' }}>{o.active ? 'ACTIVE' : 'ENDED'}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.5, marginBottom: o.sourceUrl ? 6 : 0 }}>{o.text || '—'}</div>
                  {o.sourceUrl && <a href={o.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#60a5fa', textDecoration: 'none' }}>View source →</a>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Ad Creatives full width ── */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h6 style={{ margin: 0 }}>Ad Creatives</h6>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['active', 'all'] as const).map(t => (
              <button key={t} onClick={() => setAdTab(t)} style={{ background: adTab === t ? 'rgba(255,255,255,0.08)' : 'none', border: `1px solid ${adTab === t ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)'}`, color: adTab === t ? '#fff' : '#6b7280', borderRadius: 6, padding: '3px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                {t === 'active' ? `Active (${ads.filter(a => a.active).length})` : `All (${ads.length})`}
              </button>
            ))}
          </div>
        </div>
        {displayAds.length === 0 ? (
          <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'center', padding: '24px 0' }}>No {adTab} ad creatives</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10, maxHeight: 480, overflowY: 'auto' }}>
            {displayAds.map(a => (
              <div key={a.id} style={{ padding: '12px 14px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${a.active ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span className={'pill ' + (a.rawPlatform === 'meta' ? 'pill-info' : 'pill-amber')} style={{ fontSize: 9 }}>{a.platform}</span>
                  {a.cta && <span className="pill pill-ghost" style={{ fontSize: 9 }}>{a.cta}</span>}
                  <span className={'pill ' + (a.active ? 'pill-green' : 'pill-ghost')} style={{ fontSize: 9, marginLeft: 'auto' }}>{a.active ? 'ACTIVE' : 'ENDED'}</span>
                </div>
                {a.creativeUrl && (
                  <img src={a.creativeUrl} alt="" style={{ width: '100%', maxHeight: 80, objectFit: 'cover', borderRadius: 6, marginBottom: 8, border: '1px solid rgba(255,255,255,0.06)' }} onError={e => (e.currentTarget.style.display = 'none')} />
                )}
                <div style={{ fontSize: 12, color: a.copy ? '#e2e8f0' : '#4b5563', lineHeight: 1.5, marginBottom: a.sourceUrl ? 6 : 0 }}>
                  {a.copy || '(no copy — Google Ads)'}
                </div>
                {a.startedAt && <div style={{ fontSize: 10, color: '#4b5563', marginTop: 4 }}>First seen: {formatCalendarDate(a.startedAt)}</div>}
                {a.sourceUrl && <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#60a5fa', textDecoration: 'none', display: 'block', marginTop: 6 }}>View in Ad Library →</a>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── JOOLA Playbook ── */}
      {playbook.length > 0 && (
        <div className="card" style={{ padding: '16px 20px' }}>
          <h6 style={{ marginTop: 0, marginBottom: 14 }}>JOOLA Counter-Strategy Playbook</h6>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {playbook.map((p, i) => (
              <div key={i} style={{ padding: '12px 16px', background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.18)', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span className="pill pill-ghost" style={{ fontSize: 9 }}>{p.promoType}</span>
                  {p.discountDepth && p.discountDepth > 0 && <span style={{ fontSize: 11, color: '#F5E625', fontWeight: 700 }}>{p.discountDepth}% off</span>}
                  <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 'auto' }}>{p.frequency}× detected</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#22c55e', lineHeight: 1.5 }}>→ {p.joolaResponse}</div>
                {p.lastDetected && <div style={{ fontSize: 10, color: '#4b5563', marginTop: 6 }}>Last seen: {formatCalendarDate(p.lastDetected)}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
