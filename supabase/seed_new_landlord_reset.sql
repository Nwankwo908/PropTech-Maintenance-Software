-- Reset New Landlord showcase account to a pristine empty state (no portfolio data).
-- Idempotent — safe to re-run before onboarding demos.
--
--   psql "$DATABASE_URL" -f supabase/seed_new_landlord_reset.sql

do $$
declare
  new_landlord uuid := 'de300000-0000-4000-8000-000000000002';
begin
  if to_regclass('public.vendor_feedback') is not null then
    delete from public.vendor_feedback where landlord_id = new_landlord;
  end if;
  if to_regclass('public.vendor_status_events') is not null then
    delete from public.vendor_status_events
    where ticket_id in (
      select id from public.maintenance_requests where landlord_id = new_landlord
    );
  end if;
  if to_regclass('public.maintenance_invoices') is not null then
    delete from public.maintenance_invoices where landlord_id = new_landlord;
  end if;
  if to_regclass('public.preventive_maintenance_tasks') is not null then
    delete from public.preventive_maintenance_tasks where landlord_id = new_landlord;
  end if;
  if to_regclass('public.unit_assets') is not null then
    delete from public.unit_assets where landlord_id = new_landlord;
  end if;
  if to_regclass('public.operations_graph_events') is not null then
    delete from public.operations_graph_events where landlord_id = new_landlord;
  end if;
  if to_regclass('public.workflow_events') is not null then
    delete from public.workflow_events where landlord_id = new_landlord;
  end if;
  if to_regclass('public.workflow_runs') is not null then
    delete from public.workflow_runs where landlord_id = new_landlord;
  end if;
  if to_regclass('public.maintenance_requests') is not null then
    delete from public.maintenance_requests where landlord_id = new_landlord;
  end if;
  if to_regclass('public.occupancy') is not null then
    delete from public.occupancy
    where unit_id in (select id from public.units where landlord_id = new_landlord);
  end if;
  if to_regclass('public.users') is not null then
    delete from public.users where landlord_id = new_landlord;
  end if;
  if to_regclass('public.vendors') is not null then
    delete from public.vendors where landlord_id = new_landlord;
  end if;
  if to_regclass('public.units') is not null then
    delete from public.units where landlord_id = new_landlord;
  end if;
  if to_regclass('public.landlord_onboarding') is not null then
    delete from public.landlord_onboarding where landlord_id = new_landlord;
  end if;

  raise notice 'New Landlord account reset — portfolio data cleared for %', new_landlord;
end $$;
