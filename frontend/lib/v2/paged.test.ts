import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchPaged, fetchPagedResult, safeQueryAll, PGREST_MAX_ROWS } from './paged'

type Row = { i: number }

interface SourceOpts {
  errorAt?: number
  throwAt?: number
  /** Per-page resolve delay in ms (default 0). */
  delayFor?: (page: number) => number
}

/**
 * Fake Supabase factory. Each `.range()` resolves on a later macrotask so that
 * concurrently issued requests genuinely overlap, letting us measure in-flight.
 */
function makeSource(total: number, opts: SourceOpts = {}) {
  const calls: Array<{ from: number; to: number }> = []
  let inFlight = 0
  let maxInFlight = 0

  const build = () => ({
    range: (from: number, to: number) => {
      calls.push({ from, to })
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      const page = Math.floor(from / PGREST_MAX_ROWS)
      return new Promise<{ data: Row[] | null; error: any }>((resolve, reject) => {
        setTimeout(() => {
          inFlight--
          if (page === opts.throwAt) return reject(new Error('boom'))
          if (page === opts.errorAt) return resolve({ data: null, error: { message: 'x' } })
          const rows: Row[] = []
          for (let i = from; i <= Math.min(to, total - 1); i++) rows.push({ i })
          resolve({ data: rows, error: null })
        }, opts.delayFor ? opts.delayFor(page) : 0)
      })
    },
  })

  return {
    build,
    calls,
    get maxInFlight() {
      return maxInFlight
    },
  }
}

function expectSequential(rows: Row[], n: number) {
  expect(rows).toHaveLength(n)
  for (let k = 0; k < n; k++) {
    if (rows[k].i !== k) throw new Error(`row ${k} has i=${rows[k].i}`)
  }
}

describe('fetchPagedResult', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns [] ok with a single call when the source is empty', async () => {
    const src = makeSource(0)
    const res = await fetchPagedResult<Row>(src.build)
    expect(res).toEqual({ data: [], ok: true, truncated: false })
    expect(src.calls).toHaveLength(1)
  })

  it('makes one call for a result shorter than a page', async () => {
    const src = makeSource(999)
    const res = await fetchPagedResult<Row>(src.build)
    expectSequential(res.data, 999)
    expect(res.ok).toBe(true)
    expect(src.calls).toHaveLength(1)
  })

  it('returns exactly one full page when total equals the page size', async () => {
    const src = makeSource(1000)
    const res = await fetchPagedResult<Row>(src.build)
    expectSequential(res.data, 1000)
    expect(res.ok).toBe(true)
    expect(res.truncated).toBe(false)
    // Page 0 is full, so one speculative batch of 6 follows; all come back
    // empty. Probing is unavoidable: a full page cannot prove exhaustion.
    expect(src.calls).toHaveLength(1 + 6)
  })

  it('fetches many pages in order, in parallel, capped at 6 in flight', async () => {
    const src = makeSource(7500)
    const res = await fetchPagedResult<Row>(src.build)
    expectSequential(res.data, 7500)
    expect(res.ok).toBe(true)
    expect(res.truncated).toBe(false)
    expect(src.maxInFlight).toBe(6)
  })

  it('keeps rows in index order when later pages resolve first', async () => {
    // Earlier pages are slower: page 1 resolves last within its batch.
    const src = makeSource(6500, { delayFor: (p) => (10 - p) * 3 })
    const res = await fetchPagedResult<Row>(src.build)
    expectSequential(res.data, 6500)
    expect(res.ok).toBe(true)
  })

  it('stops at maxRows, flags truncation, never requests past the ceiling', async () => {
    const src = makeSource(10_000)
    const res = await fetchPagedResult<Row>(src.build, { maxRows: 2500 })
    expectSequential(res.data, 2500)
    expect(res.truncated).toBe(true)
    expect(res.ok).toBe(true)
    for (const c of src.calls) expect(c.to).toBeLessThan(2500)
    expect(src.calls).toHaveLength(3)
  })

  it('reports truncated when the source holds exactly maxRows rows (unknowable)', async () => {
    const src = makeSource(2000)
    const res = await fetchPagedResult<Row>(src.build, { maxRows: 2000 })
    expectSequential(res.data, 2000)
    expect(res.truncated).toBe(true)
  })

  it('treats maxRows <= 0 as an empty read: no calls, no warning, not truncated', async () => {
    for (const maxRows of [0, -5]) {
      const src = makeSource(5000)
      const res = await fetchPagedResult<Row>(src.build, { maxRows })
      expect(res).toEqual({ data: [], ok: true, truncated: false })
      expect(src.calls).toHaveLength(0)
    }
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('stops at an errored page and drops later pages even if they resolved', async () => {
    const src = makeSource(9000, { errorAt: 3 })
    const res = await fetchPagedResult<Row>(src.build)
    expectSequential(res.data, 3000)
    expect(res.ok).toBe(false)
    expect(res.data.some((r) => r.i >= 3000)).toBe(false)
    // Pages 4-6 were requested in the same batch, then discarded.
    expect(src.calls.length).toBeGreaterThan(4)
  })

  it('treats a thrown page like an error and never throws', async () => {
    const src = makeSource(9000, { throwAt: 2 })
    const res = await fetchPagedResult<Row>(src.build)
    expectSequential(res.data, 2000)
    expect(res.ok).toBe(false)
  })

  it('fetchPaged returns just the rows', async () => {
    const src = makeSource(2500)
    const rows = await fetchPaged<Row>(src.build)
    expectSequential(rows, 2500)
  })

  it('safeQueryAll returns { data, count: null, ok }', async () => {
    const src = makeSource(1500)
    const res = await safeQueryAll<Row>(src.build)
    expect(res.count).toBeNull()
    expect(res.ok).toBe(true)
    expectSequential(res.data, 1500)
    expect(Object.keys(res).sort()).toEqual(['count', 'data', 'ok'])
  })
})
