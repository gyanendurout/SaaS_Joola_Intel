/** Email domains allowed to sign in. Keep in sync with migrations/029 (auth hook). */
export const ALLOWED_DOMAINS = ['joola.com', 'joola.in'] as const
/** Session lifetime. Enforced in middleware: Supabase Free can't time-box sessions. */
export const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000
export const SIGNED_IN_AT_COOKIE = 'ji_signed_in_at'
/** Tolerated clock skew for a signed-in-at stamp slightly in the future. */
const FUTURE_SKEW_MS = 5 * 60 * 1000

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isAllowedEmail(email: string): boolean {
  const e = normalizeEmail(email)
  const at = e.lastIndexOf('@')
  if (at <= 0 || e.indexOf('@') !== at) return false
  return (ALLOWED_DOMAINS as readonly string[]).includes(e.slice(at + 1))
}

export function isSessionExpired(signedInAt: string | undefined, now = Date.now()): boolean {
  const t = Number(signedInAt)
  if (!signedInAt || !Number.isFinite(t)) return true
  if (t - now > FUTURE_SKEW_MS) return true
  return now - t > SESSION_MAX_MS
}
