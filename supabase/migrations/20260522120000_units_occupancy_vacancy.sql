-- Units inventory + occupancy history for vacancy / activation flows.

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null,
  unit_label text not null,
  building text,
  status text not null default 'inactive',
  skip_tenant_registration boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint units_status_check
    check (status in ('vacant', 'active', 'inactive'))
);

comment on table public.units is
  'Landlord-scoped unit inventory; status drives vacancy and tenant activation rules.';
comment on column public.units.skip_tenant_registration is
  'When true, unit may be active without a registered tenant (landlord opted out).';

create unique index if not exists units_landlord_label_building_unique_idx
  on public.units (
    landlord_id,
    unit_label,
    coalesce(building, '')
  );

create index if not exists units_landlord_id_idx on public.units (landlord_id);
create index if not exists units_status_idx on public.units (status);

create table if not exists public.occupancy (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null,
  unit_id uuid not null references public.units (id) on delete cascade,
  resident_id uuid not null references public.users (id) on delete restrict,
  move_in_date date not null,
  move_out_date date,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint occupancy_status_check
    check (status in ('active', 'ended'))
);

comment on table public.occupancy is
  'Tenancy periods for a unit; active rows end when a unit is marked vacant.';

create index if not exists occupancy_unit_id_idx on public.occupancy (unit_id);
create index if not exists occupancy_resident_id_idx on public.occupancy (resident_id);
create index if not exists occupancy_active_unit_idx
  on public.occupancy (unit_id)
  where status = 'active';

alter table public.units enable row level security;
alter table public.occupancy enable row level security;

create policy units_select_staff
  on public.units for select to authenticated
  using (public.is_staff_admin());

create policy units_insert_staff
  on public.units for insert to authenticated
  with check (public.is_staff_admin());

create policy units_update_staff
  on public.units for update to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create policy units_delete_staff
  on public.units for delete to authenticated
  using (public.is_staff_admin());

create policy occupancy_select_staff
  on public.occupancy for select to authenticated
  using (public.is_staff_admin());

create policy occupancy_insert_staff
  on public.occupancy for insert to authenticated
  with check (public.is_staff_admin());

create policy occupancy_update_staff
  on public.occupancy for update to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create policy occupancy_delete_staff
  on public.occupancy for delete to authenticated
  using (public.is_staff_admin());
