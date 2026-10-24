-- Allow empty lease-import verification accounts to save onboarding inventory.
-- Limited Alpha 1 and Limited Alpha 2 stay the only production Alpha accounts.
-- These ids are not seeded here. Rows are created only for a live import check.

create or replace function public.can_mutate_onboarding_inventory(p_landlord_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  allowed constant uuid[] := array[
    'de300000-0000-4000-8000-000000000003'::uuid,
    'de300000-0000-4000-8000-000000000004'::uuid,
    'de300000-0000-4000-8000-0000000000a1'::uuid,
    'de300000-0000-4000-8000-0000000000a2'::uuid,
    'de300000-0000-4000-8000-0000000000a3'::uuid
  ];
  jwt_role text := coalesce(auth.jwt() ->> 'role', '');
  jwt_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  member_landlord uuid;
begin
  if not (p_landlord_id = any (allowed)) then
    return false;
  end if;
  if jwt_role = 'service_role' then
    return true;
  end if;
  if not public.is_staff_admin() then
    return false;
  end if;
  -- Core staff may touch either Alpha account; portal members only their landlord.
  if jwt_email in (
    'emeka@ulohome.io',
    'osi@ulohome.io',
    'limitedalpha1@ulohome.io',
    'limitedalpha2@ulohome.io'
  ) or jwt_email like '%@property-admin.auth.local' then
    return true;
  end if;
  select m.landlord_id
  into member_landlord
  from public.landlord_portal_members m
  where lower(m.email) = jwt_email
  limit 1;
  if member_landlord is not null then
    return member_landlord = p_landlord_id;
  end if;
  -- Seeded login emails mapped 1:1
  if jwt_email = 'limitedalpha1@ulohome.io' then
    return p_landlord_id = 'de300000-0000-4000-8000-000000000003'::uuid;
  end if;
  if jwt_email = 'limitedalpha2@ulohome.io' then
    return p_landlord_id = 'de300000-0000-4000-8000-000000000004'::uuid;
  end if;
  return public.is_staff_admin();
end;
$$;

revoke all on function public.can_mutate_onboarding_inventory(uuid) from public;
grant execute on function public.can_mutate_onboarding_inventory(uuid) to authenticated, service_role;
