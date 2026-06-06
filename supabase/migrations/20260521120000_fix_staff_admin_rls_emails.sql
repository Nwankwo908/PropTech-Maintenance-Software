-- Align is_staff_admin() with src/lib/adminAuth.ts (ulohome.io allowlist + property-admin domain).

create or replace function public.is_staff_admin()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select lower(trim(coalesce(auth.jwt() ->> 'email', ''))) ilike '%@property-admin.auth.local'
    or lower(trim(coalesce(auth.jwt() ->> 'email', ''))) in (
      'emeka@ulohome.io',
      'osi@ulohome.io'
    );
$$;

comment on function public.is_staff_admin() is
  'True for property staff admin dashboard users (@property-admin.auth.local or ulohome.io allowlist).';
