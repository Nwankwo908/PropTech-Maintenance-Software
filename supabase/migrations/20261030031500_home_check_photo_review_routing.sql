-- Photo-only concerns are unverified observations. Human-reported problems retain their repair workflow.
CREATE OR REPLACE FUNCTION public.report_home_check_issue(p_check_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  c public.home_checks;
  ticket uuid;
  reported boolean;
  supported boolean;
  reason text;
  category text;
begin
  select * into strict c from public.home_checks where id = p_check_id for update;
  if c.issue_ticket_id is not null then return c.issue_ticket_id; end if;
  reported := coalesce((c.answers->>'warningSigns')::boolean, false);
  -- AI photo observations are reviewed in PM Compliance, not auto-created repairs.
  supported := false;
  if not reported and not supported then return null; end if;
  reason := case
    when reported then 'The check reported a leak, noise, or smell' ||
      case when nullif(trim(c.answers->>'warningDetails'), '') is not null then ': ' || trim(c.answers->>'warningDetails') else '' end
    else 'A photo showed: ' || c.detected_warning
  end;
  category := case
    when reason ~* '(gas|smoke|scorch|spark|electric)' then 'electrical'
    when reason ~* '(leak|water|plumb|drain|flood)' then 'plumbing'
    when reason ~* '(heat|furnace|hvac|boiler|cool)' then 'hvac'
    else 'general'
  end;
  insert into public.maintenance_requests(
    priority, urgency, resident_name, email, unit, description, landlord_id, property_id, unit_id,
    issue_category, severity, ticket_kind, trigger_type, parent_ticket_id, observation_only
  )
    values(
      'Normal', 'normal', 'Home Check follow-up', '', coalesce(c.unit_label, c.property_label),
      'Home Check follow-up. ' || reason || ' Review this before any paid work. No vendor has been contacted.',
      c.landlord_id, c.property_id, c.unit_id, category, 'medium', 'reactive', 'home_check', c.ticket_id,
      false
    )
    returning id into ticket;
  update public.home_checks set issue_ticket_id = ticket where id = c.id;
  insert into public.home_check_events(check_id, event_type, role, metadata)
    values(c.id, 'issue_reported', c.role, jsonb_build_object('ticket_id', ticket, 'reason', reason, 'issue_category', category));
  return ticket;
end $function$
;
