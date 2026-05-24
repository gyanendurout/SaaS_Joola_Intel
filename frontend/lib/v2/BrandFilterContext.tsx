'use client'

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { fetchBrands, type V2Brand } from './data'

type BrandFilterCtx = {
  allBrands: V2Brand[]
  setAllBrands: (brands: V2Brand[]) => void
  selectedSlugs: string[]
  setSelectedSlugs: (slugs: string[]) => void
  filteredBrands: V2Brand[]
  isFiltered: boolean
}

const BrandFilterContext = createContext<BrandFilterCtx>({
  allBrands: [],
  setAllBrands: () => {},
  selectedSlugs: [],
  setSelectedSlugs: () => {},
  filteredBrands: [],
  isFiltered: false,
})

function readStored(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const s = localStorage.getItem('joola-brand-filter')
    return s ? JSON.parse(s) : []
  } catch { return [] }
}

export function BrandFilterProvider({ children }: { children: ReactNode }) {
  const [allBrands, setAllBrandsRaw] = useState<V2Brand[]>([])
  const [selectedSlugs, setSelectedSlugsRaw] = useState<string[]>(readStored)

  // Fetch brands at layout level so the sidebar filter is populated immediately,
  // independent of which page first renders.
  useEffect(() => {
    fetchBrands().then(b => setAllBrandsRaw(b)).catch(() => {})
  }, [])

  const setAllBrands = useCallback((brands: V2Brand[]) => {
    setAllBrandsRaw(brands)
  }, [])

  const setSelectedSlugs = useCallback((slugs: string[]) => {
    setSelectedSlugsRaw(slugs)
    try { localStorage.setItem('joola-brand-filter', JSON.stringify(slugs)) } catch {}
  }, [])

  const filteredBrands = selectedSlugs.length > 0
    ? allBrands.filter(b => selectedSlugs.includes(b.id))
    : allBrands

  return (
    <BrandFilterContext.Provider value={{
      allBrands,
      setAllBrands,
      selectedSlugs,
      setSelectedSlugs,
      filteredBrands,
      isFiltered: selectedSlugs.length > 0 && selectedSlugs.length < allBrands.length,
    }}>
      {children}
    </BrandFilterContext.Provider>
  )
}

export function useBrandFilter() {
  return useContext(BrandFilterContext)
}

// Utility: filter any array with a .brand field by the active filter
export function applyBrandFilter<T extends { brand: string }>(
  data: T[],
  filteredBrands: V2Brand[],
  isFiltered: boolean,
): T[] {
  if (!isFiltered) return data
  const s = new Set(filteredBrands.map(b => b.id))
  return data.filter(r => s.has(r.brand))
}

// Utility: filter Record<brandSlug, T> by the active filter
export function applyBrandFilterRecord<T>(
  record: Record<string, T>,
  filteredBrands: V2Brand[],
  isFiltered: boolean,
): Record<string, T> {
  if (!isFiltered) return record
  const s = new Set(filteredBrands.map(b => b.id))
  return Object.fromEntries(Object.entries(record).filter(([k]) => s.has(k)))
}
