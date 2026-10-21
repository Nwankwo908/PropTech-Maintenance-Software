-- Remove any leftover staff-blanket policies on landlord-scoped tables so
-- OR-combined RLS cannot re-open cross-tenant reads after 20261021140000.

do $$
declare
  r record;
  tables text[] := array[
    'properties',
    'units',
    'maintenance_requests',
    'landlords',
    'users',
    'occupancy',
    'landlord_onboarding'
  ];
  t text;
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    for r in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = t
        and policyname not like '%landlord_scoped%'
        and policyname not like '%_scoped'
        -- keep vendor-facing ticket access created in the scoped migration
        and policyname <> 'maintenance_requests_select_scoped'
        and policyname <> 'maintenance_requests_insert_staff'
        and policyname <> 'maintenance_requests_update_staff'
        and policyname <> 'maintenance_requests_delete_staff'
        and policyname not in (
          'properties_select_staff',
          'properties_insert_staff',
          'properties_update_staff',
          'properties_delete_staff',
          'units_select_staff',
          'units_insert_staff',
          'units_update_staff',
          'units_delete_staff'
        )
    loop
      execute format('drop policy if exists %I on public.%I', r.policyname, t);
    end loop;
  end loop;
end $$;

-- Re-assert scoped policies (idempotent) for tables that may have lost them.
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

drop policy if exists maintenance_requests_select_scoped on public.maintenance_requests;
drop policy if exists maintenance_requests_insert_staff on public.maintenance_requests;
drop policy if exists maintenance_requests_update_staff on public.maintenance_requests;
drop policy if exists maintenance_requests_delete_staff on public.maintenance_requests;

create policy maintenance_requests_select_scoped
  on public.maintenance_requests for select to authenticated
  using (
    public.can_access_landlord(landlord_id)
    or assigned_vendor_id in (select public.current_user_vendor_ids())
  );
create policy maintenance_requests_insert_staff
  on public.maintenance_requests for insert to authenticated
  with check (public.can_access_landlord(landlord_id));
create policy maintenance_requests_update_staff
  on public.maintenance_requests for update to authenticated
  using (
    public.can_access_landlord(landlord_id)
    or assigned_vendor_id in (select public.current_user_vendor_ids())
  )
  with check (
    public.can_access_landlord(landlord_id)
    or assigned_vendor_id in (select public.current_user_vendor_ids())
  );
create policy maintenance_requests_delete_staff
  on public.maintenance_requests for delete to authenticated
  using (public.can_access_landlord(landlord_id));

drop policy if exists landlords_select_landlord_scoped on public.landlords;
drop policy if exists landlords_update_landlord_scoped on public.landlords;
create policy landlords_select_landlord_scoped
  on public.landlords for select to authenticated
  using (public.can_access_landlord(id) or public.is_platform_staff());
create policy landlords_update_landlord_scoped
  on public.landlords for update to authenticated
  using (public.can_access_landlord(id))
  with check (public.can_access_landlord(id));

drop policy if exists users_select_landlord_scoped on public.users;
drop policy if exists users_insert_landlord_scoped on public.users;
drop policy if exists users_update_landlord_scoped on public.users;
drop policy if exists users_delete_landlord_scoped on public.users;
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

drop policy if exists occupancy_select_landlord_scoped on public.occupancy;
drop policy if exists occupancy_write_landlord_scoped on public.occupancy;
create policy occupancy_select_landlord_scoped
  on public.occupancy for select to authenticated
  using (public.can_access_landlord(landlord_id));
create policy occupancy_write_landlord_scoped
  on public.occupancy for all to authenticated
  using (public.can_access_landlord(landlord_id))
  with check (public.can_access_landlord(landlord_id));

drop policy if exists landlord_onboarding_select_scoped on public.landlord_onboarding;
drop policy if exists landlord_onboarding_write_scoped on public.landlord_onboarding;
create policy landlord_onboarding_select_scoped
  on public.landlord_onboarding for select to authenticated
  using (public.can_access_landlord(landlord_id));
create policy landlord_onboarding_write_scoped
  on public.landlord_onboarding for all to authenticated
  using (public.can_access_landlord(landlord_id))
  with check (public.can_access_landlord(landlord_id));
