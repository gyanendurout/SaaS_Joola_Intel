// Executive Overview was removed 2026-05-25 per product decision.
// Root /v2 now redirects to Ask Intel, the new default landing.
// The Overview component + fetchOverview helper in lib/v2/data.ts remain
// as dead code for now (no other readers) and can be deleted in a follow-up.

import { redirect } from 'next/navigation'

export default function V2Root(): never {
  redirect('/v2/ask-intel')
}
