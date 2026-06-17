import { useEffect, useState } from 'react'

const KEY = 'joola-bookmarked-brands'

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<string[]>([])
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '[]')
      if (Array.isArray(saved)) setBookmarks(saved)
    } catch {}
  }, [])

  function toggle(slug: string) {
    setBookmarks(prev => {
      const next = prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug]
      localStorage.setItem(KEY, JSON.stringify(next))
      return next
    })
  }
  function isBookmarked(slug: string) { return bookmarks.includes(slug) }
  return { bookmarks, toggle, isBookmarked }
}
