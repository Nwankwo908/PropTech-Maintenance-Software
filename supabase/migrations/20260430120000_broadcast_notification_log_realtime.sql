-- Include broadcast_notification_log in Realtime so admin dashboard stat/history queries refresh on inserts.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'broadcast_notification_log'
     ) then
    execute 'alter publication supabase_realtime add table public.broadcast_notification_log';
  end if;
end $$;
