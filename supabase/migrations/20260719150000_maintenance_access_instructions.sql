-- Optional entry/access notes shown on the public /w/:token job page (Phase 2 / 4.2).

alter table public.maintenance_requests
  add column if not exists access_instructions text;

comment on column public.maintenance_requests.access_instructions is
  'Vendor-facing entry notes (lockbox, gate code, parking). Shown on the public work-order link.';
