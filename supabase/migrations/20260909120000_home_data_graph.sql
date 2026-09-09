-- Canonical Home Data Graph: provider-neutral property facts.
-- Ingest snapshots keep RentCast / ATTOM / other raw payloads off the graph columns.

create table if not exists public.home_data_graph (
  property_id uuid primary key references public.properties (id) on delete cascade,
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  estimated_value numeric,
  estimated_value_low numeric,
  estimated_value_high numeric,
  property_type text,
  bedrooms numeric,
  bathrooms numeric,
  living_area_sqft numeric,
  lot_size_sqft numeric,
  year_built integer
    check (year_built is null or (year_built >= 1700 and year_built <= 2100)),
  unit_count integer
    check (unit_count is null or unit_count >= 0),
  has_garage boolean,
  garage_spaces numeric,
  garage_type text,
  has_pool boolean,
  pool_type text,
  heating text,
  cooling text,
  last_sale_price numeric,
  last_sale_date date,
  tax_year integer,
  property_tax_annual numeric,
  assessed_value numeric,
  source_provider text not null,
  source_record_id text,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists home_data_graph_landlord_id_idx
  on public.home_data_graph (landlord_id);

comment on table public.home_data_graph is
  'Current canonical property facts for the Home Data Graph. Columns are provider-neutral; source_provider names the last ingest (rentcast, attom, …).';

create table if not exists public.home_data_graph_ingest (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  provider text not null,
  provider_record_id text,
  raw_payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists home_data_graph_ingest_property_fetched_idx
  on public.home_data_graph_ingest (property_id, fetched_at desc);

comment on table public.home_data_graph_ingest is
  'Provider payloads for Home Data Graph ingest. Swap or add ATTOM without changing home_data_graph columns.';

grant select on public.home_data_graph to authenticated;
grant select on public.home_data_graph_ingest to authenticated;

alter table public.home_data_graph enable row level security;
alter table public.home_data_graph_ingest enable row level security;

drop policy if exists home_data_graph_select_staff on public.home_data_graph;
create policy home_data_graph_select_staff
  on public.home_data_graph for select to authenticated
  using (public.is_staff_admin());

drop policy if exists home_data_graph_ingest_select_staff on public.home_data_graph_ingest;
create policy home_data_graph_ingest_select_staff
  on public.home_data_graph_ingest for select to authenticated
  using (public.is_staff_admin());
