-- Vendor verification onboarding: landlord "Invite Vendor" -> tokenized /v/:token portal.
-- All writes go through the send-vendor-invite / vendor-verification Edge Functions (service role).
-- Staff dashboards read via is_staff_admin(); simulated-but-swappable verification adapters run server-side.

-- ---------------------------------------------------------------------------
-- vendor_verifications
-- ---------------------------------------------------------------------------

create table if not exists public.vendor_verifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  landlord_id uuid not null,
  vendor_id uuid references public.vendors (id) on delete set null,
  token text not null unique,
  status text not null default 'invited'
    constraint vendor_verifications_status_check
      check (status in ('invited', 'in_progress', 'submitted', 'verified', 'needs_review')),

  -- Identity
  business_name text,
  contact_name text,
  email text,
  phone text,
  vendor_first_name text,
  property_name text,

  -- License
  license_state text,
  license_number text,
  license_type text,
  license_status text,

  -- Insurance (COI)
  coi_general_liability numeric,
  coi_expiration date,
  coi_additional_insured boolean not null default false,
  coi_status text,

  -- Background check (simulated Checkr)
  background_check_status text,
  background_check_ref text,

  -- Tax
  w9_received boolean not null default false,

  -- Trade + coverage
  trade_categories text[] not null default '{}',
  service_area jsonb not null default '{}'::jsonb,
  availability text not null default 'active'
    constraint vendor_verifications_availability_check
      check (availability in ('active', 'paused')),

  -- Autosave progress { currentStep, stepStatus, ... }
  progress jsonb not null default '{}'::jsonb,

  invited_channel text,
  submitted_at timestamptz,
  verified_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days')
);

comment on table public.vendor_verifications is
  'Vendor onboarding sessions from the tokenized /v/:token portal; managed via Edge Functions (service role).';

create index if not exists vendor_verifications_landlord_id_idx
  on public.vendor_verifications (landlord_id);
create index if not exists vendor_verifications_vendor_id_idx
  on public.vendor_verifications (vendor_id);

alter table public.vendor_verifications enable row level security;

drop policy if exists vendor_verifications_select_staff on public.vendor_verifications;

create policy vendor_verifications_select_staff
  on public.vendor_verifications
  for select
  to authenticated
  using (public.is_staff_admin());

-- Inserts/updates remain service-role / Edge Function only (no client write policy).

-- ---------------------------------------------------------------------------
-- vendor_documents
-- ---------------------------------------------------------------------------

create table if not exists public.vendor_documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  verification_id uuid not null references public.vendor_verifications (id) on delete cascade,
  vendor_id uuid references public.vendors (id) on delete set null,
  landlord_id uuid not null,
  kind text not null
    constraint vendor_documents_kind_check
      check (kind in ('license', 'coi', 'w9')),
  storage_path text not null,
  file_name text,
  content_type text,
  parsed jsonb not null default '{}'::jsonb,
  uploaded_at timestamptz not null default now()
);

comment on table public.vendor_documents is
  'Vendor-uploaded onboarding documents (license/COI/W-9) stored in the vendor-documents bucket.';

create index if not exists vendor_documents_verification_id_idx
  on public.vendor_documents (verification_id);
create index if not exists vendor_documents_vendor_id_idx
  on public.vendor_documents (vendor_id);
create index if not exists vendor_documents_landlord_id_idx
  on public.vendor_documents (landlord_id);

alter table public.vendor_documents enable row level security;

drop policy if exists vendor_documents_select_staff on public.vendor_documents;

create policy vendor_documents_select_staff
  on public.vendor_documents
  for select
  to authenticated
  using (public.is_staff_admin());

-- ---------------------------------------------------------------------------
-- updated_at trigger for vendor_verifications
-- ---------------------------------------------------------------------------

create or replace function public.set_vendor_verifications_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_vendor_verifications_updated_at on public.vendor_verifications;
create trigger trg_vendor_verifications_updated_at
  before update on public.vendor_verifications
  for each row
  execute function public.set_vendor_verifications_updated_at();

-- ---------------------------------------------------------------------------
-- Private storage bucket for vendor documents
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('vendor-documents', 'vendor-documents', false)
on conflict (id) do nothing;
