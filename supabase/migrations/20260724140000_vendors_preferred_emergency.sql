-- Flag roster vendors preferred for emergency dispatch (set during onboarding).

alter table public.vendors
  add column if not exists preferred_emergency boolean not null default false;

comment on column public.vendors.preferred_emergency is
  'When true, landlord marked this vendor as a preferred contact for emergency work.';

create index if not exists vendors_landlord_preferred_emergency_idx
  on public.vendors (landlord_id)
  where preferred_emergency = true;
