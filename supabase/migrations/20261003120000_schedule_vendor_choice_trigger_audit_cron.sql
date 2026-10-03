-- Daily standing check: vendor_choice_selected without a confirming inbound SMS
-- in the preceding ~2 minutes (WO-E6F7 class). Report-only.

insert into public.ulo_required_cron_jobs (jobname, edge_function, schedule, description)
values (
  'ulo-vendor-choice-trigger-audit',
  'check-vendor-choice-trigger-audit',
  '50 5 * * *',
  'Daily audit of landlord vendor-choice assignments without a durable confirming inbound SMS'
)
on conflict (jobname) do update
set
  edge_function = excluded.edge_function,
  schedule = excluded.schedule,
  description = excluded.description;

select public.ulo_ensure_required_cron_jobs();
