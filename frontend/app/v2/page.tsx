// Executive Overview was removed 2026-05-25, then reinstated: it is the home
// page again and the sidebar's Home entry points here. The comment that used to
// sit here claimed this redirected to Ask Intel, which contradicted the call
// below and had propagated into BRD.md and docs/ARCHITECTURE.md. Corrected
// 2026-08-24 — if you change the target, change those two docs with it.

import { redirect } from 'next/navigation'

export default function V2Root(): never {
  redirect('/v2/overview')
}
