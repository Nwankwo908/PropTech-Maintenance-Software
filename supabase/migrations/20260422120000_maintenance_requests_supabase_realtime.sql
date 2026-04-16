-- Expose maintenance_requests to Supabase Realtime so admin clients receive postgres_changes
-- when vendors update vendor_work_status. Apply once per database.
do $body$
begin
  alter publication supabase_realtime add table public.maintenance_requests;
exception
  when duplicate_object then
    null;
end
$body$;
