-- Reliable resident activation SMS retries + landlord-facing activation status.

alter table public.users
  add column if not exists activation_status text,
  add column if not exists activation_attempt_count integer not null default 0,
  add column if not exists first_activation_attempt_at timestamptz,
  add column if not exists last_activation_attempt_at timestamptz,
  add column if not exists last_delivery_error text,
  add column if not exists activation_phone_normalized text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_activation_status_check'
  ) then
    alter table public.users
      add constraint users_activation_status_check
      check (
        activation_status is null
        or activation_status in (
          'not_started',
          'waiting',
          'delivery_failed',
          'action_required',
          'activated',
          'opted_out'
        )
      );
  end if;
end $$;

comment on column public.users.activation_status is
  'Tenant onboarding SMS: not_started | waiting | delivery_failed | action_required | activated | opted_out.';
comment on column public.users.activation_attempt_count is
  'Welcome SMS delivery attempts (max 3 automatic). Manual resend restarts the sequence.';
comment on column public.users.first_activation_attempt_at is
  'Timestamp of attempt 1 — retry schedule is T+24h and T+72h from this.';
comment on column public.users.last_activation_attempt_at is
  'Timestamp of the most recent welcome SMS attempt.';
comment on column public.users.last_delivery_error is
  'Last delivery failure reason (cleared on successful send / opt-in).';
comment on column public.users.activation_phone_normalized is
  'E.164-ish digits used for the last attempt; auto-retry stops if phone changes.';

-- Backfill from existing consent columns.
update public.users
set activation_status = case
  when sms_consent_status = 'opted_in' then 'activated'
  when sms_consent_status = 'opted_out' then 'opted_out'
  when activation_sms_sent_at is not null then 'waiting'
  else coalesce(activation_status, 'not_started')
end
where activation_status is null
   or (
     activation_status = 'not_started'
     and (
       sms_consent_status in ('opted_in', 'opted_out')
       or activation_sms_sent_at is not null
     )
   );

create table if not exists public.tenant_activation_attempts (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  resident_id uuid not null references public.users (id) on delete cascade,
  attempt_number integer not null,
  phone text,
  delivery_status text not null,
  failure_reason text,
  message_id text,
  conversation_id uuid,
  created_at timestamptz not null default now(),
  constraint tenant_activation_attempts_delivery_check
    check (delivery_status in ('sent', 'failed', 'skipped')),
  constraint tenant_activation_attempts_number_check
    check (attempt_number >= 1 and attempt_number <= 10)
);

create index if not exists tenant_activation_attempts_resident_idx
  on public.tenant_activation_attempts (resident_id, created_at desc);

create index if not exists tenant_activation_attempts_landlord_idx
  on public.tenant_activation_attempts (landlord_id, created_at desc);

create index if not exists users_activation_retry_idx
  on public.users (landlord_id, activation_status, first_activation_attempt_at)
  where activation_status = 'delivery_failed';

comment on table public.tenant_activation_attempts is
  'Audit log of tenant welcome SMS attempts (timestamp, status, reason, retry number).';

alter table public.tenant_activation_attempts enable row level security;

drop policy if exists tenant_activation_attempts_select_staff
  on public.tenant_activation_attempts;
create policy tenant_activation_attempts_select_staff
  on public.tenant_activation_attempts
  for select
  to authenticated
  using (public.is_staff_admin());
