import { PostgrestError } from '@supabase/supabase-js'

export type DbResult<T> =
  | { data: T; error: null }
  | { data: null; error: PostgrestError }

// Unwraps a Supabase query result, throwing on error
export function unwrap<T>(result: DbResult<T>): T {
  if (result.error) {
    throw new Error(`DB error [${result.error.code}]: ${result.error.message}`)
  }
  return result.data
}

// Like unwrap but returns null instead of throwing for empty results
export function unwrapOrNull<T>(result: DbResult<T | null>): T | null {
  if (result.error) {
    throw new Error(`DB error [${result.error.code}]: ${result.error.message}`)
  }
  return result.data
}
