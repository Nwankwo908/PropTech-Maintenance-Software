-- Wipe legacy/demo portfolio data and prepare Alpha as a real empty account.
-- Run after migrations (includes purge_landlord_portfolio from 20260731240000).
--
--   psql "$DATABASE_URL" -f supabase/seed_alpha_account_reset.sql
--
-- Or: node scripts/setup-alpha-account.mjs

do $$
declare
  alpha_id constant uuid := '068daf53-07e4-4493-bd7f-6106e3c8c62f';
  demo_id constant uuid := 'de300000-0000-4000-8000-000000000001';
  result jsonb;
begin
  if to_regprocedure('public.purge_landlord_portfolio(uuid)') is null then
    raise exception 'purge_landlord_portfolio missing — run supabase db push first';
  end if;

  select public.purge_landlord_portfolio(demo_id) into result;
  raise notice 'Demo portfolio purged: %', result;

  select public.purge_landlord_portfolio(alpha_id) into result;
  raise notice 'Alpha portfolio purged: %', result;

  update public.landlords
  set
    name = 'Full Alpha',
    email = 'ceorentalsnj@gmail.com',
    is_demo = false
  where id = alpha_id;

  raise notice 'Alpha account ready — empty portfolio for %', alpha_id;
end $$;
