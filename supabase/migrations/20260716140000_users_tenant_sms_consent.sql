-- Tenant SMS activation + consent state (post-onboarding welcome flow).
-- One workflow engine still owns delivery; these columns are the compliance ledger
-- for the tenant-facing activation SMS (welcome → YES confirmation → STOP suppression).
alter table public.users
  add column if not exists sms_consent_status text,
  add column if not exists sms_consent_at timestamptz,
  add column if not exists sms_opt_out_at timestamptz,
  add column if not exists activation_sms_sent_at timestamptz;

update public.users
  set sms_consent_status = coalesce(sms_consent_status, 'pending');

alter table public.users
  alter column sms_consent_status set default 'pending';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_sms_consent_status_check'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_sms_consent_status_check
      check (
        sms_consent_status is null
        or sms_consent_status in ('pending', 'opted_in', 'opted_out')
      );
  end if;
end $$;

comment on column public.users.sms_consent_status is
  'Tenant SMS consent state: pending (welcome sent, awaiting YES), opted_in (confirmed), opted_out (STOP).';
comment on column public.users.sms_consent_at is
  'Timestamp the tenant confirmed SMS consent (replied YES).';
comment on column public.users.sms_opt_out_at is
  'Timestamp the tenant opted out of SMS (replied STOP).';
comment on column public.users.activation_sms_sent_at is
  'Timestamp the post-onboarding activation/welcome SMS was sent to the tenant.';
