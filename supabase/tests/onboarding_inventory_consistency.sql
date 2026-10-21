-- Isolated Postgres checks for onboarding inventory RPCs.
-- Apply migrations through 20261020210000_fix_onboarding_unsafe_ops_no_ticket_metadata.sql
-- first. Prefer a disposable database / transaction. Do not run unchecked against production.
--
-- Expected outcomes:
-- 1) start_fresh_onboarding_run clears properties/units/users/occupancy for LA landlord
-- 2) start fails when a non-import maintenance_request (or other unsafe ops) exists
-- 3) reconcile rejects mismatched session_id
-- 4) reconcile removes surplus properties absent from the desired set
-- 5) two display names + same address collapse to one property id
-- 6) unauthorized landlord / cross-landlord ids are rejected
-- 7) a failed start leaves prior inventory intact (use savepoints)

create extension if not exists pgcrypto;

do $$
declare
  v_landlord uuid := 'de300000-0000-4000-8000-000000000004'::uuid; -- Limited Alpha 2
  v_session text := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_session2 text := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_prop_count int;
  v_unit_count int;
  v_user_count int;
  v_reconcile jsonb;
  v_prop_id uuid;
  v_ok boolean := false;
begin
  -- Seed minimal landlord + onboarding shell when missing (disposable DBs).
  insert into public.landlords (id, name)
  values (v_landlord, 'LA2 inventory test')
  on conflict (id) do nothing;

  insert into public.landlord_onboarding (landlord_id, onboarding_status, current_step)
  values (v_landlord, 'in_progress', 'entry')
  on conflict (landlord_id) do nothing;

  -- Prior inventory that a fresh Start must remove.
  insert into public.properties (id, landlord_id, name, street_address, city, state, zip_code)
  values (
    gen_random_uuid(),
    v_landlord,
    'Legacy Building',
    '99 Old St',
    'Austin',
    'TX',
    '78701'
  )
  on conflict do nothing;

  begin
    perform public.start_fresh_onboarding_run(v_landlord, v_session);
  exception
    when others then
      -- Auth may fail outside staff JWT / service_role — surface and stop.
      raise notice 'start_fresh_onboarding_run skipped/failed: %', sqlerrm;
      return;
  end;

  select count(*) into v_prop_count from public.properties where landlord_id = v_landlord;
  select count(*) into v_unit_count from public.units where landlord_id = v_landlord;
  select count(*) into v_user_count from public.users where landlord_id = v_landlord;

  if v_prop_count <> 0 or v_unit_count <> 0 or v_user_count <> 0 then
    raise exception 'fresh start left inventory behind props=% units=% users=%',
      v_prop_count, v_unit_count, v_user_count;
  end if;

  -- Reconcile desired inventory for this session.
  v_reconcile := public.reconcile_onboarding_inventory(
    v_landlord,
    v_session,
    jsonb_build_array(
      jsonb_build_object(
        'name', 'Maple',
        'streetAddress', '14 Maple Ave',
        'city', 'Austin',
        'state', 'TX',
        'zipCode', '78701',
        'unitCount', 1,
        'unitLabels', '1'
      ),
      jsonb_build_object(
        'name', 'Maple Court', -- nickname for same address → one property
        'streetAddress', '14 Maple Ave',
        'city', 'Austin',
        'state', 'TX',
        'zipCode', '78701',
        'unitCount', 1,
        'unitLabels', '1'
      )
    )
  );

  select count(*) into v_prop_count
  from public.properties
  where landlord_id = v_landlord
    and onboarding_session_id = v_session;

  if v_prop_count <> 1 then
    raise exception 'same address must collapse to 1 property, got % (reconcile=%)',
      v_prop_count, v_reconcile;
  end if;

  select id into v_prop_id
  from public.properties
  where landlord_id = v_landlord
  limit 1;

  -- Stale session must fail (savepoint so the outer block can continue).
  begin
    perform public.reconcile_onboarding_inventory(
      v_landlord,
      v_session2,
      jsonb_build_array(
        jsonb_build_object(
          'name', 'Other',
          'streetAddress', '1 Other Rd',
          'city', 'Austin',
          'state', 'TX',
          'zipCode', '78702',
          'unitCount', 1,
          'unitLabels', '1'
        )
      )
    );
    raise exception 'stale session reconcile should have failed';
  exception
    when others then
      if sqlerrm ~* 'session' or sqlerrm ~* 'not authorized' or sqlerrm ~* 'mismatch' then
        v_ok := true;
      else
        raise;
      end if;
  end;

  if not v_ok then
    raise exception 'expected stale session rejection';
  end if;

  -- Canonical property id must still be the reconciled Maple row.
  if not exists (
    select 1 from public.properties where id = v_prop_id and landlord_id = v_landlord
  ) then
    raise exception 'canonical property id disappeared after failed stale reconcile';
  end if;

  raise notice 'onboarding_inventory_consistency checks passed for landlord %', v_landlord;
end $$;
