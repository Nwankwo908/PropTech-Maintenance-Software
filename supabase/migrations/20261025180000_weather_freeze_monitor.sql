-- Freeze monitoring: saved geocode status, shared forecast snapshots, cold-spell
-- events, frost dates, and landlord weather text settings.
-- Limited Alpha 1 is excluded in the monitor, not by deleting rows.

alter table public.properties
  add column if not exists geocoded_at timestamptz;

alter table public.properties
  add column if not exists geocode_status text;

alter table public.properties
  drop constraint if exists properties_geocode_status_check;

alter table public.properties
  add constraint properties_geocode_status_check
  check (geocode_status is null or geocode_status in ('ok', 'not_found', 'non_us'));

comment on column public.properties.geocode_status is
  'Census geocode result: ok, not_found, or non_us.';

create table if not exists public.weather_snapshots (
  id uuid primary key default gen_random_uuid(),
  cell_key text not null,
  lat double precision not null,
  lon double precision not null,
  fetched_at timestamptz not null default now(),
  forecast_hourly jsonb not null default '[]'::jsonb,
  active_alerts jsonb not null default '[]'::jsonb,
  source_ok boolean not null default false
);

create index if not exists weather_snapshots_cell_fetched_idx
  on public.weather_snapshots (cell_key, fetched_at desc);

comment on table public.weather_snapshots is
  'Shared NWS forecast for a 0.1 degree cell. Properties in the same cell share one fetch.';

create table if not exists public.weather_events (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  level text not null check (level in ('freeze_watch', 'hard_freeze', 'extreme_cold')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  low_temp_f numeric,
  nws_event text,
  status text not null default 'active' check (status in ('active', 'resolved')),
  notified_level text check (
    notified_level is null or notified_level in ('freeze_watch', 'hard_freeze', 'extreme_cold')
  ),
  created_at timestamptz not null default now()
);

create unique index if not exists weather_events_one_active_property_idx
  on public.weather_events (property_id)
  where status = 'active';

create index if not exists weather_events_landlord_status_idx
  on public.weather_events (landlord_id, status);

create table if not exists public.frost_dates (
  cell_key text primary key,
  first_frost_date text not null,
  source text not null check (source in ('open-meteo', 'state_average')),
  computed_at timestamptz not null default now()
);

create table if not exists public.landlord_weather_settings (
  landlord_id uuid primary key references public.landlords (id) on delete cascade,
  text_enabled boolean not null default true,
  threshold_adjust_f integer not null default 0 check (threshold_adjust_f between -4 and 4),
  watch_text_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table public.landlord_weather_settings is
  'Freeze texts on, no threshold adjustment, and freeze watches stay in the app unless included.';

alter table public.weather_snapshots enable row level security;
alter table public.weather_events enable row level security;
alter table public.frost_dates enable row level security;
alter table public.landlord_weather_settings enable row level security;

drop policy if exists weather_snapshots_select_authenticated on public.weather_snapshots;
create policy weather_snapshots_select_authenticated
  on public.weather_snapshots for select to authenticated using (true);

drop policy if exists weather_events_select_authenticated on public.weather_events;
create policy weather_events_select_authenticated
  on public.weather_events for select to authenticated using (true);

drop policy if exists frost_dates_select_authenticated on public.frost_dates;
create policy frost_dates_select_authenticated
  on public.frost_dates for select to authenticated using (true);

drop policy if exists landlord_weather_settings_select_authenticated on public.landlord_weather_settings;
create policy landlord_weather_settings_select_authenticated
  on public.landlord_weather_settings for select to authenticated using (true);

drop policy if exists landlord_weather_settings_write_authenticated on public.landlord_weather_settings;
create policy landlord_weather_settings_write_authenticated
  on public.landlord_weather_settings for all to authenticated
  using (true) with check (true);

drop policy if exists preventive_maintenance_tasks_update_authenticated on public.preventive_maintenance_tasks;
create policy preventive_maintenance_tasks_update_authenticated
  on public.preventive_maintenance_tasks for update to authenticated
  using (true) with check (true);

insert into public.ulo_required_cron_jobs (jobname, edge_function, schedule, description)
values (
  'ulo-weather-monitor',
  'run-weather-monitor',
  '20 * * * *',
  'Hourly freeze monitor. Cells refresh every 3 hours, and hourly while a cold event is active.'
)
on conflict (jobname) do update
set edge_function = excluded.edge_function,
    schedule = excluded.schedule,
    description = excluded.description;

select public.ulo_ensure_required_cron_jobs();
