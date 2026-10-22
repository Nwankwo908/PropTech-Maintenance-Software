-- Run against an isolated database after applying the Home Check migration.
-- All fixtures and assertions roll back. Never run with live outbound workers.
begin;
do $$
declare
  landlord uuid := gen_random_uuid(); other_landlord uuid := gen_random_uuid();
  property uuid := gen_random_uuid(); v_unit uuid := gen_random_uuid();
  assessment uuid := gen_random_uuid(); other_assessment uuid := gen_random_uuid();
  ticket uuid := gen_random_uuid(); run uuid := gen_random_uuid(); v_check_id uuid := gen_random_uuid();
  expired_check uuid := gen_random_uuid();
  photos uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  wrong_photo uuid := gen_random_uuid(); warning_ticket uuid; rejected boolean; persisted boolean;
  payload jsonb; slot text; i integer;
  created_check uuid := gen_random_uuid(); input jsonb; before_tickets integer; review_asset uuid; heating_asset uuid; expected_age integer;
begin
  insert into public.landlords(id, name) values(landlord, 'Home Check test'), (other_landlord, 'Other test landlord');
  insert into public.properties(id, landlord_id, name) values(property, landlord, 'Scope test property');
  insert into public.units(id, landlord_id, property_id, unit_label, building) values(v_unit, landlord, property, '12A', 'Scope test property');
  input := jsonb_build_object('id', created_check, 'reference', 'HC-' || upper(substr(replace(created_check::text, '-', ''),1,12)), 'landlord_id', landlord, 'property_id', property, 'unit_id', v_unit, 'unit_label', '12A', 'role', 'landlord', 'property_label', 'Scope test property', 'token_hash', repeat('c',64), 'expires_at', now() + interval '7 days', 'authorized_by', 'test');
  perform public.create_home_check(input);
  if not exists(select 1 from public.home_checks c join public.maintenance_requests t on t.id = c.ticket_id join public.workflow_runs w on w.id = c.workflow_run_id where c.id = created_check and t.ticket_kind = 'proactive' and t.trigger_type = 'home_check' and t.labor_type = 'handyman_safe' and t.observation_only and w.template_id = 'home_check' and w.property_id = property and w.unit_id = v_unit) then raise exception 'Atomic creation did not link proactive ticket and workflow'; end if;
  select count(*) into before_tickets from public.maintenance_requests;
  rejected := false;
  begin perform public.create_home_check((input - 'token_hash') || jsonb_build_object('id', gen_random_uuid(), 'reference', 'HC-000000000000'));
  exception when not_null_violation then rejected := true; end;
  if not rejected or (select count(*) from public.maintenance_requests) <> before_tickets then raise exception 'Failed capability creation left orphan tickets'; end if;
  insert into public.property_inspection_assessments(id, landlord_id, property_id, building) values(assessment, landlord, property, 'Scope test property'), (other_assessment, landlord, property, 'Scope test property');
  insert into public.maintenance_requests(id, landlord_id, property_id, unit_id, resident_name, email, unit, priority, urgency, description)
    values(ticket, landlord, property, v_unit, 'Home Check', '', '12A', 'Normal', 'normal', 'Observation only');
  insert into public.workflow_runs(id, template_id, landlord_id, trigger_type, entity_type, entity_id, property_id, unit_id, status)
    values(run, 'home_check', landlord, 'home_check', 'maintenance_request', ticket, property, v_unit, 'active');
  insert into public.home_checks(id, reference, landlord_id, property_id, unit_id, ticket_id, workflow_run_id, assessment_id, role, property_label, unit_label, token_hash, expires_at, authorized_by)
    values(v_check_id, 'HC-' || upper(substr(replace(v_check_id::text, '-', ''),1,12)), landlord, property, v_unit, ticket, run, assessment, 'tenant', 'Scope test property', '12A', repeat('a',64), now() + interval '7 days', 'test');
  for i in 1..4 loop
    insert into public.property_inspection_photos(id, assessment_id, landlord_id, status) values(photos[i], assessment, landlord, 'needs_review');
  end loop;
  insert into public.property_inspection_photos(id, assessment_id, landlord_id, status) values(wrong_photo, other_assessment, landlord, 'needs_review');
  rejected := false;
  begin
    perform public.record_home_check_photo(v_check_id, 'water_heater_label', wrong_photo, 'wrong.jpg', 'link');
  exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'Cross-assessment upload was accepted'; end if;
  perform public.record_home_check_photo(v_check_id, 'water_heater_label', photos[1], '1.jpg', 'link');
  perform public.record_home_check_photo(v_check_id, 'water_heater_label', photos[1], '1.jpg', 'link');
  if (select completed_at from public.home_checks where id = v_check_id) is not null then raise exception 'Repeated slot completed check'; end if;
  for i in 2..4 loop
    slot := (array['water_heater_label','water_heater_whole','heating_label','heating_whole'])[i];
    perform public.record_home_check_photo(v_check_id, slot, photos[i], i || '.jpg', 'photo_text');
  end loop;
  if (select status from public.home_checks where id = v_check_id) <> 'completed' then raise exception 'Four slots did not complete check'; end if;
  if (select status from public.workflow_runs where id = run) <> 'completed' then raise exception 'Shared workflow not completed'; end if;
  if (select completed_at from public.maintenance_requests where id = ticket) is null then raise exception 'Proactive ticket not completed'; end if;
  if (select count(*) from public.home_check_events where home_check_events.check_id = v_check_id and event_type = 'uploaded') < 5 then raise exception 'Upload audit missing'; end if;
  rejected := false;
  begin perform public.confirm_home_check(v_check_id, landlord);
  exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'Confirmation accepted before asset records existed'; end if;
  payload := jsonb_build_array(
    jsonb_build_object('system','water_heater','title','Water heater','registryType','water_heater','asset',jsonb_build_object('verified',false,'fields',jsonb_build_object('make',jsonb_build_object('value','Rheem'),'model',jsonb_build_object('value','A'),'serial',jsonb_build_object('value','B'),'approximateAge',jsonb_build_object('value',11,'estimated',true)))),
    jsonb_build_object('system','heating','title','Furnace','registryType','hvac','asset',jsonb_build_object('verified',false,'fields',jsonb_build_object('make',jsonb_build_object('value','Carrier'),'model',jsonb_build_object('value','C'),'serial',jsonb_build_object('value','D'),'approximateAge',jsonb_build_object('value',6,'estimated',true)))));
  persisted := public.persist_home_check_assets(v_check_id, array[photos[1]], payload);
  if persisted then raise exception 'Stale photo evidence overwrote current baseline'; end if;
  persisted := public.persist_home_check_assets(v_check_id, photos, payload);
  if not persisted then raise exception 'Current photo evidence was rejected'; end if;
  if (select count(*) from public.unit_assets where home_check_id = v_check_id and metadata->>'verificationStatus' = 'unverified') <> 2 then raise exception 'Pending baseline not persisted'; end if;
  rejected := false;
  begin perform public.confirm_home_check(v_check_id, other_landlord);
  exception when no_data_found then rejected := true; end;
  if not rejected then raise exception 'Wrong landlord confirmed check'; end if;
  update public.home_checks set answers = '{"warningSigns":true,"warningDetails":"Leak at water heater base"}' where id = v_check_id;
  warning_ticket := public.report_home_check_issue(v_check_id);
  if warning_ticket is null or public.report_home_check_issue(v_check_id) <> warning_ticket then raise exception 'Follow-up was missing or duplicated'; end if;
  if not exists(select 1 from public.maintenance_requests where id = warning_ticket and parent_ticket_id = ticket and property_id = property and unit_id = v_unit and ticket_kind = 'reactive' and assigned_vendor_id is null) then raise exception 'Follow-up scope or approval boundary wrong'; end if;
  update public.property_inspection_photos set status = 'queued' where id = photos[4];
  rejected := false;
  begin perform public.confirm_home_check_label_review(v_check_id, landlord);
  exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'Confirmed while paired equipment reading was pending'; end if;
  update public.property_inspection_photos set status = 'needs_review' where id = photos[4];
  select id into review_asset from public.unit_assets where home_check_id = v_check_id and home_check_system = 'water_heater';
  update public.unit_assets set metadata = jsonb_set(metadata, '{homeCheck,labelReadability}', '{"status":"uncertain","retakeRequested":true}') where id = review_asset;
  rejected := false;
  begin perform public.confirm_home_check_label_review(v_check_id, landlord);
  exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'Unacknowledged uncertain label was confirmed'; end if;
  rejected := false;
  begin perform public.confirm_home_check_label_review(v_check_id, landlord, jsonb_build_array(jsonb_build_object('assetId', gen_random_uuid(), 'modelNumber', 'X123')));
  exception when no_data_found then rejected := true; end;
  if not rejected then raise exception 'Accepted a label correction for another asset'; end if;
  perform public.confirm_home_check_label_review(v_check_id, landlord, jsonb_build_array(jsonb_build_object('assetId', review_asset, 'modelNumber', 'X123', 'serialNumber', 'AB012345')));
  if (select metadata#>>'{homeCheck,fields,serial,source}' from public.unit_assets where id = review_asset) <> 'landlord' then raise exception 'Human label correction lost source provenance'; end if;
  if (select model from public.unit_assets where id = review_asset) <> 'X123' then raise exception 'Human-verified model was not saved'; end if;
  perform public.confirm_home_check(v_check_id, landlord);
  if (select count(*) from public.home_check_events where home_check_events.check_id = v_check_id and event_type = 'landlord_confirmed') <> 1 then raise exception 'Confirmation not idempotent'; end if;
  perform public.persist_home_check_assets(v_check_id, photos, '[]');
  if (select count(*) from public.unit_assets where home_check_id = v_check_id and metadata->>'verificationStatus' = 'confirmed') <> 2 then raise exception 'Slow upload reset confirmed records'; end if;
  if exists(select 1 from public.unit_assets where home_check_id = v_check_id and metadata->>'ageBasis' <> 'ai_estimated') then raise exception 'Estimated serial age promoted to fact'; end if;
  select id into heating_asset from public.unit_assets where home_check_id = v_check_id and home_check_system = 'heating';
  perform public.confirm_home_check_label_review(v_check_id, landlord, jsonb_build_array(jsonb_build_object('assetId', heating_asset, 'manufactureYear', 2013, 'manufactureMonth', 7)));
  expected_age := extract(year from timezone('utc', now()))::integer - 2013 - case when extract(month from timezone('utc', now()))::integer > 7 then 0 when extract(month from timezone('utc', now()))::integer = 7 then null::integer else 1 end;
  if (select estimated_age_years from public.unit_assets where id = heating_asset) is distinct from expected_age then raise exception 'Manufacture date did not recompute equipment age'; end if;
  if (select metadata#>>'{homeCheck,fields,approximateAge,source}' from public.unit_assets where id = heating_asset) <> 'landlord' then raise exception 'Corrected manufacture date lost landlord source'; end if;
  if (select metadata->>'ageBasis' from public.unit_assets where id = heating_asset) <> 'landlord_plate' then raise exception 'Plate date was stored as an AI estimate'; end if;
  if (select metadata->>'ageBasis' from public.unit_assets where id = review_asset) <> 'ai_estimated' then raise exception 'A date correction changed the other asset'; end if;
  if (select count(*) from public.home_check_events where home_check_events.check_id = v_check_id and event_type = 'landlord_confirmed') <> 1 then raise exception 'Date correction duplicated confirmation'; end if;
  rejected := false;
  begin perform public.record_home_check_photo(v_check_id, 'water_heater_label', photos[1], 'new.jpg', 'link');
  exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'Confirmed link accepted a replacement'; end if;
  insert into public.home_checks(id, reference, landlord_id, property_id, ticket_id, workflow_run_id, assessment_id, role, property_label, token_hash, created_at, expires_at, authorized_by)
    values(expired_check, 'HC-' || upper(substr(replace(expired_check::text, '-', ''),1,12)), landlord, property, ticket, run, assessment, 'contractor', 'Scope test property', repeat('b',64), now() - interval '2 days', now() - interval '1 day', 'test');
  rejected := false;
  begin perform public.record_home_check_photo(expired_check, 'water_heater_label', photos[1], 'expired.jpg', 'link');
  exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'Expired contractor link accepted upload'; end if;
  if has_function_privilege('anon', 'public.record_home_check_photo(uuid,text,uuid,text,text)', 'execute') or has_function_privilege('authenticated', 'public.confirm_home_check(uuid,uuid)', 'execute') then raise exception 'Public RPC grants bypass token/landlord guards'; end if;
  raise notice 'Home Check scope, completion, audit, stale writes, confirmation, follow-up, expiration and RPC grants passed';
end $$;
rollback;
