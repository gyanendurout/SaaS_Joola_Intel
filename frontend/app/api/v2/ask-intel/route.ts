/**
 * Ask Intel — POST /api/v2/ask-intel
 *
 * Two-step OpenAI flow:
 *   1. Planner (gpt-4o-mini, json_object) — emits a structured QueryPlan
 *      against the WHITELISTED_TABLES schema.
 *   2. Executor — validates the plan via validateQueryPlan, translates it
 *      to a typed Supabase PostgREST call, returns rows truncated to ≤200.
 *   3. Answerer (gpt-4o-mini, json_object) — turns rows + user question
 *      into a full AskIntelResponse (answer, visuals, followups, etc.).
 *
 * Uses SERVER-ONLY env vars:
 *   • OPENAI_API_KEY (preferred) or NEXT_PUBLIC_OPENAI_KEY (fallback w/ warn).
 *   • SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (server-only) for unrestricted
 *     reads; falls back to NEXT_PUBLIC_* when service role is missing.
 */

import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'
import {
  WHITELISTED_TABLES,
  buildSchemaPrompt,
  TRACKED_BRAND_SLUGS,
  METRICS,
} from '@/lib/v2/askIntel/schema'
import {
  validateQueryPlan,
  type QueryPlan,
  type FilterClause,
} from '@/lib/v2/askIntel/sqlSafety'
import type {
  AskIntelRequest,
  AskIntelResponse,
  Visual,
  FollowUp,
  QueryInfo,
} from '@/lib/v2/askIntel/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ─── Lazy clients ──────────────────────────────────────────────────────

function getOpenAI(): OpenAI {
  const serverKey = process.env.OPENAI_API_KEY
  const fallback = process.env.NEXT_PUBLIC_OPENAI_KEY
  if (!serverKey && fallback) {
    console.warn(
      '[ask-intel] OPENAI_API_KEY not set — falling back to NEXT_PUBLIC_OPENAI_KEY. ' +
      'Move the key to a server-only env var before production.'
    )
  }
  const apiKey = serverKey || fallback
  if (!apiKey) throw new Error('OpenAI API key not configured.')
  return new OpenAI({ apiKey })
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase credentials not configured.')
  return createClient(url, key, { auth: { persistSession: false } })
}

// ─── Prompts ───────────────────────────────────────────────────────────

const PLANNER_SYSTEM = `You are the analytics planner for JOOLA Intel — a pickleball competitive intelligence dashboard.

Your job: translate a natural-language question into a STRUCTURED query plan (no raw SQL) that the API will execute against Supabase.

Output JSON ONLY in this exact shape (do NOT wrap in markdown):
{
  "intent": "brief description of what the user wants",
  "dataSources": ["table_name", ...],
  "plan": {
    "table": "<one whitelisted table>",
    "select": ["col", ...] OR "*",
    "filters": [{ "column": "...", "operator": "eq|neq|gt|gte|lt|lte|ilike|in|is|not.is", "value": ... }],
    "groupBy": ["col", ...]  // optional, aggregates in-memory
    "aggregations": [{ "column": "...", "fn": "sum|avg|min|max|count", "alias": "..." }],
    "orderBy": [{ "column": "...", "direction": "asc|desc" }],
    "limit": <number, defaults to 200, max 1000>
  },
  "visualPlan": "kpi_cards | bar_chart | line_chart | donut | table | scatter",
  "confidence": 0.0 - 1.0,
  "clarification": "<optional: ask user to clarify when intent is ambiguous>"
}

Rules:
- Only reference tables and columns that appear in the schema below — EXACT names, no aliases.
- Date filters use the table's dateField. Recent windows = last 30 days by default.
- Brand filters use brand_id (UUID) — DO NOT filter on brand slug directly. The executor will translate slug → brand_id.
- Use mention_facts for cross-channel mentions; prefer is_crisis / is_purchase_intent flags over raw sentiment_label.
- Engagement rate is computed in-app; for engagement questions return raw posts/profile rows.
- If the question is ambiguous or out of scope, set "clarification" and skip "plan".
- Always set "limit" between 1 and 1000.

CRITICAL — NAME-TO-UUID RESOLUTION:
- NEVER place a product name, brand name, or athlete name into a filter value when the column is "_id" (product_id, brand_id, athlete_id, influencer_id). The executor auto-resolves names → UUIDs at runtime.
- You MAY emit a filter like { "column": "product_id", "operator": "eq", "value": "Pro V Kosmos" } — the executor will resolve "Pro V Kosmos" against products_catalog.display_name and products_catalog.aliases[].
- For brand_id, the executor resolves against brands.slug then brands.name.
- For athlete_id / influencer_id, against influencers.name.
- ALTERNATIVELY: when uncertain, you can use mention_facts with a text_snippet ilike '%<name>%' filter for fuzzy text search.
- If the user asks about a SPECIFIC product, prefer querying product_attention_summary (period='last_30d') or product_attention_daily with product_id = '<product name>'. The executor handles the lookup.

DATA SCOPE — Out of scope topics:
- If the user asks about WEATHER, NEWS unrelated to pickleball brands, GENERAL KNOWLEDGE, or anything not in the schema below — set "clarification" with a polite scope message and skip "plan".
- If the user asks about FUTURE data (e.g. "sales for next year", "predictions for 2027") — set "clarification" explaining we only have historical data.
- If the user asks to DELETE, MODIFY, INSERT, DROP or UPDATE anything — set "clarification" with a read-only message.
- If the message is empty, gibberish (no recognizable English words or product/brand names), or extremely vague (e.g. "tell me everything", "what's good", "show me data") — set "clarification" asking for a more specific question.
- If the user asks an ambiguous comparative ("which brand is best") — set "clarification" asking "best at what? (mentions, sentiment, sales likelihood, ad spend, follower growth?)"

CRITICAL — COUNTING ROWS:
- NEVER put "count(*)" or any aggregate function into the "select" array. The select array is a list of column names ONLY.
- For counts, use the "aggregations" key: aggregations:[{column:"*",fn:"count",alias:"n"}]. Combine with groupBy if you want per-group counts.
- For "how many" questions, the planner can also just set select:["id"] limit:200 and let the answerer report the row count from the executed result.

CRITICAL — TABLE SELECTION (which table holds which data):
- For "products mentioned on Reddit/IG/YT/TikTok/X" — use mention_facts WITH channel filter (eq 'reddit' / 'reddit_comment' / 'ig_comment' / 'yt_comment' / 'tiktok' / 'tiktok_comment' / 'x' / 'x_influencer'). DO NOT filter reddit_mentions / ig_comments / yt_comments / tiktok_videos / x_posts on product_id — those tables don't have product_id columns. Only mention_facts and product_attention_* have product_id.
- For "athlete mentions" — same rule. Use mention_facts WHERE athlete_id IS NOT NULL with channel filter. Don't put athlete_id on the raw channel tables.
- For TikTok engagement/views — use tiktok_videos (columns: like_count, comment_count, view_count, share_count). Sort by view_count or like_count desc.
- For "top negative Reddit threads" — use reddit_mentions WHERE sentiment_label='negative' OR is_crisis=true. Order by score (upvotes) desc or velocity_per_hour desc. Do NOT use a column called 'negative' or 'sentiment'.
- For brand sentiment rollups — use mention_facts GROUP BY brand_id, count is_crisis or sentiment_label.

CRITICAL — Common column-name mistakes to AVOID:
- product_attention_summary / product_attention_daily: column is "mentions_total" (NOT "total_mentions"); column is "attention_score" (NOT "score" or "total_attention"); column is "joola_vs_competitor_gap" (NOT "gap"); column is "rank_in_brand" (NOT "rank"); product_attention_daily date column is "attention_date" (NOT "date").
- mention_facts: column is "sentiment_label" (NOT "sentiment"); flags are "is_crisis"/"is_opportunity"/"is_purchase_intent" (NOT "crisis"/"opportunity"/"purchase_intent").
- products: columns are "price_usd","sale_price_usd","discount_pct","avg_rating","review_count" (NOT "price"/"rating"/"reviews"/"discount").
- ig_posts/yt_videos/tiktok_videos: columns are "like_count","comment_count","view_count" (NOT "likes"/"comments"/"views").
- x_posts: "like_count","retweet_count","reply_count","view_count" (NOT "likes"/"retweets"/"replies"/"views").
- reddit_mentions: column is "upvotes" (NOT "score"); column is "post_title" (NOT "title"); column is "content_text" (NOT "body" or "text"); column is "post_url" (NOT "url"); column is "num_comments" (NOT "comments"); also has "velocity_per_hour", "is_removed", "is_crisis", "sentiment_label".
- tiktok_videos: column for caption is "text" (NOT "caption" or "description"); column is "view_count" (NOT "play_count" or "views"); also has "like_count", "comment_count", "share_count".
- promotions: "discount_pct","promo_type","banner_text" (NOT "discount"/"type"/"text").

When using aggregations + orderBy, the orderBy can reference the aggregation alias (e.g. aggregations:[{column:"mentions_total",fn:"sum",alias:"total"}], orderBy:[{column:"total",direction:"desc"}]). The executor handles in-memory sorting for aliases.

Brand slugs you can mention to users:
${TRACKED_BRAND_SLUGS.join(', ')}

${buildSchemaPrompt()}
`

const ANSWERER_SYSTEM = `You are a business analyst for JOOLA Intel. Translate query results into a clear, executive-grade response.

Output JSON ONLY in this shape (no markdown fences):
{
  "answer": "1-3 sentence narrative answering the question",
  "headline": "4-8 word headline summary",
  "visuals": [<see schema below>],
  "followups": [{ "label": "...", "prompt": "..." }, ...],   // 3-5 useful next questions
  "dataSources": ["table_name", ...],
  "warnings": ["..."],          // surface empty results, partial coverage, calibration caveats
  "confidence": 0.0 - 1.0,
  "methodology": "1-2 sentence description of how the answer was computed"
}

Visual shapes:
- { "type": "kpi_cards", "title?": "...", "cards": [{ "label": "...", "value": "...", "caption?": "...", "color?": "#hex" }] }
- { "type": "bar_chart", "title?": "...", "data": [{ "label": "...", "value": N, "color?": "#hex" }], "unitSuffix?": "%" }
- { "type": "line_chart", "title?": "...", "xLabels": ["W1", ...], "series": [{ "id": "...", "label": "...", "color?": "#hex", "data": [N, ...] }], "yLabel?": "..." }
- { "type": "donut", "title?": "...", "data": [{ "name": "...", "value": N, "color?": "#hex" }], "centerLabel?": "...", "centerSub?": "..." }
- { "type": "table", "title?": "...", "columns": [{ "key": "...", "label": "...", "align?": "left|right|center", "format?": "number|percent|currency|date|text" }], "rows": [{ "<key>": value }], "joolaColumn?": "brand" }

Rules:
- Pick AT MOST 2 visuals. Prefer kpi_cards + one chart, OR a single table for list questions.
- Color JOOLA bars/series with "#22c55e". Other brands use their slug-based colors when you can infer them; otherwise omit "color".
- Always include 3 followup questions.
- If rows are empty, set answer="No matching data..." and add a clear warning.
- Cite tables you actually used in dataSources.
- Trust the is_crisis flag over raw sentiment_label coverage (which is still calibrating).
- Sales-related metrics (sales_likelihood_score) are MODELLED likelihoods, NOT confirmed sales — add a warning to that effect.
- Rows from brand-linked tables include a nested "brands" object: { slug, name }. Use brands.name as the display label in visuals and narratives. Example row: { brand_id: "uuid", followers: 50000, brands: { slug: "joola", name: "JOOLA" } } → use label "JOOLA", value 50000.
- For ranking / comparison queries (top brands by X), ALWAYS generate a bar_chart or kpi_cards visual — do not return visuals:[] when ranked data is available.

Brand color map (for visualization tinting): joola=#22c55e selkirk=#F5E625 crbn=#818cf8 franklin=#ec4899 engage=#06b6d4 paddletek=#f59e0b six-zero=#a855f7 onix=#ef4444 wilson=#14b8a6 gamma=#60a5fa head=#0ea5e9
`

// ─── Alias auto-correct (defensive — planner sometimes hallucinates) ─

/**
 * Common LLM column-name confusions. Maps generated name → real DB name.
 * Applied PER TABLE because some names are legitimate elsewhere (e.g.
 * `total_views` is real on yt_channel_weekly).
 */
const COLUMN_ALIAS_MAP: Record<string, Record<string, string>> = {
  product_attention_summary: {
    total_mentions: 'mentions_total',
    mention_count: 'mentions_total',
    total_attention: 'attention_score',
    score: 'attention_score',
    gap: 'joola_vs_competitor_gap',
    rank: 'rank_in_brand',
  },
  product_attention_daily: {
    total_mentions: 'mentions_total',
    mention_count: 'mentions_total',
    total_attention: 'attention_score',
    score: 'attention_score',
    date: 'attention_date',
  },
  mention_facts: {
    sentiment: 'sentiment_label',
    crisis: 'is_crisis',
    opportunity: 'is_opportunity',
    purchase_intent: 'is_purchase_intent',
    competitor_switch: 'is_competitor_switch',
  },
  products: {
    rating: 'avg_rating',
    reviews: 'review_count',
    price: 'price_usd',
    sale_price: 'sale_price_usd',
    discount: 'discount_pct',
  },
  promotions: {
    discount: 'discount_pct',
    type: 'promo_type',
    text: 'banner_text',
  },
  reddit_mentions: {
    // Schema names map: planner-friendly -> real DB column.
    score: 'upvotes',
    title: 'post_title',
    body: 'content_text',
    text: 'content_text',
    url: 'post_url',
    comments: 'num_comments',
    sentiment: 'sentiment_label',
    crisis: 'is_crisis',
  },
  ig_posts: { likes: 'like_count', comments: 'comment_count', views: 'view_count' },
  yt_videos: { views: 'view_count', likes: 'like_count', comments: 'comment_count' },
  tiktok_videos: {
    views: 'view_count',
    likes: 'like_count',
    comments: 'comment_count',
    play_count: 'view_count',
    caption: 'text',
    description: 'text',
    title: 'text',
  },
  x_posts: { likes: 'like_count', retweets: 'retweet_count', replies: 'reply_count', views: 'view_count' },
}

function autoCorrectAliases(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input
  const plan = input as Record<string, unknown>
  const tableName = typeof plan.table === 'string' ? plan.table : ''
  const aliasMap = COLUMN_ALIAS_MAP[tableName]
  if (!aliasMap) return plan
  const fix = (c: string): string => aliasMap[c] || c
  const out: Record<string, unknown> = { ...plan }
  if (Array.isArray(plan.select)) {
    out.select = (plan.select as string[]).map(fix)
  }
  if (Array.isArray(plan.filters)) {
    out.filters = (plan.filters as Array<Record<string, unknown>>).map((f) => ({
      ...f,
      column: typeof f.column === 'string' ? fix(f.column) : f.column,
    }))
  }
  if (Array.isArray(plan.groupBy)) {
    out.groupBy = (plan.groupBy as string[]).map(fix)
  }
  if (Array.isArray(plan.aggregations)) {
    out.aggregations = (plan.aggregations as Array<Record<string, unknown>>).map((a) => ({
      ...a,
      column: typeof a.column === 'string' && a.column !== '*' ? fix(a.column) : a.column,
    }))
  }
  if (Array.isArray(plan.orderBy)) {
    // Don't rewrite orderBy aliases — aggregation aliases are legit references
    // to in-memory columns. Only rewrite if it matches a real column alias.
    out.orderBy = (plan.orderBy as Array<Record<string, unknown>>).map((o) => ({
      ...o,
      column: typeof o.column === 'string' ? fix(o.column) : o.column,
    }))
  }
  return out
}

// ─── Plan execution ────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Translate slug-style brand filters (when planner emits them) into UUIDs.
 * Also resolves any "brand_slugs" array hint passed in the request body.
 */
async function resolveBrandSlugs(
  supabase: ReturnType<typeof getSupabase>,
  slugs: string[],
): Promise<string[]> {
  if (!slugs.length) return []
  const { data } = await supabase
    .from('brands')
    .select('id,slug')
    .in('slug', slugs)
  return (data || []).map((r: { id: string }) => r.id)
}

/**
 * Resolve human-readable names → UUIDs for any filter where the column ends
 * with `_id` and the value isn't already a UUID. This compensates for the
 * planner LLM emitting filters like { column: 'product_id', value: 'Pro V Kosmos' }
 * (which would otherwise crash PostgREST with "invalid input syntax for type uuid").
 *
 * Strategy:
 *   - brand_id  → brands.slug then brands.name (case-insensitive)
 *   - product_id → products_catalog.display_name then any element of
 *                  products_catalog.aliases[] (case-insensitive)
 *   - athlete_id / influencer_id → influencers.name (case-insensitive)
 *
 * On no match: replace the filter with a `text_snippet ilike '%name%'`
 * filter when the table supports it (mention_facts only); otherwise drop
 * the offending filter and surface a warning so the user knows we
 * gracefully degraded.
 */
async function resolveNameToUuidFilters(
  plan: QueryPlan,
  supabase: ReturnType<typeof getSupabase>,
): Promise<{ plan: QueryPlan; warnings: string[] }> {
  if (!plan.filters?.length) return { plan, warnings: [] }
  const warnings: string[] = []
  const newFilters: FilterClause[] = []

  for (const f of plan.filters) {
    const col = String(f.column)
    const isIdCol = col === 'brand_id' || col === 'product_id' || col === 'athlete_id' || col === 'influencer_id'

    if (!isIdCol) {
      newFilters.push(f)
      continue
    }

    // For `in` arrays, resolve each entry; for single ops, resolve the scalar.
    const rawValues: unknown[] = Array.isArray(f.value) ? f.value : [f.value]
    const resolvedIds: string[] = []
    const unresolvedNames: string[] = []

    for (const raw of rawValues) {
      // Already a UUID? keep as-is.
      if (typeof raw === 'string' && UUID_REGEX.test(raw)) {
        resolvedIds.push(raw)
        continue
      }
      // Boolean / null values on id columns are nonsense — drop and warn.
      if (typeof raw !== 'string' || !raw.trim()) {
        unresolvedNames.push(String(raw))
        continue
      }

      const name = raw.trim()
      let id: string | null = null

      try {
        if (col === 'brand_id') {
          // Try slug first (cheap), then case-insensitive name match.
          const slug = name.toLowerCase().replace(/\s+/g, '-')
          const slugLookup = await supabase
            .from('brands')
            .select('id')
            .eq('slug', slug)
            .limit(1)
          if (slugLookup.data && slugLookup.data.length > 0) {
            id = (slugLookup.data[0] as { id: string }).id
          } else {
            const nameLookup = await supabase
              .from('brands')
              .select('id')
              .ilike('name', name)
              .limit(1)
            if (nameLookup.data && nameLookup.data.length > 0) {
              id = (nameLookup.data[0] as { id: string }).id
            }
          }
        } else if (col === 'product_id') {
          // Match against display_name (ilike) then aliases[] (cs contains).
          const nameLookup = await supabase
            .from('products_catalog')
            .select('id,display_name')
            .ilike('display_name', name)
            .limit(1)
          if (nameLookup.data && nameLookup.data.length > 0) {
            id = (nameLookup.data[0] as { id: string }).id
          } else {
            // aliases is text[] — use cs (contains) operator with lowercase
            // form. Also try title-case in case the array entries are mixed.
            const candidates = Array.from(new Set([
              name,
              name.toLowerCase(),
              name.toUpperCase(),
              titleCase(name),
            ]))
            for (const candidate of candidates) {
              const aliasLookup = await supabase
                .from('products_catalog')
                .select('id')
                .contains('aliases', [candidate])
                .limit(1)
              if (aliasLookup.data && aliasLookup.data.length > 0) {
                id = (aliasLookup.data[0] as { id: string }).id
                break
              }
            }
          }
        } else if (col === 'athlete_id' || col === 'influencer_id') {
          const nameLookup = await supabase
            .from('influencers')
            .select('id,name')
            .ilike('name', name)
            .limit(1)
          if (nameLookup.data && nameLookup.data.length > 0) {
            id = (nameLookup.data[0] as { id: string }).id
          }
        }
      } catch {
        // Network / RLS error — treat as unresolved and continue.
      }

      if (id) {
        resolvedIds.push(id)
      } else {
        unresolvedNames.push(name)
      }
    }

    if (resolvedIds.length > 0) {
      // If multiple were requested and at least one resolved, use IN.
      if (resolvedIds.length === 1 && f.operator === 'eq') {
        newFilters.push({ column: col, operator: 'eq', value: resolvedIds[0] })
      } else {
        newFilters.push({ column: col, operator: 'in', value: resolvedIds })
      }
      if (unresolvedNames.length > 0) {
        warnings.push(
          `Could not resolve ${unresolvedNames.length} name(s) on ${col}: ${unresolvedNames.join(', ')} (using ${resolvedIds.length} match(es) instead).`,
        )
      }
    } else {
      // Total miss. If the table supports text_snippet, degrade to that.
      const spec = WHITELISTED_TABLES[plan.table]
      const hasSnippet = spec?.columns.some((c) => c.name === 'text_snippet')
      const fallbackName = unresolvedNames[0] || ''
      if (hasSnippet && fallbackName) {
        newFilters.push({
          column: 'text_snippet',
          operator: 'ilike',
          value: `%${fallbackName}%`,
        })
        warnings.push(
          `Could not resolve "${fallbackName}" to a known ${col.replace('_id', '')} — fell back to text search across snippets.`,
        )
      } else {
        warnings.push(
          `Dropped filter on ${col}: could not resolve "${unresolvedNames.join(', ')}" to a known UUID and this table has no text-snippet fallback. Results may be unfiltered.`,
        )
      }
    }
  }

  return { plan: { ...plan, filters: newFilters }, warnings }
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ')
}

/**
 * Apply UI brand filter (slugs) to the plan: convert them to brand_id IN
 * filter and merge with any existing brand_id filter the planner emitted.
 */
async function injectBrandFilter(
  plan: QueryPlan,
  brandSlugs: string[],
  supabase: ReturnType<typeof getSupabase>,
): Promise<QueryPlan> {
  if (!brandSlugs.length) return plan
  const spec = WHITELISTED_TABLES[plan.table]
  if (!spec) return plan
  const hasBrandIdCol = spec.columns.some((c) => c.name === 'brand_id')
  if (!hasBrandIdCol) return plan

  const ids = await resolveBrandSlugs(supabase, brandSlugs)
  if (!ids.length) return plan

  const filters: FilterClause[] = (plan.filters || []).filter(
    (f) => f.column !== 'brand_id',
  )
  filters.push({ column: 'brand_id', operator: 'in', value: ids })
  return { ...plan, filters }
}

/**
 * Build a PostgREST select string. We always pull brand slug via the embedded
 * brands resource so the answerer can color-code by brand without doing a
 * second round-trip.
 */
function buildSelectString(plan: QueryPlan): string {
  const spec = WHITELISTED_TABLES[plan.table]
  const cols = plan.select === '*' ? ['*'] : Array.from(new Set(plan.select))
  const out = cols.join(',')
  const hasBrand = spec?.columns.some((c) => c.name === 'brand_id')
  if (hasBrand && plan.table !== 'brands') {
    return out + ',brands:brand_id(slug,name)'
  }
  return out
}

async function executePlan(
  plan: QueryPlan,
  supabase: ReturnType<typeof getSupabase>,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const spec = WHITELISTED_TABLES[plan.table]
  const realCols = new Set(spec?.columns.map((c) => c.name) ?? [])
  const aggAliases = new Set((plan.aggregations || []).map((a) => a.alias || `${a.fn}_${a.column}`))

  let q = supabase.from(plan.table).select(buildSelectString(plan))

  for (const f of plan.filters || []) {
    switch (f.operator) {
      case 'eq': q = q.eq(f.column, f.value as never); break
      case 'neq': q = q.neq(f.column, f.value as never); break
      case 'gt': q = q.gt(f.column, f.value as never); break
      case 'gte': q = q.gte(f.column, f.value as never); break
      case 'lt': q = q.lt(f.column, f.value as never); break
      case 'lte': q = q.lte(f.column, f.value as never); break
      case 'ilike': q = q.ilike(f.column, String(f.value)); break
      case 'in': q = q.in(f.column, (Array.isArray(f.value) ? f.value : [f.value]) as never[]); break
      case 'is': q = q.is(f.column, f.value as never); break
      case 'not.is': q = q.not(f.column, 'is', f.value as never); break
    }
  }

  // Only pass orderBy clauses to PostgREST when they reference REAL columns.
  // Aggregation-alias orderBy must be deferred to after the in-memory groupBy.
  const deferredOrderBy: typeof plan.orderBy = []
  for (const o of plan.orderBy || []) {
    if (realCols.has(o.column)) {
      q = q.order(o.column, { ascending: o.direction === 'asc' })
    } else if (aggAliases.has(o.column)) {
      deferredOrderBy.push(o)
    }
    // else: silently drop (validator should have caught, but be defensive)
  }

  // When aggregating in-memory we need to over-fetch so the post-groupBy
  // sort + limit produces correct results. Cap server-side at 1000.
  // Note: aggregations without groupBy are valid (e.g. count(*) over all rows
  // — treated as a single-bucket aggregation).
  const willAggregate = !!(plan.aggregations?.length)
  const userCap = Math.min(plan.limit ?? 200, 1000)
  const serverCap = willAggregate ? 1000 : userCap
  q = q.limit(serverCap)

  const { data, error } = await q
  if (error) throw new Error(`Supabase query failed: ${error.message}`)

  let rows: Record<string, unknown>[] = (data || []) as unknown as Record<string, unknown>[]

  if (willAggregate) {
    rows = applyGroupBy(rows, plan.groupBy || [], plan.aggregations!)
    // Apply deferred orderBy (now that aggregation aliases exist as keys).
    for (const o of deferredOrderBy) {
      rows.sort((a, b) => {
        const av = Number(a[o.column] ?? 0)
        const bv = Number(b[o.column] ?? 0)
        return o.direction === 'asc' ? av - bv : bv - av
      })
    }
    if (rows.length > userCap) rows = rows.slice(0, userCap)
  }

  const truncated = rows.length >= 200
  if (rows.length > 200) rows = rows.slice(0, 200)

  return { rows, truncated }
}

function applyGroupBy(
  rows: Record<string, unknown>[],
  groupBy: string[],
  aggs: { column: string; fn: 'sum' | 'avg' | 'min' | 'max' | 'count'; alias?: string }[],
): Record<string, unknown>[] {
  const buckets = new Map<string, Record<string, unknown>[]>()
  for (const r of rows) {
    const key = groupBy.map((g) => String(r[g] ?? '∅')).join('||')
    const arr = buckets.get(key) || []
    arr.push(r)
    buckets.set(key, arr)
  }
  const out: Record<string, unknown>[] = []
  buckets.forEach((group) => {
    const head = group[0]
    const row: Record<string, unknown> = {}
    for (const g of groupBy) row[g] = head[g]
    for (const a of aggs) {
      const alias = a.alias || `${a.fn}_${a.column}`
      const vals = group.map((r: Record<string, unknown>) => Number(r[a.column])).filter((n: number) => isFinite(n))
      switch (a.fn) {
        case 'sum': row[alias] = vals.reduce((s: number, v: number) => s + v, 0); break
        case 'avg': row[alias] = vals.length ? vals.reduce((s: number, v: number) => s + v, 0) / vals.length : 0; break
        case 'min': row[alias] = vals.length ? Math.min(...vals) : null; break
        case 'max': row[alias] = vals.length ? Math.max(...vals) : null; break
        case 'count': row[alias] = group.length; break
      }
    }
    out.push(row)
  })
  return out
}

// ─── POST handler ──────────────────────────────────────────────────────

type PlannerOutput = {
  intent?: string
  dataSources?: string[]
  plan?: unknown
  visualPlan?: string
  confidence?: number
  clarification?: string
}

type AnswererOutput = {
  answer?: string
  headline?: string
  visuals?: Visual[]
  followups?: FollowUp[]
  dataSources?: string[]
  warnings?: string[]
  confidence?: number
  methodology?: string
}

function buildClarificationResponse(
  msg: string,
  planner: PlannerOutput,
  elapsedMs: number,
): AskIntelResponse {
  return {
    answer: msg,
    headline: 'Need more info',
    visuals: [],
    followups: [],
    dataSources: [],
    warnings: [],
    clarification: msg,
    confidence: planner.confidence ?? 0.5,
    queryInfo: {
      plan: null,
      rawSql: null,
      rowsReturned: 0,
      elapsedMs,
      tablesUsed: [],
    },
  }
}

function buildErrorResponse(reason: string, elapsedMs: number): AskIntelResponse {
  return {
    answer: `I could not answer this question: ${reason}`,
    visuals: [],
    followups: [],
    dataSources: [],
    warnings: [reason],
    confidence: 0,
    queryInfo: {
      plan: null,
      rawSql: null,
      rowsReturned: 0,
      elapsedMs,
      tablesUsed: [],
    },
  }
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  let body: AskIntelRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const message = (body.message || '').trim()
  if (!message) {
    return NextResponse.json({ error: 'message is required.' }, { status: 400 })
  }

  let openai: OpenAI
  let supabase: ReturnType<typeof getSupabase>
  try {
    openai = getOpenAI()
    supabase = getSupabase()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Service not configured.'
    return NextResponse.json(buildErrorResponse(msg, Date.now() - startedAt), { status: 500 })
  }

  const historyMessages = (body.history || []).slice(-6).map((h) => ({
    role: h.role === 'system' ? 'user' : (h.role as 'user' | 'assistant'),
    content: h.content,
  }))

  // ── Step 1: Planner ──────────────────────────────────────────────────
  let planner: PlannerOutput
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.1,
      messages: [
        { role: 'system', content: PLANNER_SYSTEM },
        ...historyMessages,
        { role: 'user', content: message },
      ],
    })
    const raw = completion.choices[0]?.message?.content || '{}'
    planner = JSON.parse(raw) as PlannerOutput
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'planner failed'
    return NextResponse.json(
      buildErrorResponse(`Planner error: ${msg}`, Date.now() - startedAt),
      { status: 500 },
    )
  }

  // Clarification short-circuit
  if (planner.clarification && !planner.plan) {
    const clar = buildClarificationResponse(planner.clarification, planner, Date.now() - startedAt)
    const mid = await logQaTurn(supabase, {
      sessionId: body.conversationId,
      question: message,
      response: clar,
      latencyMs: Date.now() - startedAt,
    })
    if (mid) clar.messageId = mid
    return NextResponse.json(clar)
  }

  // ── Auto-correct common LLM column-name hallucinations ─────────────
  // OpenAI frequently confuses friendly aliases with real DB column names
  // (e.g. it generates `total_mentions` from training data prior knowledge
  // even though our schema explicitly says `mentions_total`). Rewriting
  // before validation keeps the planner working for these common slips.
  const correctedPlan = autoCorrectAliases(planner.plan)

  // ── Validate plan ────────────────────────────────────────────────────
  const validation = validateQueryPlan(correctedPlan)
  if (!validation.ok) {
    // If the planner emitted no usable plan (and no clarification of its own),
    // auto-promote to a friendly clarification instead of a hard error. This
    // catches "Plan.table is required" / "Plan must be an object" when the
    // user's question is too vague or out-of-scope for the schema.
    const reason = validation.reason || ''
    const isMissingPlan = /Plan\.table is required|Plan must be an object/i.test(reason)
    if (isMissingPlan) {
      const clarification = planner.clarification
        || "I couldn't map that to a specific data table. Try asking about a specific brand, product, channel, or metric (e.g. 'JOOLA Instagram engagement last 30 days' or 'top paddles by attention score')."
      const clrResp = buildClarificationResponse(clarification, planner, Date.now() - startedAt)
      await logQaTurn(supabase, {
        sessionId: body.conversationId,
        question: message,
        response: clrResp,
        latencyMs: Date.now() - startedAt,
      })
      return NextResponse.json(clrResp)
    }
    const errResp = buildErrorResponse(`Unsafe plan: ${validation.reason}`, Date.now() - startedAt)
    await logQaTurn(supabase, {
      sessionId: body.conversationId,
      question: message,
      response: errResp,
      latencyMs: Date.now() - startedAt,
      errorMessage: `Unsafe plan: ${validation.reason}`,
    })
    return NextResponse.json(errResp)
  }

  let plan = validation.plan
  const resolverWarnings: string[] = []

  // ── Resolve human names → UUIDs for _id columns ─────────────────────
  // The planner sometimes emits filters like { product_id: 'Pro V Kosmos' }.
  // Without this step PostgREST returns 22P02 "invalid input syntax for type uuid".
  try {
    const resolved = await resolveNameToUuidFilters(plan, supabase)
    plan = resolved.plan
    resolverWarnings.push(...resolved.warnings)
  } catch {
    // non-fatal — fall through with original plan
  }

  // ── Inject UI brand-filter (slugs → brand_id) ────────────────────────
  if (body.brandSlugs?.length) {
    try {
      plan = await injectBrandFilter(plan, body.brandSlugs, supabase)
    } catch {
      // non-fatal
    }
  }

  // ── Step 2: Execute ──────────────────────────────────────────────────
  let rows: Record<string, unknown>[] = []
  let truncated = false
  try {
    const result = await executePlan(plan, supabase)
    rows = result.rows
    truncated = result.truncated
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'query failed'
    const errResp = buildErrorResponse(`Query error: ${msg}`, Date.now() - startedAt)
    await logQaTurn(supabase, {
      sessionId: body.conversationId,
      question: message,
      response: errResp,
      latencyMs: Date.now() - startedAt,
      errorMessage: msg,
    })
    return NextResponse.json(errResp)
  }

  // ── Step 3: Answerer ─────────────────────────────────────────────────
  const trimmedRows = rows.slice(0, 200)
  const answererUserMsg = JSON.stringify({
    question: message,
    intent: planner.intent,
    visualHint: planner.visualPlan,
    table: plan.table,
    rowCount: rows.length,
    truncated,
    rows: trimmedRows,
    metricGlossary: Object.fromEntries(
      Object.values(METRICS).map((m) => [m.name, m.description]),
    ),
  })

  let answerer: AnswererOutput
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        { role: 'system', content: ANSWERER_SYSTEM },
        { role: 'user', content: answererUserMsg },
      ],
    })
    const raw = completion.choices[0]?.message?.content || '{}'
    answerer = JSON.parse(raw) as AnswererOutput
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'answerer failed'
    return NextResponse.json(
      buildErrorResponse(`Answerer error: ${msg}`, Date.now() - startedAt),
    )
  }

  const queryInfo: QueryInfo = {
    plan,
    rawSql: null,
    rowsReturned: rows.length,
    truncatedTo: truncated ? 200 : undefined,
    elapsedMs: Date.now() - startedAt,
    tablesUsed: [plan.table],
  }

  const warnings: string[] = Array.isArray(answerer.warnings) ? answerer.warnings : []
  warnings.push(...resolverWarnings)
  if (truncated) warnings.push('Result set was truncated to 200 rows before analysis.')
  if (rows.length === 0) warnings.push('No rows matched this question.')

  const response: AskIntelResponse = {
    answer: answerer.answer || 'No answer returned.',
    headline: answerer.headline,
    visuals: Array.isArray(answerer.visuals) ? answerer.visuals.slice(0, 3) : [],
    followups: Array.isArray(answerer.followups) ? answerer.followups.slice(0, 5) : [],
    dataSources: Array.isArray(answerer.dataSources) && answerer.dataSources.length
      ? answerer.dataSources
      : [plan.table],
    warnings,
    confidence: typeof answerer.confidence === 'number' ? answerer.confidence : (planner.confidence ?? 0.6),
    methodology: answerer.methodology,
    queryInfo,
  }

  // ── Log Q&A turn (best-effort, fail silently) ───────────────────────
  const messageId = await logQaTurn(supabase, {
    sessionId: body.conversationId,
    question: message,
    response,
    latencyMs: Date.now() - startedAt,
  })
  if (messageId) response.messageId = messageId

  return NextResponse.json(response)
}

// ─── QA logging (writes to ask_intel_qa_log; needs migration 017) ────

async function logQaTurn(
  supabase: ReturnType<typeof getSupabase>,
  args: {
    sessionId?: string
    question: string
    response: AskIntelResponse
    latencyMs: number
    errorMessage?: string
  },
): Promise<string | null> {
  try {
    const row = {
      session_id: args.sessionId ?? null,
      question: args.question,
      answer_summary: (args.response.answer || '').slice(0, 1000),
      visuals_count: Array.isArray(args.response.visuals) ? args.response.visuals.length : 0,
      data_sources: Array.isArray(args.response.dataSources) ? args.response.dataSources : [],
      latency_ms: args.latencyMs,
      confidence: typeof args.response.confidence === 'number' ? args.response.confidence : null,
      warnings: Array.isArray(args.response.warnings) ? args.response.warnings : [],
      error_message: args.errorMessage ?? null,
    }
    const { data, error } = await supabase
      .from('ask_intel_qa_log')
      .insert(row)
      .select('id')
      .limit(1)
    if (error) {
      // Migration 017 may not be applied yet — silent failure.
      console.warn('[ask-intel] QA log insert failed:', error.message)
      return null
    }
    if (data && data.length > 0) {
      return (data[0] as { id: string }).id
    }
    return null
  } catch {
    return null
  }
}
