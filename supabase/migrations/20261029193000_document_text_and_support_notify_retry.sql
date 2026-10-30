-- Saved text from uploaded documents, scoped to the landlord account.
-- Failed support notifications retry on a schedule without another user report.

create table if not exists public.landlord_uploaded_documents (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  extracted_text text not null,
  created_at timestamptz not null default now(),
  unique (landlord_id, storage_path)
);

alter table public.landlord_uploaded_documents enable row level security;

drop policy if exists landlord_uploaded_documents_select on public.landlord_uploaded_documents;
create policy landlord_uploaded_documents_select
  on public.landlord_uploaded_documents
  for select to authenticated
  using (public.can_access_landlord(landlord_id) or public.is_platform_staff());

drop policy if exists landlord_uploaded_documents_write on public.landlord_uploaded_documents;
create policy landlord_uploaded_documents_write
  on public.landlord_uploaded_documents
  for all to authenticated
  using (public.can_access_landlord(landlord_id) or public.is_platform_staff())
  with check (public.can_access_landlord(landlord_id) or public.is_platform_staff());

alter table public.support_tickets
  add column if not exists notify_attempt_count integer not null default 0,
  add column if not exists next_retry_at timestamptz;

comment on column public.support_tickets.next_retry_at is
  'When a failed notification may be retried. Null means do not retry.';

insert into public.ulo_required_cron_jobs (jobname, edge_function, schedule, description)
values (
  'ulo-support-notification-retry',
  'retry-support-notifications',
  '*/15 * * * *',
  'Retry failed Ask Ulo support notifications without another user report.'
)
on conflict (jobname) do update
set edge_function = excluded.edge_function,
    schedule = excluded.schedule,
    description = excluded.description;

select public.ulo_ensure_required_cron_jobs();
