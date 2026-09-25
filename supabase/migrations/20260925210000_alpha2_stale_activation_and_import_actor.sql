-- Stop leftover Limited Alpha 2 welcome follow-ups from a prior import session,
-- and record who initiated future onboarding resident imports.

-- Jesus Bruno Gonzales + Sebastian Natal: Sep 20 ONB import, still waiting.
update public.users
set
  activation_status = 'not_started',
  activation_attempt_count = 0,
  activation_sms_sent_at = null,
  first_activation_attempt_at = null,
  last_activation_attempt_at = null,
  last_delivery_error = null,
  activation_phone_normalized = null
where landlord_id = 'de300000-0000-4000-8000-000000000004'
  and id in (
    'eb64951f-de04-427c-a1ff-4a056b23a783',
    '67beec73-0ded-4db8-b8e4-6474db811832'
  )
  and coalesce(activation_status, '') = 'waiting';

alter table public.users
  add column if not exists imported_by_user_id uuid,
  add column if not exists imported_by_email text,
  add column if not exists import_session_id text,
  add column if not exists imported_at timestamptz;

comment on column public.users.imported_by_user_id is
  'Auth user id that initiated the onboarding import which created/updated this resident.';
comment on column public.users.imported_by_email is
  'Login email for the session that initiated the onboarding import.';
comment on column public.users.import_session_id is
  'Auth session id (or access-token fingerprint) for the import session.';
comment on column public.users.imported_at is
  'When this resident row was last written by an onboarding import.';
