-- Phones explicitly disconnected from an account. Inbound routing must not
-- treat later-preserved messages or closed threads as a reason to restore
-- that account. A new explicit assignment on the same account is still current.

create table if not exists public.sms_phone_account_disconnects (
  phone_number text not null,
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  disconnected_at timestamptz not null default now(),
  primary key (phone_number, landlord_id)
);

comment on table public.sms_phone_account_disconnects is
  'Phone numbers removed from an account. Historical SMS must not route them back.';

alter table public.sms_phone_account_disconnects enable row level security;

revoke all on table public.sms_phone_account_disconnects from anon, authenticated;
