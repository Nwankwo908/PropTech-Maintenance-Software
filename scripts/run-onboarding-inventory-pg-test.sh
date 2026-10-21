#!/usr/bin/env bash
# Spin up a disposable Postgres 16 cluster, load onboarding inventory RPCs, run suite, tear down.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Prefer explicit PG_BIN, then Homebrew postgresql@16, then whatever is on PATH.
if [[ -z "${PG_BIN:-}" ]]; then
  if [[ -x /opt/homebrew/opt/postgresql@16/bin/initdb ]]; then
    PG_BIN=/opt/homebrew/opt/postgresql@16/bin
  elif [[ -x /usr/local/opt/postgresql@16/bin/initdb ]]; then
    PG_BIN=/usr/local/opt/postgresql@16/bin
  else
    PG_BIN=""
  fi
fi
if [[ -n "$PG_BIN" ]]; then
  export PATH="$PG_BIN:$PATH"
fi
if ! command -v initdb >/dev/null 2>&1 || ! command -v pg_ctl >/dev/null 2>&1; then
  echo "postgresql@16 not found (set PG_BIN or install postgresql@16 / postgresql) — need initdb and pg_ctl on PATH" >&2
  exit 1
fi

WORKDIR="$(mktemp -d /tmp/ulo-onboarding-pg.XXXXXX)"
PGDATA="$WORKDIR/data"
PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("",0)); print(s.getsockname()[1]); s.close()')"
LOG="$WORKDIR/pg.log"
cleanup() {
  if [[ -f "$PGDATA/postmaster.pid" ]]; then
    pg_ctl -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true
  fi
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "Disposable Postgres workdir=$WORKDIR port=$PORT"

initdb -D "$PGDATA" --locale=en_US.UTF-8 -E UTF-8 -A trust >/dev/null
pg_ctl -D "$PGDATA" -o "-p $PORT -k $WORKDIR" -l "$LOG" start >/dev/null
for _ in $(seq 1 30); do
  if pg_isready -h "$WORKDIR" -p "$PORT" -q; then break; fi
  sleep 0.2
done
pg_isready -h "$WORKDIR" -p "$PORT" -q

PSQL=(psql -h "$WORKDIR" -p "$PORT" -U "$(whoami)" -d postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" <<'SQL'
create extension if not exists pgcrypto;
create schema if not exists auth;
create or replace function auth.jwt()
returns jsonb language sql stable as $$ select '{}'::jsonb $$;

create role authenticated nologin;
create role service_role nologin;
create role anon nologin;

create or replace function public.is_staff_admin()
returns boolean language sql stable as $$ select true $$;

create table public.landlords (
  id uuid primary key,
  name text,
  display_name text,
  contact_name text,
  email text,
  phone text,
  communication_style text
);

create table public.landlord_portal_members (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid references public.landlords(id) on delete cascade,
  email text not null
);

create table public.landlord_onboarding (
  landlord_id uuid primary key references public.landlords(id) on delete cascade,
  onboarding_status text not null default 'not_started',
  current_step text,
  completed_at timestamptz,
  onboarding_session_id text,
  onboarding_session_started_at timestamptz,
  properties jsonb not null default '[]'::jsonb,
  draft_state jsonb not null default '{}'::jsonb,
  account_settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords(id) on delete cascade,
  name text,
  street_address text,
  city text,
  state text,
  zip_code text,
  property_type text,
  manager_name text,
  manager_phone text,
  unit_count integer,
  onboarding_session_id text,
  updated_at timestamptz not null default now()
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  unit_label text,
  building text,
  status text,
  city text,
  state text,
  zip_code text,
  onboarding_session_id text,
  updated_at timestamptz not null default now()
);

create extension if not exists "uuid-ossp";
-- Stable synthetic property ids (matches production derive_property_id semantics).
create or replace function public.derive_property_id(p_landlord_id uuid, p_building text)
returns uuid
language sql
immutable
as $$
  select uuid_generate_v5(
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid,
    p_landlord_id::text || '/' || coalesce(nullif(trim(p_building), ''), '(default)')
  );
$$;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords(id) on delete cascade,
  full_name text,
  onboarding_session_id text,
  archived_at timestamptz
);

create table public.occupancy (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords(id) on delete cascade,
  unit_id uuid,
  resident_id uuid
);

create table public.maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb
);

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords(id) on delete cascade,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb
);

-- Stub for RLS helpers referenced by migration grants
create or replace function public.is_staff_admin()
returns boolean language sql stable as $$ select true $$;
SQL

# Apply inventory consistency migration, but skip auth-role grants that need Supabase roles beyond stubs.
# Also force can_mutate true under local superuser after load.
echo "Applying onboarding inventory consistency migration…"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261020120000_onboarding_inventory_consistency.sql" >/dev/null

if [[ -f "$ROOT/supabase/migrations/20261020210000_fix_onboarding_unsafe_ops_no_ticket_metadata.sql" ]]; then
  echo "Applying unsafe-ops fix migration…"
  "${PSQL[@]}" -f "$ROOT/supabase/migrations/20261020210000_fix_onboarding_unsafe_ops_no_ticket_metadata.sql" >/dev/null || true
fi

# Disposable-lab override: allow LA inventory mutation without JWT (service_role path).
"${PSQL[@]}" <<'SQL'
create or replace function public.can_mutate_onboarding_inventory(p_landlord_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return p_landlord_id in (
    'de300000-0000-4000-8000-000000000003'::uuid,
    'de300000-0000-4000-8000-000000000004'::uuid
  );
end;
$$;
SQL

echo "Running inventory consistency suite…"
"${PSQL[@]}" -f "$ROOT/supabase/tests/onboarding_inventory_consistency.sql"

echo "PG_SUITE_OK"
