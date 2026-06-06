-- SMS provider abstraction, numbering, identities, conversations, messages, and ops graph events.
-- Writes from Edge Functions (service role); authenticated staff read/write config tables;
-- vendor portal read access scoped to assigned tickets / vendor-owned rows.

-- ---------------------------------------------------------------------------
-- 1. sms_providers
-- ---------------------------------------------------------------------------

create table if not exists public.sms_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint sms_providers_name_key unique (name),
  constraint sms_providers_name_check
    check (name in ('twilio', 'telnyx'))
);

comment on table public.sms_providers is
  'SMS delivery providers (twilio, telnyx). Config holds non-secret metadata; secrets stay in Edge env.';

alter table public.sms_providers enable row level security;

create policy sms_providers_select_staff
  on public.sms_providers
  for select
  to authenticated
  using (public.is_staff_admin());

create policy sms_providers_insert_staff
  on public.sms_providers
  for insert
  to authenticated
  with check (public.is_staff_admin());

create policy sms_providers_update_staff
  on public.sms_providers
  for update
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create policy sms_providers_delete_staff
  on public.sms_providers
  for delete
  to authenticated
  using (public.is_staff_admin());

insert into public.sms_providers (name, active, config)
values
  ('twilio', false, '{}'::jsonb),
  ('telnyx', false, '{}'::jsonb)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 2. sms_numbers
-- ---------------------------------------------------------------------------

create table if not exists public.sms_numbers (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid,
  vendor_id uuid references public.vendors (id) on delete set null,
  phone_number text not null,
  provider text not null,
  provider_number_sid text,
  provider_messaging_service_sid text,
  status text not null default 'active',
  purpose text not null,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  constraint sms_numbers_phone_number_key unique (phone_number),
  constraint sms_numbers_status_check
    check (status in ('active', 'released', 'porting', 'pending', 'failed')),
  constraint sms_numbers_purpose_check
    check (purpose in ('landlord_main', 'vendor_main', 'pool')),
  constraint sms_numbers_provider_check
    check (provider in ('twilio', 'telnyx'))
);

comment on table public.sms_numbers is
  'Provisioned SMS numbers per landlord, vendor, or shared pool. landlord_id reserved for future landlords table.';
comment on column public.sms_numbers.landlord_id is
  'Future FK to landlords; nullable until landlords table exists.';

create index if not exists sms_numbers_landlord_id_idx
  on public.sms_numbers (landlord_id)
  where landlord_id is not null;

create index if not exists sms_numbers_vendor_id_idx
  on public.sms_numbers (vendor_id)
  where vendor_id is not null;

create index if not exists sms_numbers_phone_number_idx
  on public.sms_numbers (phone_number);

create index if not exists sms_numbers_created_at_idx
  on public.sms_numbers (created_at desc);

alter table public.sms_numbers enable row level security;

create policy sms_numbers_select_scoped
  on public.sms_numbers
  for select
  to authenticated
  using (
    public.is_staff_admin()
    or vendor_id in (select public.current_user_vendor_ids())
  );

create policy sms_numbers_insert_staff
  on public.sms_numbers
  for insert
  to authenticated
  with check (public.is_staff_admin());

create policy sms_numbers_update_staff
  on public.sms_numbers
  for update
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create policy sms_numbers_delete_staff
  on public.sms_numbers
  for delete
  to authenticated
  using (public.is_staff_admin());

-- ---------------------------------------------------------------------------
-- 3. sms_identities
-- ---------------------------------------------------------------------------

create table if not exists public.sms_identities (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid,
  resident_id uuid references public.users (id) on delete set null,
  vendor_id uuid references public.vendors (id) on delete set null,
  unit_id uuid,
  phone_number text not null,
  identity_type text not null,
  verified boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint sms_identities_phone_landlord_key unique (phone_number, landlord_id),
  constraint sms_identities_identity_type_check
    check (identity_type in ('resident', 'vendor', 'landlord', 'unknown'))
);

comment on table public.sms_identities is
  'Maps E.164 phone numbers to residents, vendors, or landlords within a landlord scope.';
comment on column public.sms_identities.unit_id is
  'Future FK to units; nullable until units table exists.';
comment on column public.sms_identities.landlord_id is
  'Landlord scope for multi-tenant graph; nullable for global unknown identities.';

create index if not exists sms_identities_landlord_id_idx
  on public.sms_identities (landlord_id)
  where landlord_id is not null;

create index if not exists sms_identities_resident_id_idx
  on public.sms_identities (resident_id)
  where resident_id is not null;

create index if not exists sms_identities_vendor_id_idx
  on public.sms_identities (vendor_id)
  where vendor_id is not null;

create index if not exists sms_identities_unit_id_idx
  on public.sms_identities (unit_id)
  where unit_id is not null;

create index if not exists sms_identities_phone_number_idx
  on public.sms_identities (phone_number);

create index if not exists sms_identities_first_seen_at_idx
  on public.sms_identities (first_seen_at desc);

create index if not exists sms_identities_last_seen_at_idx
  on public.sms_identities (last_seen_at desc);

alter table public.sms_identities enable row level security;

create policy sms_identities_select_scoped
  on public.sms_identities
  for select
  to authenticated
  using (
    public.is_staff_admin()
    or vendor_id in (select public.current_user_vendor_ids())
  );

-- Inserts/updates: Edge Function / service role only.

-- ---------------------------------------------------------------------------
-- 4. sms_conversations
-- ---------------------------------------------------------------------------

create table if not exists public.sms_conversations (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null,
  unit_id uuid,
  resident_id uuid references public.users (id) on delete set null,
  vendor_id uuid references public.vendors (id) on delete set null,
  maintenance_request_id uuid references public.maintenance_requests (id) on delete set null,
  sms_number_id uuid not null references public.sms_numbers (id) on delete restrict,
  external_phone_number text not null,
  conversation_type text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sms_conversations_conversation_type_check
    check (
      conversation_type in (
        'resident_intake',
        'vendor_alert',
        'vendor_tenant_proxy',
        'landlord_update'
      )
    )
);

comment on table public.sms_conversations is
  'Thread between an Ulo SMS number and an external phone, scoped to landlord and optional ticket graph nodes.';
comment on column public.sms_conversations.unit_id is
  'Future FK to units; nullable until units table exists.';

create index if not exists sms_conversations_landlord_id_idx
  on public.sms_conversations (landlord_id);

create index if not exists sms_conversations_unit_id_idx
  on public.sms_conversations (unit_id)
  where unit_id is not null;

create index if not exists sms_conversations_resident_id_idx
  on public.sms_conversations (resident_id)
  where resident_id is not null;

create index if not exists sms_conversations_vendor_id_idx
  on public.sms_conversations (vendor_id)
  where vendor_id is not null;

create index if not exists sms_conversations_maintenance_request_id_idx
  on public.sms_conversations (maintenance_request_id)
  where maintenance_request_id is not null;

create index if not exists sms_conversations_sms_number_id_idx
  on public.sms_conversations (sms_number_id);

create index if not exists sms_conversations_external_phone_number_idx
  on public.sms_conversations (external_phone_number);

create index if not exists sms_conversations_created_at_idx
  on public.sms_conversations (created_at desc);

create index if not exists sms_conversations_updated_at_idx
  on public.sms_conversations (updated_at desc);

-- ---------------------------------------------------------------------------
-- Helpers (after tables they reference; used by SMS RLS policies below)
-- ---------------------------------------------------------------------------

create or replace function public.vendor_can_access_maintenance_request(mr_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select mr_id is not null
    and exists (
      select 1
      from public.maintenance_requests mr
      where mr.id = mr_id
        and mr.assigned_vendor_id in (select public.current_user_vendor_ids())
    );
$$;

comment on function public.vendor_can_access_maintenance_request(uuid) is
  'True when the current vendor user is assigned to the maintenance request.';

grant execute on function public.vendor_can_access_maintenance_request(uuid) to authenticated;

create or replace function public.vendor_can_access_sms_conversation(conv_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.sms_conversations c
    where c.id = conv_id
      and (
        c.vendor_id in (select public.current_user_vendor_ids())
        or public.vendor_can_access_maintenance_request(c.maintenance_request_id)
      )
  );
$$;

comment on function public.vendor_can_access_sms_conversation(uuid) is
  'True when the conversation is tied to the vendor or an assigned ticket.';

grant execute on function public.vendor_can_access_sms_conversation(uuid) to authenticated;

alter table public.sms_conversations enable row level security;

create policy sms_conversations_select_scoped
  on public.sms_conversations
  for select
  to authenticated
  using (
    public.is_staff_admin()
    or vendor_id in (select public.current_user_vendor_ids())
    or public.vendor_can_access_maintenance_request(maintenance_request_id)
  );

create policy sms_conversations_update_staff
  on public.sms_conversations
  for update
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

-- Inserts: Edge Function / service role only.

-- ---------------------------------------------------------------------------
-- 5. sms_messages
-- ---------------------------------------------------------------------------

create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.sms_conversations (id) on delete cascade,
  landlord_id uuid not null,
  direction text not null,
  from_number text not null,
  to_number text not null,
  body text,
  media_urls text[] not null default '{}'::text[],
  provider text not null,
  provider_message_sid text,
  provider_status text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint sms_messages_direction_check
    check (direction in ('inbound', 'outbound')),
  constraint sms_messages_provider_check
    check (provider in ('twilio', 'telnyx'))
);

comment on table public.sms_messages is
  'Immutable log of inbound/outbound SMS payloads; provider_message_sid unique per provider when set.';

create unique index if not exists sms_messages_provider_sid_unique_idx
  on public.sms_messages (provider, provider_message_sid)
  where provider_message_sid is not null;

create index if not exists sms_messages_conversation_id_idx
  on public.sms_messages (conversation_id);

create index if not exists sms_messages_landlord_id_idx
  on public.sms_messages (landlord_id);

create index if not exists sms_messages_from_number_idx
  on public.sms_messages (from_number);

create index if not exists sms_messages_to_number_idx
  on public.sms_messages (to_number);

create index if not exists sms_messages_created_at_idx
  on public.sms_messages (created_at desc);

alter table public.sms_messages enable row level security;

create policy sms_messages_select_scoped
  on public.sms_messages
  for select
  to authenticated
  using (
    public.is_staff_admin()
    or public.vendor_can_access_sms_conversation(conversation_id)
  );

-- Inserts: Edge Function / service role only.

-- ---------------------------------------------------------------------------
-- 6. operations_graph_events
-- ---------------------------------------------------------------------------

create table if not exists public.operations_graph_events (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null,
  event_type text not null,
  source text not null,
  actor_type text,
  actor_id uuid,
  property_id uuid,
  unit_id uuid,
  resident_id uuid references public.users (id) on delete set null,
  vendor_id uuid references public.vendors (id) on delete set null,
  maintenance_request_id uuid references public.maintenance_requests (id) on delete set null,
  conversation_id uuid references public.sms_conversations (id) on delete set null,
  message_id uuid references public.sms_messages (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint operations_graph_events_source_check
    check (
      source in ('sms', 'dashboard', 'vendor_portal', 'edge_function', 'automation')
    ),
  constraint operations_graph_events_actor_type_check
    check (
      actor_type is null
      or actor_type in ('resident', 'vendor', 'landlord', 'system')
    )
);

comment on table public.operations_graph_events is
  'Append-only property operations graph nodes linking SMS, tickets, actors, and automation.';
comment on column public.operations_graph_events.property_id is
  'Future FK to properties; nullable until properties table exists.';

create index if not exists operations_graph_events_landlord_id_idx
  on public.operations_graph_events (landlord_id);

create index if not exists operations_graph_events_unit_id_idx
  on public.operations_graph_events (unit_id)
  where unit_id is not null;

create index if not exists operations_graph_events_resident_id_idx
  on public.operations_graph_events (resident_id)
  where resident_id is not null;

create index if not exists operations_graph_events_vendor_id_idx
  on public.operations_graph_events (vendor_id)
  where vendor_id is not null;

create index if not exists operations_graph_events_maintenance_request_id_idx
  on public.operations_graph_events (maintenance_request_id)
  where maintenance_request_id is not null;

create index if not exists operations_graph_events_conversation_id_idx
  on public.operations_graph_events (conversation_id)
  where conversation_id is not null;

create index if not exists operations_graph_events_message_id_idx
  on public.operations_graph_events (message_id)
  where message_id is not null;

create index if not exists operations_graph_events_event_type_idx
  on public.operations_graph_events (event_type);

create index if not exists operations_graph_events_created_at_idx
  on public.operations_graph_events (created_at desc);

alter table public.operations_graph_events enable row level security;

create policy operations_graph_events_select_scoped
  on public.operations_graph_events
  for select
  to authenticated
  using (
    public.is_staff_admin()
    or vendor_id in (select public.current_user_vendor_ids())
    or public.vendor_can_access_maintenance_request(maintenance_request_id)
  );

-- Inserts: Edge Function / service role only.
