-- 029_auth_domain_hook.sql — only @joola.com / @joola.in may create accounts.
-- Defence in depth: the login form and server action already reject other
-- domains, but the anon key is public, so someone could call Supabase Auth
-- directly. This hook makes Supabase itself refuse to create such a user.
--
-- Apply in the Supabase SQL editor, then register it:
--   Authentication → Hooks → "Before User Created" → Postgres function
--   public.hook_joola_domain_only
-- Keep the domain list in sync with frontend/lib/auth/rules.ts (ALLOWED_DOMAINS).
-- backend/tests/test_auth_hook_regex.py fails if the two regexes drift.
--
-- Also rejected, by design: users with no email (phone, anonymous, OAuth
-- without an email) and dashboard invites to non-JOOLA addresses. Intended,
-- since email OTP is the only sign-in method.
--
-- Runs as invoker (supabase_auth_admin): it touches no tables, so it needs no
-- elevated privileges.
create or replace function public.hook_joola_domain_only(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  email text := lower(coalesce(event->'user'->>'email', ''));
begin
  if email ~ '^[a-z0-9._%+''-]+@(joola\.com|joola\.in)$' then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Only JOOLA email addresses can sign in.'));
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_joola_domain_only(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_joola_domain_only(jsonb) from authenticated, anon, public;

-- Verification (paste into the SQL editor after applying):
-- select public.hook_joola_domain_only('{"user":{"email":"x@gmail.com"}}');   -- expect an error object
-- select public.hook_joola_domain_only('{"user":{"email":"A@JOOLA.in"}}');     -- expect {}
