create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text not null default 'email'
    constraint waitlist_signups_source_check check (source in ('email', 'google')),
  created_at timestamptz not null default now(),
  constraint waitlist_signups_email_key unique (email)
);

alter table public.waitlist_signups enable row level security;

drop policy if exists waitlist_signups_insert_public on public.waitlist_signups;
create policy waitlist_signups_insert_public
  on public.waitlist_signups
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists waitlist_signups_select_staff on public.waitlist_signups;
create policy waitlist_signups_select_staff
  on public.waitlist_signups
  for select
  to authenticated
  using (public.is_staff_admin());
