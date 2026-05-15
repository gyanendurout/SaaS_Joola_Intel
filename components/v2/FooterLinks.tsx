'use client'

import { useState } from 'react'

type ModalKey = 'sources' | 'methodology' | 'version' | null

const MODALS = {
  sources: {
    title: 'Data Sources',
    content: (
      <>
        <p>JOOLA Intel collects data from the following sources, scraped weekly via Apify cloud actors:</p>
        <ul>
          <li><strong>Instagram</strong> — Brand profiles &amp; posts via <span className="mono">apify/instagram-profile-scraper</span></li>
          <li><strong>YouTube</strong> — Channel snapshots &amp; videos via <span className="mono">streamers/youtube-scraper</span></li>
          <li><strong>Reddit</strong> — r/pickleball mentions via <span className="mono">trudax/reddit-scraper-lite</span></li>
          <li><strong>Meta Ads Library</strong> — Active creatives via <span className="mono">apify/meta-ads-scraper</span></li>
          <li><strong>Brand Websites</strong> — Promotions &amp; pricing via <span className="mono">apify/playwright-scraper</span></li>
          <li><strong>Influencer network</strong> — Athletes tracked manually &amp; via IG scraper</li>
        </ul>
        <p>All data stored in Supabase PostgreSQL, updated every Monday at 07:00 IST.</p>
      </>
    ),
  },
  methodology: {
    title: 'Methodology',
    content: (
      <>
        <p>How key metrics are calculated:</p>
        <ul>
          <li><strong>Engagement Rate</strong> — (avg likes + avg comments) ÷ followers × 100</li>
          <li><strong>Share of Voice (Ads)</strong> — brand ad count ÷ total tracked ads × 100</li>
          <li><strong>Reddit Sentiment</strong> — keyword matching on post content (positive/negative/neutral)</li>
          <li><strong>Follower Delta</strong> — current week snapshot minus previous week snapshot</li>
          <li><strong>Price Distribution</strong> — min, median, average, max from product catalog scrape</li>
        </ul>
        <p>Briefing signals are auto-generated from week-over-week deltas. All calculations use only verified scraped data — no extrapolation.</p>
      </>
    ),
  },
  version: {
    title: 'Version History',
    content: (
      <>
        <ul>
          <li><strong>v2.1</strong> — Premium UI overhaul, sortable tables, section tooltips, command palette, CSV export. Bug fixes: 42P10 constraint, double r/ subreddit names, duplicate posts, chart label truncation.</li>
          <li><strong>v2.0</strong> — Full dashboard with 10 pages: Executive Overview, Instagram, YouTube, Reddit, Comments Intel, Influencer Network, Ads Library, Promotions, Product Catalog, Market Intel.</li>
          <li><strong>v1.x</strong> — Legacy prototype (not active).</li>
        </ul>
      </>
    ),
  },
}

export function FooterLinks() {
  const [open, setOpen] = useState<ModalKey>(null)
  const modal = open ? MODALS[open] : null

  return (
    <>
      <div style={{ display: 'flex', gap: 14 }}>
        <button className="foot-link" onClick={() => setOpen('sources')}>Data sources</button>
        <button className="foot-link" onClick={() => setOpen('methodology')}>Methodology</button>
        <button className="foot-link" onClick={() => setOpen('version')}>v2.1</button>
      </div>

      {modal && (
        <div className="info-modal-backdrop" onClick={() => setOpen(null)}>
          <div className="info-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{modal.title}</h3>
            {modal.content}
            <button className="close-btn" onClick={() => setOpen(null)}>Close</button>
          </div>
        </div>
      )}
    </>
  )
}
