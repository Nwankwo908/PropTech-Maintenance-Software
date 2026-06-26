-- Unit assets: appliance inventory + AI photo-detection outputs for PM analytics.
-- Future: photo upload → edge function → upsert rows with detection_source = 'photo_ai'.

create table if not exists public.unit_assets (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  unit_id uuid references public.units (id) on delete set null,
  property_id uuid,
  unit_label text,
  building text,
  appliance_type text not null,
  appliance_label text not null,
  brand text,
  model text,
  estimated_age_years numeric(4, 1) not null,
  useful_life_years numeric(4, 1) not null,
  failure_risk_pct smallint not null
    check (failure_risk_pct >= 0 and failure_risk_pct <= 100),
  failure_prediction_window text not null,
  replacement_recommended boolean not null default false,
  replacement_urgency text not null default 'monitor'
    check (replacement_urgency in ('immediate', 'soon', 'plan', 'monitor')),
  estimated_replacement_cost numeric(10, 2),
  detection_source text not null default 'manual'
    check (detection_source in ('photo_ai', 'manual', 'inspection')),
  detection_confidence numeric(4, 3),
  last_detected_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.unit_assets is
  'In-unit appliances and mechanical assets with age, useful life, and AI-derived failure/replacement signals.';
comment on column public.unit_assets.detection_source is
  'How the asset record was created: photo_ai (vision model), inspection workflow, or manual entry.';
comment on column public.unit_assets.failure_prediction_window is
  'Human-readable predicted failure horizon, e.g. "3–6 months".';

create index if not exists unit_assets_landlord_id_idx
  on public.unit_assets (landlord_id);

create index if not exists unit_assets_landlord_risk_idx
  on public.unit_assets (landlord_id, failure_risk_pct desc);

alter table public.unit_assets enable row level security;

create policy unit_assets_select_authenticated
  on public.unit_assets
  for select
  to authenticated
  using (true);
