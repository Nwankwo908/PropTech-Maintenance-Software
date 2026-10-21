-- Ask Ulo daily-priorities outbound lists + reply action bindings.
-- Reply tokens (e.g. "1", "102 YES") bind to these rows — never to a re-ranked list.

create table if not exists public.ask_ulo_priority_lists (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  actor_role text not null check (actor_role in ('landlord', 'tenant')),
  actor_user_id uuid,
  actor_resident_id uuid,
  conversation_id uuid,
  channel text not null check (channel in ('sms', 'chat')),
  time_zone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  superseded_at timestamptz,
  status text not null default 'open'
    check (status in ('open', 'superseded', 'closed')),
  partial_sources jsonb not null default '[]'::jsonb
);

create index if not exists ask_ulo_priority_lists_open_idx
  on public.ask_ulo_priority_lists (landlord_id, channel, status, created_at desc);

create index if not exists ask_ulo_priority_lists_conversation_idx
  on public.ask_ulo_priority_lists (conversation_id, status, created_at desc)
  where conversation_id is not null;

comment on table public.ask_ulo_priority_lists is
  'Persisted Ask Ulo daily-priorities outbound list for SMS/chat reply binding.';

create table if not exists public.ask_ulo_priority_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.ask_ulo_priority_lists (id) on delete cascade,
  position integer not null check (position >= 1 and position <= 5),
  category text not null
    check (category in ('emergency', 'deadline', 'approval', 'visit_today')),
  entity_type text not null
    check (entity_type in ('maintenance_request', 'inspection', 'estimate', 'appointment')),
  entity_id uuid not null,
  display_id integer,
  offered_action text not null
    check (offered_action in ('assign', 'approve', 'confirm_location', 'none')),
  reply_token text not null,
  snapshot jsonb not null,
  executed_at timestamptz,
  unique (list_id, position),
  unique (list_id, reply_token)
);

create index if not exists ask_ulo_priority_list_items_entity_idx
  on public.ask_ulo_priority_list_items (entity_type, entity_id);

comment on table public.ask_ulo_priority_list_items is
  'Canonical action bindings for one Ask Ulo daily-priorities list position.';

alter table public.ask_ulo_priority_lists enable row level security;
alter table public.ask_ulo_priority_list_items enable row level security;
