-- Structured SMS maintenance intake state (one question at a time).
alter table public.sms_conversations
  add column if not exists intake_state jsonb not null default '{}'::jsonb;

comment on column public.sms_conversations.intake_state is
  'Partial maintenance intake answers for resident SMS threads (issue_type, room, urgency, etc.).';

create index if not exists sms_conversations_intake_state_gin_idx
  on public.sms_conversations using gin (intake_state);
