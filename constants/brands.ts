export const BRAND_SLUGS = [
  'joola',
  'selkirk',
  'crbn',
  'franklin',
  'engage',
  'paddletek',
  'six-zero',
  'onix',
  'wilson',
  'gamma',
  'prokennex',
  'head',
] as const

export type BrandSlug = (typeof BRAND_SLUGS)[number]

export const BRAND_COLORS: Record<BrandSlug, string> = {
  joola: '#22c55e',
  selkirk: '#F5E625',
  crbn: '#818cf8',
  franklin: '#ec4899',
  engage: '#06b6d4',
  paddletek: '#f59e0b',
  'six-zero': '#a855f7',
  onix: '#ef4444',
  wilson: '#14b8a6',
  gamma: '#60a5fa',
  prokennex: '#fb923c',
  head: '#0ea5e9',
}

export const BRAND_NAMES: Record<BrandSlug, string> = {
  joola: 'JOOLA',
  selkirk: 'Selkirk',
  crbn: 'CRBN',
  franklin: 'Franklin',
  engage: 'Engage',
  paddletek: 'Paddletek',
  'six-zero': 'Six Zero',
  onix: 'Onix',
  wilson: 'Wilson',
  gamma: 'Gamma',
  prokennex: 'ProKennex',
  head: 'Head',
}

export const JOOLA_BRAND_SLUG: BrandSlug = 'joola'
