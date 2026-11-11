-- One open SMS intake owns one draft. A second worker for the same
-- conversation waits on the conversation row, then reuses that draft unless
-- the new message is a different trade or an explicit new request.
-- Service role only. Does not update or delete an existing work order.

create or replace function public.claim_sms_intake_draft(
  p_landlord_id uuid,
  p_conversation_id uuid,
  p_issue_category text,
  p_separate_request boolean,
  p_ticket jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  conversation public.sms_conversations%rowtype;
  existing_id uuid;
  existing_category text;
  existing_status text;
  created_id uuid;
  reuse boolean;
begin
  if p_landlord_id is null or p_conversation_id is null then
    raise exception 'Intake claim requires a landlord and conversation';
  end if;

  select * into conversation
  from public.sms_conversations
  where id = p_conversation_id
    and landlord_id = p_landlord_id
  for update;

  if not found then
    raise exception 'Intake conversation not found for this account';
  end if;

  existing_id := nullif(conversation.intake_state->>'draft_ticket_id', '')::uuid;
  if existing_id is not null then
    select issue_category, vendor_work_status
      into existing_category, existing_status
    from public.maintenance_requests
    where id = existing_id
      and landlord_id = p_landlord_id;

    reuse := not coalesce(p_separate_request, false)
      and existing_status is not null
      and existing_status not in ('completed', 'cancelled', 'archived')
      and (
        nullif(btrim(existing_category), '') is null
        or nullif(btrim(p_issue_category), '') is null
        or lower(btrim(existing_category)) = lower(btrim(p_issue_category))
      );

    if reuse then
      return jsonb_build_object('id', existing_id, 'created', false);
    end if;
  end if;

  insert into public.maintenance_requests (
    landlord_id,
    priority,
    urgency,
    resident_name,
    email,
    resident_phone,
    unit,
    description,
    room,
    location_detail,
    resident_user_id,
    photo_paths,
    issue_category,
    issue_headline,
    entry_ok_if_absent,
    severity,
    estimated_minutes,
    due_at,
    vendor_work_status,
    resident_availability_text,
    resident_reported_recurring
  ) values (
    p_landlord_id,
    coalesce(p_ticket->>'priority', 'normal'),
    coalesce(p_ticket->>'urgency', 'normal'),
    coalesce(p_ticket->>'resident_name', 'Resident'),
    coalesce(p_ticket->>'email', ''),
    p_ticket->>'resident_phone',
    coalesce(p_ticket->>'unit', ''),
    coalesce(p_ticket->>'description', ''),
    p_ticket->>'room',
    p_ticket->>'location_detail',
    nullif(p_ticket->>'resident_user_id', '')::uuid,
    coalesce(
      (
        select array_agg(value)
        from jsonb_array_elements_text(coalesce(p_ticket->'photo_paths', '[]'::jsonb)) as value
      ),
      '{}'::text[]
    ),
    p_ticket->>'issue_category',
    p_ticket->>'issue_headline',
    coalesce((p_ticket->>'entry_ok_if_absent')::boolean, false),
    p_ticket->>'severity',
    nullif(p_ticket->>'estimated_minutes', '')::integer,
    nullif(p_ticket->>'due_at', '')::timestamptz,
    'unassigned',
    p_ticket->>'resident_availability_text',
    coalesce((p_ticket->>'resident_reported_recurring')::boolean, false)
  )
  returning id into created_id;

  update public.sms_conversations
  set maintenance_request_id = created_id,
      intake_state = coalesce(intake_state, '{}'::jsonb)
        || jsonb_build_object('draft_ticket_id', created_id),
      updated_at = clock_timestamp()
  where id = p_conversation_id
    and landlord_id = p_landlord_id;

  return jsonb_build_object('id', created_id, 'created', true);
end;
$$;

revoke all on function public.claim_sms_intake_draft(uuid, uuid, text, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_sms_intake_draft(uuid, uuid, text, boolean, jsonb)
  to service_role;
