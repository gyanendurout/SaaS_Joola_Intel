'use client'

import { Suspense, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { requestCode, verifyCode } from './actions'
import type { ActionResult } from './actions'
import { safeNext } from '@/lib/auth/safeNext'

const RESEND_COOLDOWN_S = 60
const NETWORK_ERROR = 'Something went wrong. Check your connection and try again.'

/** Calls a server action, turning a thrown network/runtime error into a result. */
async function run(action: () => Promise<ActionResult>): Promise<ActionResult> {
  try { return await action() } catch { return { ok: false, error: NETWORK_ERROR } }
}

/** Seconds left until `until` (epoch ms), re-rendering once per second. */
function useCountdown(until: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until <= Date.now()) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [until])
  return Math.max(0, Math.ceil((until - now) / 1000))
}

export default function LoginPage() {
  return (
    <main className="login-wrap">
      <div className="card card-pad-lg login-card">
        <div className="login-brand">
          <div className="login-mark" aria-hidden="true">J</div>
          <span className="login-wordmark">JOOLA <span>INTEL</span></span>
        </div>
        <h1 className="login-title">Sign in</h1>
        <Suspense fallback={<p className="login-sub">Loading…</p>}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  )
}

function LoginForm() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [resendAt, setResendAt] = useState(0)

  const onSent = (sentTo: string) => {
    setEmail(sentTo)
    setStep('code')
    setResendAt(Date.now() + RESEND_COOLDOWN_S * 1000)
  }

  if (step === 'email') return <EmailStep initialEmail={email} onSent={onSent} />
  return (
    <CodeStep
      email={email}
      resendAt={resendAt}
      onResent={() => setResendAt(Date.now() + RESEND_COOLDOWN_S * 1000)}
      onBack={() => setStep('email')}
      onSignedIn={() => window.location.assign(safeNext(searchParams.get('next')))}
    />
  )
}

function EmailStep({ initialEmail, onSent }: { initialEmail: string; onSent: (email: string) => void }) {
  const [value, setValue] = useState(initialEmail)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await run(() => requestCode(value))
    setBusy(false)
    if (res.ok) onSent(value.trim())
    else setError(res.error)
  }

  return (
    <form onSubmit={submit} noValidate>
      <p className="login-sub">Use your JOOLA email — we&apos;ll send you a one-time code.</p>
      <div className="login-field">
        <label htmlFor="login-email">Work email</label>
        <input
          id="login-email" className="login-input" type="email" autoComplete="email"
          required autoFocus placeholder="you@joola.com" value={value}
          onChange={e => setValue(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'login-email-error' : undefined}
        />
        {error && <p id="login-email-error" className="login-error" role="alert">{error}</p>}
      </div>
      <button type="submit" className="btn btn-yellow login-submit" disabled={busy}>
        {busy ? 'Sending…' : 'Send code'}
      </button>
    </form>
  )
}

interface CodeStepProps {
  email: string
  resendAt: number
  onResent: () => void
  onBack: () => void
  onSignedIn: () => void
}

function CodeStep({ email, resendAt, onResent, onBack, onSignedIn }: CodeStepProps) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<'verify' | 'resend' | null>(null)
  const secondsLeft = useCountdown(resendAt)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('verify')
    setError('')
    setNotice('')
    const res = await run(() => verifyCode(email, code))
    if (res.ok) { onSignedIn(); return } // keep busy: the page is navigating away
    setBusy(null)
    setError(res.error)
  }

  const resend = async () => {
    setBusy('resend')
    setError('')
    setNotice('')
    const res = await run(() => requestCode(email))
    setBusy(null)
    if (res.ok) { onResent(); setNotice('A new code is on its way.') }
    else setError(res.error)
  }

  return (
    <form onSubmit={submit} noValidate>
      <p className="login-sub">We sent a 6-digit code to <strong>{email}</strong></p>
      <div className="login-field">
        <label htmlFor="login-code">6-digit code</label>
        <input
          id="login-code" className="login-input login-code" type="text"
          inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6}
          required autoFocus value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'login-code-error' : undefined}
        />
        {error && <p id="login-code-error" className="login-error" role="alert">{error}</p>}
        {notice && <p className="login-notice" role="status">{notice}</p>}
      </div>
      <button type="submit" className="btn btn-yellow login-submit" disabled={busy !== null}>
        {busy === 'verify' ? 'Checking…' : 'Sign in'}
      </button>
      <div className="login-links">
        <button type="button" className="login-link" onClick={resend} disabled={busy !== null || secondsLeft > 0}>
          {busy === 'resend' ? 'Sending…' : secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}
        </button>
        <button type="button" className="login-link" onClick={onBack} disabled={busy !== null}>
          Use a different email
        </button>
      </div>
    </form>
  )
}
