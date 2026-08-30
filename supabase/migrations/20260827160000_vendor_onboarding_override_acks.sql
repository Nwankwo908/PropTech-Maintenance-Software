-- Append-only audit of landlord override-onboarding acknowledgements.

create table if not exists public.vendor_onboarding_override_acks (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  auth_user_id uuid,
  session_token text not null,
  disclaimer_version text not null,
  disclaimer_text text not null,
  acknowledged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.vendor_onboarding_override_acks is
  'Liability acknowledgement when a landlord activates a vendor without Ulo verification (Override onboarding).';

comment on column public.vendor_onboarding_override_acks.session_token is
  'Auth session access token at the moment Activate was confirmed.';

comment on column public.vendor_onboarding_override_acks.disclaimer_version is
  'Stable id of the exact disclaimer copy shown in the modal (e.g. ulo-vendor-override-ack-v1).';

comment on column public.vendor_onboarding_override_acks.disclaimer_text is
  'Exact interpolated disclaimer text shown to the landlord, including the vendor name.';

create index if not exists vendor_onboarding_override_acks_vendor_idx
  on public.vendor_onboarding_override_acks (vendor_id, acknowledged_at desc);

create index if not exists vendor_onboarding_override_acks_landlord_idx
  on public.vendor_onboarding_override_acks (landlord_id, acknowledged_at desc);

alter table public.vendor_onboarding_override_acks enable row level security;

drop policy if exists vendor_onboarding_override_acks_select_staff
  on public.vendor_onboarding_override_acks;
create policy vendor_onboarding_override_acks_select_staff
  on public.vendor_onboarding_override_acks
  for select
  to authenticated
  using (public.is_staff_admin());

drop policy if exists vendor_onboarding_override_acks_insert_staff
  on public.vendor_onboarding_override_acks;
create policy vendor_onboarding_override_acks_insert_staff
  on public.vendor_onboarding_override_acks
  for insert
  to authenticated
  with check (public.is_staff_admin());
