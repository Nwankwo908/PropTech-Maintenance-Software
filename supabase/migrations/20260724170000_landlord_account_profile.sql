-- Landlord account profile fields from onboarding Account setup.
-- Company name → landlords.name; contact email/phone; staff can update.

alter table public.landlords
  add column if not exists phone text,
  add column if not exists contact_name text;

comment on column public.landlords.phone is
  'Primary ops contact phone from onboarding / organization settings.';
comment on column public.landlords.contact_name is
  'Primary contact person name from onboarding Account setup.';

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'landlords'
      and policyname = 'landlords_update_staff'
  ) then
    create policy landlords_update_staff
      on public.landlords
      for update
      to authenticated
      using (public.is_staff_admin())
      with check (public.is_staff_admin());
  end if;
end $$;
