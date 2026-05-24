import OpenAI from 'openai'
import type { KeywordResearchResult, KeywordCluster, Keyword, KeywordIntent } from './types'

const MODEL = 'gpt-4o'

// Raw shape returned by the LLM
interface LLMKeywordRow {
  keyword: string
  estimated_volume: number
  difficulty: number
  intent: KeywordIntent
  cluster_id: string
  cluster_label: string
  cluster_intent: KeywordIntent
  cluster_theme: string
  question_form?: string
  serp_features?: string[]
}

interface LLMResponse {
  keywords: LLMKeywordRow[]
}

function buildPrompt(seed: string, seedType: 'topic' | 'url', limit: number): string {
  const seedDesc = seedType === 'url'
    ? `the website/page at this URL: ${seed}`
    : `the topic: "${seed}"`

  return `You are an expert SEO keyword researcher. Given ${seedDesc}, generate ${limit} diverse, high-value keyword opportunities.

For each keyword provide:
- keyword: the exact search query
- estimated_volume: realistic monthly search volume (integer)
- difficulty: keyword difficulty 0–100 (lower = easier to rank)
- intent: one of informational | commercial | transactional | navigational
- cluster_id: short snake_case cluster identifier (group semantically related keywords)
- cluster_label: human-readable cluster name
- cluster_intent: dominant intent for this cluster
- cluster_theme: one sentence describing the cluster topic
- question_form: optional — a "how/what/why" rephrasing of the keyword
- serp_features: optional array — predicted SERP features (featured_snippet, people_also_ask, shopping, local_pack, video_carousel)

Cluster rules:
- 4–8 clusters, each with 3–8 keywords
- Cover all four intent types across clusters
- Mix head terms (high volume, high difficulty) with long-tail (lower volume, lower difficulty)
- Ensure topical diversity; avoid redundant clusters

Return ONLY valid JSON — no markdown fences — in this exact shape:
{
  "keywords": [ ...array of keyword objects... ]
}`
}

function computeOpportunityScore(volume: number, difficulty: number): number {
  // Opportunity = volume potential × ease-of-ranking weight
  // Normalised to 0–100 relative to the batch
  const raw = volume * (1 - difficulty / 100)
  return raw  // will be normalised after all keywords are computed
}

function normalisedOpportunity(keywords: { raw: number }[]): number[] {
  const max = Math.max(...keywords.map(k => k.raw), 1)
  return keywords.map(k => Math.round((k.raw / max) * 100))
}

function buildResult(
  seed: string,
  seedType: 'topic' | 'url',
  rows: LLMKeywordRow[],
  model: string,
): KeywordResearchResult {
  // Compute raw opportunity scores
  const rawScores = rows.map(r => ({ raw: computeOpportunityScore(r.estimated_volume, r.difficulty) }))
  const scores = normalisedOpportunity(rawScores)

  // Assemble Keyword objects
  const keywords: Keyword[] = rows.map((r, i) => ({
    keyword: r.keyword,
    estimatedVolume: r.estimated_volume,
    difficulty: r.difficulty,
    opportunityScore: scores[i],
    intent: r.intent,
    clusterId: r.cluster_id,
    clusterLabel: r.cluster_label,
    questionForm: r.question_form,
    serpFeatures: r.serp_features,
  }))

  // Group into clusters
  const clusterMap = new Map<string, { rows: LLMKeywordRow; keywords: Keyword[] }>()
  rows.forEach((r, i) => {
    if (!clusterMap.has(r.cluster_id)) {
      clusterMap.set(r.cluster_id, { rows: r, keywords: [] })
    }
    clusterMap.get(r.cluster_id)!.keywords.push(keywords[i])
  })

  const clusters: KeywordCluster[] = Array.from(clusterMap.entries()).map(([id, { rows: rep, keywords: kws }]) => {
    const avgDiff = Math.round(kws.reduce((s, k) => s + k.difficulty, 0) / kws.length)
    const totalVol = kws.reduce((s, k) => s + k.estimatedVolume, 0)
    return {
      id,
      label: rep.cluster_label,
      intent: rep.cluster_intent,
      theme: rep.cluster_theme,
      keywords: kws.sort((a, b) => b.opportunityScore - a.opportunityScore),
      avgDifficulty: avgDiff,
      totalEstimatedVolume: totalVol,
    }
  })

  // Sort clusters by total opportunity (totalVol × (1 - avgDiff/100))
  clusters.sort((a, b) =>
    b.totalEstimatedVolume * (1 - b.avgDifficulty / 100) -
    a.totalEstimatedVolume * (1 - a.avgDifficulty / 100)
  )

  const topOpportunities = [...keywords]
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 10)

  const totalKeywords = keywords.length
  const totalEstimatedVolume = keywords.reduce((s, k) => s + k.estimatedVolume, 0)
  const avgDifficulty = Math.round(keywords.reduce((s, k) => s + k.difficulty, 0) / totalKeywords)

  return {
    seed,
    seedType,
    generatedAt: new Date().toISOString(),
    model,
    clusters,
    topOpportunities,
    meta: {
      totalKeywords,
      totalEstimatedVolume,
      avgDifficulty,
      clusterCount: clusters.length,
    },
  }
}

export interface RunAgentOptions {
  seed: string
  seedType?: 'topic' | 'url'
  limit?: number             // target keyword count (default 40)
  openaiApiKey?: string      // override; falls back to process.env
}

export async function runKeywordResearchAgent(opts: RunAgentOptions): Promise<KeywordResearchResult> {
  const { seed, seedType = 'topic', limit = 40 } = opts
  const apiKey = opts.openaiApiKey ?? process.env.NEXT_PUBLIC_OPENAI_KEY ?? process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OpenAI API key not configured')

  const openai = new OpenAI({ apiKey })
  const prompt = buildPrompt(seed, seedType, limit)

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.4,
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices[0].message.content ?? '{}'
  let parsed: LLMResponse
  try {
    parsed = JSON.parse(raw) as LLMResponse
  } catch {
    throw new Error(`Failed to parse LLM response: ${raw.slice(0, 200)}`)
  }

  if (!Array.isArray(parsed.keywords) || parsed.keywords.length === 0) {
    throw new Error('LLM returned no keywords')
  }

  return buildResult(seed, seedType, parsed.keywords, MODEL)
}
