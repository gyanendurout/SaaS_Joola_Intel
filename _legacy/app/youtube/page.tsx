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

export default function YouTubePage() {
  const [filter, setFilter] = useState<DateFilterOption>('thisQuarter')
  const [brands, setBrands] = useState<any[]>([])
  const [videos, setVideos] = useState<any[]>([])
  const [channels, setChannels] = useState<any[]>([])
  const [comments, setComments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { from, to } = getDateRange(filter)

      let videosQuery = supabase.from('yt_videos').select('*').order('view_count', { ascending: false }).limit(500)
      if (from) videosQuery = videosQuery.gte('published_at', from)
      if (to) videosQuery = videosQuery.lt('published_at', to)

      const [{ data: brandsData }, { data: videosData }, { data: channelsData }, { data: commentsData }] = await Promise.all([
        supabase.from('brands').select('*'),
        videosQuery,
        supabase.from('yt_channel_weekly').select('*'),
        supabase.from('yt_comments').select('brand_id,video_id,commenter_username,comment_text,comment_likes,posted_at').order('comment_likes', { ascending: false }).limit(20),
      ])

      setBrands(brandsData || [])
      setVideos(videosData || [])
      setChannels(channelsData || [])
      setComments(commentsData || [])
      setLoading(false)
    }
    load()
  }, [filter])

  const brandMap = Object.fromEntries(brands.map(b => [b.id, b]))

  const vidCounts: Record<string, number> = {}
  const viewCounts: Record<string, number> = {}
  videos.forEach(v => {
    vidCounts[v.brand_id] = (vidCounts[v.brand_id] || 0) + 1
    viewCounts[v.brand_id] = (viewCounts[v.brand_id] || 0) + (v.view_count || 0)
  })

  const subMap: Record<string, number> = {}
  channels.forEach(ch => { subMap[ch.brand_id] = ch.subscribers || 0 })

  return (
    <div className="max-w-[1100px]">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-white">YouTube Intelligence</h1>
        <DateFilter value={filter} onChange={setFilter} />
      </div>

      {loading ? (
        <div className="text-[#e2e8f0] text-sm py-20 text-center">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <Card title="Videos per Brand">
              <CSSBar items={brands.map(b => ({ label: b.name, value: vidCounts[b.id] || 0, isJoola: b.is_joola, color: '#f59e0b' })).filter(d => d.value > 0).sort((a, b) => b.value - a.value)} defaultColor="#f59e0b" />
            </Card>
            <Card title="Total Views per Brand">
              <CSSBar items={brands.map(b => ({ label: b.name, value: viewCounts[b.id] || 0, isJoola: b.is_joola, color: '#ef4444' })).filter(d => d.value > 0).sort((a, b) => b.value - a.value)} defaultColor="#ef4444" />
            </Card>
          </div>

          <Card title="YouTube Subscribers by Brand" className="mb-4">
            <p className="text-xs text-[#e2e8f0] mb-3">Current snapshot — not affected by date filter.</p>
            <CSSBar items={brands.map(b => ({ label: b.name, value: subMap[b.id] || 0, isJoola: b.is_joola, color: '#06b6d4' })).filter(d => d.value > 0).sort((a, b) => b.value - a.value)} defaultColor="#06b6d4" />
          </Card>

          {/* Top YT Comments — scraped audience voice */}
          {comments.length > 0 && (
            <Card title="Top Comments (most liked)" className="mb-4">
              <p className="text-[12px] mb-3" style={{ color: '#cbd5e1' }}>
                Most-liked YouTube comments across all tracked brands. Full feed:{' '}
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
                        <span className="font-semibold" style={{ color: '#ef4444' }}>{c.commenter_username || 'anon'}</span>{' '}
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

          <Card title="Top Videos by Views">
            {videos.length === 0 ? (
              <p className="text-[#e2e8f0] text-sm py-6 text-center">No videos found for this period.</p>
            ) : (
              <DataTable
                columns={[
                  { key: 'brand_id', label: 'Brand', render: (id) => <BrandBadge name={brandMap[id]?.name || '?'} isJoola={brandMap[id]?.is_joola} /> },
                  { key: 'title', label: 'Title', render: (v) => <span className="text-xs text-[#e2e8f0] max-w-[260px] block truncate">{v || '—'}</span> },
                  { key: 'view_count', label: 'Views', render: (v) => fmt(v || 0) },
                  { key: 'like_count', label: 'Likes', render: (v) => fmt(v || 0) },
                  { key: 'comment_count', label: 'Comments', render: (v) => fmt(v || 0) },
                  { key: 'published_at', label: 'Published', render: (v) => fmtDate(v) },
                  { key: 'video_url', label: 'Link', render: (v) => v ? <a href={v} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline text-xs">Watch</a> : '—' },
                ]}
                rows={videos.slice(0, 25)}
                isJoolaRow={(r) => brandMap[r.brand_id]?.is_joola}
              />
            )}
          </Card>
        </>
      )}
    </div>
  )
}
