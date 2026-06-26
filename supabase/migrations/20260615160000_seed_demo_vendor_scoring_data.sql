-- Backfill demo vendor scores for Demo Property Management (idempotent).
-- Safe to re-run: skips existing status events and feedback rows.

do $$
declare
  demo_landlord uuid := 'de300000-0000-4000-8000-000000000001';
  v_apex uuid := md5('ulo-demo-vendor-apex-plumbing')::uuid;
  v_rooter uuid := md5('ulo-demo-vendor-rapid-rooter')::uuid;
  v_metro uuid := md5('ulo-demo-vendor-metro-plumbing')::uuid;
  v_summit uuid := md5('ulo-demo-vendor-summit-hvac')::uuid;
  v_bright uuid := md5('ulo-demo-vendor-brightline-electrical')::uuid;
  v_allied uuid := md5('ulo-demo-vendor-allied-general')::uuid;
  v_fresh uuid := md5('ulo-demo-vendor-freshnest-cleaning')::uuid;
  t17 uuid := md5('ulo-demo-ticket-17')::uuid;
  t18 uuid := md5('ulo-demo-ticket-18')::uuid;
  t19 uuid := md5('ulo-demo-ticket-19')::uuid;
  t20 uuid := md5('ulo-demo-ticket-20')::uuid;
  t21 uuid := md5('ulo-demo-ticket-21')::uuid;
  t22 uuid := md5('ulo-demo-ticket-22')::uuid;
  t23 uuid := md5('ulo-demo-ticket-23')::uuid;
  t24 uuid := md5('ulo-demo-ticket-24')::uuid;
  t25 uuid := md5('ulo-demo-ticket-25')::uuid;
  t26 uuid := md5('ulo-demo-ticket-26')::uuid;
  r_walker uuid := md5('ulo-demo-res-jordan-walker')::uuid;
  r_patel uuid := md5('ulo-demo-res-anita-patel')::uuid;
  r_ito uuid := md5('ulo-demo-res-haruto-ito')::uuid;
  r_silva uuid := md5('ulo-demo-res-bianca-silva')::uuid;
  r_nguyen uuid := md5('ulo-demo-res-kim-nguyen')::uuid;
  r_okafor uuid := md5('ulo-demo-res-david-okafor')::uuid;
begin
  if not exists (select 1 from public.landlords where id = demo_landlord) then
    raise notice 'Demo landlord missing — skip vendor scoring backfill';
    return;
  end if;

  insert into public.vendor_scoring_settings (landlord_id, rework_window_days)
  values (demo_landlord, 30)
  on conflict (landlord_id) do update
    set rework_window_days = excluded.rework_window_days,
        updated_at = now();

  insert into public.vendor_status_events (ticket_id, created_at, from_status, to_status, source, vendor_id)
  select v.ticket_id, v.at_ts, v.from_status, v.to_status, 'portal', v.vendor_id
  from (
    values
      (t17, v_apex, now() - interval '17 days 20 hours', 'pending_accept', 'accepted'),
      (t17, v_apex, now() - interval '17 days 18 hours', 'accepted', 'in_progress'),
      (t17, v_apex, now() - interval '16 days 6 hours', 'in_progress', 'completed'),
      (t18, v_rooter, now() - interval '23 days 4 hours', 'pending_accept', 'accepted'),
      (t18, v_rooter, now() - interval '22 days', 'accepted', 'completed'),
      (t19, v_bright, now() - interval '30 days 2 hours', 'pending_accept', 'accepted'),
      (t19, v_bright, now() - interval '28 days', 'accepted', 'completed'),
      (t20, v_summit, now() - interval '11 days 22 hours', 'pending_accept', 'accepted'),
      (t20, v_summit, now() - interval '11 days', 'accepted', 'completed'),
      (t21, v_allied, now() - interval '39 days 3 hours', 'pending_accept', 'accepted'),
      (t21, v_allied, now() - interval '36 days', 'accepted', 'completed'),
      (t22, v_summit, now() - interval '48 days 5 hours', 'pending_accept', 'accepted'),
      (t22, v_summit, now() - interval '45 days', 'accepted', 'completed'),
      (t23, v_metro, now() - interval '54 days 1 hour', 'pending_accept', 'accepted'),
      (t23, v_metro, now() - interval '51 days', 'accepted', 'completed'),
      (t24, v_fresh, now() - interval '19 days 8 hours', 'pending_accept', 'accepted'),
      (t24, v_fresh, now() - interval '16 days', 'accepted', 'completed'),
      (t25, v_allied, now() - interval '63 days 6 hours', 'pending_accept', 'accepted'),
      (t25, v_allied, now() - interval '60 days', 'accepted', 'completed'),
      (t26, v_apex, now() - interval '69 days 14 hours', 'pending_accept', 'accepted'),
      (t26, v_apex, now() - interval '68 days', 'accepted', 'completed')
  ) as v(ticket_id, vendor_id, at_ts, from_status, to_status)
  where not exists (
    select 1
    from public.vendor_status_events e
    where e.ticket_id = v.ticket_id
      and e.to_status = v.to_status
  );

  insert into public.vendor_feedback (
    landlord_id, vendor_id, maintenance_request_id, resident_id, rating, comment, submitted_at
  )
  values
    (demo_landlord, v_apex, t17, r_walker, 5, null, now() - interval '16 days'),
    (demo_landlord, v_apex, t26, null, 4, null, now() - interval '67 days'),
    (demo_landlord, v_rooter, t18, null, 5, null, now() - interval '21 days'),
    (demo_landlord, v_bright, t19, r_patel, 4, null, now() - interval '27 days'),
    (demo_landlord, v_summit, t20, null, 5, null, now() - interval '10 days'),
    (demo_landlord, v_summit, t22, r_silva, 3, 'Took two visits to fully fix the thermostat.', now() - interval '44 days'),
    (demo_landlord, v_allied, t21, r_ito, 4, null, now() - interval '35 days'),
    (demo_landlord, v_allied, t25, r_nguyen, 5, null, now() - interval '59 days'),
    (demo_landlord, v_metro, t23, null, 2, 'Leak returned after one week.', now() - interval '50 days'),
    (demo_landlord, v_fresh, t24, r_okafor, 5, null, now() - interval '15 days')
  on conflict (maintenance_request_id) do nothing;
end $$;
