-- Extend Ask Ulo support_tickets for rent/billing SMS QUESTIONS inquiries.
-- Same table + type field (prefer share over a parallel table).

alter table public.support_tickets
  drop constraint if exists support_tickets_type_check;

alter table public.support_tickets
  add constraint support_tickets_type_check
  check (type in ('product_support', 'rent_billing_inquiry'));

alter table public.support_tickets
  add column if not exists resident_id uuid references public.users (id) on delete set null;

alter table public.support_tickets
  add column if not exists workflow_run_id uuid;

alter table public.support_tickets
  add column if not exists escalate_after timestamptz;

alter table public.support_tickets
  add column if not exists escalated_at timestamptz;

alter table public.support_tickets
  add column if not exists awaiting_tenant_detail boolean not null default false;

comment on table public.support_tickets is
  'Support tickets: Ask Ulo product_support and rent_billing_inquiry (tenant QUESTIONS). Persist before notify.';

comment on column public.support_tickets.escalate_after is
  'When set, open rent_billing_inquiry tickets without staff close escalate after this time.';

comment on column public.support_tickets.awaiting_tenant_detail is
  'Bare QUESTIONS with no inline ask — next short inbound on the thread attaches to this ticket.';

create index if not exists support_tickets_rent_escalate_idx
  on public.support_tickets (escalate_after)
  where type = 'rent_billing_inquiry'
    and status = 'open'
    and escalated_at is null
    and escalate_after is not null;

create index if not exists support_tickets_rent_resident_open_idx
  on public.support_tickets (landlord_id, resident_id, status)
  where type = 'rent_billing_inquiry';
