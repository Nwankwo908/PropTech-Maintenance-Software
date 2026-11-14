-- PROPOSED ONLY. Run: ULO-SEC01-STRICT-20261113-137e1cf4
-- No Auth INSERT, password changes, customer records, vendors or residents.
BEGIN;
DO $fixtures$
DECLARE affected integer;
BEGIN
  IF (SELECT count(*) FROM auth.users WHERE (id, email, created_at) IN (
    ('e6a1e733-1b83-4508-b3f0-b424f934f050', 'sec01-guard-a@ulohome.invalid', '2026-11-14 00:17:47.956034+00'),
    ('fcd840aa-e571-4f6b-aef0-4969ce8dc936', 'sec01-guard-b@ulohome.invalid', '2026-11-14 00:18:26.453022+00')
  ) AND role = 'authenticated' AND email_confirmed_at IS NOT NULL
  AND (phone IS NULL OR btrim(phone) = '')
  AND (banned_until IS NULL OR banned_until <= now())
  AND raw_app_meta_data ->> 'ulo_sec01_run' IS NULL) <> 2 THEN
    RAISE EXCEPTION 'Auth provenance/confirmation/contact/marker check failed';
  END IF;
  IF (SELECT count(*) FROM public.landlords WHERE id IN ('a13a0000-0b1b-4c29-8372-e6eac54aa21f', 'a13a0000-d425-4e27-9391-c7372a9256cf')) <> 0 THEN
    RAISE EXCEPTION 'Fixture collision in landlords';
  END IF;
  IF (SELECT count(*) FROM public.properties WHERE id IN ('4e137818-195e-473c-91c9-060d370347d0', 'b403c956-36e8-4083-bac4-4531a1870d75')) <> 0 THEN
    RAISE EXCEPTION 'Fixture collision in properties';
  END IF;
  IF (SELECT count(*) FROM public.units WHERE id IN ('1665f981-a788-4dc5-8a7c-efacd418d9c2', '9b1777e0-f877-4b1b-9e00-f6b7ecebef8c')) <> 0 THEN
    RAISE EXCEPTION 'Fixture collision in units';
  END IF;
  IF (SELECT count(*) FROM public.workflow_runs WHERE id IN ('a4f80ab2-b15c-434b-9175-93c59d81e159', '325d43f7-d8ac-409c-a640-014d8c1cf02d')) <> 0 THEN
    RAISE EXCEPTION 'Fixture collision in workflow_runs';
  END IF;
  IF (SELECT count(*) FROM public.unit_inspections WHERE id IN ('7fb2eea2-23e0-4101-98ae-149b30e162ff', '038aed9f-2987-445c-af7f-59146e994a89')) <> 0 THEN
    RAISE EXCEPTION 'Fixture collision in unit_inspections';
  END IF;
  IF (SELECT count(*) FROM public.landlord_portal_members WHERE email IN ('sec01-guard-a@ulohome.invalid', 'sec01-guard-b@ulohome.invalid')) <> 0 THEN
    RAISE EXCEPTION 'Fixture collision in landlord_portal_members';
  END IF;

  UPDATE auth.users
  SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
        || jsonb_build_object('ulo_sec01_run', 'ULO-SEC01-STRICT-20261113-137e1cf4', 'ulo_sec01_actor', CASE id WHEN 'e6a1e733-1b83-4508-b3f0-b424f934f050'::uuid THEN 'A' ELSE 'B' END),
      updated_at = now()
  WHERE (id, email, created_at) IN (
    ('e6a1e733-1b83-4508-b3f0-b424f934f050', 'sec01-guard-a@ulohome.invalid', '2026-11-14 00:17:47.956034+00'),
    ('fcd840aa-e571-4f6b-aef0-4969ce8dc936', 'sec01-guard-b@ulohome.invalid', '2026-11-14 00:18:26.453022+00')
  ) AND role = 'authenticated' AND email_confirmed_at IS NOT NULL
  AND (phone IS NULL OR btrim(phone) = '')
  AND (banned_until IS NULL OR banned_until <= now())
  AND raw_app_meta_data ->> 'ulo_sec01_run' IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN RAISE EXCEPTION 'Auth run tagging: expected 2 rows, got %', affected; END IF;

  INSERT INTO public.landlords
    (id, name, display_name, about, email, phone, is_demo, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_details_submitted)
  VALUES
    ('a13a0000-0b1b-4c29-8372-e6eac54aa21f', 'ULO-SEC01-STRICT-20261113-137e1cf4 A', 'QA A', 'ULO-SEC01-STRICT-20261113-137e1cf4', NULL, NULL, false, NULL, false, false, false),
    ('a13a0000-d425-4e27-9391-c7372a9256cf', 'ULO-SEC01-STRICT-20261113-137e1cf4 B', 'QA B', 'ULO-SEC01-STRICT-20261113-137e1cf4', NULL, NULL, false, NULL, false, false, false);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN RAISE EXCEPTION 'landlords: expected 2 rows, got %', affected; END IF;

  INSERT INTO public.properties
    (id, landlord_id, name, manager_name, manager_phone, street_address, city, state, zip_code, latitude, longitude, unit_count, onboarding_session_id)
  VALUES
    ('4e137818-195e-473c-91c9-060d370347d0', 'a13a0000-0b1b-4c29-8372-e6eac54aa21f', 'ULO-SEC01-STRICT-20261113-137e1cf4 property A', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 'ULO-SEC01-STRICT-20261113-137e1cf4'),
    ('b403c956-36e8-4083-bac4-4531a1870d75', 'a13a0000-d425-4e27-9391-c7372a9256cf', 'ULO-SEC01-STRICT-20261113-137e1cf4 property B', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 'ULO-SEC01-STRICT-20261113-137e1cf4');
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN RAISE EXCEPTION 'properties: expected 2 rows, got %', affected; END IF;

  INSERT INTO public.units
    (id, landlord_id, property_id, unit_label, building, status, skip_tenant_registration, onboarding_session_id)
  VALUES
    ('1665f981-a788-4dc5-8a7c-efacd418d9c2', 'a13a0000-0b1b-4c29-8372-e6eac54aa21f', '4e137818-195e-473c-91c9-060d370347d0', 'QA-A', 'ULO-SEC01-STRICT-20261113-137e1cf4', 'inactive', true, 'ULO-SEC01-STRICT-20261113-137e1cf4'),
    ('9b1777e0-f877-4b1b-9e00-f6b7ecebef8c', 'a13a0000-d425-4e27-9391-c7372a9256cf', 'b403c956-36e8-4083-bac4-4531a1870d75', 'QA-B', 'ULO-SEC01-STRICT-20261113-137e1cf4', 'inactive', true, 'ULO-SEC01-STRICT-20261113-137e1cf4');
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN RAISE EXCEPTION 'units: expected 2 rows, got %', affected; END IF;

  INSERT INTO public.workflow_runs
    (id, landlord_id, template_id, trigger_type, status, current_step, current_stage, state, property_id, unit_id, resident_id, vendor_id, conversation_id, maintenance_request_id, entity_type, entity_id, due_at, metadata)
  VALUES
    ('a4f80ab2-b15c-434b-9175-93c59d81e159', 'a13a0000-0b1b-4c29-8372-e6eac54aa21f', 'inspection', 'dashboard', 'cancelled', 'cancelled', 'cancelled', '{"step": "cancelled", "qa_run": "ULO-SEC01-STRICT-20261113-137e1cf4"}'::jsonb, '4e137818-195e-473c-91c9-060d370347d0', '1665f981-a788-4dc5-8a7c-efacd418d9c2', NULL, NULL, NULL, NULL, 'inspection', '7fb2eea2-23e0-4101-98ae-149b30e162ff', NULL, '{"qa_run": "ULO-SEC01-STRICT-20261113-137e1cf4", "qa_actor": "A", "inspection_type": "periodic", "inspection_id": "7fb2eea2-23e0-4101-98ae-149b30e162ff", "step_state": {"step": "cancelled", "inspection_id": "7fb2eea2-23e0-4101-98ae-149b30e162ff", "inspection_type": "periodic"}}'::jsonb),
    ('325d43f7-d8ac-409c-a640-014d8c1cf02d', 'a13a0000-d425-4e27-9391-c7372a9256cf', 'inspection', 'dashboard', 'cancelled', 'cancelled', 'cancelled', '{"step": "cancelled", "qa_run": "ULO-SEC01-STRICT-20261113-137e1cf4"}'::jsonb, 'b403c956-36e8-4083-bac4-4531a1870d75', '9b1777e0-f877-4b1b-9e00-f6b7ecebef8c', NULL, NULL, NULL, NULL, 'inspection', '038aed9f-2987-445c-af7f-59146e994a89', NULL, '{"qa_run": "ULO-SEC01-STRICT-20261113-137e1cf4", "qa_actor": "B", "inspection_type": "periodic", "inspection_id": "038aed9f-2987-445c-af7f-59146e994a89", "step_state": {"step": "cancelled", "inspection_id": "038aed9f-2987-445c-af7f-59146e994a89", "inspection_type": "periodic"}}'::jsonb);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN RAISE EXCEPTION 'workflow_runs: expected 2 rows, got %', affected; END IF;

  INSERT INTO public.unit_inspections
    (id, landlord_id, workflow_run_id, inspection_type, status, property_id, unit_id, resident_id, occupancy_id, scheduled_at, metadata)
  VALUES
    ('7fb2eea2-23e0-4101-98ae-149b30e162ff', 'a13a0000-0b1b-4c29-8372-e6eac54aa21f', 'a4f80ab2-b15c-434b-9175-93c59d81e159', 'periodic', 'cancelled', '4e137818-195e-473c-91c9-060d370347d0', '1665f981-a788-4dc5-8a7c-efacd418d9c2', NULL, NULL, NULL, '{"qa_run": "ULO-SEC01-STRICT-20261113-137e1cf4", "qa_actor": "A"}'::jsonb),
    ('038aed9f-2987-445c-af7f-59146e994a89', 'a13a0000-d425-4e27-9391-c7372a9256cf', '325d43f7-d8ac-409c-a640-014d8c1cf02d', 'periodic', 'cancelled', 'b403c956-36e8-4083-bac4-4531a1870d75', '9b1777e0-f877-4b1b-9e00-f6b7ecebef8c', NULL, NULL, NULL, '{"qa_run": "ULO-SEC01-STRICT-20261113-137e1cf4", "qa_actor": "B"}'::jsonb);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN RAISE EXCEPTION 'unit_inspections: expected 2 rows, got %', affected; END IF;

  INSERT INTO public.landlord_portal_members
    (landlord_id, email, full_name, phone, role)
  VALUES
    ('a13a0000-0b1b-4c29-8372-e6eac54aa21f', 'sec01-guard-a@ulohome.invalid', 'ULO-SEC01-STRICT-20261113-137e1cf4 A', NULL, 'team_member'),
    ('a13a0000-d425-4e27-9391-c7372a9256cf', 'sec01-guard-b@ulohome.invalid', 'ULO-SEC01-STRICT-20261113-137e1cf4 B', NULL, 'team_member');
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN RAISE EXCEPTION 'landlord_portal_members: expected 2 rows, got %', affected; END IF;

  IF (SELECT count(*) FROM public.landlords WHERE id IN ('a13a0000-0b1b-4c29-8372-e6eac54aa21f', 'a13a0000-d425-4e27-9391-c7372a9256cf')) <> 2 THEN
    RAISE EXCEPTION 'Post-insert count mismatch in landlords';
  END IF;
  IF (SELECT count(*) FROM public.properties WHERE (id, landlord_id) IN (
    ('4e137818-195e-473c-91c9-060d370347d0', 'a13a0000-0b1b-4c29-8372-e6eac54aa21f'),
    ('b403c956-36e8-4083-bac4-4531a1870d75', 'a13a0000-d425-4e27-9391-c7372a9256cf')
  )) <> 2 THEN
    RAISE EXCEPTION 'Post-insert count mismatch in properties';
  END IF;
  IF (SELECT count(*) FROM public.units WHERE (id, landlord_id) IN (
    ('1665f981-a788-4dc5-8a7c-efacd418d9c2', 'a13a0000-0b1b-4c29-8372-e6eac54aa21f'),
    ('9b1777e0-f877-4b1b-9e00-f6b7ecebef8c', 'a13a0000-d425-4e27-9391-c7372a9256cf')
  )) <> 2 THEN
    RAISE EXCEPTION 'Post-insert count mismatch in units';
  END IF;
  IF (SELECT count(*) FROM public.workflow_runs WHERE (id, landlord_id) IN (
    ('a4f80ab2-b15c-434b-9175-93c59d81e159', 'a13a0000-0b1b-4c29-8372-e6eac54aa21f'),
    ('325d43f7-d8ac-409c-a640-014d8c1cf02d', 'a13a0000-d425-4e27-9391-c7372a9256cf')
  )) <> 2 THEN
    RAISE EXCEPTION 'Post-insert count mismatch in workflow_runs';
  END IF;
  IF (SELECT count(*) FROM public.unit_inspections WHERE (id, landlord_id) IN (
    ('7fb2eea2-23e0-4101-98ae-149b30e162ff', 'a13a0000-0b1b-4c29-8372-e6eac54aa21f'),
    ('038aed9f-2987-445c-af7f-59146e994a89', 'a13a0000-d425-4e27-9391-c7372a9256cf')
  )) <> 2 THEN
    RAISE EXCEPTION 'Post-insert count mismatch in unit_inspections';
  END IF;
  IF (SELECT count(*) FROM public.landlord_portal_members WHERE (landlord_id, email) IN (
    ('a13a0000-0b1b-4c29-8372-e6eac54aa21f', 'sec01-guard-a@ulohome.invalid'),
    ('a13a0000-d425-4e27-9391-c7372a9256cf', 'sec01-guard-b@ulohome.invalid')
  )) <> 2 THEN
    RAISE EXCEPTION 'Post-insert count mismatch in landlord_portal_members';
  END IF;
END;
$fixtures$;
COMMIT;
