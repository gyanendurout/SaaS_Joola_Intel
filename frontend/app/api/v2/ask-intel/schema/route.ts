/**
 * GET /api/v2/ask-intel/schema
 *
 * Returns the public-facing schema summary — tables, columns, metrics, and
 * tracked brand slugs. Used by the Data Coverage panel and any debug UI
 * that wants to render the planner's capability surface.
 */

import { NextResponse } from 'next/server'
import { buildSchemaSummary } from '@/lib/v2/askIntel/schema'

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(buildSchemaSummary())
}
