-- Landlord override: activate a roster vendor for matching without verification docs.

alter table public.vendors
  add column if not exists onboarding_overridden_at timestamptz;

comment on column public.vendors.onboarding_overridden_at is
  'When set, the property team activated this vendor without completing verification documents. Ban, suspend, and pause still apply.';
