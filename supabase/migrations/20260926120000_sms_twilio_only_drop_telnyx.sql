-- Twilio is the only SMS provider. Remove Telnyx from live schema/data.
-- Do not rewrite older migrations; this migration is the cutover.

-- Historical rows may still say provider = 'telnyx'. Rewrite before tightening checks.
update public.sms_messages
set provider = 'twilio'
where lower(coalesce(provider, '')) = 'telnyx';

update public.sms_numbers
set provider = 'twilio'
where lower(coalesce(provider, '')) = 'telnyx';

delete from public.sms_providers
where name = 'telnyx';

alter table public.sms_providers
  drop constraint if exists sms_providers_name_check;

alter table public.sms_providers
  add constraint sms_providers_name_check
  check (name in ('twilio'));

comment on table public.sms_providers is
  'SMS delivery providers (twilio). Config holds non-secret metadata; secrets stay in Edge env.';

alter table public.sms_numbers
  drop constraint if exists sms_numbers_provider_check;

alter table public.sms_numbers
  add constraint sms_numbers_provider_check
  check (provider in ('twilio'));

alter table public.sms_messages
  drop constraint if exists sms_messages_provider_check;

alter table public.sms_messages
  add constraint sms_messages_provider_check
  check (provider in ('twilio'));
