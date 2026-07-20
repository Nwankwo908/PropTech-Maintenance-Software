-- Vendor estimates for work beyond original scope (Phase 3 / 4.3).
-- Landlord approves via 1-tap SMS/email link; vendor is notified on decision.

create table if not exists public.maintenance_estimates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  maintenance_request_id uuid not null
    references public.maintenance_requests (id) on delete cascade,
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete restrict,
  parts_cost numeric(12, 2) not null default 0
    check (parts_cost >= 0),
  labor_cost numeric(12, 2) not null default 0
    check (labor_cost >= 0),
  total_cost numeric(12, 2) not null default 0
    check (total_cost >= 0),
  notes text,
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'rejected', 'superseded')),
  landlord_action_token uuid not null default gen_random_uuid(),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  decision_note text,
  vendor_notified_at timestamptz
);

comment on table public.maintenance_estimates is
  'Vendor cost estimates awaiting landlord approval (tokenized /estimate + SMS 1-tap).';
comment on column public.maintenance_estimates.landlord_action_token is
  'Secret for landlord approve/reject links (no login).';

create unique index if not exists maintenance_estimates_action_token_uidx
  on public.maintenance_estimates (landlord_action_token);

create index if not exists maintenance_estimates_ticket_idx
  on public.maintenance_estimates (maintenance_request_id, created_at desc);

create index if not exists maintenance_estimates_landlord_pending_idx
  on public.maintenance_estimates (landlord_id, status)
  where status = 'pending_approval';

-- At most one pending estimate per ticket.
create unique index if not exists maintenance_estimates_one_pending_per_ticket_uidx
  on public.maintenance_estimates (maintenance_request_id)
  where status = 'pending_approval';

alter table public.maintenance_estimates enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'maintenance_estimates'
      and policyname = 'maintenance_estimates_select_staff'
  ) then
    create policy maintenance_estimates_select_staff
      on public.maintenance_estimates
      for select
      to authenticated
      using (public.is_staff_admin());
  end if;
end $$;

grant select on public.maintenance_estimates to authenticated;
grant all on public.maintenance_estimates to service_role;
