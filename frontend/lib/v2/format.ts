'use client'

/**
 * Shared calendar-date formatter for all v2 dashboard pages.
 *
 * One canonical helper so every table/feed renders dates the same way
 * (e.g. "15 Jan 2025"). Replaces per-page `postedLabel(days)` helpers
 * that returned "Xd ago" style strings.
 */

/**
 * Convert a string / number / Date / null into a calendar date string
 * like "15 Jan 2025". Returns "—" for null, undefined, or invalid input.
 *
 * Uses Intl.DateTimeFormat('en-GB', …) which yields "15 Jan 2025" with no
 * trailing comma (US locale produces "Jan 15, 2025" which we also strip).
 */
export function formatCalendarDate(
  input: string | number | Date | null | undefined,
): string {
  if (input === null || input === undefined || input === '') return '—'
  const d = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(d.getTime())) return '—'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(d)
  } catch {
    return '—'
  }
}

/**
 * Convenience helper: convert a "days ago" number into a calendar date.
 * Negative or zero values map to today.
 *
 * Used to migrate pages that store posted-age as `days: number` (relative
 * to `Date.now()`) into the shared calendar-date format.
 */
export function formatCalendarDateFromDaysAgo(days: number | null | undefined): string {
  if (days === null || days === undefined || !Number.isFinite(days)) return '—'
  const ms = Math.max(0, days) * 86_400_000
  return formatCalendarDate(new Date(Date.now() - ms))
}
