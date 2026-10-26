#!/usr/bin/env bash
# Disposable PostgreSQL only. No Supabase/network/provider credentials.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}:$PATH"
TASK_DIR="$(mktemp -d /tmp/ulo-signup-pg.XXXXXX)"
cleanup() { pg_ctl -D "$TASK_DIR/data" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TASK_DIR"; }
trap cleanup EXIT
initdb -D "$TASK_DIR/data" -A trust --locale=en_US.UTF-8 >/dev/null
# Unix socket only; no TCP listener and no connection to existing databases.
pg_ctl -D "$TASK_DIR/data" -l "$TASK_DIR/log" -o "-c listen_addresses='' -k $TASK_DIR" start >/dev/null
PSQL=(psql -h "$TASK_DIR" -U "$(whoami)" -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" <<'SQL'
create role authenticated; create role anon; create role service_role;
create schema auth;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql as $$ select jsonb_build_object('role','authenticated') $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid(), auth.jwt() to authenticated;
create table landlords(id uuid primary key, name text not null, email text unique, is_demo boolean default false);
create table landlord_portal_members(landlord_id uuid references landlords, email text unique, role text);
grant select on landlord_portal_members to authenticated;
create table landlord_onboarding(landlord_id uuid primary key references landlords, onboarding_status text, current_step text);
create function is_platform_staff() returns boolean language sql as $$select false$$;
create function can_access_landlord(p uuid) returns boolean language sql security definer as $$ select exists(select 1 from landlord_portal_members where landlord_id=p and email=(select email from auth.users where id=auth.uid())) $$;
create function can_mutate_onboarding_inventory(p uuid) returns boolean language sql as $$ select p='de300000-0000-4000-8000-000000000003'::uuid $$;
SQL
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261026120000_self_service_limited_alpha.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261026121000_self_service_limited_alpha_privileges.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/self_service_limited_alpha.sql"
