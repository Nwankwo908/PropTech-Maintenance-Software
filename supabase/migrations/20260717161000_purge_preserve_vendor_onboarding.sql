-- General rule: onboarding actions must survive the New Landlord dashboard purge.
--
-- The empty-landlord purge (ensureOnboardingDashboardMatchesPortfolio, run on every
-- dashboard load) previously preserved only rows tied to a portfolio resident/vendor.
-- That kept tenant activation welcome texts (they carry a portfolio resident_id) but
-- WIPED vendor onboarding invites — a vendor is invited BEFORE it exists in the roster,
-- so vendor.invited events + their SMS threads have vendor_id = null and were deleted
-- on refresh. It also deleted the vendor_onboarding workflow_run unconditionally.
--
-- New behavior (preserve mode only): additionally keep
--   * operations_graph_events / property_operations_graph with event_type vendor.* / tenant.*
--   * sms_conversations linked to the vendor_onboarding workflow template
--   * workflow_runs for the vendor_onboarding template
-- Full reset (p_preserve_portfolio_sms = false) still wipes everything.

create or replace function public.purge_empty_landlord_operations(
  p_preserve_portfolio_sms boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  empty_landlord_id constant uuid := 'de300000-0000-4000-8000-000000000002';
  ticket_ids uuid[];
  resident_ids uuid[];
  vendor_ids uuid[];
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

  select coalesce(array_agg(id), '{}'::uuid[])
  into resident_ids
  from public.users
  where landlord_id = empty_landlord_id;

  select coalesce(array_agg(id), '{}'::uuid[])
  into vendor_ids
  from public.vendors
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

  -- Graph events: preserve rows tied to a current portfolio resident/vendor AND
  -- onboarding comms (tenant.* / vendor.*) when preserving; otherwise wipe all.
  if to_regclass('public.operations_graph_events') is not null then
    delete from public.operations_graph_events
    where landlord_id = empty_landlord_id
      and (
        not p_preserve_portfolio_sms
        or (
          (resident_id is null or not (resident_id = any (resident_ids)))
          and (vendor_id is null or not (vendor_id = any (vendor_ids)))
          and event_type not like 'vendor.%'
          and event_type not like 'tenant.%'
        )
      );
  end if;
  if to_regclass('public.property_operations_graph') is not null then
    delete from public.property_operations_graph
    where landlord_id = empty_landlord_id
      and (
        not p_preserve_portfolio_sms
        or (
          (resident_id is null or not (resident_id = any (resident_ids)))
          and (vendor_id is null or not (vendor_id = any (vendor_ids)))
          and event_type not like 'vendor.%'
          and event_type not like 'tenant.%'
        )
      );
  end if;

  -- SMS threads: preserve portfolio-tied threads AND vendor onboarding threads.
  if to_regclass('public.sms_conversations') is not null then
    delete from public.sms_conversations
    where landlord_id = empty_landlord_id
      and (
        not p_preserve_portfolio_sms
        or (
          (resident_id is null or not (resident_id = any (resident_ids)))
          and (vendor_id is null or not (vendor_id = any (vendor_ids)))
          and coalesce(workflow_template_id, '') <> 'vendor_onboarding'
        )
      );
  end if;
  -- Clean up any messages that no longer point to a surviving thread.
  if to_regclass('public.sms_messages') is not null then
    delete from public.sms_messages m
    where m.landlord_id = empty_landlord_id
      and not exists (
        select 1 from public.sms_conversations c where c.id = m.conversation_id
      );
  end if;

  -- Workflow runs: keep vendor_onboarding runs when preserving; otherwise wipe all.
  delete from public.workflow_runs
  where landlord_id = empty_landlord_id
    and (
      not p_preserve_portfolio_sms
      or template_id <> 'vendor_onboarding'
    );
  get diagnostics deleted_runs = row_count;

  delete from public.maintenance_requests where landlord_id = empty_landlord_id;
  get diagnostics deleted_tickets = row_count;

  return jsonb_build_object(
    'ok', true,
    'landlord_id', empty_landlord_id,
    'deleted_tickets', deleted_tickets,
    'deleted_runs', deleted_runs,
    'preserved_portfolio_sms', p_preserve_portfolio_sms
  );
end;
$$;

revoke all on function public.purge_empty_landlord_operations(boolean) from public;
grant execute on function public.purge_empty_landlord_operations(boolean) to authenticated;

comment on function public.purge_empty_landlord_operations(boolean) is
  'Fail-closed purge for New Landlord (empty). p_preserve_portfolio_sms keeps SMS threads + graph events tied to current portfolio residents/vendors AND onboarding comms (tenant.*/vendor.* events, vendor_onboarding threads + runs) while stripping unscoped import leftovers; false wipes all operational rows.';
