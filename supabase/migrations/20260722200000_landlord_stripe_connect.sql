-- Stripe Express Connect for landlord rent payouts (onboarding + rent Checkout destination).

alter table public.landlords
  add column if not exists stripe_connect_account_id text,
  add column if not exists stripe_connect_charges_enabled boolean not null default false,
  add column if not exists stripe_connect_payouts_enabled boolean not null default false,
  add column if not exists stripe_connect_details_submitted boolean not null default false,
  add column if not exists stripe_connect_updated_at timestamptz;

create unique index if not exists landlords_stripe_connect_account_id_uidx
  on public.landlords (stripe_connect_account_id)
  where stripe_connect_account_id is not null;

comment on column public.landlords.stripe_connect_account_id is
  'Stripe Express connected account id (acct_…) for rent payouts.';
comment on column public.landlords.stripe_connect_charges_enabled is
  'True when the Connect account can accept destination charges (rent Checkout).';
comment on column public.landlords.stripe_connect_payouts_enabled is
  'True when Stripe can pay out to the landlord bank account.';
comment on column public.landlords.stripe_connect_details_submitted is
  'True when the landlord finished Stripe-hosted onboarding details.';
