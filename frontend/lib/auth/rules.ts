/** Email domains allowed to sign in. Keep in sync with migrations/029 (auth hook). */
export const ALLOWED_DOMAINS = ['joola.com', 'joola.in'] as const
/** Session lifetime. Enforced in middleware: Supabase Free can't time-box sessions. */
export const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000
/** Tolerated clock skew for a sign-in timestamp slightly in the future. */
const FUTURE_SKEW_MS = 5 * 60 * 1000
/** RFC 5321 practical maximum for a full address. */
const MAX_EMAIL_LENGTH = 254

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Plain ASCII local part at exactly one of ALLOWED_DOMAINS (no subdomains). */
const ALLOWED_EMAIL_RE = new RegExp(
  `^[a-z0-9._%+'-]+@(${ALLOWED_DOMAINS.map(escapeRegex).join('|')})$`,
)

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Returns the normalized email when it may sign in, else null.
 * Callers should send exactly this value to Supabase.
 */
export function parseAllowedEmail(raw: string): string | null {
  const e = normalizeEmail(raw)
  if (e.length > MAX_EMAIL_LENGTH) return null
  return ALLOWED_EMAIL_RE.test(e) ? e : null
}

export function isAllowedEmail(email: string): boolean {
  return parseAllowedEmail(email) !== null
}

/**
 * True when the session is older than SESSION_MAX_MS (or the timestamp is
 * missing, unparseable, or implausibly in the future).
 * Pass the server-verified user.last_sign_in_at from supabase.auth.getUser() — never a cookie value.
 */
export function isSessionExpired(signedInAt: string | null | undefined, now = Date.now()): boolean {
  if (!signedInAt) return true
  const t = Date.parse(signedInAt)
  if (!Number.isFinite(t)) return true
  if (t - now > FUTURE_SKEW_MS) return true
  return now - t > SESSION_MAX_MS
}
