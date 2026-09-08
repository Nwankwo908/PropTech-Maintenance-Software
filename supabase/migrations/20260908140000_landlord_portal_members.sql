-- Team members on a landlord account can sign in to the same portal
-- and receive the same operational SMS/email as the account holder.

create table if not exists public.landlord_portal_members (
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  email text not null,
  full_name text,
  phone text,
  role text not null default 'team_member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (landlord_id, email),
  constraint landlord_portal_members_email_format
    check (position('@' in email) > 1),
  constraint landlord_portal_members_role_check
    check (role = 'team_member')
);

create unique index if not exists landlord_portal_members_email_lower
  on public.landlord_portal_members (lower(email));

comment on table public.landlord_portal_members is
  'Extra dashboard logins for a landlord account (onboarding team member).';

grant select, insert, update, delete on public.landlord_portal_members to authenticated;

alter table public.landlord_portal_members enable row level security;

drop policy if exists landlord_portal_members_staff_all on public.landlord_portal_members;
create policy landlord_portal_members_staff_all
  on public.landlord_portal_members
  for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create or replace function public.landlord_id_for_portal_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.landlord_id
  from public.landlord_portal_members m
  where lower(m.email) = lower(trim(coalesce(p_email, '')))
  limit 1;
$$;

comment on function public.landlord_id_for_portal_email(text) is
  'Lookup landlord id for a team-member portal email. Used at login (anon).';

revoke all on function public.landlord_id_for_portal_email(text) from public;
grant execute on function public.landlord_id_for_portal_email(text) to anon, authenticated;

-- SECURITY DEFINER so is_staff_admin can include members without RLS recursion.
create or replace function public.is_landlord_portal_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.landlord_portal_members m
    where lower(m.email) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  );
$$;

revoke all on function public.is_landlord_portal_member() from public;
grant execute on function public.is_landlord_portal_member() to authenticated;

create or replace function public.is_staff_admin()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select lower(trim(coalesce(auth.jwt() ->> 'email', ''))) ilike '%@property-admin.auth.local'
    or lower(trim(coalesce(auth.jwt() ->> 'email', ''))) in (
      'emeka@ulohome.io',
      'osi@ulohome.io',
      'demo@ulohome.io',
      'newlandlord@ulohome.io',
      'limitedalpha1@ulohome.io',
      'limitedalpha2@ulohome.io',
      'ceorentalsnj@gmail.com'
    )
    or public.is_landlord_portal_member();
$$;

comment on function public.is_staff_admin() is
  'True when the signed-in user is property staff, an allowlisted landlord portal account, or a team member on that account.';
