-- Landlord isolation for policies that treated every portal member as staff,
-- and for authenticated policies that were USING (true) / WITH CHECK (true).
--
-- can_access_landlord() is the existing rule: platform staff for the switcher
-- set, portal members only for landlords on their membership row.
-- Service role (Edge Functions) bypasses RLS and is unchanged.
--
-- Rollback must not restore is_staff_admin() or USING (true). If a legitimate
-- caller is locked out, grant that caller an explicit landlord membership.

do $$
declare
  rec record;
  expr_using text;
  expr_check text;
begin
  for rec in
    select c.relname as table_name,
           p.polname as policy_name,
           p.polcmd as polcmd,
           pg_get_expr(p.polqual, p.polrelid) as qual,
           pg_get_expr(p.polwithcheck, p.polrelid) as with_check
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and exists (
        select 1
        from pg_attribute a
        where a.attrelid = c.oid
          and a.attname = 'landlord_id'
          and a.attnum > 0
          and not a.attisdropped
      )
  loop
    expr_using := coalesce(rec.qual, '');
    expr_check := coalesce(rec.with_check, '');
    if expr_using not in ('', 'true', 'is_staff_admin()', 'public.is_staff_admin()') then
      continue;
    end if;
    if expr_check not in ('', 'true', 'is_staff_admin()', 'public.is_staff_admin()') then
      continue;
    end if;
    if expr_using = '' and expr_check = '' then
      continue;
    end if;

    execute format('drop policy if exists %I on public.%I', rec.policy_name, rec.table_name);

    if rec.polcmd = '*' then
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.can_access_landlord(landlord_id)) with check (public.can_access_landlord(landlord_id))',
        rec.policy_name, rec.table_name
      );
    elsif rec.polcmd = 'r' then
      execute format(
        'create policy %I on public.%I for select to authenticated using (public.can_access_landlord(landlord_id))',
        rec.policy_name, rec.table_name
      );
    elsif rec.polcmd = 'a' then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (public.can_access_landlord(landlord_id))',
        rec.policy_name, rec.table_name
      );
    elsif rec.polcmd = 'w' then
      execute format(
        'create policy %I on public.%I for update to authenticated using (public.can_access_landlord(landlord_id)) with check (public.can_access_landlord(landlord_id))',
        rec.policy_name, rec.table_name
      );
    elsif rec.polcmd = 'd' then
      execute format(
        'create policy %I on public.%I for delete to authenticated using (public.can_access_landlord(landlord_id))',
        rec.policy_name, rec.table_name
      );
    end if;
  end loop;
end $$;

-- SMS / vendor reads that mixed "any portal member" with the vendor's own rows.
drop policy if exists sms_identities_select_scoped on public.sms_identities;
create policy sms_identities_select_scoped
  on public.sms_identities
  for select
  to authenticated
  using (
    public.can_access_landlord(landlord_id)
    or vendor_id in (select public.current_user_vendor_ids())
  );

drop policy if exists sms_numbers_select_scoped on public.sms_numbers;
create policy sms_numbers_select_scoped
  on public.sms_numbers
  for select
  to authenticated
  using (
    public.can_access_landlord(landlord_id)
    or vendor_id in (select public.current_user_vendor_ids())
  );

drop policy if exists vendor_notification_log_select_scoped on public.vendor_notification_log;
create policy vendor_notification_log_select_scoped
  on public.vendor_notification_log
  for select
  to authenticated
  using (
    public.can_access_landlord(landlord_id)
    or vendor_id in (select public.current_user_vendor_ids())
  );

drop policy if exists thumbtack_vendor_messages_select_staff on public.thumbtack_vendor_messages;
create policy thumbtack_vendor_messages_select_staff
  on public.thumbtack_vendor_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.thumbtack_vendor_threads t
      where t.id = thumbtack_vendor_messages.thread_id
        and public.can_access_landlord(t.landlord_id)
    )
  );

-- Provider credentials are platform operations, not a landlord portal privilege.
drop policy if exists sms_providers_select_staff on public.sms_providers;
drop policy if exists sms_providers_insert_staff on public.sms_providers;
drop policy if exists sms_providers_update_staff on public.sms_providers;
drop policy if exists sms_providers_delete_staff on public.sms_providers;

create policy sms_providers_select_staff
  on public.sms_providers
  for select
  to authenticated
  using (public.is_platform_staff());

create policy sms_providers_insert_staff
  on public.sms_providers
  for insert
  to authenticated
  with check (public.is_platform_staff());

create policy sms_providers_update_staff
  on public.sms_providers
  for update
  to authenticated
  using (public.is_platform_staff())
  with check (public.is_platform_staff());

create policy sms_providers_delete_staff
  on public.sms_providers
  for delete
  to authenticated
  using (public.is_platform_staff());

-- Empty quoted leftovers. "Allow all" made any authenticated role a full owner.
do $$
begin
  if to_regclass('public."Properties"') is not null then
    execute 'drop policy if exists "Allow all" on public."Properties"';
  end if;
  if to_regclass('public."Units"') is not null then
    execute 'drop policy if exists "Allow all" on public."Units"';
  end if;
end $$;
