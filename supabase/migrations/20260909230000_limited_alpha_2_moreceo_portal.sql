-- Grant moreceo@gmail.com Limited Alpha 2 portal access (Gmail + email login).
-- Email is unique on landlord_portal_members, so move off Limited Alpha 1 if present.

delete from public.landlord_portal_members
where lower(email) = 'moreceo@gmail.com';

insert into public.landlord_portal_members (
  landlord_id,
  email,
  role
)
values (
  'de300000-0000-4000-8000-000000000004'::uuid,
  'moreceo@gmail.com',
  'team_member'
);

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
      'osi@ulohome.io',
      'demo@ulohome.io',
      'newlandlord@ulohome.io',
      'limitedalpha1@ulohome.io',
      'limitedalpha2@ulohome.io',
      'ceorentalsnj@gmail.com',
      'iokafor0@gmail.com',
      'moreceo@gmail.com'
    )
    or public.is_landlord_portal_member();
$$;

comment on function public.is_staff_admin() is
  'True when the signed-in user is property staff, an allowlisted landlord portal account, or a team member on that account.';
