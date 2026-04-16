-- Link vendors to Supabase Auth users (for vendor portal JWT auth).
-- Nullable initially; populated on first successful vendor login (matched by email), then used for all future logins.

alter table public.vendors
  add column if not exists auth_user_id uuid;

create unique index if not exists vendors_auth_user_id_uidx
  on public.vendors (auth_user_id)
  where auth_user_id is not null;

comment on column public.vendors.auth_user_id is
  'Supabase Auth user id that owns this vendor portal identity (set on first login).';

