'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { pgColor, pgName, PageHead, LoadingPage, SectionInfo } from '@/components/v2/PageShell'
import { fmt } from '@/components/v2/charts'
import { fetchBrands, type V2Brand } from '@/lib/v2/data'
import {
  fetchInfluencerIntel,
  type BrandPlayerStats,
  type RosterRow,
  type InfluencerRow,
  type PlatformAttention,
  type InfluencerPostRow,
  type PlayerProductConnection,
} from '@/lib/v2/influencerIntel'
import { formatCalendarDate } from '@/lib/v2/format'

const SENT_PILL: Record<string, string> = {
  positive: 'pill-green', neutral: 'pill-ghost', negative: 'pill-red', unknown: 'pill-ghost',
}
const STATUS_COLOR: Record<string, string> = {
  'business-mapping': '#22c55e', 'confirmed-from-data': '#22c55e',
  'needs-verification': '#F5E625', 'roster-not-confirmed': '#94a3b8',
}
const STATUS_LABEL: Record<string, string> = {
  'business-mapping': 'Business mapping', 'confirmed-from-data': 'Confirmed',
  'needs-verification': 'Needs verification', 'roster-not-confirmed': 'Not confirmed',
}

function tierFromFollowers(n: number) {
  if (n >= 500_000) return { label: 'MEGA',  color: '#F5E625' }
  if (n >= 100_000) return { label: 'MACRO', color: '#22c55e' }
  if (n >= 10_000)  return { label: 'MICRO', color: '#818cf8' }
  return { label: 'NANO', color: '#94a3b8' }
}

function StatCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 8px', textAlign: 'center' }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: value === '—' ? '#3a4150' : (color || '#fff'), fontFamily: 'JetBrains Mono', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
    </div>
  )
}

function PlatformBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', width: 56, textTransform: 'uppercase', letterSpacing: '0.07em', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: 'var(--wb-5)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: value > 0 ? color : '#3a4150', fontFamily: 'JetBrains Mono', minWidth: 42, textAlign: 'right' }}>
        {value > 0 ? fmt(value) : '—'}
      </span>
    </div>
  )
}

export default function BrandStrengthDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const brandSlug = decodeURIComponent(slug)

  const [brands, setBrands] = useState<V2Brand[]>([])
  const [stats, setStats] = useState<BrandPlayerStats | null>(null)
  const [roster, setRoster] = useState<RosterRow[]>([])
  const [influencers, setInfluencers] = useState<InfluencerRow[]>([])
  const [attention, setAttention] = useState<PlatformAttention[]>([])
  const [posts, setPosts] = useState<InfluencerPostRow[]>([])
  const [connections, setConnections] = useState<PlayerProductConnection[]>([])
  const [showAllPosts, setShowAllPosts] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!brandSlug) { setError('Invalid brand URL'); setLoading(false); return }

    async function load() {
      try {
        const b = await fetchBrands()
        setBrands(b)
        const to = new Date()
        const from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000)
        const data = await fetchInfluencerIntel(b, { from, to })

        setStats(data.brandPlayerStats.find(s => s.brandSlug === brandSlug) ?? null)
        setRoster(data.rosterRows.filter(r => r.brandSlug === brandSlug))
        setInfluencers(data.influencers.filter(i => i.brandSlug === brandSlug))
        setAttention(data.platformStats.filter(a => a.brandSlug === brandSlug))
        setPosts(data.influencerPosts.filter(p => p.brandSlug === brandSlug).sort((a, b) => b.engagement - a.engagement))
        setConnections(data.playerProductConnections.filter(c => c.brandSlug === brandSlug))
      } catch (e) {
        setError('Failed to load brand data')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [brandSlug])

  if (loading) return <LoadingPage />
  if (error) return <div style={{ padding: 32, color: '#ef4444' }}>{error}</div>

  const brandName = pgName(brandSlug, brands)
  const isJoola = brandSlug === 'joola'
  const color = pgColor(brandSlug)

  const maxPlatform = Math.max(1, stats?.ig ?? 0, stats?.yt ?? 0, stats?.tiktok ?? 0, stats?.x ?? 0, stats?.reddit ?? 0)
  const totalAttentionMentions = attention.reduce((s, a) => s + a.total, 0)

  // Sort: JOOLA players first, then by engagement desc
  const sortedRoster = [...roster].sort((a, b) => {
    const ia = influencers.find(i => i.name === a.player)
    const ib = influencers.find(i => i.name === b.player)
    return (ib?.engRate ?? 0) - (ia?.engRate ?? 0)
  })

  return (
    <>
      <PageHead
        eyebrow="Influencer Intel"
        title={brandName}
        accent="Sponsored Players"
        sub={`Brand-level sponsored-player strength · ${roster.length} athletes tracked`}
        actions={
          <button onClick={() => router.back()} style={{ background: 'none', border: '1px solid var(--wb-14)', color: 'var(--fg-3)', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
            ← Back
          </button>
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Aggregate KPI row ── */}
        <div className="card" style={{ padding: '18px 22px' }}>
          <h6 style={{ marginTop: 0, marginBottom: 14 }}>Sponsored-Player Program Overview</h6>
          {stats ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              <StatCell label="Players" value={String(stats.playersTracked)} color={isJoola ? '#22c55e' : color} />
              <StatCell label="Active" value={String(stats.playersActive)} color="#22c55e" />
              <StatCell label="Mentions" value={stats.totalMentions > 0 ? fmt(stats.totalMentions) : '—'} color="#F5E625" />
              <StatCell label="Reach" value={stats.totalReach > 0 ? fmt(stats.totalReach) : '—'} color="#60a5fa" />
              <StatCell label="Avg ER" value={stats.avgEngRate > 0 ? stats.avgEngRate.toFixed(2) + '%' : '—'} color={stats.avgEngRate > 5 ? '#F5E625' : stats.avgEngRate > 2 ? '#22c55e' : '#94a3b8'} />
              <StatCell label="Engagement" value={stats.totalEngagement > 0 ? fmt(stats.totalEngagement) : '—'} color="#a78bfa" />
              <StatCell label="Negative %" value={stats.negativePct > 0 ? stats.negativePct.toFixed(1) + '%' : '—'} color={stats.negativePct > 20 ? '#ef4444' : '#94a3b8'} />
              <StatCell label="Posts" value={posts.length > 0 ? fmt(posts.length) : '—'} color="#94a3b8" />
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#6b7280' }}>No aggregate stats available for this brand yet.</div>
          )}
        </div>

        {/* ── Platform breakdown + top player side by side ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

          {/* Platform signals */}
          <div className="card" style={{ padding: '18px 22px' }}>
            <h6 style={{ marginTop: 0, marginBottom: 16 }}>Platform Signal Breakdown
              <SectionInfo title="Platform breakdown" description="Total player mentions broken down by social channel. Sourced from mention_facts across Instagram, YouTube, TikTok, X, and Reddit for all athletes sponsored by this brand." source="mention_facts · all platforms" />
            </h6>
            {stats ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <PlatformBar label="Instagram" value={stats.ig}     max={maxPlatform} color="#e1306c" />
                <PlatformBar label="YouTube"   value={stats.yt}     max={maxPlatform} color="#ff0000" />
                <PlatformBar label="TikTok"    value={stats.tiktok} max={maxPlatform} color="#69c9d0" />
                <PlatformBar label="X"         value={stats.x}      max={maxPlatform} color="#ffffff" />
                <PlatformBar label="Reddit"    value={stats.reddit} max={maxPlatform} color="#ff4500" />
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#6b7280' }}>No platform data available.</div>
            )}
          </div>

          {/* Top players by attention */}
          <div className="card" style={{ padding: '18px 22px' }}>
            <h6 style={{ marginTop: 0, marginBottom: 14 }}>Players by Attention
              <SectionInfo title="Player attention ranking" description="Athletes ranked by total cross-platform mention signals in the 90-day window." source="mention_facts · platform_stats" />
            </h6>
            {attention.length === 0 ? (
              <div style={{ fontSize: 12, color: '#6b7280' }}>No attention data available.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[...attention].sort((a, b) => b.total - a.total).slice(0, 6).map((a, i) => {
                  const maxAtt = Math.max(1, attention.reduce((s, x) => Math.max(s, x.total), 0))
                  return (
                    <div key={a.player} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                      onClick={() => router.push(`/v2/influencers/player/${encodeURIComponent(brandSlug + '--' + a.player)}`)}>
                      <span style={{ fontSize: 10, color: '#6b7280', fontFamily: 'JetBrains Mono', width: 16 }}>#{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: isJoola ? '#22c55e' : 'var(--fg)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.player}</div>
                        <div style={{ height: 4, background: 'var(--wb-5)', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${(a.total / maxAtt) * 100}%`, background: color, borderRadius: 99 }} />
                        </div>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#F5E625', fontFamily: 'JetBrains Mono', flexShrink: 0 }}>{fmt(a.total)}</span>
                      <span style={{ fontSize: 10, color: a.trend === 'up' ? '#22c55e' : a.trend === 'down' ? '#ef4444' : '#94a3b8' }}>
                        {a.trend === 'up' ? '▲' : a.trend === 'down' ? '▼' : '▬'}
                      </span>
                    </div>
                  )
                })}
                {attention.length > 6 && (
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>+{attention.length - 6} more athletes below</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Sponsored player roster ── */}
        <div className="card" style={{ padding: '18px 22px' }}>
          <h6 style={{ marginTop: 0, marginBottom: 14 }}>
            Sponsored Athlete Roster
            <SectionInfo title="Sponsored athlete roster" description="All athletes sponsored by this brand with their social handles, sponsorship status, profile stats, and cross-platform engagement. Click any row to view the full player detail." source="playerRoster.ts · influencers · influencer_posts" />
            <span style={{ fontSize: 11, fontWeight: 400, color: '#6b7280', marginLeft: 8 }}>· {roster.length} athletes · click row to view detail</span>
          </h6>
          {sortedRoster.length === 0 ? (
            <div style={{ fontSize: 12, color: '#6b7280' }}>No roster data for this brand.</div>
          ) : (
            <div className="table-wrap">
              <table className="data" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Status</th>
                    <th>Verification</th>
                    <th style={{ textAlign: 'right' }}>Followers</th>
                    <th style={{ textAlign: 'right' }}>Posts</th>
                    <th style={{ textAlign: 'right' }}>Avg Likes</th>
                    <th style={{ textAlign: 'right' }}>Eng Rate</th>
                    <th>Tier</th>
                    <th>Platforms</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRoster.map(r => {
                    const inf = influencers.find(i => i.name === r.player)
                    const tier = inf ? tierFromFollowers(inf.followers) : null
                    return (
                      <tr key={r.player} className={isJoola ? 'joola' : ''}
                        style={{ cursor: 'pointer' }}
                        onClick={() => router.push(`/v2/influencers/player/${encodeURIComponent(brandSlug + '--' + r.player)}`)}>
                        <td style={{ fontWeight: 700, color: isJoola ? '#22c55e' : 'var(--fg)' }}>{r.player}</td>
                        <td>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: STATUS_COLOR[r.status] + '22', color: STATUS_COLOR[r.status], border: `1px solid ${STATUS_COLOR[r.status]}55` }}>
                            {STATUS_LABEL[r.status]}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: 11, fontWeight: 700, color: r.verification === 'verified' ? '#22c55e' : r.verification === 'matched' ? '#F5E625' : '#94a3b8', textTransform: 'capitalize' }}>
                            {r.verification}
                          </span>
                        </td>
                        <td className="cell-num" style={{ textAlign: 'right' }}>{inf?.followers ? fmt(inf.followers) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                        <td className="cell-num" style={{ textAlign: 'right' }}>{inf?.posts || <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                        <td className="cell-num" style={{ textAlign: 'right' }}>{inf?.avgLikes ? fmt(inf.avgLikes) : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                        <td className="cell-num" style={{ textAlign: 'right', color: (inf?.engRate ?? 0) > 8 ? '#F5E625' : 'var(--fg)' }}>
                          {inf?.engRate ? inf.engRate.toFixed(2) + '%' : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                        </td>
                        <td>{tier ? <span style={{ fontSize: 10, fontWeight: 800, color: tier.color, letterSpacing: '0.06em' }}>{tier.label}</span> : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                        <td>
                          <div style={{ display: 'inline-flex', gap: 4 }}>
                            {r.igHandle      && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: 'rgba(225,48,108,0.15)', color: '#e1306c', fontWeight: 700 }}>IG</span>}
                            {r.xHandle       && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: 'var(--wb-8)', color: '#fff',     fontWeight: 700 }}>X</span>}
                            {r.ytHandle      && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: 'rgba(255,0,0,0.15)',     color: '#ff4040', fontWeight: 700 }}>YT</span>}
                            {r.tiktokHandle  && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: 'rgba(105,201,208,0.15)', color: '#69c9d0', fontWeight: 700 }}>TT</span>}
                            {r.redditHandle  && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: 'rgba(255,69,0,0.15)',    color: '#ff4500', fontWeight: 700 }}>RD</span>}
                            {!r.igHandle && !r.xHandle && !r.ytHandle && !r.tiktokHandle && !r.redditHandle && <span style={{ color: 'var(--fg-4)', fontSize: 11 }}>—</span>}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Top Posts ── */}
        <div className="card" style={{ padding: '18px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h6 style={{ margin: 0 }}>
              Top Performing Posts
              {posts.length > 0 && <span style={{ color: '#6b7280', fontSize: 11, fontWeight: 400 }}> · {posts.length} total across {roster.length} athletes</span>}
            </h6>
            {posts.length > 5 && (
              <button onClick={() => setShowAllPosts(v => !v)} style={{ background: 'none', border: '1px solid rgba(96,165,250,0.3)', color: '#60a5fa', borderRadius: 6, padding: '4px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                {showAllPosts ? 'Show top 5 ↑' : `View all ${posts.length} posts →`}
              </button>
            )}
          </div>
          {posts.length === 0 ? (
            <div style={{ fontSize: 12, color: '#6b7280' }}>No posts collected for this brand's athletes in the current window.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(showAllPosts ? posts : posts.slice(0, 5)).map(p => (
                <div key={p.id} style={{ background: 'var(--wb-3)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: 'rgba(225,48,108,0.15)', color: '#e1306c', border: '1px solid rgba(225,48,108,0.3)', textTransform: 'uppercase' }}>{p.platform}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: isJoola ? '#22c55e' : color }}>{p.athleteName}</span>
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

        {/* ── Player ↔ Paddle connections ── */}
        {connections.length > 0 && (
          <div className="card" style={{ padding: '18px 22px' }}>
            <h6 style={{ marginTop: 0, marginBottom: 14 }}>Player × Paddle Connections
              <SectionInfo title="Player paddle connections" description="Instances where a sponsored athlete and a paddle product were co-mentioned in the same enriched signal." source="mention_facts · athlete_id AND product_id non-null" />
            </h6>
            <div className="table-wrap">
              <table className="data" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Paddle</th>
                    <th>Channel</th>
                    <th style={{ textAlign: 'right' }}>Mentions</th>
                    <th style={{ textAlign: 'right' }}>Positive</th>
                    <th style={{ textAlign: 'right' }}>Negative</th>
                    <th style={{ textAlign: 'right' }}>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {connections.sort((a, b) => b.attentionScore - a.attentionScore).map((c, i) => (
                    <tr key={i} className={isJoola ? 'joola' : ''}
                      style={{ cursor: 'pointer' }}
                      onClick={() => router.push(`/v2/influencers/player/${encodeURIComponent(brandSlug + '--' + c.player)}`)}>
                      <td style={{ fontWeight: 700, color: isJoola ? '#22c55e' : 'var(--fg)' }}>{c.player}</td>
                      <td style={{ fontSize: 12 }}>{c.productName}</td>
                      <td><span style={{ fontSize: 10, color: '#6b7280' }}>{c.channelLabel}</span></td>
                      <td className="cell-num" style={{ textAlign: 'right', fontWeight: 700 }}>{c.mentions}</td>
                      <td className="cell-num" style={{ textAlign: 'right', color: '#22c55e' }}>{c.positive > 0 ? c.positive : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                      <td className="cell-num" style={{ textAlign: 'right', color: '#ef4444' }}>{c.negative > 0 ? c.negative : <span style={{ color: 'var(--fg-4)' }}>—</span>}</td>
                      <td className="cell-num" style={{ textAlign: 'right', color: '#F5E625', fontWeight: 700 }}>{c.attentionScore > 0 ? fmt(c.attentionScore) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </>
  )
}
