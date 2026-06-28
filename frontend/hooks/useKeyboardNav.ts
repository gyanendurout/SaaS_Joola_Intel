'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

const SHORTCUTS: Record<string, string> = {
  'g i': '/v2/instagram',
  'g y': '/v2/youtube',
  'g r': '/v2/reddit',
  'g x': '/v2/twitter',
  'g t': '/v2/tiktok',
  'g a': '/v2/ask-intel',
  'g c': '/v2/community-intel',
  'g f': '/v2/influencers',
  'g p': '/v2/product-intel',
  'g s': '/v2/sales-intel',
  'g m': '/v2/market',
  'g o': '/v2/overview',
  'g d': '/v2/data-health',
}

export function useKeyboardNav() {
  const router = useRouter()
  useEffect(() => {
    let buffer = ''
    let timer: ReturnType<typeof setTimeout>
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      buffer += (buffer ? ' ' : '') + e.key.toLowerCase()
      clearTimeout(timer)
      timer = setTimeout(() => { buffer = '' }, 800)
      if (SHORTCUTS[buffer]) {
        const dest = SHORTCUTS[buffer]
        buffer = ''
        clearTimeout(timer)
        router.push(dest)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(timer) }
  }, [router])
}
