-- Isolate onboarding sessions: stamp portfolio residents + bound the activity feed.

alter table public.landlord_onboarding
  add column if not exists onboarding_session_id text,
  add column if not exists onboarding_session_started_at timestamptz;

comment on column public.landlord_onboarding.onboarding_session_id is
  'UUID for the current setup run. New Start setup mints a new id; reset clears it.';
comment on column public.landlord_onboarding.onboarding_session_started_at is
  'When the current onboarding_session_id was minted. Overview feed can bound to this.';

alter table public.users
  add column if not exists onboarding_session_id text,
  add column if not exists archived_at timestamptz;

comment on column public.users.onboarding_session_id is
  'Onboarding setup run that created/updated this resident via import or guided save.';
comment on column public.users.archived_at is
  'When set, resident is hidden from roster/feed (prior onboarding session leftover).';

create index if not exists users_landlord_onboarding_session_idx
  on public.users (landlord_id, onboarding_session_id)
  where archived_at is null;

create index if not exists users_landlord_archived_idx
  on public.users (landlord_id, archived_at)
  where archived_at is not null;
