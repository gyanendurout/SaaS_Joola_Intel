/**
 * Campaign Intel — data layer for the rebuilt /v2/campaign-offer-intel.
 *
 * Ten sections, each answering exactly one question:
 *
 *   §1   Headline       what changed
 *   §2   Who advertises  ad volume per brand
 *   §3   Momentum        last 4 weeks vs the 4 before
 *   §4   What they say   real ad copy, grouped per brand
 *   §5   Themes          what the market is crowding around
 *   §6   Where they buy  Google vs Meta, and Facebook vs Instagram
 *   §7   What's new      ads first seen in the last 30 days
 *   §8   What sticks     how long each ad has been running
 *   §9   Who discounts   promotion banners
 *   §10  Actions         derived only from the numbers above
 *
 * WHAT THIS PAGE WILL NOT DO
 * Google publishes no ad copy and no destination URL — its transparency centre
 * returns the image and the dates, nothing more. So the copy sections cover
 * Meta only, and say so on the page. Showing 698 Meta ads as though they were
 * the whole market would misread the 908 Google ads as silence.
 *
 * Meta dynamic-catalogue ads carry "{{product.brand}}" as their body — a token
 * filled in at delivery time. Those are excluded upstream (backend
 * ad_payload.py) rather than displayed as if a copywriter wrote them.
 */
import { supabase } from '@/lib/shared/supabase'
import { fetchPaged, fetchPagedResult } from '@/lib/v2/paged'
import type { V2Brand } from '@/lib/v2/data'

export const DAY = 86_400_000
export const NEW_WINDOW_DAYS = 30
/** promotions has no end_at column, so recency is the only available proxy. */
export const PROMO_ACTIVE_DAYS = 60

export interface RawAd {
  brand_id: string
  platform: string | null
  ad_id: string
  page_name: string | null
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
  is_template_ad?: boolean | null
  /* Projected out of the raw Apify payload by PostgREST (raw->>key), so the
   * brand-level archive links cost no extra query and no jsonb transfer. */
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
  landingUrl: string | null
  creativeUrl: string | null
  startedAt: string | null
  /** Days between first and last sighting. Null when it cannot be known. */
  daysRunning: number | null
  /** True when daysRunning is a floor, not a total (the ad is still live). */
  daysRunningIsMinimum: boolean
  placements: string[]
  /** How many separate ads run this exact copy. Advertisers pair one line with
   *  many creatives, so a high count is itself the signal: they are committed
   *  to the message, not testing it. */
  variants: number
  /** Permalink to the live ad. Meta creative_url values are signed CDN links
   *  that expire and 403 soon after capture, so the archive entry is the only
   *  durable way to see the actual ad. */
  archiveUrl: string | null
}

export interface BrandVolume {
  slug: string
  total: number
  meta: number
  google: number
  newLast30: number
  promos: number
  /** Ads whose copy can actually be read. */
  readable: number
  /** Every live ad this brand runs, on the platform's own archive. Built from
   *  the dominant advertiser/page id: several brands show more than one (Engage
   *  has 19 Google advertiser ids -- dealers running ads for the brand), and the
   *  account carrying the most ads is the brand's own. */
  googleAdsUrl: string | null
  metaAdsUrl: string | null
}

export interface PlacementSplit {
  slug: string
  google: number
  facebook: number
  instagram: number
  otherMeta: number
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

export interface Momentum {
  slug: string
  recent: number
  previous: number
  delta: number
  /** Null when the brand ran nothing in the prior window — growth from zero
   *  has no meaningful percentage and must not render as "+Infinity%". */
  pctChange: number | null
}

export interface ThemeRow {
  theme: string
  total: number
  byBrand: Record<string, number>
  /** How many distinct brands make this claim. */
  brandCount: number
  /** The brand making it most, and how often. */
  leader: { slug: string; count: number } | null
  joola: number
  /** A real ad that landed in this bucket, so the label is not abstract. */
  example: string | null
  /** How JOOLA stands: owns it, contested, outgunned, or absent. */
  stance: 'own' | 'contested' | 'behind' | 'absent'
}

export interface Action {
  severity: 'watch' | 'act'
  /** Rendered by the page through pgName(). Building the label here would
   *  bypass displayBrandName()'s rename map (Franklin -> Franklin Pickleball),
   *  which is the documented bypass this repo already has two cases of. */
  brandSlug?: string
  text: string
}

export interface Headline {
  totalAds: number
  brandsAdvertising: number
  topBrand: { slug: string; ads: number } | null
  joolaAds: number
  joolaRank: number | null
  /** How many times more ads the leader runs than JOOLA. Null if JOOLA leads. */
  leaderMultiple: number | null
  brandsDiscounting: number
  joolaPromos: number
  newLast30: number
}

/* Theme classifier.
 *
 * Rule-based on purpose: an LLM call per ad would cost money, vary between
 * runs, and make the page unreproducible. Order matters — the first match wins,
 * so totals stay additive and one ad is never counted under two themes. The
 * specific claims come first; the generic ones catch what is left. */
const THEMES: { theme: string; re: RegExp }[] = [
  { theme: 'Pro endorsement', re: /\b(pro|champion|world.?no|ranked|athlete|sponsor|tour)\b/i },
  { theme: 'New launch', re: /\b(introduc|new|launch|meet the|now available|drop|debut)\w*\b/i },
  { theme: 'Sale / price', re: /\b(sale|save|% ?off|discount|deal|free shipping|bogo|clearance)\b/i },
  { theme: 'Power', re: /\b(power|spin|pop|drive|smash|aggressive|explosive|knockout)\b/i },
  { theme: 'Control / feel', re: /\b(control|touch|feel|precision|soft|consistent|accura\w*|dwell)\b/i },
  { theme: 'Beginner-friendly', re: /\b(beginner|starter|new to|easy|forgiv\w*|first paddle)\b/i },
  { theme: 'Durability / build', re: /\b(durab\w*|carbon|fiberglass|honeycomb|core|built to last|warranty)\b/i },
]
export const UNTHEMED = 'Other'

export function classifyTheme(text: string | null): string {
  if (!text) return UNTHEMED
  for (const t of THEMES) if (t.re.test(text)) return t.theme
  return UNTHEMED
}

export interface CampaignIntelData {
  volumes: BrandVolume[]
  momentum: Momentum[]
  themes: ThemeRow[]
  actions: Action[]
  placements: PlacementSplit[]
  adsByBrand: Record<string, AdCard[]>
  newAds: AdCard[]
  longestRunning: AdCard[]
  promos: PromoRow[]
  headline: Headline
  /** True once migrations/026 has landed. Drives the honest section notes. */
  hasDurationData: boolean
  hasPlacementData: boolean
  googleAdsUnreadable: number
}

function headlineJoolaPromos(volumes: BrandVolume[]): number {
  const j = volumes.find((v) => v.slug === 'joola')
  return j ? j.promos : 0
}

/** Meta's placement enum, lower-cased for display. */
function splitPlacements(list: string[] | null | undefined): string[] {
  if (!list || list.length === 0) return []
  return list.map((p) => String(p).toLowerCase())
}

/* migrations/026 is applied by hand in the Supabase SQL editor, so this page
 * has to render correctly before it lands. Selecting a column that does not
 * exist makes PostgREST reject the entire query, so the rich select is tried
 * once and falls back to the columns that are known to exist. */
async function fetchAds(): Promise<{ rows: RawAd[]; rich: boolean }> {
  // fetchPaged SWALLOWS PostgREST errors and returns [] — it never throws, so a
  // try/catch around it is dead code and an unknown-column 400 would render as
  // "this brand runs no ads". fetchPagedResult exposes `ok` for exactly this.
  const rich = await fetchPagedResult<RawAd>(
    () =>
      supabase
        .from('marketing_ads')
        .select('brand_id,platform,ad_id,page_name,body,cta,creative_url,landing_url,started_at,is_active,ad_title,publisher_platforms,last_shown,approx_days_shown,ad_format,is_template_ad,advertiser_id:raw->>advertiserId,page_id:raw->>pageId')
        .order('started_at', { ascending: false }),
    { label: 'marketing_ads (with 026 columns)' },
  )
  if (rich.ok) return { rows: rich.data, rich: true }

  const base = await fetchPaged<RawAd>(
    () =>
      supabase
        .from('marketing_ads')
        .select('brand_id,platform,ad_id,page_name,body,cta,creative_url,landing_url,started_at,is_active,advertiser_id:raw->>advertiserId,page_id:raw->>pageId')
        .order('started_at', { ascending: false }),
    { label: 'marketing_ads (pre-026)' },
  )
  return { rows: base, rich: false }
}

export async function fetchCampaignIntel(brands: V2Brand[]): Promise<CampaignIntelData> {
  const slugByBid: Record<string, string> = {}
  for (const b of brands) slugByBid[b.brand_id] = b.id

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
  const rich = adResult.rich

  const now = Date.now()
  const newCutoff = now - NEW_WINDOW_DAYS * DAY
  const promoCutoff = now - PROMO_ACTIVE_DAYS * DAY

  const volume = new Map<string, BrandVolume>()
  const placement = new Map<string, PlacementSplit>()
  const adsByBrand: Record<string, AdCard[]> = {}
  const allCards: AdCard[] = []
  let hasDuration = false
  let hasPlacement = false
  let googleUnreadable = 0
  const advertiserIds = new Map<string, Map<string, number>>()
  const pageIds = new Map<string, Map<string, number>>()
  const tally = (store: Map<string, Map<string, number>>, slug: string, id: string) => {
    let inner = store.get(slug)
    if (!inner) {
      inner = new Map<string, number>()
      store.set(slug, inner)
    }
    inner.set(id, (inner.get(id) || 0) + 1)
  }
  const dominant = (store: Map<string, Map<string, number>>, slug: string): string | null => {
    const inner = store.get(slug)
    if (!inner) return null
    let best: string | null = null
    let bestN = 0
    for (const entry of Array.from(inner.entries())) {
      if (entry[1] > bestN) {
        best = entry[0]
        bestN = entry[1]
      }
    }
    return best
  }

  const bumpVolume = (slug: string): BrandVolume => {
    let v = volume.get(slug)
    if (!v) {
      v = {
        slug, total: 0, meta: 0, google: 0, newLast30: 0, promos: 0, readable: 0,
        googleAdsUrl: null, metaAdsUrl: null,
      }
      volume.set(slug, v)
    }
    return v
  }
  const bumpPlacement = (slug: string): PlacementSplit => {
    let p = placement.get(slug)
    if (!p) {
      p = { slug, google: 0, facebook: 0, instagram: 0, otherMeta: 0 }
      placement.set(slug, p)
    }
    return p
  }

  for (const r of adRows) {
    const slug = slugByBid[r.brand_id]
    if (!slug) continue
    const platform = (r.platform || 'unknown').toLowerCase()
    const v = bumpVolume(slug)
    v.total += 1
    if (platform === 'meta') v.meta += 1
    else if (platform === 'google') v.google += 1

    if (r.advertiser_id) tally(advertiserIds, slug, r.advertiser_id)
    if (r.page_id) tally(pageIds, slug, r.page_id)

    const started = r.started_at ? Date.parse(r.started_at) : NaN
    if (!Number.isNaN(started) && started >= newCutoff) v.newLast30 += 1

    const p = bumpPlacement(slug)
    const places = splitPlacements(r.publisher_platforms)
    if (places.length > 0) hasPlacement = true
    if (platform === 'google') {
      p.google += 1
      googleUnreadable += 1
    } else if (places.includes('facebook') || places.includes('instagram')) {
      if (places.includes('facebook')) p.facebook += 1
      if (places.includes('instagram')) p.instagram += 1
    } else if (platform === 'meta') {
      p.otherMeta += 1
    }

    // Duration. approx_days_shown (Google) is authoritative. Otherwise derive
    // from first -> last sighting. When an ad is still live there is no end
    // date, so elapsed time is a floor, not a total — flagged as such so the
    // UI can render "60+ days" instead of claiming a precise run length.
    let days: number | null = null
    let isMinimum = false
    if (typeof r.approx_days_shown === 'number') {
      days = r.approx_days_shown
      hasDuration = true
    } else if (r.started_at && r.last_shown) {
      const a = Date.parse(r.started_at)
      const b = Date.parse(r.last_shown)
      if (!Number.isNaN(a) && !Number.isNaN(b) && b >= a) {
        days = Math.round((b - a) / DAY)
        hasDuration = true
      }
    } else if (r.started_at && r.is_active) {
      const a = Date.parse(r.started_at)
      if (!Number.isNaN(a)) {
        days = Math.max(0, Math.round((now - a) / DAY))
        isMinimum = true
      }
    }

    const body = r.is_template_ad ? null : r.body
    if (body) v.readable += 1

    const card: AdCard = {
      key: platform + ':' + r.ad_id,
      brandSlug: slug,
      platform,
      title: r.ad_title ?? null,
      body,
      cta: r.cta,
      landingUrl: r.landing_url,
      creativeUrl: r.creative_url,
      startedAt: r.started_at,
      daysRunning: days,
      daysRunningIsMinimum: isMinimum,
      placements: places,
      variants: 1,
      archiveUrl:
        platform === 'meta' ? 'https://www.facebook.com/ads/library/?id=' + r.ad_id : null,
    }
    allCards.push(card)
    // The copy section shows what competitors SAY, so it holds only ads whose
    // words can be read. An empty card is not evidence of a silent competitor.
    if (body) {
      if (!adsByBrand[slug]) adsByBrand[slug] = []
      adsByBrand[slug].push(card)
    }
  }

  /* Collapse repeated copy. 51% of readable Meta ads are duplicates: Paddletek
   * runs "The Paddle of Champions." across 30 separate ads. Listing each one
   * turns a six-card block into the same sentence six times and buries every
   * other message the brand is running. The duplicate count is kept and shown,
   * because how many ways a brand runs one line is real signal. */
  for (const [slug, list] of Object.entries(adsByBrand)) {
    const seen = new Map<string, AdCard>()
    for (const card of list) {
      const key = (card.body || '').replace(/\s+/g, ' ').trim().toLowerCase()
      const hit = seen.get(key)
      if (hit) {
        hit.variants += 1
        // Keep the newest sighting, plus any image or link the duplicate has
        // that the survivor lacks.
        if (!hit.creativeUrl && card.creativeUrl) hit.creativeUrl = card.creativeUrl
        if (!hit.landingUrl && card.landingUrl) hit.landingUrl = card.landingUrl
        if (Date.parse(card.startedAt || '') > Date.parse(hit.startedAt || '')) {
          hit.startedAt = card.startedAt
        }
      } else {
        seen.set(key, card)
      }
    }
    adsByBrand[slug] = Array.from(seen.values()).sort(
      (a, b) =>
        b.variants - a.variants || Date.parse(b.startedAt || '') - Date.parse(a.startedAt || ''),
    )
  }

  const promos: PromoRow[] = []
  for (const r of promoRows) {
    const slug = slugByBid[r.brand_id]
    if (!slug) continue
    const text = (r.banner_text || '').trim()
    if (!text) continue
    const ts = r.detected_at ? Date.parse(r.detected_at) : NaN
    bumpVolume(slug).promos += 1
    promos.push({
      key: slug + ':' + text + ':' + (r.detected_at || ''),
      brandSlug: slug,
      text,
      type: r.promo_type,
      discountPct: r.discount_pct,
      detectedAt: r.detected_at,
      sourceUrl: r.source_url,
      isRecent: !Number.isNaN(ts) && ts >= promoCutoff,
    })
  }
  promos.sort((a, b) => Date.parse(b.detectedAt || '') - Date.parse(a.detectedAt || ''))

  for (const v of Array.from(volume.values())) {
    const adv = dominant(advertiserIds, v.slug)
    const page = dominant(pageIds, v.slug)
    v.googleAdsUrl = adv ? 'https://adstransparency.google.com/advertiser/' + adv + '?region=US' : null
    v.metaAdsUrl = page
      ? 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&view_all_page_id=' + page
      : null
  }

  const volumes = Array.from(volume.values()).sort((a, b) => b.total - a.total)
  const ranked = volumes.filter((v) => v.total > 0)
  const joola = volumes.find((v) => v.slug === 'joola') || null
  const joolaRankIdx = ranked.findIndex((v) => v.slug === 'joola')
  const top = ranked.length > 0 ? ranked[0] : null

  const newAds = allCards
    .filter((c) => c.startedAt != null && Date.parse(c.startedAt) >= newCutoff)
    .sort((a, b) => Date.parse(b.startedAt || '') - Date.parse(a.startedAt || ''))

  // "What's working for them" answers which MESSAGE a competitor keeps paying to
  // run, so a row needs both a trustworthy duration and something to read.
  //
  // A "still live, so at least N days" estimate is only worth showing when
  // is_active was measured. Meta's was (recovered from raw.isActive by the
  // backfill); Google's is a leftover default — its actor returns no active
  // flag at all — so elapsed-since-first-seen there produces things like
  // "1766+ days" for an ad that may have stopped in 2021. Google's real answer
  // is approx_days_shown, which arrives with migrations/026; until then Google
  // is excluded rather than guessed at.
  const longestRunning = allCards
    .filter((c) => {
      if (c.daysRunning == null) return false
      if (c.daysRunningIsMinimum && c.platform !== 'meta') return false
      return Boolean(c.body || c.title)
    })
    .sort((a, b) => (b.daysRunning || 0) - (a.daysRunning || 0))

  const headline: Headline = {
    totalAds: allCards.length,
    brandsAdvertising: ranked.length,
    topBrand: top ? { slug: top.slug, ads: top.total } : null,
    joolaAds: joola ? joola.total : 0,
    joolaRank: joolaRankIdx >= 0 ? joolaRankIdx + 1 : null,
    leaderMultiple:
      top && joola && joola.total > 0 && top.slug !== 'joola'
        ? Math.round((top.total / joola.total) * 10) / 10
        : null,
    brandsDiscounting: volumes.filter((v) => v.promos > 0).length,
    joolaPromos: joola ? joola.promos : 0,
    newLast30: newAds.length,
  }

  /* Momentum: last 4 weeks against the 4 before. A brand going from 40 ads to
   * 300 in three weeks is usually about to launch something, and the slope
   * matters far more than the absolute count. This is only trustworthy because
   * started_at reached 100% coverage — before the 2026-08-26 backfill, Meta
   * carried no start date and 43% of the market was invisible here. */
  const WEEK4 = 28 * DAY
  const recentFrom = now - WEEK4
  const priorFrom = now - 2 * WEEK4
  const recentBy = new Map<string, number>()
  const priorBy = new Map<string, number>()
  for (const c of allCards) {
    if (!c.startedAt) continue
    const t = Date.parse(c.startedAt)
    if (Number.isNaN(t)) continue
    if (t >= recentFrom) recentBy.set(c.brandSlug, (recentBy.get(c.brandSlug) || 0) + 1)
    else if (t >= priorFrom) priorBy.set(c.brandSlug, (priorBy.get(c.brandSlug) || 0) + 1)
  }
  const momentum: Momentum[] = volumes
    .map((v) => {
      const recent = recentBy.get(v.slug) || 0
      const previous = priorBy.get(v.slug) || 0
      return {
        slug: v.slug,
        recent,
        previous,
        delta: recent - previous,
        pctChange: previous > 0 ? Math.round(((recent - previous) / previous) * 100) : null,
      }
    })
    .filter((m) => m.recent > 0 || m.previous > 0)
    .sort((a, b) => b.delta - a.delta)

  /* Themes across every ad whose copy can be read. Ads with no readable copy
   * are left out entirely rather than bucketed as "Other" — 908 Google ads
   * landing in one bar would dwarf every real theme and say nothing. */
  const themeMap = new Map<string, ThemeRow>()
  const themeExample = new Map<string, string>()
  // Count each distinct message once, not once per creative variant. Without
  // this, one line running across 30 ads would look like 30 separate claims.
  const countedCopy = new Set<string>()
  for (const c of allCards) {
    const copy = c.body || c.title
    if (!copy) continue
    const dedupeKey = c.brandSlug + '|' + copy.replace(/\s+/g, ' ').trim().toLowerCase()
    if (countedCopy.has(dedupeKey)) continue
    countedCopy.add(dedupeKey)

    const theme = classifyTheme(copy)
    let row = themeMap.get(theme)
    if (!row) {
      row = {
        theme, total: 0, byBrand: {}, brandCount: 0,
        leader: null, joola: 0, example: null, stance: 'absent',
      }
      themeMap.set(theme, row)
    }
    row.total += 1
    row.byBrand[c.brandSlug] = (row.byBrand[c.brandSlug] || 0) + 1
    // Prefer a sentence long enough to convey the claim over a three-word tag.
    const existing = themeExample.get(theme)
    if (!existing || (existing.length < 40 && copy.length > existing.length)) {
      themeExample.set(theme, copy.replace(/\s+/g, ' ').trim())
    }
  }
  // Array.from, not direct Map iteration: this tsconfig raises TS2802 on the
  // spread/iterator form (see CLAUDE.md).
  for (const row of Array.from(themeMap.values())) {
    const entries = Object.entries(row.byBrand).sort((a, b) => b[1] - a[1])
    row.brandCount = entries.length
    row.leader = entries.length > 0 ? { slug: entries[0][0], count: entries[0][1] } : null
    row.joola = row.byBrand['joola'] || 0
    row.example = themeExample.get(row.theme) || null
    if (row.leader && row.leader.slug === 'joola') row.stance = 'own'
    else if (row.joola === 0) row.stance = 'absent'
    else if (row.leader && row.joola * 2 <= row.leader.count) row.stance = 'behind'
    else row.stance = 'contested'
  }
  const themes = Array.from(themeMap.values()).sort((a, b) => {
    if (a.theme === UNTHEMED) return 1
    if (b.theme === UNTHEMED) return -1
    return b.total - a.total
  })

  /* Recommended actions. Every one of these is derived from a number shown
   * elsewhere on this page — nothing here is asserted that a reader cannot
   * scroll up and verify. */
  const actions: Action[] = []
  const surging = momentum.filter((m) => m.slug !== 'joola' && m.delta >= 10)[0]
  if (surging) {
    actions.push({
      severity: 'act',
      brandSlug: surging.slug,
      text: `started ${surging.recent} ads in the last 4 weeks, up from ${surging.previous}. Check what they are launching before it lands.`,
    })
  }
  for (const t of themes.slice(0, 4)) {
    if (t.theme === UNTHEMED) continue
    const joolaCount = t.byBrand['joola'] || 0
    const rivalCount = t.total - joolaCount
    if (joolaCount === 0 && rivalCount >= 10) {
      actions.push({
        severity: 'act',
        text: `${rivalCount} competitor ads lead on "${t.theme}" and JOOLA runs none. Either contest it or deliberately cede it.`,
      })
    }
  }
  if (headlineJoolaPromos(volumes) === 0) {
    const discounters = volumes.filter((v) => v.promos > 0).length
    if (discounters > 0) {
      actions.push({
        severity: 'watch',
        text: `${discounters} brands are discounting and JOOLA is not. That is a position, not a gap — but confirm it is the intended one.`,
      })
    }
  }
  const joolaRecent = momentum.find((m) => m.slug === 'joola')
  if (joolaRecent && joolaRecent.delta < 0) {
    actions.push({
      severity: 'watch',
      text: `JOOLA started ${joolaRecent.recent} ads in the last 4 weeks, down from ${joolaRecent.previous}. Share of voice falls quietly.`,
    })
  }

  return {
    volumes,
    momentum,
    themes,
    actions,
    placements: Array.from(placement.values()).sort(
      (a, b) => b.google + b.facebook + b.instagram - (a.google + a.facebook + a.instagram),
    ),
    adsByBrand,
    newAds,
    longestRunning,
    promos,
    headline,
    hasDurationData: hasDuration && rich,
    hasPlacementData: hasPlacement,
    googleAdsUnreadable: googleUnreadable,
  }
}
