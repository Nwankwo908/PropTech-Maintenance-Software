-- Maintenance invoice → approval → recognized spend pipeline for analytics.

-- ---------------------------------------------------------------------------
-- maintenance_requests — completion + spend recognition summary
-- ---------------------------------------------------------------------------

alter table public.maintenance_requests
  add column if not exists completed_at timestamptz,
  add column if not exists spend_status text not null default 'none',
  add column if not exists recognized_spend_at timestamptz,
  add column if not exists recognized_spend_amount numeric(12, 2);

alter table public.maintenance_requests
  drop constraint if exists maintenance_requests_spend_status_check;

alter table public.maintenance_requests
  add constraint maintenance_requests_spend_status_check
  check (
    spend_status in (
      'none',
      'awaiting_invoice',
      'pending_approval',
      'recognized',
      'rejected'
    )
  );

comment on column public.maintenance_requests.completed_at is
  'When vendor marked the job completed (vendor portal or email link).';
comment on column public.maintenance_requests.spend_status is
  'Invoice/spend lifecycle: none → awaiting_invoice → pending_approval → recognized.';
comment on column public.maintenance_requests.recognized_spend_at is
  'When landlord-approved spend was recorded to ledger + graph (analytics month bucket).';
comment on column public.maintenance_requests.recognized_spend_amount is
  'Approved total_cost copied at recognition time.';

create index if not exists maintenance_requests_spend_status_idx
  on public.maintenance_requests (landlord_id, spend_status)
  where spend_status in ('pending_approval', 'awaiting_invoice');

-- ---------------------------------------------------------------------------
-- maintenance_invoices — vendor upload, landlord approval
-- ---------------------------------------------------------------------------

create table if not exists public.maintenance_invoices (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null,
  maintenance_request_id uuid not null references public.maintenance_requests (id) on delete cascade,
  vendor_id uuid references public.vendors (id) on delete set null,
  invoice_number text,
  labor_cost numeric(12, 2) not null default 0,
  material_cost numeric(12, 2) not null default 0,
  tax_amount numeric(12, 2) not null default 0,
  total_cost numeric(12, 2) generated always as (
    coalesce(labor_cost, 0) + coalesce(material_cost, 0) + coalesce(tax_amount, 0)
  ) stored,
  status text not null default 'submitted',
  document_path text,
  vendor_notes text,
  submitted_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  rejection_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_invoices_status_check
    check (status in ('draft', 'submitted', 'approved', 'rejected')),
  constraint maintenance_invoices_request_unique unique (maintenance_request_id)
);

comment on table public.maintenance_invoices is
  'Vendor invoices for completed maintenance. Approved rows drive analytics spend recognition.';

create index if not exists maintenance_invoices_landlord_status_idx
  on public.maintenance_invoices (landlord_id, status, approved_at desc nulls last);

create index if not exists maintenance_invoices_vendor_idx
  on public.maintenance_invoices (vendor_id, submitted_at desc);

-- ---------------------------------------------------------------------------
-- Recognized spend view (analytics source of truth)
-- ---------------------------------------------------------------------------

create or replace view public.maintenance_recognized_spend_view
with (security_invoker = true)
as
select
  inv.id as invoice_id,
  inv.landlord_id,
  inv.maintenance_request_id,
  inv.vendor_id,
  inv.total_cost,
  inv.labor_cost,
  inv.material_cost,
  inv.tax_amount,
  inv.approved_at as spend_date,
  date_trunc('month', inv.approved_at)::date as spend_month,
  mr.urgency,
  mr.issue_category,
  mr.unit,
  mr.priority,
  mre.unit_id,
  mre.property_id,
  mre.resident_id,
  mre.building,
  case
    when lower(coalesce(mr.urgency, mr.priority, '')) in (
      'urgent', 'emergency', 'critical', 'high'
    ) then 'reactive'
    else 'proactive'
  end as spend_class
from public.maintenance_invoices inv
inner join public.maintenance_requests mr
  on mr.id = inv.maintenance_request_id
left join public.maintenance_request_enriched mre
  on mre.id = inv.maintenance_request_id
where inv.status = 'approved'
  and inv.approved_at is not null
  and inv.total_cost > 0;

comment on view public.maintenance_recognized_spend_view is
  'Landlord-approved maintenance spend for analytics (proactive vs reactive by urgency).';

-- ---------------------------------------------------------------------------
-- RLS — staff read; writes via Edge Functions (service role)
-- ---------------------------------------------------------------------------

alter table public.maintenance_invoices enable row level security;

create policy maintenance_invoices_select_authenticated
  on public.maintenance_invoices
  for select
  to authenticated
  using (true);

-- Backfill completed_at from vendor_status_events where missing
update public.maintenance_requests mr
set completed_at = vse.created_at
from (
  select
    ticket_id,
    min(created_at) as created_at
  from public.vendor_status_events
  where to_status = 'completed'
  group by ticket_id
) vse
where mr.id = vse.ticket_id
  and mr.vendor_work_status = 'completed'
  and mr.completed_at is null;

-- Completed tickets without invoice → awaiting_invoice
update public.maintenance_requests
set spend_status = 'awaiting_invoice'
where vendor_work_status = 'completed'
  and spend_status = 'none';
