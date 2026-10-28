-- A resident can report a repair fixed when no vendor is assigned.
-- Active vendor work (pending, accepted, in progress) still requires a vendor.
-- The previous check also forbade completed without a vendor and was NOT VALID.

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.maintenance_requests'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%assigned_vendor_id is not null%'
      and pg_get_constraintdef(con.oid) ilike '%completed%'
  loop
    execute format(
      'alter table public.maintenance_requests drop constraint %I',
      constraint_name
    );
  end loop;
end $$;

alter table public.maintenance_requests
  drop constraint if exists maintenance_requests_vendor_required_for_active_work;

alter table public.maintenance_requests
  add constraint maintenance_requests_vendor_required_for_active_work
  check (
    assigned_vendor_id is not null
    or vendor_work_status not in ('pending_accept', 'accepted', 'in_progress')
  )
  not valid;
