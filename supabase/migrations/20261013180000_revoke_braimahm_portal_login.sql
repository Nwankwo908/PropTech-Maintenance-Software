-- Revoke Limited Alpha 2 portal access for braimahm@gmail.com.
-- limitedalpha2@ulohome.io stays.

delete from public.landlord_portal_members
where lower(email) = 'braimahm@gmail.com';

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
      'ceorentalsnj@gmail.com'
    )
    or public.is_landlord_portal_member();
$$;
