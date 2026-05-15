'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/shared/supabase'
import { Card } from '@/components/v1/Card'
import { CSSBar } from '@/components/v1/CSSBar'
import { BrandBadge } from '@/components/v1/BrandBadge'
import { DataTable } from '@/components/v1/DataTable'
import { DateFilter } from '@/components/v1/DateFilter'
import { fmtDate } from '@/lib/v1/utils'
import { type DateFilterOption, getDateRange } from '@/lib/v1/dateFilter'

export default function RedditPage() {
  const [filter, setFilter] = useState<DateFilterOption>('thisQuarter')
  const [brands, setBrands] = useState<any[]>([])
  const [mentions, setMentions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { from, to } = getDateRange(filter)

      let mentionsQuery = supabase.from('reddit_mentions').select('*').order('upvotes', { ascending: false }).limit(300)
      if (from) mentionsQuery = mentionsQuery.gte('posted_at', from)
      if (to) mentionsQuery = mentionsQuery.lt('posted_at', to)

      const [{ data: brandsData }, { data: mentionsData }] = await Promise.all([
        supabase.from('brands').select('*'),
        mentionsQuery,
      ])

      setBrands(brandsData || [])
      setMentions(mentionsData || [])
      setLoading(false)
    }
    load()
  }, [filter])

  const brandMap = Object.fromEntries(brands.map(b => [b.id, b]))
  const mentionCounts: Record<string, number> = {}
  mentions.forEach(r => { mentionCounts[r.brand_id] = (mentionCounts[r.brand_id] || 0) + 1 })

  return (
    <div className="max-w-[1100px]">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-white">Reddit Pulse</h1>
        <DateFilter value={filter} onChange={setFilter} />
      </div>

      {loading ? (
        <div className="text-[#e2e8f0] text-sm py-20 text-center">Loading...</div>
      ) : (
        <>
          <Card title="Mentions per Brand" className="mb-4">
            {mentions.length === 0 ? (
              <p className="text-[#e2e8f0] text-sm py-4 text-center">No mentions found for this period.</p>
            ) : (
              <CSSBar items={brands.map(b => ({ label: b.name, value: mentionCounts[b.id] || 0, isJoola: b.is_joola, color: '#f97316' })).filter(d => d.value > 0).sort((a, b) => b.value - a.value)} defaultColor="#f97316" />
            )}
          </Card>

          <Card title="Latest Reddit Mentions">
            {mentions.length === 0 ? (
              <p className="text-[#e2e8f0] text-sm py-6 text-center">No mentions found for this period.</p>
            ) : (
              <DataTable
                columns={[
                  { key: 'brand_id', label: 'Brand', render: (id) => <BrandBadge name={brandMap[id]?.name || '?'} isJoola={brandMap[id]?.is_joola} /> },
                  { key: 'post_title', label: 'Title', render: (v) => <span className="text-xs text-[#e2e8f0] max-w-[280px] block truncate">{v || '—'}</span> },
                  { key: 'subreddit', label: 'Subreddit', render: (v) => <span className="text-xs text-[#e2e8f0]">{v || 'r/pickleball'}</span> },
                  { key: 'upvotes', label: 'Upvotes' },
                  { key: 'author', label: 'Author', render: (v) => <span className="text-xs text-[#e2e8f0]">{v || '—'}</span> },
                  { key: 'posted_at', label: 'Date', render: (v) => fmtDate(v) },
                  { key: 'post_url', label: 'Link', render: (v) => v ? <a href={v} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline text-xs">View</a> : '—' },
                ]}
                rows={mentions}
                isJoolaRow={(r) => brandMap[r.brand_id]?.is_joola}
              />
            )}
          </Card>
        </>
      )}
    </div>
  )
}
