-- Ask Ulo conversation persistence (ChatGPT-style threads for logged-in staff).
-- Future-ready: pinned, starred, metadata for sharing/attachments/property scope.

create table if not exists public.ask_ulo_conversations (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  auth_user_id uuid not null,
  title text not null default 'New chat',
  pinned boolean not null default false,
  starred boolean not null default false,
  archived_at timestamptz,
  -- Future: property_id, shared_with, export metadata, memory prefs
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ask_ulo_conversations is
  'Ask Ulo chat threads scoped to staff auth user + landlord. Guest sessions are ephemeral (not stored).';

create index if not exists ask_ulo_conversations_user_updated_idx
  on public.ask_ulo_conversations (auth_user_id, updated_at desc)
  where archived_at is null;

create index if not exists ask_ulo_conversations_landlord_updated_idx
  on public.ask_ulo_conversations (landlord_id, updated_at desc)
  where archived_at is null;

create table if not exists public.ask_ulo_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.ask_ulo_conversations (id) on delete cascade,
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  tools_used jsonb not null default '[]'::jsonb,
  model text,
  -- Future: attachments[], property_id, starred_response
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.ask_ulo_messages is
  'Ask Ulo message history within a conversation. Written by authenticated staff or service role.';

create index if not exists ask_ulo_messages_conversation_created_idx
  on public.ask_ulo_messages (conversation_id, created_at asc);

create or replace function public.touch_ask_ulo_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ask_ulo_conversations
  set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists ask_ulo_messages_touch_conversation on public.ask_ulo_messages;
create trigger ask_ulo_messages_touch_conversation
  after insert on public.ask_ulo_messages
  for each row
  execute function public.touch_ask_ulo_conversation();

alter table public.ask_ulo_conversations enable row level security;
alter table public.ask_ulo_messages enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ask_ulo_conversations'
      and policyname = 'ask_ulo_conversations_staff_own'
  ) then
    create policy ask_ulo_conversations_staff_own
      on public.ask_ulo_conversations
      for all
      to authenticated
      using (
        public.is_staff_admin()
        and auth_user_id = auth.uid()
      )
      with check (
        public.is_staff_admin()
        and auth_user_id = auth.uid()
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ask_ulo_messages'
      and policyname = 'ask_ulo_messages_staff_own'
  ) then
    create policy ask_ulo_messages_staff_own
      on public.ask_ulo_messages
      for all
      to authenticated
      using (
        public.is_staff_admin()
        and exists (
          select 1
          from public.ask_ulo_conversations c
          where c.id = conversation_id
            and c.auth_user_id = auth.uid()
        )
      )
      with check (
        public.is_staff_admin()
        and exists (
          select 1
          from public.ask_ulo_conversations c
          where c.id = conversation_id
            and c.auth_user_id = auth.uid()
        )
      );
  end if;
end $$;

grant select, insert, update, delete on public.ask_ulo_conversations to authenticated;
grant select, insert, update, delete on public.ask_ulo_messages to authenticated;
grant all on public.ask_ulo_conversations to service_role;
grant all on public.ask_ulo_messages to service_role;
