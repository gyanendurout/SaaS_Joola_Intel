import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/** Refreshes the auth cookies and returns the verified user (or null). */
export async function getSessionInMiddleware(req: NextRequest) {
  let res = NextResponse.next({ request: req })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => req.cookies.set(name, value))
          res = NextResponse.next({ request: req })
          list.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
        },
    } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  // Getter: setAll reassigns `res`, so callers must read it after any later auth call (e.g. signOut).
  return { get res() { return res }, user, supabase }
}
