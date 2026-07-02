-- Track vendors onboarded from external discovery (Google / Yelp / mock provider).

alter table public.vendors
  add column if not exists onboarded_from_external boolean not null default false;

alter table public.vendors
  add column if not exists external_discovery jsonb;

comment on column public.vendors.onboarded_from_external is
  'True when this roster row was created from an external vendor suggestion.';

comment on column public.vendors.external_discovery is
  'External discovery snapshot at onboard time: sources, rating, review_count, price_label, rank_score.';

create index if not exists vendors_landlord_name_active_idx
  on public.vendors (landlord_id, lower(name))
  where active = true;
