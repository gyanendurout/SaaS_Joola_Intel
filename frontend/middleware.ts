import { NextResponse, type NextRequest } from 'next/server'
import { getSessionInMiddleware } from '@/lib/auth/supabase-middleware'
import { isAllowedEmail, isSessionExpired } from '@/lib/auth/rules'

export async function middleware(req: NextRequest) {
  const session = await getSessionInMiddleware(req)
  const { user, supabase } = session
  // Session age comes from the server-verified user record, never a cookie.
  const ok = !!user && !!user.email && isAllowedEmail(user.email) && !isSessionExpired(user.last_sign_in_at)
  if (ok) return session.res

  if (user) await supabase.auth.signOut({ scope: 'local' }) // expired or foreign: end this browser's session
  const { pathname } = req.nextUrl
  const isApi = pathname === '/api' || pathname.startsWith('/api/')
  const denied = isApi
    ? NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    : redirectToLogin(req)
  // Carry cleared cookies + no-cache headers so a stale session can't survive or be cached.
  return session.applyAuthTo(denied)
}

function redirectToLogin(req: NextRequest) {
  const back = req.nextUrl.clone()
  back.searchParams.delete('_rsc') // RSC cache-buster, not part of the user's URL
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = `?next=${encodeURIComponent(back.pathname + back.search)}`
  return NextResponse.redirect(url)
}

export const config = { matcher: ['/', '/v2/:path*', '/api/:path*', '/architecture.html'] }
