/**
 * Campaign & Offer Intel — data layer.
 *
 * Four sections, executive-level:
 *
 *   §1  Summary cards      scale, channel split, volume leader, live offers
 *   §2  Brand breakdown    where each competitor puts its budget + deep links
 *   §3  Evergreen gallery  the ads they have paid to keep running longest
 *   §4  Messaging & offers CTA mix and the discount banners
 *
 * EVERY ROW AND CARD LINKS OUT to the platform's own public archive, so a
 * reader can always go and watch the real ad running.
 *
 * THREE PLACES WHERE THE OBVIOUS NUMBER IS THE WRONG ONE
 *
 * 1. "Live" is NOT is_active. That column reads true on 1,601 of 1,606 rows
 *    because the Google actor returns no active flag and the mapping defaulted
 *    it. last_shown is now 100% populated, and by it only ~705 ads were seen in
 *    the last 30 days. Recency is the honest measure.
 *
 * 2. Not all 63 promotions are live. promotions has no end date and only 8 were
 *    detected in the last 60 days; the other 55 are history.
 *
 * 3. Google publishes no ad copy. 908 of 1,606 ads have no body, cta or
 *    landing_url — the transparency centre's limit, not a gap here. Cards for
 *    those ads say so and link to the archive rather than render an empty box.
 */
import { supabase } from '@/lib/shared/supabase'
import { fetchPaged, fetchPagedResult } from '@/lib/v2/paged'
import type { V2Brand } from '@/lib/v2/data'

export const DAY = 86_400_000
/** An ad counts as live if the archive still showed it this recently. */
export const LIVE_WINDOW_DAYS = 30
/** promotions has no end_at, so recency is the only available proxy. */
export const PROMO_ACTIVE_DAYS = 60
/** Below this, a long run is just an ad nobody got round to switching off. */
export const EVERGREEN_MIN_DAYS = 60

export interface RawAd {
  brand_id: string
  platform: string | null
  ad_id: string
  body: string | null
  cta: string | null
  creative_url: string | null
  landing_url: string | null
  started_at: string | null
  is_active: boolean | null
  ad_title?: string | null
  publisher_platforms?: string[] | null
  last_shown?: string | null
  approx_days_shown?: number | null
  ad_format?: string | null
  archive_url?: string | null
  is_template_ad?: boolean | null
  advertiser_id?: string | null
  page_id?: string | null
}

export interface RawPromo {
  brand_id: string
  banner_text: string | null
  promo_type: string | null
  discount_pct: number | null
  source_url: string | null
  detected_at: string | null
}

export interface AdCard {
  key: string
  brandSlug: string
  platform: string
  title: string | null
  body: string | null
  cta: string | null
  format: string | null
  landingUrl: string | null
  creativeUrl: string | null
  /** The ad on the platform's own archive. Does not expire. */
  archiveUrl: string | null
  startedAt: string | null
  lastShown: string | null
  runtimeDays: number | null
  isLive: boolean
  placements: string[]
}

export interface BrandRow {
  slug: string
  total: number
  google: number
  meta: number
  live: number
  /** Dominant Google creative format; Meta does not publish one. */
  formatLabel: string
  /** Plain-language read of where the budget goes. */
  strategy: string
  googleAdsUrl: string | null
  metaAdsUrl: string | null
  promos: number
}

export interface PromoRow {
  key: string
  brandSlug: string
  text: string
  type: string | null
  discountPct: number | null
  detectedAt: string | null
  sourceUrl: string | null
  isRecent: boolean
}

export interface CtaRow {
  label: string
  count: number
}

export interface Summary {
  totalAds: number
  liveAds: number
  google: number
  meta: number
  googlePct: number
  metaPct: number
  topBrand: { slug: string; ads: number } | null
  promoTotal: number
  promoRecent: number
  promoDomains: number
  promoBrands: number
  /** Ads whose words the archives actually publish. */
  readable: number
}

export interface CampaignIntelData {
  summary: Summary
  brands: BrandRow[]
  evergreen: AdCard[]
  ctas: CtaRow[]
  promos: PromoRow[]
  hasRuntimeData: boolean
}

/* The select strings below MUST stay single inline literals. supabase-js parses
 * them at type level to infer the row shape; building one by concatenation
 * erases the literal type and the result degrades to GenericStringError[],
 * which fails to assign to RawAd[]. */

/* migrations/026 is applied by hand, so this must render on either schema.
 * fetchPaged SWALLOWS PostgREST errors and returns [] rather than throwing, so
 * a try/catch here would be dead code and an unknown-column 400 would render as
 * "this brand runs no ads". fetchPagedResult exposes `ok` for exactly this. */
async function fetchAds(): Promise<{ rows: RawAd[]; rich: boolean }> {
  const rich = await fetchPagedResult<RawAd>(
    () => supabase
        .from('marketing_ads')
        .select('brand_id,platform,ad_id,body,cta,creative_url,landing_url,started_at,is_active,ad_title,publisher_platforms,last_shown,approx_days_shown,ad_format,archive_url,is_template_ad,advertiser_id:raw->>advertiserId,page_id:raw->>pageId')
        .order('started_at', { ascending: false }),
    { label: 'marketing_ads (026)' },
  )
  if (rich.ok) return { rows: rich.data, rich: true }
  const base = await fetchPaged<RawAd>(
    () => supabase
        .from('marketing_ads')
        .select('brand_id,platform,ad_id,body,cta,creative_url,landing_url,started_at,is_active,advertiser_id:raw->>advertiserId,page_id:raw->>pageId')
        .order('started_at', { ascending: false }),
    { label: 'marketing_ads (pre-026)' },
  )
  return { rows: base, rich: false }
}

function runtimeOf(r: RawAd): number | null {
  if (typeof r.approx_days_shown === 'number') return r.approx_days_shown
  if (r.started_at && r.last_shown) {
    const a = Date.parse(r.started_at)
    const b = Date.parse(r.last_shown)
    if (!Number.isNaN(a) && !Number.isNaN(b) && b >= a) return Math.round((b - a) / DAY)
  }
  return null
}

/** The ad itself, on the platform that served it. */
function archiveOf(r: RawAd, platform: string): string | null {
  if (platform === 'google') return r.archive_url || null
  if (platform === 'meta') return 'https://www.facebook.com/ads/library/?id=' + r.ad_id
  return null
}

function strategyOf(google: number, meta: number): string {
  const total = google + meta
  if (total === 0) return 'No ads found'
  const g = google / total
  if (g >= 0.95) return 'Search capture only'
  if (g <= 0.05) return 'Social awareness only'
  if (g >= 0.6) return 'Search-led'
  if (g <= 0.4) return 'Social-led'
  return 'Balanced omnichannel'
}

export async function fetchCampaignIntel(brandList: V2Brand[]): Promise<CampaignIntelData> {
  const slugByBid: Record<string, string> = {}
  for (const b of brandList) slugByBid[b.brand_id] = b.id

  const [adResult, promoRows] = await Promise.all([
    fetchAds(),
    fetchPaged<RawPromo>(() =>
      supabase
        .from('promotions')
        .select('brand_id,banner_text,promo_type,discount_pct,source_url,detected_at')
        .order('detected_at', { ascending: false }),
    ),
  ])
  const adRows = adResult.rows
  const now = Date.now()
  const liveCutoff = now - LIVE_WINDOW_DAYS * DAY
  const promoCutoff = now - PROMO_ACTIVE_DAYS * DAY

  const rowBySlug = new Map<string, BrandRow>()
  const formats = new Map<string, Map<string, number>>()
  const advIds = new Map<string, Map<string, number>>()
  const pageIds = new Map<string, Map<string, number>>()
  const ctaCount = new Map<string, number>()
  const cards: AdCard[] = []
  let readable = 0
  let hasRuntime = false

  const bump = (store: Map<string, Map<string, number>>, slug: string, k: string) => {
    let inner = store.get(slug)
    if (!inner) {
      inner = new Map<string, number>()
      store.set(slug, inner)
    }
    inner.set(k, (inner.get(k) || 0) + 1)
  }
  const top = (store: Map<string, Map<string, number>>, slug: string): string | null => {
    const inner = store.get(slug)
    if (!inner) return null
    let best: string | null = null
    let bestN = 0
    for (const e of Array.from(inner.entries())) {
      if (e[1] > bestN) {
        best = e[0]
        bestN = e[1]
      }
    }
    return best
  }

  for (const r of adRows) {
    const slug = slugByBid[r.brand_id]
    if (!slug) continue
    const platform = (r.platform || 'unknown').toLowerCase()

    let row = rowBySlug.get(slug)
    if (!row) {
      row = {
        slug, total: 0, google: 0, meta: 0, live: 0,
        formatLabel: '—', strategy: '', googleAdsUrl: null, metaAdsUrl: null, promos: 0,
      }
      rowBySlug.set(slug, row)
    }
    row.total += 1
    if (platform === 'google') row.google += 1
    else if (platform === 'meta') row.meta += 1

    const lastShown = r.last_shown ? Date.parse(r.last_shown) : NaN
    const isLive = !Number.isNaN(lastShown) && lastShown >= liveCutoff
    if (isLive) row.live += 1

    if (r.ad_format) bump(formats, slug, r.ad_format)
    if (r.advertiser_id) bump(advIds, slug, r.advertiser_id)
    if (r.page_id) bump(pageIds, slug, r.page_id)
    if (r.cta) ctaCount.set(r.cta, (ctaCount.get(r.cta) || 0) + 1)

    // A dynamic catalogue ad's body is a {{token}} Meta fills at delivery.
    // It is not a written message and must not be shown as one.
    const body = r.is_template_ad ? null : r.body
    if (body) readable += 1
    const runtime = runtimeOf(r)
    if (runtime != null) hasRuntime = true

    // Template ads run forever by construction, so they prove nothing about a
    // message and are kept out of the evergreen gallery.
    if (!r.is_template_ad) {
      cards.push({
        key: platform + ':' + r.ad_id,
        brandSlug: slug,
        platform,
        title: r.ad_title ?? null,
        body,
        cta: r.cta,
        format: r.ad_format ?? null,
        landingUrl: r.landing_url,
        creativeUrl: r.creative_url,
        archiveUrl: archiveOf(r, platform),
        startedAt: r.started_at,
        lastShown: r.last_shown ?? null,
        runtimeDays: runtime,
        isLive,
        placements: (r.publisher_platforms || []).map((p) => String(p).toLowerCase()),
      })
    }
  }

  for (const row of Array.from(rowBySlug.values())) {
    const adv = top(advIds, row.slug)
    const page = top(pageIds, row.slug)
    // Direct advertiser/page permalinks, not a keyword search: a search URL can
    // return the wrong brand or nothing at all, and these ids are exact.
    row.googleAdsUrl = adv ? 'https://adstransparency.google.com/advertiser/' + adv + '?region=US' : null
    row.metaAdsUrl = page
      ? 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&view_all_page_id=' + page
      : null
    const f = top(formats, row.slug)
    row.formatLabel = f ? f[0].toUpperCase() + f.slice(1) : row.meta > 0 ? 'Not published' : '—'
    row.strategy = strategyOf(row.google, row.meta)
  }

  const promos: PromoRow[] = []
  const domains = new Set<string>()
  const promoBrands = new Set<string>()
  for (const r of promoRows) {
    const slug = slugByBid[r.brand_id]
    if (!slug) continue
    const text = (r.banner_text || '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    const ts = r.detected_at ? Date.parse(r.detected_at) : NaN
    const row = rowBySlug.get(slug)
    if (row) row.promos += 1
    if (r.source_url) domains.add(r.source_url)
    promoBrands.add(slug)
    promos.push({
      key: slug + ':' + text.slice(0, 40) + ':' + (r.detected_at || ''),
      brandSlug: slug,
      text,
      type: r.promo_type,
      discountPct: r.discount_pct,
      detectedAt: r.detected_at,
      sourceUrl: r.source_url,
      isRecent: !Number.isNaN(ts) && ts >= promoCutoff,
    })
  }
  promos.sort(
    (a, b) =>
      Number(b.isRecent) - Number(a.isRecent) ||
      Date.parse(b.detectedAt || '') - Date.parse(a.detectedAt || ''),
  )

  const evergreen = cards
    .filter((c) => c.runtimeDays != null && c.runtimeDays >= EVERGREEN_MIN_DAYS)
    .sort((a, b) => (b.runtimeDays || 0) - (a.runtimeDays || 0))

  const brands = Array.from(rowBySlug.values()).sort((a, b) => b.total - a.total)
  const ranked = brands.filter((b) => b.total > 0)
  const google = brands.reduce((s, b) => s + b.google, 0)
  const meta = brands.reduce((s, b) => s + b.meta, 0)
  const totalAds = google + meta

  const summary: Summary = {
    totalAds,
    liveAds: brands.reduce((s, b) => s + b.live, 0),
    google,
    meta,
    googlePct: totalAds > 0 ? Math.round((google / totalAds) * 1000) / 10 : 0,
    metaPct: totalAds > 0 ? Math.round((meta / totalAds) * 1000) / 10 : 0,
    topBrand: ranked.length > 0 ? { slug: ranked[0].slug, ads: ranked[0].total } : null,
    promoTotal: promos.length,
    promoRecent: promos.filter((p) => p.isRecent).length,
    promoDomains: domains.size,
    promoBrands: promoBrands.size,
    readable,
  }

  const ctas: CtaRow[] = Array.from(ctaCount.entries())
    .map((e) => ({ label: e[0], count: e[1] }))
    .sort((a, b) => b.count - a.count)

  return { summary, brands, evergreen, ctas, promos, hasRuntimeData: hasRuntime }
}
