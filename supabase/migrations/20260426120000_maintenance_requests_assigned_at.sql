-- When the ticket was linked to the current vendor (initial assign / reassign can update separately).

alter table public.maintenance_requests
  add column if not exists assigned_at timestamptz;

comment on column public.maintenance_requests.assigned_at is
  'Timestamp when assigned_vendor_id was set for this ticket (Edge: first persist before vendor notify).';
