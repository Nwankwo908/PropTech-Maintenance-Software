-- Revoke Limited Alpha 2 portal access for drake@gtwgroupnwa.com and bashiraaliya@gmail.com.
-- kwsellstx@gmail.com stays, including protection from account-setup replacement.

create or replace function public.keep_bashira_portal_login()
returns trigger
language plpgsql
as $$
begin
  if lower(old.email) = 'kwsellstx@gmail.com' then
    return null;
  end if;
  return old;
end;
$$;

delete from public.landlord_portal_members
where lower(email) in ('drake@gtwgroupnwa.com', 'bashiraaliya@gmail.com');

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
      'kwsellstx@gmail.com'
    )
    or public.is_landlord_portal_member();
$$;
