-- Allow unknown asset age and unknown failure risk (do not store 0 as “this year”).
alter table public.unit_assets
  alter column estimated_age_years drop not null;

alter table public.unit_assets
  alter column failure_risk_pct drop not null;

comment on column public.unit_assets.estimated_age_years is
  'Estimated age in years. Null when install year is unknown — never use 0 as a missing-age sentinel.';
comment on column public.unit_assets.failure_risk_pct is
  '0–100 failure likelihood when age/condition support a prediction. Null when there is not enough information.';
