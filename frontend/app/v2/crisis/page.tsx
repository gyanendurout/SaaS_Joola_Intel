import { redirect } from 'next/navigation'

export default function LegacyCrisisRedirect() {
  redirect('/v2/community-intel')
}
