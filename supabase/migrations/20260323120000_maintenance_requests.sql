-- Tickets created by the submit-maintenance-request Edge Function (service role).
create table if not exists public.maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  priority text not null,
  resident_name text not null,
  email text not null,
  unit text not null,
  description text not null,
  resident_user_id uuid references auth.users (id) on delete set null,
  photo_paths text[] not null default '{}'
);

comment on table public.maintenance_requests is 'Resident maintenance submissions from the web app.';

alter table public.maintenance_requests enable row level security;

-- No public policies: inserts go through Edge Function with service role only.

insert into storage.buckets (id, name, public)
values ('maintenance-uploads', 'maintenance-uploads', false)
on conflict (id) do nothing;
