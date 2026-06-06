-- Replace catch-all / public RLS policies on primary tables with staff- and vendor-scoped access.
-- Staff: Supabase Auth users whose JWT email ends with @property-admin.auth.local
-- or are on the ulohome.io admin allowlist (see src/lib/adminAuth.ts).
-- Vendors: rows in public.vendors linked via auth_user_id or email match.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_staff_admin()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'email', '') ilike '%@property-admin.auth.local';
$$;

comment on function public.is_staff_admin() is
  'True when the signed-in user is property staff (admin dashboard login domain).';

create or replace function public.current_user_vendor_ids()
returns setof uuid
language sql
stable
security invoker
set search_path = public
as $$
  select v.id
  from public.vendors v
  where v.auth_user_id = auth.uid()
     or (
       coalesce(auth.jwt() ->> 'email', '') <> ''
       and lower(trim(coalesce(v.email, ''))) = lower(trim(auth.jwt() ->> 'email'))
     );
$$;

comment on function public.current_user_vendor_ids() is
  'Vendor directory ids owned by the current authenticated vendor portal user.';

grant execute on function public.is_staff_admin() to authenticated;
grant execute on function public.current_user_vendor_ids() to authenticated;

-- Drop every policy on a table (removes Supabase template "allow all" policies).
create or replace function public.drop_all_policies_on_table(target_table regclass)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  pol record;
  schema_name text;
  table_name text;
begin
  select n.nspname, c.relname
  into schema_name, table_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.oid = target_table;

  if table_name is null then
    return;
  end if;

  for pol in
    select policyname
    from pg_policies
    where schemaname = schema_name
      and tablename = table_name
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      pol.policyname,
      schema_name,
      table_name
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- maintenance_requests
-- ---------------------------------------------------------------------------

select public.drop_all_policies_on_table('public.maintenance_requests'::regclass);

alter table public.maintenance_requests enable row level security;

create policy maintenance_requests_select_scoped
  on public.maintenance_requests
  for select
  to authenticated
  using (
    public.is_staff_admin()
    or assigned_vendor_id in (select public.current_user_vendor_ids())
  );

create policy maintenance_requests_update_staff
  on public.maintenance_requests
  for update
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create policy maintenance_requests_delete_staff
  on public.maintenance_requests
  for delete
  to authenticated
  using (public.is_staff_admin());

-- Inserts remain service-role / Edge Function only (no client policy).

-- ---------------------------------------------------------------------------
-- vendors
-- ---------------------------------------------------------------------------

select public.drop_all_policies_on_table('public.vendors'::regclass);

alter table public.vendors enable row level security;

create policy vendors_select_scoped
  on public.vendors
  for select
  to authenticated
  using (
    public.is_staff_admin()
    or id in (select public.current_user_vendor_ids())
  );

create policy vendors_insert_staff
  on public.vendors
  for insert
  to authenticated
  with check (public.is_staff_admin());

create policy vendors_update_staff
  on public.vendors
  for update
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create policy vendors_delete_staff
  on public.vendors
  for delete
  to authenticated
  using (public.is_staff_admin());

-- ---------------------------------------------------------------------------
-- vendor_notification_log
-- ---------------------------------------------------------------------------

select public.drop_all_policies_on_table('public.vendor_notification_log'::regclass);

alter table public.vendor_notification_log enable row level security;

create policy vendor_notification_log_select_scoped
  on public.vendor_notification_log
  for select
  to authenticated
  using (
    public.is_staff_admin()
    or vendor_id in (select public.current_user_vendor_ids())
  );

-- Writes stay service-role / Edge Function only.

-- ---------------------------------------------------------------------------
-- broadcast_notifications + broadcast_notification_log ("notifications" UI)
-- ---------------------------------------------------------------------------

select public.drop_all_policies_on_table('public.broadcast_notifications'::regclass);

alter table public.broadcast_notifications enable row level security;

create policy broadcast_notifications_select_staff
  on public.broadcast_notifications
  for select
  to authenticated
  using (public.is_staff_admin());

select public.drop_all_policies_on_table('public.broadcast_notification_log'::regclass);

alter table public.broadcast_notification_log enable row level security;

create policy broadcast_notification_log_select_staff
  on public.broadcast_notification_log
  for select
  to authenticated
  using (public.is_staff_admin());

-- ---------------------------------------------------------------------------
-- resident_notification_log (admin notification history)
-- ---------------------------------------------------------------------------

select public.drop_all_policies_on_table('public.resident_notification_log'::regclass);

alter table public.resident_notification_log enable row level security;

create policy resident_notification_log_select_staff
  on public.resident_notification_log
  for select
  to authenticated
  using (public.is_staff_admin());

-- ---------------------------------------------------------------------------
-- Optional tables created in Supabase dashboard (properties, units, notifications)
-- ---------------------------------------------------------------------------

do $rls$
begin
  if to_regclass('public.properties') is not null then
    perform public.drop_all_policies_on_table('public.properties'::regclass);
    execute 'alter table public.properties enable row level security';

    execute $policy$
      create policy properties_select_staff
        on public.properties
        for select
        to authenticated
        using (public.is_staff_admin())
    $policy$;

    execute $policy$
      create policy properties_insert_staff
        on public.properties
        for insert
        to authenticated
        with check (public.is_staff_admin())
    $policy$;

    execute $policy$
      create policy properties_update_staff
        on public.properties
        for update
        to authenticated
        using (public.is_staff_admin())
        with check (public.is_staff_admin())
    $policy$;

    execute $policy$
      create policy properties_delete_staff
        on public.properties
        for delete
        to authenticated
        using (public.is_staff_admin())
    $policy$;
  end if;

  if to_regclass('public.units') is not null then
    perform public.drop_all_policies_on_table('public.units'::regclass);
    execute 'alter table public.units enable row level security';

    execute $policy$
      create policy units_select_staff
        on public.units
        for select
        to authenticated
        using (public.is_staff_admin())
    $policy$;

    execute $policy$
      create policy units_insert_staff
        on public.units
        for insert
        to authenticated
        with check (public.is_staff_admin())
    $policy$;

    execute $policy$
      create policy units_update_staff
        on public.units
        for update
        to authenticated
        using (public.is_staff_admin())
        with check (public.is_staff_admin())
    $policy$;

    execute $policy$
      create policy units_delete_staff
        on public.units
        for delete
        to authenticated
        using (public.is_staff_admin())
    $policy$;
  end if;

  if to_regclass('public.notifications') is not null then
    perform public.drop_all_policies_on_table('public.notifications'::regclass);
    execute 'alter table public.notifications enable row level security';

    execute $policy$
      create policy notifications_select_staff
        on public.notifications
        for select
        to authenticated
        using (public.is_staff_admin())
    $policy$;

    execute $policy$
      create policy notifications_insert_staff
        on public.notifications
        for insert
        to authenticated
        with check (public.is_staff_admin())
    $policy$;

    execute $policy$
      create policy notifications_update_staff
        on public.notifications
        for update
        to authenticated
        using (public.is_staff_admin())
        with check (public.is_staff_admin())
    $policy$;

    execute $policy$
      create policy notifications_delete_staff
        on public.notifications
        for delete
        to authenticated
        using (public.is_staff_admin())
    $policy$;
  end if;
end;
$rls$;

-- Cleanup helper (not needed at runtime).
drop function if exists public.drop_all_policies_on_table(regclass);
