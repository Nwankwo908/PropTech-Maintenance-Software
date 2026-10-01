-- Stall follow-up for unfinished maintenance tickets (vendor / resident).
-- One follow-up per stall episode; escalate via needs_admin_vendor digest sticky.
-- Does not touch rent_collection / payment reminder / invoice-paid flows.

alter table public.maintenance_requests
  add column if not exists stall_follow_up_sent_at timestamptz;

alter table public.maintenance_requests
  add column if not exists stall_follow_up_kind text;

alter table public.maintenance_requests
  add column if not exists stall_follow_up_episode_key text;

comment on column public.maintenance_requests.stall_follow_up_sent_at is
  'When the stall follow-up SMS was last sent for the current stall episode.';
comment on column public.maintenance_requests.stall_follow_up_kind is
  'Stall kind last followed up (no_vendor_response, no_schedule_confirmed, …).';
comment on column public.maintenance_requests.stall_follow_up_episode_key is
  'Stable episode key so cron re-runs do not re-SMS the same stall.';

create index if not exists maintenance_requests_stall_follow_up_sent_at_idx
  on public.maintenance_requests (stall_follow_up_sent_at)
  where stall_follow_up_sent_at is not null;

-- Register + schedule the dedicated stall follow-up cron (hourly, offset from rematch).
insert into public.ulo_required_cron_jobs (jobname, edge_function, schedule, description)
values (
  'ulo-maintenance-stall-follow-up',
  'check-maintenance-stall-follow-up',
  '35 * * * *',
  'Hourly stall follow-up for unfinished maintenance (vendor/resident; not rent)'
)
on conflict (jobname) do update
set
  edge_function = excluded.edge_function,
  schedule = excluded.schedule,
  description = excluded.description;

select public.ulo_ensure_required_cron_jobs();
