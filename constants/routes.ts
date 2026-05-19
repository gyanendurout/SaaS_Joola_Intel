export const ROUTES = {
  home: '/',
  dashboard: '/v2',
  instagram: '/v2/instagram',
  youtube: '/v2/youtube',
  reddit: '/v2/reddit',
  comments: '/v2/comments',
  influencers: '/v2/influencers',
  ads: '/v2/ads',
  promotions: '/v2/promotions',
  products: '/v2/products',
  market: '/v2/market',
} as const

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES]

export const API_ROUTES = {
  keywordResearch: '/api/keyword-research',
  generateContent: '/api/generate-content',
} as const
