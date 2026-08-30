-- Vendor business location for profile chips and roster forms.

alter table public.vendors
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists country text;

comment on column public.vendors.city is
  'Vendor business city shown on the profile and collected during onboarding.';
comment on column public.vendors.state is
  'Vendor business state / region shown on the profile and collected during onboarding.';
comment on column public.vendors.country is
  'Vendor business country shown on the profile and collected during onboarding.';
