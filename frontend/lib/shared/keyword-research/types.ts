export type KeywordIntent = 'informational' | 'commercial' | 'transactional' | 'navigational'

export interface Keyword {
  keyword: string
  estimatedVolume: number   // monthly searches (LLM-estimated or API-sourced)
  difficulty: number        // 0–100 KD score
  opportunityScore: number  // 0–100 composite (volume × (1 - difficulty/100))
  intent: KeywordIntent
  clusterId: string
  clusterLabel: string
  questionForm?: string     // e.g. "what is the best pickleball paddle?"
  serpFeatures?: string[]   // e.g. ["featured_snippet","people_also_ask"]
}

export interface KeywordCluster {
  id: string
  label: string
  intent: KeywordIntent
  theme: string             // short summary of the cluster topic
  keywords: Keyword[]
  avgDifficulty: number
  totalEstimatedVolume: number
}

export interface KeywordResearchResult {
  seed: string
  seedType: 'topic' | 'url'
  generatedAt: string
  model: string
  clusters: KeywordCluster[]
  topOpportunities: Keyword[]  // top 10 by opportunityScore
  meta: {
    totalKeywords: number
    totalEstimatedVolume: number
    avgDifficulty: number
    clusterCount: number
  }
}
