'use client'

/**
 * Product Intel — paddle comparison.
 *
 * Seven sections, one per requirement, in the order they were asked for:
 *
 *   §1  Coverage          how much evidence stands behind everything below
 *   §2  Top 10 per brand  reqs 1, 2, 3, 7 — paddles only, ranked, with Tier
 *   §3  Price comparison  req 4
 *   §4  Technology        req 5
 *   §5  Mentions          req 6
 *   §6  Catalog gaps      paddles with review volume but no mention tracking
 *   §7  Customer Voice    retained unchanged
 *
 * Ranking is REVIEW VOLUME, with mentions as the tiebreak — the decision taken
 * during design. Reviews measure how many people bought and cared enough to
 * write; mentions measure conversation, which spikes on launches and drama.
 *
 * WHAT THIS PAGE WILL NOT DO
 * Empty cells stay empty. Where a brand does not publish a spec, the cell reads
 * "—" and the coverage strip says why. CRBN's X Series is the clearest case:
 * it is their most-reviewed line and they publish no specifications for it
 * anywhere on the product page. Inferring a thickness from a sibling model
 * would turn a genuine competitive finding into invented data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  PageHead,
  FilterBanner,
  SectionInfo,
  MiniKpi,
  LoadingPage,
  SortTh,
  ColumnFilter,
  pgColor,
  pgName,
} from '@/components/v2/PageShell'
import { CustomerVoiceSection } from '@/components/v2/CustomerVoiceSection'
import { TableSearch } from '@/components/v2/TableSearch'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import { fetchCustomerVoice, type CustomerVoiceData } from '@/lib/v2/productIntel'
import {
  fetchPaddleIntel,
  TIER_LABEL,
  TOP_N_PER_BRAND,
  type BrandCoverage,
  type CatalogGapRow,
  type PaddleIntelData,
  type PaddleRow,
  type PriceTier,
} from '@/lib/v2/paddleIntel'
import { useBrandFilter } from '@/lib/v2/BrandFilterContext'

const TIER_COLOR: Record<PriceTier, string> = {
  premium: '#a855f7',
  mid: '#06b6d4',
  value: '#22c55e',
  unknown: '#6b7280',
}

const CHANNELS = [
  ['reddit', 'Reddit'],
  ['instagram', 'Instagram'],
  ['tiktok', 'TikTok'],
  ['youtube', 'YouTube'],
  ['twitter', 'X'],
  ['news', 'News'],
  ['influencer', 'Influencer'],
] as const

function money(usd: number | null): string {
  return usd == null ? '—' : `$${usd.toFixed(usd % 1 === 0 ? 0 : 2)}`
}

function num(value: number | null | undefined, digits = 0, suffix = ''): string {
  return value == null ? '—' : `${value.toFixed(digits)}${suffix}`
}

/**
 * Core thickness for display.
 *
 * A family that ships in two cores gets both, because a single number would
 * contradict the paddle's own name — "Hyperion Pro IV 14mm" reporting 16mm
 * reads as a bug even though both cores are genuine.
 */
function cores(options: number[] | undefined, fallback: number | null): string {
  const list = options && options.length ? options : (fallback == null ? [] : [fallback])
  if (!list.length) return '—'
  return `${list.map((t) => (t % 1 === 0 ? t.toFixed(0) : t.toFixed(1))).join(' / ')}mm`
}

function weight(min: number | null, max: number | null): string {
  if (min == null && max == null) return '—'
  if (min != null && max != null && min !== max) return `${min}–${max} oz`
  return `${min ?? max} oz`
}

/** Bar width as a share of the largest value in a column. */
function share(value: number, max: number): string {
  return max > 0 ? `${Math.max(2, Math.round((value / max) * 100))}%` : '0%'
}

/**
 * Sort + first-column filter for one table.
 *
 * Every table on this page is independently sortable, so this is a hook rather
 * than page-level state — seven brand blocks each need their own, and hooks
 * cannot be called in a loop, which is why the brand block is its own
 * component below.
 *
 * `accessor` returns the comparable value for a column. Nulls always sort last
 * regardless of direction: a paddle with no price is not "cheapest", and
 * letting it lead the ascending view would misrepresent the price comparison
 * every time someone clicked the header.
 */
function useTableSort<T>(
  rows: T[],
  accessor: (row: T, key: string) => string | number | null | undefined,
  initialKey: string,
  initialDir: 'asc' | 'desc' = 'desc',
) {
  const [sortKey, setSortKey] = useState<string>(initialKey)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialDir)
  const [filter, setFilter] = useState('')

  const toggle = (key: string) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      // Numbers are most useful largest-first; names read better A-Z.
      setSortDir('desc')
    }
  }

  const sorted = useMemo(() => {
    const out = [...rows]
    out.sort((a, b) => {
      const av = accessor(a, sortKey)
      const bv = accessor(b, sortKey)
      const aNull = av == null || av === ''
      const bNull = bv == null || bv === ''
      if (aNull && bNull) return 0
      if (aNull) return 1
      if (bNull) return -1
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
    return out
  }, [rows, accessor, sortKey, sortDir])

  return { sorted, sortKey, sortDir, toggle, filter, setFilter }
}

/** Case-insensitive substring test used by every first-column filter. */
function matches(haystack: string, needle: string): boolean {
  return !needle || haystack.toLowerCase().includes(needle.trim().toLowerCase())
}

/**
 * Paddle name, linked to the page its reviews were scraped from.
 *
 * Opens in a new tab — this dashboard is a working surface, and losing the
 * comparison to follow one link would be hostile.
 */
function PaddleName({ row }: { row: PaddleRow }) {
  const sub = row.spellingCount > 1
    ? `${row.spellingCount} retail listings merged`
    : null
  return (
    <>
      {row.productUrl ? (
        <a
          href={row.productUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ext-link"
          style={{ fontWeight: 600 }}
          title={`Open on ${row.productUrlLabel} — the page these reviews came from`}
        >
          {row.displayName} ↗
        </a>
      ) : (
        <span style={{ fontWeight: 600 }}>{row.displayName}</span>
      )}
      {sub && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{sub}</div>}
    </>
  )
}

/** One brand's top-10 block. A component so it owns its own sort state. */
function BrandBlock({
  slug, rows, brands, reviewCorpus,
}: {
  slug: string; rows: PaddleRow[]; brands: V2Brand[]; reviewCorpus: number
}) {
  const accessor = useCallback((r: PaddleRow, key: string) => {
    switch (key) {
      case 'rank': return r.rank
      case 'paddle': return r.displayName
      case 'reviews': return r.reviewCount
      case 'rating': return r.avgRating
      case 'price': return r.priceUsd
      case 'tier': return r.tier === 'unknown' ? null : r.priceUsd
      case 'core': return r.specs?.thicknessOptions?.[0] ?? r.specs?.thicknessMm ?? null
      case 'mentions': return r.mentions?.total ?? null
      default: return null
    }
  }, [])
  const t = useTableSort(rows, accessor, 'rank', 'asc')
  const shown = t.sorted.filter((r) => matches(r.displayName, t.filter))
  const maxReviews = Math.max(1, ...rows.map((r) => r.reviewCount))

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ padding: '12px 14px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="brand-dot" style={{ background: pgColor(slug) }} />
        <span style={{ fontWeight: 800, fontSize: 13 }}>{pgName(slug, brands)}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          {reviewCorpus.toLocaleString()} reviews in corpus
        </span>
      </div>
      <div className="table-wrap">
        <table className="data" style={{ width: '100%' }}>
          <thead>
            <tr>
              <SortTh col="rank" label="#" sortKey={t.sortKey} sortDir={t.sortDir} toggle={t.toggle} style={{ width: 34, textAlign: 'right' }} title="Rank within this brand, by review volume." />
              <th style={{ minWidth: 240 }}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => t.toggle('paddle')}
                  onKeyDown={(e) => { if (e.key === 'Enter') t.toggle('paddle') }}
                  style={{ cursor: 'pointer', marginBottom: 4 }}
                  title="The paddle, with every retail spelling collapsed into one family. Click the name to open the page its reviews came from."
                >
                  Paddle {t.sortKey === 'paddle' ? (t.sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                </div>
                <ColumnFilter col="paddle" value={t.filter} onChange={t.setFilter} placeholder="search paddle…" />
              </th>
              <SortTh col="reviews" label="Reviews" sortKey={t.sortKey} sortDir={t.sortDir} toggle={t.toggle} style={{ textAlign: 'right' }} title="Customer reviews across every spelling of this paddle. This is what the ranking is built on." />
              <SortTh col="rating" label="Rating" sortKey={t.sortKey} sortDir={t.sortDir} toggle={t.toggle} style={{ textAlign: 'right' }} title="Mean star rating across those reviews, out of 5." />
              <SortTh col="price" label="Price" sortKey={t.sortKey} sortDir={t.sortDir} toggle={t.toggle} style={{ textAlign: 'right' }} title="Median price across the listings matched to this paddle, in US dollars." />
              <SortTh col="tier" label="Tier" sortKey={t.sortKey} sortDir={t.sortDir} toggle={t.toggle} title="Price band: Value under $100, Mid $100-199, Premium $200 and above." />
              <SortTh col="core" label="Core" sortKey={t.sortKey} sortDir={t.sortDir} toggle={t.toggle} style={{ textAlign: 'right' }} title="Core thickness in millimetres - the single spec buyers compare most. 14mm plays firmer and more controlled, 16mm softer with more dwell. Two values mean the paddle ships in both cores." />
              <SortTh col="mentions" label="Mentions" sortKey={t.sortKey} sortDir={t.sortDir} toggle={t.toggle} style={{ textAlign: 'right' }} title="Total mentions across Reddit, Instagram, TikTok, YouTube, X, news and influencer content." />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.familyKey}>
                <td style={{ textAlign: 'right', color: 'var(--muted)', fontWeight: 700 }}>{r.rank}</td>
                <td><PaddleName row={r} /></td>
                <td style={{ textAlign: 'right', position: 'relative' }}>
                  <div
                    aria-hidden
                    style={{
                      position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                      height: 14, width: share(r.reviewCount, maxReviews),
                      background: pgColor(slug), opacity: 0.15, borderRadius: 3,
                    }}
                  />
                  <span style={{ position: 'relative', fontWeight: 700 }}>
                    {r.reviewCount.toLocaleString()}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>{r.avgRating == null ? '—' : r.avgRating.toFixed(2)}</td>
                <td style={{ textAlign: 'right' }}>
                  {money(r.priceUsd)}
                  {r.priceLocal != null && r.priceLocalCurrency !== 'USD' && (
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                      {r.priceLocalCurrency} {r.priceLocal.toFixed(0)}
                    </div>
                  )}
                </td>
                <td>
                  <span
                    className="tag"
                    style={{ background: `${TIER_COLOR[r.tier]}22`, color: TIER_COLOR[r.tier], fontSize: 10, fontWeight: 700 }}
                    title={TIER_LABEL[r.tier]}
                  >
                    {r.tier === 'unknown' ? 'No price' : r.tier}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  {cores(r.specs?.thicknessOptions, r.specs?.thicknessMm ?? null)}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {r.mentions?.total ? r.mentions.total.toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function ProductIntelPage() {
  const [brands, setBrands] = useState<V2Brand[]>([])
  const [data, setData] = useState<PaddleIntelData | null>(null)
  const [voice, setVoice] = useState<CustomerVoiceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const { filteredBrands, setAllBrands, isFiltered } = useBrandFilter()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const brandList = await fetchBrands()
      if (cancelled) return
      setBrands(brandList)
      setAllBrands(brandList)
      const [paddles, cv] = await Promise.all([
        fetchPaddleIntel(brandList),
        fetchCustomerVoice(brandList),
      ])
      if (cancelled) return
      setData(paddles)
      setVoice(cv)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [setAllBrands])

  const visibleSlugs = useMemo(() => {
    const selected = new Set(filteredBrands.map((b) => b.id))
    return (slug: string) => !isFiltered || selected.has(slug)
  }, [filteredBrands, isFiltered])

  const rows = useMemo(
    () => (data?.rows ?? []).filter((r) => visibleSlugs(r.brandSlug)),
    [data, visibleSlugs],
  )

  const coverage = useMemo(
    () => (data?.coverage ?? []).filter((c) => visibleSlugs(c.brandSlug)),
    [data, visibleSlugs],
  )

  const searched = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((r) =>
      r.displayName.toLowerCase().includes(needle) ||
      pgName(r.brandSlug, brands).toLowerCase().includes(needle))
  }, [rows, search, brands])

  /** §3 — price distribution per brand, from the ranked paddles only. */
  const priceByBrand = useMemo(() => {
    const acc = new Map<string, { prices: number[]; tiers: Record<PriceTier, number> }>()
    rows.forEach((r) => {
      const entry = acc.get(r.brandSlug) ??
        { prices: [], tiers: { value: 0, mid: 0, premium: 0, unknown: 0 } }
      if (r.priceUsd != null) entry.prices.push(r.priceUsd)
      entry.tiers[r.tier] += 1
      acc.set(r.brandSlug, entry)
    })
    return Array.from(acc.entries())
      .map(([slug, e]) => {
        const sorted = [...e.prices].sort((a, b) => a - b)
        const mid = Math.floor(sorted.length / 2)
        return {
          slug,
          count: sorted.length,
          min: sorted[0] ?? null,
          median: sorted.length
            ? (sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2)
            : null,
          max: sorted[sorted.length - 1] ?? null,
          tiers: e.tiers,
          missing: e.tiers.unknown,
        }
      })
      .sort((a, b) => (b.median ?? 0) - (a.median ?? 0))
  }, [rows])

  const priceMax = useMemo(
    () => Math.max(1, ...priceByBrand.map((p) => p.max ?? 0)),
    [priceByBrand],
  )

  /** §5 — mention totals, largest first, for the bar scale. */
  const mentionMax = useMemo(
    () => Math.max(1, ...rows.map((r) => r.mentions?.total ?? 0)),
    [rows],
  )

  const mentionRows = useMemo(
    () => searched.filter((r) => (r.mentions?.total ?? 0) > 0)
      .sort((a, b) => (b.mentions?.total ?? 0) - (a.mentions?.total ?? 0)),
    [searched],
  )

  const gaps = useMemo(
    () => (data?.catalogGaps ?? []).filter((g) => visibleSlugs(g.brandSlug)),
    [data, visibleSlugs],
  )

  /* ── per-table sorting + first-column search ──────────────────────────
   *
   * One hook per table rather than one shared sort: these tables answer
   * different questions, and a click on "Median" in the price table should not
   * reorder the technology comparison underneath it. Brand blocks own theirs
   * inside <BrandBlock>, since hooks cannot be called in a loop.
   */
  const coverageAccessor = useCallback((c: BrandCoverage, key: string) => {
    switch (key) {
      case 'brand': return pgName(c.brandSlug, brands)
      case 'ranked': return c.paddlesRanked
      case 'corpus': return c.reviewCorpus
      case 'priced': return c.withPrice
      case 'specs': return c.withSpecs
      case 'tracked': return c.withMentions
      default: return null
    }
  }, [brands])
  const cov = useTableSort(coverage, coverageAccessor, 'corpus', 'desc')
  const coverageShown = cov.sorted.filter((c) => matches(pgName(c.brandSlug, brands), cov.filter))

  const priceAccessor = useCallback((r: typeof priceByBrand[number], key: string) => {
    switch (key) {
      case 'brand': return pgName(r.slug, brands)
      case 'count': return r.count
      case 'min': return r.min
      case 'median': return r.median
      case 'max': return r.max
      default: return null
    }
  }, [brands])
  const pr = useTableSort(priceByBrand, priceAccessor, 'median', 'desc')
  const priceShown = pr.sorted.filter((r) => matches(pgName(r.slug, brands), pr.filter))

  const techAccessor = useCallback((r: PaddleRow, key: string) => {
    switch (key) {
      case 'paddle': return r.displayName
      case 'brand': return pgName(r.brandSlug, brands)
      case 'core': return r.specs?.thicknessOptions?.[0] ?? r.specs?.thicknessMm ?? null
      case 'shape': return r.specs?.shape ?? null
      case 'length': return r.specs?.lengthIn ?? null
      case 'width': return r.specs?.widthIn ?? null
      case 'weight': return r.specs?.weightOzMin ?? null
      case 'handle': return r.specs?.handleLengthIn ?? null
      case 'coreMaterial': return r.specs?.coreMaterial ?? null
      case 'face': return r.specs?.faceMaterial ?? null
      case 'usap': return r.specs?.usapApproved ? 1 : null
      case 'confidence': return r.specs?.confidence ?? null
      default: return null
    }
  }, [brands])
  const techRows = useMemo(() => rows.filter((r) => r.specs != null), [rows])
  const tech = useTableSort(techRows, techAccessor, 'core', 'desc')
  const techShown = tech.sorted.filter((r) => matches(r.displayName, tech.filter))

  const mentionAccessor = useCallback((r: PaddleRow, key: string) => {
    if (key === 'paddle') return r.displayName
    if (key === 'brand') return pgName(r.brandSlug, brands)
    if (key === 'total') return r.mentions?.total ?? null
    const channel = key as keyof NonNullable<PaddleRow['mentions']>
    return r.mentions?.[channel] ?? null
  }, [brands])
  const men = useTableSort(mentionRows, mentionAccessor, 'total', 'desc')
  const mentionShown = men.sorted.filter((r) => matches(r.displayName, men.filter))

  const gapAccessor = useCallback((g: CatalogGapRow, key: string) => {
    switch (key) {
      case 'paddle': return g.displayName
      case 'brand': return pgName(g.brandSlug, brands)
      case 'reviews': return g.reviewCount
      default: return null
    }
  }, [brands])
  const gap = useTableSort(gaps, gapAccessor, 'reviews', 'desc')
  const gapShown = gap.sorted.filter((g) => matches(g.displayName, gap.filter))

  if (loading || !data) return <LoadingPage />

  const totalReviews = rows.reduce((sum, r) => sum + r.reviewCount, 0)
  const withSpecs = rows.filter((r) => r.specs != null).length
  const withPrice = rows.filter((r) => r.priceUsd != null).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <PageHead
        eyebrow="Product Intel"
        title="Paddle"
        accent="comparison"
        sub={`Top ${TOP_N_PER_BRAND} paddles per brand, ranked by customer review volume. Price, technology and mention share side by side.`}
      />
      <FilterBanner />

      {/* ── §1 Coverage ─────────────────────────────────────────────── */}
      <section>
        <div className="kpi-grid">
          <MiniKpi
            label="Brands compared"
            value={coverage.length}
            color="#22c55e"
            tip="Brands in the paddle comparison set. Chosen for competitive relevance, not catalogue size."
            src="brands"
          />
          <MiniKpi
            label="Paddles ranked"
            value={rows.length}
            color="#06b6d4"
            customVs={`max ${TOP_N_PER_BRAND} per brand`}
            tip="Distinct paddle families. Colourways, thicknesses and signature editions of one paddle count once — JOOLA's Perseus Pro IV alone ships under 7 different names."
            src="paddle_reviews + products"
          />
          <MiniKpi
            label="Reviews behind the ranking"
            value={totalReviews.toLocaleString()}
            color="#F5E625"
            customVs={`${data.totals.reviewsExcludedAsAccessories.toLocaleString()} accessory reviews excluded`}
            tip="Customer reviews for the ranked paddles. Cases, shoes, hats and bags are excluded — they account for 14.6% of the review table and would otherwise outrank real paddles."
            src="paddle_reviews"
          />
          <MiniKpi
            label="With published specs"
            value={`${withSpecs}/${rows.length}`}
            color="#a855f7"
            customVs={`${withPrice}/${rows.length} with a price`}
            tip="Paddles for which the manufacturer publishes specifications on its own site. A blank is the brand's silence, not a missing scrape."
            src="paddle_specs"
          />
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <div className="table-wrap">
            <table className="data" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 190 }}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => cov.toggle('brand')}
                      onKeyDown={(e) => { if (e.key === 'Enter') cov.toggle('brand') }}
                      style={{ cursor: 'pointer', marginBottom: 4 }}
                      title="Brand in the comparison set."
                    >
                      Brand {cov.sortKey === 'brand' ? (cov.sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                    </div>
                    <ColumnFilter col="brand" value={cov.filter} onChange={cov.setFilter} placeholder="search brand…" />
                  </th>
                  <SortTh col="ranked" label="Ranked" sortKey={cov.sortKey} sortDir={cov.sortDir} toggle={cov.toggle} style={{ textAlign: 'right' }} title="Paddle families ranked for this brand." />
                  <SortTh col="corpus" label="Review corpus" sortKey={cov.sortKey} sortDir={cov.sortDir} toggle={cov.toggle} style={{ textAlign: 'right' }} title="Total customer reviews across every paddle family for this brand, not just the top 10." />
                  <SortTh col="priced" label="Priced" sortKey={cov.sortKey} sortDir={cov.sortDir} toggle={cov.toggle} style={{ textAlign: 'right' }} title="How many of the ranked paddles have a price on file." />
                  <SortTh col="specs" label="Specs" sortKey={cov.sortKey} sortDir={cov.sortDir} toggle={cov.toggle} style={{ textAlign: 'right' }} title="How many of the ranked paddles have manufacturer-published specifications." />
                  <SortTh col="tracked" label="Tracked" sortKey={cov.sortKey} sortDir={cov.sortDir} toggle={cov.toggle} style={{ textAlign: 'right' }} title="How many of the ranked paddles are tracked for social/news mentions." />
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {coverageShown.map((c) => (
                  <tr key={c.brandSlug}>
                    <td>
                      <span className="brand-dot" style={{ background: pgColor(c.brandSlug) }} />
                      <span style={{ fontWeight: 700, marginLeft: 6 }}>{pgName(c.brandSlug, brands)}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>{c.paddlesRanked}</td>
                    <td style={{ textAlign: 'right' }}>{c.reviewCorpus.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{c.withPrice}/{c.paddlesRanked}</td>
                    <td style={{ textAlign: 'right', color: c.specFillPct === 0 ? 'var(--muted)' : undefined }}>
                      {c.withSpecs}/{c.paddlesRanked}
                    </td>
                    <td style={{ textAlign: 'right' }}>{c.withMentions}/{c.paddlesRanked}</td>
                    <td style={{ fontSize: 11, color: 'var(--muted)' }}>{c.specGapReason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── §2 Top 10 per brand ─────────────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Top {TOP_N_PER_BRAND} paddles per brand
              <SectionInfo
                title="How the ranking is built"
                description={
                  'Ranked by customer review volume, with mention count as the tiebreak. Reviews measure how many people bought the paddle and cared enough to write about it; mentions measure conversation, which spikes on launches. ' +
                  'Every spelling of one paddle is collapsed into a single row — colourways, both core thicknesses, and signature editions listed under the athlete\'s name. Accessories are excluded.'
                }
                source="paddle_reviews · products.review_count · product_mentions"
              />
            </h2>
            <div className="sub">
              Paddles only. {rows.length} families across {coverage.length} brands.
            </div>
          </div>
          <TableSearch value={search} onChange={setSearch} placeholder="Search paddle or brand…" width={280} />
        </div>

        {coverage.map((c) => {
          const brandRows = rows.filter((r) => r.brandSlug === c.brandSlug)
          if (!brandRows.length) return null
          return (
            <BrandBlock
              key={c.brandSlug}
              slug={c.brandSlug}
              rows={brandRows}
              brands={brands}
              reviewCorpus={c.reviewCorpus}
            />
          )
        })}
      </section>

      {/* ── §3 Price comparison ─────────────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Price comparison
              <SectionInfo
                title="Where each brand sits on price"
                description="Range and median price across each brand's ranked paddles, in US dollars. Prices are read from the manufacturer's own storefront in its home currency and converted where needed — the rate used travels with every converted row so it can be audited. Paddles with no price on file are counted separately rather than treated as free."
                source="products.price_usd · fx_rates"
              />
            </h2>
            <div className="sub">Range, median, and Tier mix across the ranked paddles.</div>
          </div>
        </div>
        <div className="card">
          <div className="table-wrap">
            <table className="data" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 190 }}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => pr.toggle('brand')}
                      onKeyDown={(e) => { if (e.key === 'Enter') pr.toggle('brand') }}
                      style={{ cursor: 'pointer', marginBottom: 4 }}
                      title="Brand in the comparison set."
                    >
                      Brand {pr.sortKey === 'brand' ? (pr.sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                    </div>
                    <ColumnFilter col="brand" value={pr.filter} onChange={pr.setFilter} placeholder="search brand…" />
                  </th>
                  <SortTh col="count" label="Priced" sortKey={pr.sortKey} sortDir={pr.sortDir} toggle={pr.toggle} style={{ textAlign: 'right' }} title="Ranked paddles with a price on file." />
                  <SortTh col="min" label="Low" sortKey={pr.sortKey} sortDir={pr.sortDir} toggle={pr.toggle} style={{ textAlign: 'right' }} title="Cheapest ranked paddle." />
                  <SortTh col="median" label="Median" sortKey={pr.sortKey} sortDir={pr.sortDir} toggle={pr.toggle} style={{ textAlign: 'right' }} title="Median price — the midpoint, which a single flagship cannot drag upward the way an average can." />
                  <SortTh col="max" label="High" sortKey={pr.sortKey} sortDir={pr.sortDir} toggle={pr.toggle} style={{ textAlign: 'right' }} title="Most expensive ranked paddle." />
                  <th style={{ width: '34%' }} title="Where this brand's ranked paddles sit on the price line, low to high.">Range</th>
                  <th title="How the ranked paddles split across the three price bands.">Tier mix</th>
                </tr>
              </thead>
              <tbody>
                {priceShown.map((p) => (
                  <tr key={p.slug}>
                    <td>
                      <span className="brand-dot" style={{ background: pgColor(p.slug) }} />
                      <span style={{ fontWeight: 700, marginLeft: 6 }}>{pgName(p.slug, brands)}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {p.count}
                      {p.missing > 0 && (
                        <span style={{ color: 'var(--muted)', fontSize: 10 }}> (+{p.missing} n/a)</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{money(p.min)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(p.median)}</td>
                    <td style={{ textAlign: 'right' }}>{money(p.max)}</td>
                    <td>
                      {p.min != null && p.max != null ? (
                        <div style={{ position: 'relative', height: 16 }} title={`${money(p.min)} – ${money(p.max)}`}>
                          <div style={{
                            position: 'absolute', top: 7, left: 0, right: 0,
                            height: 2, background: 'var(--border)',
                          }} />
                          <div style={{
                            position: 'absolute', top: 5, borderRadius: 3, height: 6,
                            left: `${(p.min / priceMax) * 100}%`,
                            width: `${Math.max(1, ((p.max - p.min) / priceMax) * 100)}%`,
                            background: pgColor(p.slug), opacity: 0.55,
                          }} />
                          {p.median != null && (
                            <div style={{
                              position: 'absolute', top: 2, width: 2, height: 12,
                              left: `${(p.median / priceMax) * 100}%`,
                              background: pgColor(p.slug),
                            }} />
                          )}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--muted)', fontSize: 11 }}>no prices on file</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 10 }}>
                        {(['value', 'mid', 'premium'] as PriceTier[]).map((tier) =>
                          p.tiers[tier] > 0 ? (
                            <span
                              key={tier}
                              className="tag"
                              style={{ background: `${TIER_COLOR[tier]}22`, color: TIER_COLOR[tier], fontWeight: 700 }}
                              title={TIER_LABEL[tier]}
                            >
                              {tier} {p.tiers[tier]}
                            </span>
                          ) : null,
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── §4 Technology comparison ────────────────────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Technology comparison
              <SectionInfo
                title="Manufacturer-published specifications"
                description={
                  'Read from each brand\'s own product pages, not from retailers. Where a cell is blank the brand does not publish that measurement — it is not a failed scrape. ' +
                  'Confidence marks how the value was obtained: labelled from a spec table, variant from a purchase option, prose from marketing copy.'
                }
                source="paddle_specs · migration 024"
              />
            </h2>
            <div className="sub">
              {withSpecs} of {rows.length} ranked paddles have published specifications.
            </div>
          </div>
        </div>
        <div className="card">
          <div className="table-wrap" style={{ maxHeight: 620, overflowY: 'auto' }}>
            <table className="data" style={{ width: '100%' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--sticky-bg)' }}>
                <tr>
                  <th style={{ minWidth: 230 }}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => tech.toggle('paddle')}
                      onKeyDown={(e) => { if (e.key === 'Enter') tech.toggle('paddle') }}
                      style={{ cursor: 'pointer', marginBottom: 4 }}
                      title="The paddle. Click the name to open the page its reviews came from."
                    >
                      Paddle {tech.sortKey === 'paddle' ? (tech.sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                    </div>
                    <ColumnFilter col="paddle" value={tech.filter} onChange={tech.setFilter} placeholder="search paddle…" />
                  </th>
                  <SortTh col="brand" label="Brand" sortKey={tech.sortKey} sortDir={tech.sortDir} toggle={tech.toggle} title="Brand that publishes these specifications." />
                  <SortTh col="core" label="Core" sortKey={tech.sortKey} sortDir={tech.sortDir} toggle={tech.toggle} style={{ textAlign: 'right' }} title="Core thickness in millimetres. The primary handling trade-off: thinner plays firmer and more powerful, thicker adds dwell and control." />
                  <SortTh col="shape" label="Shape" sortKey={tech.sortKey} sortDir={tech.sortDir} toggle={tech.toggle} title="Face shape. Elongated adds reach and power at the cost of forgiveness; widebody trades reach for a larger sweet spot; hybrid sits between." />
                  <SortTh col="length" label="Length" sortKey={tech.sortKey} sortDir={tech.sortDir} toggle={tech.toggle} style={{ textAlign: 'right' }} title="Overall paddle length in inches. Regulation caps length plus width at 24 inches." />
                  <SortTh col="width" label="Width" sortKey={tech.sortKey} sortDir={tech.sortDir} toggle={tech.toggle} style={{ textAlign: 'right' }} title="Face width in inches." />
                  <SortTh col="weight" label="Weight" sortKey={tech.sortKey} sortDir={tech.sortDir} toggle={tech.toggle} style={{ textAlign: 'right' }} title="Unweighted paddle weight in ounces, as published. Most brands quote a range because manufacturing varies." />
                  <SortTh col="handle" label="Handle" sortKey={tech.sortKey} sortDir={tech.sortDir} toggle={tech.toggle} style={{ textAlign: 'right' }} title="Handle length in inches. Longer handles suit two-handed backhands; shorter handles leave more face." />
                  <SortTh col="coreMaterial" label="Core material" sortKey={tech.sortKey} sortDir={tech.sortDir} toggle={tech.toggle} title="Core construction material as the brand describes it." />
                  <SortTh col="face" label="Face" sortKey={tech.sortKey} sortDir={tech.sortDir} toggle={tech.toggle} title="Hitting-surface material as the brand describes it." />
                  <SortTh col="usap" label="USAP" sortKey={tech.sortKey} sortDir={tech.sortDir} toggle={tech.toggle} style={{ textAlign: 'center' }} title="Approved by USA Pickleball for tournament play. Blank means the brand does not state it — not that the paddle is unapproved." />
                  <SortTh col="confidence" label="Source" sortKey={tech.sortKey} sortDir={tech.sortDir} toggle={tech.toggle} style={{ textAlign: 'center' }} title="How the value was obtained: labelled from a spec table, variant from a purchase option, prose from marketing copy." />
                </tr>
              </thead>
              <tbody>
                {techShown.map((r) => (
                  <tr key={`${r.brandSlug}-${r.familyKey}`}>
                    <td>
                      <PaddleName row={r} />
                      {(r.specs?.variantCount ?? 0) > 1 && (
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                          {r.specs?.variantCount} published variants
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="brand-dot" style={{ background: pgColor(r.brandSlug) }} />
                      <span style={{ marginLeft: 6, fontSize: 11 }}>{pgName(r.brandSlug, brands)}</span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>
                      {cores(r.specs?.thicknessOptions, r.specs?.thicknessMm ?? null)}
                    </td>
                    <td style={{ textTransform: 'capitalize' }}>{r.specs?.shape ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{num(r.specs?.lengthIn ?? null, 2, '"')}</td>
                    <td style={{ textAlign: 'right' }}>{num(r.specs?.widthIn ?? null, 2, '"')}</td>
                    <td style={{ textAlign: 'right' }}>
                      {weight(r.specs?.weightOzMin ?? null, r.specs?.weightOzMax ?? null)}
                    </td>
                    <td style={{ textAlign: 'right' }}>{num(r.specs?.handleLengthIn ?? null, 2, '"')}</td>
                    <td style={{ fontSize: 11 }}>{r.specs?.coreMaterial ?? '—'}</td>
                    <td style={{ fontSize: 11 }}>{r.specs?.faceMaterial ?? '—'}</td>
                    <td style={{ textAlign: 'center' }}>
                      {r.specs?.usapApproved ? '✓' : '—'}
                    </td>
                    <td style={{ textAlign: 'center', fontSize: 10, color: 'var(--muted)' }}>
                      {r.specs?.confidence ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.some((r) => r.specs == null) && (
            <div style={{ padding: '10px 14px', fontSize: 11, color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>
              {rows.filter((r) => r.specs == null).length} ranked {rows.filter((r) => r.specs == null).length === 1 ? 'paddle is' : 'paddles are'} absent from this table because
              their manufacturer publishes no specifications for them. CRBN&apos;s X Series is
              the largest case — their most-reviewed line, with no specifications anywhere on
              the product page.
            </div>
          )}
        </div>
      </section>

      {/* ── §5 Mentions per product per competitor ──────────────────── */}
      <section>
        <div className="section-head">
          <div>
            <h2>
              Mention count per paddle
              <SectionInfo
                title="Conversation volume by channel"
                description="Every tracked mention of each paddle, split by where it was said. This measures conversation, not sales — a launch or a controversy moves it far faster than steady demand does, which is why the ranking above uses reviews instead. Only paddles present in the curated tracking catalogue appear here."
                source="product_mentions · products_catalog"
              />
            </h2>
            <div className="sub">
              {mentionRows.length} of {rows.length} ranked paddles are tracked for mentions.
            </div>
          </div>
        </div>
        <div className="card">
          <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
            <table className="data" style={{ width: '100%' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--sticky-bg)' }}>
                <tr>
                  <th style={{ minWidth: 230 }}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => men.toggle('paddle')}
                      onKeyDown={(e) => { if (e.key === 'Enter') men.toggle('paddle') }}
                      style={{ cursor: 'pointer', marginBottom: 4 }}
                      title="The paddle. Click the name to open the page its reviews came from."
                    >
                      Paddle {men.sortKey === 'paddle' ? (men.sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                    </div>
                    <ColumnFilter col="paddle" value={men.filter} onChange={men.setFilter} placeholder="search paddle…" />
                  </th>
                  <SortTh col="brand" label="Brand" sortKey={men.sortKey} sortDir={men.sortDir} toggle={men.toggle} title="Brand this paddle belongs to." />
                  <SortTh col="total" label="Total" sortKey={men.sortKey} sortDir={men.sortDir} toggle={men.toggle} style={{ textAlign: 'right' }} title="Mentions across every tracked channel." />
                  <th style={{ width: '20%' }} title="Total mentions relative to the most-mentioned paddle on this page.">Share</th>
                  {CHANNELS.map(([key, label]) => (
                    <SortTh key={key} col={key} label={label} sortKey={men.sortKey} sortDir={men.sortDir} toggle={men.toggle} style={{ textAlign: 'right' }} title={`Mentions on ${label}.`} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {mentionShown.map((r) => (
                  <tr key={`${r.brandSlug}-${r.familyKey}`}>
                    <td><PaddleName row={r} /></td>
                    <td>
                      <span className="brand-dot" style={{ background: pgColor(r.brandSlug) }} />
                      <span style={{ marginLeft: 6, fontSize: 11 }}>{pgName(r.brandSlug, brands)}</span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>
                      {r.mentions?.total.toLocaleString()}
                    </td>
                    <td>
                      <div style={{
                        height: 8, borderRadius: 4, background: pgColor(r.brandSlug),
                        width: share(r.mentions?.total ?? 0, mentionMax), opacity: 0.7,
                      }} />
                    </td>
                    {CHANNELS.map(([key]) => {
                      const value = r.mentions?.[key] ?? 0
                      return (
                        <td key={key} style={{ textAlign: 'right', color: value ? undefined : 'var(--muted)' }}>
                          {value || '—'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── §6 Catalog gaps ─────────────────────────────────────────── */}
      {gaps.length > 0 && (
        <section>
          <div className="section-head">
            <div>
              <h2>
                Untracked paddles
                <SectionInfo
                  title="Popular paddles missing from mention tracking"
                  description="Paddles with 50 or more customer reviews that generate no tracked mentions at all. That combination almost always means the paddle is missing from the curated tracking catalogue rather than that nobody is discussing it — so this list is a work queue, and every row is conversation currently invisible to every other page in this dashboard."
                  source="paddle_reviews vs products_catalog"
                />
              </h2>
              <div className="sub">
                {gaps.length} well-reviewed {gaps.length === 1 ? 'paddle is' : 'paddles are'} not in the tracking catalogue.
              </div>
            </div>
          </div>
          <div className="card">
            <div className="table-wrap">
              <table className="data" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 230 }}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => gap.toggle('paddle')}
                        onKeyDown={(e) => { if (e.key === 'Enter') gap.toggle('paddle') }}
                        style={{ cursor: 'pointer', marginBottom: 4 }}
                        title="The paddle."
                      >
                        Paddle {gap.sortKey === 'paddle' ? (gap.sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                      </div>
                      <ColumnFilter col="paddle" value={gap.filter} onChange={gap.setFilter} placeholder="search paddle…" />
                    </th>
                    <SortTh col="brand" label="Brand" sortKey={gap.sortKey} sortDir={gap.sortDir} toggle={gap.toggle} title="Brand this paddle belongs to." />
                    <SortTh col="reviews" label="Reviews" sortKey={gap.sortKey} sortDir={gap.sortDir} toggle={gap.toggle} style={{ textAlign: 'right' }} title="Customer reviews for a paddle that has no mention tracking at all." />
                  </tr>
                </thead>
                <tbody>
                  {gapShown.map((g) => (
                    <tr key={`${g.brandSlug}-${g.displayName}`}>
                      <td style={{ fontWeight: 600 }}>{g.displayName}</td>
                      <td>
                        <span className="brand-dot" style={{ background: pgColor(g.brandSlug) }} />
                        <span style={{ marginLeft: 6, fontSize: 11 }}>{pgName(g.brandSlug, brands)}</span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{g.reviewCount.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ── §7 Customer Voice (retained) ────────────────────────────── */}
      <CustomerVoiceSection
        voice={voice}
        brands={brands}
        filteredSlugs={filteredBrands.map((b) => b.id)}
        isFiltered={isFiltered}
      />
    </div>
  )
}
