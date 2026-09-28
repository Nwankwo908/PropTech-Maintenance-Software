-- Sticky needs_admin_vendor hold + episode counters for cycle detection.

alter table public.maintenance_requests
  add column if not exists auto_reassign_needs_admin_entries integer
    not null default 0;

comment on column public.maintenance_requests.auto_reassign_needs_admin_entries is
  'How many times automation entered needs_admin_vendor on this ticket (cycle alert at 2+).';

-- Episode markers on deduped graph events (close when ticket leaves needs-vendor).
-- No schema change required beyond metadata JSON; repeat_count/last_seen_at already exist.
