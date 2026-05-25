import { redirect } from 'next/navigation'

export default function LegacyCommentsRedirect() {
  redirect('/v2/community-intel')
}
