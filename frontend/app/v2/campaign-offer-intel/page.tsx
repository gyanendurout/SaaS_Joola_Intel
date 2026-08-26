'use client'

/**
 * Campaign & Offer Intel — rebuilt 2026-08-26.
 *
 * Ten sections, each answering exactly one question in plain language:
 *
 *   §1   What changed         five sentences, no KPI wall
 *   §2   Who advertises most  one bar per brand
 *   §3   Who's speeding up    last 4 weeks vs the 4 before
 *   §4   What they're saying  real ad copy, one block per brand
 *   §5   What everyone promises  themes, and where nobody is standing
 *   §6   Where they spend     Google vs Meta, Facebook vs Instagram
 *   §7   What's brand new     ads first seen in the last 30 days
 *   §8   What's working       how long each ad has run
 *   §9   Who's cutting price  the discount banners
 *   §10  What you should do   position, then actions derived from the above
 *
 * WHAT WAS REMOVED AND WHY
 * The previous page had nine sections, four of which looked analytical without
 * being so: two bubble charts plotting the same eleven brands twice (one fed by
 * promotion_daily, which holds nine rows); a rule-based "offer playbook" keyed
 * on promo_type, which is the catch-all "general" for 42 of 63 rows; and a
 * 0-100 "pressure score" that blended ad count with promo count and hid both
 * numbers a reader would actually act on.
 *
 * HONESTY RULES THIS PAGE KEEPS
 * Google's transparency centre returns no ad copy and no landing page. So §4,
 * §5 and the copy-bearing parts of §7/§8 are Meta-only and say so inline. A
 * competitor whose words we cannot read must never render as a competitor with
 * nothing to say. Likewise §9 states how few promo banners carry a
 * readable percentage, rather than charting an average that implies precision
 * nobody measured. §10 asserts nothing a reader cannot scroll up and verify.
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
  NEW_WINDOW_DAYS,
  PROMO_ACTIVE_DAYS,
  UNTHEMED,
  type AdCard,
  type CampaignIntelData,
  type ThemeRow,
} from '@/lib/v2/campaignIntel'

/* Search versus social. Deliberately not brand colours — this axis is about
 * intent, not identity, and reusing the brand palette here would read as a
 * brand breakdown. */
const SEARCH_COLOR = '#60a5fa'
const SOCIAL_COLOR = '#c084fc'

const MAX_ADS_PER_BRAND = 6
const MAX_NEW_ADS = 24
const MAX_LONGEST = 20

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

function shortDate(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** "Meta" alone hides whether a brand bought Instagram. Name the surface. */
function placementLabel(c: AdCard): string {
  if (c.platform === 'google') return 'Google'
  const p = c.placements
  if (p.includes('instagram') && p.includes('facebook')) return 'Facebook + Instagram'
  if (p.includes('instagram')) return 'Instagram'
  if (p.includes('facebook')) return 'Facebook'
  return 'Meta'
}

export default function CampaignOfferIntelPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
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
        setBrands(b)
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

  const name = useMemo(() => (slug: string) => pgName(slug, brands), [brands])

  const volumes = useMemo(
    () => (data?.volumes ?? []).filter((v) => visible(v.slug) && v.total > 0),
    [data, visible],
  )
  const placements = useMemo(
    () => (data?.placements ?? []).filter((p) => visible(p.slug)),
    [data, visible],
  )
  const newAds = useMemo(
    () => (data?.newAds ?? []).filter((c) => visible(c.brandSlug)).slice(0, MAX_NEW_ADS),
    [data, visible],
  )
  const longest = useMemo(
    () => (data?.longestRunning ?? []).filter((c) => visible(c.brandSlug)).slice(0, MAX_LONGEST),
    [data, visible],
  )
  const promos = useMemo(
    () => (data?.promos ?? []).filter((p) => visible(p.brandSlug)),
    [data, visible],
  )
  const momentum = useMemo(
    () => (data?.momentum ?? []).filter((m) => visible(m.slug)),
    [data, visible],
  )
  /* Themes are recomputed against the brand filter rather than sliced, so a
   * filtered view shows each theme's real composition instead of bars that
   * still add up to the unfiltered total. */
  const themes = useMemo<ThemeRow[]>(() => {
    const src = data?.themes ?? []
    if (!isFiltered) return src
    return src
      .map((t): ThemeRow => {
        const byBrand: Record<string, number> = {}
        let total = 0
        for (const [slug, n] of Object.entries(t.byBrand)) {
          if (!visible(slug)) continue
          byBrand[slug] = n
          total += n
        }
        // Leader and stance are recomputed, not carried over: under a filter
        // the leading brand may not be visible, and reporting an absent brand
        // as "most" would be wrong.
        const entries = Object.entries(byBrand).sort((a, b) => b[1] - a[1])
        const leader = entries.length > 0 ? { slug: entries[0][0], count: entries[0][1] } : null
        const joola = byBrand['joola'] || 0
        let stance: ThemeRow['stance'] = 'contested'
        if (leader && leader.slug === 'joola') stance = 'own'
        else if (joola === 0) stance = 'absent'
        else if (leader && joola * 2 <= leader.count) stance = 'behind'
        return { ...t, total, byBrand, brandCount: entries.length, leader, joola, stance }
      })
      .filter((t) => t.total > 0)
      .sort((a, b) => {
        if (a.theme === UNTHEMED) return 1
        if (b.theme === UNTHEMED) return -1
        return b.total - a.total
      })
  }, [data, isFiltered, visible])
  const actions = useMemo(() => data?.actions ?? [], [data])
  const copyBrands = useMemo(() => {
    const map = data?.adsByBrand ?? {}
    return Object.keys(map)
      .filter((slug) => visible(slug))
      .sort((a, b) => (map[b]?.length ?? 0) - (map[a]?.length ?? 0))
  }, [data, visible])

  if (err) {
    return (
      <div>
        <PageHead title="CAMPAIGN & OFFER INTEL" />
        <div className="card" style={{ padding: 20, color: '#ef4444' }}>Could not load: {err}</div>
      </div>
    )
  }
  if (!data) return <LoadingPage />

  const h = data.headline
  const maxAds = Math.max(1, ...volumes.map((v) => v.total))

  return (
    <div>
      <PageHead title="CAMPAIGN & OFFER INTEL" />
      <FilterBanner />

      {/* ─── §1 What changed ──────────────────────────────────────────── */}
      <section>
        <div className="card" style={{ padding: '18px 22px', marginBottom: 18 }}>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 2, color: 'var(--fg-2)' }}>
            <li>
              <strong style={{ color: '#fff' }}>{fmt(h.totalAds)} ads</strong> are being run by{' '}
              <strong style={{ color: '#fff' }}>{h.brandsAdvertising} brands</strong>.
            </li>
            {h.topBrand && (
              <li>
                <strong style={{ color: pgColor(h.topBrand.slug) }}>{name(h.topBrand.slug)}</strong>{' '}
                runs the most at <strong style={{ color: '#fff' }}>{fmt(h.topBrand.ads)}</strong>
                {h.leaderMultiple != null && (
                  <>
                    {' — '}
                    <strong style={{ color: '#F5E625' }}>{h.leaderMultiple}× JOOLA&apos;s {fmt(h.joolaAds)}</strong>
                  </>
                )}
                .
              </li>
            )}
            <li>
              JOOLA sits at{' '}
              <strong style={{ color: '#22c55e' }}>
                {h.joolaRank ? `#${h.joolaRank}` : 'unranked'}
              </strong>{' '}
              for ad volume.
            </li>
            <li>
              <strong style={{ color: '#fff' }}>{h.brandsDiscounting} brands</strong> are running a
              discount.{' '}
              {h.joolaPromos === 0 ? (
                <strong style={{ color: '#ef4444' }}>JOOLA is running none.</strong>
              ) : (
                <>JOOLA is running <strong style={{ color: '#22c55e' }}>{h.joolaPromos}</strong>.</>
              )}
            </li>
            <li>
              <strong style={{ color: '#fff' }}>{fmt(h.newLast30)} ads</strong> started in the last{' '}
              {NEW_WINDOW_DAYS} days.
            </li>
          </ul>
        </div>
      </section>

      {/* ─── §2 Who's advertising most ────────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Who&apos;s advertising most
              <SectionInfo
                title="Who's advertising most"
                description="Every ad we have captured for each brand, counted. Longest bar advertises most. JOOLA is green. This counts ads seen since mid-May, not ads live at this instant."
                source="marketing_ads, grouped by brand"
              />
            </h2>
            <div className="sub">
              One bar per brand. Longest is loudest. Use the Google and Meta buttons to open that
              brand&apos;s live ads in the platform&apos;s own archive.
            </div>
          </div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          {volumes.length === 0 && <div style={{ color: 'var(--fg-4)', fontSize: 12 }}>No ads for this filter.</div>}
          {volumes.map((v) => (
            <div
              key={v.slug}
              style={{ display: 'grid', gridTemplateColumns: '150px 1fr 56px 168px', alignItems: 'center', gap: 12, padding: '7px 0' }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: v.slug === 'joola' ? '#22c55e' : 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {name(v.slug)}
              </span>
              <div style={{ height: 14, background: 'var(--wb-5)', borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${(v.total / maxAds) * 100}%`,
                    height: '100%',
                    background: v.slug === 'joola' ? '#22c55e' : pgColor(v.slug),
                    borderRadius: 3,
                  }}
                />
              </div>
              <span style={{ fontSize: 12, fontWeight: 800, textAlign: 'right', color: '#fff' }}>{fmt(v.total)}</span>
              {/* Straight into the platform's own archive for this brand, where
                * every ad it is running can be browsed live. A brand with no
                * ads on a platform gets a disabled marker, not a link that
                * would open an empty search. */}
              <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <ArchiveLink href={v.googleAdsUrl} label="Google" count={v.google} />
                <ArchiveLink href={v.metaAdsUrl} label="Meta" count={v.meta} />
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ─── §3 Who's speeding up ─────────────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Who&apos;s speeding up
              <SectionInfo
                title="Who's speeding up"
                description="Ads started in the last 4 weeks against the 4 weeks before. A brand sharply increasing spend is usually about to launch something — this is the earliest warning available, normally weeks ahead of any announcement."
                source="marketing_ads.started_at, 28-day windows"
              />
            </h2>
            <div className="sub">Last 4 weeks vs the 4 before. Up means they are buying more attention.</div>
          </div>
        </div>
        <div className="card" style={{ padding: 16, overflowX: 'auto' }}>
          <table className="data" style={{ width: '100%', minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Brand</th>
                <th>Previous 4 wks</th>
                <th>Last 4 wks</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {momentum.length === 0 && (
                <tr><td colSpan={4} style={{ padding: 16, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>No dated ads in the last 8 weeks for this filter.</td></tr>
              )}
              {momentum.map((m) => {
                const up = m.delta > 0
                const flat = m.delta === 0
                const color = flat ? 'var(--fg-4)' : up ? '#ef4444' : '#22c55e'
                return (
                  <tr key={m.slug}>
                    <td style={{ textAlign: 'left' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: pgColor(m.slug) }} />
                        <span style={{ fontWeight: 700, color: m.slug === 'joola' ? '#22c55e' : 'inherit' }}>{name(m.slug)}</span>
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--fg-4)' }}>{m.previous || '·'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{m.recent || '·'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 800, color }}>
                      {flat ? '—' : `${up ? '▲' : '▼'} ${Math.abs(m.delta)}`}
                      {m.pctChange != null && !flat && (
                        <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 6, color: 'var(--fg-4)' }}>
                          {m.pctChange > 0 ? '+' : ''}{m.pctChange}%
                        </span>
                      )}
                      {m.pctChange == null && m.recent > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 6, color: 'var(--fg-4)' }}>new</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--fg-4)' }}>
            Red is a competitor accelerating — that is the direction that costs you attention.
          </div>
        </div>
      </section>

      {/* ─── §4 What they're saying ───────────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              What they&apos;re saying
              <SectionInfo
                title="What they're saying"
                description="The advertiser's own ad copy — what the brand says to a customer, not what customers say back. Grouped by brand. Identical wording is collapsed to one card, because 51% of readable ads repeat copy across creative variants; the &times;N badge is how many ads carry that exact line. Google's archive publishes no ad text at all, so this covers Facebook and Instagram only — a brand missing here is not a brand that is silent."
                source="marketing_ads.body + cta + landing_url (Meta only)"
              />
            </h2>
            <div className="sub">
              The words each brand puts in its own ads — not customer comments. One block per
              brand, most-repeated message first. Identical copy is collapsed into one card with
              a &times;N badge showing how many ads run it.{' '}
              <span style={{ color: '#F5E625' }}>
                Facebook and Instagram only — Google publishes no ad text ({fmt(data.googleAdsUnreadable)} ads unreadable).
              </span>
            </div>
          </div>
        </div>
        {copyBrands.length === 0 && (
          <div className="card" style={{ padding: 18, color: 'var(--fg-4)', fontSize: 12 }}>
            No readable ad copy for this filter.
          </div>
        )}
        {copyBrands.map((slug) => {
          const list = (data.adsByBrand[slug] || []).slice(0, MAX_ADS_PER_BRAND)
          const total = data.adsByBrand[slug]?.length ?? 0
          return (
            <div key={slug} className="card" style={{ padding: 16, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
                <span style={{ width: 9, height: 9, borderRadius: 999, background: pgColor(slug) }} />
                <span style={{ fontSize: 13, fontWeight: 800, color: slug === 'joola' ? '#22c55e' : '#fff' }}>
                  {name(slug)}
                </span>
                <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>
                  {total} readable ad{total === 1 ? '' : 's'}
                  {total > MAX_ADS_PER_BRAND ? ` · showing ${MAX_ADS_PER_BRAND} newest` : ''}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                {list.map((c) => (
                  <AdBox key={c.key} card={c} />
                ))}
              </div>
            </div>
          )
        })}
      </section>

      {/* ─── §5 The claims they make ──────────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              The claims they make
              <SectionInfo
                title="The claims they make"
                description="Every ad is filed under the one main promise it makes, by keyword rules — no AI call, so the same ads always give the same answer. Repeated copy is counted once, so a line running across 30 ads is one claim, not thirty. Ads with no readable copy are left out rather than piled into 'Not classified'."
                source="marketing_ads.body, keyword classifier"
              />
            </h2>
            <div className="sub">
              What each brand promises the customer. Where JOOLA has none and rivals have many,
              that is either an opening or a decision you have already made.
            </div>
          </div>
        </div>
        <div className="card" style={{ padding: 0 }}>
          {themes.length === 0 && (
            <div style={{ padding: 18, color: 'var(--fg-4)', fontSize: 12 }}>No readable ad copy for this filter.</div>
          )}
          {themes.map((t) => {
            const unclassified = t.theme === UNTHEMED
            const stance = unclassified
              ? { label: 'not a claim', color: 'var(--fg-4)', bg: 'var(--wb-5)' }
              : t.stance === 'own'
                ? { label: 'JOOLA leads this', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' }
                : t.stance === 'absent'
                  ? { label: 'JOOLA says nothing here', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' }
                  : t.stance === 'behind'
                    ? { label: 'they out-say JOOLA', color: '#F5E625', bg: 'rgba(245,230,37,0.12)' }
                    : { label: 'contested', color: 'var(--fg-2)', bg: 'var(--wb-5)' }
            return (
              <div key={t.theme} style={{ padding: '14px 18px', borderBottom: '1px solid var(--wb-5)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: unclassified ? 'var(--fg-4)' : '#fff' }}>
                    {unclassified ? 'Not classified' : t.theme}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>
                    {t.total} message{t.total === 1 ? '' : 's'} from {t.brandCount} brand{t.brandCount === 1 ? '' : 's'}
                  </span>
                  <span style={{ fontSize: 9.5, fontWeight: 800, padding: '3px 9px', borderRadius: 999, background: stance.bg, color: stance.color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {stance.label}
                  </span>
                </div>

                {t.example && (
                  <div style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--fg-2)', margin: '0 0 8px', paddingLeft: 10, borderLeft: '2px solid var(--wb-5)' }}>
                    &ldquo;{t.example.length > 130 ? t.example.slice(0, 130) + '…' : t.example}&rdquo;
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 11 }}>
                  {t.leader && (
                    <span style={{ color: 'var(--fg-4)' }}>
                      Most:{' '}
                      <strong style={{ color: pgColor(t.leader.slug) }}>{name(t.leader.slug)}</strong>{' '}
                      ({t.leader.count})
                    </span>
                  )}
                  <span style={{ color: 'var(--fg-4)' }}>
                    JOOLA:{' '}
                    <strong style={{ color: t.joola > 0 ? '#22c55e' : '#ef4444' }}>{t.joola}</strong>
                  </span>
                  <span style={{ display: 'flex', flex: 1, minWidth: 140, height: 8, borderRadius: 999, overflow: 'hidden', background: 'var(--wb-5)' }}>
                    {Object.entries(t.byBrand)
                      .sort((a, b) => b[1] - a[1])
                      .map(([slug, count]) => (
                        <span
                          key={slug}
                          title={`${name(slug)}: ${count}`}
                          style={{ width: `${(count / t.total) * 100}%`, background: slug === 'joola' ? '#22c55e' : pgColor(slug) }}
                        />
                      ))}
                  </span>
                </div>
              </div>
            )
          })}
          <div style={{ padding: '10px 18px', fontSize: 11, color: 'var(--fg-4)' }}>
            Hover any bar segment to see which brand it is. &ldquo;Not classified&rdquo; is copy the
            keyword rules could not place — it is shown for honesty, not as a finding.
          </div>
        </div>
      </section>

      {/* ─── §6 Where they're spending ────────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Where they&apos;re spending
              <SectionInfo
                title="Where they're spending"
                description="Google means chasing people already searching for a paddle. Facebook and Instagram mean creating the want in the first place. Different intent, different counter-move."
                source="marketing_ads.platform + publisher_platforms"
              />
            </h2>
            <div className="sub">
              Search versus social, per brand.
              {!data.hasPlacementData && (
                <span style={{ color: '#F5E625' }}> Facebook/Instagram split needs migration 026.</span>
              )}
            </div>
          </div>
        </div>
        <div className="card" style={{ padding: 18, overflowX: 'auto' }}>
          {/* Facebook and Instagram are only distinguishable once migrations/026
            * stores publisher_platforms. Before that they would be two columns of
            * dots eating a third of the width, so the table collapses to
            * Google | Meta and the note above says why. */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12, fontSize: 11, color: 'var(--fg-4)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: SEARCH_COLOR }} />
              Google — chasing people already searching
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: SOCIAL_COLOR }} />
              Meta — creating the want
            </span>
          </div>
          <table className="data" style={{ width: '100%', minWidth: 620, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 190 }} />
              {/* The mix bar takes the slack. On a wide screen a fixed brand
                * column leaves a dead gap between names and numbers; this is
                * the one thing the section is actually about, so it goes there. */}
              <col />
              <col style={{ width: 90 }} />
              {data.hasPlacementData ? (
                <>
                  <col style={{ width: 90 }} />
                  <col style={{ width: 90 }} />
                </>
              ) : (
                <col style={{ width: 90 }} />
              )}
              <col style={{ width: 80 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Brand</th>
                <th style={{ textAlign: 'left' }}>Search vs social</th>
                <th style={{ textAlign: 'right' }}>Google</th>
                {data.hasPlacementData ? (
                  <>
                    <th style={{ textAlign: 'right' }}>Facebook</th>
                    <th style={{ textAlign: 'right' }}>Instagram</th>
                  </>
                ) : (
                  <th style={{ textAlign: 'right' }}>Meta</th>
                )}
                <th style={{ textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {placements.map((p) => {
                const meta = p.facebook + p.instagram + p.otherMeta
                const total = p.google + meta
                const dot = <span style={{ color: '#3a4150' }}>·</span>
                return (
                  <tr key={p.slug}>
                    <td style={{ textAlign: 'left' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: pgColor(p.slug), flexShrink: 0 }} />
                        <span style={{ fontWeight: 700, color: p.slug === 'joola' ? '#22c55e' : 'inherit' }}>{name(p.slug)}</span>
                      </span>
                    </td>
                    <td>
                      <span style={{ display: 'flex', height: 9, borderRadius: 999, overflow: 'hidden', background: 'var(--wb-5)' }}>
                        {p.google > 0 && (
                          <span
                            title={`Google: ${p.google} of ${total}`}
                            style={{ width: `${(p.google / Math.max(1, total)) * 100}%`, background: SEARCH_COLOR }}
                          />
                        )}
                        {meta > 0 && (
                          <span
                            title={`Meta: ${meta} of ${total}`}
                            style={{ width: `${(meta / Math.max(1, total)) * 100}%`, background: SOCIAL_COLOR }}
                          />
                        )}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>{p.google || dot}</td>
                    {data.hasPlacementData ? (
                      <>
                        <td style={{ textAlign: 'right' }}>{p.facebook || dot}</td>
                        <td style={{ textAlign: 'right' }}>{p.instagram || dot}</td>
                      </>
                    ) : (
                      <td style={{ textAlign: 'right' }}>{meta || dot}</td>
                    )}
                    <td style={{ textAlign: 'right', fontWeight: 800, color: '#fff' }}>{total || dot}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── §5 What's brand new ──────────────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              What&apos;s brand new
              <SectionInfo
                title="What's brand new"
                description={`Ads first seen in the last ${NEW_WINDOW_DAYS} days, newest first. Several from one brand in the same week is a campaign starting — usually weeks before any announcement.`}
                source="marketing_ads.started_at"
              />
            </h2>
            <div className="sub">Ads that appeared in the last {NEW_WINDOW_DAYS} days.</div>
          </div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          {newAds.length === 0 && (
            <div style={{ color: 'var(--fg-4)', fontSize: 12 }}>
              Nothing new in the last {NEW_WINDOW_DAYS} days for this filter.
            </div>
          )}
          {newAds.map((c) => (
            <div
              key={c.key}
              style={{
                display: 'grid',
                gridTemplateColumns: '130px 1fr 130px 100px',
                alignItems: 'center',
                gap: 12,
                padding: '9px 0',
                borderBottom: '1px solid var(--wb-5)',
                fontSize: 12,
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, overflow: 'hidden' }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: pgColor(c.brandSlug), flexShrink: 0 }} />
                <span style={{ fontWeight: 700, color: c.brandSlug === 'joola' ? '#22c55e' : 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name(c.brandSlug)}
                </span>
              </span>
              <span style={{ color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.body || c.title || <span style={{ color: 'var(--fg-4)' }}>no readable copy ({placementLabel(c)})</span>}
              </span>
              <span style={{ color: 'var(--fg-4)', fontSize: 11 }}>{placementLabel(c)}</span>
              <span style={{ textAlign: 'right', color: 'var(--fg-4)', fontSize: 11 }}>{shortDate(c.startedAt)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ─── §6 What's working for them ───────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              What&apos;s working for them
              <SectionInfo
                title="What's working for them"
                description="How long each ad has been running. Nobody pays to keep a losing ad live for months, so a long run is a competitor telling you — at their expense — which message converts. A '+' means the ad is still live, so the number is a floor, not a total."
                source="marketing_ads.started_at, last_shown, approx_days_shown"
              />
            </h2>
            <div className="sub">
              Longest-running ads first.
              {!data.hasDurationData && (
                <span style={{ color: '#F5E625' }}>
                  {' '}Facebook and Instagram only — Google&apos;s run lengths need migration 026. A &ldquo;+&rdquo;
                  means the ad is still live, so the number is a floor.
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          {longest.length === 0 && <div style={{ color: 'var(--fg-4)', fontSize: 12 }}>No dated ads for this filter.</div>}
          {longest.map((c) => (
            <div
              key={c.key}
              style={{
                display: 'grid',
                gridTemplateColumns: '130px 1fr 90px',
                alignItems: 'center',
                gap: 12,
                padding: '9px 0',
                borderBottom: '1px solid var(--wb-5)',
                fontSize: 12,
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, overflow: 'hidden' }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: pgColor(c.brandSlug), flexShrink: 0 }} />
                <span style={{ fontWeight: 700, color: c.brandSlug === 'joola' ? '#22c55e' : 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name(c.brandSlug)}
                </span>
              </span>
              <span style={{ color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.body || c.title || <span style={{ color: 'var(--fg-4)' }}>no readable copy ({placementLabel(c)})</span>}
              </span>
              <span style={{ textAlign: 'right', fontWeight: 800, color: '#F5E625' }}>
                {c.daysRunning}
                {c.daysRunningIsMinimum ? '+' : ''} days
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ─── §7 Who's cutting prices ──────────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Who&apos;s cutting prices
              <SectionInfo
                title="Who's cutting prices"
                description={`Discount banners found on competitor homepages. There is no end date in the source, so "live" means seen in the last ${PROMO_ACTIVE_DAYS} days. Only a minority of banners state a readable percentage; the rest are shown as their own words rather than converted into a number nobody published.`}
                source="promotions, scraped weekly from brand homepages"
              />
            </h2>
            <div className="sub">
              Every discount banner found. Click a row to open the source.{' '}
              <span style={{ color: '#F5E625' }}>
                Only {promos.filter((p) => p.discountPct != null).length} of {promos.length} state a percentage.
              </span>
            </div>
          </div>
        </div>
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data" style={{ width: '100%', minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Brand</th>
                <th style={{ textAlign: 'left' }}>What the banner says</th>
                <th>Discount</th>
                <th>Seen</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {promos.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 18, color: 'var(--fg-4)', fontSize: 12, textAlign: 'center' }}>No discounts found for this filter.</td></tr>
              )}
              {promos.map((p) => (
                <tr
                  key={p.key}
                  style={{ cursor: p.sourceUrl ? 'pointer' : 'default' }}
                  onClick={() => p.sourceUrl && window.open(p.sourceUrl, '_blank', 'noopener,noreferrer')}
                >
                  <td style={{ textAlign: 'left' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: pgColor(p.brandSlug) }} />
                      <span style={{ fontWeight: 700, color: p.brandSlug === 'joola' ? '#22c55e' : 'inherit' }}>{name(p.brandSlug)}</span>
                    </span>
                  </td>
                  <td style={{ textAlign: 'left', color: 'var(--fg-2)' }}>{p.text}</td>
                  <td style={{ textAlign: 'right', color: p.discountPct != null ? '#F5E625' : 'var(--fg-4)' }}>
                    {p.discountPct != null ? `${p.discountPct}%` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--fg-4)', fontSize: 11 }}>{shortDate(p.detectedAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: p.isRecent ? 'rgba(34,197,94,0.12)' : 'var(--wb-5)', color: p.isRecent ? '#22c55e' : 'var(--fg-4)' }}>
                      {p.isRecent ? 'live' : 'old'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── §10 What you should do ───────────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              What you should do
              <SectionInfo
                title="What you should do"
                description="JOOLA's position on each lever, then suggestions derived only from numbers shown elsewhere on this page. Nothing here is asserted that you cannot scroll up and verify — if a line says a competitor added 47 ads, that count is in 'Who's speeding up'."
                source="Derived from the sections above"
              />
            </h2>
            <div className="sub">Your position, and what follows from it.</div>
          </div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 26, marginBottom: 16 }}>
            <Stat label="Ad rank" value={h.joolaRank ? `#${h.joolaRank}` : '—'} color="#22c55e" />
            <Stat label="JOOLA ads" value={fmt(h.joolaAds)} color="#22c55e" />
            <Stat
              label="Behind leader by"
              value={h.topBrand && h.topBrand.slug !== 'joola' ? fmt(h.topBrand.ads - h.joolaAds) : '—'}
              color="#F5E625"
            />
            <Stat label="JOOLA discounts" value={fmt(h.joolaPromos)} color={h.joolaPromos === 0 ? '#ef4444' : '#22c55e'} />
          </div>
          {actions.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>
              Nothing in the current data rises to a recommendation.
            </div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.9, color: 'var(--fg-2)' }}>
              {actions.map((a, i) => (
                <li key={i}>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      padding: '2px 7px',
                      borderRadius: 999,
                      marginRight: 8,
                      textTransform: 'uppercase',
                      letterSpacing: '0.07em',
                      background: a.severity === 'act' ? 'rgba(239,68,68,0.13)' : 'rgba(245,230,37,0.13)',
                      color: a.severity === 'act' ? '#ef4444' : '#F5E625',
                    }}
                  >
                    {a.severity}
                  </span>
                  {a.brandSlug && (
                    <strong style={{ color: pgColor(a.brandSlug) }}>{name(a.brandSlug)} </strong>
                  )}
                  {a.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}

/**
 * One competitor ad, shown as the ad.
 *
 * The image is attempted but not relied on: Meta's creative_url values are
 * signed CDN links that 403 within days of capture (all six sampled on
 * 2026-08-26 returned 403). Rather than render a broken-image icon, the <img>
 * removes itself on error and the card falls back to copy plus a link to the
 * archive entry, which does not expire.
 */
/** Button through to a brand's ads on a platform archive. Disabled, not
 *  hidden, when the brand runs nothing there — "no ads on Meta" is a finding,
 *  and an absent button reads as a missing feature. */
function ArchiveLink({ href, label, count }: { href: string | null; label: string; count: number }) {
  const style: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    padding: '3px 9px',
    borderRadius: 999,
    border: '1px solid var(--wb-5)',
    whiteSpace: 'nowrap',
  }
  if (!href || count === 0) {
    return (
      <span title={`No ${label} ads captured for this brand`} style={{ ...style, color: '#3a4150' }}>
        {label} —
      </span>
    )
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${label}'s ad archive for this brand (${count} ads captured)`}
      style={{ ...style, color: '#60a5fa' }}
    >
      {label} ↗
    </a>
  )
}

function AdBox({ card }: { card: AdCard }) {
  const [imgOk, setImgOk] = useState(true)
  const view = card.archiveUrl || card.landingUrl

  return (
    <div
      style={{
        border: '1px solid var(--wb-5)',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--wb-3)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {card.creativeUrl && imgOk && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={card.creativeUrl}
          alt=""
          loading="lazy"
          onError={() => setImgOk(false)}
          style={{ width: '100%', height: 150, objectFit: 'cover', display: 'block', background: 'var(--wb-5)' }}
        />
      )}
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 7, flex: 1 }}>
        {card.title && <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{card.title}</div>}
        <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--fg-1, #e8ecf3)' }}>{card.body}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 'auto', paddingTop: 4 }}>
          {card.cta && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: 'rgba(245,230,37,0.12)', color: '#F5E625' }}>
              {card.cta}
            </span>
          )}
          {card.variants > 1 && (
            <span
              title={`This exact wording runs across ${card.variants} separate ads — a message they are committed to, not testing.`}
              style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: 'var(--wb-5)', color: 'var(--fg-2)' }}
            >
              ×{card.variants} ads
            </span>
          )}
          <span style={{ fontSize: 10, color: 'var(--fg-4)' }}>{placementLabel(card)}</span>
          <span style={{ fontSize: 10, color: 'var(--fg-4)' }}>· {shortDate(card.startedAt)}</span>
          {view && (
            <a
              href={view}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 10, marginLeft: 'auto', color: '#60a5fa', whiteSpace: 'nowrap' }}
            >
              see the ad →
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', minWidth: 108 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{ fontSize: 19, fontWeight: 800, color: color || '#fff' }}>{value}</span>
    </div>
  )
}
