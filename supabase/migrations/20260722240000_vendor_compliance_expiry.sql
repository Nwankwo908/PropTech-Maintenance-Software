-- COI & license expiration management:
-- 30d / 7d warnings, auto-SUSPEND on expiry, restore when renewed.
-- Account status stays verified; roster_status = suspended blocks dispatch.

alter table public.vendor_verifications
  add column if not exists license_expiration date;

alter table public.vendor_verifications
  add column if not exists compliance_expiry_notices jsonb not null default '{}'::jsonb;

comment on column public.vendor_verifications.license_expiration is
  'License expiration date from verify/scan; used for 30d/7d warnings and auto-suspend.';

comment on column public.vendor_verifications.compliance_expiry_notices is
  'Idempotency for expiry notices: { coi_30, coi_7, license_30, license_7, suspended_for }.';

alter table public.vendors
  add column if not exists roster_status_reason text;

comment on column public.vendors.roster_status_reason is
  'Why roster_status was set (e.g. coi_expired, license_expired, compliance_expired). Cleared on restore.';
