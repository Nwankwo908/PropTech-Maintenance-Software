-- Observation-only Home Checks share the maintenance ticket + workflow graph.
alter table public.maintenance_requests
  add column if not exists property_id uuid references public.properties(id),
  add column if not exists unit_id uuid references public.units(id),
  add column if not exists ticket_kind text not null default 'reactive',
  add column if not exists trigger_type text,
  add column if not exists labor_type text,
  add column if not exists observation_only boolean not null default false,
  add column if not exists parent_ticket_id uuid references public.maintenance_requests(id);

insert into public.workflow_templates(id, name, type, description, trigger_config, route_config, escalation_config, active)
values('home_check', 'Home Check', 'maintenance', 'Observation-only water heater and heating system baseline',
  '{"primary_trigger":"home_check","triggers":["home_check","sms_inbound","cron"]}',
  '{"labor_type":"handyman_safe","observation_only":true,"completion":"four_distinct_photo_slots"}',
  '{"tenant_reminder_hours":48,"max_reminders":1}', true)
on conflict(id) do update set name = excluded.name, trigger_config = excluded.trigger_config, route_config = excluded.route_config, escalation_config = excluded.escalation_config;

alter table public.vendors
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

alter table public.workflow_runs drop constraint if exists workflow_runs_trigger_type_check;
alter table public.workflow_runs add constraint workflow_runs_trigger_type_check
  check (trigger_type is null or trigger_type in ('sms_inbound', 'cron', 'dashboard', 'webhook', 'vendor_portal', 'automation', 'home_check'));

create table public.home_checks (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  landlord_id uuid not null references public.landlords(id),
  property_id uuid not null references public.properties(id),
  unit_id uuid references public.units(id),
  ticket_id uuid not null references public.maintenance_requests(id),
  workflow_run_id uuid not null references public.workflow_runs(id),
  assessment_id uuid not null references public.property_inspection_assessments(id),
  role text not null check (role in ('tenant', 'contractor', 'landlord')),
  recipient_phone text,
  resident_id uuid references public.users(id),
  vendor_id uuid references public.vendors(id),
  ulo_number text,
  property_label text not null,
  unit_label text,
  token_hash text not null,
  status text not null default 'collecting' check (status in ('collecting', 'completed', 'confirmed', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  opened_at timestamptz,
  completed_at timestamptz,
  confirmed_at timestamptz,
  summary_sent_at timestamptz,
  reminder_claimed_at timestamptz,
  reminder_sent_at timestamptz,
  labels_readable boolean not null default false,
  answers jsonb not null default '{"warningSigns":null,"warningDetails":"","lastService":"","lastFilterChange":""}',
  issue_ticket_id uuid references public.maintenance_requests(id),
  detected_warning text,
  authorized_by text not null,
  check (expires_at > created_at and expires_at <= created_at + interval '7 days')
);
create index home_checks_scope_idx on public.home_checks(landlord_id, property_id, unit_id, created_at desc);
create index home_checks_sms_idx on public.home_checks(landlord_id, recipient_phone, ulo_number);
alter table public.property_inspection_photos add column home_check_id uuid references public.home_checks(id);

create table public.home_check_photos (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.home_checks(id) on delete cascade,
  slot text not null check (slot in ('water_heater_label', 'water_heater_whole', 'heating_label', 'heating_whole')),
  inspection_photo_id uuid not null references public.property_inspection_photos(id),
  storage_path text not null,
  source text not null check (source in ('link', 'photo_text')),
  created_at timestamptz not null default now(),
  unique (check_id, slot)
);
create table public.home_check_events (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.home_checks(id) on delete cascade,
  event_type text not null,
  role text not null check (role in ('tenant', 'contractor', 'landlord')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.unit_assets
  add column home_check_id uuid references public.home_checks(id),
  add column home_check_system text check (home_check_system in ('water_heater', 'heating'));
create unique index unit_assets_home_check_system_idx on public.unit_assets(home_check_id, home_check_system);

-- No direct browser policies. Public capture is upload-only through a scoped,
-- hashed capability. Dashboard operations verify the signed-in landlord first.
alter table public.home_checks enable row level security;
alter table public.home_check_photos enable row level security;
alter table public.home_check_events enable row level security;

-- The ticket, assessment, workflow run and scoped capability are one transaction.
create function public.create_home_check(p_input jsonb)
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
  insert into public.maintenance_requests(id, landlord_id, property_id, unit_id, unit, resident_name, email, priority, description, assigned_vendor_id, vendor_work_status, ticket_kind, trigger_type, labor_type, observation_only)
    values(c.ticket_id, c.landlord_id, c.property_id, c.unit_id, coalesce(c.unit_label, building_name), 'Home Check', '', 'Normal',
      'Home Check: four photos of the water heater and furnace or boiler. Observation only; no repairs or paid work authorized.',
      c.vendor_id, case when c.vendor_id is not null then 'pending_accept' else 'unassigned' end, 'proactive', 'home_check', 'handyman_safe', true);
  insert into public.workflow_runs(id, template_id, workflow_type, landlord_id, trigger_type, entity_type, entity_id, property_id, unit_id, resident_id, status, current_stage, current_step, metadata)
    values(c.workflow_run_id, 'home_check', 'home_check', c.landlord_id, 'home_check', 'maintenance_request', c.ticket_id, c.property_id, c.unit_id, c.resident_id, 'active', 'act', 'awaiting_four_photos',
      jsonb_build_object('home_check_id', c.id, 'labor_type', 'handyman_safe', 'observation_only', true, 'role', c.role, 'unit_label', c.unit_label, 'building', building_name, 'ticket_kind', 'proactive'));
  insert into public.home_checks(id, reference, landlord_id, property_id, unit_id, ticket_id, workflow_run_id, assessment_id, role, recipient_phone, resident_id, vendor_id, ulo_number, property_label, unit_label, token_hash, expires_at, authorized_by)
    values(c.id, c.reference, c.landlord_id, c.property_id, c.unit_id, c.ticket_id, c.workflow_run_id, c.assessment_id, c.role, c.recipient_phone, c.resident_id, c.vendor_id, c.ulo_number, c.property_label, c.unit_label, c.token_hash, c.expires_at, c.authorized_by);
  return c.id;
end $$;

create function public.record_home_check_photo(p_check_id uuid, p_slot text, p_photo_id uuid, p_storage_path text, p_source text)
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
    update public.maintenance_requests set completed_at = now(), vendor_work_status = 'completed' where id = c.ticket_id;
    update public.workflow_runs set status = 'completed', current_step = 'four_photos_received', current_stage = 'log', completed_at = now() where id = c.workflow_run_id;
    insert into public.home_check_events(check_id, event_type, role) values(c.id, 'completed', c.role);
  end if;
end $$;

-- Serialize both asset writes against upload replacement and confirmation.
-- A slow earlier request cannot overwrite a newer photo's evidence.
create function public.persist_home_check_assets(p_check_id uuid, p_photo_ids uuid[], p_assets jsonb)
returns boolean language plpgsql set search_path = public as $$
declare c public.home_checks; current_ids uuid[]; a jsonb; readable boolean := true;
begin
  select * into strict c from public.home_checks where id = p_check_id for update;
  if c.confirmed_at is not null then return true; end if;
  select array_agg(inspection_photo_id order by inspection_photo_id) into current_ids from public.home_check_photos where check_id = c.id;
  if coalesce(current_ids, '{}'::uuid[]) <> coalesce((select array_agg(x order by x) from unnest(p_photo_ids) x), '{}'::uuid[]) then return false; end if;
  if jsonb_array_length(p_assets) <> 2 then raise exception 'Both baseline systems are required'; end if;
  for a in select value from jsonb_array_elements(p_assets) loop
    if a->>'system' not in ('water_heater', 'heating') then raise exception 'Invalid system'; end if;
    insert into public.unit_assets(home_check_id, home_check_system, landlord_id, property_id, unit_id, unit_label, building, appliance_type, appliance_label, brand, model, estimated_age_years, useful_life_years, failure_risk_pct, failure_prediction_window, replacement_recommended, replacement_urgency, detection_source, metadata)
    values(c.id, a->>'system', c.landlord_id, c.property_id, c.unit_id, c.unit_label, (select name from public.properties where id = c.property_id),
      a->>'title', a->>'title', a->'asset'->'fields'->'make'->>'value', a->'asset'->'fields'->'model'->>'value',
      (a->'asset'->'fields'->'approximateAge'->>'value')::numeric, case when a->>'system' = 'water_heater' then 12 else 15 end,
      null, 'Not assessed', false, 'monitor', 'photo_ai',
      jsonb_build_object('registryAssetType', a->>'registryType', 'assetSource', 'ai_photo_detected', 'verificationStatus', 'unverified', 'ageBasis', 'ai_estimated', 'homeCheck', a->'asset', 'serialNumber', a->'asset'->'fields'->'serial'->'value', 'conditionRating', a->>'conditionRating', 'sourcePhotoUrl', a->>'sourcePhotoUrl', 'photoId', a->>'photoId', 'assessmentId', c.assessment_id))
    on conflict(home_check_id, home_check_system) do update set
      brand = excluded.brand, model = excluded.model, estimated_age_years = excluded.estimated_age_years,
      appliance_type = excluded.appliance_type, appliance_label = excluded.appliance_label, metadata = excluded.metadata, updated_at = now();
    readable := readable and nullif(a->'asset'->'fields'->'make'->>'value', '') is not null and nullif(a->'asset'->'fields'->'model'->>'value', '') is not null and nullif(a->'asset'->'fields'->'serial'->>'value', '') is not null;
  end loop;
  update public.home_checks set labels_readable = readable where id = c.id;
  return true;
end $$;

create function public.confirm_home_check(p_check_id uuid, p_landlord_id uuid)
returns void language plpgsql set search_path = public as $$
declare c public.home_checks;
begin
  select * into strict c from public.home_checks where id = p_check_id and landlord_id = p_landlord_id for update;
  if c.completed_at is null then raise exception 'All four photos are required'; end if;
  if (select count(*) from public.unit_assets where home_check_id = c.id) <> 2 then raise exception 'Asset records are still processing'; end if;
  update public.unit_assets set metadata = jsonb_set(metadata, '{homeCheck,verified}', 'true') || jsonb_build_object('verificationStatus', 'confirmed', 'confirmedAt', now(), 'confirmedBy', p_landlord_id), updated_at = now() where home_check_id = c.id;
  update public.home_checks set status = 'confirmed', confirmed_at = coalesce(confirmed_at, now()) where id = c.id;
  if c.confirmed_at is null then
    insert into public.home_check_events(check_id, event_type, role) values(c.id, 'landlord_confirmed', c.role);
  end if;
end $$;

create function public.report_home_check_issue(p_check_id uuid)
returns uuid language plpgsql set search_path = public as $$
declare c public.home_checks; ticket uuid;
begin
  select * into strict c from public.home_checks where id = p_check_id for update;
  if c.issue_ticket_id is not null then return c.issue_ticket_id; end if;
  if coalesce((c.answers->>'warningSigns')::boolean, false) = false and c.detected_warning is null then return null; end if;
  insert into public.maintenance_requests(priority, resident_name, email, unit, description, landlord_id, property_id, unit_id, issue_category, severity, ticket_kind, trigger_type, parent_ticket_id)
    values('Normal', 'Home Check follow-up', '', coalesce(c.unit_label, c.property_label),
      'Home Check warning signs: ' || coalesce(nullif(c.answers->>'warningDetails', ''), c.detected_warning, 'Leak, odd noise or smell reported.') || ' Landlord review required before any paid work.',
      c.landlord_id, c.property_id, c.unit_id, 'home_check_warning', 'medium', 'reactive', 'home_check', c.ticket_id)
    returning id into ticket;
  update public.home_checks set issue_ticket_id = ticket where id = c.id;
  insert into public.home_check_events(check_id, event_type, role, metadata) values(c.id, 'issue_reported', c.role, jsonb_build_object('ticket_id', ticket));
  return ticket;
end $$;
revoke all on function public.create_home_check(jsonb), public.record_home_check_photo(uuid, text, uuid, text, text), public.confirm_home_check(uuid, uuid), public.report_home_check_issue(uuid), public.persist_home_check_assets(uuid, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.create_home_check(jsonb), public.record_home_check_photo(uuid, text, uuid, text, text), public.confirm_home_check(uuid, uuid), public.report_home_check_issue(uuid), public.persist_home_check_assets(uuid, uuid[], jsonb) to service_role;

-- Deliberately no cron schedule here: use the existing authenticated ops cron.
