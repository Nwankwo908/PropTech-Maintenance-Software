-- Get Started tells the landlord what Factory reset does when live portfolio
-- records must stay in place until that reset.

create or replace function public.start_fresh_onboarding_run(
  p_landlord_id uuid,
  p_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session text := trim(coalesce(p_session_id, ''));
  v_started timestamptz := now();
  v_draft jsonb;
begin
  if v_session = '' then
    raise exception 'onboarding session id is required';
  end if;

  if not public.can_mutate_onboarding_inventory(p_landlord_id) then
    raise exception 'not authorized for onboarding inventory on landlord %', p_landlord_id;
  end if;

  if public.onboarding_inventory_has_unsafe_ops(p_landlord_id) then
    raise exception
      using message = 'Factory reset deletes your portfolio data and returns you to setup so you can upload documents again.',
           errcode = 'P0001';
  end if;

  -- Lock onboarding row (create shell if missing)
  insert into public.landlord_onboarding (landlord_id, onboarding_status, current_step)
  values (p_landlord_id, 'in_progress', 'entry')
  on conflict (landlord_id) do nothing;

  perform 1
  from public.landlord_onboarding
  where landlord_id = p_landlord_id
  for update;

  -- Clear occupancy then residents then units then properties (vendors untouched)
  delete from public.occupancy where landlord_id = p_landlord_id;
  delete from public.users where landlord_id = p_landlord_id;
  delete from public.units where landlord_id = p_landlord_id;
  delete from public.properties where landlord_id = p_landlord_id;
  delete from public.onboarding_import_keys where landlord_id = p_landlord_id;

  select draft_state into v_draft
  from public.landlord_onboarding
  where landlord_id = p_landlord_id;

  v_draft := coalesce(v_draft, '{}'::jsonb)
    - 'extractionReview'
    - 'uploadDocuments'
    - 'propertyForms'
    - 'residentForms';

  update public.landlord_onboarding
  set
    onboarding_status = 'in_progress',
    completed_at = null,
    onboarding_session_id = v_session,
    onboarding_session_started_at = v_started,
    properties = '[]'::jsonb,
    draft_state = v_draft,
    updated_at = v_started
  where landlord_id = p_landlord_id;

  return jsonb_build_object(
    'session_id', v_session,
    'started_at', v_started,
    'landlord_id', p_landlord_id
  );
end;
$$;

