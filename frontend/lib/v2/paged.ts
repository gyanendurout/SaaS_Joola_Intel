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
 *
 * Pages after the first are fetched in parallel batches (see CONCURRENCY), so
 * a 40k-row read is ~8 round trips instead of 40. There is deliberately no
 * count query: an `estimated` count can be wrong under filters and would
 * silently truncate. The factory's query should carry an `.order()` on a
 * stable key, or rows can shift between pages.
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
  /**
   * True if the read stopped because it reached `maxRows`, so more rows MAY
   * exist. A source holding exactly `maxRows` rows also reports true: telling
   * "exactly at the ceiling" from "over it" would cost one more request, and
   * a false "complete" is worse than a cautious "may be incomplete".
   * A `maxRows` of 0 or less asks for nothing, so it is never truncated.
   */
  truncated: boolean
}

export interface PagedOptions {
  /** Hard ceiling on rows pulled. Default 50,000. */
  maxRows?: number
  /** Shown in console warnings so a truncation is traceable to a call site. */
  label?: string
}

/** Pages requested at once after page 0 comes back full. */
const CONCURRENCY = 6

type PageOutcome<T> =
  | { kind: 'rows'; rows: T[]; full: boolean }
  | { kind: 'failed' }

/** Fetch one page. Never throws; failures are logged and reported as 'failed'. */
async function fetchPage<T>(
  build: () => Pageable<T>,
  from: number,
  to: number,
  label: string,
): Promise<PageOutcome<T>> {
  try {
    const { data, error } = await build().range(from, to)
    if (error) {
      // eslint-disable-next-line no-console
      console.warn(`[paged] ${label} failed at rows ${from}-${to}:`, error)
      return { kind: 'failed' }
    }
    const rows = data ?? []
    return { kind: 'rows', rows, full: rows.length === to - from + 1 }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[paged] ${label} threw at rows ${from}-${to}:`, err)
    return { kind: 'failed' }
  }
}

/**
 * Page through a Supabase query until exhausted, erroring, or hitting maxRows.
 *
 * Page 0 is fetched alone, so a small result costs one round trip. If it comes
 * back full, the following pages are requested speculatively in batches of
 * CONCURRENCY and then consumed strictly in index order: the first page that
 * fails or comes back short ends the read, and any later pages in that batch
 * are discarded (after a failure they would leave a gap; after a short page
 * they are empty). Rows are therefore identical to a serial read.
 *
 * Never throws — a failed page ends the read and is reported via `ok`, matching
 * the existing `safeQuery`/`safeSelect` convention in this codebase, where a
 * broken panel degrades rather than taking down the whole page.
 */
export async function fetchPagedResult<T>(
  build: () => Pageable<T>,
  options: PagedOptions = {},
): Promise<PagedResult<T>> {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS
  const label = options.label ?? 'query'
  if (!(maxRows > 0)) return { data: [], ok: true, truncated: false }
  const out: T[] = []
  let ok = true
  let next = 0
  let batchSize = 1 // page 0 alone, then CONCURRENCY at a time

  outer: while (next < maxRows) {
    const ranges: Array<[number, number]> = []
    for (let k = 0; k < batchSize && next < maxRows; k++) {
      ranges.push([next, Math.min(next + PGREST_MAX_ROWS, maxRows) - 1])
      next += PGREST_MAX_ROWS
    }
    const outcomes = await Promise.all(
      ranges.map(([from, to]) => fetchPage(build, from, to, label)),
    )

    for (const outcome of outcomes) {
      if (outcome.kind === 'failed') {
        ok = false
        break outer
      }
      // Push one at a time: `out.push(...rows)` spreads 1,000 args onto the
      // call stack, which degrades badly if the page size is ever raised.
      for (const row of outcome.rows) out.push(row)
      // A short page means the source is exhausted.
      if (!outcome.full) break outer
    }
    batchSize = CONCURRENCY
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
