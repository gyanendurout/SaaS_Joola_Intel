// Executive Overview is the home page and the sidebar's Home entry points here.
// If you change the target, update BRD.md and docs/ARCHITECTURE.md with it.

import { redirect } from 'next/navigation'

export default function V2Root(): never {
  redirect('/v2/overview')
}
