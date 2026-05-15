'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/shared/supabase'
import { Card } from '@/components/v1/Card'
import { KPICard } from '@/components/v1/KPICard'
import { CSSBar } from '@/components/v1/CSSBar'
import { BrandBadge } from '@/components/v1/BrandBadge'
import { DataTable } from '@/components/v1/DataTable'
import { fmt, fmtDate } from '@/lib/v1/utils'

type Influencer = {
  id: string
  name: string
  brand_id: string
  type: string | null
  instagram_handle: string | null
  follower_count_ig: number | null
  contract_type: string | null
  is_active: boolean
}

type InfPost = {
  id: string
  influencer_id: string
  brand_id: string
  platform: string | null
  post_url: string | null
  caption: string | null
  like_count: number | null
  comment_count: number | null
  view_count: number | null
  posted_at: string | null
}

type InfSnapshot = {
  id: string
  influencer_id: string
  brand_id: string
  follower_count_ig: number | null
  follower_count_yt: number | null
  week_number: number | null
  year: number | null
  scraped_at: string | null
}

export default function InfluencersPage() {
  const [brands, setBrands] = useState<any[]>([])
  const [influencers, setInfluencers] = useState<Influencer[]>([])
  const [posts, setPosts] = useState<InfPost[]>([])
  const [snapshots, setSnapshots] = useState<InfSnapshot[]>([])
  const [loading, setLoading] = useState(true)

  // Filters (roster)
  const [filterBrand, setFilterBrand] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterType, setFilterType] = useState('all')

  // Filters (posts)
  const [postBrand, setPostBrand] = useState('all')
  const [postSort, setPostSort] = useState<'likes' | 'comments' | 'recent'>('likes')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      supabase.from('brands').select('*'),
      supabase.from('influencers').select('*').order('follower_count_ig', { ascending: false }),
      supabase
        .from('influencer_posts')
        .select('id,influencer_id,brand_id,platform,post_url,caption,like_count,comment_count,view_count,posted_at')
        .order('like_count', { ascending: false })
        .limit(500),
      supabase
        .from('influencer_snapshots')
        .select('id,influencer_id,brand_id,follower_count_ig,follower_count_yt,week_number,year,scraped_at')
        .order('scraped_at', { ascending: false })
        .limit(500),
    ]).then(([{ data: b }, { data: i }, { data: p }, { data: s }]) => {
      setBrands(b || [])
      setInfluencers((i as Influencer[]) || [])
      setPosts((p as InfPost[]) || [])
      setSnapshots((s as InfSnapshot[]) || [])
      setLoading(false)
    })
  }, [])

  const brandMap = Object.fromEntries(brands.map((b) => [b.id, b]))
  const infMap = Object.fromEntries(influencers.map((i) => [i.id, i]))

  const active = influencers.filter((i) => i.is_active)
  const infByBrand: Record<string, number> = {}
  active.forEach((i) => { infByBrand[i.brand_id] = (infByBrand[i.brand_id] || 0) + 1 })

  const stats = useMemo(() => {
    const totalActive = active.length
    const totalFollowers = influencers.reduce((s, i) => s + (i.follower_count_ig || 0), 0)
    const totalPosts = posts.length
    const totalLikes = posts.reduce((s, p) => s + (p.like_count || 0), 0)
    const totalComments = posts.reduce((s, p) => s + (p.comment_count || 0), 0)
    const avgEng = totalPosts ? (totalLikes + totalComments) / totalPosts : 0
    return { totalActive, totalFollowers, totalPosts, totalLikes, totalComments, avgEng }
  }, [influencers, active, posts])

  // Engagement per influencer
  const infEngagement = useMemo(() => {
    const map: Record<string, { likes: number; comments: number; posts: number }> = {}
    posts.forEach((p) => {
      if (!map[p.influencer_id]) map[p.influencer_id] = { likes: 0, comments: 0, posts: 0 }
      map[p.influencer_id].likes += p.like_count || 0
      map[p.influencer_id].comments += p.comment_count || 0
      map[p.influencer_id].posts++
    })
    return map
  }, [posts])

  const topPerformers = useMemo(
    () =>
      influencers
        .map((i) => {
          const e = infEngagement[i.id] || { likes: 0, comments: 0, posts: 0 }
          const avgLikes = e.posts ? e.likes / e.posts : 0
          const avgComments = e.posts ? e.comments / e.posts : 0
          const engRate = (i.follower_count_ig || 0) > 0
            ? ((avgLikes + avgComments) / (i.follower_count_ig as number)) * 100
            : 0
          return { ...i, avgLikes, avgComments, engRate, postCount: e.posts, totalLikes: e.likes }
        })
        .filter((r) => r.postCount > 0)
        .sort((a, b) => b.engRate - a.engRate),
    [influencers, infEngagement],
  )

  const typeOptions = useMemo(
    () => Array.from(new Set(influencers.map((i) => i.type).filter(Boolean))).sort() as string[],
    [influencers],
  )
  const brandOptions = useMemo(
    () => brands.filter((b) => influencers.some((i) => i.brand_id === b.id)),
    [brands, influencers],
  )

  const filteredInfluencers = useMemo(
    () =>
      influencers.filter((i) => {
        if (filterBrand !== 'all' && i.brand_id !== filterBrand) return false
        if (filterStatus === 'active' && !i.is_active) return false
        if (filterStatus === 'inactive' && i.is_active) return false
        if (filterType !== 'all' && i.type !== filterType) return false
        return true
      }),
    [influencers, filterBrand, filterStatus, filterType],
  )

  const filteredPosts = useMemo(() => {
    let out = posts
    if (postBrand !== 'all') out = out.filter((p) => p.brand_id === postBrand)
    if (postSort === 'likes') out = [...out].sort((a, b) => (b.like_count || 0) - (a.like_count || 0))
    else if (postSort === 'comments') out = [...out].sort((a, b) => (b.comment_count || 0) - (a.comment_count || 0))
    else out = [...out].sort((a, b) => new Date(b.posted_at || 0).getTime() - new Date(a.posted_at || 0).getTime())
    return out
  }, [posts, postBrand, postSort])

  return (
    <div className="max-w-[1400px] animate-fade-up">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full"
            style={{ background: 'rgba(168,85,247,0.10)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.22)' }}
          >
            Ambassador Network
          </span>
        </div>
        <h1 className="text-[32px] font-black tracking-tight leading-tight mb-1">
          <span className="text-gradient-white">Influencer </span>
          <span className="text-gradient-green">Map</span>
        </h1>
        <p className="text-[14px]" style={{ color: '#cbd5e1' }}>
          {stats.totalActive} active athletes · {fmt(stats.totalFollowers)} combined IG followers · {fmt(stats.totalPosts)} posts tracked
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <div className="w-8 h-8 rounded-full border-2 border-[#a855f7] border-t-transparent animate-spin mx-auto mb-4" />
            <p className="text-[13px]" style={{ color: '#cbd5e1' }}>Loading roster…</p>
          </div>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <KPICard label="Active Athletes" value={stats.totalActive} accent />
            <KPICard label="Combined IG Followers" value={fmt(stats.totalFollowers)} color="indigo" />
            <KPICard label="Posts Tracked" value={fmt(stats.totalPosts)} color="amber" />
            <KPICard label="Total Likes" value={fmt(stats.totalLikes)} color="green" />
            <KPICard label="Avg Eng / Post" value={fmt(Math.round(stats.avgEng))} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <Card title="Top Followers (IG)">
              <CSSBar
                items={[...influencers]
                  .filter((i) => i.follower_count_ig)
                  .sort((a, b) => (b.follower_count_ig || 0) - (a.follower_count_ig || 0))
                  .slice(0, 15)
                  .map((i) => ({
                    label: i.name,
                    value: i.follower_count_ig || 0,
                    isJoola: brandMap[i.brand_id]?.is_joola,
                  }))}
                defaultColor="#a855f7"
              />
            </Card>

            <Card title="Influencers per Brand">
              <CSSBar
                items={brands
                  .map((b) => ({
                    label: b.name,
                    value: infByBrand[b.id] || 0,
                    isJoola: b.is_joola,
                  }))
                  .filter((d) => d.value > 0)
                  .sort((a, b) => b.value - a.value)}
                defaultColor="#06b6d4"
              />
            </Card>
          </div>

          {/* Top Performers — engagement-rate-driven */}
          {topPerformers.length > 0 && (
            <Card title="Top Performers — Highest Engagement Rate" className="mb-4" accent="green">
              <DataTable
                columns={[
                  {
                    key: 'name',
                    label: 'Influencer',
                    render: (v, r) => (
                      <div className="flex flex-col">
                        <span className="font-semibold text-white">{v}</span>
                        {r.instagram_handle && (
                          <a href={`https://instagram.com/${r.instagram_handle}`} target="_blank" rel="noreferrer"
                            className="text-[10px] text-[#818cf8] hover:underline">@{r.instagram_handle}</a>
                        )}
                      </div>
                    ),
                  },
                  {
                    key: 'brand_id',
                    label: 'Brand',
                    render: (id) => <BrandBadge name={brandMap[id]?.name || '?'} isJoola={brandMap[id]?.is_joola} />,
                    sortValue: (r) => brandMap[r.brand_id]?.name || '',
                  },
                  { key: 'follower_count_ig', label: 'Followers', render: (v) => <span className="stat-number">{fmt(v || 0)}</span> },
                  { key: 'postCount', label: 'Posts' },
                  { key: 'avgLikes', label: 'Avg Likes', render: (v) => <span className="stat-number">{fmt(Math.round(v))}</span> },
                  { key: 'avgComments', label: 'Avg Comments', render: (v) => <span className="stat-number">{fmt(Math.round(v))}</span> },
                  {
                    key: 'engRate',
                    label: 'Eng Rate',
                    render: (v) => (
                      <span
                        className="stat-number font-bold"
                        style={{ color: v > 5 ? '#22c55e' : v > 1 ? '#f59e0b' : '#cbd5e1' }}
                      >
                        {v.toFixed(2)}%
                      </span>
                    ),
                  },
                ]}
                rows={topPerformers.slice(0, 20)}
                isJoolaRow={(r) => brandMap[r.brand_id]?.is_joola}
              />
            </Card>
          )}

          {/* Recent influencer posts */}
          {posts.length > 0 && (
            <Card title={`Influencer Posts (${filteredPosts.length})`} className="mb-4" accent="indigo">
              <div className="flex flex-wrap items-center gap-2 mb-4 pb-3 border-b border-white/[0.06]">
                <select
                  value={postBrand}
                  onChange={(e) => setPostBrand(e.target.value)}
                  className="bg-[#0f0f13] border border-[#2a2a38] text-[#e2e8f0] text-xs rounded-lg px-3 py-1.5 focus:outline-none"
                >
                  <option value="all">All Brands</option>
                  {brandOptions.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <select
                  value={postSort}
                  onChange={(e) => setPostSort(e.target.value as any)}
                  className="bg-[#0f0f13] border border-[#2a2a38] text-[#e2e8f0] text-xs rounded-lg px-3 py-1.5 focus:outline-none"
                >
                  <option value="likes">Most Liked</option>
                  <option value="comments">Most Commented</option>
                  <option value="recent">Most Recent</option>
                </select>
                <span className="ml-auto text-[11px]" style={{ color: '#94a3b8' }}>
                  Top by {postSort === 'likes' ? 'likes' : postSort === 'comments' ? 'comments' : 'date'}
                </span>
              </div>
              <DataTable
                columns={[
                  {
                    key: 'influencer_id',
                    label: 'Influencer',
                    render: (id) => <span className="font-semibold text-white">{infMap[id]?.name || '?'}</span>,
                    sortValue: (r) => infMap[r.influencer_id]?.name || '',
                  },
                  {
                    key: 'brand_id',
                    label: 'Brand',
                    render: (id) => <BrandBadge name={brandMap[id]?.name || '?'} isJoola={brandMap[id]?.is_joola} />,
                  },
                  { key: 'caption', label: 'Caption', render: (v) => <span className="text-[11px] truncate block max-w-[260px]" style={{ color: '#cbd5e1' }}>{v || '—'}</span> },
                  { key: 'like_count', label: 'Likes', render: (v) => <span className="stat-number">{fmt(v || 0)}</span> },
                  { key: 'comment_count', label: 'Comments', render: (v) => <span className="stat-number">{fmt(v || 0)}</span> },
                  { key: 'view_count', label: 'Views', render: (v) => v ? <span className="stat-number">{fmt(v)}</span> : '—' },
                  { key: 'posted_at', label: 'Date', render: (v) => <span className="text-[11px]" style={{ color: '#94a3b8' }}>{fmtDate(v)}</span> },
                  {
                    key: 'post_url',
                    label: 'Link',
                    render: (v) => v ? (
                      <a href={v} target="_blank" rel="noreferrer" className="text-[11px] text-[#818cf8] hover:underline">View</a>
                    ) : '—',
                  },
                ]}
                rows={filteredPosts.slice(0, 100)}
                isJoolaRow={(r) => brandMap[r.brand_id]?.is_joola}
              />
              {filteredPosts.length > 100 && (
                <p className="text-[11px] mt-3 text-center" style={{ color: '#94a3b8' }}>
                  Showing top 100 of {filteredPosts.length}.
                </p>
              )}
            </Card>
          )}

          {/* Roster table */}
          <Card title={`Full Roster (${filteredInfluencers.length}${filteredInfluencers.length !== influencers.length ? ` / ${influencers.length}` : ''} athletes)`} className="mb-4">
            <div className="flex flex-wrap gap-2 mb-4 pb-4 border-b border-[#2a2a38]">
              <select
                value={filterBrand}
                onChange={(e) => setFilterBrand(e.target.value)}
                className="bg-[#0f0f13] border border-[#2a2a38] text-[#e2e8f0] text-xs rounded-lg px-3 py-1.5 focus:outline-none"
              >
                <option value="all">All Brands</option>
                {brandOptions.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-[#0f0f13] border border-[#2a2a38] text-[#e2e8f0] text-xs rounded-lg px-3 py-1.5 focus:outline-none"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              {typeOptions.length > 0 && (
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="bg-[#0f0f13] border border-[#2a2a38] text-[#e2e8f0] text-xs rounded-lg px-3 py-1.5 focus:outline-none"
                >
                  <option value="all">All Types</option>
                  {typeOptions.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              )}
              {(filterBrand !== 'all' || filterStatus !== 'all' || filterType !== 'all') && (
                <button
                  onClick={() => { setFilterBrand('all'); setFilterStatus('all'); setFilterType('all') }}
                  className="text-xs px-3 py-1.5 rounded-lg bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/20 transition-colors"
                >
                  Clear filters
                </button>
              )}
            </div>

            {filteredInfluencers.length === 0 ? (
              <p className="text-xs text-[#e2e8f0] py-8 text-center">No influencers match the current filters.</p>
            ) : (
              <DataTable
                columns={[
                  { key: 'name', label: 'Name', render: (v) => <span className="font-semibold text-white">{v}</span> },
                  {
                    key: 'brand_id',
                    label: 'Brand',
                    render: (id) => <BrandBadge name={brandMap[id]?.name || '?'} isJoola={brandMap[id]?.is_joola} />,
                    sortValue: (r) => brandMap[r.brand_id]?.name || '',
                  },
                  { key: 'type', label: 'Type', render: (v) => <span className="text-xs text-[#e2e8f0]">{v || '—'}</span> },
                  {
                    key: 'instagram_handle',
                    label: 'IG Handle',
                    render: (v) => v ? (
                      <a href={`https://instagram.com/${v}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline text-xs">
                        @{v}
                      </a>
                    ) : '—',
                  },
                  { key: 'follower_count_ig', label: 'IG Followers', render: (v) => fmt(v || 0) },
                  {
                    key: 'postCount',
                    label: 'Posts',
                    render: (_, r) => {
                      const n = infEngagement[r.id]?.posts || 0
                      return n > 0 ? <span className="stat-number font-semibold" style={{ color: '#22c55e' }}>{n}</span> : <span className="text-[#94a3b8]">—</span>
                    },
                  },
                  { key: 'contract_type', label: 'Contract', render: (v) => <span className="text-xs text-[#e2e8f0]">{v || '—'}</span> },
                  {
                    key: 'is_active',
                    label: 'Status',
                    render: (v) => (
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${v ? 'bg-[#22c55e]/15 text-[#22c55e]' : 'bg-[#ef4444]/15 text-[#ef4444]'}`}>
                        {v ? 'Active' : 'Inactive'}
                      </span>
                    ),
                  },
                ]}
                rows={filteredInfluencers}
                isJoolaRow={(r) => brandMap[r.brand_id]?.is_joola}
              />
            )}
          </Card>
        </>
      )}
    </div>
  )
}
