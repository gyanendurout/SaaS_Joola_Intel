-- Rollback for 029. First unregister the hook in Supabase:
--   Authentication → Hooks → "Before User Created" → remove.
drop function if exists public.hook_joola_domain_only(jsonb);
