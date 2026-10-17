import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

/** Auth-session client for server actions and route handlers (not for data reads). */
export function createAuthServerClient() {
  const store = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => list.forEach(({ name, value, options }) => store.set(name, value, options)),
    } },
  )
}
