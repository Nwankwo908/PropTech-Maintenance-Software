-- Resident-provided visit windows from SMS intake (used when assigning / scheduling vendors).

alter table public.maintenance_requests
  add column if not exists resident_availability_text text;

comment on column public.maintenance_requests.resident_availability_text is
  'Plain-language visit windows the resident offered during intake (e.g. Sat after 3pm). Shown to vendors when assigning and asking for availability.';
