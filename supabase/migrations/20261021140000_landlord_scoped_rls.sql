-- Landlord-scoped RLS for portal accounts.
--
-- Problem: is_staff_admin() includes Limited Alpha / landlord portal emails, and
-- primary table policies used only is_staff_admin() with no landlord_id predicate.
-- A signed-in Limited Alpha 1 JWT could therefore SELECT/UPDATE another landlord's
-- properties, units, tickets, and residents via PostgREST.
--
-- Fix: accessible_landlord_ids() + can_access_landlord(uuid). Platform staff
-- (core emails + @property-admin.auth.local) may access the staff switcher set.
-- Seeded portal emails and landlord_portal_members may access only their landlord(s).

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_platform_staff()
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

comment on function public.is_platform_staff() is
  'True for Ulo platform operators only (not landlord portal accounts).';

revoke all on function public.is_platform_staff() from public;
grant execute on function public.is_platform_staff() to authenticated;

create or replace function public.seeded_landlord_id_for_email(p_email text)
returns uuid
language sql
immutable
set search_path = public
as $$
  select case lower(trim(coalesce(p_email, '')))
    when 'limitedalpha1@ulohome.io' then 'de300000-0000-4000-8000-000000000003'::uuid
    when 'ceorentalsnj@gmail.com' then 'de300000-0000-4000-8000-000000000003'::uuid
    when 'limitedalpha2@ulohome.io' then 'de300000-0000-4000-8000-000000000004'::uuid
    when 'shaquillegurley@yahoo.com' then 'de300000-0000-4000-8000-000000000004'::uuid
    when 'adeogunfowora@gmail.com' then 'de300000-0000-4000-8000-000000000004'::uuid
    when 'o.k.okafor@gmail.com' then 'de300000-0000-4000-8000-000000000004'::uuid
    when 'drake@gtwgroupnwa.com' then 'de300000-0000-4000-8000-000000000004'::uuid
    when 'awrighthall@gmail.com' then 'de300000-0000-4000-8000-000000000004'::uuid
    when 'demo@ulohome.io' then 'de300000-0000-4000-8000-000000000001'::uuid
    else null
  end;
$$;

revoke all on function public.seeded_landlord_id_for_email(text) from public;
grant execute on function public.seeded_landlord_id_for_email(text) to authenticated;

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
  'Landlord ids the current JWT may access. Platform staff = switcher set; portals = seeded map + members table.';

revoke all on function public.accessible_landlord_ids() from public;
grant execute on function public.accessible_landlord_ids() to authenticated;

create or replace function public.can_access_landlord(p_landlord_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_landlord_id is not null
    and p_landlord_id in (select public.accessible_landlord_ids());
$$;

comment on function public.can_access_landlord(uuid) is
  'True when the signed-in user may read/write rows for this landlord_id.';

revoke all on function public.can_access_landlord(uuid) from public;
grant execute on function public.can_access_landlord(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Ensure seeded portal emails exist as portal members (idempotent)
-- ---------------------------------------------------------------------------

insert into public.landlord_portal_members (landlord_id, email, role)
values
  ('de300000-0000-4000-8000-000000000003'::uuid, 'limitedalpha1@ulohome.io', 'team_member'),
  ('de300000-0000-4000-8000-000000000004'::uuid, 'limitedalpha2@ulohome.io', 'team_member'),
  ('de300000-0000-4000-8000-000000000001'::uuid, 'demo@ulohome.io', 'team_member')
on conflict (landlord_id, email) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Scope highest-risk table policies (idempotent drops)
-- ---------------------------------------------------------------------------

-- properties
drop policy if exists properties_select_staff on public.properties;
drop policy if exists properties_insert_staff on public.properties;
drop policy if exists properties_update_staff on public.properties;
drop policy if exists properties_delete_staff on public.properties;

create policy properties_select_staff
  on public.properties for select to authenticated
  using (public.can_access_landlord(landlord_id));

create policy properties_insert_staff
  on public.properties for insert to authenticated
  with check (public.can_access_landlord(landlord_id));

create policy properties_update_staff
  on public.properties for update to authenticated
  using (public.can_access_landlord(landlord_id))
  with check (public.can_access_landlord(landlord_id));

create policy properties_delete_staff
  on public.properties for delete to authenticated
  using (public.can_access_landlord(landlord_id));

-- units
drop policy if exists units_select_staff on public.units;
drop policy if exists units_insert_staff on public.units;
drop policy if exists units_update_staff on public.units;
drop policy if exists units_delete_staff on public.units;

create policy units_select_staff
  on public.units for select to authenticated
  using (public.can_access_landlord(landlord_id));

create policy units_insert_staff
  on public.units for insert to authenticated
  with check (public.can_access_landlord(landlord_id));

create policy units_update_staff
  on public.units for update to authenticated
  using (public.can_access_landlord(landlord_id))
  with check (public.can_access_landlord(landlord_id));

create policy units_delete_staff
  on public.units for delete to authenticated
  using (public.can_access_landlord(landlord_id));

-- maintenance_requests
drop policy if exists maintenance_requests_select_scoped on public.maintenance_requests;
drop policy if exists maintenance_requests_update_staff on public.maintenance_requests;
drop policy if exists maintenance_requests_insert_staff on public.maintenance_requests;
drop policy if exists maintenance_requests_delete_staff on public.maintenance_requests;

create policy maintenance_requests_select_scoped
  on public.maintenance_requests
  for select
  to authenticated
  using (
    public.can_access_landlord(landlord_id)
    or assigned_vendor_id in (select public.current_user_vendor_ids())
  );

create policy maintenance_requests_insert_staff
  on public.maintenance_requests
  for insert
  to authenticated
  with check (public.can_access_landlord(landlord_id));

create policy maintenance_requests_update_staff
  on public.maintenance_requests
  for update
  to authenticated
  using (
    public.can_access_landlord(landlord_id)
    or assigned_vendor_id in (select public.current_user_vendor_ids())
  )
  with check (
    public.can_access_landlord(landlord_id)
    or assigned_vendor_id in (select public.current_user_vendor_ids())
  );

create policy maintenance_requests_delete_staff
  on public.maintenance_requests
  for delete
  to authenticated
  using (public.can_access_landlord(landlord_id));

-- landlords
drop policy if exists landlords_select_staff on public.landlords;
drop policy if exists landlords_update_staff on public.landlords;
drop policy if exists landlords_select_landlord_scoped on public.landlords;
drop policy if exists landlords_update_landlord_scoped on public.landlords;

create policy landlords_select_landlord_scoped
  on public.landlords for select to authenticated
  using (public.can_access_landlord(id) or public.is_platform_staff());

create policy landlords_update_landlord_scoped
  on public.landlords for update to authenticated
  using (public.can_access_landlord(id))
  with check (public.can_access_landlord(id));

-- residents (public.users)
drop policy if exists users_select_landlord_scoped on public.users;
drop policy if exists users_insert_landlord_scoped on public.users;
drop policy if exists users_update_landlord_scoped on public.users;
drop policy if exists users_delete_landlord_scoped on public.users;
drop policy if exists users_select_staff on public.users;
drop policy if exists users_insert_staff on public.users;
drop policy if exists users_update_staff on public.users;
drop policy if exists users_delete_staff on public.users;

create policy users_select_landlord_scoped
  on public.users for select to authenticated
  using (public.can_access_landlord(landlord_id));

create policy users_insert_landlord_scoped
  on public.users for insert to authenticated
  with check (public.can_access_landlord(landlord_id));

create policy users_update_landlord_scoped
  on public.users for update to authenticated
  using (public.can_access_landlord(landlord_id))
  with check (public.can_access_landlord(landlord_id));

create policy users_delete_landlord_scoped
  on public.users for delete to authenticated
  using (public.can_access_landlord(landlord_id));

-- occupancy
drop policy if exists occupancy_select_landlord_scoped on public.occupancy;
drop policy if exists occupancy_write_landlord_scoped on public.occupancy;
drop policy if exists occupancy_select_staff on public.occupancy;
drop policy if exists occupancy_insert_staff on public.occupancy;
drop policy if exists occupancy_update_staff on public.occupancy;
drop policy if exists occupancy_delete_staff on public.occupancy;

create policy occupancy_select_landlord_scoped
  on public.occupancy for select to authenticated
  using (public.can_access_landlord(landlord_id));

create policy occupancy_write_landlord_scoped
  on public.occupancy for all to authenticated
  using (public.can_access_landlord(landlord_id))
  with check (public.can_access_landlord(landlord_id));

-- landlord_onboarding
drop policy if exists landlord_onboarding_select_scoped on public.landlord_onboarding;
drop policy if exists landlord_onboarding_write_scoped on public.landlord_onboarding;
drop policy if exists landlord_onboarding_staff_all on public.landlord_onboarding;

create policy landlord_onboarding_select_scoped
  on public.landlord_onboarding for select to authenticated
  using (public.can_access_landlord(landlord_id));

create policy landlord_onboarding_write_scoped
  on public.landlord_onboarding for all to authenticated
  using (public.can_access_landlord(landlord_id))
  with check (public.can_access_landlord(landlord_id));
