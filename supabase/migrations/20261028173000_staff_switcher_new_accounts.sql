-- Platform staff (osi@ulohome.io, emeka@ulohome.io) can list and open
-- every self-service Limited Alpha account from the account switcher.
-- Seeded portal logins stay on their own landlord.

create or replace function public.accessible_landlord_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select x.id
  from (
    select unnest(array[
      'de300000-0000-4000-8000-000000000003'::uuid,
      'de300000-0000-4000-8000-000000000004'::uuid,
      'de300000-0000-4000-8000-000000000001'::uuid
    ]) as id
  ) x
  where public.is_platform_staff()

  union

  select p.landlord_id
  from public.limited_alpha_signup_profiles p
  where public.is_platform_staff()

  union

  select public.seeded_landlord_id_for_email(auth.jwt() ->> 'email')
  where public.seeded_landlord_id_for_email(auth.jwt() ->> 'email') is not null
    and not public.is_platform_staff()

  union

  select m.landlord_id
  from public.landlord_portal_members m
  where lower(m.email) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
    and not public.is_platform_staff();
$$;

comment on function public.accessible_landlord_ids() is
  'Landlord ids the current JWT may access. Platform staff = seeded switcher set plus every self-service signup. Portals = seeded map + members table.';

drop policy if exists limited_alpha_signup_staff_read on public.limited_alpha_signup_profiles;
create policy limited_alpha_signup_staff_read
  on public.limited_alpha_signup_profiles
  for select
  to authenticated
  using (public.is_platform_staff());
