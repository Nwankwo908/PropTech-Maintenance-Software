-- Supabase default privileges can grant roles directly, independently of PUBLIC.
-- Keep the profile registry read-only to its RLS-scoped owner; no anonymous RPCs.
revoke all on table public.limited_alpha_signup_profiles from anon, authenticated;
grant select on table public.limited_alpha_signup_profiles to authenticated;
revoke all on function public.ensure_my_limited_alpha_profile() from public, anon;
grant execute on function public.ensure_my_limited_alpha_profile() to authenticated;
revoke all on function public.can_mutate_onboarding_inventory(uuid) from public, anon;
grant execute on function public.can_mutate_onboarding_inventory(uuid) to authenticated, service_role;
revoke all on function public.activate_completed_limited_alpha_profile() from public, anon;
