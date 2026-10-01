-- HQS / housing-compliance inspection letter intake.
-- Landlords MMS (or later email) a fail letter → Ulo extracts deficiencies →
-- confirms with landlord → one inspection_reports row + owner-responsibility work orders.

-- ---------------------------------------------------------------------------
-- Source documents (property-scoped; also linked from inspection_reports)
-- ---------------------------------------------------------------------------
create table if not exists public.inspection_source_documents (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  property_id uuid references public.properties (id) on delete set null,
  unit_id uuid references public.units (id) on delete set null,
  storage_bucket text not null default 'inspection-uploads',
  storage_path text not null,
  file_name text,
  content_type text,
  source_channel text not null default 'sms'
    check (source_channel in ('sms', 'email', 'dashboard', 'other')),
  created_at timestamptz not null default now()
);

comment on table public.inspection_source_documents is
  'Original HQS/compliance letter files (PDF or image) linked to property/unit and inspection_reports.';

create index if not exists inspection_source_documents_landlord_idx
  on public.inspection_source_documents (landlord_id, created_at desc);

create index if not exists inspection_source_documents_unit_idx
  on public.inspection_source_documents (unit_id)
  where unit_id is not null;

alter table public.inspection_source_documents enable row level security;

create policy inspection_source_documents_select_authenticated
  on public.inspection_source_documents
  for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Inspection reports (one row per letter after landlord confirms)
-- ---------------------------------------------------------------------------
create table if not exists public.inspection_reports (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  property_id uuid references public.properties (id) on delete set null,
  unit_id uuid not null references public.units (id) on delete restrict,
  owner_id_external text,
  tenant_id_external text,
  inspection_id_external text,
  letter_date date,
  inspection_date date,
  inspection_dates date[],
  letter_type text not null default 'standard_fail'
    check (letter_type in ('standard_fail', 'hap_abatement')),
  is_abated boolean not null default false,
  reinspection_date date,
  reinspection_fee numeric(10, 2),
  emergency_item_count integer not null default 0,
  standard_item_count integer not null default 0,
  source_document_id uuid references public.inspection_source_documents (id) on delete set null,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'completed', 'cancelled')),
  conversation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.inspection_reports is
  'Confirmed HQS/compliance fail letters. Source PDF/image on source_document_id; owner-responsibility deficiencies become maintenance_requests.';

create index if not exists inspection_reports_landlord_unit_idx
  on public.inspection_reports (landlord_id, unit_id, created_at desc);

create index if not exists inspection_reports_external_ids_idx
  on public.inspection_reports (landlord_id, owner_id_external, tenant_id_external);

alter table public.inspection_reports enable row level security;

create policy inspection_reports_select_authenticated
  on public.inspection_reports
  for select
  to authenticated
  using (true);

-- Link work orders back to the inspection letter that spawned them.
alter table public.maintenance_requests
  add column if not exists inspection_report_id uuid
    references public.inspection_reports (id) on delete set null;

create index if not exists maintenance_requests_inspection_report_idx
  on public.maintenance_requests (inspection_report_id)
  where inspection_report_id is not null;

comment on column public.maintenance_requests.inspection_report_id is
  'When set, this work order was created from an HQS/compliance inspection letter deficiency.';

-- ---------------------------------------------------------------------------
-- Persist (owner_id, tenant_id) → unit after landlord answers once
-- ---------------------------------------------------------------------------
create table if not exists public.hqs_owner_tenant_unit_map (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  owner_id_external text not null,
  tenant_id_external text not null,
  unit_id uuid not null references public.units (id) on delete cascade,
  property_id uuid references public.properties (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (landlord_id, owner_id_external, tenant_id_external)
);

comment on table public.hqs_owner_tenant_unit_map is
  'Maps housing-authority owner/tenant ids from HQS letters to Ulo units after landlord confirms once.';

create index if not exists hqs_owner_tenant_unit_map_lookup_idx
  on public.hqs_owner_tenant_unit_map (landlord_id, owner_id_external, tenant_id_external);

alter table public.hqs_owner_tenant_unit_map enable row level security;

create policy hqs_owner_tenant_unit_map_select_authenticated
  on public.hqs_owner_tenant_unit_map
  for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- HQS "Fail Items" category → Ulo vendor trade
-- ---------------------------------------------------------------------------
create table if not exists public.hqs_fail_category_trade_map (
  fail_category text primary key,
  vendor_trade text not null,
  notes text,
  created_at timestamptz not null default now()
);

comment on table public.hqs_fail_category_trade_map is
  'Lookup from HQS Fail Items category labels to Ulo vendor_trade slugs for dispatch.';

insert into public.hqs_fail_category_trade_map (fail_category, vendor_trade, notes) values
  ('Gas Range/Oven', 'appliance_repair', 'Often emergency / 24-hr'),
  ('Range/Oven', 'appliance_repair', null),
  ('Refrigerator', 'appliance_repair', null),
  ('Smoke Detector', 'electrical', null),
  ('Smoke Detectors', 'electrical', null),
  ('Carbon Monoxide Detector', 'electrical', null),
  ('Electrical System', 'electrical', null),
  ('Electrical Outlets', 'electrical', null),
  ('Outlets/Switches', 'electrical', null),
  ('Lighting', 'electrical', null),
  ('Plumbing', 'plumbing', null),
  ('Water Heater', 'plumbing', null),
  ('Toilet', 'plumbing', null),
  ('Sink', 'plumbing', null),
  ('Bathtub/Shower', 'plumbing', null),
  ('Hot Water', 'plumbing', null),
  ('Heating', 'hvac', null),
  ('HVAC', 'hvac', null),
  ('Air Conditioning', 'hvac', null),
  ('Windows', 'windows', null),
  ('Doors', 'carpentry', null),
  ('Exterior Doors', 'carpentry', null),
  ('Walls', 'carpentry', null),
  ('Ceilings', 'carpentry', null),
  ('Floors', 'flooring', null),
  ('Floor Covering', 'flooring', null),
  ('Roof', 'roofing', null),
  ('Gutters', 'roofing', null),
  ('Stairs', 'carpentry', null),
  ('Handrails', 'carpentry', null),
  ('Porch', 'deck_builder', null),
  ('Deck', 'deck_builder', null),
  ('Site/Grounds', 'landscaping', null),
  ('Infestation', 'pest_control', null),
  ('Pest Infestation', 'pest_control', null),
  ('Locks', 'locksmith', null),
  ('Security', 'locksmith', null),
  ('Paint', 'painting', null),
  ('Lead Paint', 'painting', null),
  ('Other', 'general', null)
on conflict (fail_category) do nothing;

alter table public.hqs_fail_category_trade_map enable row level security;

create policy hqs_fail_category_trade_map_select_authenticated
  on public.hqs_fail_category_trade_map
  for select
  to authenticated
  using (true);
