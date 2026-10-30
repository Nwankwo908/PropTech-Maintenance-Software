-- Include the designated disposable Home Check account for platform staff only.
-- Preserve existing customer account access and seeded account data.

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
      'de300000-0000-4000-8000-000000000001'::uuid,
      'd15a0000-0000-4000-8000-000000000001'::uuid
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

