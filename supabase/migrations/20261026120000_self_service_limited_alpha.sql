-- Unique self-service tenants. No seeded landlord or payment configuration changes.
create table public.limited_alpha_signup_profiles (
  owner_user_id uuid primary key references auth.users(id),
  landlord_id uuid not null unique references public.landlords(id),
  alpha_number bigint generated always as identity (start with 3) unique,
  status text not null default 'onboarding' check (status in ('onboarding', 'active')),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  check (landlord_id::text ~ '^a13a0000-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
);
alter table public.limited_alpha_signup_profiles enable row level security;
grant select on public.limited_alpha_signup_profiles to authenticated;
create policy limited_alpha_signup_owner_read on public.limited_alpha_signup_profiles
  for select to authenticated using (owner_user_id = auth.uid());

create or replace function public.ensure_my_limited_alpha_profile()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  verified_email text;
  target uuid;
  profile public.limited_alpha_signup_profiles%rowtype;
begin
  if actor is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  -- Lock the verified Auth identity, serializing retries/tabs for this user.
  select lower(trim(email)) into verified_email from auth.users
    where id = actor and email_confirmed_at is not null for update;
  if verified_email is null or verified_email = '' then
    raise exception 'Verify your email before creating a profile' using errcode = '42501';
  end if;
  select * into profile from public.limited_alpha_signup_profiles where owner_user_id = actor;
  if found then
    return jsonb_build_object('landlord_id', profile.landlord_id, 'label', 'Limited Alpha ' || profile.alpha_number, 'status', profile.status);
  end if;
  -- Existing members retain their account; signup never copies/reassigns a portfolio.
  select landlord_id into target from public.landlord_portal_members where lower(email) = verified_email;
  if target is not null then
    return jsonb_build_object('landlord_id', target, 'status', 'existing');
  end if;
  if public.is_platform_staff() then raise exception 'Staff already have portal access' using errcode = '42501'; end if;
  target := ('a13a0000-' || substring(gen_random_uuid()::text from 10))::uuid;
  insert into public.landlords(id, name, email, is_demo)
    values (target, 'New Limited Alpha', verified_email, false);
  insert into public.limited_alpha_signup_profiles(owner_user_id, landlord_id)
    values (actor, target) returning * into profile;
  update public.landlords set name = 'Limited Alpha ' || profile.alpha_number where id = target;
  insert into public.landlord_portal_members(landlord_id, email, role)
    values (target, verified_email, 'team_member');
  insert into public.landlord_onboarding(landlord_id, onboarding_status, current_step)
    values (target, 'not_started', 'account_setup');
  return jsonb_build_object('landlord_id', target, 'label', 'Limited Alpha ' || profile.alpha_number, 'status', profile.status);
end;
$$;
revoke all on function public.ensure_my_limited_alpha_profile() from public;
grant execute on function public.ensure_my_limited_alpha_profile() to authenticated;

-- Preserve seeded-account behavior exactly; dynamic accounts require registry + ownership.
alter function public.can_mutate_onboarding_inventory(uuid) rename to can_mutate_onboarding_inventory_seeded;
revoke all on function public.can_mutate_onboarding_inventory_seeded(uuid) from public;
create or replace function public.can_mutate_onboarding_inventory(p_landlord_id uuid)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if exists(select 1 from public.limited_alpha_signup_profiles where landlord_id = p_landlord_id) then
    return coalesce(auth.jwt()->>'role', '') = 'service_role' or public.can_access_landlord(p_landlord_id);
  end if;
  return public.can_mutate_onboarding_inventory_seeded(p_landlord_id);
end;
$$;
revoke all on function public.can_mutate_onboarding_inventory(uuid) from public;
grant execute on function public.can_mutate_onboarding_inventory(uuid) to authenticated, service_role;

create or replace function public.activate_completed_limited_alpha_profile()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.onboarding_status = 'completed' then
    update public.limited_alpha_signup_profiles set status = 'active', activated_at = coalesce(activated_at, now())
      where landlord_id = new.landlord_id;
  end if;
  return new;
end;
$$;
revoke all on function public.activate_completed_limited_alpha_profile() from public;
create trigger activate_completed_limited_alpha_profile
  after insert or update of onboarding_status on public.landlord_onboarding
  for each row execute function public.activate_completed_limited_alpha_profile();
