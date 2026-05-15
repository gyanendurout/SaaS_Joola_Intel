'use client'

import { useState } from 'react'
import { type MarketIntelItem } from '@/types/market'

interface Props {
  item: MarketIntelItem
  contentType: 'blog_post' | 'instagram_post'
  onClose: () => void
}

interface GeneratedBlog {
  title: string
  body: string
  meta_description: string
  seo_keywords: string[]
}

interface GeneratedInstagram {
  caption: string
  hashtags: string[]
  image_prompt: string
  best_posting_time: string
}

type GeneratedContent = GeneratedBlog | GeneratedInstagram

function isBlog(c: GeneratedContent, type: string): c is GeneratedBlog {
  return type === 'blog_post'
}

export function ContentGeneratorModal({ item, contentType, onClose }: Props) {
  const [activeType, setActiveType] = useState<'blog_post' | 'instagram_post'>(contentType)
  const [loading, setLoading] = useState(false)
  const [content, setContent] = useState<GeneratedContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function generate(type: 'blog_post' | 'instagram_post') {
    setActiveType(type)
    setLoading(true)
    setContent(null)
    setError(null)
    try {
      const res = await fetch('/api/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, content_type: type }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Generation failed')
      setContent(json.content)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function copyToClipboard() {
    if (!content) return
    const text = isBlog(content, activeType)
      ? `${content.title}\n\n${content.body.replace(/<[^>]+>/g, '')}\n\nMeta: ${content.meta_description}\nKeywords: ${content.seo_keywords?.join(', ')}`
      : `${(content as GeneratedInstagram).caption}\n\n${(content as GeneratedInstagram).hashtags?.join(' ')}\n\nImage: ${(content as GeneratedInstagram).image_prompt}\nBest time: ${(content as GeneratedInstagram).best_posting_time}`
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Fallback for non-HTTPS or permission denied
      const el = document.createElement('textarea')
      el.value = text
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
      <div className="bg-[#13131a] border border-[#2a2a38] rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a38]">
          <div>
            <p className="text-xs text-[#e2e8f0] mb-0.5">Generating content for</p>
            <p className="text-sm font-semibold text-white line-clamp-1">{item.title || 'Market Intel Item'}</p>
          </div>
          <button onClick={onClose} className="text-[#e2e8f0] hover:text-white text-xl leading-none px-2">✕</button>
        </div>

        {/* Type selector */}
        <div className="flex gap-2 px-5 pt-4">
          <button
            onClick={() => generate('blog_post')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${activeType === 'blog_post' && content ? 'bg-[#22c55e]/15 text-[#22c55e]' : 'bg-[#1a1a24] text-[#e2e8f0] hover:text-white border border-[#2a2a38]'}`}
          >
            ✍ Generate Blog Post
          </button>
          <button
            onClick={() => generate('instagram_post')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${activeType === 'instagram_post' && content ? 'bg-[#a855f7]/15 text-[#a855f7]' : 'bg-[#1a1a24] text-[#e2e8f0] hover:text-white border border-[#2a2a38]'}`}
          >
            📸 Generate Instagram
          </button>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-8 h-8 border-2 border-[#22c55e] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-[#e2e8f0]">Generating with GPT-4o...</p>
            </div>
          )}

          {error && (
            <div className="bg-[#ef4444]/10 border border-[#ef4444]/30 rounded-lg p-4 text-sm text-[#ef4444]">
              {error}
            </div>
          )}

          {content && !loading && isBlog(content, activeType) && (
            <div className="space-y-4">
              <div>
                <p className="text-[10px] font-bold text-[#e2e8f0] uppercase tracking-wider mb-1">Title</p>
                <p className="text-white font-bold text-lg">{content.title}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[#e2e8f0] uppercase tracking-wider mb-1">Meta Description</p>
                <p className="text-xs text-[#e4e4e7] bg-[#1a1a24] rounded-lg p-3 border border-[#2a2a38]">{content.meta_description}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[#e2e8f0] uppercase tracking-wider mb-1">SEO Keywords</p>
                <div className="flex flex-wrap gap-1.5">
                  {content.seo_keywords?.map(k => (
                    <span key={k} className="text-xs px-2 py-0.5 rounded bg-[#22c55e]/10 text-[#22c55e]">{k}</span>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[#e2e8f0] uppercase tracking-wider mb-1">Blog Post</p>
                <div
                  className="text-xs text-[#e4e4e7] bg-[#1a1a24] rounded-lg p-4 border border-[#2a2a38] leading-relaxed prose prose-invert prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: content.body }}
                />
              </div>
            </div>
          )}

          {content && !loading && !isBlog(content, activeType) && (
            <div className="space-y-4">
              <div>
                <p className="text-[10px] font-bold text-[#e2e8f0] uppercase tracking-wider mb-1">Caption</p>
                <p className="text-sm text-white bg-[#1a1a24] rounded-lg p-4 border border-[#2a2a38] leading-relaxed">
                  {(content as GeneratedInstagram).caption}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[#e2e8f0] uppercase tracking-wider mb-1">Hashtags</p>
                <div className="flex flex-wrap gap-1.5">
                  {(content as GeneratedInstagram).hashtags?.map(h => (
                    <span key={h} className="text-xs px-2 py-0.5 rounded bg-[#a855f7]/10 text-[#a855f7]">{h}</span>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[#e2e8f0] uppercase tracking-wider mb-1">Image Prompt</p>
                <p className="text-xs text-[#e4e4e7] bg-[#1a1a24] rounded-lg p-3 border border-[#2a2a38]">
                  {(content as GeneratedInstagram).image_prompt}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[#e2e8f0] uppercase tracking-wider mb-1">Best Posting Time</p>
                <p className="text-sm font-semibold text-[#f59e0b]">{(content as GeneratedInstagram).best_posting_time}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {content && !loading && (
          <div className="flex gap-2 px-5 py-4 border-t border-[#2a2a38]">
            <button
              onClick={copyToClipboard}
              className="flex-1 py-2 text-sm font-semibold rounded-lg bg-[#1a1a24] border border-[#2a2a38] text-[#e2e8f0] hover:text-white transition-colors"
            >
              {copied ? '✓ Copied!' : 'Copy to Clipboard'}
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-2 text-sm font-semibold rounded-lg bg-[#22c55e]/15 text-[#22c55e] hover:bg-[#22c55e]/25 transition-colors"
            >
              Save as Draft ✓
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
