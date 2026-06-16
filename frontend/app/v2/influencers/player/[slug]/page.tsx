'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { pgColor, pgName, PageHead, LoadingPage, SectionInfo } from '@/components/v2/PageShell'
import { fmt } from '@/components/v2/charts'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import { fetchInfluencerIntel, type InfluencerRow, type RosterRow, type PlatformAttention, type InfluencerPostRow } from '@/lib/v2/influencerIntel'
import { formatCalendarDate } from '@/lib/v2/format'

const SENT_PILL: Record<string, string> = {
  positive: 'pill-green', neutral: 'pill-ghost', negative: 'pill-red', unknown: 'pill-ghost',
}

const STATUS_COLOR: Record<string, string> = {
  'business-mapping': '#22c55e', 'confirmed-from-data': '#22c55e',
  'needs-verification': '#F5E625', 'roster-not-confirmed': '#94a3b8',
}
const STATUS_LABEL: Record<string, string> = {
  'business-mapping': 'Business mapping', 'confirmed-from-data': 'Confirmed from data',
  'needs-verification': 'Needs verification', 'roster-not-confirmed': 'Roster not confirmed',
}
const VERIFICATION_DESC: Record<string, string> = {
  verified:   "We found this player's social media account and it matches our records exactly.",
  matched:    "We found a social media account that looks like this player, but the name was slightly different.",
  unmatched:  "We couldn't find a confirmed social media account for this player.",
}

function tierFromFollowers(n: number) {
  if (n >= 500_000) return { label: 'MEGA',  color: '#F5E625' }
  if (n >= 100_000) return { label: 'MACRO', color: '#22c55e' }
  if (n >= 10_000)  return { label: 'MICRO', color: '#818cf8' }
  return { label: 'NANO', color: '#94a3b8' }
}

export default function PlayerDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()

  const [brands, setBrands] = useState<V2Brand[]>([])
  const [roster, setRoster] = useState<RosterRow | null>(null)
  const [influencer, setInfluencer] = useState<InfluencerRow | null>(null)
  const [attention, setAttention] = useState<PlatformAttention | null>(null)
  const [posts, setPosts] = useState<InfluencerPostRow[]>([])
  const [showAllPosts, setShowAllPosts] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [brandSlug, playerName] = decodeURIComponent(slug).split('--')

  useEffect(() => {
    if (!brandSlug || !playerName) { setError('Invalid player URL'); setLoading(false); return }
    document.title = `${playerName} — JOOLA INTEL`

    async function load() {
      try {
        const b = await fetchBrands()
        setBrands(b)
        const to = new Date()
        const from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000)
        const data = await fetchInfluencerIntel(b, { from, to })
        const rosterRow = data.rosterRows.find(r => r.player === playerName && r.brandSlug === brandSlug) || null
        const infRow = data.influencers.find(i => i.name === playerName && i.brandSlug === brandSlug) || null
        const attRow = data.platformStats.find(a => a.player === playerName && a.brandSlug === brandSlug) || null
        const playerPosts = data.influencerPosts.filter(p => p.athleteName === playerName).sort((a, b) => b.engagement - a.engagement)
        setRoster(rosterRow)
        setInfluencer(infRow)
        setAttention(attRow)
        setPosts(playerPosts)
      } catch (e) {
        setError('Failed to load player data')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [brandSlug, playerName])

  if (loading) return <LoadingPage />
  if (error) return <div style={{ padding: 32, color: '#ef4444' }}>{error}</div>

  const isJoola = brandSlug === 'joola'
  const tier = influencer ? tierFromFollowers(influencer.followers) : null
  const brandName = pgName(brandSlug, brands)

  return (
    <>
      <PageHead
        eyebrow="Influencer Intel"
        title={playerName}
        accent={brandName}
        sub={`Sponsored player · ${brandName}`}
        actions={
          <button onClick={() => router.back()} style={{ background: 'none', border: '1px solid var(--wb-14)', color: 'var(--fg-3)', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
            ← Back
          </button>
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Status & Verification ── */}
        {roster && (
          <div className="card" style={{ padding: '18px 22px' }}>
            <h6 style={{ marginTop: 0 }}>Sponsorship Status</h6>
            <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Status</div>
                <span className="pill" style={{ background: STATUS_COLOR[roster.status] + '22', color: STATUS_COLOR[roster.status], border: `1px solid ${STATUS_COLOR[roster.status]}55`, fontSize: 11, padding: '3px 10px', borderRadius: 99, fontWeight: 700 }}>
                  {STATUS_LABEL[roster.status]}
                </span>
                <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 8, maxWidth: 280 }}>
                  {roster.status === 'business-mapping' && "Known from our records, not yet confirmed on social media posts."}
                  {roster.status === 'confirmed-from-data' && "Sponsorship confirmed from their social media posts."}
                  {roster.status === 'needs-verification' && "Appears under multiple brands — needs manual review."}
                  {roster.status === 'roster-not-confirmed' && "Listed in our records but not found on the brand's public player pages."}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Verification</div>
                <span style={{ fontSize: 13, fontWeight: 700, color: roster.verification === 'verified' ? '#22c55e' : roster.verification === 'matched' ? '#F5E625' : '#94a3b8', textTransform: 'capitalize' }}>{roster.verification}</span>
                <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 8, maxWidth: 280 }}>{VERIFICATION_DESC[roster.verification]}</div>
              </div>
            </div>
          </div>
        )}

        {/* ── Performance Stats + Cross-Platform side by side ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

          {/* Performance Stats */}
          <div className="card" style={{ padding: '18px 22px' }}>
            <h6 style={{ marginTop: 0 }}>Performance Stats</h6>
            {!influencer ? (
              <div style={{ fontSize: 12, color: '#6b7280' }}>No profile data available.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {[
                  { label: 'Followers',     value: fmt(influencer.followers),                                         color: '#60a5fa' },
                  { label: 'Posts tracked', value: influencer.posts > 0 ? String(influencer.posts) : '—',             color: '#94a3b8' },
                  { label: 'Avg likes',     value: influencer.avgLikes > 0 ? fmt(influencer.avgLikes) : '—',          color: '#22c55e' },
                  { label: 'Avg comments',  value: influencer.avgComments > 0 ? fmt(influencer.avgComments) : '—',    color: '#a78bfa' },
                  { label: 'Eng. rate',     value: influencer.engRate > 0 ? influencer.engRate.toFixed(2) + '%' : '—', color: influencer.engRate > 8 ? '#F5E625' : '#94a3b8' },
                  { label: 'Tier',          value: tier?.label || '—',                                                color: tier?.color || '#94a3b8' },
                ].map(m => (
                  <div key={m.label} style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: m.value === '—' ? '#3a4150' : m.color, fontFamily: 'JetBrains Mono' }}>{m.value}</div>
                    <div style={{ fontSize: 10, color: '#6b7280', marginTop: 3 }}>{m.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cross-Platform Attention */}
          <div className="card" style={{ padding: '18px 22px' }}>
            <h6 style={{ marginTop: 0 }}>Cross-Platform Attention</h6>
            {!attention ? (
              <div style={{ fontSize: 12, color: '#6b7280' }}>No activity data found for this player in the current window.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {[
                  { label: 'Total',      value: fmt(attention.total),                                                                                color: '#F5E625' },
                  { label: 'Instagram',  value: attention.ig > 0 ? fmt(attention.ig) : '—',                                                         color: '#e1306c' },
                  { label: 'Engagement', value: fmt(attention.engagement),                                                                           color: '#22c55e' },
                  { label: 'Trend',      value: attention.trend === 'up' ? '▲ Rising' : attention.trend === 'down' ? '▼ Falling' : attention.trend === 'flat' ? '▬ Stable' : '—', color: attention.trend === 'up' ? '#22c55e' : attention.trend === 'down' ? '#ef4444' : '#94a3b8' },
                ].map(m => (
                  <div key={m.label} style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: m.value === '—' ? '#3a4150' : m.color, fontFamily: 'JetBrains Mono' }}>{m.value}</div>
                    <div style={{ fontSize: 10, color: '#6b7280', marginTop: 3 }}>{m.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Social Handles ── */}
        {roster && (
          <div className="card" style={{ padding: '18px 22px' }}>
            <h6 style={{ marginTop: 0 }}>Social Handles</h6>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { label: 'Instagram', handle: roster.igHandle, url: roster.igHandle ? `https://www.instagram.com/${roster.igHandle.replace(/^@/, '')}/` : '' },
                { label: 'X (Twitter)', handle: roster.xHandle, url: roster.xHandle ? `https://x.com/${roster.xHandle.replace(/^@/, '')}` : '' },
                { label: 'YouTube', handle: roster.ytHandle, url: roster.ytHandle ? `https://www.youtube.com/@${(roster.ytHandle || '').replace(/^@/, '')}` : '' },
                { label: 'TikTok', handle: roster.tiktokHandle, url: roster.tiktokHandle ? `https://www.tiktok.com/@${(roster.tiktokHandle || '').replace(/^@/, '')}` : '' },
                { label: 'Reddit', handle: roster.redditHandle, url: roster.redditHandle ? `https://www.reddit.com/user/${(roster.redditHandle || '').replace(/^u\//, '')}` : '' },
              ].map(p => (
                <div key={p.label} style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4 }}>{p.label}</div>
                  {p.handle
                    ? <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 600, color: '#60a5fa', textDecoration: 'none' }}>@{p.handle.replace(/^@/, '')}</a>
                    : <span style={{ fontSize: 12, color: '#3a4150' }}>—</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Top Posts ── */}
        <div className="card" style={{ padding: '18px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h6 style={{ margin: 0 }}>Top Performing Posts {posts.length > 0 && <span style={{ color: '#6b7280', fontSize: 11, fontWeight: 400 }}>· {posts.length} total</span>}</h6>
            {posts.length > 5 && (
              <button onClick={() => setShowAllPosts(v => !v)} style={{ background: 'none', border: '1px solid rgba(96,165,250,0.3)', color: '#60a5fa', borderRadius: 6, padding: '4px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                {showAllPosts ? 'Show top 5 ↑' : `View all ${posts.length} posts →`}
              </button>
            )}
          </div>
          {posts.length === 0 ? (
            <div style={{ fontSize: 12, color: '#6b7280' }}>No posts collected for this player in the current window.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(showAllPosts ? posts : posts.slice(0, 5)).map(p => (
                <div key={p.id} style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: 'rgba(225,48,108,0.15)', color: '#e1306c', border: '1px solid rgba(225,48,108,0.3)', textTransform: 'uppercase' }}>{p.platform}</span>
                    <span className={'pill ' + (SENT_PILL[p.sentiment] || 'pill-ghost')} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 99, fontWeight: 700 }}>{p.sentiment}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b7280', fontFamily: 'JetBrains Mono' }}>{p.postedAt ? formatCalendarDate(p.postedAt) : '—'}</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.6, marginBottom: 10 }}>{p.caption || '(no caption)'}</div>
                  <div style={{ display: 'flex', gap: 18, fontSize: 12, color: '#94a3b8', flexWrap: 'wrap' }}>
                    <span>♥ <b style={{ color: '#22c55e' }}>{fmt(p.likes)}</b> likes</span>
                    <span>💬 <b>{fmt(p.comments)}</b> comments</span>
                    <span>⚡ <b style={{ color: '#F5E625' }}>{fmt(p.engagement)}</b> engagement</span>
                    <span>ER <b style={{ color: p.engRate > 8 ? '#F5E625' : '#94a3b8' }}>{p.engRate.toFixed(2)}%</b></span>
                    {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', color: '#60a5fa', textDecoration: 'none', fontSize: 12 }}>View original →</a>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </>
  )
}
