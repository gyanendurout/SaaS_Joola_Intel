'use client'

/**
 * Campaign & Offer Intel — unified data layer.
 *
 * Brings paid marketing (`marketing_ads`) and discount/launch promotions
 * (`promotions`) into ONE payload typed for the unified page at
 * /v2/campaign-offer-intel. Replaces the per-page fetchers used by the
 * legacy `/v2/ads` and `/v2/promotions` pages.
 *
 * Tables:
 *   marketing_ads(brand_id, platform 'meta'|'google', ad_id, page_name,
 *                 body, cta, creative_url, landing_url, started_at,
 *                 is_active, raw, captured_at)
 *   promotions(brand_id, banner_text, promo_type, discount_pct,
 *              source_url, detected_at)
 *
 * Dedup: ads keyed on `ad_id` (DB unique on (platform, ad_id)) with
 * fallback `${platform}::${brand}::${normalizedCopy}::${cta}`.
 * Promos keyed on `id` (DB unique on (brand_id, banner_text)) with
 * fallback `${brand}::${normalizedText}::${detectedDate}`.
 */

import { supabase } from '@/lib/shared/supabase'
import { type V2Brand } from '@/lib/v2/data'

// ─── Raw row types (mirror DB schema) ──────────────────────────────────
export interface RawMarketingAd {
  id: string
  brand_id: string
  platform: string                 // 'meta' | 'google' (per scrape scripts)
  ad_id: string | null
  page_name: string | null
  body: string | null
  cta: string | null
  creative_url: string | null
  landing_url: string | null
  started_at: string | null
  is_active: boolean | null
  captured_at: string | null
}

export interface RawPromotion {
  id: string
  brand_id: string
  banner_text: string
  promo_type: string | null        // 'discount' | 'free_shipping' | 'bundle' | 'launch' | 'other'
  discount_pct: number | null
  source_url: string | null
  detected_at: string | null
}

// ─── Display shapes (used by the page directly) ───────────────────────
export interface AdCreative {
  id: string                        // stable key (ad_id or fallback hash)
  brand: string                     // slug
  brandName: string
  platform: string                  // pretty-cased: 'Meta' | 'Google' | other
  rawPlatform: string               // lowercase from DB
  pageName: string
  copy: string
  cta: string
  startedAt: string | null
  active: boolean
  sourceUrl: string                 // landing_url -> Meta lib search fallback
  creativeUrl: string | null
}

export interface ActiveOffer {
  id: string                        // stable key (DB id or fallback hash)
  brand: string                     // slug
  brandName: string
  text: string                      // banner_text
  type: string                      // promo_type or 'other'
  discount: number | null
  detectedAt: string | null
  sourceUrl: string | null
  active: boolean                   // detected_at within last 60d
}

export interface AdStat {
  brand: string                     // slug
  total: number
  active: number
  meta: number
  google: number
  other: number
  share: number                     // % of total ads in current dataset
}

export interface PromoStat {
  brand: string                     // slug
  count: number
  discountCount: number
  avgDiscount: number               // 0 when none
  types: string[]
  pct: number                       // % of total promos in current dataset
}

export interface PlatformStat {
  platform: string                  // raw lowercase
  pretty: string
  count: number
  pct: number
}

export interface PromotionTypeStat {
  type: string
  count: number
  pct: number
}

export interface CampaignPressureStat {
  brand: string
  ads: number
  promos: number
  adShare: number                   // 0..100
  promoShare: number                // 0..100
  avgDiscount: number               // 0 when no discount
  /**
   * Pressure score = normalized ad share + normalized promo share, on a
   * 0..100 scale where each side contributes up to 50.
   *
   * Formula:  pressure = 50 * ads / maxAds + 50 * promos / maxPromos
   * Justification:  treats paid acquisition and price discounting as
   * equally weighted competitive levers. Leaders in either category
   * surface at the top; brands that lead in both pin to 100.
   */
  pressure: number
}

export interface ActivityTrendPoint {
  weekIndex: number                 // 0 = oldest, weeks-1 = current
  weekLabel: string                 // 'Apr 28'
  perBrandAds: Record<string, number>
}

export interface PromoCadenceRow {
  brand: string
  weeks: number[]                   // 0 or 1 per week
}

export interface JoolaPosition {
  hasJoola: boolean
  activeAds: number
  totalAds: number
  adShare: number                   // %
  adRank: number | null
  promos: number
  promoShare: number                // %
  promoRank: number | null
  avgDiscount: number
  topAdBrand: string | null         // slug
  topAdBrandAds: number
  topPromoBrand: string | null
  topPromoBrandPromos: number
  adGapToLeader: number             // top - joola
  promoGapToLeader: number
}

export interface CampaignOfferDataStatus {
  hasAds: boolean
  hasPromos: boolean
  hasPlatform: boolean
  hasCta: boolean
  hasSourceUrl: boolean
  adRowCount: number
  promoRowCount: number
}

export interface CampaignOfferIntelData {
  brands: V2Brand[]
  ads: AdCreative[]
  promotions: ActiveOffer[]
  adStatsByBrand: AdStat[]
  promoStatsByBrand: PromoStat[]
  platformStats: PlatformStat[]
  promotionTypeStats: PromotionTypeStat[]
  campaignPressureStats: CampaignPressureStat[]
  activityTrend: ActivityTrendPoint[]
  promoCadence: PromoCadenceRow[]
  activeOffers: ActiveOffer[]
  adCreatives: AdCreative[]
  joolaPosition: JoolaPosition
  dataStatus: CampaignOfferDataStatus
}

// ─── Helpers ───────────────────────────────────────────────────────────
function normalizeText(raw: string | null | undefined): string {
  if (!raw) return ''
  return String(raw).toLowerCase().replace(/\s+/g, ' ').trim()
}

function prettyPlatform(p: string | null | undefined): string {
  const s = String(p ?? '').toLowerCase()
  if (s === 'meta') return 'Meta'
  if (s === 'google') return 'Google'
  if (s === 'facebook') return 'Meta'
  if (s === 'instagram') return 'Meta'
  if (!s) return '—'
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function weekLabel(weeksAgo: number): string {
  const d = new Date(Date.now() - weeksAgo * 7 * 86_400_000)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function metaAdsLibrarySearch(brandName: string): string {
  const q = encodeURIComponent(brandName)
  return `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&q=${q}&search_type=keyword_unordered`
}

// ─── Main fetcher ─────────────────────────────────────────────────────
export async function fetchCampaignOfferIntel(
  brands: V2Brand[],
  opts: { from: Date; to: Date },
): Promise<CampaignOfferIntelData> {
  const slugByBid: Record<string, string> = Object.fromEntries(
    brands.map((b) => [b.brand_id, b.id]),
  )
  const nameBySlug: Record<string, string> = Object.fromEntries(
    brands.map((b) => [b.id, b.name]),
  )

  const [adsRes, promosRes] = await Promise.all([
    supabase
      .from('marketing_ads')
      .select(
        'id,brand_id,platform,ad_id,page_name,body,cta,creative_url,landing_url,started_at,is_active,captured_at',
      )
      .order('captured_at', { ascending: false })
      .limit(5000),
    supabase
      .from('promotions')
      .select('id,brand_id,banner_text,promo_type,discount_pct,source_url,detected_at')
      .order('detected_at', { ascending: false })
      .limit(2000),
  ])

  const adRaw = ((adsRes.data as unknown) || []) as RawMarketingAd[]
  const promoRaw = ((promosRes.data as unknown) || []) as RawPromotion[]

  // ─── Dedup ads ──────────────────────────────────────────────────────
  const adSeen = new Map<string, AdCreative>()
  let hasPlatform = false
  let hasCta = false
  let hasSourceUrl = false
  adRaw.forEach((a) => {
    const slug = slugByBid[a.brand_id]
    if (!slug) return
    const platformRaw = String(a.platform ?? '').toLowerCase()
    const pretty = prettyPlatform(platformRaw)
    if (platformRaw) hasPlatform = true
    if (a.cta) hasCta = true
    const landing = a.landing_url || ''
    const creative = a.creative_url || ''
    if (landing || creative) hasSourceUrl = true
    const copy = a.body || ''
    const key = a.ad_id
      ? `id::${platformRaw}::${a.ad_id}`
      : `fb::${platformRaw}::${slug}::${normalizeText(copy)}::${normalizeText(a.cta)}`
    if (adSeen.has(key)) return
    adSeen.set(key, {
      id: key,
      brand: slug,
      brandName: nameBySlug[slug] || slug,
      platform: pretty,
      rawPlatform: platformRaw || 'other',
      pageName: a.page_name || '',
      copy,
      cta: a.cta || '',
      startedAt: a.started_at,
      active: !!a.is_active,
      sourceUrl: landing || metaAdsLibrarySearch(nameBySlug[slug] || slug),
      creativeUrl: creative || null,
    })
  })
  const ads: AdCreative[] = Array.from(adSeen.values())

  // ─── Dedup promotions + recency flag ────────────────────────────────
  const promoSeen = new Map<string, ActiveOffer>()
  const now = Date.now()
  promoRaw.forEach((p) => {
    const slug = slugByBid[p.brand_id]
    if (!slug) return
    const text = p.banner_text || ''
    const detected = p.detected_at
    const key = p.id
      ? `id::${p.id}`
      : `fb::${slug}::${normalizeText(text)}::${detected || ''}`
    if (promoSeen.has(key)) return
    const detectedTs = detected ? new Date(detected).getTime() : null
    // "Active" = detected within the past 60 days. The DB has no end_at
    // column on promotions, so freshness is our only proxy.
    const active = detectedTs != null && (now - detectedTs) <= 60 * 86_400_000
    promoSeen.set(key, {
      id: key,
      brand: slug,
      brandName: nameBySlug[slug] || slug,
      text,
      type: p.promo_type || 'other',
      discount: p.discount_pct != null ? Number(p.discount_pct) : null,
      detectedAt: detected,
      sourceUrl: p.source_url,
      active,
    })
  })
  const promotions: ActiveOffer[] = Array.from(promoSeen.values())

  // ─── Date-window filter ─────────────────────────────────────────────
  const fromTs = opts.from.getTime()
  const toTs = opts.to.getTime() + 86_400_000 - 1
  const adsInRange = ads.filter((a) => {
    const ref = a.startedAt || null
    if (!ref) return true                 // unknown date → keep visible
    const t = new Date(ref).getTime()
    return t >= fromTs && t <= toTs
  })
  const promosInRange = promotions.filter((p) => {
    if (!p.detectedAt) return true
    const t = new Date(p.detectedAt).getTime()
    return t >= fromTs && t <= toTs
  })

  // ─── Brand stats ────────────────────────────────────────────────────
  const adAgg: Record<string, AdStat> = {}
  adsInRange.forEach((a) => {
    if (!adAgg[a.brand]) {
      adAgg[a.brand] = { brand: a.brand, total: 0, active: 0, meta: 0, google: 0, other: 0, share: 0 }
    }
    const row = adAgg[a.brand]
    row.total++
    if (a.active) row.active++
    if (a.rawPlatform === 'meta') row.meta++
    else if (a.rawPlatform === 'google') row.google++
    else row.other++
  })
  const adStatsList: AdStat[] = brands.map((b) =>
    adAgg[b.id] || { brand: b.id, total: 0, active: 0, meta: 0, google: 0, other: 0, share: 0 },
  )
  const totalAdsAll = adStatsList.reduce((s, r) => s + r.total, 0) || 1
  adStatsList.forEach((r) => (r.share = (r.total / totalAdsAll) * 100))
  adStatsList.sort((a, b) => b.total - a.total)

  const promoAgg: Record<string, PromoStat> = {}
  promosInRange.forEach((p) => {
    if (!promoAgg[p.brand]) {
      promoAgg[p.brand] = { brand: p.brand, count: 0, discountCount: 0, avgDiscount: 0, types: [], pct: 0 }
    }
    const row = promoAgg[p.brand]
    row.count++
    if (p.discount != null && p.discount > 0) {
      row.discountCount++
      // running sum stored in avgDiscount until we normalize below
      row.avgDiscount += p.discount
    }
    if (p.type && !row.types.includes(p.type)) row.types.push(p.type)
  })
  const promoStatsList: PromoStat[] = brands.map((b) =>
    promoAgg[b.id] || { brand: b.id, count: 0, discountCount: 0, avgDiscount: 0, types: [], pct: 0 },
  )
  promoStatsList.forEach((r) => {
    r.avgDiscount = r.discountCount > 0 ? Math.round(r.avgDiscount / r.discountCount) : 0
  })
  const totalPromosAll = promoStatsList.reduce((s, r) => s + r.count, 0) || 1
  promoStatsList.forEach((r) => (r.pct = (r.count / totalPromosAll) * 100))
  promoStatsList.sort((a, b) => b.count - a.count)

  // ─── Pressure score ─────────────────────────────────────────────────
  const maxAds = Math.max(1, ...adStatsList.map((r) => r.total))
  const maxPromos = Math.max(1, ...promoStatsList.map((r) => r.count))
  const adByBrand: Record<string, AdStat> = Object.fromEntries(adStatsList.map((r) => [r.brand, r]))
  const promoByBrand: Record<string, PromoStat> = Object.fromEntries(promoStatsList.map((r) => [r.brand, r]))
  const campaignPressureStats: CampaignPressureStat[] = brands.map((b) => {
    const a = adByBrand[b.id]
    const p = promoByBrand[b.id]
    const ads = a?.total || 0
    const promos = p?.count || 0
    const pressure = 50 * (ads / maxAds) + 50 * (promos / maxPromos)
    return {
      brand: b.id,
      ads,
      promos,
      adShare: a?.share || 0,
      promoShare: p?.pct || 0,
      avgDiscount: p?.avgDiscount || 0,
      pressure: Math.round(pressure * 10) / 10,
    }
  }).sort((a, b) => b.pressure - a.pressure)

  // ─── Platform mix ──────────────────────────────────────────────────
  const platMap: Record<string, number> = {}
  adsInRange.forEach((a) => {
    const key = a.rawPlatform || 'other'
    platMap[key] = (platMap[key] || 0) + 1
  })
  const platformStats: PlatformStat[] = Object.entries(platMap)
    .map(([k, v]) => ({
      platform: k,
      pretty: prettyPlatform(k),
      count: v,
      pct: (v / Math.max(1, adsInRange.length)) * 100,
    }))
    .sort((a, b) => b.count - a.count)

  // ─── Promotion type mix ────────────────────────────────────────────
  const typeMap: Record<string, number> = {}
  promosInRange.forEach((p) => {
    const key = p.type || 'other'
    typeMap[key] = (typeMap[key] || 0) + 1
  })
  const promotionTypeStats: PromotionTypeStat[] = Object.entries(typeMap)
    .map(([k, v]) => ({
      type: k,
      count: v,
      pct: (v / Math.max(1, promosInRange.length)) * 100,
    }))
    .sort((a, b) => b.count - a.count)

  // ─── Activity trend (weekly ad volume per brand) ───────────────────
  const weeks = 13
  const startOfWindow = now - weeks * 7 * 86_400_000
  const buckets: Record<string, number>[] = Array.from({ length: weeks }, () => ({}))
  adsInRange.forEach((a) => {
    const ref = a.startedAt ? new Date(a.startedAt).getTime() : (a.id ? null : null)
    if (!ref) return
    if (ref < startOfWindow) return
    const idx = Math.min(weeks - 1, Math.floor((ref - startOfWindow) / (7 * 86_400_000)))
    buckets[idx][a.brand] = (buckets[idx][a.brand] || 0) + 1
  })
  const activityTrend: ActivityTrendPoint[] = buckets.map((per, i) => ({
    weekIndex: i,
    weekLabel: weekLabel(weeks - 1 - i),
    perBrandAds: per,
  }))

  // ─── Promo cadence (per-brand 13-week heatmap) ─────────────────────
  const cadenceWeeks = 13
  const cadenceStart = now - cadenceWeeks * 7 * 86_400_000
  const cadenceMap: Record<string, number[]> = {}
  brands.forEach((b) => { cadenceMap[b.id] = Array(cadenceWeeks).fill(0) })
  promosInRange.forEach((p) => {
    if (!p.detectedAt) return
    const t = new Date(p.detectedAt).getTime()
    if (t < cadenceStart) return
    const idx = Math.min(cadenceWeeks - 1, Math.floor((t - cadenceStart) / (7 * 86_400_000)))
    if (cadenceMap[p.brand]) cadenceMap[p.brand][idx] = 1
  })
  const promoCadence: PromoCadenceRow[] = Object.entries(cadenceMap)
    .filter(([, weeks]) => weeks.some((w) => w > 0))
    .map(([brand, weeks]) => ({ brand, weeks }))

  // ─── JOOLA position ────────────────────────────────────────────────
  const joolaAd = adStatsList.find((r) => r.brand === 'joola')
  const joolaPromo = promoStatsList.find((r) => r.brand === 'joola')
  const adRank = joolaAd ? adStatsList.findIndex((r) => r.brand === 'joola') + 1 : null
  const promoRank = joolaPromo ? promoStatsList.findIndex((r) => r.brand === 'joola') + 1 : null
  const topAd = adStatsList.find((r) => r.brand !== 'joola' && r.total > 0) || adStatsList[0]
  const topPromo = promoStatsList.find((r) => r.brand !== 'joola' && r.count > 0) || promoStatsList[0]
  const joolaPosition: JoolaPosition = {
    hasJoola: !!joolaAd || !!joolaPromo,
    activeAds: joolaAd?.active || 0,
    totalAds: joolaAd?.total || 0,
    adShare: joolaAd?.share || 0,
    adRank,
    promos: joolaPromo?.count || 0,
    promoShare: joolaPromo?.pct || 0,
    promoRank,
    avgDiscount: joolaPromo?.avgDiscount || 0,
    topAdBrand: topAd?.brand || null,
    topAdBrandAds: topAd?.total || 0,
    topPromoBrand: topPromo?.brand || null,
    topPromoBrandPromos: topPromo?.count || 0,
    adGapToLeader: (topAd?.total || 0) - (joolaAd?.total || 0),
    promoGapToLeader: (topPromo?.count || 0) - (joolaPromo?.count || 0),
  }

  const dataStatus: CampaignOfferDataStatus = {
    hasAds: adsInRange.length > 0,
    hasPromos: promosInRange.length > 0,
    hasPlatform,
    hasCta,
    hasSourceUrl,
    adRowCount: ads.length,
    promoRowCount: promotions.length,
  }

  return {
    brands,
    ads: adsInRange,
    promotions: promosInRange,
    adStatsByBrand: adStatsList,
    promoStatsByBrand: promoStatsList,
    platformStats,
    promotionTypeStats,
    campaignPressureStats,
    activityTrend,
    promoCadence,
    activeOffers: promosInRange,
    adCreatives: adsInRange,
    joolaPosition,
    dataStatus,
  }
}
