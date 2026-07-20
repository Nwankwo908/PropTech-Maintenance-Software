-- Link vendor verification invites to the SMS conversation so form submit
-- can append an inbound reply in the Communication inbox.

alter table public.vendor_verifications
  add column if not exists invite_conversation_id uuid;

comment on column public.vendor_verifications.invite_conversation_id is
  'SMS conversation opened when the verification invite was sent; used to mirror form submit into the inbox.';

create index if not exists vendor_verifications_invite_conversation_id_idx
  on public.vendor_verifications (invite_conversation_id)
  where invite_conversation_id is not null;
