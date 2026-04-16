-- Resident-facing urgency (low | normal | urgent), aligned with form field `urgency`.
-- Backfilled from `priority` so existing rows stay consistent (column was historically renamed from urgency → priority).

alter table public.maintenance_requests
  add column if not exists urgency text;

update public.maintenance_requests
set urgency = priority
where urgency is null;

alter table public.maintenance_requests
  alter column urgency set not null;

comment on column public.maintenance_requests.urgency is
  'Resident-selected urgency; kept in sync with priority on write. Exposed to vendor-list-tickets API.';
