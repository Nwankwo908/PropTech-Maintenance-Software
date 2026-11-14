-- PROPOSED ONLY. Run: ULO-SEC01-STRICT-20261113-137e1cf4
-- After tests: sign out only these QA users globally via their own Auth sessions.
-- Retain Auth users, landlords, properties, units, inspections and all audit evidence.
BEGIN;
DO $cleanup$
DECLARE affected integer;
BEGIN
  IF (SELECT count(*) FROM public.landlord_portal_members WHERE (landlord_id, email) IN (
    ('a13a0000-0b1b-4c29-8372-e6eac54aa21f', 'sec01-guard-a@ulohome.invalid'),
    ('a13a0000-d425-4e27-9391-c7372a9256cf', 'sec01-guard-b@ulohome.invalid')
  ) AND full_name IN ('ULO-SEC01-STRICT-20261113-137e1cf4 A', 'ULO-SEC01-STRICT-20261113-137e1cf4 B')) <> 2 THEN
    RAISE EXCEPTION 'Cleanup scope/count mismatch in landlord_portal_members';
  END IF;
  IF (SELECT count(*) FROM public.workflow_runs WHERE (id, landlord_id) IN (
    ('a4f80ab2-b15c-434b-9175-93c59d81e159', 'a13a0000-0b1b-4c29-8372-e6eac54aa21f'),
    ('325d43f7-d8ac-409c-a640-014d8c1cf02d', 'a13a0000-d425-4e27-9391-c7372a9256cf')
  ) AND template_id = 'inspection' AND metadata ->> 'qa_run' = 'ULO-SEC01-STRICT-20261113-137e1cf4') <> 2 THEN
    RAISE EXCEPTION 'Cleanup scope/count mismatch in workflow_runs';
  END IF;
  IF (SELECT count(*) FROM public.unit_inspections WHERE (id, landlord_id, workflow_run_id) IN (
    ('7fb2eea2-23e0-4101-98ae-149b30e162ff', 'a13a0000-0b1b-4c29-8372-e6eac54aa21f', 'a4f80ab2-b15c-434b-9175-93c59d81e159'),
    ('038aed9f-2987-445c-af7f-59146e994a89', 'a13a0000-d425-4e27-9391-c7372a9256cf', '325d43f7-d8ac-409c-a640-014d8c1cf02d')
  )
  AND EXISTS (SELECT 1 FROM public.workflow_runs w
    WHERE w.id = unit_inspections.workflow_run_id
      AND w.landlord_id = unit_inspections.landlord_id
      AND w.metadata ->> 'qa_run' = 'ULO-SEC01-STRICT-20261113-137e1cf4')) <> 2 THEN
    RAISE EXCEPTION 'Cleanup scope/count mismatch in unit_inspections';
  END IF;
  IF (SELECT count(*) FROM public.units WHERE (id, landlord_id) IN (
    ('1665f981-a788-4dc5-8a7c-efacd418d9c2', 'a13a0000-0b1b-4c29-8372-e6eac54aa21f'),
    ('9b1777e0-f877-4b1b-9e00-f6b7ecebef8c', 'a13a0000-d425-4e27-9391-c7372a9256cf')
  ) AND onboarding_session_id = 'ULO-SEC01-STRICT-20261113-137e1cf4') <> 2 THEN
    RAISE EXCEPTION 'Cleanup scope/count mismatch in units';
  END IF;
  IF (SELECT count(*) FROM public.landlords WHERE id IN ('a13a0000-0b1b-4c29-8372-e6eac54aa21f', 'a13a0000-d425-4e27-9391-c7372a9256cf') AND about = 'ULO-SEC01-STRICT-20261113-137e1cf4') <> 2 THEN
    RAISE EXCEPTION 'Cleanup scope/count mismatch in landlords';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE (id, email, created_at) IN (
    ('e6a1e733-1b83-4508-b3f0-b424f934f050', 'sec01-guard-a@ulohome.invalid', '2026-11-14 00:17:47.956034+00'),
    ('fcd840aa-e571-4f6b-aef0-4969ce8dc936', 'sec01-guard-b@ulohome.invalid', '2026-11-14 00:18:26.453022+00')
  ) AND raw_app_meta_data ->> 'ulo_sec01_run' = 'ULO-SEC01-STRICT-20261113-137e1cf4') <> 2 THEN
    RAISE EXCEPTION 'Cleanup scope/count mismatch in auth.users';
  END IF;

  DELETE FROM public.landlord_portal_members
  WHERE (landlord_id, email) IN (
    ('a13a0000-0b1b-4c29-8372-e6eac54aa21f', 'sec01-guard-a@ulohome.invalid'),
    ('a13a0000-d425-4e27-9391-c7372a9256cf', 'sec01-guard-b@ulohome.invalid')
  ) AND full_name IN ('ULO-SEC01-STRICT-20261113-137e1cf4 A', 'ULO-SEC01-STRICT-20261113-137e1cf4 B');
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN RAISE EXCEPTION 'landlord_portal_members: expected 2 rows, got %', affected; END IF;

  UPDATE public.workflow_runs
  SET status = 'cancelled', current_step = 'cancelled', current_stage = 'cancelled',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('qa_retired', true, 'qa_retired_at', now()),
      updated_at = now()
  WHERE (id, landlord_id) IN (
    ('a4f80ab2-b15c-434b-9175-93c59d81e159', 'a13a0000-0b1b-4c29-8372-e6eac54aa21f'),
    ('325d43f7-d8ac-409c-a640-014d8c1cf02d', 'a13a0000-d425-4e27-9391-c7372a9256cf')
  ) AND template_id = 'inspection' AND metadata ->> 'qa_run' = 'ULO-SEC01-STRICT-20261113-137e1cf4';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN RAISE EXCEPTION 'workflow_runs: expected 2 rows, got %', affected; END IF;

  UPDATE public.unit_inspections
  SET status = 'cancelled', metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object('qa_run', 'ULO-SEC01-STRICT-20261113-137e1cf4', 'qa_retired', true, 'qa_retired_at', now()),
      updated_at = now()
  WHERE (id, landlord_id, workflow_run_id) IN (
    ('7fb2eea2-23e0-4101-98ae-149b30e162ff', 'a13a0000-0b1b-4c29-8372-e6eac54aa21f', 'a4f80ab2-b15c-434b-9175-93c59d81e159'),
    ('038aed9f-2987-445c-af7f-59146e994a89', 'a13a0000-d425-4e27-9391-c7372a9256cf', '325d43f7-d8ac-409c-a640-014d8c1cf02d')
  )
  AND EXISTS (SELECT 1 FROM public.workflow_runs w
    WHERE w.id = unit_inspections.workflow_run_id
      AND w.landlord_id = unit_inspections.landlord_id
      AND w.metadata ->> 'qa_run' = 'ULO-SEC01-STRICT-20261113-137e1cf4');
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN RAISE EXCEPTION 'unit_inspections: expected 2 rows, got %', affected; END IF;

  UPDATE public.units
  SET status = 'inactive', skip_tenant_registration = true, updated_at = now()
  WHERE (id, landlord_id) IN (
    ('1665f981-a788-4dc5-8a7c-efacd418d9c2', 'a13a0000-0b1b-4c29-8372-e6eac54aa21f'),
    ('9b1777e0-f877-4b1b-9e00-f6b7ecebef8c', 'a13a0000-d425-4e27-9391-c7372a9256cf')
  ) AND onboarding_session_id = 'ULO-SEC01-STRICT-20261113-137e1cf4';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN RAISE EXCEPTION 'units: expected 2 rows, got %', affected; END IF;

  UPDATE public.landlords
  SET about = 'ULO-SEC01-STRICT-20261113-137e1cf4 / retired', email = NULL, phone = NULL,
      stripe_connect_account_id = NULL, stripe_connect_charges_enabled = false,
      stripe_connect_payouts_enabled = false, stripe_connect_details_submitted = false
  WHERE id IN ('a13a0000-0b1b-4c29-8372-e6eac54aa21f', 'a13a0000-d425-4e27-9391-c7372a9256cf') AND about = 'ULO-SEC01-STRICT-20261113-137e1cf4';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN RAISE EXCEPTION 'landlords: expected 2 rows, got %', affected; END IF;

  UPDATE auth.users
  SET banned_until = '2099-01-01 00:00:00+00'::timestamptz, updated_at = now()
  WHERE (id, email, created_at) IN (
    ('e6a1e733-1b83-4508-b3f0-b424f934f050', 'sec01-guard-a@ulohome.invalid', '2026-11-14 00:17:47.956034+00'),
    ('fcd840aa-e571-4f6b-aef0-4969ce8dc936', 'sec01-guard-b@ulohome.invalid', '2026-11-14 00:18:26.453022+00')
  ) AND raw_app_meta_data ->> 'ulo_sec01_run' = 'ULO-SEC01-STRICT-20261113-137e1cf4';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN RAISE EXCEPTION 'auth.users: expected 2 rows, got %', affected; END IF;

END;
$cleanup$;
COMMIT;
