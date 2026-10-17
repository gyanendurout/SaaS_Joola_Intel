import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { requireEnv } from './env'

/** Auth-session client for server actions and route handlers (not for data reads). */
export function createAuthServerClient() {
  const store = cookies()
  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => list.forEach(({ name, value, options }) => store.set(name, value, options)),
    } },
  )
}
