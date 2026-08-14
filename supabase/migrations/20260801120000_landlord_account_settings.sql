-- Persisted landlord account settings (Organization + Notifications) and profile extensions.

alter table public.landlords
  add column if not exists display_name text,
  add column if not exists about text,
  add column if not exists registered_address jsonb not null default '{}'::jsonb,
  add column if not exists time_zone text not null default 'America/Los_Angeles',
  add column if not exists logo_url text,
  add column if not exists plan_tier text not null default 'alpha';

comment on column public.landlords.display_name is
  'Public-facing company name shown in resident/vendor communications.';
comment on column public.landlords.about is
  'Optional company description from Organization settings.';
comment on column public.landlords.registered_address is
  'Company registered / billing address — not a property address.';
comment on column public.landlords.time_zone is
  'Landlord workspace IANA timezone for scheduling and quiet hours.';
comment on column public.landlords.logo_url is
  'Public URL for organization logo in branded surfaces.';
comment on column public.landlords.plan_tier is
  'Account plan label (alpha, demo, etc.).';

alter table public.landlord_onboarding
  add column if not exists account_settings jsonb not null default '{}'::jsonb;

comment on column public.landlord_onboarding.account_settings is
  'Persisted admin Settings: notification matrix, operational prefs, quiet hours.';
