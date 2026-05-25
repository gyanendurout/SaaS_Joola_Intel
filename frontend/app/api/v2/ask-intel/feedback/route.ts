/**
 * Ask Intel — POST /api/v2/ask-intel/feedback
 *
 * Records thumbs-up/down feedback on a previously logged Q&A turn.
 *
 * Request body:
 *   {
 *     messageId: string  // row id returned by /api/v2/ask-intel
 *     feedback: 'up' | 'down'
 *     notes?: string     // optional free-text reason
 *     userFollowup?: string  // optional follow-up question the user typed
 *   }
 *
 * Response:
 *   { ok: true } on success
 *   { ok: false, error: string } on failure
 *
 * Failure modes:
 *   - Migration 017 not applied → table missing → 500 with explicit message
 *   - messageId not found → 404
 *   - Bad payload → 400
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase credentials not configured.')
  return createClient(url, key, { auth: { persistSession: false } })
}

type FeedbackBody = {
  messageId?: string
  feedback?: 'up' | 'down'
  notes?: string
  userFollowup?: string
}

export async function POST(req: NextRequest) {
  let body: FeedbackBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  const messageId = (body.messageId || '').trim()
  if (!messageId) {
    return NextResponse.json({ ok: false, error: 'messageId is required.' }, { status: 400 })
  }
  if (body.feedback !== 'up' && body.feedback !== 'down') {
    return NextResponse.json(
      { ok: false, error: 'feedback must be "up" or "down".' },
      { status: 400 },
    )
  }

  let supabase: ReturnType<typeof getSupabase>
  try {
    supabase = getSupabase()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Service not configured.'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }

  const update: Record<string, unknown> = { feedback: body.feedback }
  if (typeof body.notes === 'string' && body.notes.trim()) {
    update.feedback_notes = body.notes.trim().slice(0, 2000)
  }
  if (typeof body.userFollowup === 'string' && body.userFollowup.trim()) {
    update.user_followup = body.userFollowup.trim().slice(0, 2000)
  }

  const { data, error } = await supabase
    .from('ask_intel_qa_log')
    .update(update)
    .eq('id', messageId)
    .select('id')
    .limit(1)

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: `Feedback save failed: ${error.message}. (Has migration 017 been applied?)`,
      },
      { status: 500 },
    )
  }
  if (!data || data.length === 0) {
    return NextResponse.json(
      { ok: false, error: `messageId ${messageId} not found.` },
      { status: 404 },
    )
  }

  return NextResponse.json({ ok: true })
}

/**
 * GET /api/v2/ask-intel/feedback?limit=50&feedback=down
 *
 * Lists recent Q&A turns for the debug admin page. Defaults to last 50.
 * Filter by `feedback=down` to surface failures for prompt iteration.
 */
export async function GET(req: NextRequest) {
  const limitParam = parseInt(req.nextUrl.searchParams.get('limit') || '50', 10)
  const limit = Math.min(Math.max(1, Number.isFinite(limitParam) ? limitParam : 50), 500)
  const feedbackFilter = req.nextUrl.searchParams.get('feedback') // 'up' | 'down' | 'none' | null

  let supabase: ReturnType<typeof getSupabase>
  try {
    supabase = getSupabase()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Service not configured.'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }

  let q = supabase
    .from('ask_intel_qa_log')
    .select('id,session_id,question,answer_summary,visuals_count,data_sources,feedback,feedback_notes,user_followup,latency_ms,confidence,warnings,error_message,created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (feedbackFilter === 'up' || feedbackFilter === 'down' || feedbackFilter === 'none') {
    q = q.eq('feedback', feedbackFilter)
  }

  const { data, error } = await q
  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: `Query failed: ${error.message}. (Has migration 017 been applied?)`,
        rows: [],
      },
      { status: 500 },
    )
  }
  return NextResponse.json({ ok: true, rows: data || [] })
}
