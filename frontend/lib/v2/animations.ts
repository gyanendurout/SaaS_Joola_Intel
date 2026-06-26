'use client'

import { useEffect, useState } from 'react'

/**
 * Scroll-reveal hook. Returns a callback ref + visible flag.
 * Uses a callback ref (not useRef) so it fires correctly even
 * when the component has an early return (e.g. if (loading) return <LoadingPage />).
 */
export function useReveal(threshold = 0.08) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [vis, setVis] = useState(false)
  // callback ref — fires when the element actually mounts into the DOM
  const ref = (node: HTMLDivElement | null) => setEl(node)
  useEffect(() => {
    if (!el || vis) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) { setVis(true); obs.disconnect() }
      },
      { threshold }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [el, vis, threshold])
  return { ref, vis }
}

/** Convenience: class string for a reveal container */
export const revealCls = (vis: boolean, extra = '') =>
  `ov-reveal${vis ? ' is-vis' : ''}${extra ? ' ' + extra : ''}`
