# JOOLA Intel — Login, working date filter, speed, data catch-up

**Status:** design approved 2026-10-17 · implementation not started
**Owner:** Gyanendu Rout
**Implementation plan:** [`../plans/2026-10-17-auth-datefilter-performance.md`](../plans/2026-10-17-auth-datefilter-performance.md)

---

## 1. Understanding summary

1. **Automatic refresh is off.** The weekly GitHub schedule was removed
   (commit `fae7a21`). Data refreshes only when the owner triggers it.
2. **One-off catch-up.** Bring the stale data current with a manual run:
   Sales Intel stock/prices (last updated Sep 27) and reviews (Sep 22). The
   stock scrape has crashed on every run since Sep 14, so it must be fixed first.
3. **Login.** Every `/v2` page requires sign-in. Only `@joola.com` and
   `@joola.in` addresses are accepted. A 6-digit code is emailed; entering it
   signs the user in for **7 days**. Zero cost.
4. **Page gate only.** The login protects the pages, not the database
   (see the accepted risk in §3).
5. **The date filter works everywhere.** Every page and section follows
   From–To. Activity is counted inside the range; snapshots (followers,
   prices, stock) show their value as of the To date.
6. **Fast for ~50 users.** Each page is usable in under 2 s, and a repeat
   visit from cache takes under 0.5 s, on free tiers.

**Non-goals:** database row-level security; changes to JOOLA Pulse; a
scheduled refresh; per-user roles or permissions; approval lists within the
allowed domains.

## 2. Assumptions

| # | Assumption |
|---|---|
| A1 | Brevo free tier (300 emails/day) with one verified sender address. About 50 users signing in once a week is roughly 1% of the limit. The sender is a setting, not code. |
| A2 | Supabase Free plan: Auth covers 50,000 MAU, and "before user created" Postgres hooks are available. Session time-boxing is a Pro feature, so the 7-day limit is enforced in middleware. |
| A3 | Data changes at most weekly, so cached answers can be reused for 6 h. |
| A4 | Up to ~50 users in the coming months. |
| A5 | JOOLA Pulse keeps reading the same database with the public key. Nothing here changes tables, so Pulse is unaffected. |
| A6 | A scrape captures what sites show on the day it runs. Stock and prices cannot be backdated to Oct 12; reviews come in with their real posted dates. |

## 3. Decision log

| # | Decision | Alternatives considered | Why |
|---|---|---|---|
| D1 | Remove the weekly cron; the workflow is manual-only | Disable it in the GitHub UI | The owner asked for the removal in code; the GitHub token here can't disable workflows (403). |
| D2 | "Make everything Oct 12" = one-off manual catch-up of the stale parts | Date cut-off at Oct 12; both | Owner's choice. |
| D3 | **Page gate only**, no RLS | RLS for real protection; gate now and rules later | Owner's choice. **Accepted risk:** anyone who copies the public key from the browser can still read (and probably write) every table. RLS can be added later without redoing the login, but Pulse would need changing at the same time. |
| D4 | Email via Brevo free tier | Gmail app password; a joola.com mailbox; "not sure" | Owner's choice. Good deliverability with no IT dependency. |
| D5 | Session lasts 7 days | 30 days; 1 day | Owner's choice. |
| D6 | All `@joola.com` / `@joola.in` addresses may sign in | Approved list within the domains | Owner's choice. |
| D7 | Activity counted in range; snapshots shown as of the To date | Filter activity only; presets only | Owner's choice. Keeps custom ranges and makes every number follow the picker. |
| D8 | **Supabase Auth email OTP** + `@supabase/ssr` + middleware | Self-built OTP (hashed codes + `jose` cookie); Auth.js | The least new code, and the security-critical parts (code generation, expiry, single use, rate limits) are battle-tested. Free, and it uses the existing Supabase project. |
| D9 | **Read-only Postgres functions + SWR cache**, page by page | Pass dates into the existing raw queries; pre-built summary tables | The only option that delivers a date filter that works everywhere *and* <2 s pages. Raw queries stay slow on wide ranges; summary tables can't serve arbitrary From–To. |
| D10 | Ship the performance work heaviest-page-first, one page per change | A big-bang rewrite | Each step is testable, revertible and measurable. |
| D11 | No extra anti-abuse on code requests (rely on Supabase's 30 emails/hour limit) | Cloudflare Turnstile; in-app per-IP/daily cap; both | Owner's choice (2026-10-17). **Accepted risk:** a script requesting codes for many @joola addresses could mail-bomb staff and block logins for a while. Fix if it happens: enable Turnstile (free; Supabase Attack Protection). |
| D12 | Session age from `user.last_sign_in_at`, not a cookie | Signed-in-at cookie | Code review: a plain cookie could be edited to extend the 7-day limit. |

## 4. Design

### 4.1 Login

**Flow:** a request without a session → `/login?next=<path>` → email field
(rejects non-JOOLA domains immediately) → 6-digit code (10 minutes, single
use) → redirect to `next`. Sign out sits in the sidebar footer. The session
ends 7 days after sign-in.

**Components**
- `frontend/middleware.ts`: runs on `/v2/:path*` and `/api/:path*`. It
  refreshes the Supabase session cookie through `@supabase/ssr` and
  redirects (pages) or returns 401 (API) when there's no session. It also
  checks the server-verified `user.last_sign_in_at` and signs the user out past
  7 days (a client cookie was rejected in review: it could be edited to extend
  the session).
- `frontend/app/login/page.tsx`: a two-step form (email → code) in the v2
  visual style.
- `frontend/app/login/actions.ts`: server actions. `requestCode(email)`
  validates the domain, then calls `signInWithOtp({ shouldCreateUser: true })`.
  `verifyCode(email, token)` calls `verifyOtp({ type: 'email' })`. `signOut()`.
- `frontend/lib/shared/supabase-server.ts` and `supabase-browser.ts`:
  cookie-aware clients.
- `migrations/029_auth_domain_hook.sql`: a `before_user_created` hook
  function that rejects any email not ending `@joola.com` / `@joola.in`.
  It's registered in Supabase → Authentication → Hooks.
- Supabase dashboard (manual, one-off): set Brevo as the custom SMTP; change
  the "Magic Link" email template to show `{{ .Token }}`; set OTP expiry to
  600 s and email OTP length to 6.

**Domain rule:** enforced in the form, in the server action and in the
database hook, so calling Supabase directly can't create an outside account.

**Abuse limits:** the Supabase email rate limit (~30/hour, configurable), a
60 s resend cooldown in the UI, and code expiry plus single use.

**Data reads after login:** the existing anon-key browser client is kept for
data reads (consistent with D3). The new session clients are used only for auth.

**Edge cases:** an expired or wrong code gets a clear message and a resend
button. Brevo's daily limit shows "Try again later". On shared computers,
sign out plus the 7-day cap.

### 4.2 Date filter

- **One state:** From–To only. Remove `range` / `maxDays` / `mode` and the
  unmounted `DateRangeDropdown`. Migrate old localStorage keys once, then
  ignore them.
- **Quick buttons** (7d / 30d / 90d / All) fill From–To.
- **The default range** is the 90 days ending at the **latest data date**
  (the newest `scraped_at` across the core tables), not today.
- To is inclusive, so queries use `< To + 1 day`. Dates display in IST.
- **Every page follows the picker.** Activity is counted in range; followers,
  prices and stock come from the latest snapshot at or before To. Top-post
  lists are selected inside the range. Labels show the real dates.
- **Brand detail pages** follow the picker instead of hardcoded 90 days.

### 4.3 Speed

- **Read-only Postgres functions (RPCs)**, ~8, one per area: overview,
  social channels, Reddit, community, influencers, campaign/offer, product,
  sales. Signature: `(p_from timestamptz, p_to timestamptz, p_brands uuid[])`,
  returning small aggregated JSON or rows. `SECURITY INVOKER`, `STABLE`, and
  granted to `anon` and `authenticated`.
- **Indexes** on `(brand_id, posted_at)` (or the equivalent) for the tables
  the functions scan. Created `CONCURRENTLY`; additive only, with a rollback
  file.
- **SWR** in the front end: one hook per function, keyed by
  (function, from, to, brands), with `dedupingInterval` and a 6 h cache
  lifetime. Cached answers are shared across pages.
- **Remaining raw reads:** `fetchPaged` fires its ranges in parallel; text
  columns are no longer selected just to count; non-paged
  `.limit(>1000)` reads are fixed (PostgREST silently caps them at 1,000).
- **Smaller fixes:** no `count:'exact'` in the sidebar or on Data Health;
  Data Health probes run in parallel; heavy modals and below-fold sections
  load lazily (`next/dynamic`); `agentation` is dev-only via `dynamic`;
  waterfalls on sales-intel and influencers are flattened.
- **Rollout order:** Community Intel → Sales Intel → Influencers → Reddit →
  Overview / Market → Instagram / YouTube / TikTok / X →
  Product / Campaign → brand pages. Each page is a separate change with a
  before/after timing.

### 4.4 Data catch-up and pipeline fixes

1. Fix the `sales_intelligence_scrape_inventory_crawl4ai` crash
   ("cannot reuse already awaited coroutine") and add a regression test.
2. Add the Playwright browser install to the manual workflow. The local
   catalog step now **fails** when Playwright is missing, instead of
   reporting 0 rows as done.
3. Let the analytics step run when scraping exits with code 2 (partial
   success), matching `scripts/weekly_run.py`.
4. **Only on the owner's "go":** run `sales-intelligence`, `reviews-crawl4ai`,
   `product-specs` and the analytics backend. Social, news and product data
   are already at Oct 12.

### 4.5 Testing

- **Login:** Playwright tests for the redirect, wrong domain, wrong code and
  sign out. The regression suite and e2e use a test account via a stored
  session, so page smoke tests still run behind the gate.
- **Date filter:** for each page, change the dates and assert that the KPIs
  and table content change; a test that the To day is included.
- **RPCs:** SQL checks comparing each function's output with the current
  client-side numbers for a fixed range before the page is switched over.
- **Speed:** time-to-content measured per page before and after, recorded in
  the change description.
- **Pipeline:** a unit test for the inventory crawl helper; a dry run of the
  workflow.

## 5. Risks

| Risk | Mitigation |
|---|---|
| D3: the data stays publicly readable with the anon key | Recorded and accepted. RLS can be added later (it needs a Pulse change). |
| OTP emails land in spam | Verified Brevo sender; ask IT to add SPF/DKIM for joola.com if needed. |
| Vercel Hobby is licensed for non-commercial use only | **Owner decision:** stay, move to Vercel Pro (paid), or move to a free commercial-friendly host such as Cloudflare Pages. Not part of this work. |
| Supabase Free egress or compute limits | Smaller responses from the RPCs plus caching cut egress sharply. |
| RPC numbers differ from today's figures | Each page's numbers are compared before switching; the differences are explained in the change. |
| Regression suite blocked by the login | Test session set up as part of the login work. |
