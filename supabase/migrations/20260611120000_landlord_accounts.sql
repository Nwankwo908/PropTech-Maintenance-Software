-- Landlord accounts: demo vs real account separation.
--
-- 1. landlords table — one row per landlord account, with is_demo flag so demo
--    data can never be confused with production customer data.
-- 2. Three fixed accounts:
--      068daf53-07e4-4493-bd7f-6106e3c8c62f — existing default landlord (all legacy data)
--      de300000-0000-4000-8000-000000000001 — Demo Property Management (demo@ulohome.io, is_demo)
--      de300000-0000-4000-8000-000000000002 — New Landlord (newlandlord@ulohome.io, empty state)
-- 3. landlord_id columns on maintenance_requests / users / vendors so every
--    operational table is account-scoped. Existing rows backfill to the default
--    landlord; the column DEFAULT keeps current edge functions working unchanged.
-- 4. is_staff_admin() includes the demo + new-landlord login emails.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 0. derive_property_id — ensure the synthetic property id helper exists
--    (idempotent; first defined in 20260524120000_operations_intelligence_views)
-- ---------------------------------------------------------------------------

create extension if not exists "uuid-ossp" with schema extensions;

create or replace function public.derive_property_id(
  p_landlord_id uuid,
  p_building text
)
returns uuid
language sql
immutable
as $$
  select extensions.uuid_generate_v5(
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid,
    p_landlord_id::text || '/' || coalesce(nullif(trim(p_building), ''), '(default)')
  );
$$;

-- ---------------------------------------------------------------------------
-- 1. landlords table
-- ---------------------------------------------------------------------------

create table if not exists public.landlords (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.landlords is
  'Landlord accounts. is_demo marks seeded showcase accounts whose data must never mix with real customers.';
comment on column public.landlords.is_demo is
  'True for demo/showcase accounts (seeded sample data). Demo data is always scoped to a demo landlord id.';

alter table public.landlords enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'landlords'
      and policyname = 'landlords_select_staff'
  ) then
    create policy landlords_select_staff
      on public.landlords
      for select
      to authenticated
      using (public.is_staff_admin());
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Fixed accounts
-- ---------------------------------------------------------------------------

insert into public.landlords (id, name, email, is_demo)
values
  (
    '068daf53-07e4-4493-bd7f-6106e3c8c62f',
    'Ulo Operations',
    null,
    false
  ),
  (
    'de300000-0000-4000-8000-000000000001',
    'Demo Property Management',
    'demo@ulohome.io',
    true
  ),
  (
    'de300000-0000-4000-8000-000000000002',
    'New Landlord',
    'newlandlord@ulohome.io',
    false
  )
on conflict (id) do update set
  name = excluded.name,
  email = excluded.email,
  is_demo = excluded.is_demo;

-- ---------------------------------------------------------------------------
-- 3. landlord_id on operational tables that were single-tenant until now.
--    DEFAULT = legacy default landlord so existing edge-function inserts keep
--    landing in the original account without code changes.
-- ---------------------------------------------------------------------------

alter table public.maintenance_requests
  add column if not exists landlord_id uuid
    default '068daf53-07e4-4493-bd7f-6106e3c8c62f';

update public.maintenance_requests
set landlord_id = '068daf53-07e4-4493-bd7f-6106e3c8c62f'
where landlord_id is null;

create index if not exists maintenance_requests_landlord_id_idx
  on public.maintenance_requests (landlord_id);

alter table public.users
  add column if not exists landlord_id uuid
    default '068daf53-07e4-4493-bd7f-6106e3c8c62f';

update public.users
set landlord_id = '068daf53-07e4-4493-bd7f-6106e3c8c62f'
where landlord_id is null;

create index if not exists users_landlord_id_idx
  on public.users (landlord_id);

alter table public.vendors
  add column if not exists landlord_id uuid
    default '068daf53-07e4-4493-bd7f-6106e3c8c62f';

update public.vendors
set landlord_id = '068daf53-07e4-4493-bd7f-6106e3c8c62f'
where landlord_id is null;

create index if not exists vendors_landlord_id_idx
  on public.vendors (landlord_id);

-- Broadcast / notification log tables (admin Communication page).
do $$
declare
  t text;
begin
  foreach t in array array[
    'broadcast_notifications',
    'broadcast_notification_log',
    'resident_notification_log',
    'vendor_notification_log'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format(
        'alter table public.%I add column if not exists landlord_id uuid default %L',
        t,
        '068daf53-07e4-4493-bd7f-6106e3c8c62f'
      );
      execute format(
        'update public.%I set landlord_id = %L where landlord_id is null',
        t,
        '068daf53-07e4-4493-bd7f-6106e3c8c62f'
      );
      execute format(
        'create index if not exists %I on public.%I (landlord_id)',
        t || '_landlord_id_idx',
        t
      );
    end if;
  end loop;
end $$;

-- Backfill workflow_runs / workflow_events landlord scope for legacy rows.
do $$
begin
  if to_regclass('public.workflow_runs') is not null then
    update public.workflow_runs
    set landlord_id = '068daf53-07e4-4493-bd7f-6106e3c8c62f'
    where landlord_id is null;
  end if;

  if to_regclass('public.workflow_events') is not null then
    update public.workflow_events
    set landlord_id = '068daf53-07e4-4493-bd7f-6106e3c8c62f'
    where landlord_id is null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Staff admin allowlist includes the demo + empty-state accounts.
-- ---------------------------------------------------------------------------

create or replace function public.is_staff_admin()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select lower(trim(coalesce(auth.jwt() ->> 'email', ''))) ilike '%@property-admin.auth.local'
    or lower(trim(coalesce(auth.jwt() ->> 'email', ''))) in (
      'emeka@ulohome.io',
      'osi@ulohome.io',
      'demo@ulohome.io',
      'newlandlord@ulohome.io'
    );
$$;

comment on function public.is_staff_admin() is
  'True when the signed-in user is property staff (admin login domain or allowlisted landlord account emails).';
