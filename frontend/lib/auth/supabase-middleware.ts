import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { requireEnv } from './env'

/** Refreshes the auth cookies and returns the verified user (or null). */
export async function getSessionInMiddleware(req: NextRequest) {
  let res = NextResponse.next({ request: req })
  // No-cache headers @supabase/ssr sends alongside auth cookies (Cache-Control, Expires, Pragma).
  let authHeaders: Record<string, string> = {}
  const supabase = createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list, headers) => {
          list.forEach(({ name, value }) => req.cookies.set(name, value))
          authHeaders = { ...authHeaders, ...headers }
          res = NextResponse.next({ request: req })
          list.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
          Object.entries(authHeaders).forEach(([k, v]) => res.headers.set(k, v))
        },
    } },
  )
  const { data: { user } } = await supabase.auth.getUser()

  /** Copies the auth cookies and no-cache headers onto another response (e.g. a 401 or redirect). */
  const applyAuthTo = <T extends NextResponse>(target: T): T => {
    res.cookies.getAll().forEach((c) => target.cookies.set(c))
    Object.entries(authHeaders).forEach(([k, v]) => target.headers.set(k, v))
    return target
  }
  // Getter: setAll reassigns `res`, so read it after any later auth call (e.g. signOut).
  return { get res() { return res }, user, supabase, applyAuthTo }
}
