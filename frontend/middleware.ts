import { NextResponse, type NextRequest } from 'next/server'
import { getSessionInMiddleware } from '@/lib/auth/supabase-middleware'
import { isAllowedEmail, isSessionExpired } from '@/lib/auth/rules'

export async function middleware(req: NextRequest) {
  const session = await getSessionInMiddleware(req)
  const { user, supabase } = session
  // Session age comes from the server-verified user record, never a cookie.
  const ok = !!user && !!user.email && isAllowedEmail(user.email) && !isSessionExpired(user.last_sign_in_at)
  if (ok) return session.res

  if (user) await supabase.auth.signOut()            // expired or foreign: end it
  const denied = req.nextUrl.pathname.startsWith('/api/')
    ? NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    : redirectToLogin(req)
  // Carry refreshed/cleared auth cookies (e.g. from signOut) so a stale session can't survive.
  session.res.cookies.getAll().forEach((c) => denied.cookies.set(c))
  return denied
}

function redirectToLogin(req: NextRequest) {
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`
  return NextResponse.redirect(url)
}

export const config = { matcher: ['/', '/v2/:path*', '/api/:path*'] }
