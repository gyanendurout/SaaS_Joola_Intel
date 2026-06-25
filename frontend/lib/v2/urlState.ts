/**
 * Encode/decode UI filter state into the URL hash for shareable links.
 */
export type UrlState = { brand?: string; range?: string; sort?: string }

export function updateUrlState(state: Partial<UrlState>) {
  if (typeof window === 'undefined') return
  try {
    const current = readUrlState()
    const next = { ...current, ...state }
    const keys = Object.keys(next) as Array<keyof UrlState>
    keys.forEach(k => { if (!next[k]) delete next[k] })
    const encoded = btoa(JSON.stringify(next))
    window.history.replaceState(null, '', '#s=' + encoded)
  } catch {}
}

export function readUrlState(): UrlState {
  if (typeof window === 'undefined') return {}
  try {
    const match = window.location.hash.match(/^#s=(.+)$/)
    if (!match) return {}
    return JSON.parse(atob(match[1])) as UrlState
  } catch { return {} }
}

export function getShareableLink(state: UrlState): string {
  if (typeof window === 'undefined') return ''
  try {
    const encoded = btoa(JSON.stringify(state))
    return window.location.origin + window.location.pathname + '#s=' + encoded
  } catch { return typeof window !== 'undefined' ? window.location.href : '' }
}
