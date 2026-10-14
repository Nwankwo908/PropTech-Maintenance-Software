-- Grant Limited Alpha 2 portal access to kwsellstx@gmail.com.
-- Account setup must not revoke this login or Bashira's existing grant.

insert into public.landlord_portal_members (
  landlord_id,
  email,
  role
)
values (
  'de300000-0000-4000-8000-000000000004'::uuid,
  'kwsellstx@gmail.com',
  'team_member'
)
on conflict (landlord_id, email) do nothing;

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
      'shaquillegurley@yahoo.com',
      'adeogunfowora@gmail.com',
      'o.k.okafor@gmail.com',
      'drake@gtwgroupnwa.com',
      'bashiraaliya@gmail.com',
      'kwsellstx@gmail.com'
    )
    or public.is_landlord_portal_member();
$$;

create or replace function public.keep_bashira_portal_login()
returns trigger
language plpgsql
as $$
begin
  if lower(old.email) in ('bashiraaliya@gmail.com', 'kwsellstx@gmail.com') then
    return null;
  end if;
  return old;
end;
$$;
