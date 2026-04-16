-- Backfill maintenance_requests.assigned_vendor_id by matching optional denormalized
-- maintenance_requests.vendor to vendors.name (case-insensitive, trimmed).
-- Never overwrites rows that already have assigned_vendor_id.
--
-- Preview (run manually before/after if desired):
--   select id, vendor
--   from public.maintenance_requests
--   where assigned_vendor_id is null and vendor is not null and btrim(vendor) <> '';
--
--   select m.id as ticket_id, m.vendor, v.id as vendor_id, v.name
--   from public.maintenance_requests m
--   join public.vendors v
--     on lower(btrim(m.vendor)) = lower(btrim(v.name))
--   where m.assigned_vendor_id is null;

alter table public.maintenance_requests
  add column if not exists vendor text;

comment on column public.maintenance_requests.vendor is
  'Optional denormalized vendor label (legacy or admin); used to backfill assigned_vendor_id when missing.';

-- One row per normalized vendor name so ambiguous duplicate names in vendors resolve deterministically (lowest v.id).
update public.maintenance_requests m
set assigned_vendor_id = pick.id
from (
  select distinct on (lower(btrim(v.name)))
    lower(btrim(v.name)) as name_norm,
    v.id
  from public.vendors v
  order by lower(btrim(v.name)), v.id
) as pick
where m.assigned_vendor_id is null
  and m.vendor is not null
  and btrim(m.vendor) <> ''
  and lower(btrim(m.vendor)) = pick.name_norm;

-- Validation (commented — run in SQL editor):
--   select id, vendor, assigned_vendor_id
--   from public.maintenance_requests
--   where assigned_vendor_id is not null;
