-- Optional coordinates for properties (Street View, weather, market geo).

alter table public.properties add column if not exists latitude double precision;
alter table public.properties add column if not exists longitude double precision;

comment on column public.properties.latitude is
  'Optional property latitude for maps / Street View (WGS84).';
comment on column public.properties.longitude is
  'Optional property longitude for maps / Street View (WGS84).';
