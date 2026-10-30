-- Pure helper checks for landlord-scoped RLS (no live JWT).
-- Run against a DB after migration 20261021120000_landlord_scoped_rls.sql.
begin;

do $$
begin
  if to_regprocedure('public.seeded_landlord_id_for_email(text)') is null then
    raise exception 'seeded_landlord_id_for_email missing — apply 20261021120000_landlord_scoped_rls';
  end if;
  if public.seeded_landlord_id_for_email('limitedalpha1@ulohome.io')
     is distinct from 'de300000-0000-4000-8000-000000000003'::uuid then
    raise exception 'LA1 seeded map mismatch';
  end if;
  if public.seeded_landlord_id_for_email('limitedalpha2@ulohome.io')
     is distinct from 'de300000-0000-4000-8000-000000000004'::uuid then
    raise exception 'LA2 seeded map mismatch';
  end if;
  if public.seeded_landlord_id_for_email('limitedalpha3@ulohome.io')
     is distinct from 'de300000-0000-4000-8000-000000000005'::uuid then
    raise exception 'LA3 seeded map mismatch';
  end if;
  if public.seeded_landlord_id_for_email('demo@ulohome.io')
     is distinct from 'de300000-0000-4000-8000-000000000001'::uuid then
    raise exception 'Demo seeded map mismatch';
  end if;
  if public.seeded_landlord_id_for_email('stranger@example.com') is not null then
    raise exception 'Unknown email must not map';
  end if;
  raise notice 'landlord_scoped_rls helper checks passed';
end $$;

rollback;
