-- Enable Supabase Realtime for workflow operations dashboard.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'workflow_runs'
     )
  then
    execute 'alter publication supabase_realtime add table public.workflow_runs';
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'workflow_events'
     )
  then
    execute 'alter publication supabase_realtime add table public.workflow_events';
  end if;
end $$;
