-- Factory reset was stopping on work_order_terminations.ticket_id (ON DELETE RESTRICT)
-- and then falling through to browser deletes that cannot remove the portfolio.

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
  -- Home Checks reference assessments, workflow runs, tickets, properties, and photos
  -- without ON DELETE CASCADE. Remove them before any of those deletes.
  perform public.purge_landlord_home_checks(p_landlord_id);

  if to_regclass('public.preventive_maintenance_tasks') is not null then
    delete from public.preventive_maintenance_tasks where landlord_id = p_landlord_id;
  end if;
  if to_regclass('public.unit_assets') is not null then
    delete from public.unit_assets where landlord_id = p_landlord_id;
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

  -- Termination audit rows restrict ticket deletes. Factory reset removes them
  -- with the portfolio. Notify attempts cascade from these rows.
  if to_regclass('public.work_order_terminations') is not null then
    delete from public.work_order_terminations
    where landlord_id = p_landlord_id
       or (cardinality(ticket_ids) > 0 and ticket_id = any (ticket_ids));
  end if;

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
  if to_regclass('public.inspection_reports') is not null then
    delete from public.inspection_reports where landlord_id = p_landlord_id;
  end if;
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
  'Portfolio wipe for allowlisted test landlords. Clears Home Checks before assessments, workflow runs, tickets, and properties. Batches activity-feed deletes; statement_timeout disabled for the call. Allowlist: Demo …0001, New Landlord …0002, Full Alpha 068daf53-…, Limited Alpha 1 …0003, Limited Alpha 2 …0004.';
