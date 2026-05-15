# JOOLA Intel — Pickleball Competitor Intelligence

Next.js 14 dashboard reading live data from Supabase.

## Quick Start

```bash
npm install
npm run dev
# Open http://localhost:3000
```

## Pages
| Page | Route | Description |
|------|-------|-------------|
| Overview & Insights | / | KPIs, IG benchmarking, SOV, engagement matrix, competitive positioning, 8 content gaps, 5 growth opportunities |
| Instagram | /instagram | Follower comparison, posts by brand, top posts by engagement, posts feed |
| YouTube | /youtube | Videos per brand, views, subscribers, top videos |
| Reddit | /reddit | Brand mentions, top upvoted posts |
| Influencers | /influencers | 2026 verified roster (27 athletes), active/inactive status |
| Products & Reviews | /products | 114 products, avg rating, review count, price comparison, full catalog |

## Data Sources (updated every Monday 7AM IST)
- Instagram: 141 posts, 11 brand profiles
- YouTube: 387 videos, 11 channel snapshots
- Reddit: 38 brand mentions
- Products: 114 products from brand websites
- Influencers: 27 athletes (2026 verified roster)

## Add a New Page
1. Create `app/your-page/page.tsx`
2. Add to nav in `components/Sidebar.tsx`
3. Query Supabase: `supabase.from('table').select('*')`

## Deploy to Vercel
```bash
npm i -g vercel
vercel
```

## Database Tables (Supabase)
brands, ig_accounts, ig_profiles_weekly, ig_posts, ig_post_analysis,
ig_comments, ig_comment_analysis, yt_channels, yt_channel_weekly,
yt_videos, yt_video_analysis, yt_comments, yt_comment_analysis,
products, product_reviews, reddit_mentions, news_mentions,
influencers, influencer_posts, weekly_run_log
