// qa-session.mjs — signs the QA account in without sending an email and saves
// a Playwright storageState to qa/.auth/state.json (gitignored).
//
// How: the admin API (service-role key, local only — never on Vercel) issues a
// one-time code via generateLink, which returns the code instead of mailing it.
// The code is verified through @supabase/ssr so the saved cookies are exactly
// what the middleware reads.
//
// Used by: playwright globalSetup, qa/tooltip-check.mjs, qa/regression.ps1.
// CLI:     node qa/qa-session.mjs [baseUrl]
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const STATE_PATH = resolve(HERE, '.auth', 'state.json')
const DEFAULT_EMAIL = 'qa-bot@joola.in'
const MAX_STATE_AGE_MS = 30 * 60 * 1000

/** Minimal KEY=VALUE reader for .env files; process.env always wins. */
function readEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

function loadEnv() {
  const files = { ...readEnvFile(resolve(HERE, '..', '..', '.env')), ...readEnvFile(resolve(HERE, '..', '.env.local')) }
  const get = k => process.env[k] || files[k]
  const url = get('NEXT_PUBLIC_SUPABASE_URL')
  const anonKey = get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  const serviceKey = get('SUPABASE_SERVICE_ROLE_KEY')
  const serviceUrl = get('SUPABASE_URL') || url
  const missing = [['NEXT_PUBLIC_SUPABASE_URL', url], ['NEXT_PUBLIC_SUPABASE_ANON_KEY', anonKey],
    ['SUPABASE_SERVICE_ROLE_KEY', serviceKey]].filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) throw new Error(`qa-session: missing env ${missing.join(', ')}`)
  if (serviceUrl.replace(/\/$/, '') !== url.replace(/\/$/, '')) {
    throw new Error('qa-session: SUPABASE_URL and NEXT_PUBLIC_SUPABASE_URL point at different projects')
  }
  return { url, anonKey, serviceKey, email: get('QA_LOGIN_EMAIL') || DEFAULT_EMAIL }
}

async function ensureUser(admin, email) {
  const { error } = await admin.auth.admin.createUser({ email, email_confirm: true })
  if (error && error.code !== 'email_exists' && !/already/i.test(error.message)) {
    throw new Error(`qa-session: createUser failed: ${error.message}`)
  }
}

async function sessionCookies({ url, anonKey, serviceKey, email }) {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  await ensureUser(admin, email)
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(`qa-session: generateLink failed: ${error.message}`)
  const token = data.properties?.email_otp
  if (!token) throw new Error('qa-session: generateLink returned no email_otp')

  let captured = []
  const ssr = createServerClient(url, anonKey, {
    cookies: { getAll: () => [], setAll: list => { captured = list } },
  })
  const { error: verifyError } = await ssr.auth.verifyOtp({ email, token, type: 'email' })
  if (verifyError) throw new Error(`qa-session: verifyOtp failed: ${verifyError.message}`)
  // @supabase/ssr writes cookies from its auth-state listener; let it flush.
  for (let i = 0; i < 20 && captured.length === 0; i++) await new Promise(r => setTimeout(r, 50))
  if (captured.length === 0) throw new Error('qa-session: no session cookies were produced')
  return captured
}

function toStorageState(cookies, baseUrl) {
  const { hostname, protocol } = new URL(baseUrl)
  const nowS = Math.floor(Date.now() / 1000)
  return {
    cookies: cookies.map(({ name, value, options = {} }) => ({
      name, value, domain: hostname, path: options.path || '/',
      expires: options.maxAge ? nowS + options.maxAge : -1,
      httpOnly: !!options.httpOnly, secure: protocol === 'https:',
      sameSite: 'Lax',
    })),
    origins: [],
  }
}

/** Writes a fresh state file unless a recent one exists. Returns its path. */
export async function ensureQaSession(baseUrl = 'http://localhost:3000', { force = false } = {}) {
  if (!force && existsSync(STATE_PATH) && Date.now() - statSync(STATE_PATH).mtimeMs < MAX_STATE_AGE_MS) {
    return STATE_PATH
  }
  const env = loadEnv()
  const state = toStorageState(await sessionCookies(env), baseUrl)
  mkdirSync(dirname(STATE_PATH), { recursive: true })
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
  return STATE_PATH
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  ensureQaSession(process.argv[2] || 'http://localhost:3000', { force: process.argv.includes('--force') })
    .then(p => console.log(`qa-session: saved ${p}`))
    .catch(e => { console.error(e.message); process.exit(1) })
}
