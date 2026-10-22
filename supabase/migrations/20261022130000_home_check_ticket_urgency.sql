-- Home Check tickets must satisfy maintenance_requests.urgency, which is required
-- independently of priority.
create or replace function public.create_home_check(p_input jsonb)
returns uuid language plpgsql set search_path = public as $$
declare c public.home_checks; building_name text;
begin
  c := jsonb_populate_record(null::public.home_checks, p_input);
  select name into strict building_name from public.properties where id = c.property_id and landlord_id = c.landlord_id;
  if c.unit_id is not null and not exists(select 1 from public.units where id = c.unit_id and property_id = c.property_id and landlord_id = c.landlord_id) then raise exception 'Unit scope mismatch'; end if;
  if c.role = 'tenant' and (c.unit_id is null or c.resident_id is null) then raise exception 'Tenant Home Check requires exact occupancy'; end if;
  if c.vendor_id is not null and not exists(select 1 from public.vendors where id = c.vendor_id and landlord_id = c.landlord_id and active) then raise exception 'Vendor scope mismatch'; end if;
  c.assessment_id := gen_random_uuid(); c.ticket_id := gen_random_uuid(); c.workflow_run_id := gen_random_uuid();
  insert into public.property_inspection_assessments(id, landlord_id, property_id, building) values(c.assessment_id, c.landlord_id, c.property_id, building_name);
  insert into public.maintenance_requests(id, landlord_id, property_id, unit_id, unit, resident_name, email, priority, urgency, description, assigned_vendor_id, vendor_work_status, ticket_kind, trigger_type, labor_type, observation_only)
    values(c.ticket_id, c.landlord_id, c.property_id, c.unit_id, coalesce(c.unit_label, building_name), 'Home Check', '', 'Normal', 'normal',
      'Home Check: four photos of the water heater and furnace or boiler. Observation only; no repairs or paid work authorized.',
      c.vendor_id, case when c.vendor_id is not null then 'pending_accept' else 'unassigned' end, 'proactive', 'home_check', 'handyman_safe', true);
  insert into public.workflow_runs(id, template_id, workflow_type, landlord_id, trigger_type, entity_type, entity_id, property_id, unit_id, resident_id, status, current_stage, current_step, metadata)
    values(c.workflow_run_id, 'home_check', 'home_check', c.landlord_id, 'home_check', 'maintenance_request', c.ticket_id, c.property_id, c.unit_id, c.resident_id, 'active', 'act', 'awaiting_four_photos',
      jsonb_build_object('home_check_id', c.id, 'labor_type', 'handyman_safe', 'observation_only', true, 'role', c.role, 'unit_label', c.unit_label, 'building', building_name, 'ticket_kind', 'proactive'));
  insert into public.home_checks(id, reference, landlord_id, property_id, unit_id, ticket_id, workflow_run_id, assessment_id, role, recipient_phone, resident_id, vendor_id, ulo_number, property_label, unit_label, token_hash, expires_at, authorized_by)
    values(c.id, c.reference, c.landlord_id, c.property_id, c.unit_id, c.ticket_id, c.workflow_run_id, c.assessment_id, c.role, c.recipient_phone, c.resident_id, c.vendor_id, c.ulo_number, c.property_label, c.unit_label, c.token_hash, c.expires_at, c.authorized_by);
  return c.id;
end $$;

-- Four photos finish the observation. Do not mark vendor work completed when no vendor is assigned.
create or replace function public.record_home_check_photo(p_check_id uuid, p_slot text, p_photo_id uuid, p_storage_path text, p_source text)
returns void language plpgsql set search_path = public as $$
declare c public.home_checks; n integer;
begin
  select * into strict c from public.home_checks where id = p_check_id for update;
  if c.expires_at <= now() or c.status not in ('collecting', 'completed') then
    raise exception 'Home Check has ended';
  end if;
  if not exists (select 1 from public.property_inspection_photos where id = p_photo_id and assessment_id = c.assessment_id and landlord_id = c.landlord_id) then
    raise exception 'Photo scope mismatch';
  end if;
  if (select count(*) from public.home_check_events where check_id = c.id and event_type = 'uploaded') >= 20 then
    raise exception 'Photo replacement limit reached; ask the landlord for a new check';
  end if;
  insert into public.home_check_photos(check_id, slot, inspection_photo_id, storage_path, source)
    values (c.id, p_slot, p_photo_id, p_storage_path, p_source)
    on conflict(check_id, slot) do update set inspection_photo_id = excluded.inspection_photo_id, storage_path = excluded.storage_path, source = excluded.source;
  insert into public.home_check_events(check_id, event_type, role, metadata)
    values(c.id, 'uploaded', c.role, jsonb_build_object('slot', p_slot, 'photo_id', p_photo_id, 'source', p_source));
  update public.property_inspection_photos set home_check_id = c.id where id = p_photo_id;
  select count(*) into n from public.home_check_photos where check_id = c.id;
  if n = 4 and c.completed_at is null then
    update public.home_checks set status = 'completed', completed_at = now() where id = c.id;
    update public.maintenance_requests
      set completed_at = now(),
          vendor_work_status = case
            when assigned_vendor_id is not null then 'completed'
            else vendor_work_status
          end
      where id = c.ticket_id;
    update public.workflow_runs set status = 'completed', current_step = 'four_photos_received', current_stage = 'log', completed_at = now() where id = c.workflow_run_id;
    insert into public.home_check_events(check_id, event_type, role) values(c.id, 'completed', c.role);
  end if;
end $$;

create or replace function public.report_home_check_issue(p_check_id uuid)
returns uuid language plpgsql set search_path = public as $$
declare c public.home_checks; ticket uuid;
begin
  select * into strict c from public.home_checks where id = p_check_id for update;
  if c.issue_ticket_id is not null then return c.issue_ticket_id; end if;
  if coalesce((c.answers->>'warningSigns')::boolean, false) = false and c.detected_warning is null then return null; end if;
  insert into public.maintenance_requests(priority, urgency, resident_name, email, unit, description, landlord_id, property_id, unit_id, issue_category, severity, ticket_kind, trigger_type, parent_ticket_id)
    values('Normal', 'normal', 'Home Check follow-up', '', coalesce(c.unit_label, c.property_label),
      'Home Check warning signs: ' || coalesce(nullif(c.answers->>'warningDetails', ''), c.detected_warning, 'Leak, odd noise or smell reported.') || ' Landlord review required before any paid work.',
      c.landlord_id, c.property_id, c.unit_id, 'home_check_warning', 'medium', 'reactive', 'home_check', c.ticket_id)
    returning id into ticket;
  update public.home_checks set issue_ticket_id = ticket where id = c.id;
  insert into public.home_check_events(check_id, event_type, role, metadata) values(c.id, 'issue_reported', c.role, jsonb_build_object('ticket_id', ticket));
  return ticket;
end $$;
