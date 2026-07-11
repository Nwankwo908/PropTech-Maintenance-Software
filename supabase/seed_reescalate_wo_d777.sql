-- Idempotent patch: reset demo WO-D777 for move-out preparation testing.
-- Removes legacy maintenance WO-D777 and clears move-out run d7770000-… so
-- "Trigger move-out prep" on the showcase lease renewal spawns Move-Out
-- Preparation WO-D777 with automated kickoff.
--
-- Usage:
--   psql "$DATABASE_URL" -f supabase/seed_reescalate_wo_d777.sql

do $$
declare
  demo_landlord uuid := 'de300000-0000-4000-8000-000000000001';
  move_out_run uuid := 'd7770000-0000-4000-8000-000000000001';
  legacy_maint_run uuid := 'd7770001-0000-4000-8000-000000000001';
  legacy_ticket uuid := move_out_run;
begin
  if not exists (select 1 from public.landlords where id = demo_landlord) then
    raise exception 'demo landlord missing';
  end if;

  delete from public.vendor_status_events where ticket_id = legacy_ticket;
  delete from public.maintenance_requests where id = legacy_ticket;

  delete from public.workflow_events where workflow_run_id in (legacy_maint_run, move_out_run);
  delete from public.property_operations_graph where workflow_run_id in (legacy_maint_run, move_out_run);
  delete from public.workflow_runs where id in (legacy_maint_run, move_out_run);
end $$;
