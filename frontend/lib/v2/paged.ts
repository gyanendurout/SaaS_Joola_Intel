/**
 * Paged Supabase reads.
 *
 * PostgREST caps every response at 1,000 rows regardless of what `.limit()`
 * says. A `.limit(20000)` does not fetch 20,000 rows — it fetches 1,000 and
 * tells you nothing about the other 19,000. There is no error, no warning, and
 * the array looks perfectly healthy.
 *
 * That bug was live across 11 call sites on 2026-08-24. Measured against the
 * production database, the worst of them:
 *
 *   Influencer Intel   mention_facts     1,000 of 46,268 rows   (2%)
 *   Community Intel    ig_comments       1,000 of  8,703 rows
 *   Sales Intel        product_snapshots 1,000 of 38,058 rows
 *   Market Intel       mention_facts     1,000 of  2,832 rows
 *
 * Worse than the missing volume was *which* rows survived. A query with no
 * `.order()` returns rows in physical order, which is roughly insertion order —
 * so the surviving slice was the OLDEST 1,000 rows. Pages were rendering data
 * that stopped at 2026-08-17 while the database held rows through 2026-08-24,
 * and no amount of re-scraping would ever change what was displayed.
 *
 * Use `fetchPaged` for any read whose result set can exceed 1,000 rows.
 *
 *   const rows = await fetchPaged<Row>(() =>
 *     supabase.from('mention_facts')
 *       .select('brand_id,product_id,posted_at')
 *       .gte('posted_at', since)
 *       .order('posted_at', { ascending: false }))
 *
 * Note the argument is a FACTORY, not a builder. Each page needs a fresh
 * builder because `.range()` mutates the one it is called on.
 */
import type { PostgrestError } from '@supabase/supabase-js'

/** PostgREST's hard per-response ceiling. Not configurable from the client. */
export const PGREST_MAX_ROWS = 1000

/**
 * Default ceiling on total rows pulled into the browser. 50k rows of a narrow
 * select is roughly 10-15 MB of JSON — already generous for a dashboard page.
 * Callers that genuinely need more should say so explicitly and think about
 * whether the aggregation belongs server-side instead.
 */
const DEFAULT_MAX_ROWS = 50_000

type Pageable<T> = {
  range: (from: number, to: number) => PromiseLike<{
    data: T[] | null
    error: PostgrestError | null
  }>
}

export interface PagedResult<T> {
  data: T[]
  /** False if any page errored. Partial data may still be present. */
  ok: boolean
  /** True if `maxRows` stopped us before the source was exhausted. */
  truncated: boolean
}

export interface PagedOptions {
  /** Hard ceiling on rows pulled. Default 50,000. */
  maxRows?: number
  /** Shown in console warnings so a truncation is traceable to a call site. */
  label?: string
}

/**
 * Page through a Supabase query until exhausted, erroring, or hitting maxRows.
 *
 * Never throws — a failed page ends the loop and is reported via `ok`, matching
 * the existing `safeQuery`/`safeSelect` convention in this codebase, where a
 * broken panel degrades rather than taking down the whole page.
 */
export async function fetchPagedResult<T>(
  build: () => Pageable<T>,
  options: PagedOptions = {},
): Promise<PagedResult<T>> {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS
  const label = options.label ?? 'query'
  const out: T[] = []
  let ok = true

  for (let from = 0; from < maxRows; from += PGREST_MAX_ROWS) {
    const to = Math.min(from + PGREST_MAX_ROWS, maxRows) - 1

    let data: T[] | null = null
    let error: PostgrestError | null = null
    try {
      ;({ data, error } = await build().range(from, to))
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[paged] ${label} threw at rows ${from}-${to}:`, err)
      ok = false
      break
    }

    if (error) {
      // eslint-disable-next-line no-console
      console.warn(`[paged] ${label} failed at rows ${from}-${to}:`, error)
      ok = false
      break
    }
    if (!data || data.length === 0) break

    // Push in chunks: `out.push(...data)` spreads 1,000 args onto the call
    // stack, which is fine at this size but degrades badly if the page size
    // is ever raised.
    for (const row of data) out.push(row)

    // A short page means the source is exhausted; stop rather than spend a
    // round trip proving it.
    if (data.length < to - from + 1) break
  }

  const truncated = out.length >= maxRows
  if (truncated) {
    // eslint-disable-next-line no-console
    console.warn(
      `[paged] ${label} hit the ${maxRows}-row ceiling — results are incomplete. ` +
        `Raise maxRows or aggregate server-side.`,
    )
  }

  return { data: out, ok, truncated }
}

/** `fetchPagedResult` when only the rows matter. */
export async function fetchPaged<T>(
  build: () => Pageable<T>,
  options: PagedOptions = {},
): Promise<T[]> {
  return (await fetchPagedResult<T>(build, options)).data
}

/**
 * Drop-in replacement for the local `safeQuery` helpers, which return
 * `{ data, count, ok }`. `count` is always null: a paged read already knows its
 * own length, and asking PostgREST for an exact count costs an extra scan.
 */
export async function safeQueryAll<T>(
  build: () => Pageable<T>,
  options: PagedOptions = {},
): Promise<{ data: T[]; count: number | null; ok: boolean }> {
  const { data, ok } = await fetchPagedResult<T>(build, options)
  return { data, count: null, ok }
}
