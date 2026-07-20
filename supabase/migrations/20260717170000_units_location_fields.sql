-- Persist property location on units so vendor proximity can use city / state / ZIP.

alter table public.units
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists zip_code text;

comment on column public.units.city is
  'City for the unit/building — used for vendor service-area matching.';
comment on column public.units.state is
  'State / region code (e.g. NJ) for vendor service-area matching.';
comment on column public.units.zip_code is
  'Postal ZIP code for vendor service-area matching.';

create index if not exists units_landlord_zip_code_idx
  on public.units (landlord_id, zip_code)
  where zip_code is not null;
