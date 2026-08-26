'use client'

/**
 * Customer Voice — what buyers actually say about each paddle.
 *
 * Reads `paddle_reviews` (via fetchCustomerVoice) — 22k retail reviews across
 * yotpo / okendo / judgeme / bazaarvoice, arriving pre-enriched with sentiment,
 * crisis flags and complaint categories.
 *
 * NOT `product_reviews`: migration 016 created that table for a per-brand widget
 * scraper that never received credentials, and it still holds 0 rows.
 */

import { Fragment, useMemo, useState } from 'react'
import { SectionInfo, MiniKpi, pgColor, pgName } from '@/components/v2/PageShell'
import { fmt } from '@/components/v2/charts'
import { type V2Brand } from '@/lib/v2/data'
import {
  type CustomerVoiceData,
  type ProductReviewSummary,
} from '@/lib/v2/productIntel'
import { tipFor } from '@/lib/v2/tooltips'

const emptyStyle: React.CSSProperties = { textAlign: 'center', padding: 48 }

function starRow(rating: number | null): string {
  if (rating == null) return '—'
  const full = Math.round(rating)
  return '★'.repeat(Math.max(0, Math.min(5, full))).padEnd(5, '☆')
}

function sentPill(kind: ProductReviewSummary): { cls: string; label: string } {
  const negShare = kind.total > 0 ? kind.negative / kind.total : 0
  if (kind.crisis > 0) return { cls: 'pill-red', label: 'crisis flagged' }
  if (negShare >= 0.25) return { cls: 'pill-red', label: 'negative skew' }
  if (negShare >= 0.1) return { cls: 'pill-ghost', label: 'mixed' }
  return { cls: 'pill-green', label: 'positive' }
}

/** Complaint keys arrive snake_cased from the enrichment step. */
function prettyComplaint(c: string | null): string {
  if (!c) return '—'
  return c.replace(/_/g, ' ')
}

export function CustomerVoiceSection({
  voice,
  brands,
  filteredSlugs,
  isFiltered,
}: {
  voice: CustomerVoiceData | null
  brands: V2Brand[]
  filteredSlugs: string[]
  isFiltered: boolean
}) {
  const [openProduct, setOpenProduct] = useState<string | null>(null)

  // Brand filter is applied here rather than in the fetch so switching brands
  // does not trigger a refetch of the whole review corpus.
  const products = useMemo(() => {
    if (!voice) return []
    if (!isFiltered) return voice.products
    const allow = new Set(filteredSlugs)
    return voice.products.filter((p) => allow.has(p.brandSlug))
  }, [voice, filteredSlugs, isFiltered])

  // Headline numbers must reflect the brand filter too, so recompute from the
  // filtered product rollups instead of reusing the corpus-wide aggregates.
  const kpis = useMemo(() => {
    const total = products.reduce((s, p) => s + p.total, 0)
    const pos = products.reduce((s, p) => s + p.positive, 0)
    const neg = products.reduce((s, p) => s + p.negative, 0)
    const crisis = products.reduce((s, p) => s + p.crisis, 0)
    const rated = products.filter((p) => p.avgRating != null)
    const weighted = rated.reduce((s, p) => s + (p.avgRating as number) * p.total, 0)
    const ratedTotal = rated.reduce((s, p) => s + p.total, 0)
    return {
      total,
      avg: ratedTotal > 0 ? weighted / ratedTotal : null,
      posPct: total > 0 ? Math.round((pos / total) * 100) : 0,
      neg,
      crisis,
    }
  }, [products])

  if (!voice || voice.reviews === 0) {
    return (
      <section>
        <div className="section-head">
          <div>
            <h2>
              Customer voice · retail reviews
              <SectionInfo
                title="Customer Voice"
                description="What buyers write in their own words after purchase, pulled from retailer review widgets."
                source="paddle_reviews"
              />
            </h2>
          </div>
        </div>
        <div className="card" style={emptyStyle}>
          <div style={{ fontSize: 13 }}>No retail reviews available.</div>
        </div>
      </section>
    )
  }

  const sampled = voice.sampled
  const isSample = sampled < voice.reviews

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>
            Customer voice · retail reviews
            <SectionInfo
              title="Customer Voice"
              description="What buyers write in their own words after purchase. Collected from the review widgets on retailer product pages (Okendo, Judge.me, Yotpo, Bazaarvoice) and scored for sentiment, complaint type and crisis risk. Unlike the star rating on a brand's own site, these are cross-retailer and include the review text itself."
              source="paddle_reviews · sentiment from the AI enrichment pipeline"
            />
          </h2>
          <div className="sub">
            Post-purchase opinion per paddle — the reasons behind the star rating.
          </div>
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 12 }}>
        <MiniKpi
          label="Reviews"
          value={fmt(kpis.total)}
          color="#06b6d4"
          customVs={isFiltered ? 'in selected brands' : `of ${fmt(voice.reviews)} total`}
          tip="How many customer reviews are included in the current brand selection. A larger number makes the sentiment split below more trustworthy."
          src="paddle_reviews"
        />
        <MiniKpi
          label="Avg rating"
          value={kpis.avg != null ? kpis.avg.toFixed(2) : '—'}
          color="#F5E625"
          customVs={kpis.avg != null ? `${starRow(kpis.avg)} out of 5` : 'no ratings'}
          tip="Average star rating out of 5, weighted by how many reviews each paddle has — so a paddle with 300 reviews counts more than one with 3."
          src="paddle_reviews.rating"
        />
        <MiniKpi
          label="Positive"
          value={`${kpis.posPct}%`}
          color={kpis.posPct >= 85 ? '#22c55e' : '#f59e0b'}
          customVs={`${fmt(kpis.neg)} negative reviews`}
          tip="Share of reviews the sentiment classifier scored as positive. Retail reviews skew high across the whole category, so compare brands against each other rather than against 50%."
          src="paddle_reviews.sentiment_label"
        />
        <MiniKpi
          label="Crisis flags"
          value={fmt(kpis.crisis)}
          color={kpis.crisis > 0 ? '#ef4444' : '#22c55e'}
          customVs="reviews needing a look"
          tip="Reviews the classifier flagged as a potential problem — safety, breakage or a complaint likely to escalate. Worth reading individually even when the count is small."
          src="paddle_reviews.is_crisis"
        />
      </div>

      {isSample && (
        <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 10 }}>
          Based on the {fmt(sampled)} most recent reviews of {fmt(voice.reviews)} total —
          the full corpus is too large to load in the browser.
        </div>
      )}

      <div className="card"><div className="card-pad">
        <div className="table-wrap">
        <table className="data" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>
                Paddle
                <SectionInfo title="Paddle" description="Product name as it appears on the retailer's page. The same paddle can be listed slightly differently by different retailers." source="paddle_reviews.canonical_name" />
              </th>
              <th style={{ textAlign: 'left' }} title={tipFor('Brand')}>Brand</th>
              <th style={{ textAlign: 'right' }}>
                Reviews
                <SectionInfo title="Reviews" description="Number of customer reviews found for this paddle across all tracked retailers." source="paddle_reviews" />
              </th>
              <th style={{ textAlign: 'right' }}>
                Rating
                <SectionInfo title="Rating" description="Average star rating out of 5 for this paddle." source="paddle_reviews.rating" />
              </th>
              <th style={{ textAlign: 'left' }}>
                Sentiment
                <SectionInfo title="Sentiment" description="How the reviews split between positive, neutral and negative, as scored by the AI classifier reading the review text." source="paddle_reviews.sentiment_label" />
              </th>
              <th style={{ textAlign: 'left' }}>
                Top complaint
                <SectionInfo title="Top Complaint" description="The most common problem named in this paddle's negative reviews — for example delamination, edge guard, or a dead spot. Blank means no recurring complaint was detected." source="paddle_reviews.complaint_category" />
              </th>
              <th style={{ textAlign: 'right' }}>
                Verified
                <SectionInfo title="Verified" description="Share of reviews the retailer confirmed came from an actual purchase. Lower percentages deserve more scepticism." source="paddle_reviews.is_verified" />
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const key = `${p.brandSlug}::${p.productName}`
              const open = openProduct === key
              const pill = sentPill(p)
              const posPct = p.total > 0 ? Math.round((p.positive / p.total) * 100) : 0
              return (
                <Fragment key={key}>
                  <tr
                    className={p.isJoola ? 'joola' : undefined}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setOpenProduct(open ? null : key)}
                  >
                    <td style={{ fontWeight: p.isJoola ? 700 : 400 }}>{p.productName}</td>
                    <td>
                      <span style={{
                        display: 'inline-block', width: 8, height: 8, borderRadius: 4,
                        background: pgColor(p.brandSlug), marginRight: 6,
                      }} />
                      {pgName(p.brandSlug, brands)}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(p.total)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {p.avgRating != null ? p.avgRating.toFixed(2) : '—'}
                    </td>
                    <td>
                      <span className={`pill ${pill.cls}`}>{pill.label}</span>
                      <span style={{ fontSize: 11, opacity: 0.65, marginLeft: 8 }}>
                        {posPct}% pos · {p.negative} neg
                      </span>
                    </td>
                    <td style={{ fontSize: 12 }}>{prettyComplaint(p.topComplaint)}</td>
                    <td style={{ textAlign: 'right' }}>{p.verifiedPct}%</td>
                    <td style={{ textAlign: 'right', opacity: 0.5, fontSize: 11 }}>
                      {open ? '▲ hide' : '▼ read'}
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={8} style={{ background: 'var(--bg-2)', padding: '12px 16px' }}>
                        {p.topReviews.map((rv) => (
                          <div key={rv.id} style={{
                            padding: '10px 0',
                            borderBottom: '1px solid var(--line-2)',
                          }}>
                            <div style={{ fontSize: 12, marginBottom: 3 }}>
                              <strong>{rv.title || '(no title)'}</strong>
                              <span style={{ marginLeft: 10, opacity: 0.7 }}>
                                {rv.rating != null ? `${rv.rating}/5` : '—'}
                              </span>
                              {rv.isCrisis && (
                                <span className="pill pill-red" style={{ marginLeft: 8 }}>crisis</span>
                              )}
                              {rv.isIncentivized && (
                                <span className="pill pill-ghost" style={{ marginLeft: 6 }}>incentivized</span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.5 }}>
                              {rv.body || '(no review text)'}
                            </div>
                            <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>
                              {rv.retailer || rv.source}
                              {rv.postedAt ? ` · ${rv.postedAt.slice(0, 10)}` : ''}
                              {rv.isVerified ? ' · verified purchase' : ''}
                            </div>
                          </div>
                        ))}
                        {p.topReviews.length === 0 && (
                          <div style={{ fontSize: 12, opacity: 0.6 }}>No review text captured.</div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
        </div>
        {products.length === 0 && (
          <div style={{ ...emptyStyle, padding: 32, fontSize: 13 }}>
            No reviews for the selected brands.
          </div>
        )}
      </div></div>
    </section>
  )
}
