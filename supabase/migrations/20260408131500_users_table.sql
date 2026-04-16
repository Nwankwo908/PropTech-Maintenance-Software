create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  resident_id text not null unique,
  full_name text not null,
  email text not null,
  phone text,
  unit text,
  building text,
  status text not null default 'active'
    constraint users_status_check check (status in ('active', 'pending', 'past_resident', 'suspended')),
  balance_due numeric not null default 0,
  issues text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

alter table public.users
  add column if not exists resident_id text,
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists unit text,
  add column if not exists building text,
  add column if not exists status text,
  add column if not exists balance_due numeric,
  add column if not exists issues text[],
  add column if not exists created_at timestamptz;

update public.users set status = coalesce(status, 'active');
update public.users set balance_due = coalesce(balance_due, 0);
update public.users set issues = coalesce(issues, '{}'::text[]);
update public.users set created_at = coalesce(created_at, now());

alter table public.users
  alter column resident_id set not null,
  alter column full_name set not null,
  alter column email set not null,
  alter column status set not null,
  alter column status set default 'active',
  alter column balance_due set not null,
  alter column balance_due set default 0,
  alter column issues set not null,
  alter column issues set default '{}'::text[],
  alter column created_at set not null,
  alter column created_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_status_check'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_status_check
      check (status in ('active', 'pending', 'past_resident', 'suspended'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_resident_id_key'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_resident_id_key unique (resident_id);
  end if;
end $$;

alter table public.users enable row level security;

drop policy if exists users_select_all on public.users;
create policy users_select_all
  on public.users
  for select
  to anon, authenticated
  using (true);

drop policy if exists users_insert_all on public.users;
create policy users_insert_all
  on public.users
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists users_update_all on public.users;
create policy users_update_all
  on public.users
  for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists users_delete_all on public.users;
create policy users_delete_all
  on public.users
  for delete
  to anon, authenticated
  using (true);
