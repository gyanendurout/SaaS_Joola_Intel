import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runKeywordResearchAgent } from '@/lib/shared/keyword-research/agent'
import type { KeywordResearchResult } from '@/lib/shared/keyword-research/types'

// POST /api/keyword-research
// Body: { seed: string, seedType?: "topic"|"url", limit?: number }
// Returns: KeywordResearchResult JSON
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { seed, seedType, limit } = body as {
      seed?: string
      seedType?: 'topic' | 'url'
      limit?: number
    }

    if (!seed || typeof seed !== 'string' || seed.trim().length === 0) {
      return NextResponse.json({ error: 'seed is required' }, { status: 400 })
    }

    const resolvedSeedType: 'topic' | 'url' =
      seedType === 'url' ? 'url' : seed.startsWith('http') ? 'url' : 'topic'

    const result: KeywordResearchResult = await runKeywordResearchAgent({
      seed: seed.trim(),
      seedType: resolvedSeedType,
      limit: typeof limit === 'number' && limit > 0 && limit <= 200 ? limit : 40,
    })

    // Persist to Supabase (best-effort — table may not exist yet in early POC)
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
      await supabase.from('keyword_research_results').insert({
        seed: result.seed,
        seed_type: result.seedType,
        generated_at: result.generatedAt,
        total_keywords: result.meta.totalKeywords,
        total_volume: result.meta.totalEstimatedVolume,
        avg_difficulty: result.meta.avgDifficulty,
        cluster_count: result.meta.clusterCount,
        result_json: result,
      })
    } catch {
      // Non-fatal — table doesn't need to exist for the agent to return results
    }

    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

// GET /api/keyword-research?seed=<topic>&seedType=topic&limit=40
// Convenience GET endpoint for quick testing / downstream agent polling
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const seed = searchParams.get('seed') ?? ''
  const seedType = searchParams.get('seedType') as 'topic' | 'url' | null
  const limitStr = searchParams.get('limit')
  const limit = limitStr ? parseInt(limitStr, 10) : undefined

  if (!seed) {
    return NextResponse.json({ error: 'seed query param is required' }, { status: 400 })
  }

  // Re-use POST logic
  return POST(
    new NextRequest(req.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed, seedType, limit }),
    })
  )
}
