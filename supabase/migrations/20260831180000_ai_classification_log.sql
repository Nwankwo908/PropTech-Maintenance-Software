-- Operational gold for maintenance classification (training / review).
-- Separate from operations_graph_events. No phone numbers. Writes are
-- service-role only; intake must never fail if this insert fails.

create table if not exists public.ai_classification_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  unit_id uuid references public.units (id) on delete set null,
  resident_id uuid references public.users (id) on delete set null,
  conversation_id uuid references public.sms_conversations (id) on delete set null,
  maintenance_request_id uuid references public.maintenance_requests (id) on delete set null,
  pipeline_version text not null,
  raw_message text not null,
  sanitized_description text not null,
  vendor_trade text,
  primary_category text,
  urgency_band text,
  confidence_band text,
  emergency_type text,
  llm_draft jsonb,
  llm_provider text,
  landlord_triage jsonb,
  latency_ms integer,
  was_correct boolean,
  correct_vendor_trade text,
  correct_urgency_band text,
  correction_source text,
  constraint ai_classification_log_correction_source_check
    check (
      correction_source is null
      or correction_source in ('ticket_trade_edit', 'manual_review')
    )
);

comment on table public.ai_classification_log is
  'Classification pipeline snapshot for review. Gold labels come from ticket trade edits on the same work order, not vendor reassignment.';

comment on column public.ai_classification_log.vendor_trade is
  'Specific matching trade at classify time (not the 7 landlord buckets).';

comment on column public.ai_classification_log.correction_source is
  'ticket_trade_edit = maintenance_requests.issue_category changed for this ticket. Vendor swap does not set this.';

create index if not exists ai_classification_log_landlord_created_idx
  on public.ai_classification_log (landlord_id, created_at desc);

create index if not exists ai_classification_log_ticket_idx
  on public.ai_classification_log (maintenance_request_id)
  where maintenance_request_id is not null;

create index if not exists ai_classification_log_conversation_idx
  on public.ai_classification_log (conversation_id)
  where conversation_id is not null;

alter table public.ai_classification_log enable row level security;

drop policy if exists ai_classification_log_select_staff
  on public.ai_classification_log;
create policy ai_classification_log_select_staff
  on public.ai_classification_log
  for select
  to authenticated
  using (public.is_staff_admin());

drop policy if exists ai_classification_log_update_staff
  on public.ai_classification_log;
create policy ai_classification_log_update_staff
  on public.ai_classification_log
  for update
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

grant select, update on public.ai_classification_log to authenticated;
grant all on public.ai_classification_log to service_role;

create or replace function public.flag_ai_classification_trade_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.issue_category is distinct from old.issue_category
     and coalesce(trim(new.issue_category), '') <> '' then
    update public.ai_classification_log
    set
      was_correct = false,
      correct_vendor_trade = new.issue_category,
      correction_source = 'ticket_trade_edit'
    where maintenance_request_id = new.id
      and vendor_trade is distinct from new.issue_category;
  end if;
  return new;
end;
$$;

drop trigger if exists maintenance_requests_flag_ai_classification_trade
  on public.maintenance_requests;
create trigger maintenance_requests_flag_ai_classification_trade
  after update of issue_category on public.maintenance_requests
  for each row
  execute function public.flag_ai_classification_trade_edit();
