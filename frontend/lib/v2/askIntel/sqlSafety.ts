/**
 * Ask Intel — Safety Layer
 *
 * Two responsibilities:
 *
 *   1. `validateSQL(sql)` — defensive guard rejecting any raw SQL that is
 *      not a single SELECT against whitelisted tables. v1 of Ask Intel
 *      does NOT execute arbitrary SQL (see ARCHITECTURE NOTE below) but
 *      this helper exists for the future v2 path and for any debugging
 *      surface that surfaces the planner's draft SQL to the user.
 *
 *   2. `validateQueryPlan(plan)` — the primary path. Validates the
 *      structured `QueryPlan` shape that the planner LLM emits and that
 *      the API route then translates to typed Supabase PostgREST calls.
 *      Returns either { ok: true, plan } or { ok: false, reason }.
 *
 * ARCHITECTURE NOTE — Structured plan vs raw SQL
 * ----------------------------------------------
 * The endpoint chose `QueryPlan` (a typed plan object) over an arbitrary
 * SQL string because:
 *   • Supabase's anon key only exposes PostgREST. There's no Postgres
 *     wire-level connection from a serverless Next.js route by default.
 *     A `exec_safe_sql` Postgres stored procedure could change that, but
 *     adds operational surface area for the POC.
 *   • Plan validation reduces to "is each table whitelisted? is each
 *     column in the whitelist? is each operator in the allowedFilters
 *     map for that column?" — three pure-data checks that the LLM
 *     cannot trick by emitting weird SQL.
 *   • The PostgREST call is then a typed builder chain
 *     (`supabase.from(...).select(...).eq(...).gte(...).limit(...)`)
 *     which inherits Supabase's parameter escaping for free.
 * v2 (future): wire `validateSQL` to a real Postgres stored procedure
 * with EXPLAIN-only execution + per-role grants for CTE-level queries.
 */

import {
  WHITELISTED_TABLES,
  type FilterOperator,
  type TableSpec,
} from './schema'

// ─── QueryPlan shape ─────────────────────────────────────────────────

export type FilterClause = {
  column: string
  operator: FilterOperator
  // string | number | boolean | null | array of those
  value: unknown
}

export type Aggregation =
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'count'

export type OrderClause = {
  column: string
  direction: 'asc' | 'desc'
}

export type QueryPlan = {
  /** Table from WHITELISTED_TABLES. */
  table: string
  /**
   * Columns to select. Pass `'*'` for all columns. Aggregations are
   * applied after the select by re-shaping rows in TypeScript — they
   * don't translate to GROUP BY at the PostgREST layer.
   */
  select: string[] | '*'
  filters?: FilterClause[]
  /** Aggregate result rows by these columns (in-memory). */
  groupBy?: string[]
  /** When set, each group becomes a single row with these aggregations. */
  aggregations?: { column: string; fn: Aggregation; alias?: string }[]
  orderBy?: OrderClause[]
  /** Defaults to 200 when omitted. Hard cap 1000. */
  limit?: number
  /** Optional 'JOIN' — set the FK columns we should expand (PostgREST !inner) */
  expand?: string[]
}

export type ValidatedPlan = {
  ok: true
  plan: QueryPlan
} | {
  ok: false
  reason: string
}

// ─── Pure-data plan validator ────────────────────────────────────────

export function validateQueryPlan(input: unknown): ValidatedPlan {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: 'Plan must be an object.' }
  }
  const plan = input as Partial<QueryPlan>

  if (!plan.table || typeof plan.table !== 'string') {
    return { ok: false, reason: 'Plan.table is required.' }
  }
  const spec = WHITELISTED_TABLES[plan.table]
  if (!spec) {
    return { ok: false, reason: `Table "${plan.table}" is not whitelisted.` }
  }
  if (spec.availability === 'unavailable') {
    return { ok: false, reason: `Table "${plan.table}" is not available in this environment.` }
  }

  // ── select
  if (plan.select !== '*' && !Array.isArray(plan.select)) {
    return { ok: false, reason: 'Plan.select must be "*" or string[].' }
  }
  if (Array.isArray(plan.select)) {
    for (const col of plan.select) {
      if (typeof col !== 'string') {
        return { ok: false, reason: 'Plan.select entries must be strings.' }
      }
      if (col === '*') continue
      if (!columnExists(spec, col)) {
        return { ok: false, reason: `Column "${col}" not in table "${plan.table}".` }
      }
    }
  }

  // ── filters
  if (plan.filters) {
    if (!Array.isArray(plan.filters)) {
      return { ok: false, reason: 'Plan.filters must be an array.' }
    }
    for (const f of plan.filters) {
      const colCheck = validateFilter(spec, f)
      if (!colCheck.ok) return colCheck
    }
  }

  // ── groupBy
  if (plan.groupBy) {
    if (!Array.isArray(plan.groupBy)) return { ok: false, reason: 'Plan.groupBy must be string[].' }
    for (const col of plan.groupBy) {
      if (typeof col !== 'string' || !columnExists(spec, col)) {
        return { ok: false, reason: `groupBy column "${col}" not in table.` }
      }
    }
  }

  // ── aggregations
  if (plan.aggregations) {
    if (!Array.isArray(plan.aggregations)) {
      return { ok: false, reason: 'Plan.aggregations must be array.' }
    }
    const allowed: Aggregation[] = ['sum', 'avg', 'min', 'max', 'count']
    for (const a of plan.aggregations) {
      if (!a || typeof a !== 'object') return { ok: false, reason: 'aggregations entries must be objects.' }
      if (typeof a.column !== 'string') return { ok: false, reason: 'aggregations.column must be string.' }
      if (a.column !== '*' && !columnExists(spec, a.column)) {
        return { ok: false, reason: `aggregations column "${a.column}" not in table.` }
      }
      if (!allowed.includes(a.fn)) {
        return { ok: false, reason: `aggregation fn "${a.fn}" not allowed.` }
      }
      if (a.alias && typeof a.alias !== 'string') {
        return { ok: false, reason: 'aggregations.alias must be string.' }
      }
    }
  }

  // ── orderBy
  if (plan.orderBy) {
    if (!Array.isArray(plan.orderBy)) return { ok: false, reason: 'Plan.orderBy must be array.' }
    for (const o of plan.orderBy) {
      if (typeof o.column !== 'string') return { ok: false, reason: 'orderBy.column must be string.' }
      if (!columnExists(spec, o.column)) {
        // Allow ordering by aggregation aliases.
        const isAggAlias = plan.aggregations?.some((a) => a.alias === o.column)
        if (!isAggAlias) {
          return { ok: false, reason: `orderBy column "${o.column}" not in table.` }
        }
      }
      if (o.direction !== 'asc' && o.direction !== 'desc') {
        return { ok: false, reason: 'orderBy.direction must be asc or desc.' }
      }
    }
  }

  // ── limit
  let limit = plan.limit ?? 200
  if (typeof limit !== 'number' || !isFinite(limit) || limit <= 0) {
    return { ok: false, reason: 'Plan.limit must be a positive number.' }
  }
  if (limit > 1000) limit = 1000

  // ── expand (FK pull-in via PostgREST embedded resource)
  if (plan.expand) {
    if (!Array.isArray(plan.expand)) return { ok: false, reason: 'Plan.expand must be string[].' }
    for (const fkCol of plan.expand) {
      if (typeof fkCol !== 'string') return { ok: false, reason: 'expand entries must be strings.' }
      if (!columnExists(spec, fkCol)) return { ok: false, reason: `expand column "${fkCol}" not in table.` }
      const colSpec = spec.columns.find((c) => c.name === fkCol)
      if (!colSpec?.fk) return { ok: false, reason: `expand column "${fkCol}" is not a foreign key.` }
      if (!WHITELISTED_TABLES[colSpec.fk]) {
        return { ok: false, reason: `expand target "${colSpec.fk}" not whitelisted.` }
      }
    }
  }

  return {
    ok: true,
    plan: {
      table: plan.table,
      select: plan.select,
      filters: plan.filters,
      groupBy: plan.groupBy,
      aggregations: plan.aggregations,
      orderBy: plan.orderBy,
      limit,
      expand: plan.expand,
    },
  }
}

function columnExists(spec: TableSpec, col: string): boolean {
  return spec.columns.some((c) => c.name === col)
}

function validateFilter(spec: TableSpec, f: unknown): ValidatedPlan {
  if (!f || typeof f !== 'object') return { ok: false, reason: 'filter entries must be objects.' }
  const fc = f as Partial<FilterClause>
  if (typeof fc.column !== 'string') return { ok: false, reason: 'filter.column must be string.' }
  if (!columnExists(spec, fc.column)) {
    return { ok: false, reason: `filter column "${fc.column}" not in table "${spec.name}".` }
  }
  const allowed = spec.allowedFilters[fc.column]
  if (!allowed || allowed.length === 0) {
    return { ok: false, reason: `filtering on "${fc.column}" is not allowed.` }
  }
  if (!fc.operator || !allowed.includes(fc.operator)) {
    return {
      ok: false,
      reason: `operator "${fc.operator}" not allowed for "${fc.column}" (allowed: ${allowed.join(', ')}).`,
    }
  }
  // Light value-shape sanity check.
  if (fc.operator === 'in' && !Array.isArray(fc.value)) {
    return { ok: false, reason: `operator "in" requires array value for "${fc.column}".` }
  }
  if ((fc.operator === 'is' || fc.operator === 'not.is') && fc.value !== null && fc.value !== true && fc.value !== false) {
    return { ok: false, reason: `operator "${fc.operator}" requires null|true|false.` }
  }
  return { ok: true, plan: { table: spec.name, select: '*' } }
}

// ─── Raw-SQL validator (for the future v2 path) ──────────────────────

export type SqlValidation = {
  safe: boolean
  reason?: string
  normalizedSQL?: string
}

const FORBIDDEN_KEYWORDS = [
  'insert',
  'update',
  'delete',
  'upsert',
  'merge',
  'drop',
  'alter',
  'create',
  'truncate',
  'grant',
  'revoke',
  'copy',
  'execute',
  'call',
  'do',
  'comment',
  'analyze',
  'vacuum',
  'reindex',
  'cluster',
  'lock',
  'listen',
  'notify',
  'set',
  'reset',
]
const FORBIDDEN_FUNCS = [
  'pg_read_file',
  'pg_read_server_files',
  'lo_import',
  'lo_export',
  'pg_terminate_backend',
  'pg_cancel_backend',
  'pg_reload_conf',
  'dblink',
  'dblink_exec',
]

export function validateSQL(rawSql: string): SqlValidation {
  if (typeof rawSql !== 'string' || rawSql.trim().length === 0) {
    return { safe: false, reason: 'Empty SQL.' }
  }
  let sql = rawSql.trim()

  // Reject comments outright; an attacker can hide intent inside.
  if (/--/.test(sql) || /\/\*/.test(sql)) {
    return { safe: false, reason: 'SQL comments are not allowed.' }
  }

  // Split on `;` outside of single/double quotes. Allow exactly one
  // statement (trailing semicolon ok).
  const statements = splitStatements(sql)
  if (statements.length === 0) return { safe: false, reason: 'No statement found.' }
  if (statements.length > 1) return { safe: false, reason: 'Only a single SELECT is allowed.' }
  sql = statements[0]

  // Allow `WITH ... SELECT ...` (single CTE) and plain `SELECT ...`.
  const lower = sql.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!(lower.startsWith('select ') || lower.startsWith('with '))) {
    return { safe: false, reason: 'SQL must start with SELECT or WITH.' }
  }
  if (lower.startsWith('with ') && !/\)\s*select\b/.test(lower)) {
    return { safe: false, reason: 'CTE must terminate in a SELECT.' }
  }

  // Reject forbidden keywords as whole-word matches.
  for (const kw of FORBIDDEN_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, 'i')
    if (re.test(sql)) {
      return { safe: false, reason: `Forbidden keyword: ${kw.toUpperCase()}.` }
    }
  }

  for (const fn of FORBIDDEN_FUNCS) {
    if (sql.toLowerCase().includes(fn)) {
      return { safe: false, reason: `Forbidden function: ${fn}.` }
    }
  }

  if (/\bpg_(?!typeof\b)/i.test(sql)) {
    return { safe: false, reason: 'Access to pg_* system catalogs is not allowed.' }
  }
  if (/\binformation_schema\./i.test(sql)) {
    return { safe: false, reason: 'Access to information_schema is not allowed.' }
  }

  // Find FROM and JOIN targets and ensure each is in the whitelist.
  const targets = extractTableTargets(sql)
  for (const t of targets) {
    if (!WHITELISTED_TABLES[t]) {
      return { safe: false, reason: `Table "${t}" is not whitelisted.` }
    }
  }

  // Enforce LIMIT.
  let normalized = sql.replace(/;\s*$/, '')
  const m = normalized.match(/\blimit\s+(\d+)\b/i)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n > 1000) {
      normalized = normalized.replace(/\blimit\s+\d+\b/i, 'LIMIT 1000')
    }
  } else {
    normalized = normalized + ' LIMIT 200'
  }

  return { safe: true, normalizedSQL: normalized }
}

function splitStatements(sql: string): string[] {
  const out: string[] = []
  let buf = ''
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '"' && !inSingle) inDouble = !inDouble
    if (ch === ';' && !inSingle && !inDouble) {
      const trimmed = buf.trim()
      if (trimmed) out.push(trimmed)
      buf = ''
    } else {
      buf += ch
    }
  }
  const trimmed = buf.trim()
  if (trimmed) out.push(trimmed)
  return out
}

function extractTableTargets(sql: string): string[] {
  const targets: string[] = []
  // FROM <ident>   |   JOIN <ident>
  const re = /\b(from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:as\s+)?[a-zA-Z_][a-zA-Z0-9_]*)?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(sql)) !== null) {
    targets.push(m[2].toLowerCase())
  }
  return Array.from(new Set(targets))
}
