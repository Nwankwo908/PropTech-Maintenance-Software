-- Home inspection AI appliance / systems assessment sessions + photo rows.
-- Confirmed results upsert into unit_assets and preventive_maintenance_tasks.

create table if not exists public.property_inspection_assessments (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  building text not null,
  property_id uuid,
  status text not null default 'open'
    check (status in ('open', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.property_inspection_assessments is
  'AI inspection assessment sessions scoped to a landlord building.';

create index if not exists property_inspection_assessments_landlord_building_idx
  on public.property_inspection_assessments (landlord_id, building);

alter table public.property_inspection_assessments enable row level security;

create policy property_inspection_assessments_select_authenticated
  on public.property_inspection_assessments
  for select
  to authenticated
  using (true);

create table if not exists public.property_inspection_photos (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null
    references public.property_inspection_assessments (id) on delete cascade,
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  storage_path text,
  file_name text,
  content_type text,
  hint_category text
    check (
      hint_category is null
      or hint_category in ('appliance', 'hvac', 'water_heater', 'roof', 'other')
    ),
  status text not null default 'queued'
    check (status in ('queued', 'analyzing', 'needs_review', 'confirmed', 'error')),
  ai_result jsonb,
  confirmed_result jsonb,
  provider text
    check (provider is null or provider in ('gemini', 'gpt4o', 'claude')),
  error_message text,
  latency_ms integer,
  estimated_cost_usd numeric(10, 6),
  unit_asset_id uuid references public.unit_assets (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.property_inspection_photos is
  'Inspection photos/documents analyzed by vision AI; confirmed rows link to unit_assets.';

create index if not exists property_inspection_photos_assessment_idx
  on public.property_inspection_photos (assessment_id);

create index if not exists property_inspection_photos_landlord_status_idx
  on public.property_inspection_photos (landlord_id, status);

alter table public.property_inspection_photos enable row level security;

create policy property_inspection_photos_select_authenticated
  on public.property_inspection_photos
  for select
  to authenticated
  using (true);

-- Private storage for inspection photos / report pages
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inspection-uploads',
  'inspection-uploads',
  false,
  26214400,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf'
  ]
)
on conflict (id) do update
  set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Authenticated users can read inspection uploads"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'inspection-uploads');
