import { createClient, SupabaseClient } from '@supabase/supabase-js'

function createBrowserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY'
    )
  }
  return createClient(url, key)
}

// Singleton for browser/client-component usage
let _browserClient: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!_browserClient) {
    _browserClient = createBrowserClient()
  }
  return _browserClient
}

// Server-side client using service-role key for privileged writes
// Only import this in API routes or server actions — never in client components
export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
    )
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  })
}
