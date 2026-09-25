-- Factory reset: clear huge activity-feed tables without statement_timeout.
-- Limited Alpha 2 can accumulate 100k+ property_operations_graph rows; a single
-- DELETE (RPC or client) hits the default statement timeout and falls through to
-- client_fallback, which also times out — leaving the bell full of old events.

create or replace function public.purge_landlord_table_batches(
  p_table regclass,
  p_landlord_id uuid,
  p_batch_size int default 5000
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  batch_size int := greatest(coalesce(p_batch_size, 5000), 100);
  deleted_batch int;
  deleted_total bigint := 0;
  max_loops int := 20000;
  i int := 0;
begin
  -- Disable statement timeout for this transaction (Supabase default is too low
  -- for 100k+ row landlord-scoped deletes).
  perform set_config('statement_timeout', '0', true);

  loop
    i := i + 1;
    if i > max_loops then
      raise exception 'purge_landlord_table_batches: exceeded max loops for %', p_table;
    end if;

    execute format(
      'with doomed as (
         select ctid from %s
         where landlord_id = $1
         limit $2
       )
       delete from %s t
       using doomed d
       where t.ctid = d.ctid',
      p_table,
      p_table
    )
    using p_landlord_id, batch_size;

    get diagnostics deleted_batch = row_count;
    deleted_total := deleted_total + deleted_batch;
    exit when deleted_batch = 0;
  end loop;

  return deleted_total;
end;
$$;

comment on function public.purge_landlord_table_batches(regclass, uuid, int) is
  'Internal batched DELETE by landlord_id. Used by factory-reset activity-feed and portfolio purge.';

revoke all on function public.purge_landlord_table_batches(regclass, uuid, int) from public;
grant execute on function public.purge_landlord_table_batches(regclass, uuid, int) to service_role;

-- Dedicated activity-feed wipe (bell sources only). Callable after portfolio wipe
-- or when the full portfolio RPC timed out mid-flight.
create or replace function public.purge_landlord_activity_feed(p_landlord_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed constant uuid[] := array[
    '068daf53-07e4-4493-bd7f-6106e3c8c62f'::uuid,
    'de300000-0000-4000-8000-000000000001'::uuid,
    'de300000-0000-4000-8000-000000000002'::uuid,
    'de300000-0000-4000-8000-000000000003'::uuid,
    'de300000-0000-4000-8000-000000000004'::uuid
  ];
  deleted_ops bigint := 0;
  deleted_pog bigint := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') is distinct from 'service_role'
     and not public.is_staff_admin() then
    raise exception 'not authorized';
  end if;

  if not (p_landlord_id = any (allowed)) then
    raise exception 'landlord % is not allowed for activity feed purge', p_landlord_id;
  end if;

  perform set_config('statement_timeout', '0', true);

  if to_regclass('public.operations_graph_events') is not null then
    deleted_ops := public.purge_landlord_table_batches(
      'public.operations_graph_events'::regclass,
      p_landlord_id,
      5000
    );
  end if;

  if to_regclass('public.property_operations_graph') is not null then
    deleted_pog := public.purge_landlord_table_batches(
      'public.property_operations_graph'::regclass,
      p_landlord_id,
      5000
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'landlord_id', p_landlord_id,
    'deleted_operations_graph_events', deleted_ops,
    'deleted_property_operations_graph', deleted_pog
  );
end;
$$;

comment on function public.purge_landlord_activity_feed(uuid) is
  'Batched wipe of operations_graph_events + property_operations_graph for allowlisted factory-reset landlords.';

revoke all on function public.purge_landlord_activity_feed(uuid) from public;
grant execute on function public.purge_landlord_activity_feed(uuid) to service_role;
grant execute on function public.purge_landlord_activity_feed(uuid) to authenticated;

-- Patch portfolio purge: same timeout + batched graph deletes so Alpha 2 does not
-- fall through to client_fallback on 100k+ feed rows.
create or replace function public.purge_landlord_portfolio(p_landlord_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed constant uuid[] := array[
    '068daf53-07e4-4493-bd7f-6106e3c8c62f'::uuid,
    'de300000-0000-4000-8000-000000000001'::uuid,
    'de300000-0000-4000-8000-000000000002'::uuid,
    'de300000-0000-4000-8000-000000000003'::uuid,
    'de300000-0000-4000-8000-000000000004'::uuid
  ];
  ticket_ids uuid[];
  unit_ids uuid[];
  deleted_tickets int := 0;
  deleted_runs int := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') is distinct from 'service_role'
     and not public.is_staff_admin() then
    raise exception 'not authorized';
  end if;

  if not (p_landlord_id = any (allowed)) then
    raise exception 'landlord % is not allowed for portfolio purge', p_landlord_id;
  end if;

  -- Full portfolio wipe can touch very large graph tables.
  perform set_config('statement_timeout', '0', true);

  select coalesce(array_agg(distinct mr.id), '{}'::uuid[])
  into ticket_ids
  from public.maintenance_requests mr
  where mr.landlord_id = p_landlord_id
     or mr.assigned_vendor_id in (
       select v.id from public.vendors v where v.landlord_id = p_landlord_id
     );

  select coalesce(array_agg(id), '{}'::uuid[])
  into unit_ids
  from public.units
  where landlord_id = p_landlord_id;

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
    if to_regclass('public.maintenance_estimates') is not null then
      delete from public.maintenance_estimates
      where maintenance_request_id = any (ticket_ids);
    end if;
  end if;

  if to_regclass('public.maintenance_estimates') is not null then
    delete from public.maintenance_estimates where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.insight_scheduling_requests') is not null then
    delete from public.insight_scheduling_requests where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.inspector_day_holds') is not null then
    delete from public.inspector_day_holds where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.home_data_graph_ingest') is not null then
    delete from public.home_data_graph_ingest where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.home_data_graph') is not null then
    delete from public.home_data_graph where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.thumbtack_vendor_threads') is not null then
    delete from public.thumbtack_vendor_threads where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.landlord_thumbtack_oauth') is not null then
    delete from public.landlord_thumbtack_oauth where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.thumbtack_oauth_states') is not null then
    delete from public.thumbtack_oauth_states where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.tenant_activation_attempts') is not null then
    delete from public.tenant_activation_attempts where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.broadcast_notification_log') is not null then
    delete from public.broadcast_notification_log where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.broadcast_notifications') is not null then
    delete from public.broadcast_notifications where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.property_inspection_assessments') is not null then
    delete from public.property_inspection_assessments where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.property_access_profiles') is not null then
    delete from public.property_access_profiles where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.vendor_feedback_requests') is not null then
    delete from public.vendor_feedback_requests where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.vendor_incident_reports') is not null then
    delete from public.vendor_incident_reports where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.vendor_onboarding_override_acks') is not null then
    delete from public.vendor_onboarding_override_acks where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.vendor_feedback') is not null then
    delete from public.vendor_feedback where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.maintenance_invoices') is not null then
    delete from public.maintenance_invoices where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.vendor_verifications') is not null then
    delete from public.vendor_verifications where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.sms_messages') is not null then
    delete from public.sms_messages where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.sms_conversations') is not null then
    delete from public.sms_conversations where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.sms_identities') is not null then
    delete from public.sms_identities where landlord_id = p_landlord_id;
  end if;

  -- Batched: these two are the Ulo Activity bell sources and can be huge.
  if to_regclass('public.property_operations_graph') is not null then
    perform public.purge_landlord_table_batches(
      'public.property_operations_graph'::regclass,
      p_landlord_id,
      5000
    );
  end if;
  if to_regclass('public.operations_graph_events') is not null then
    perform public.purge_landlord_table_batches(
      'public.operations_graph_events'::regclass,
      p_landlord_id,
      5000
    );
  end if;

  if to_regclass('public.workflow_events') is not null then
    delete from public.workflow_events where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.unit_inspections') is not null then
    delete from public.unit_inspections where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.inspections') is not null then
    delete from public.inspections where landlord_id = p_landlord_id;
  end if;

  delete from public.workflow_runs where landlord_id = p_landlord_id;
  get diagnostics deleted_runs = row_count;

  if cardinality(ticket_ids) > 0 then
    delete from public.maintenance_requests where id = any (ticket_ids);
  end if;
  delete from public.maintenance_requests where landlord_id = p_landlord_id;
  get diagnostics deleted_tickets = row_count;

  if to_regclass('public.occupancy') is not null then
    delete from public.occupancy
    where landlord_id = p_landlord_id
       or unit_id = any (unit_ids);
  end if;
  delete from public.users where landlord_id = p_landlord_id;
  delete from public.vendors where landlord_id = p_landlord_id;
  delete from public.units where landlord_id = p_landlord_id;
  if to_regclass('public.properties') is not null then
    delete from public.properties where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.landlord_onboarding') is not null then
    delete from public.landlord_onboarding where landlord_id = p_landlord_id;
  end if;

  if p_landlord_id = 'de300000-0000-4000-8000-000000000003'::uuid then
    update public.landlords
    set
      name = 'Limited Alpha 1',
      email = 'limitedalpha1@ulohome.io',
      contact_name = null,
      phone = null
    where id = p_landlord_id;
  elsif p_landlord_id = 'de300000-0000-4000-8000-000000000004'::uuid then
    update public.landlords
    set
      name = 'Limited Alpha 2',
      email = 'limitedalpha2@ulohome.io',
      contact_name = null,
      phone = null
    where id = p_landlord_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'landlord_id', p_landlord_id,
    'deleted_tickets', deleted_tickets,
    'deleted_runs', deleted_runs
  );
end;
$$;

comment on function public.purge_landlord_portfolio(uuid) is
  'Portfolio wipe for allowlisted test landlords. Batches activity-feed deletes; statement_timeout disabled for the call. Allowlist: Demo …0001, New Landlord …0002, Full Alpha 068daf53-…, Limited Alpha 1 …0003, Limited Alpha 2 …0004.';
