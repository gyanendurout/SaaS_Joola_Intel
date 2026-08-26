/**
 * Paddle Intel — the data layer behind the rebuilt Product Intel page.
 *
 * Answers the seven questions the page asks, in order:
 *
 *   1. paddles only, per brand              isNotPaddle() filtering
 *   2. top 10 per brand                     rank by review volume
 *   3. which are actually famous            paddle_reviews + products.review_count
 *   4. price comparison                     products.price_usd -> Tier
 *   5. technology comparison                paddle_specs (migration 024)
 *   6. mention count per product            product_mentions via products_catalog
 *   7. Tier, as it existed before           <$100 / $100-199 / $200+
 *
 * ── The join problem ───────────────────────────────────────────────────────
 * Four datasets name the same paddle four different ways and share no foreign
 * key. `familyKey()` is the single currency that unites them; see
 * `paddleFamily.ts` for why, and `backend/tests/test_family_parity.py` for the
 * test that keeps it agreeing with the Python that writes
 * `paddle_specs.family_key`.
 *
 * `products_catalog` is the exception: it is a curated 86-row list whose names
 * are shorter than the retail ones ("Perseus IV" vs "Perseus Pro IV 16mm"), so
 * it bridges by TOKEN CONTAINMENT rather than equality. That is deliberately
 * asymmetric and guarded — see `bridgeCatalog`.
 *
 * ── Reads ──────────────────────────────────────────────────────────────────
 * Everything that can exceed 1,000 rows goes through `fetchPaged`.
 * `paddle_reviews` alone is 26,798 rows; read unpaged it would silently return
 * the oldest 1,000 and rank the top 10 on 4% of the evidence.
 */

import { supabase } from '@/lib/shared/supabase'
import { fetchPaged } from '@/lib/v2/paged'
import { type V2Brand } from '@/lib/v2/data'
import { familyKey, isNotPaddle } from '@/lib/v2/paddleFamily'

/** Brands in scope for the paddle comparison, as chosen by the product owner. */
export const PADDLE_BRANDS = [
  'joola', 'selkirk', 'crbn', 'paddletek', 'engage', 'six-zero', 'franklin',
] as const

/** Requirement 2: ten per brand, no more. */
export const TOP_N_PER_BRAND = 10

/** Requirement 7 — unchanged from the previous page. */
export type PriceTier = 'value' | 'mid' | 'premium' | 'unknown'

export function priceTier(usd: number | null): PriceTier {
  if (usd == null || !isFinite(usd) || usd <= 0) return 'unknown'
  if (usd >= 200) return 'premium'
  if (usd >= 100) return 'mid'
  return 'value'
}

export const TIER_LABEL: Record<PriceTier, string> = {
  value: 'Value (under $100)',
  mid: 'Mid ($100–$199)',
  premium: 'Premium ($200+)',
  unknown: 'No price on file',
}

/** The six fields every brand publishes in some form. */
export interface PaddleSpecs {
  thicknessMm: number | null
  shape: string | null
  lengthIn: number | null
  widthIn: number | null
  weightOzMin: number | null
  weightOzMax: number | null
  gripCircumIn: number | null
  handleLengthIn: number | null
  coreMaterial: string | null
  faceMaterial: string | null
  swingWeight: number | null
  twistWeight: number | null
  usapApproved: boolean | null
  /** 'labelled' | 'variant' | 'prose' — the weakest source used for any field. */
  confidence: string | null
  /** More than one shape/thickness variant published under this family. */
  variantCount: number
  /**
   * Every distinct core thickness published for this family, ascending.
   *
   * A single number here is a lie whenever a paddle ships in two cores. JOOLA's
   * Hyperion Pro IV sells as 14mm and 16mm, so a row headed
   * "Hyperion Pro IV 14mm" that reports a 16mm core contradicts its own name
   * and reads as a data error even though both values are correct.
   */
  thicknessOptions: number[]
}

export interface MentionSplit {
  reddit: number
  instagram: number
  tiktok: number
  youtube: number
  twitter: number
  news: number
  influencer: number
  total: number
}

export interface PaddleRow {
  brandSlug: string
  familyKey: string
  /** The most frequently published spelling — what a human would recognise. */
  displayName: string
  rank: number
  reviewCount: number
  avgRating: number | null
  priceUsd: number | null
  priceLocal: number | null
  priceLocalCurrency: string | null
  tier: PriceTier
  mentions: MentionSplit | null
  specs: PaddleSpecs | null
  /** Distinct retail spellings collapsed into this family. */
  spellingCount: number
  /**
   * The page the reviews were actually scraped from.
   *
   * Resolved through `paddle_reviews.product_id -> paddle_products.product_url`
   * and picked as the listing that contributed the MOST reviews to this family,
   * so the link lands where the evidence is rather than on an arbitrary SKU.
   * Falls back to the brand storefront, then the manufacturer's spec page.
   */
  productUrl: string | null
  /** Where that link goes — "Pickleball Central", "JOOLA", etc. */
  productUrlLabel: string | null
}

export interface BrandCoverage {
  brandSlug: string
  paddlesRanked: number
  reviewCorpus: number
  withPrice: number
  withSpecs: number
  withMentions: number
  specFillPct: number
  /** Set when the brand contributed no specs at all — see Franklin / HTTP 403. */
  specGapReason: string | null
}

export interface CatalogGapRow {
  brandSlug: string
  displayName: string
  reviewCount: number
}

export interface PaddleIntelData {
  rows: PaddleRow[]
  coverage: BrandCoverage[]
  catalogGaps: CatalogGapRow[]
  totals: {
    brands: number
    paddles: number
    reviewCorpus: number
    reviewsExcludedAsAccessories: number
    mentionsMatched: number
  }
}

/* ── raw row shapes ───────────────────────────────────────────────────────── */

interface ReviewRow {
  brand_id: string | null
  canonical_name: string | null
  rating: number | null
  product_id: string | null
}

interface PaddleProductRow {
  id: string
  retailer: string | null
  product_url: string | null
}

interface SpecRow {
  brand_id: string | null
  family_key: string | null
  product_name: string | null
  source_url: string | null
  thickness_mm: number | null
  shape: string | null
  length_in: number | null
  width_in: number | null
  weight_oz_min: number | null
  weight_oz_max: number | null
  grip_circum_in: number | null
  handle_length_in: number | null
  core_material: string | null
  face_material: string | null
  swing_weight: number | null
  twist_weight: number | null
  usap_approved: boolean | null
  source_confidence: string | null
}

interface ProductRow {
  brand_id: string | null
  name: string | null
  url: string | null
  price_usd: number | null
  price_local: number | null
  price_local_currency: string | null
  review_count: number | null
  avg_rating: number | null
  category: string | null
}

interface CatalogRow {
  id: string
  brand_id: string | null
  display_name: string | null
  aliases: string[] | null
}

interface MentionRow {
  product_id: string | null
  channel: string | null
}

interface InfluencerRow {
  brand_id: string | null
  name: string | null
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

/** `https://www.joola.com/products/x` -> `joola.com`. Never throws. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'product page'
  }
}

function emptySplit(): MentionSplit {
  return {
    reddit: 0, instagram: 0, tiktok: 0, youtube: 0,
    twitter: 0, news: 0, influencer: 0, total: 0,
  }
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Catalog keys are curated and short; retail keys are long. Match when one is a
 * token-subset of the other, within a brand.
 *
 * Guarded on both sides:
 *  - a catalog key of fewer than two tokens must match exactly, because CRBN's
 *    "CRBN-1" reduces to the single token `1`, which is a subset of nearly
 *    every other key and would otherwise absorb the whole brand;
 *  - the most specific (longest) candidate wins, so "Perseus Pro IV" prefers
 *    catalog "Perseus Pro IV" over catalog "Perseus".
 */
function bridgeCatalog(
  retailKey: string,
  candidates: { key: string; catalogId: string }[],
): string | null {
  const retailTokens = new Set(retailKey.split(' ').filter(Boolean))
  if (!retailTokens.size) return null

  let best: { key: string; catalogId: string } | null = null
  for (const candidate of candidates) {
    const tokens = candidate.key.split(' ').filter(Boolean)
    if (!tokens.length) continue
    if (tokens.length < 2) {
      if (candidate.key !== retailKey) continue
    } else if (!tokens.every((token) => retailTokens.has(token))) {
      continue
    }
    if (!best || candidate.key.length > best.key.length) best = candidate
  }
  return best?.catalogId ?? null
}

/** Pick the variant that best represents a family in the comparison table. */
function pickSpec(variants: SpecRow[]): PaddleSpecs | null {
  if (!variants.length) return null
  const rank: Record<string, number> = { labelled: 0, variant: 1, prose: 2 }
  // Strongest source first, then the thickest core — the flagship configuration
  // brands lead with, and the one most reviews refer to.
  const sorted = [...variants].sort((a, b) => {
    const byConfidence =
      (rank[a.source_confidence ?? 'prose'] ?? 3) - (rank[b.source_confidence ?? 'prose'] ?? 3)
    if (byConfidence !== 0) return byConfidence
    return (b.thickness_mm ?? 0) - (a.thickness_mm ?? 0)
  })
  const top = sorted[0]
  const thicknessOptions = Array.from(
    new Set(variants.map((v) => v.thickness_mm).filter((t): t is number => t != null)),
  ).sort((a, b) => a - b)
  return {
    thicknessMm: top.thickness_mm,
    thicknessOptions,
    shape: top.shape,
    lengthIn: top.length_in,
    widthIn: top.width_in,
    weightOzMin: top.weight_oz_min,
    weightOzMax: top.weight_oz_max,
    gripCircumIn: top.grip_circum_in,
    handleLengthIn: top.handle_length_in,
    coreMaterial: top.core_material,
    faceMaterial: top.face_material,
    swingWeight: top.swing_weight,
    twistWeight: top.twist_weight,
    usapApproved: top.usap_approved,
    confidence: top.source_confidence,
    variantCount: variants.length,
  }
}

/* ── main fetcher ─────────────────────────────────────────────────────────── */

export async function fetchPaddleIntel(brands: V2Brand[]): Promise<PaddleIntelData> {
  const inScope = brands.filter((b) => (PADDLE_BRANDS as readonly string[]).includes(b.id))
  const slugByBrandId = new Map(inScope.map((b) => [b.brand_id, b.id]))
  const brandIds = inScope.map((b) => b.brand_id)

  if (!brandIds.length) {
    return {
      rows: [], coverage: [], catalogGaps: [],
      totals: {
        brands: 0, paddles: 0, reviewCorpus: 0,
        reviewsExcludedAsAccessories: 0, mentionsMatched: 0,
      },
    }
  }

  const [reviewsRes, specsRes, productsRes, catalogRes, mentionsRes, rosterRes,
         listingsRes] = await Promise.all([
      fetchPaged<ReviewRow>(() =>
        supabase.from('paddle_reviews')
          .select('brand_id,canonical_name,rating,product_id')
          .in('brand_id', brandIds)
          .order('id', { ascending: true })),
      fetchPaged<SpecRow>(() =>
        supabase.from('paddle_specs')
          .select('brand_id,family_key,product_name,source_url,thickness_mm,shape,length_in,width_in,weight_oz_min,weight_oz_max,grip_circum_in,handle_length_in,core_material,face_material,swing_weight,twist_weight,usap_approved,source_confidence')
          .in('brand_id', brandIds)
          .order('id', { ascending: true })),
      fetchPaged<ProductRow>(() =>
        supabase.from('products')
          .select('brand_id,name,url,price_usd,price_local,price_local_currency,review_count,avg_rating,category')
          .in('brand_id', brandIds)
          .order('id', { ascending: true })),
      fetchPaged<CatalogRow>(() =>
        supabase.from('products_catalog')
          .select('id,brand_id,display_name,aliases')
          .in('brand_id', brandIds)
          .order('id', { ascending: true })),
      fetchPaged<MentionRow>(() =>
        supabase.from('product_mentions')
          .select('product_id,channel')
          .in('brand_id', brandIds)
          .order('id', { ascending: true })),
      fetchPaged<InfluencerRow>(() =>
        supabase.from('influencers')
          .select('brand_id,name')
          .in('brand_id', brandIds)
          .order('id', { ascending: true })),
      // Not brand-filtered: 190 of 702 rows carry no brand_id, and reviews
      // still point at them. The join is by id, so unrelated rows cost nothing.
      fetchPaged<PaddleProductRow>(() =>
        supabase.from('paddle_products')
          .select('id,retailer,product_url')
          .order('id', { ascending: true })),
    ])

  // Athlete roster, so signature editions collapse into their base paddle.
  // Read from the database rather than hardcoded — CLAUDE.md invariant 5, and
  // the crawler reads the same table so the keys agree.
  const roster = new Map<string, string[]>()
  rosterRes.forEach((row) => {
    const slug = slugByBrandId.get(row.brand_id ?? '')
    const name = (row.name ?? '').trim()
    if (!slug || !name) return
    const list = roster.get(slug) ?? []
    if (!list.includes(name)) list.push(name)
    roster.set(slug, list)
  })
  const keyFor = (name: string | null, slug: string) =>
    familyKey(name, slug, roster.get(slug) ?? [])

  /* 1 + 3 — rank by review volume, paddles only. */
  interface Agg {
    reviews: number
    ratingSum: number
    ratingCount: number
    spellings: Map<string, number>
    /** listing id -> reviews contributed, so the link goes where the evidence is */
    listings: Map<string, number>
  }
  const byFamily = new Map<string, Agg>()
  let excludedAccessories = 0

  const bump = (
    slug: string,
    name: string,
    rating: number | null,
    listingId: string | null = null,
  ) => {
    const key = keyFor(name, slug)
    if (!key) return
    const id = `${slug}::${key}`
    let agg = byFamily.get(id)
    if (!agg) {
      agg = {
        reviews: 0, ratingSum: 0, ratingCount: 0,
        spellings: new Map(), listings: new Map(),
      }
      byFamily.set(id, agg)
    }
    agg.reviews += 1
    if (rating != null && isFinite(Number(rating))) {
      agg.ratingSum += Number(rating)
      agg.ratingCount += 1
    }
    agg.spellings.set(name, (agg.spellings.get(name) ?? 0) + 1)
    if (listingId) agg.listings.set(listingId, (agg.listings.get(listingId) ?? 0) + 1)
  }

  reviewsRes.forEach((row) => {
    const slug = slugByBrandId.get(row.brand_id ?? '')
    const name = (row.canonical_name ?? '').trim()
    if (!slug || !name) return
    // `paddle_reviews` holds 3,905 reviews of cases, shoes and hats — 14.6% of
    // the table. Selkirk's Project Boomstik Soft Case alone has 651, enough to
    // outrank most real paddles in that brand's top 10.
    if (isNotPaddle(name)) {
      excludedAccessories += 1
      return
    }
    bump(slug, name, row.rating, row.product_id)
  })

  /* Price, and the review fallback for brands absent from the review corpus. */
  const pricesByFamily = new Map<string, number[]>()
  const storeUrlByFamily = new Map<string, string>()
  const localByFamily = new Map<string, { amount: number; currency: string }>()
  const catalogReviews = new Map<string, { count: number; rating: number | null; name: string }>()

  productsRes.forEach((row) => {
    const slug = slugByBrandId.get(row.brand_id ?? '')
    const name = (row.name ?? '').trim()
    if (!slug || !name || isNotPaddle(name)) return
    const key = keyFor(name, slug)
    if (!key) return
    const id = `${slug}::${key}`

    if (row.url && !storeUrlByFamily.has(id)) storeUrlByFamily.set(id, row.url)

    const usd = row.price_usd == null ? null : Number(row.price_usd)
    if (usd != null && isFinite(usd) && usd > 0) {
      pricesByFamily.set(id, [...(pricesByFamily.get(id) ?? []), usd])
    }
    const local = row.price_local == null ? null : Number(row.price_local)
    if (local != null && isFinite(local) && local > 0 && row.price_local_currency) {
      localByFamily.set(id, { amount: local, currency: row.price_local_currency })
    }

    const count = row.review_count == null ? 0 : Number(row.review_count)
    if (count > 0) {
      const existing = catalogReviews.get(id)
      if (!existing || count > existing.count) {
        catalogReviews.set(id, {
          count,
          rating: row.avg_rating == null ? null : Number(row.avg_rating),
          name,
        })
      }
    }
  })

  // Engage and Franklin have zero rows in `paddle_reviews`. Without this they
  // would render as brands with no products at all, which is false — they have
  // catalogs, prices and mentions, just no scraped review corpus yet.
  catalogReviews.forEach((entry, id) => {
    if (byFamily.has(id)) return
    byFamily.set(id, {
      reviews: entry.count,
      ratingSum: entry.rating != null ? entry.rating : 0,
      ratingCount: entry.rating != null ? 1 : 0,
      spellings: new Map([[entry.name, 1]]),
      listings: new Map(),
    })
  })

  /* 5 — specs, keyed by the value Python already computed. */
  const specsByFamily = new Map<string, SpecRow[]>()
  const specUrlByFamily = new Map<string, string>()
  specsRes.forEach((row) => {
    const slug = slugByBrandId.get(row.brand_id ?? '')
    const key = (row.family_key ?? '').trim()
    if (!slug || !key) return
    const id = `${slug}::${key}`
    specsByFamily.set(id, [...(specsByFamily.get(id) ?? []), row])
    if (row.source_url && !specUrlByFamily.has(id)) specUrlByFamily.set(id, row.source_url)
  })

  /* 6 — mentions, bridged through the curated catalog. */
  const catalogCandidates = new Map<string, { key: string; catalogId: string }[]>()
  catalogRes.forEach((row) => {
    const slug = slugByBrandId.get(row.brand_id ?? '')
    if (!slug) return
    const names = [row.display_name, ...(row.aliases ?? [])]
    const list = catalogCandidates.get(slug) ?? []
    names.forEach((name) => {
      const key = keyFor(name ?? null, slug)
      if (key) list.push({ key, catalogId: row.id })
    })
    catalogCandidates.set(slug, list)
  })

  const mentionsByCatalogId = new Map<string, MentionSplit>()
  let mentionsMatched = 0
  mentionsRes.forEach((row) => {
    const catalogId = row.product_id ?? ''
    if (!catalogId) return
    const split = mentionsByCatalogId.get(catalogId) ?? emptySplit()
    const channel = (row.channel ?? '') as keyof MentionSplit
    if (channel in split && channel !== 'total') {
      split[channel] += 1
    }
    split.total += 1
    mentionsByCatalogId.set(catalogId, split)
    mentionsMatched += 1
  })

  const listingById = new Map(listingsRes.map((l) => [l.id, l]))

  /**
   * Where the reviews for this family actually live.
   *
   * Preference order is evidence-first: the retailer listing that supplied the
   * most reviews, then the brand's own storefront, then the spec page the
   * measurements were read from. 83% of reviews resolve to a listing URL; the
   * fallbacks cover Engage and Franklin, which have no review corpus at all.
   */
  function resolveUrl(id: string, agg: Agg): { url: string | null; label: string | null } {
    let bestId: string | null = null
    let bestCount = 0
    agg.listings.forEach((count, listingId) => {
      if (count > bestCount) { bestCount = count; bestId = listingId }
    })
    const listing = bestId ? listingById.get(bestId) : undefined
    if (listing?.product_url) {
      // 222 of 702 listings carry no retailer name. Falling back to a generic
      // "retailer listing" mislabels the link when the URL is plainly the
      // brand's own site, so use the host instead — it is always accurate.
      return {
        url: listing.product_url,
        label: listing.retailer || hostOf(listing.product_url),
      }
    }
    const store = storeUrlByFamily.get(id)
    if (store) return { url: store, label: 'brand store' }
    const spec = specUrlByFamily.get(id)
    if (spec) return { url: spec, label: 'manufacturer page' }
    return { url: null, label: null }
  }

  /* Assemble, rank, cut to ten. */
  const perBrand = new Map<string, PaddleRow[]>()
  const claimedCatalogId = new Map<PaddleRow, string | null>()

  byFamily.forEach((agg, id) => {
    const [slug, key] = id.split('::')
    // Array.from, not spread: the repo's tsconfig raises TS2802 on iterator
    // spreads (CLAUDE.md conventions).
    const spellings = Array.from(agg.spellings.entries()).sort((a, b) => b[1] - a[1])
    const prices = pricesByFamily.get(id) ?? []
    const priceUsd = median(prices)
    const local = localByFamily.get(id) ?? null

    const catalogId = bridgeCatalog(key, catalogCandidates.get(slug) ?? [])
    const link = resolveUrl(id, agg)

    const row: PaddleRow = {
      brandSlug: slug,
      familyKey: key,
      displayName: spellings[0]?.[0] ?? key,
      rank: 0,
      reviewCount: agg.reviews,
      avgRating: agg.ratingCount ? agg.ratingSum / agg.ratingCount : null,
      priceUsd,
      priceLocal: local?.amount ?? null,
      priceLocalCurrency: local?.currency ?? null,
      tier: priceTier(priceUsd),
      mentions: null,     // assigned below, after duplicate claims are resolved
      specs: pickSpec(specsByFamily.get(id) ?? []),
      spellingCount: spellings.length,
      productUrl: link.url,
      productUrlLabel: link.label,
    }
    claimedCatalogId.set(row, catalogId)
    perBrand.set(slug, [...(perBrand.get(slug) ?? []), row])
  })

  // One catalog product's mentions belong to exactly ONE row.
  //
  // Containment matching is deliberately loose, so several families can claim
  // the same catalog entry: "Project Boomstik" and "Project Boomstik 2nd/Demos"
  // both matched catalog "Project Boomstik" and each rendered its full 177
  // mentions, implying 354 mentions for one paddle. The family with the most
  // reviews keeps the claim; the others show no mention data, which is honest —
  // those mentions were never attributed to them in the first place.
  const bestClaim = new Map<string, PaddleRow>()
  claimedCatalogId.forEach((catalogId, row) => {
    if (!catalogId) return
    const current = bestClaim.get(catalogId)
    if (!current || row.reviewCount > current.reviewCount) bestClaim.set(catalogId, row)
  })
  bestClaim.forEach((row, catalogId) => {
    row.mentions = mentionsByCatalogId.get(catalogId) ?? null
  })

  const rows: PaddleRow[] = []
  const coverage: BrandCoverage[] = []
  const catalogGaps: CatalogGapRow[] = []

  // JOOLA first — this is JOOLA's dashboard, and the comparison reads as
  // "us vs them". Everyone else follows by review corpus, largest first, so the
  // brands with the most evidence behind them come before the thin ones.
  const ordered = [...inScope].sort((a, b) => {
    if (a.id === 'joola') return -1
    if (b.id === 'joola') return 1
    const corpus = (slug: string) =>
      (perBrand.get(slug) ?? []).reduce((sum, r) => sum + r.reviewCount, 0)
    return corpus(b.id) - corpus(a.id)
  })

  ordered.forEach((brand) => {
    const slug = brand.id
    const all = (perBrand.get(slug) ?? []).sort((a, b) => {
      // Requirement 3, as decided: reviews first, mentions as the tiebreak.
      if (b.reviewCount !== a.reviewCount) return b.reviewCount - a.reviewCount
      return (b.mentions?.total ?? 0) - (a.mentions?.total ?? 0)
    })
    const top = all.slice(0, TOP_N_PER_BRAND)
    top.forEach((row, index) => { row.rank = index + 1 })
    rows.push(...top)

    const brandSpecs = specsRes.filter((s) => slugByBrandId.get(s.brand_id ?? '') === slug)
    coverage.push({
      brandSlug: slug,
      paddlesRanked: top.length,
      reviewCorpus: all.reduce((sum, r) => sum + r.reviewCount, 0),
      withPrice: top.filter((r) => r.priceUsd != null).length,
      withSpecs: top.filter((r) => r.specs != null).length,
      withMentions: top.filter((r) => (r.mentions?.total ?? 0) > 0).length,
      specFillPct: top.length
        ? Math.round((top.filter((r) => r.specs != null).length / top.length) * 100)
        : 0,
      specGapReason: brandSpecs.length
        ? null
        : 'No manufacturer specs collected — the site blocked the crawler (HTTP 403).',
    })

    // A paddle with real review volume that nobody is talking about is usually
    // a tracking gap, not a quiet product: `products_catalog` is curated by
    // hand and drifts behind the catalog. The gap is itself the finding.
    top.filter((r) => r.reviewCount >= 50 && (r.mentions?.total ?? 0) === 0)
      .forEach((r) => catalogGaps.push({
        brandSlug: slug,
        displayName: r.displayName,
        reviewCount: r.reviewCount,
      }))
  })

  return {
    rows,
    coverage,
    catalogGaps: catalogGaps.sort((a, b) => b.reviewCount - a.reviewCount),
    totals: {
      brands: inScope.length,
      paddles: rows.length,
      reviewCorpus: reviewsRes.length,
      reviewsExcludedAsAccessories: excludedAccessories,
      mentionsMatched,
    },
  }
}
