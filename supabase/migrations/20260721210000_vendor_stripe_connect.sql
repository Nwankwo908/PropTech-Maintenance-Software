-- Stripe Express Connect for vendor payouts (onboarding + invoice Checkout destination).

alter table public.vendors
  add column if not exists stripe_connect_account_id text,
  add column if not exists stripe_connect_charges_enabled boolean not null default false,
  add column if not exists stripe_connect_payouts_enabled boolean not null default false,
  add column if not exists stripe_connect_details_submitted boolean not null default false,
  add column if not exists stripe_connect_updated_at timestamptz;

create unique index if not exists vendors_stripe_connect_account_id_uidx
  on public.vendors (stripe_connect_account_id)
  where stripe_connect_account_id is not null;

comment on column public.vendors.stripe_connect_account_id is
  'Stripe Express connected account id (acct_…).';
comment on column public.vendors.stripe_connect_charges_enabled is
  'True when the Connect account can accept charges (destination Checkout).';
comment on column public.vendors.stripe_connect_payouts_enabled is
  'True when Stripe can pay out to the vendor bank account.';
comment on column public.vendors.stripe_connect_details_submitted is
  'True when the vendor finished Stripe-hosted onboarding details.';

alter table public.vendor_verifications
  add column if not exists stripe_connect_ready boolean not null default false;

comment on column public.vendor_verifications.stripe_connect_ready is
  'Mirror of payout readiness for the verification checklist (charges_enabled).';
