# Login, Working Date Filter, Speed & Data Catch-up Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** JOOLA-only email-OTP login (7-day sessions, zero cost), a date
picker that drives every page, pages that load in under 2 s for ~50 users, and
a pipeline that can catch up the stale data on demand.

**Architecture:** Supabase Auth email OTP, sent through Brevo's free SMTP, is
gated by a Next.js `middleware.ts` (page gate only; no RLS, decision D3). Date
state shrinks to a single From–To. Pages stop downloading raw rows and call
read-only Postgres functions that take `(from, to, brands)`, cached in the
browser with SWR. The pipeline fixes are small Python changes plus a workflow
step; the catch-up run happens only on the owner's explicit instruction.

**Tech stack:** Next.js 14.2.5 (App Router, all v2 pages `'use client'`),
`@supabase/supabase-js` 2.45, new `@supabase/ssr` and `swr`, Postgres
(Supabase Free), Brevo SMTP (free), Playwright e2e, new `vitest` for pure
helpers, pytest for `backend/`.

**Design doc:** [`../superpowers/specs/2026-10-17-auth-datefilter-performance-design.md`](../superpowers/specs/2026-10-17-auth-datefilter-performance-design.md)
(decisions D1–D10, risks).

---

## Ground rules for whoever executes this

- **Repo shape:** the Next app is in `frontend/`. Always prefix paths with
  `frontend/`. Python lives in `backend/scraping/`, SQL in `migrations/`.
- **Another session may have uncommitted work** in this tree (on 2026-10-17:
  `TODO.md`, `populate_product_mentions.py`, `community-intel/page.tsx`,
  `communityIntel.ts`, `migrations/028_*`, `docs/db-discovery-*.md`). Run
  `git status` first, and commit **only** the files your task touches. Never
  `git add -A`, and never use `npm run deploy` (it runs `git add -A`).
- **Pushing runs `.husky/pre-push`** (the full QA suite, ~10 min). It needs a
  dev server on :3000, or the suite reports "INCOMPLETE" and blocks. Never use
  `--no-verify`.
- **Typecheck:** run `npx tsc --noEmit` from `frontend/`.
- **Database changes are additive only.** Every migration gets a
  `migrations/NNN_rollback.sql`. The owner applies SQL in the Supabase SQL
  editor; you write it and verify it, but never run DDL against production
  yourself.
- **Nothing runs the data pipeline** unless the owner says "go" in the
  conversation (Task 6).
- **Commit messages:** conventional (`feat:`, `fix:`, `perf:` …), ending with
  the Co-Authored-By line from the session's system reminder.

---

## Phase 0 — Pipeline fixes (no data is touched)

### Task 1: Stop `run_sync` from hiding the real error

**Why:** `run_sync()` catches *every* `RuntimeError`, including one raised
*inside* the coroutine, and then calls `asyncio.run(coro)` on a coroutine that
has already been awaited. The user sees `cannot reuse already awaited
coroutine` instead of the real failure, which has broken the inventory step
every week since Sep 14. The real failure is almost certainly crawl4ai's
Chromium missing on the GitHub runner (see Task 3).

**Files:**
- Modify: `backend/scraping/core/crawl4ai_client.py:96-107`
- Test: `backend/tests/test_run_sync.py` (new)

**Step 1: Write the failing tests**

```python
"""run_sync must surface the coroutine's own error, never re-await it."""
import asyncio
import threading

import pytest

from backend.scraping.core.crawl4ai_client import run_sync


async def _boom():
    raise RuntimeError("chromium executable not found")


async def _ok():
    return 42


def test_returns_value_from_main_thread():
    assert run_sync(_ok()) == 42


def test_returns_value_from_worker_thread():
    out = {}
    t = threading.Thread(target=lambda: out.setdefault("v", run_sync(_ok())))
    t.start(); t.join()
    assert out["v"] == 42


def test_inner_runtime_error_is_not_masked():
    with pytest.raises(RuntimeError, match="chromium executable not found"):
        run_sync(_boom())


def test_inner_runtime_error_in_worker_thread_is_not_masked():
    err = {}
    def work():
        try:
            run_sync(_boom())
        except RuntimeError as e:
            err["msg"] = str(e)
    t = threading.Thread(target=work); t.start(); t.join()
    assert err["msg"] == "chromium executable not found"


def test_works_when_a_loop_is_already_running():
    async def outer():
        return run_sync(_ok())
    assert asyncio.run(outer()) == 42
```

**Step 2: Run them and confirm the masking tests fail**

Run: `python -m pytest backend/tests/test_run_sync.py -v`
Expected: the two `..._is_not_masked` tests FAIL, with `cannot reuse already
awaited coroutine`.

**Step 3: Minimal implementation**

Replace `run_sync` with:

```python
def run_sync(coro) -> Any:
    """Run an async coroutine from synchronous code.

    Decide how to run *before* touching the coroutine, so an error raised
    inside it propagates unchanged. (The old version caught every
    RuntimeError, including the coroutine's own, and re-ran an already-awaited
    coroutine, which hid the real failure.)
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)          # no loop in this thread: the normal case
    import concurrent.futures             # a loop is running: use a fresh thread
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()
```

**Step 4: Run all backend tests**

Run: `python -m pytest backend/tests -q`
Expected: all pass, including the 5 new tests.

**Step 5: Commit**

```bash
git add backend/scraping/core/crawl4ai_client.py backend/tests/test_run_sync.py
git commit -m "fix(scraping): stop run_sync masking errors as 'cannot reuse already awaited coroutine'"
```

### Task 2: The local catalog must fail loudly without Playwright

**Files:**
- Modify: `backend/scraping/sources/products/scrape_catalog_local.py:681-686`
- Test: `backend/tests/test_catalog_local_requires_playwright.py` (new)

**Step 1: Failing test**

```python
import builtins

import pytest

from backend.scraping.sources.products import scrape_catalog_local as mod


def test_missing_playwright_raises(monkeypatch):
    real_import = builtins.__import__
    def fake_import(name, *a, **k):
        if name.startswith("playwright"):
            raise ImportError("No module named 'playwright'")
        return real_import(name, *a, **k)
    monkeypatch.setattr(builtins, "__import__", fake_import)
    with pytest.raises(RuntimeError, match="playwright"):
        mod.run({"dry_run": False, "brands": None})
```

(If `run()` returns early on an earlier guard before the import, for example a
brand filter, read lines 660-680 and pass a `ctx` that reaches the import.)

**Step 2:** Run: `python -m pytest backend/tests/test_catalog_local_requires_playwright.py -v`
Expected: FAIL, because `run` returns 0.

**Step 3: Implementation.** Replace the `except ImportError:` branch with:

```python
    except ImportError as e:
        raise RuntimeError(
            "playwright not installed — run: pip install playwright && "
            "python -m playwright install --with-deps chromium"
        ) from e
```

The runner records a raised exception as a **failed** step. Before this change
the step was reported "done rows=0" for 6 brands every week.

**Step 4:** Run: `python -m pytest backend/tests -q` → all pass.

**Step 5: Commit**

```bash
git add backend/scraping/sources/products/scrape_catalog_local.py backend/tests/test_catalog_local_requires_playwright.py
git commit -m "fix(scraping): fail the local catalog step when Playwright is missing"
```

### Task 3: Give the manual workflow a browser, and let analytics run after a partial success

**Files:** Modify `.github/workflows/weekly-pipeline.yml`

**Step 1.** After "Install analytics_backend dependencies", add:

```yaml
      - name: Install Playwright Chromium (local catalog + crawl4ai)
        run: |
          python -m playwright install --with-deps chromium
          crawl4ai-setup || true
```

**Step 2.** In "Backend scraping pipeline", capture exit code 2 (partial
success) so analytics still runs, matching `scripts/weekly_run.py`:

```yaml
        id: scrape
        run: |
          set +e
          python -m backend.scraping.run --module all --restart ${{ steps.stage.outputs.dry_flag }}
          code=$?
          echo "code=$code" >> "$GITHUB_OUTPUT"
          if [ $code -ne 0 ] && [ $code -ne 2 ]; then exit $code; fi
```

Change the analytics step's `if:` to
`contains(fromJSON('["all", "analytics-only"]'), steps.stage.outputs.stage) && !cancelled()`.

Add a final step that fails the job when the scrape returned 2, so a partial
run is still visibly red:

```yaml
      - name: Fail if scraping was partial
        if: steps.scrape.outputs.code == '2'
        run: |
          echo "::error::Scraping finished with failed steps (exit 2). See logs."
          exit 1
```

**Step 3: Verify the YAML parses**

Run: `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/weekly-pipeline.yml')); print('ok')"`
Expected: `ok`. Also confirm with `grep -c cron .github/workflows/weekly-pipeline.yml` → `0`.
The schedule must stay removed (D1).

**Step 4: Commit**

```bash
git add .github/workflows/weekly-pipeline.yml
git commit -m "ci: install Chromium and run analytics after a partial scrape"
```

### Task 4: Local smoke test of the fixed inventory step (read-only)

Run: `python -m backend.scraping.run --module sales-intelligence --source scrape-inventory-crawl4ai --dry-run`
Expected: the plan prints for all brands, with no exception.

**Do not run it without `--dry-run`.** That is Task 6.

### Task 5: Push Phase 0

Start the dev server (`cd frontend && npx next dev -p 3000`), then
`git push origin main` (the pre-push suite runs), then stop the dev server.

### Task 6: Catch-up run — ONLY after the owner says "go"

Ask the owner first: "Ready to run the catch-up (sales-intelligence, reviews,
specs, analytics)? It calls Apify/crawl4ai and writes to the database."
Proceed only on an explicit yes.

```bash
python scripts/weekly_run.py --module sales-intelligence
python scripts/weekly_run.py --module reviews-crawl4ai --resume
python scripts/weekly_run.py --module product-specs --resume
python -m analytics_backend.run --module all
```

Then verify the freshness (the expected newest date is the run day):

```bash
python - <<'EOF'
import os,requests
from dotenv import load_dotenv; load_dotenv(".env")
U=os.environ["SUPABASE_URL"];K=os.environ["SUPABASE_SERVICE_ROLE_KEY"];H={"apikey":K,"Authorization":f"Bearer {K}"}
for t,c in [("product_snapshots","snapshot_time"),("sales_estimates","created_at"),("paddle_reviews","scraped_at"),("paddle_specs","scraped_at")]:
    r=requests.get(f"{U}/rest/v1/{t}?select={c}&order={c}.desc&limit=1",headers=H).json()
    print(t, r[0][c] if r else None)
EOF
```

Report the exit codes, failed steps and row counts to the owner.

---

## Phase 1 — Login (Supabase Auth email OTP, page gate)

### Task 7: Owner's one-off setup (written instructions; you cannot do these)

Give the owner this checklist and wait until they confirm:

1. **Brevo:** create a free account, verify the sender address (e.g.
   `intel@joola.com`, or any JOOLA mailbox they can click a link in), then
   copy the SMTP key from SMTP & API → SMTP.
2. **Supabase → Authentication → SMTP Settings:** enable custom SMTP. Host
   `smtp-relay.brevo.com`, port `587`, the user is the Brevo login, the
   password is the SMTP key, the sender is the verified address and the name
   is "JOOLA Intel".
3. **Supabase → Authentication → Providers → Email:** enable it, turn
   **Confirm email** OFF, set **Email OTP Expiration** to `600`, and set
   **Email OTP Length** to `6`.
4. **Supabase → Authentication → Email Templates → Magic Link:** set the
   subject to `Your JOOLA Intel code`, and the body to:
   `<p>Your JOOLA Intel sign-in code is <strong>{{ .Token }}</strong>.</p><p>It expires in 10 minutes. If you didn't request it, ignore this email.</p>`
5. **Supabase → Authentication → URL Configuration:** set the Site URL to
   `https://saas-joola-intel.vercel.app` and add `http://localhost:3000` to
   the redirect URLs.
6. **Supabase → Authentication → Rate Limits:** set emails per hour to 30.

### Task 8: Pure domain and session rules (TDD)

**Files:**
- Create: `frontend/lib/auth/rules.ts`
- Test: `frontend/lib/auth/rules.test.ts`
- Modify: `frontend/package.json` (add a `"test": "vitest run"` script)
- Create: `frontend/vitest.config.ts`

**Step 1: Install vitest (free, dev only)**

Run: `cd frontend && npm i -D vitest@^2`

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'
export default defineConfig({
  test: { include: ['lib/**/*.test.ts'], environment: 'node' },
  resolve: { alias: { '@': path.resolve(__dirname) } },
})
```

**Step 2: Failing tests**, in `lib/auth/rules.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeEmail, isAllowedEmail, isSessionExpired, SESSION_MAX_MS } from './rules'

describe('isAllowedEmail', () => {
  it('accepts joola.com and joola.in, any case, trimmed', () => {
    expect(isAllowedEmail('A.B@JOOLA.com')).toBe(true)
    expect(isAllowedEmail('  x@joola.in ')).toBe(true)
  })
  it('rejects other domains and lookalikes', () => {
    for (const e of ['x@gmail.com', 'x@joola.com.evil.io', 'x@notjoola.com',
                     'x@sub.joola.com', 'joola.com@gmail.com', 'x@joola.co', '', 'x'])
      expect(isAllowedEmail(e)).toBe(false)
  })
})

describe('normalizeEmail', () => {
  it('trims and lowercases', () => expect(normalizeEmail(' A@Joola.IN ')).toBe('a@joola.in'))
})

describe('isSessionExpired', () => {
  const now = Date.parse('2026-10-20T00:00:00Z')
  it('is false inside 7 days', () =>
    expect(isSessionExpired(String(now - SESSION_MAX_MS + 1000), now)).toBe(false))
  it('is true after 7 days', () =>
    expect(isSessionExpired(String(now - SESSION_MAX_MS - 1), now)).toBe(true))
  it('treats a missing or garbage cookie as expired', () => {
    expect(isSessionExpired(undefined, now)).toBe(true)
    expect(isSessionExpired('abc', now)).toBe(true)
  })
})
```

**Step 3:** Run: `npx vitest run lib/auth` → FAIL (module not found).

**Step 4: Implementation** (`lib/auth/rules.ts`):

```ts
/** Email domains allowed to sign in (D6). Keep in sync with migrations/029. */
export const ALLOWED_DOMAINS = ['joola.com', 'joola.in'] as const
/** Session lifetime (D5). Enforced in middleware: Supabase Free can't time-box sessions. */
export const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000
// (Superseded in review: no cookie. Session age comes from user.last_sign_in_at;
//  see commit after 60b11c5. Also added parseAllowedEmail + strict regex.)

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isAllowedEmail(email: string): boolean {
  const e = normalizeEmail(email)
  const at = e.lastIndexOf('@')
  if (at <= 0 || e.indexOf('@') !== at) return false
  return (ALLOWED_DOMAINS as readonly string[]).includes(e.slice(at + 1))
}

export function isSessionExpired(signedInAt: string | undefined, now = Date.now()): boolean {
  const t = Number(signedInAt)
  if (!signedInAt || !Number.isFinite(t)) return true
  return now - t > SESSION_MAX_MS
}
```

**Step 5:** `npx vitest run lib/auth` → PASS. **Commit:**
`feat(auth): domain + 7-day session rules`.

### Task 9: Supabase SSR clients

**Files:**
- Create: `frontend/lib/auth/supabase-server.ts`
- Create: `frontend/lib/auth/supabase-middleware.ts`

Run `cd frontend && npm i @supabase/ssr@^0.5`.

`supabase-server.ts`, for server actions:

```ts
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

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
```

`supabase-middleware.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/** Returns the refreshed response plus the user (or null). */
export async function getSessionInMiddleware(req: NextRequest) {
  let res = NextResponse.next({ request: req })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => req.cookies.set(name, value))
          res = NextResponse.next({ request: req })
          list.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
        },
    } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  return { res, user, supabase }
}
```

Typecheck: `npx tsc --noEmit` → clean. **Commit:** `feat(auth): supabase ssr clients`.

### Task 10: Middleware gate

**Files:** Create `frontend/middleware.ts`

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { getSessionInMiddleware } from '@/lib/auth/supabase-middleware'
import { isAllowedEmail, isSessionExpired } from '@/lib/auth/rules'

export async function middleware(req: NextRequest) {
  const { res, user, supabase } = await getSessionInMiddleware(req)
  // Session age comes from the server-verified user record, never a cookie (review of Task 8).
  const ok = !!user && !!user.email && isAllowedEmail(user.email) && !isSessionExpired(user.last_sign_in_at)
  if (ok) return res

  if (user) await supabase.auth.signOut()            // expired or foreign: end it
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`
  return NextResponse.redirect(url)
}

export const config = { matcher: ['/v2/:path*', '/api/:path*', '/'] }
```

Manual check: `npx next dev`, open `/v2/overview` → redirected to
`/login?next=%2Fv2%2Foverview`. `curl -i localhost:3000/api/seo-analyzer -X POST` → 401.
**Commit:** `feat(auth): middleware gate for /v2 and /api`.

### Task 11: Login page + server actions

**Files:**
- Create: `frontend/app/login/actions.ts`
- Create: `frontend/app/login/page.tsx`
- Modify: `frontend/app/v2.css` (append a `.login-*` block)

`actions.ts`:

```ts
'use server'
import { createAuthServerClient } from '@/lib/auth/supabase-server'
import { parseAllowedEmail } from '@/lib/auth/rules'

export type ActionResult = { ok: true } | { ok: false; error: string }

export async function requestCode(rawEmail: string): Promise<ActionResult> {
  const email = parseAllowedEmail(rawEmail)
  if (!email) return { ok: false, error: 'Use your @joola.com or @joola.in email.' }
  const { error } = await createAuthServerClient().auth.signInWithOtp({
    email, options: { shouldCreateUser: true },
  })
  if (error) return { ok: false, error: error.status === 429
    ? 'Too many codes requested. Try again in a few minutes.'
    : 'Could not send the code. Try again shortly.' }
  return { ok: true }
}

export async function verifyCode(rawEmail: string, token: string): Promise<ActionResult> {
  const email = parseAllowedEmail(rawEmail)
  if (!email || !/^\d{6}$/.test(token)) return { ok: false, error: 'Enter the 6-digit code.' }
  const { error } = await createAuthServerClient().auth.verifyOtp({ email, token, type: 'email' })
  if (error) return { ok: false, error: 'That code is wrong or expired.' }
  return { ok: true }   // verifyOtp updates user.last_sign_in_at, which middleware checks
}

export async function signOut(): Promise<void> {
  await createAuthServerClient().auth.signOut()
}
```

`page.tsx`: a `'use client'` two-step form.
- **Step "email":** an email input. On submit, call `requestCode`. Show the
  error text under the input, then switch to the "code" step.
- **Step "code":** a 6-digit numeric input (`inputMode="numeric"`,
  `autoComplete="one-time-code"`, `maxLength={6}`). On submit, call
  `verifyCode` and then `window.location.assign(next)`, where `next` comes from
  `useSearchParams().get('next')` and is **accepted only when it starts with
  `/v2`** (to prevent open redirects). Otherwise use `/v2/overview`.
- Offer a "Resend code" button that is disabled for 60 s after each send, and
  "Use a different email".
- Visuals: the JOOLA "J" mark, yellow `#F5E625` accent, dark card. Reuse
  existing `.card` / `.btn btn-yellow` classes from `v2.css`, and add only a
  small `.login-wrap` centering block. Every input has a `<label>`, and the
  error messages use `role="alert"`.

Typecheck, then manually test with the owner's real JOOLA email: the code
arrives, entering it lands on the original page, and a wrong code shows an
error. **Commit:** `feat(auth): login page with email OTP`.

### Task 12: Database hook that rejects foreign domains

**Files:**
- Create: `migrations/029_auth_domain_hook.sql`
- Create: `migrations/029_rollback.sql`

```sql
-- 029_auth_domain_hook.sql — only @joola.com / @joola.in may create accounts.
-- Register after applying: Supabase → Authentication → Hooks →
-- "Before User Created" → Postgres function public.hook_joola_domain_only.
create or replace function public.hook_joola_domain_only(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare email text := lower(coalesce(event->'user'->>'email', ''));
begin
  if email ~ '^[^@]+@(joola\.com|joola\.in)$' then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403, 'message', 'Only JOOLA email addresses can sign in.'));
end $$;

grant execute on function public.hook_joola_domain_only(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_joola_domain_only(jsonb) from authenticated, anon, public;
```

Rollback: `drop function if exists public.hook_joola_domain_only(jsonb);`
(unregister the hook in the dashboard first).

Verify in the SQL editor (the owner runs it):
`select public.hook_joola_domain_only('{"user":{"email":"x@gmail.com"}}');` → an error object;
with `a@joola.in` → `{}`. **Commit:** `feat(auth): db hook restricting sign-ups to joola domains`.

### Task 13: Sign out in the sidebar

**Files:** Modify `frontend/components/v2/Sidebar.tsx` (the `sidebar-foot` block).

Add a small "Sign out" button that calls `signOut()` from `@/app/login/actions`
and then `window.location.assign('/login')`. It sits next to "Live data", and
shows icon-only when the sidebar is collapsed, with `aria-label="Sign out"`.
**Commit:** `feat(auth): sign-out in sidebar`.

### Task 14: Keep QA working behind the gate

**Files:**
- Create: `frontend/e2e/auth.setup.ts`
- Modify: `frontend/playwright.config.ts`
- Modify: `frontend/qa/regression.ps1` (the route smoke stage)
- Create: `frontend/e2e/auth.spec.ts`

- `auth.setup.ts`, a Playwright "setup" project:
  1. Use `SUPABASE_SERVICE_ROLE_KEY` + `QA_LOGIN_EMAIL` (for example
     `qa-bot@joola.in`, created once by the owner) to call
     `supabase.auth.admin.generateLink({ type: 'magiclink', email })`.
  2. Take `properties.email_otp`, open `/login`, fill in the email, and fill
     in that code. This exercises the real form; it doesn't send an email,
     because generateLink returns the OTP directly.
  3. Save `storageState` to `qa/.auth/state.json` (gitignored).
- `playwright.config.ts`: add `{ name: 'setup', testMatch: /auth\.setup\.ts/ }`.
  The chromium project gets `dependencies: ['setup']` and
  `use: { storageState: 'qa/.auth/state.json' }`.
- `regression.ps1` route smoke: run the Playwright request context with that
  storage state, or replace the HTTP GET loop with
  `npx playwright test e2e/smoke.spec.ts`. An unauthenticated GET now returns
  a 307 to `/login`, and the stage must treat that as a failure only for
  pages, not for `/login` itself.
- `auth.spec.ts` (runs **without** the stored state):
  - `/v2/overview` → lands on `/login`
  - `x@gmail.com` → "Use your @joola.com…"
  - code `000000` → "wrong or expired"
  - `/api/seo-analyzer` POST → 401

Run the full `npm run qa:fast` with a dev server → PASS. **Commit:**
`test(auth): authenticated QA session + gate tests`.

### Task 15: Ship the login

Set Vercel env vars: none are new for the browser. Add
`SUPABASE_SERVICE_ROLE_KEY` + `QA_LOGIN_EMAIL` **only** to local `.env.local`
for QA; they never go to Vercel. Push through the hook, then verify on
production:
- unauthenticated `/v2/overview` → `/login`
- the owner signs in with a real code
- `isSessionExpired` unit tests cover the 7-day cut-off (it can't be forged from the browser).

---

## Phase 2 — One date state that every page follows

### Task 16: Pure date-window helpers (TDD)

**Files:**
- Create: `frontend/lib/v2/dateWindow.ts`
- Test: `frontend/lib/v2/dateWindow.test.ts`

Tests to write first:
- `toQueryBounds(from, to)` returns ISO strings where the upper bound is
  **the start of the day after To**, in IST (`Asia/Kolkata`), so a row posted
  at 23:30 IST on To is included.
- `presetWindow('30d', anchor)` returns `[anchor - 29 days, anchor]`, and
  `'all'` returns `[2000-01-01, anchor]`.
- `formatWindow(from, to)` → `"Jul 14 – Oct 12, 2026"`. In the same year it
  omits the first year; across years it includes both.
- `isoDay(d)` gives the IST calendar day (fixes the `toISOString().slice(0,10)`
  off-by-one at `community-intel/page.tsx:374`).

Implementation notes: use `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })`
for day keys. Don't add a date library (YAGNI).

Run `npx vitest run lib/v2/dateWindow` → PASS. **Commit.**

### Task 17: Latest-data-date RPC

**Files:**
- Create: `migrations/030_dashboard_rpcs_base.sql` + `030_rollback.sql`

```sql
create or replace function public.rpc_latest_data_date()
returns date language sql stable security invoker as $$
  select max(d)::date from (
    select max(scraped_at) d from public.ig_profiles_weekly
    union all select max(scraped_at) from public.reddit_mentions
    union all select max(scraped_at) from public.news_articles
    union all select max(last_scraped_at) from public.products
  ) s
$$;
grant execute on function public.rpc_latest_data_date() to anon, authenticated;
```

Verify: `select public.rpc_latest_data_date();` → `2026-10-12` (or later,
after the catch-up).

### Task 18: Rewrite `DateRangeContext` as From–To only

**Files:**
- Modify: `frontend/lib/v2/DateRangeContext.tsx` (full rewrite)
- Modify: `frontend/components/v2/DateRangePicker.tsx`
- Delete: `frontend/components/v2/DateRangeDropdown.tsx` (never mounted)

New context shape:

```ts
type DateRangeCtx = {
  from: Date; to: Date                       // inclusive calendar days
  setWindow: (from: Date, to: Date) => void
  applyPreset: (p: '7d' | '30d' | '90d' | 'all') => void
  latestDataDate: Date | null                // from rpc_latest_data_date
  label: string                              // formatWindow(from, to)
  bounds: { gte: string; lt: string }        // toQueryBounds(from, to)
}
```

- On first mount, call `rpc_latest_data_date` (via SWR, Task 20). Default to
  `presetWindow('90d', latestDataDate)`.
- **One-time migration:** delete `joola-date-range`, `joola-date-mode`,
  `joola-date-from` and `joola-date-to`, then persist **only**
  `joola-window-v2 = {from,to}`. A saved window older than the latest data
  date stays as the user chose it.
- **Temporary compatibility exports**, so pages compile while being migrated
  in Phase 3:
  - `effectiveFrom = from` and `effectiveTo = to`
  - `range: 'custom'` and `maxDays: null`
  - `applyDateRangeCustom` delegates to an inclusive version
  - `DATE_RANGE_LABEL` is replaced by `label`; each page's label usage is
    updated as that page is migrated

  Mark the compatibility exports `@deprecated`; Task 31 deletes them.
- Picker: two date inputs + 4 quick buttons (7d / 30d / 90d / All). From
  can't be after To. The max is today; a hint shows "Data through Oct 12".

Manual check: change the dates; `label` updates in every page header. Run
`npx tsc --noEmit` → clean. **Commit:** `feat(date): single From–To window anchored to latest data`.

---

## Phase 3 — Data layer: RPCs + SWR, page by page

### Task 19: Parallel `fetchPaged`

**Files:** Modify `frontend/lib/v2/paged.ts:77-126`. Test in `frontend/lib/v2/paged.test.ts`.

Tests first, with a fake `build()` that records `.range()` calls and returns
canned pages:
- 2,500 rows → 3 ranges, and all of them start **before** any resolves
  (assert with a deferred-promise fake)
- a short page ends the read
- an error page sets `ok=false` and keeps the rows before it
- `maxRows` is still honoured.

Implementation: the first request is a `count: 'estimated'` head. Then fire
`Math.ceil(min(count, maxRows) / 1000)` ranges with `Promise.all`, in batches
of 6, and concatenate them in order. If the count is unavailable, fall back
to the current serial loop. **Commit:** `perf(data): fetch pages in parallel`.

### Task 20: SWR + typed RPC hook

**Files:**
- `npm i swr@^2`
- Create: `frontend/lib/v2/useRpc.ts`
- Create: `frontend/lib/v2/SwrProvider.tsx`
- Modify: `frontend/app/v2/layout.tsx` (wrap the children)

```ts
// useRpc.ts
'use client'
import useSWR, { type SWRConfiguration } from 'swr'
import { supabase } from '@/lib/shared/supabase'
import { useDateRange } from '@/lib/v2/DateRangeContext'
import { useBrandFilter } from '@/lib/v2/BrandFilterContext'

const SIX_HOURS = 6 * 60 * 60 * 1000

/** Calls a dashboard RPC with the active window + brand filter; cached per (fn, window, brands). */
export function useRpc<T>(fn: string, extra: Record<string, unknown> = {}, cfg: SWRConfiguration = {}) {
  const { bounds } = useDateRange()
  const { filteredBrands, isFiltered } = useBrandFilter()
  const brandIds = isFiltered ? filteredBrands.map((b) => b.brand_id).sort() : null
  const args = { p_from: bounds.gte, p_to: bounds.lt, p_brands: brandIds, ...extra }
  return useSWR<T>(['rpc', fn, JSON.stringify(args)], async () => {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) throw error
    return data as T
  }, { revalidateOnFocus: false, dedupingInterval: SIX_HOURS, keepPreviousData: true, ...cfg })
}
```

`SwrProvider.tsx` sets a global `SWRConfig` with `provider: () => new Map()`,
persisted to `sessionStorage` on `beforeunload` (wrapped in try/catch), so a
reload within the tab reuses the cache. Brand IDs must follow the
`isFiltered` contract (CLAUDE.md invariant 2): `null` means all brands.

### Task 21–30: Migrate each page (same recipe, heaviest first)

**The recipe, for every page:**

1. **Inventory.** List each fetcher the page calls and the numbers it derives
   from them. Note which numbers are *activity* (filtered by the window) and
   which are *snapshots* (as of To).
2. **Baseline.** With the current code, pick a fixed window (Jul 14 – Oct 12)
   and all brands, and record the KPIs and the first 5 rows of every table in
   `docs/plans/baselines/<page>.md`. Record the time-to-content in DevTools
   (Fast 4G, cache disabled).
3. **Write the RPC** in `migrations/0NN_rpc_<area>.sql`, with a rollback file.
   - **Signature:** `(p_from timestamptz, p_to timestamptz, p_brands uuid[] default null) returns jsonb`,
     `stable security invoker`, `grant execute … to anon, authenticated`.
   - **Activity:** `where posted_at >= p_from and posted_at < p_to and (p_brands is null or brand_id = any(p_brands))`.
   - **Snapshots:** `distinct on (brand_id) … where scraped_at < p_to order by brand_id, scraped_at desc`.
   - **Top-N:** order inside the window, `limit` inside the SQL.
   - **Aggregates:** `count(*) filter (where …)` and `group by`, so no row
     text ever leaves the database.
   - **Column names:** use the real ones. Check
     `docs/DATABASE_REFERENCE.md`, e.g. `reddit_mentions.post_title /
     content_text / upvotes / post_url`. The 2026-10-02 Reddit outage came
     from guessed names.
   - **Engagement rate:** keep the `followers >= 50` filter (CLAUDE.md
     invariant 3).
4. **Indexes.** For each table the RPC scans, add
   `create index concurrently if not exists <t>_brand_posted_idx on <t>(brand_id, posted_at)`
   if `EXPLAIN` shows a seq scan on >5k rows.
5. **Parity check.** The owner runs the RPC for the baseline window, and you
   compare it with the baseline file. Every difference must be explained
   (e.g. the old code dropped the To day, or capped at 1,000 rows); otherwise
   fix the SQL.
6. **Switch the page** to `useRpc`. Remove its raw fetchers (delete them from
   `lib/v2/*` once no page uses them). Replace `DATE_RANGE_LABEL[...]` with
   `label`. Recompute share-of-voice from the filtered list (CLAUDE.md
   invariant 1). Wrap derived arrays in `useMemo`. Use
   `next/dynamic` for modals and below-fold sections.
7. **Test.** Add an e2e test that changes the window and asserts that a KPI's
   text changes. Run `npx tsc --noEmit` and `npm run qa:fast`.
8. **Measure.** Repeat the step-2 timing, and put before/after in the commit
   body.
9. **Commit** one page per commit: `perf(<page>): read <area> via rpc, follow date window`.

**Order and the specific hotspots to remove** (from the 2026-10-17 audit):

| Task | Page | RPC | Hotspots to delete |
|---|---|---|---|
| 21 | community-intel | `rpc_community` | 4×10k + 20k paged text reads, `count:'exact'` on mention_facts, a 3-stage waterfall, unmemoized KPI block (`page.tsx:340-370`), To-day drop (`communityIntel.ts:270`) |
| 22 | sales-intel (+ brand) | `rpc_sales` | 5-stage waterfall, `product_snapshots` read twice at 10k, `products_catalog` ×5, the page's own extra Supabase client (`page.tsx:163`) |
| 23 | influencers (+ brand, player) | `rpc_influencers` | `mention_facts` read 3× (10k/20k/10k), 4-stage waterfall, detail pages loading everything, To-day drop (`influencerIntel.ts:443`) |
| 24 | reddit (+ brand) | `rpc_reddit` | `reddit_mentions` paged to 20k four times with text; `fetchTopRedditMentions` driven by `maxDays` only |
| 25 | overview | `rpc_overview` | 9 fetchers, `fetchCommentCounts` paging 50k rows to count |
| 26 | market | `rpc_market` | 11 fetchers; `fetchMarketIntel` 2×20k fixed at 30 days; date label without filtering |
| 27 | instagram / youtube / tiktok / twitter (+ brand pages) | `rpc_social(p_channel)` | all-time top-200-by-engagement filtered on the client; undated KPI aggregates |
| 28 | product-intel (+ brand, product, leaderboard) | `rpc_product` | 7 paged reads, `fetchCustomerVoice` count + manual paging, fixed 7/30/60/90d windows |
| 29 | campaign-offer-intel (+ brand) | `rpc_campaign` | `fetchCampaignIntel` without dates, 30-day fixed matrix, hardcoded 90 days on the brand page |
| 30 | data-health | `rpc_table_stats` | 34 serial `count:'exact'` queries. Replace with one RPC over `pg_class.reltuples` + `max(scraped_at)` per table (estimates are fine here) |

### Task 31: Remove the compatibility layer

Once all pages are migrated:
- Delete the deprecated exports from `DateRangeContext.tsx`: `maxDays`,
  `range`, `applyDateRange`, `applyDateRangeCustom`, `DATE_RANGE_LABEL` and
  `effectiveFrom/To`.
- `grep -rn "maxDays\|applyDateRange\|DATE_RANGE_LABEL" frontend/app frontend/lib frontend/components` → no hits.
- Typecheck, then `qa:fast`. **Commit.**

---

## Phase 4 — Small speed fixes (independent; any order)

### Task 32: Sidebar crisis badge without an exact count

`frontend/components/v2/Sidebar.tsx:77-84`: switch to
`useRpc('rpc_crisis_count_7d')` (a tiny SQL function), or `count: 'estimated'`.
It's cached by SWR, so it runs once per session, not on every navigation.

### Task 33: Dev-only `agentation`

`frontend/components/v2/AgentationFeedback.tsx`: load it with
`dynamic(() => import('agentation'), { ssr: false })`, rendered only when
`process.env.NODE_ENV !== 'production'`. Verify with
`npx next build`: the shared first-load JS shrinks, which you record.

### Task 34: Fix the silent 1,000-row caps

`grep -rn "\.limit([2-9][0-9]\{3\}\|\.limit(1[0-9]\{4\}" frontend/lib frontend/app`.
Each hit returns at most 1,000 rows from PostgREST. Move each one to its
page's RPC (Phase 3); if it survives Phase 3, switch it to `fetchPaged`.

### Task 35: Production bundle check

`npm i -D @next/bundle-analyzer`, then `ANALYZE=true npx next build`. Lazy-load
anything over 50 kB that isn't above the fold. Record the before/after
first-load JS per page.

---

## Phase 5 — Docs and close-out

### Task 36: Update docs (one home per fact; see CLAUDE.md)

- `docs/ARCHITECTURE.md`:
  - login flow (middleware, `/login`, the hook)
  - the RPC data layer + SWR
  - the date window
  - the manual-only pipeline
- `BRD.md`:
  - access is restricted to JOOLA domains
  - the date picker drives every page
  - data refreshes on demand (the BRD currently says weekly)
- `TODO.md`:
  - D3 (RLS deferred, accepted risk)
  - the Vercel Hobby licensing decision
  - the JOOLA Pulse dependency if RLS is ever enabled
- `frontend/.env.example`: add `QA_LOGIN_EMAIL` (QA only), and note that the
  SMTP credentials live in Supabase, not in env.
- `backend/README.md`: no weekly cron; how to run the catch-up.

### Task 37: Final verification

Run each command and paste its output. Don't claim success without it:
- `python -m pytest backend/tests -q`
- `cd frontend && npx vitest run && npx tsc --noEmit && npm run qa:fast`
- Production:
  - a not-signed-in visit → `/login`
  - signing in works
  - changing the window changes KPIs on every page
- A table of before/after time-to-content for every page (from Phase 3).

---

## Execution order and checkpoints

| Checkpoint | After task | Owner action |
|---|---|---|
| A | 5 | Review Phase 0; decide on the catch-up (Task 6) |
| B | 7 | Brevo + Supabase dashboard setup done |
| C | 15 | Login live; owner signs in |
| D | 18 | Date picker behaviour approved |
| E | each of 21–30 | Parity numbers + timing per page |
| F | 37 | Final sign-off |
