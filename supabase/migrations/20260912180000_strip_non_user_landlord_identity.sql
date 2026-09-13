-- Strip seeded / sample landlord identity that was never typed by a landlord.
-- Demo showcase accounts are left unchanged.

do $$
declare
  placeholders text[] := array[
    'new landlord',
    'limited alpha 1',
    'limited alpha 2',
    'demo property management',
    'ulo operations',
    'your portfolio',
    'your company',
    'ulo',
    'ulo home',
    'ulo home, inc',
    'ulo home inc',
    'kendo',
    'kendo homes',
    'kendo properties',
    'kendo properties llc'
  ];
begin
  update public.landlords
  set display_name = null
  where coalesce(is_demo, false) = false
    and display_name is not null
    and lower(trim(display_name)) = any (placeholders);

  update public.landlords
  set name = case
    when nullif(trim(coalesce(contact_name, '')), '') is not null
      then trim(contact_name) || ' properties'
    else 'New Landlord'
  end
  where coalesce(is_demo, false) = false
    and lower(trim(name)) = any (placeholders);

  update public.landlord_onboarding o
  set account_settings = jsonb_set(
    coalesce(o.account_settings, '{}'::jsonb),
    '{organization,displayName}',
    '""'::jsonb,
    true
  )
  from public.landlords l
  where o.landlord_id = l.id
    and coalesce(l.is_demo, false) = false
    and lower(trim(coalesce(o.account_settings #>> '{organization,displayName}', ''))) = any (placeholders);

  update public.landlord_onboarding o
  set account_settings = jsonb_set(
    coalesce(o.account_settings, '{}'::jsonb),
    '{organization,legalName}',
    '""'::jsonb,
    true
  )
  from public.landlords l
  where o.landlord_id = l.id
    and coalesce(l.is_demo, false) = false
    and lower(trim(coalesce(o.account_settings #>> '{organization,legalName}', ''))) = any (placeholders);

  update public.landlord_onboarding o
  set draft_state = jsonb_set(
    coalesce(o.draft_state, '{}'::jsonb),
    '{organizationSettings,displayName}',
    '""'::jsonb,
    true
  )
  from public.landlords l
  where o.landlord_id = l.id
    and coalesce(l.is_demo, false) = false
    and lower(trim(coalesce(o.draft_state #>> '{organizationSettings,displayName}', ''))) = any (placeholders);

  update public.landlord_onboarding o
  set draft_state = jsonb_set(
    coalesce(o.draft_state, '{}'::jsonb),
    '{organizationSettings,legalName}',
    '""'::jsonb,
    true
  )
  from public.landlords l
  where o.landlord_id = l.id
    and coalesce(l.is_demo, false) = false
    and lower(trim(coalesce(o.draft_state #>> '{organizationSettings,legalName}', ''))) = any (placeholders);

  update public.landlord_onboarding o
  set draft_state = jsonb_set(
    coalesce(o.draft_state, '{}'::jsonb),
    '{accountSetup,companyName}',
    '""'::jsonb,
    true
  )
  from public.landlords l
  where o.landlord_id = l.id
    and coalesce(l.is_demo, false) = false
    and lower(trim(coalesce(o.draft_state #>> '{accountSetup,companyName}', ''))) = any (placeholders);
end $$;
