-- Fair vendor routing: track when a vendor was last assigned a ticket.

alter table public.vendors
  add column if not exists last_assigned_at timestamptz;

comment on column public.vendors.last_assigned_at is
  'Set when a maintenance request is assigned to this vendor (create-time assign or reassign).';

create index if not exists vendors_last_assigned_at_idx
  on public.vendors (last_assigned_at nulls last);
