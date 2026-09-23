-- Insight inspector day holds + scheduling request state (Property Insights CTAs).
-- Inspectors = vendors.category = 'inspection' (see vendorTradeDefinitions).

alter table public.vendors drop constraint if exists vendors_category_check;

alter table public.vendors
  add constraint vendors_category_check
  check (
    category is null
    or category in (
      'appliance_repair',
      'carpentry',
      'cleaning',
      'concrete',
      'deck_builder',
      'electrical',
      'flooring',
      'general',
      'hvac',
      'inspection',
      'landscaping',
      'locksmith',
      'masonry',
      'painting',
      'pest_control',
      'plumbing',
      'roofing',
      'windows',
      'other'
    )
  );

comment on column public.vendors.category is
  'Normalized vendor trade slug (…, inspection, plumbing, general, …). See vendorTrades taxonomy.';

create table if not exists public.inspector_day_holds (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  hold_date date not null,
  ticket_id uuid references public.maintenance_requests (id) on delete set null,
  insight_card_id text,
  status text not null default 'held'
    constraint inspector_day_holds_status_check
      check (status in ('held', 'released', 'consumed')),
  expires_at timestamptz not null
);

comment on table public.inspector_day_holds is
  'Provisional same-day holds while an insight inspector soft-offer probe is pending.';

create unique index if not exists inspector_day_holds_one_active_per_vendor_day
  on public.inspector_day_holds (vendor_id, hold_date)
  where status = 'held';

create index if not exists inspector_day_holds_expires_idx
  on public.inspector_day_holds (expires_at)
  where status = 'held';

create index if not exists inspector_day_holds_landlord_idx
  on public.inspector_day_holds (landlord_id, hold_date);

alter table public.inspector_day_holds enable row level security;

create table if not exists public.insight_scheduling_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  insight_card_id text not null,
  action_type text not null,
  scope text not null default 'unit'
    constraint insight_scheduling_requests_scope_check
      check (scope in ('building', 'unit', 'diagnostic')),
  status text not null default 'probing'
    constraint insight_scheduling_requests_status_check
      check (status in ('probing', 'accepted', 'needs_external', 'cancelled')),
  target_day date not null,
  ticket_id uuid references public.maintenance_requests (id) on delete set null,
  unit_id uuid,
  unit_label text,
  building text,
  category_label text,
  issue_summary text,
  hold_id uuid references public.inspector_day_holds (id) on delete set null,
  vendor_id uuid references public.vendors (id) on delete set null,
  inspector_name text,
  confirmed_window text,
  probe_started_at timestamptz,
  expires_at timestamptz
);

comment on table public.insight_scheduling_requests is
  'Per Recommended Actions card: inspector probe / accept / external fallback state.';

create index if not exists insight_scheduling_requests_landlord_card_idx
  on public.insight_scheduling_requests (landlord_id, insight_card_id, created_at desc);

create index if not exists insight_scheduling_requests_probe_expiry_idx
  on public.insight_scheduling_requests (expires_at)
  where status = 'probing';

alter table public.insight_scheduling_requests enable row level security;
