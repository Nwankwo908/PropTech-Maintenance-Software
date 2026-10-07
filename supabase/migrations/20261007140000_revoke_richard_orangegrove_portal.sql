-- Revoke richard@orangegroveproperties.com Demo Property Management portal access.

delete from public.landlord_portal_members
where lower(email) = 'richard@orangegroveproperties.com';

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
      'moreceo@gmail.com',
      'nyshaunbrown@gmail.com',
      'otbpictures12@gmail.com',
      'nwankwo908@gmail.com',
      'bfamiloni@gmail.com'
    )
    or public.is_landlord_portal_member();
$$;

comment on function public.is_staff_admin() is
  'True when the signed-in user is property staff, an allowlisted landlord portal account, or a team member on that account.';
