-- Structured context for work orders so reminders/digests can show a real
-- summary and where in the home the problem is, instead of raw tenant text.
--
-- NOTE: maintenance_requests.urgency already exists as resident-facing
-- (low | normal | urgent). Staff digest urgency lives in context_urgency.

alter table public.maintenance_requests
  add column if not exists summary          text,          -- one line, <= 90 chars, written for staff
  add column if not exists category         text,          -- plumbing | electrical | pest | appliance | hvac | safety | interior | exterior | general
  add column if not exists room             text,          -- Bathroom, Kitchen, Bedroom, Exterior, ...
  add column if not exists location_detail  text,          -- "under vanity", "left front, floor 2"
  add column if not exists context_urgency  text,          -- emergency | safety | routine (staff digest; not resident form urgency)
  add column if not exists summary_source_hash text,       -- hash of description the summary was built from
  add column if not exists summarized_at    timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'maintenance_requests_context_urgency_check'
  ) then
    alter table public.maintenance_requests
      add constraint maintenance_requests_context_urgency_check
      check (context_urgency is null or context_urgency in ('emergency', 'safety', 'routine'));
  end if;
end $$;

comment on column public.maintenance_requests.summary is
  'Staff-facing one-line summary generated from description (see _shared/workOrderContext.ts). Never shown instead of the original description on the ticket page.';
comment on column public.maintenance_requests.context_urgency is
  'Staff digest urgency (emergency | safety | routine). Separate from resident-facing urgency (low | normal | urgent).';
