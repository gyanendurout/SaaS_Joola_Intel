'use client'

import { useState } from 'react'
import { PageHead } from '@/components/v2/PageShell'
import { downloadMarkdownBrief } from '@/lib/shared/content-brief/markdown'
import type { ContentBrief } from '@/types/market'

const INTENT_COLOR: Record<string, string> = {
  informational: '#818cf8',
  commercial: '#f59e0b',
  transactional: '#22c55e',
  navigational: '#06b6d4',
}

export default function ContentBriefPage() {
  const [keyword, setKeyword] = useState('')
  const [clusterInput, setClusterInput] = useState('')
  const [brief, setBrief] = useState<ContentBrief | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    const kw = keyword.trim()
    if (!kw) return
    setLoading(true)
    setError(null)
    setBrief(null)

    const keywordCluster = clusterInput
      .split(',')
      .map(k => k.trim())
      .filter(Boolean)

    try {
      const res = await fetch('/api/content-brief', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keyword: kw, keywordCluster }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generation failed')
      setBrief(data as ContentBrief)
    } catch (e: any) {
      setError(e.message || 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <PageHead
        eyebrow="SEO · CONTENT STRATEGY · AI BRIEF"
        title="Content Brief Generator"
        accent="brief"
        sub="Generate a structured content brief from a keyword cluster. Powered by SERP analysis + GPT-4o."
      />

      <section>
        <div className="card" style={{ padding: '24px 28px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 260px' }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                  Primary Keyword *
                </label>
                <input
                  className="select"
                  style={{ width: '100%', padding: '8px 12px', fontSize: 14 }}
                  placeholder="e.g. best pickleball paddle"
                  value={keyword}
                  onChange={e => setKeyword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && generate()}
                  disabled={loading}
                />
              </div>
              <div style={{ flex: '2 1 340px' }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                  Keyword Cluster (comma-separated, optional)
                </label>
                <input
                  className="select"
                  style={{ width: '100%', padding: '8px 12px', fontSize: 14 }}
                  placeholder="e.g. pickleball paddle review, top pickleball paddles 2024"
                  value={clusterInput}
                  onChange={e => setClusterInput(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button
                onClick={generate}
                disabled={loading || !keyword.trim()}
                style={{
                  background: '#F5E625', color: '#000', border: 'none', borderRadius: 6,
                  fontWeight: 700, fontSize: 13, padding: '9px 20px', cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading || !keyword.trim() ? 0.6 : 1,
                }}
              >
                {loading ? 'Generating...' : 'Generate Brief'}
              </button>
              {brief && (
                <button
                  onClick={() => downloadMarkdownBrief(brief)}
                  style={{
                    background: 'transparent', color: 'var(--fg)', border: '1px solid var(--border)',
                    borderRadius: 6, fontWeight: 600, fontSize: 13, padding: '8px 16px', cursor: 'pointer',
                  }}
                >
                  Export Markdown
                </button>
              )}
              {loading && (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  Analyzing SERP results and building brief…
                </span>
              )}
            </div>
          </div>
          {error && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: '#fee2e2', borderRadius: 6, color: '#b91c1c', fontSize: 13 }}>
              {error}
            </div>
          )}
        </div>
      </section>

      {brief && (
        <>
          <section>
            <div className="section-head"><div>
              <h2>Brief Overview</h2>
              <div className="sub">Recommended title, meta, word count, and primary intent.</div>
            </div></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
              <div className="card" style={{ padding: '18px 20px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>Recommended Title</div>
                <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.4 }}>{brief.recommendedTitle}</div>
              </div>
              <div className="card" style={{ padding: '18px 20px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>Meta Description</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>{brief.metaDescription}</div>
              </div>
              <div className="card" style={{ padding: '18px 20px', display: 'flex', gap: 28 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>Target Word Count</div>
                  <div style={{ fontSize: 22, fontWeight: 800 }}>{brief.targetWordCount.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>Intent</div>
                  <span style={{
                    background: (INTENT_COLOR[brief.primaryIntent] ?? '#818cf8') + '22',
                    color: INTENT_COLOR[brief.primaryIntent] ?? '#818cf8',
                    border: `1px solid ${INTENT_COLOR[brief.primaryIntent] ?? '#818cf8'}44`,
                    padding: '3px 10px', borderRadius: 4, fontSize: 12, fontWeight: 700, textTransform: 'capitalize',
                  }}>
                    {brief.primaryIntent}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section>
            <div className="section-head"><div>
              <h2>Content Outline</h2>
              <div className="sub">{brief.sections.length} sections · estimated {brief.targetWordCount.toLocaleString()} words total</div>
            </div></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {brief.sections.map((sec, i) => (
                <div key={i} className="card" style={{ padding: '16px 20px', borderLeft: `3px solid ${sec.level === 2 ? '#F5E625' : '#3a4150'}` }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', background: 'var(--surface2)', padding: '2px 7px', borderRadius: 3 }}>
                      H{sec.level}
                    </span>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{sec.heading}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>~{sec.estimatedWords}w</span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
                    {sec.keyPoints.map((pt, j) => (
                      <li key={j} style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 2 }}>{pt}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div className="section-head"><div>
                  <h2>Key Topics</h2>
                  <div className="sub">Semantic topics the content must address.</div>
                </div></div>
                <div className="card" style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {brief.keyTopics.map((t, i) => (
                      <span key={i} style={{
                        background: '#1e2430', border: '1px solid var(--border)', borderRadius: 4,
                        padding: '4px 10px', fontSize: 12, fontWeight: 600, color: 'var(--fg)',
                      }}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <div className="section-head"><div>
                  <h2>SERP Insights</h2>
                  <div className="sub">Opportunities from top-ranking pages.</div>
                </div></div>
                <div className="card" style={{ padding: '16px 20px' }}>
                  <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
                    {brief.serpInsights.map((insight, i) => (
                      <li key={i} style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6, lineHeight: 1.5 }}>{insight}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </section>

          <section>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div className="section-head"><div>
                  <h2>Competitor Gaps</h2>
                  <div className="sub">Topics current SERP results miss.</div>
                </div></div>
                <div className="card" style={{ padding: '16px 20px' }}>
                  <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
                    {brief.competitorGaps.map((gap, i) => (
                      <li key={i} style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6, lineHeight: 1.5 }}>{gap}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div>
                <div className="section-head"><div>
                  <h2>Internal Linking Suggestions</h2>
                  <div className="sub">{brief.internalLinks.length} suggested links to add.</div>
                </div></div>
                <div className="card" style={{ padding: '0' }}>
                  {brief.internalLinks.map((link, i) => (
                    <div key={i} style={{
                      padding: '12px 20px',
                      borderBottom: i < brief.internalLinks.length - 1 ? '1px solid var(--border)' : 'none',
                    }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#22c55e' }}>{link.anchorText}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{link.targetSlug}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{link.context}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </>
  )
}
