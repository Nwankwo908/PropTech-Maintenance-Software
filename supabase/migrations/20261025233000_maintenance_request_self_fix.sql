-- How a no-vendor close happened, and the quick fix the resident already tried.
-- Nullable. Existing tickets are unchanged.

alter table public.maintenance_requests
  add column if not exists resolution text,
  add column if not exists self_fix_tip text,
  add column if not exists self_fix_result text;

comment on column public.maintenance_requests.resolution is
  'tenant_self_fix or landlord_self_fix when the job closed without a vendor.';
comment on column public.maintenance_requests.self_fix_tip is
  'Reviewed tip id from the self-fix library, when one was offered.';
comment on column public.maintenance_requests.self_fix_result is
  'fixed, not_fixed, or skipped.';
