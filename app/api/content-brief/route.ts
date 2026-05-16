import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runContentBriefAgent } from '@/lib/shared/content-brief/agent'
import type { ContentBrief } from '@/types/market'

// POST /api/content-brief
// Body: { keyword: string, keywordCluster?: string[] }
// Returns: ContentBrief JSON
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { keyword, keywordCluster } = body as {
      keyword?: string
      keywordCluster?: string[]
    }

    if (!keyword || typeof keyword !== 'string' || keyword.trim().length === 0) {
      return NextResponse.json({ error: 'keyword is required' }, { status: 400 })
    }

    const cluster: string[] = Array.isArray(keywordCluster)
      ? keywordCluster.filter(k => typeof k === 'string' && k.trim().length > 0)
      : []

    const brief: ContentBrief = await runContentBriefAgent({
      keyword: keyword.trim(),
      keywordCluster: cluster,
    })

    // Persist to Supabase (best-effort — table may not exist yet)
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
      await supabase.from('content_briefs').insert({
        id: brief.id,
        keyword: brief.keyword,
        keyword_cluster: brief.keywordCluster,
        generated_at: brief.generatedAt,
        model: brief.model,
        recommended_title: brief.recommendedTitle,
        target_word_count: brief.targetWordCount,
        primary_intent: brief.primaryIntent,
        brief_json: brief,
      })
    } catch {
      // Non-fatal — table doesn't need to exist for the agent to return results
    }

    return NextResponse.json(brief)
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

// GET /api/content-brief?keyword=<term>&cluster=kw1,kw2
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const keyword = searchParams.get('keyword') ?? ''
  const clusterParam = searchParams.get('cluster') ?? ''
  const keywordCluster = clusterParam
    ? clusterParam.split(',').map(k => k.trim()).filter(Boolean)
    : []

  if (!keyword) {
    return NextResponse.json({ error: 'keyword query param is required' }, { status: 400 })
  }

  return POST(
    new NextRequest(req.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keyword, keywordCluster }),
    })
  )
}
