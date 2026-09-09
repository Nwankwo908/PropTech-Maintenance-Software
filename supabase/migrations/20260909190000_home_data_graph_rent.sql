-- Canonical rent estimate on the Home Data Graph (provider-neutral).
-- Adapters map AVM rent into these columns; do not store vendor field names.

alter table public.home_data_graph
  add column if not exists estimated_rent numeric,
  add column if not exists estimated_rent_low numeric,
  add column if not exists estimated_rent_high numeric,
  add column if not exists rent_lookup_complete boolean not null default false;

comment on column public.home_data_graph.estimated_rent is
  'Estimated monthly rent from the last home-data ingest.';
comment on column public.home_data_graph.estimated_rent_low is
  'Lower bound of the estimated monthly rent range.';
comment on column public.home_data_graph.estimated_rent_high is
  'Upper bound of the estimated monthly rent range.';
comment on column public.home_data_graph.rent_lookup_complete is
  'True after an ingest that requested a rent estimate, even when no estimate was returned.';
