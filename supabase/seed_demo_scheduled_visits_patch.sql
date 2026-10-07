-- =============================================================================
-- Demo patch: Scheduled Visits KPI data (maintenance_requests.scheduled_at)
-- Safe to run without a full landlord account reseed.
-- =============================================================================

do $$
declare
  demo_landlord uuid := 'de300000-0000-4000-8000-000000000001';
  now_ts timestamptz := now();

  t02 uuid := md5('ulo-demo-ticket-02')::uuid;
  t03 uuid := md5('ulo-demo-ticket-03')::uuid;
  t04 uuid := md5('ulo-demo-ticket-04')::uuid;
  t06 uuid := md5('ulo-demo-ticket-06')::uuid;
  t07 uuid := md5('ulo-demo-ticket-07')::uuid;
  t08 uuid := md5('ulo-demo-ticket-08')::uuid;
  t10 uuid := md5('ulo-demo-ticket-10')::uuid;
  t13 uuid := md5('ulo-demo-ticket-13')::uuid;
  t14 uuid := md5('ulo-demo-ticket-14')::uuid;
  t16 uuid := md5('ulo-demo-ticket-16')::uuid;
  t17 uuid := md5('ulo-demo-ticket-17')::uuid;
  t18 uuid := md5('ulo-demo-ticket-18')::uuid;
  t19 uuid := md5('ulo-demo-ticket-19')::uuid;
  t20 uuid := md5('ulo-demo-ticket-20')::uuid;
  t21 uuid := md5('ulo-demo-ticket-21')::uuid;
  t22 uuid := md5('ulo-demo-ticket-22')::uuid;
  t23 uuid := md5('ulo-demo-ticket-23')::uuid;
  t24 uuid := md5('ulo-demo-ticket-24')::uuid;
  t29 uuid := md5('ulo-demo-ticket-29')::uuid;
  t30 uuid := md5('ulo-demo-ticket-30')::uuid;
  t31 uuid := md5('ulo-demo-ticket-31')::uuid;

  updated_count integer;
begin
  if not exists (select 1 from public.landlords where id = demo_landlord) then
    raise exception 'demo landlord missing';
  end if;

  if not exists (
    select 1 from public.maintenance_requests
    where landlord_id = demo_landlord and id = t02
  ) then
    raise exception 'demo tickets missing — run seed_demo_landlord_account.sql first';
  end if;

  update public.maintenance_requests mr
  set scheduled_at = v.scheduled_at
  from (values
    -- Upcoming (open) -----------------------------------------------------------
    (t02, date_trunc('day', now_ts) + interval '1 day 9 hours'),
    (t03, date_trunc('day', now_ts) + interval '0 days 14 hours'),
    (t04, date_trunc('day', now_ts) + interval '1 day 11 hours'),
    (t06, date_trunc('day', now_ts) + interval '2 days 10 hours'),
    (t07, date_trunc('day', now_ts) + interval '3 days 13 hours'),
    (t08, date_trunc('day', now_ts) + interval '4 days 15 hours'),
    (t10, date_trunc('day', now_ts) + interval '5 days 9 hours'),
    (t13, date_trunc('day', now_ts) + interval '2 days 16 hours'),
    (t14, date_trunc('day', now_ts) + interval '3 days 10 hours'),
    (t16, date_trunc('day', now_ts) + interval '7 days 11 hours'),
    (t30, date_trunc('day', now_ts) + interval '1 day 14 hours'),
    (t31, date_trunc('day', now_ts) + interval '2 days 9 hours'),
    -- Recent window (last 4 weeks) ----------------------------------------------
    (t17, now_ts - interval '16 days 6 hours'),
    (t18, now_ts - interval '21 days 4 hours'),
    (t20, now_ts - interval '1 day 2 hours'),
    (t24, now_ts - interval '16 days 8 hours'),
    (t29, now_ts - interval '25 days 5 hours'),
    -- Previous window (4–8 weeks ago) -------------------------------------------
    (t19, now_ts - interval '30 days 3 hours'),
    (t21, now_ts - interval '37 days 6 hours'),
    (t22, now_ts - interval '46 days 4 hours'),
    (t23, now_ts - interval '52 days 5 hours')
  ) as v(id, scheduled_at)
  where mr.id = v.id
    and mr.landlord_id = demo_landlord;

  get diagnostics updated_count = row_count;
  raise notice 'Demo Scheduled Visits patch: set scheduled_at on % tickets.', updated_count;
end $$;
