-- Thumbtack authorization_code tokens (requests + messaging). Service role only.
create table if not exists public.landlord_thumbtack_oauth (
  landlord_id uuid primary key references public.landlords (id) on delete cascade,
  refresh_token text not null,
  scope text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.thumbtack_oauth_states (
  state text primary key,
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  return_path text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists thumbtack_oauth_states_expires_idx
  on public.thumbtack_oauth_states (expires_at);

alter table public.landlord_thumbtack_oauth enable row level security;
alter table public.thumbtack_oauth_states enable row level security;

comment on table public.landlord_thumbtack_oauth is
  'Thumbtack authorization_code refresh tokens for in-app request create and messaging.';
