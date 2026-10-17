/** Where to land after sign-in when `next` is missing or unsafe. */
export const DEFAULT_NEXT = '/v2/overview'

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/**
 * Returns `next` only when it is a same-origin dashboard path ('/' or '/v2…');
 * anything that could leave the origin (//host, /\host, scheme://, backslashes,
 * control chars) falls back to DEFAULT_NEXT.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next) return DEFAULT_NEXT
  if (next !== '/' && !next.startsWith('/v2')) return DEFAULT_NEXT
  if (next.startsWith('//') || next.includes('\\'))return DEFAULT_NEXT
  if (CONTROL_CHARS.test(next) || next.includes('://')) return DEFAULT_NEXT
  return next
}
