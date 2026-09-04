-- Temporary phone-to-desktop inspection photo capture sessions.
-- Mobile clients never read these tables directly; token access is Edge-only.

create table if not exists public.inspection_capture_sessions (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  assessment_id uuid references public.property_inspection_assessments (id) on delete cascade,
  token_hash text not null,
  status text not null default 'waiting'
    check (status in ('waiting', 'connected', 'active', 'completed', 'expired', 'revoked')),
  expires_at timestamptz not null,
  connected_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint inspection_capture_sessions_token_hash_unique unique (token_hash)
);

comment on table public.inspection_capture_sessions is
  'Short-lived QR/phone capture sessions for AI Equipment Scan. Store token_hash only.';

create index if not exists inspection_capture_sessions_landlord_idx
  on public.inspection_capture_sessions (landlord_id, created_at desc);

create index if not exists inspection_capture_sessions_assessment_idx
  on public.inspection_capture_sessions (assessment_id)
  where assessment_id is not null;

create index if not exists inspection_capture_sessions_expires_idx
  on public.inspection_capture_sessions (expires_at);

create table if not exists public.inspection_capture_photos (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.inspection_capture_sessions (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  inspection_photo_id uuid references public.property_inspection_photos (id) on delete set null,
  storage_path text not null,
  mime_type text,
  file_size bigint,
  source text not null default 'mobile_capture',
  processing_status text not null default 'uploaded'
    check (processing_status in ('queued', 'uploaded', 'analyzing', 'ready', 'error')),
  created_at timestamptz not null default now()
);

comment on table public.inspection_capture_photos is
  'Photos uploaded from a phone capture session. AI review still uses property_inspection_photos.';

create index if not exists inspection_capture_photos_session_idx
  on public.inspection_capture_photos (session_id, created_at);

create index if not exists inspection_capture_photos_inspection_photo_idx
  on public.inspection_capture_photos (inspection_photo_id)
  where inspection_photo_id is not null;

alter table public.inspection_capture_sessions enable row level security;
alter table public.inspection_capture_photos enable row level security;

create policy inspection_capture_sessions_select_authenticated
  on public.inspection_capture_sessions
  for select
  to authenticated
  using (true);

create policy inspection_capture_photos_select_authenticated
  on public.inspection_capture_photos
  for select
  to authenticated
  using (true);

do $body$
begin
  alter publication supabase_realtime add table public.inspection_capture_sessions;
exception
  when duplicate_object then
    null;
end
$body$;

do $body$
begin
  alter publication supabase_realtime add table public.inspection_capture_photos;
exception
  when duplicate_object then
    null;
end
$body$;

do $body$
begin
  alter publication supabase_realtime add table public.property_inspection_photos;
exception
  when duplicate_object then
    null;
end
$body$;
