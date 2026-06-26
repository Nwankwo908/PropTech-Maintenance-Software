-- Landlord onboarding settings: wizard progress, Ulo phone, approval rules, notifications.
-- Scoped per landlord; used by the New Landlord showcase account onboarding flow.

create table if not exists public.landlord_onboarding (
  landlord_id uuid primary key references public.landlords (id) on delete cascade,
  onboarding_status text not null default 'not_started'
    check (onboarding_status in ('not_started', 'in_progress', 'completed')),
  current_step text,
  ulo_phone_number text,
  auto_approval_threshold numeric(12, 2) not null default 250,
  emergency_types text[] not null default array[
    'no_heat',
    'no_hot_water',
    'flood_active_leak',
    'no_power',
    'gas_smell',
    'security_breach'
  ],
  after_hours_rule text not null default 'auto_approve_emergencies'
    check (
      after_hours_rule in (
        'auto_approve_emergencies',
        'require_approval',
        'no_after_hours'
      )
    ),
  notification_preference text not null default 'urgent_only'
    check (notification_preference in ('all_jobs', 'urgent_only', 'daily_digest')),
  notification_channel text not null default 'both'
    check (notification_channel in ('sms', 'email', 'both')),
  emergency_contact jsonb not null default '{}'::jsonb,
  properties jsonb not null default '[]'::jsonb,
  draft_state jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.landlord_onboarding is
  'Onboarding wizard state, Ulo phone assignment, maintenance approval rules, and notification prefs per landlord.';

create index if not exists landlord_onboarding_status_idx
  on public.landlord_onboarding (onboarding_status);

alter table public.landlord_onboarding enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'landlord_onboarding'
      and policyname = 'landlord_onboarding_staff_all'
  ) then
    create policy landlord_onboarding_staff_all
      on public.landlord_onboarding
      for all
      to authenticated
      using (public.is_staff_admin())
      with check (public.is_staff_admin());
  end if;
end $$;

-- New Landlord showcase account starts with no onboarding row (empty = not_started).
