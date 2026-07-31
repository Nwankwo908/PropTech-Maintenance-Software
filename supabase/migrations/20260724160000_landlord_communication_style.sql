-- Landlord communication style preference (onboarding + settings).

alter table public.landlords
  add column if not exists communication_style text not null default 'calm_professional';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'landlords_communication_style_check'
      and conrelid = 'public.landlords'::regclass
  ) then
    alter table public.landlords
      add constraint landlords_communication_style_check
      check (
        communication_style in (
          'calm_professional',
          'friendly_conversational',
          'direct_action_oriented'
        )
      );
  end if;
end $$;

comment on column public.landlords.communication_style is
  'Tone for Ulo-generated operational SMS/email: calm_professional | friendly_conversational | direct_action_oriented.';

alter table public.landlord_onboarding
  add column if not exists communication_style text not null default 'calm_professional';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'landlord_onboarding_communication_style_check'
      and conrelid = 'public.landlord_onboarding'::regclass
  ) then
    alter table public.landlord_onboarding
      add constraint landlord_onboarding_communication_style_check
      check (
        communication_style in (
          'calm_professional',
          'friendly_conversational',
          'direct_action_oriented'
        )
      );
  end if;
end $$;

comment on column public.landlord_onboarding.communication_style is
  'Communication style selected during onboarding; mirrored to landlords.communication_style on complete.';
