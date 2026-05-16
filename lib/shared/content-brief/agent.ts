import OpenAI from 'openai'
import { randomUUID } from 'crypto'
import type {
  ContentBrief,
  ContentBriefSection,
  ContentBriefIntent,
  InternalLinkSuggestion,
} from '@/types/market'

const MODEL = 'gpt-4o'

interface LLMSection {
  heading: string
  level: 2 | 3
  key_points: string[]
  estimated_words: number
}

interface LLMInternalLink {
  anchor_text: string
  target_slug: string
  context: string
}

interface LLMBriefResponse {
  recommended_title: string
  meta_description: string
  target_word_count: number
  primary_intent: ContentBriefIntent
  sections: LLMSection[]
  key_topics: string[]
  serp_insights: string[]
  internal_links: LLMInternalLink[]
  competitor_gaps: string[]
}

function buildPrompt(keyword: string, cluster: string[]): string {
  const clusterList = cluster.length > 1
    ? `\nKeyword cluster (related terms to cover):\n${cluster.map(k => `- ${k}`).join('\n')}`
    : ''

  return `You are an expert SEO content strategist. Analyze the top-ranking SERP results for the given keyword and generate a comprehensive content brief that would help a page outrank current results.

Primary keyword: "${keyword}"${clusterList}

Your task:
1. Simulate analysis of the top 5–10 SERP results for this keyword
2. Identify what topics they cover, what they miss, and what structure performs best
3. Generate a structured content brief with the following:

Return ONLY valid JSON (no markdown fences) in this exact shape:
{
  "recommended_title": "SEO-optimized page title (50–60 characters)",
  "meta_description": "Compelling meta description under 160 characters",
  "target_word_count": 1500,
  "primary_intent": "informational",
  "sections": [
    {
      "heading": "H2 or H3 heading text",
      "level": 2,
      "key_points": ["bullet point 1", "bullet point 2", "bullet point 3"],
      "estimated_words": 200
    }
  ],
  "key_topics": ["topic 1", "topic 2", "topic 3", "topic 4", "topic 5"],
  "serp_insights": [
    "Insight about what top results are doing well",
    "Gap or weakness in current SERP results",
    "SERP feature opportunity (e.g. featured snippet, PAA)"
  ],
  "internal_links": [
    {
      "anchor_text": "anchor text for the link",
      "target_slug": "/suggested-url-slug",
      "context": "why this internal link makes sense here"
    }
  ],
  "competitor_gaps": [
    "Topic or angle that top competitors miss",
    "Question left unanswered by current SERP results"
  ]
}

Rules:
- primary_intent must be one of: informational, commercial, transactional, navigational
- Include 5–9 sections (mix of H2 and H3)
- Intro and conclusion are required sections
- key_topics should be 5–8 semantic topics the content must address
- serp_insights should be 3–5 actionable observations
- internal_links should be 3–6 realistic suggestions
- competitor_gaps should be 3–5 genuine content opportunities
- target_word_count should be realistic for the intent (informational: 1200–2500, commercial: 800–1500, transactional: 500–1000)`
}

export interface RunBriefOptions {
  keyword: string
  keywordCluster?: string[]
  openaiApiKey?: string
}

export async function runContentBriefAgent(opts: RunBriefOptions): Promise<ContentBrief> {
  const { keyword, keywordCluster = [] } = opts
  const apiKey = opts.openaiApiKey ?? process.env.NEXT_PUBLIC_OPENAI_KEY ?? process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OpenAI API key not configured')

  const cluster = keywordCluster.filter(k => k !== keyword)
  const openai = new OpenAI({ apiKey })
  const prompt = buildPrompt(keyword, cluster)

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.4,
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices[0].message.content ?? '{}'
  let parsed: LLMBriefResponse
  try {
    parsed = JSON.parse(raw) as LLMBriefResponse
  } catch {
    throw new Error(`Failed to parse LLM response: ${raw.slice(0, 200)}`)
  }

  if (!parsed.recommended_title || !Array.isArray(parsed.sections)) {
    throw new Error('LLM returned an incomplete brief structure')
  }

  const sections: ContentBriefSection[] = parsed.sections.map(s => ({
    heading: s.heading,
    level: s.level === 3 ? 3 : 2,
    keyPoints: Array.isArray(s.key_points) ? s.key_points : [],
    estimatedWords: typeof s.estimated_words === 'number' ? s.estimated_words : 150,
  }))

  const internalLinks: InternalLinkSuggestion[] = (parsed.internal_links ?? []).map(l => ({
    anchorText: l.anchor_text,
    targetSlug: l.target_slug,
    context: l.context,
  }))

  return {
    id: randomUUID(),
    keyword,
    keywordCluster: [keyword, ...cluster],
    generatedAt: new Date().toISOString(),
    model: MODEL,
    recommendedTitle: parsed.recommended_title,
    metaDescription: parsed.meta_description ?? '',
    targetWordCount: typeof parsed.target_word_count === 'number' ? parsed.target_word_count : 1500,
    primaryIntent: parsed.primary_intent ?? 'informational',
    sections,
    keyTopics: Array.isArray(parsed.key_topics) ? parsed.key_topics : [],
    serpInsights: Array.isArray(parsed.serp_insights) ? parsed.serp_insights : [],
    internalLinks,
    competitorGaps: Array.isArray(parsed.competitor_gaps) ? parsed.competitor_gaps : [],
  }
}
