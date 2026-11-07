-- Due Home Check photo instructions need minute cadence; keep broad ops jobs hourly.
insert into public.ulo_required_cron_jobs(jobname,edge_function,schedule,description)
values ('ulo-home-check-visits','run-home-check-visits','* * * * *','Minute sweep for agreed Home Check visit photo instructions only')
on conflict(jobname) do update set edge_function=excluded.edge_function,schedule=excluded.schedule,description=excluded.description;
do $$ begin
 if to_regclass('cron.job') is null then return;end if;
 -- Preserve intentional pauses and inactive existing schedules.
 if exists(select 1 from public.ulo_required_cron_jobs where jobname='ulo-home-check-visits' and status='live')
 and not exists(select 1 from cron.job where jobname='ulo-home-check-visits' and not active) then
  perform cron.schedule('ulo-home-check-visits','* * * * *',$job$select public.ulo_invoke_edge_function('run-home-check-visits','{}'::jsonb);$job$);
 end if;
end $$;
