-- Staff can seed workflow runs during fast-track onboarding but previously could not
-- delete them (RLS), so guided complete / reset left orphan Active tasks.
-- 1) Mirror insert policies with staff DELETE.
-- 2) Fail-closed RPC that only purges ops for the New Landlord empty account.

drop policy if exists workflow_runs_delete_staff on public.workflow_runs;
create policy workflow_runs_delete_staff
  on public.workflow_runs
  for delete
  to authenticated
  using (public.is_staff_admin());

drop policy if exists workflow_events_delete_staff on public.workflow_events;
create policy workflow_events_delete_staff
  on public.workflow_events
  for delete
  to authenticated
  using (public.is_staff_admin());

do $$
begin
  if to_regclass('public.operations_graph_events') is not null then
    execute 'drop policy if exists operations_graph_events_delete_staff on public.operations_graph_events';
    execute $policy$
      create policy operations_graph_events_delete_staff
        on public.operations_graph_events
        for delete
        to authenticated
        using (public.is_staff_admin())
    $policy$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.property_operations_graph') is not null then
    execute 'drop policy if exists property_operations_graph_delete_staff on public.property_operations_graph';
    execute $policy$
      create policy property_operations_graph_delete_staff
        on public.property_operations_graph
        for delete
        to authenticated
        using (public.is_staff_admin())
    $policy$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.sms_conversations') is not null then
    execute 'drop policy if exists sms_conversations_delete_staff on public.sms_conversations';
    execute $policy$
      create policy sms_conversations_delete_staff
        on public.sms_conversations
        for delete
        to authenticated
        using (public.is_staff_admin())
    $policy$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.sms_messages') is not null then
    execute 'drop policy if exists sms_messages_delete_staff on public.sms_messages';
    execute $policy$
      create policy sms_messages_delete_staff
        on public.sms_messages
        for delete
        to authenticated
        using (public.is_staff_admin())
    $policy$;
  end if;
end $$;

-- Hard wipe of operational rows for New Landlord only (keeps units/vendors/residents).
create or replace function public.purge_empty_landlord_operations()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  empty_landlord_id constant uuid := 'de300000-0000-4000-8000-000000000002';
  ticket_ids uuid[];
  deleted_tickets int := 0;
  deleted_runs int := 0;
begin
  if not public.is_staff_admin() then
    raise exception 'not authorized';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[])
  into ticket_ids
  from public.maintenance_requests
  where landlord_id = empty_landlord_id;

  if cardinality(ticket_ids) > 0 then
    if to_regclass('public.vendor_status_events') is not null then
      delete from public.vendor_status_events where ticket_id = any (ticket_ids);
    end if;
    if to_regclass('public.vendor_notification_log') is not null then
      delete from public.vendor_notification_log where ticket_id = any (ticket_ids);
    end if;
    if to_regclass('public.resident_notification_log') is not null then
      delete from public.resident_notification_log where ticket_id = any (ticket_ids);
    end if;
  end if;

  if to_regclass('public.vendor_feedback') is not null then
    delete from public.vendor_feedback where landlord_id = empty_landlord_id;
  end if;
  if to_regclass('public.vendor_feedback_requests') is not null then
    delete from public.vendor_feedback_requests where landlord_id = empty_landlord_id;
  end if;
  if to_regclass('public.maintenance_invoices') is not null then
    delete from public.maintenance_invoices where landlord_id = empty_landlord_id;
  end if;
  if to_regclass('public.operations_graph_events') is not null then
    delete from public.operations_graph_events where landlord_id = empty_landlord_id;
  end if;
  if to_regclass('public.property_operations_graph') is not null then
    delete from public.property_operations_graph where landlord_id = empty_landlord_id;
  end if;

  -- SMS leftovers also mismatch guided portfolio (Communication page).
  if to_regclass('public.sms_messages') is not null then
    delete from public.sms_messages where landlord_id = empty_landlord_id;
  end if;
  if to_regclass('public.sms_conversations') is not null then
    delete from public.sms_conversations where landlord_id = empty_landlord_id;
  end if;

  delete from public.workflow_runs where landlord_id = empty_landlord_id;
  get diagnostics deleted_runs = row_count;

  delete from public.maintenance_requests where landlord_id = empty_landlord_id;
  get diagnostics deleted_tickets = row_count;

  return jsonb_build_object(
    'ok', true,
    'landlord_id', empty_landlord_id,
    'deleted_tickets', deleted_tickets,
    'deleted_runs', deleted_runs
  );
end;
$$;

revoke all on function public.purge_empty_landlord_operations() from public;
grant execute on function public.purge_empty_landlord_operations() to authenticated;

comment on function public.purge_empty_landlord_operations() is
  'Fail-closed: deletes tickets + workflow runs for New Landlord (empty) only. Used by guided onboarding complete and reset.';
