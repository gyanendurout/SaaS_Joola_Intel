'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/shared/supabase'
import { Card } from '@/components/v1/Card'
import { KPICard } from '@/components/v1/KPICard'
import { CSSBar } from '@/components/v1/CSSBar'
import { BrandBadge } from '@/components/v1/BrandBadge'
import { fmt, fmtDate } from '@/lib/v1/utils'

type IgComment = {
  id: string
  brand_id: string
  post_id: string
  commenter_username: string | null
  comment_text: string | null
  comment_likes: number | null
  posted_at: string | null
}

type YtComment = {
  id: string
  brand_id: string
  video_id: string
  commenter_username: string | null
  comment_text: string | null
  comment_likes: number | null
  posted_at: string | null
}

type AnyComment = (IgComment | YtComment) & { platform: 'instagram' | 'youtube' }

function PlatformPill({ p }: { p: 'instagram' | 'youtube' }) {
  const ig = p === 'instagram'
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
      style={{
        background: ig ? 'rgba(232,62,140,0.10)' : 'rgba(234,67,53,0.10)',
        color: ig ? '#e83e8c' : '#e57368',
        border: `1px solid ${ig ? 'rgba(232,62,140,0.22)' : 'rgba(234,67,53,0.22)'}`,
      }}
    >
      <span className="w-1 h-1 rounded-full" style={{ background: ig ? '#e83e8c' : '#e57368' }} />
      {ig ? 'IG' : 'YT'}
    </span>
  )
}

function CommentCard({ c, brandName, isJoola }: { c: AnyComment; brandName: string; isJoola?: boolean }) {
  return (
    <div
      className="rounded-2xl p-3.5 flex flex-col gap-2 transition-all duration-200 hover:scale-[1.005]"
      style={{
        background: 'rgba(10,15,25,0.8)',
        backdropFilter: 'blur(16px)',
        border: `1px solid ${isJoola ? 'rgba(34,197,94,0.20)' : 'rgba(255,255,255,0.07)'}`,
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <PlatformPill p={c.platform} />
          <BrandBadge name={brandName} isJoola={isJoola} />
        </div>
        {c.posted_at && (
          <span className="text-[10px]" style={{ color: '#94a3b8' }}>{fmtDate(c.posted_at)}</span>
        )}
      </div>
      <p className="text-[12px] leading-snug line-clamp-4" style={{ color: '#e2e8f0' }}>
        {c.comment_text || <span className="italic text-[#94a3b8]">No text</span>}
      </p>
      <div className="flex items-center justify-between pt-1 mt-auto">
        <span className="text-[11px] font-semibold truncate" style={{ color: '#cbd5e1' }}>
          @{c.commenter_username || 'anonymous'}
        </span>
        {(c.comment_likes || 0) > 0 && (
          <span className="text-[10px] font-bold" style={{ color: '#f59e0b' }}>
            ♥ {fmt(c.comment_likes!)}
          </span>
        )}
      </div>
    </div>
  )
}

export default function CommentsPage() {
  const [brands, setBrands] = useState<any[]>([])
  const [ig, setIg] = useState<IgComment[]>([])
  const [yt, setYt] = useState<YtComment[]>([])
  const [loading, setLoading] = useState(true)
  const [filterBrand, setFilterBrand] = useState('all')
  const [filterPlatform, setFilterPlatform] = useState<'all' | 'instagram' | 'youtube'>('all')
  const [searchQ, setSearchQ] = useState('')
  const [sortKey, setSortKey] = useState<'recent' | 'likes'>('likes')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      supabase.from('brands').select('*'),
      supabase
        .from('ig_comments')
        .select('id,brand_id,post_id,commenter_username,comment_text,comment_likes,posted_at')
        .order('comment_likes', { ascending: false })
        .limit(1500),
      supabase
        .from('yt_comments')
        .select('id,brand_id,video_id,commenter_username,comment_text,comment_likes,posted_at')
        .order('comment_likes', { ascending: false })
        .limit(800),
    ]).then(([{ data: b }, { data: i }, { data: y }]) => {
      setBrands(b || [])
      setIg((i as IgComment[]) || [])
      setYt((y as YtComment[]) || [])
      setLoading(false)
    })
  }, [])

  const brandMap = Object.fromEntries(brands.map((b) => [b.id, b]))

  const combined: AnyComment[] = useMemo(
    () => [
      ...ig.map((c) => ({ ...c, platform: 'instagram' as const })),
      ...yt.map((c) => ({ ...c, platform: 'youtube' as const })),
    ],
    [ig, yt],
  )

  const stats = useMemo(() => {
    const total = combined.length
    const totalLikes = combined.reduce((s, c) => s + (c.comment_likes || 0), 0)
    const byBrand = combined.reduce<Record<string, number>>((acc, c) => {
      acc[c.brand_id] = (acc[c.brand_id] || 0) + 1
      return acc
    }, {})
    const byUser = combined.reduce<Record<string, number>>((acc, c) => {
      const u = c.commenter_username || 'anonymous'
      acc[u] = (acc[u] || 0) + 1
      return acc
    }, {})
    const topUser = Object.entries(byUser).sort((a, b) => b[1] - a[1])[0]
    return { total, igCount: ig.length, ytCount: yt.length, totalLikes, byBrand, byUser, topUser }
  }, [combined, ig, yt])

  const brandsWithComments = useMemo(
    () => brands.filter((b) => combined.some((c) => c.brand_id === b.id)),
    [brands, combined],
  )

  const filtered = useMemo(() => {
    let out = combined
    if (filterBrand !== 'all') out = out.filter((c) => c.brand_id === filterBrand)
    if (filterPlatform !== 'all') out = out.filter((c) => c.platform === filterPlatform)
    if (searchQ) {
      const q = searchQ.toLowerCase()
      out = out.filter(
        (c) =>
          (c.comment_text || '').toLowerCase().includes(q) ||
          (c.commenter_username || '').toLowerCase().includes(q),
      )
    }
    if (sortKey === 'likes') {
      out = [...out].sort((a, b) => (b.comment_likes || 0) - (a.comment_likes || 0))
    } else {
      out = [...out].sort((a, b) => {
        const da = new Date(a.posted_at || 0).getTime()
        const db = new Date(b.posted_at || 0).getTime()
        return db - da
      })
    }
    return out
  }, [combined, filterBrand, filterPlatform, searchQ, sortKey])

  const brandBarItems = useMemo(
    () =>
      brandsWithComments
        .map((b) => ({ label: b.name, value: stats.byBrand[b.id] || 0, isJoola: b.is_joola }))
        .sort((a, b) => b.value - a.value),
    [brandsWithComments, stats],
  )

  const topUsers = useMemo(
    () => Object.entries(stats.byUser).sort((a, b) => b[1] - a[1]).slice(0, 10),
    [stats],
  )

  return (
    <div className="max-w-[1400px] animate-fade-up">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full"
            style={{ background: 'rgba(232,62,140,0.10)', color: '#e83e8c', border: '1px solid rgba(232,62,140,0.22)' }}
          >
            Audience Voice
          </span>
        </div>
        <h1 className="text-[32px] font-black tracking-tight leading-tight mb-1">
          <span className="text-gradient-white">Comments </span>
          <span className="text-gradient-green">Intelligence</span>
        </h1>
        <p className="text-[14px]" style={{ color: '#cbd5e1' }}>
          Top IG & YT comments across {brandsWithComments.length} brands · {fmt(stats.total)} comments captured
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <div className="w-8 h-8 rounded-full border-2 border-[#e83e8c] border-t-transparent animate-spin mx-auto mb-4" />
            <p className="text-[13px]" style={{ color: '#cbd5e1' }}>Loading comments…</p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <KPICard label="Total Comments" value={fmt(stats.total)} accent />
            <KPICard label="Instagram" value={fmt(stats.igCount)} color="indigo" />
            <KPICard label="YouTube" value={fmt(stats.ytCount)} color="amber" />
            <KPICard
              label="Top Commenter"
              value={stats.topUser ? '@' + stats.topUser[0] : '—'}
              sub={stats.topUser ? `${stats.topUser[1]} comments` : ''}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card title="Comments by Brand" className="md:col-span-2">
              {brandBarItems.length === 0 ? (
                <p className="text-[12px] py-6 text-center" style={{ color: '#cbd5e1' }}>No comments yet.</p>
              ) : (
                <CSSBar items={brandBarItems} defaultColor="#e83e8c" />
              )}
            </Card>

            <Card title="Top Commenters">
              {topUsers.length === 0 ? (
                <p className="text-[12px] py-6 text-center" style={{ color: '#cbd5e1' }}>No users.</p>
              ) : (
                <div className="space-y-2">
                  {topUsers.map(([u, n]) => (
                    <div
                      key={u}
                      className="flex items-center justify-between p-2 rounded-lg"
                      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
                    >
                      <span className="text-[11px] font-semibold truncate" style={{ color: '#e2e8f0' }}>
                        @{u}
                      </span>
                      <span className="text-[12px] font-bold stat-number" style={{ color: '#e2e8f0' }}>
                        {n}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Filter bar */}
          <div
            className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-2xl"
            style={{ background: 'rgba(10,15,25,0.6)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <input
              type="text"
              placeholder="Search comment text or @user…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="bg-[#0f0f13] border border-[#2a2a38] text-white text-xs rounded-lg px-3 py-1.5 w-64 focus:outline-none focus:border-[#22c55e]/50 placeholder-[#94a3b8]"
            />
            <select
              value={filterBrand}
              onChange={(e) => setFilterBrand(e.target.value)}
              className="bg-[#0f0f13] border border-[#2a2a38] text-[#e2e8f0] text-xs rounded-lg px-3 py-1.5 focus:outline-none"
            >
              <option value="all">All Brands ({brandsWithComments.length})</option>
              {brandsWithComments.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({stats.byBrand[b.id] || 0})
                </option>
              ))}
            </select>
            <select
              value={filterPlatform}
              onChange={(e) => setFilterPlatform(e.target.value as any)}
              className="bg-[#0f0f13] border border-[#2a2a38] text-[#e2e8f0] text-xs rounded-lg px-3 py-1.5 focus:outline-none"
            >
              <option value="all">All Platforms</option>
              <option value="instagram">Instagram ({stats.igCount})</option>
              <option value="youtube">YouTube ({stats.ytCount})</option>
            </select>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as any)}
              className="bg-[#0f0f13] border border-[#2a2a38] text-[#e2e8f0] text-xs rounded-lg px-3 py-1.5 focus:outline-none"
            >
              <option value="likes">Most Liked</option>
              <option value="recent">Most Recent</option>
            </select>
            {(searchQ || filterBrand !== 'all' || filterPlatform !== 'all') && (
              <button
                onClick={() => {
                  setSearchQ('')
                  setFilterBrand('all')
                  setFilterPlatform('all')
                }}
                className="text-xs px-3 py-1.5 rounded-lg bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/20 transition-colors cursor-pointer"
              >
                Clear filters
              </button>
            )}
            <span className="ml-auto text-[11px]" style={{ color: '#94a3b8' }}>
              <span className="font-bold text-white">{filtered.length}</span> shown
            </span>
          </div>

          {filtered.length === 0 ? (
            <Card>
              <p className="text-[12px] py-10 text-center" style={{ color: '#cbd5e1' }}>
                No comments match the current filters.
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.slice(0, 300).map((c) => (
                <CommentCard
                  key={c.id}
                  c={c}
                  brandName={brandMap[c.brand_id]?.name || '?'}
                  isJoola={brandMap[c.brand_id]?.is_joola}
                />
              ))}
            </div>
          )}
          {filtered.length > 300 && (
            <p className="text-[11px] mt-4 text-center" style={{ color: '#94a3b8' }}>
              Showing first 300 of {filtered.length} comments. Narrow the filters to see more.
            </p>
          )}
        </>
      )}
    </div>
  )
}
