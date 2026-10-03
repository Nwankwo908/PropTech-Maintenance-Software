-- Daily standing check: ticket/conversation unit_id vs resident occupancy.
-- Catches silent write-time FK corruption (WO-C2C7 class). Report-only.

insert into public.ulo_required_cron_jobs (jobname, edge_function, schedule, description)
values (
  'ulo-ticket-unit-fk-audit',
  'check-ticket-unit-fk-mismatches',
  '45 5 * * *',
  'Daily audit of ticket/conversation unit_id vs resident occupancy (fail-closed FK drift)'
)
on conflict (jobname) do update
set
  edge_function = excluded.edge_function,
  schedule = excluded.schedule,
  description = excluded.description;

select public.ulo_ensure_required_cron_jobs();
