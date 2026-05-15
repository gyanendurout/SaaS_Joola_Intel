'use client'

import { useEffect, useState, useCallback } from 'react'

export type DesignVersion = 'v1' | 'v2'

const STORAGE_KEY = 'joola.design-version'

/**
 * Persist + read the user's chosen design version.
 * Reads localStorage on mount; defaults to 'v1'.
 * Reflects via custom 'designversion' event so multiple tabs / components sync.
 */
export function useDesignVersion(): [DesignVersion, (v: DesignVersion) => void] {
  const [version, _setVersion] = useState<DesignVersion>('v1')

  useEffect(() => {
    try {
      const stored = (window.localStorage.getItem(STORAGE_KEY) as DesignVersion | null) ?? 'v1'
      _setVersion(stored === 'v2' ? 'v2' : 'v1')
    } catch {
      /* SSR/private-mode noop */
    }
    const handler = (e: Event) => {
      const next = (e as CustomEvent<DesignVersion>).detail
      if (next === 'v1' || next === 'v2') _setVersion(next)
    }
    window.addEventListener('designversion', handler)
    return () => window.removeEventListener('designversion', handler)
  }, [])

  const setVersion = useCallback((v: DesignVersion) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, v)
    } catch {}
    window.dispatchEvent(new CustomEvent('designversion', { detail: v }))
    _setVersion(v)
  }, [])

  return [version, setVersion]
}

/** Routes mapping: classic <-> v2 path swap. */
export function toggleVersionPath(currentPath: string, target: DesignVersion): string {
  // Strip query / hash
  const [path] = currentPath.split(/[?#]/)
  const cleanPath = path.replace(/\/+$/, '') || '/'

  if (target === 'v2') {
    if (cleanPath.startsWith('/v2')) return cleanPath || '/v2'
    return cleanPath === '/' ? '/v2' : `/v2${cleanPath}`
  } else {
    if (cleanPath.startsWith('/v2')) {
      const stripped = cleanPath.slice(3)
      return stripped || '/'
    }
    return cleanPath
  }
}
