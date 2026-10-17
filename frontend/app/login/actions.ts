'use server'
import { createAuthServerClient } from '@/lib/auth/supabase-server'
import { parseAllowedEmail } from '@/lib/auth/rules'

export type ActionResult = { ok: true } | { ok: false; error: string }

const CODE_RE = /^\d{6}$/

export async function requestCode(rawEmail: string): Promise<ActionResult> {
  const email = parseAllowedEmail(rawEmail)
  if (!email) return { ok: false, error: 'Use your @joola.com or @joola.in email.' }
  const { error } = await createAuthServerClient().auth.signInWithOtp({
    email, options: { shouldCreateUser: true },
  })
  if (error) {
    console.error('[login] signInWithOtp failed:', error.status, error.message)
    return { ok: false, error: error.status === 429
      ? 'Too many codes requested. Try again in a few minutes.'
      : 'Could not send the code. Try again shortly.' }
  }
  return { ok: true }
}

export async function verifyCode(rawEmail: string, token: string): Promise<ActionResult> {
  const email = parseAllowedEmail(rawEmail)
  if (!email || !CODE_RE.test(token)) return { ok: false, error: 'Enter the 6-digit code.' }
  const { error } = await createAuthServerClient().auth.verifyOtp({ email, token, type: 'email' })
  if (error) {
    console.error('[login] verifyOtp failed:', error.status, error.message)
    return { ok: false, error: 'That code is wrong or expired.' }
  }
  return { ok: true } // verifyOtp updates user.last_sign_in_at, which middleware checks
}

export async function signOut(): Promise<void> {
  const { error } = await createAuthServerClient().auth.signOut({ scope: 'local' })
  if (error) console.error('[login] signOut failed:', error.status, error.message)
}
