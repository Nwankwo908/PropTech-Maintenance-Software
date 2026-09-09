-- Canonical property visuals on the Home Data Graph (provider-neutral).
-- Adapters map listing photos / coordinates into these columns.

alter table public.home_data_graph
  add column if not exists latitude numeric,
  add column if not exists longitude numeric,
  add column if not exists photo_urls text[] not null default '{}'::text[];

alter table public.home_data_graph
  drop constraint if exists home_data_graph_latitude_check;
alter table public.home_data_graph
  add constraint home_data_graph_latitude_check
  check (latitude is null or (latitude >= -90 and latitude <= 90));

alter table public.home_data_graph
  drop constraint if exists home_data_graph_longitude_check;
alter table public.home_data_graph
  add constraint home_data_graph_longitude_check
  check (longitude is null or (longitude >= -180 and longitude <= 180));

comment on column public.home_data_graph.photo_urls is
  'Canonical property image URLs. Filled by the active home-data adapter; not provider-specific column names.';
comment on column public.home_data_graph.latitude is
  'Property latitude from the last home-data ingest.';
comment on column public.home_data_graph.longitude is
  'Property longitude from the last home-data ingest.';
