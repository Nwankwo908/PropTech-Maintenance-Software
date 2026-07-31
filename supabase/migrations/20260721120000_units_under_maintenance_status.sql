-- Persist Under maintenance as a first-class unit status (admin status chip).

alter table public.units
  drop constraint if exists units_status_check;

alter table public.units
  add constraint units_status_check
  check (status in ('vacant', 'active', 'inactive', 'under_maintenance'));

comment on column public.units.status is
  'Unit inventory status: vacant, active (occupied), inactive (pending setup), or under_maintenance.';
