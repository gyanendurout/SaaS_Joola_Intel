'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/shared/supabase'
import { Card } from '@/components/v1/Card'
import { CSSBar } from '@/components/v1/CSSBar'
import { BrandBadge } from '@/components/v1/BrandBadge'
import { DataTable } from '@/components/v1/DataTable'
import { DateFilter } from '@/components/v1/DateFilter'
import { fmt, fmtDate } from '@/lib/v1/utils'
import { type DateFilterOption, getDateRange } from '@/lib/v1/dateFilter'

export default function InstagramPage() {
  const [filter, setFilter] = useState<DateFilterOption>('thisQuarter')
  const [brands, setBrands] = useState<any[]>([])
  const [profiles, setProfiles] = useState<any[]>([])
  const [posts, setPosts] = useState<any[]>([])
  const [comments, setComments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { from, to } = getDateRange(filter)

      let postsQuery = supabase.from('ig_posts').select('*').order('posted_at', { ascending: false }).limit(300)
      if (from) postsQuery = postsQuery.gte('posted_at', from)
      if (to) postsQuery = postsQuery.lt('posted_at', to)

      const [{ data: brandsData }, { data: profilesData }, { data: postsData }, { data: commentsData }] = await Promise.all([
        supabase.from('brands').select('*'),
        supabase.from('ig_profiles_weekly').select('*').order('followers', { ascending: false }),
        postsQuery,
        supabase.from('ig_comments').select('brand_id,post_id,commenter_username,comment_text,comment_likes,posted_at').order('comment_likes', { ascending: false }).limit(20),
      ])

      setBrands(brandsData || [])
      setProfiles(profilesData || [])
      setPosts(postsData || [])
      setComments(commentsData || [])
      setLoading(false)
    }
    load()
  }, [filter])

  const brandMap = Object.fromEntries(brands.map(b => [b.id, b]))
  const seen = new Set<string>()
  const uniqueProfiles = profiles.filter(p => { if (seen.has(p.brand_id)) return false; seen.add(p.brand_id); return true })

  const postCounts: Record<string, number> = {}
  posts.forEach(p => { postCounts[p.brand_id] = (postCounts[p.brand_id] || 0) + 1 })

  const topPosts = [...posts].sort((a, b) => (b.like_count + b.comment_count) - (a.like_count + a.comment_count)).slice(0, 20)

  return (
    <div className="max-w-[1100px]">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-white">Instagram Intelligence</h1>
        <DateFilter value={filter} onChange={setFilter} />
      </div>

      {loading ? (
        <div className="text-[#e2e8f0] text-sm py-20 text-center">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <Card title="Follower Comparison">
              <CSSBar items={uniqueProfiles.map(p => ({ label: brandMap[p.brand_id]?.name || '?', value: p.followers || 0, isJoola: brandMap[p.brand_id]?.is_joola }))} />
            </Card>
            <Card title="Posts by Brand">
              <CSSBar items={brands.map(b => ({ label: b.name, value: postCounts[b.id] || 0, isJoola: b.is_joola, color: '#a855f7' })).filter(d => d.value > 0).sort((a, b) => b.value - a.value)} defaultColor="#a855f7" />
            </Card>
          </div>

          <Card title="Top Posts by Engagement" className="mb-4">
            <DataTable
              columns={[
                { key: 'brand_id', label: 'Brand', render: (id) => <BrandBadge name={brandMap[id]?.name || '?'} isJoola={brandMap[id]?.is_joola} /> },
                { key: 'caption', label: 'Caption', render: (v) => <span className="text-xs text-[#e2e8f0] max-w-[200px] block truncate">{v || '—'}</span> },
                { key: 'post_format', label: 'Format', render: (v) => <span className="text-xs text-[#e2e8f0]">{v || 'Post'}</span> },
                { key: 'like_count', label: 'Likes', render: (v) => fmt(v || 0) },
                { key: 'comment_count', label: 'Comments', render: (v) => fmt(v || 0) },
                { key: 'posted_at', label: 'Date', render: (v) => fmtDate(v) },
                { key: 'post_url', label: 'Link', render: (v) => v ? <a href={v} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline text-xs">View</a> : '—' },
              ]}
              rows={topPosts}
              isJoolaRow={(r) => brandMap[r.brand_id]?.is_joola}
            />
          </Card>

          {/* Top IG Comments — scraped audience voice */}
          {comments.length > 0 && (
            <Card title={`Top Comments (most liked)`} className="mb-4">
              <p className="text-[12px] mb-3" style={{ color: '#cbd5e1' }}>
                Most-liked Instagram comments across all tracked brands. Full feed:{' '}
                <a href="/comments" className="text-[#818cf8] hover:underline">Comments page →</a>
              </p>
              <div className="space-y-2">
                {comments.slice(0, 10).map((c, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-2.5 rounded-xl"
                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    <BrandBadge name={brandMap[c.brand_id]?.name || '?'} isJoola={brandMap[c.brand_id]?.is_joola} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] truncate" style={{ color: '#e2e8f0' }}>
                        <span className="font-semibold" style={{ color: '#a855f7' }}>@{c.commenter_username || 'anon'}</span>{' '}
                        <span style={{ color: '#cbd5e1' }}>{c.comment_text || '—'}</span>
                      </p>
                    </div>
                    {(c.comment_likes || 0) > 0 && (
                      <span className="text-[11px] font-bold flex-shrink-0" style={{ color: '#f59e0b' }}>
                        ♥ {fmt(c.comment_likes)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card title="Recent Posts Feed">
            {posts.length === 0 ? (
              <p className="text-[#e2e8f0] text-sm py-6 text-center">No posts found for this period.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[600px] overflow-y-auto pr-1">
                {posts.slice(0, 24).map(post => (
                  <div key={post.id} className="bg-white/[0.02] border border-[#2a2a38] rounded-lg p-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-semibold text-[#22c55e]">@{post.handle || brandMap[post.brand_id]?.name}</span>
                      <span className="text-xs text-[#e2e8f0]">{fmtDate(post.posted_at)}</span>
                    </div>
                    <p className="text-xs text-[#e2e8f0] line-clamp-2 mb-3 leading-relaxed">{post.caption || 'No caption'}</p>
                    <div className="flex gap-4 text-xs text-[#e2e8f0]">
                      <span>♥ <strong className="text-white">{fmt(post.like_count || 0)}</strong></span>
                      <span>💬 <strong className="text-white">{fmt(post.comment_count || 0)}</strong></span>
                      {post.view_count > 0 && <span>▶ <strong className="text-white">{fmt(post.view_count)}</strong></span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
