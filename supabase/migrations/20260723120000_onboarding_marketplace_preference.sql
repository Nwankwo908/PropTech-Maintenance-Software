-- Marketplace preference for maintenance dispatch during onboarding approval rules.

alter table public.landlord_onboarding
  add column if not exists marketplace_preference text;

update public.landlord_onboarding
set marketplace_preference = 'include_imported'
where marketplace_preference is null;

alter table public.landlord_onboarding
  alter column marketplace_preference set default 'include_imported';

alter table public.landlord_onboarding
  alter column marketplace_preference set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'landlord_onboarding_marketplace_preference_check'
  ) then
    alter table public.landlord_onboarding
      add constraint landlord_onboarding_marketplace_preference_check
      check (
        marketplace_preference in ('ulo_vetted_only', 'include_imported')
      );
  end if;
end $$;

comment on column public.landlord_onboarding.marketplace_preference is
  'Dispatch pool: ulo_vetted_only | include_imported (roster vendors). Set during onboarding approval rules.';
