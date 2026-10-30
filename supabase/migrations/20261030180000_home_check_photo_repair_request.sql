-- Landlord asked for a repair from a Home Check photo. Does not auto-open repairs.
create or replace function public.request_home_check_photo_repair(p_check_id uuid, p_reason text)
returns uuid
language plpgsql
set search_path to public
as $$
declare
  c public.home_checks;
  ticket uuid;
  reason text;
  category text;
begin
  select * into strict c from public.home_checks where id = p_check_id for update;
  if c.issue_ticket_id is not null then return c.issue_ticket_id; end if;
  if nullif(trim(c.detected_warning), '') is null then return null; end if;
  reason := nullif(trim(p_reason), '');
  if reason is null then
    reason := 'A photo showed: ' || c.detected_warning;
  end if;
  category := case
    when reason ~* '(gas|smoke|scorch|spark|electric)' then 'electrical'
    when reason ~* '(leak|water|plumb|drain|flood|pan|valve)' then 'plumbing'
    when reason ~* '(heat|furnace|hvac|boiler|cool)' then 'hvac'
    else 'general'
  end;
  insert into public.maintenance_requests(
    priority, urgency, resident_name, email, unit, description, landlord_id, property_id, unit_id,
    issue_category, severity, ticket_kind, trigger_type, parent_ticket_id, observation_only
  )
    values(
      'Normal', 'normal', 'Home Check follow-up', '', coalesce(c.unit_label, c.property_label),
      reason,
      c.landlord_id, c.property_id, c.unit_id, category, 'medium', 'reactive', 'home_check', c.ticket_id,
      false
    )
    returning id into ticket;
  update public.home_checks set issue_ticket_id = ticket where id = c.id;
  insert into public.home_check_events(check_id, event_type, role, metadata)
    values(c.id, 'issue_reported', c.role, jsonb_build_object('ticket_id', ticket, 'reason', reason, 'issue_category', category, 'source', 'photo_review'));
  return ticket;
end $$;

revoke all on function public.request_home_check_photo_repair(uuid, text) from public, anon, authenticated;
grant execute on function public.request_home_check_photo_repair(uuid, text) to service_role;
