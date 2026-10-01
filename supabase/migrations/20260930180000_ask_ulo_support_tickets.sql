-- Ask Ulo product-support tickets (SoT independent of Resend notify).

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'product_support'
    check (type = 'product_support'),
  summary text not null,
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  admin_user_id uuid,
  transcript_excerpt text,
  attempted_resolution text,
  dedup_signature text not null,
  repeat_count integer not null default 1
    check (repeat_count >= 1),
  last_seen_at timestamptz not null default now(),
  status text not null default 'open'
    check (status in ('open', 'resolved', 'closed')),
  notify_status text not null default 'pending'
    check (notify_status in ('pending', 'sent', 'failed', 'skipped')),
  notify_error text,
  conversation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.support_tickets is
  'Ask Ulo product-support tickets. Persist before Resend; notify_status tracks delivery.';

create unique index if not exists support_tickets_open_landlord_signature_uidx
  on public.support_tickets (landlord_id, dedup_signature)
  where status = 'open';

create index if not exists support_tickets_dedup_signature_idx
  on public.support_tickets (dedup_signature, last_seen_at desc);

create index if not exists support_tickets_landlord_status_idx
  on public.support_tickets (landlord_id, status, last_seen_at desc);

-- Cross-landlord pattern signal (does not merge tickets).
create table if not exists public.support_ticket_signature_signals (
  dedup_signature text primary key,
  distinct_landlord_count integer not null default 1
    check (distinct_landlord_count >= 1),
  total_sightings integer not null default 1
    check (total_sightings >= 1),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.support_ticket_signature_signals is
  'Cross-landlord Ask Ulo support pattern rollup by dedup_signature (not a merged ticket).';

alter table public.support_tickets enable row level security;
alter table public.support_ticket_signature_signals enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'support_tickets'
      and policyname = 'support_tickets_staff_select'
  ) then
    create policy support_tickets_staff_select
      on public.support_tickets
      for select
      to authenticated
      using (public.is_staff_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'support_ticket_signature_signals'
      and policyname = 'support_ticket_signature_signals_staff_select'
  ) then
    create policy support_ticket_signature_signals_staff_select
      on public.support_ticket_signature_signals
      for select
      to authenticated
      using (public.is_staff_admin());
  end if;
end $$;

grant select on public.support_tickets to authenticated;
grant select on public.support_ticket_signature_signals to authenticated;
