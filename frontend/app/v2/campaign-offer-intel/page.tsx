'use client'

/**
 * Campaign & Offer Intel — executive dashboard.
 *
 *   §1  At a glance        scale, channel split, volume leader, live offers
 *   §2  Brand breakdown    budget split per competitor, with deep links out
 *   §3  Evergreen ads      what they have paid to keep running longest
 *   §4  Messaging & offers CTA mix and the discount banners
 *
 * Every brand row and every ad card links to the platform's own public archive,
 * so any number here can be checked against the live ad in one click. Those
 * links are built from exact advertiser and page ids, not keyword searches — a
 * search URL can land on the wrong brand or on nothing.
 *
 * WHERE THIS PAGE REFUSES THE OBVIOUS NUMBER
 * "Live" is measured from last_shown, not is_active: that column reads true on
 * 1,601 of 1,606 rows because the Google actor returns no active flag. Promos
 * are split into running and past for the same reason — the promotions table
 * has no end date. And 908 Google ads publish no copy at all, so their cards
 * say so and link out rather than render an empty quote.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  PageHead,
  FilterBanner,
  SectionInfo,
  LoadingPage,
  pgColor,
  pgName,
} from '@/components/v2/PageShell'
import { useBrandFilter } from '@/lib/v2/BrandFilterContext'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import {
  fetchCampaignIntel,
  EVERGREEN_MIN_DAYS,
  LIVE_WINDOW_DAYS,
  PROMO_ACTIVE_DAYS,
  type AdCard,
  type CampaignIntelData,
} from '@/lib/v2/campaignIntel'

const MAX_EVERGREEN = 24

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

function monthYear(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  return new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function shortDate(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function placementLabel(c: AdCard): string {
  if (c.platform === 'google') return 'Google'
  const p = c.placements
  if (p.includes('instagram') && p.includes('facebook')) return 'Facebook + Instagram'
  if (p.includes('instagram')) return 'Instagram'
  if (p.includes('facebook')) return 'Facebook'
  return 'Meta'
}

export default function CampaignOfferIntelPage() {
  const [brandMeta, setBrandMeta] = useState<V2Brand[]>([])
  const [data, setData] = useState<CampaignIntelData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()

  useEffect(() => {
    document.title = 'JOOLA INTEL — Campaign & Offer Intel'
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const b = await fetchBrands()
        if (cancelled) return
        setBrandMeta(b)
        setAllBrands(b)
        const d = await fetchCampaignIntel(b)
        if (!cancelled) setData(d)
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setAllBrands])

  const visible = useMemo(() => {
    const selected = new Set(filteredBrands.map((b) => b.id))
    return (slug: string) => !isFiltered || selected.has(slug)
  }, [filteredBrands, isFiltered])

  const name = useMemo(() => (slug: string) => pgName(slug, brandMeta), [brandMeta])

  const brands = useMemo(
    () => (data?.brands ?? []).filter((b) => visible(b.slug) && b.total > 0),
    [data, visible],
  )
  const evergreen = useMemo(
    () => (data?.evergreen ?? []).filter((c) => visible(c.brandSlug)).slice(0, MAX_EVERGREEN),
    [data, visible],
  )
  const promos = useMemo(
    () => (data?.promos ?? []).filter((p) => visible(p.brandSlug)),
    [data, visible],
  )
  const ctas = useMemo(() => data?.ctas ?? [], [data])

  if (err) {
    return (
      <div>
        <PageHead title="CAMPAIGN & OFFER INTEL" />
        <div className="card" style={{ padding: 20, color: '#ef4444' }}>Could not load: {err}</div>
      </div>
    )
  }
  if (!data) return <LoadingPage />

  const s = data.summary
  const maxAds = Math.max(1, ...brands.map((b) => b.total))
  const ctaTotal = ctas.reduce((n, c) => n + c.count, 0)

  return (
    <div>
      <PageHead title="CAMPAIGN & OFFER INTEL" />
      <FilterBanner />

      {/* ─── §1 At a glance ──────────────────────────────────────────── */}
      <section>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: 12,
            marginBottom: 20,
          }}
        >
          <Kpi
            label="Ads tracked"
            value={fmt(s.totalAds)}
            note={`${fmt(s.liveAds)} still running in the last ${LIVE_WINDOW_DAYS} days`}
          />
          <Kpi
            label="Where the money goes"
            value={`${s.googlePct}% Google`}
            note={`${fmt(s.google)} on search · ${fmt(s.meta)} on Meta (${s.metaPct}%)`}
          />
          <Kpi
            label="Volume leader"
            value={s.topBrand ? name(s.topBrand.slug) : '—'}
            valueColor={s.topBrand ? pgColor(s.topBrand.slug) : undefined}
            note={s.topBrand ? `${fmt(s.topBrand.ads)} ads tracked` : ''}
          />
          <Kpi
            label="Discounts running"
            value={fmt(s.promoRecent)}
            valueColor={s.promoRecent > 0 ? '#F5E625' : undefined}
            note={`seen in the last ${PROMO_ACTIVE_DAYS} days · ${fmt(s.promoTotal)} found in total across ${s.promoBrands} brands`}
          />
        </div>
      </section>

      {/* ─── §2 Brand breakdown ──────────────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Where each competitor spends
              <SectionInfo
                title="Where each competitor spends"
                description="Ads found per brand, split by platform. Google means chasing people already searching for a paddle; Meta means creating the want. The buttons open that brand's own advertiser page on the platform's public archive, where every ad it is running can be browsed."
                source="marketing_ads grouped by brand and platform"
              />
            </h2>
            <div className="sub">
              Click <strong style={{ color: '#60a5fa' }}>Google</strong> or{' '}
              <strong style={{ color: '#60a5fa' }}>Meta</strong> on any row to see every ad that
              brand is running, on the platform&apos;s own site.
            </div>
          </div>
        </div>
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data" style={{ width: '100%', minWidth: 940, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 180 }} />
              <col style={{ width: 78 }} />
              <col style={{ width: 84 }} />
              <col style={{ width: 76 }} />
              <col />
              <col style={{ width: 168 }} />
              <col style={{ width: 118 }} />
              <col style={{ width: 172 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Competitor</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>Google</th>
                <th style={{ textAlign: 'right' }}>Meta</th>
                <th style={{ textAlign: 'left' }}>Split</th>
                <th style={{ textAlign: 'left' }}>Strategy</th>
                <th style={{ textAlign: 'left' }}>Main format</th>
                <th style={{ textAlign: 'right' }}>See their live ads</th>
              </tr>
            </thead>
            <tbody>
              {brands.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>No ads for this filter.</td></tr>
              )}
              {brands.map((b) => (
                <tr key={b.slug} style={b.slug === 'joola' ? { background: 'rgba(34,197,94,0.05)' } : undefined}>
                  <td style={{ textAlign: 'left' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: pgColor(b.slug), flexShrink: 0 }} />
                      <span style={{ fontWeight: 700, color: b.slug === 'joola' ? '#22c55e' : 'inherit' }}>{name(b.slug)}</span>
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 800, color: '#fff' }}>{fmt(b.total)}</td>
                  <td style={{ textAlign: 'right' }}>{b.google || <span style={{ color: '#3a4150' }}>·</span>}</td>
                  <td style={{ textAlign: 'right' }}>{b.meta || <span style={{ color: '#3a4150' }}>·</span>}</td>
                  <td>
                    <span style={{ display: 'flex', height: 9, width: `${Math.max(18, (b.total / maxAds) * 100)}%`, borderRadius: 999, overflow: 'hidden', background: 'var(--wb-5)' }}>
                      {b.google > 0 && (
                        <span title={`Google: ${b.google}`} style={{ width: `${(b.google / b.total) * 100}%`, background: '#60a5fa' }} />
                      )}
                      {b.meta > 0 && (
                        <span title={`Meta: ${b.meta}`} style={{ width: `${(b.meta / b.total) * 100}%`, background: '#c084fc' }} />
                      )}
                    </span>
                  </td>
                  <td style={{ textAlign: 'left', fontSize: 11, color: 'var(--fg-2)' }}>{b.strategy}</td>
                  <td style={{ textAlign: 'left', fontSize: 11, color: 'var(--fg-4)' }}>{b.formatLabel}</td>
                  <td style={{ textAlign: 'right' }}>
                    <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <ArchiveLink href={b.googleAdsUrl} label="Google" count={b.google} />
                      <ArchiveLink href={b.metaAdsUrl} label="Meta" count={b.meta} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--fg-2)', lineHeight: 1.7 }}>
          <strong style={{ color: '#F5E625' }}>How to read this:</strong> brands at{' '}
          <em>search capture only</em> are harvesting people already shopping. Brands at{' '}
          <em>social awareness only</em> are trying to create the demand. The omnichannel brands do
          both, and are the expensive ones to compete with.
        </div>
      </section>

      {/* ─── §3 Evergreen ads ────────────────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              The ads they keep paying for
              <SectionInfo
                title="The ads they keep paying for"
                description={`Ads running ${EVERGREEN_MIN_DAYS} days or longer, longest first. Nobody keeps paying for an ad that loses money, so a long run is a competitor telling you at their own expense which message converts. Dynamic catalogue ads are excluded — they run indefinitely by construction and prove nothing about a message.`}
                source="marketing_ads: approx_days_shown, or started_at to last_shown"
              />
            </h2>
            <div className="sub">
              Running {EVERGREEN_MIN_DAYS}+ days. If they are still paying for it, it is working.
              Every card opens the real ad.
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {evergreen.length === 0 && (
            <div className="card" style={{ padding: 18, color: 'var(--fg-4)', fontSize: 12 }}>
              No long-running ads for this filter.
            </div>
          )}
          {evergreen.map((c) => (
            <EvergreenCard key={c.key} card={c} brandName={name(c.brandSlug)} />
          ))}
        </div>
      </section>

      {/* ─── §4 Messaging & offers ───────────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              What they ask people to do
              <SectionInfo
                title="What they ask people to do"
                description="The button on the ad. 'Shop now' is a direct-checkout play; 'Learn more' means the product needs explaining first; 'Order now' signals a launch or a limited drop. Only Meta publishes a button label, so this covers Facebook and Instagram."
                source="marketing_ads.cta"
              />
            </h2>
            <div className="sub">
              The button on each ad. Facebook and Instagram only — Google does not publish one.
            </div>
          </div>
        </div>
        <div className="card" style={{ padding: 18, marginBottom: 18 }}>
          {ctas.length === 0 && <div style={{ color: 'var(--fg-4)', fontSize: 12 }}>No CTA data.</div>}
          {ctas.map((c) => (
            <div key={c.label} style={{ display: 'grid', gridTemplateColumns: '190px 1fr 60px', alignItems: 'center', gap: 12, padding: '6px 0' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{c.label}</span>
              <div style={{ height: 12, background: 'var(--wb-5)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${(c.count / Math.max(1, ctas[0].count)) * 100}%`, height: '100%', background: '#F5E625', borderRadius: 3 }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 800, textAlign: 'right', color: '#fff' }}>
                {fmt(c.count)}
              </span>
            </div>
          ))}
          {ctaTotal > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--fg-4)' }}>
              {Math.round((ctas[0].count / ctaTotal) * 100)}% of all buttons say &ldquo;{ctas[0].label}
              &rdquo; — the market sells direct rather than educating first.
            </div>
          )}
        </div>

        <div className="section-head">
          <div>
            <h2>
              Who is discounting
              <SectionInfo
                title="Who is discounting"
                description={`Discount banners found on competitor homepages. The source has no end date, so anything detected in the last ${PROMO_ACTIVE_DAYS} days is treated as running and everything older is marked past. Most banners state no percentage, so the wording is shown rather than a number nobody published.`}
                source="promotions, scraped weekly from brand homepages"
              />
            </h2>
            <div className="sub">
              {fmt(s.promoRecent)} running now, {fmt(s.promoTotal)} found in total. Click any row to
              open the offer on the competitor&apos;s site.
            </div>
          </div>
        </div>
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data" style={{ width: '100%', minWidth: 780 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Brand</th>
                <th style={{ textAlign: 'left' }}>What the banner says</th>
                <th style={{ textAlign: 'right' }}>Discount</th>
                <th style={{ textAlign: 'right' }}>Seen</th>
                <th style={{ textAlign: 'right' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {promos.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>No discounts found for this filter.</td></tr>
              )}
              {promos.map((p) => (
                <tr
                  key={p.key}
                  style={{ cursor: p.sourceUrl ? 'pointer' : 'default', opacity: p.isRecent ? 1 : 0.55 }}
                  onClick={() => p.sourceUrl && window.open(p.sourceUrl, '_blank', 'noopener,noreferrer')}
                >
                  <td style={{ textAlign: 'left' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: pgColor(p.brandSlug) }} />
                      <span style={{ fontWeight: 700, color: p.brandSlug === 'joola' ? '#22c55e' : 'inherit' }}>{name(p.brandSlug)}</span>
                    </span>
                  </td>
                  <td style={{ textAlign: 'left', color: 'var(--fg-2)' }}>{p.text.slice(0, 120)}</td>
                  <td style={{ textAlign: 'right', color: p.discountPct != null ? '#F5E625' : 'var(--fg-4)' }}>
                    {p.discountPct != null ? `${p.discountPct}%` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--fg-4)', fontSize: 11 }}>{shortDate(p.detectedAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: p.isRecent ? 'rgba(34,197,94,0.12)' : 'var(--wb-5)', color: p.isRecent ? '#22c55e' : 'var(--fg-4)' }}>
                      {p.isRecent ? 'running' : 'past'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

/* ── Sub-components ─────────────────────────────────────────────────── */

function Kpi({ label, value, note, valueColor }: { label: string; value: string; note?: string; valueColor?: string }) {
  return (
    <div className="card" style={{ padding: '14px 18px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', letterSpacing: '0.09em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: valueColor || '#fff', margin: '4px 0 3px', lineHeight: 1.15 }}>
        {value}
      </div>
      {note && <div style={{ fontSize: 11, color: 'var(--fg-4)', lineHeight: 1.5 }}>{note}</div>}
    </div>
  )
}

/** Button through to a brand's ads on a platform archive. Disabled rather than
 *  hidden when the brand runs nothing there — "no ads on Meta" is a finding,
 *  and a missing button reads as a broken feature. */
function ArchiveLink({ href, label, count }: { href: string | null; label: string; count: number }) {
  const base: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    padding: '4px 10px',
    borderRadius: 999,
    border: '1px solid var(--wb-5)',
    whiteSpace: 'nowrap',
  }
  if (!href || count === 0) {
    return (
      <span title={`No ${label} ads found for this brand`} style={{ ...base, color: '#3a4150' }}>
        {label} —
      </span>
    )
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open every ${label} ad this brand is running (${count} tracked here)`}
      style={{ ...base, color: '#60a5fa' }}
    >
      {label} ↗
    </a>
  )
}

/**
 * One long-running ad.
 *
 * The image is attempted but never relied on: Meta creative_url values are
 * signed CDN links that 403 within days of capture, so the <img> removes itself
 * on error and the card stands on its copy and its archive link. Google ads
 * carry no copy at all, so those cards say so instead of showing an empty quote.
 */
function EvergreenCard({ card, brandName }: { card: AdCard; brandName: string }) {
  const [imgOk, setImgOk] = useState(true)
  const copy = card.body || card.title

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {card.creativeUrl && imgOk && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={card.creativeUrl}
          alt=""
          loading="lazy"
          onError={() => setImgOk(false)}
          style={{ width: '100%', height: 148, objectFit: 'cover', display: 'block', background: 'var(--wb-5)' }}
        />
      )}
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: pgColor(card.brandSlug) }} />
          <span style={{ fontSize: 12, fontWeight: 800, color: card.brandSlug === 'joola' ? '#22c55e' : '#fff' }}>
            {brandName}
          </span>
          <span style={{ fontSize: 10, fontWeight: 800, color: '#F5E625' }}>
            {fmt(card.runtimeDays || 0)} days
          </span>
          {card.isLive && (
            <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: 'rgba(34,197,94,0.13)', color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              running
            </span>
          )}
        </div>

        <div style={{ fontSize: 10.5, color: 'var(--fg-4)' }}>
          {placementLabel(card)}
          {card.format ? ` · ${card.format}` : ''} · started {monthYear(card.startedAt)}
        </div>

        {copy ? (
          <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--fg-1, #e8ecf3)' }}>
            {card.title && card.body && (
              <div style={{ fontWeight: 700, color: '#fff', marginBottom: 4 }}>{card.title}</div>
            )}
            {copy.length > 190 ? copy.slice(0, 190) + '…' : copy}
          </div>
        ) : (
          <div style={{ fontSize: 11.5, fontStyle: 'italic', color: 'var(--fg-4)', lineHeight: 1.5 }}>
            {card.platform === 'google'
              ? 'Google does not publish this ad’s text — open the archive to see it.'
              : 'No text captured for this ad — open the archive to see it.'}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 'auto', paddingTop: 4 }}>
          {card.cta && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: 'rgba(245,230,37,0.12)', color: '#F5E625' }}>
              {card.cta}
            </span>
          )}
          {card.archiveUrl && (
            <a
              href={card.archiveUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 10.5, fontWeight: 700, color: '#60a5fa' }}
            >
              View live ad ↗
            </a>
          )}
          {card.landingUrl && (
            <a
              href={card.landingUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--fg-2)', marginLeft: 'auto' }}
            >
              Store page ↗
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
