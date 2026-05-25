/**
 * GET /api/v2/ask-intel/suggestions
 *
 * Returns curated starter prompts grouped by intel category. The chips
 * the page renders are sourced from here so we can iterate copy without
 * shipping a frontend deploy.
 */

import { NextResponse } from 'next/server'
import type { SuggestionsResponse, PromptCategory } from '@/lib/v2/askIntel/types'

export const runtime = 'nodejs'

const SUGGESTIONS: Record<PromptCategory, { title: string; items: { label: string; prompt: string }[] }> = {
  product: {
    title: 'Product Intel',
    items: [
      { label: 'Top JOOLA paddles last 30d', prompt: 'Which JOOLA paddles got the most attention in the last 30 days?' },
      { label: 'Paddle attention leaderboard', prompt: 'Rank all paddles by attention score over the last 90 days and highlight JOOLA.' },
      { label: 'Out-of-stock alerts', prompt: 'Which competitor paddles are currently out of stock and could create switching opportunities?' },
      { label: 'Discount pressure', prompt: 'Which brands have the deepest discounts active right now?' },
    ],
  },
  community: {
    title: 'Community',
    items: [
      { label: 'Crisis signals this week', prompt: 'Show me all crisis signals across channels from the last 7 days, grouped by brand.' },
      { label: 'Subreddit hotspots', prompt: 'Which subreddits had the most JOOLA mentions in the last 30 days?' },
      { label: 'Defection signals', prompt: 'Show competitor-switch mentions where the user is leaving a competitor for JOOLA.' },
      { label: 'Purchase intent', prompt: 'Which products have the highest purchase intent count in the last 14 days?' },
    ],
  },
  campaign: {
    title: 'Campaign & Ads',
    items: [
      { label: 'Active ad creatives', prompt: 'How many active ad creatives does each brand have on Meta right now?' },
      { label: 'Promo banners live', prompt: 'Which brands are running a sitewide promotion right now?' },
      { label: 'Ad pressure timeline', prompt: 'Plot ad pressure score per brand over the last 12 weeks.' },
      { label: 'Promo depth by brand', prompt: 'Average discount depth percentage per brand over the last 30 days?' },
    ],
  },
  influencer: {
    title: 'Influencer',
    items: [
      { label: 'Top influencer posts', prompt: 'Which tracked athletes posted the most engaged content in the last 30 days?' },
      { label: 'Athlete IG followers', prompt: 'Rank tracked athletes by Instagram followers.' },
      { label: 'Most active on X', prompt: 'Top 10 athletes by X posts in the last 14 days.' },
    ],
  },
  social: {
    title: 'Social Media',
    items: [
      { label: 'IG follower growth', prompt: 'Plot weekly Instagram follower counts for the last 8 weeks per brand.' },
      { label: 'Top performing IG posts', prompt: 'Top 20 IG posts across all brands by like_count in the last 30 days.' },
      { label: 'YouTube views', prompt: 'Sum YouTube view counts per brand over the last 90 days.' },
      { label: 'TikTok follower changes', prompt: 'TikTok follower delta per brand over the last 4 weeks.' },
    ],
  },
  sales: {
    title: 'Sales Likelihood',
    items: [
      { label: 'Highest sales-likelihood paddles', prompt: 'Which paddles have the highest sales-likelihood score in the last 30 days?' },
      { label: 'Sales-likelihood vs attention', prompt: 'Show sales-likelihood vs attention score for the top 20 paddles in the last 90 days.' },
      { label: 'JOOLA vs competitors gap', prompt: 'What is the JOOLA-vs-competitor gap across categories in the last_30d summary?' },
    ],
  },
}

export async function GET() {
  const response: SuggestionsResponse = {
    groups: (Object.keys(SUGGESTIONS) as PromptCategory[]).map((category) => ({
      category,
      title: SUGGESTIONS[category].title,
      items: SUGGESTIONS[category].items.map((it) => ({ ...it, category })),
    })),
  }
  return NextResponse.json(response)
}
