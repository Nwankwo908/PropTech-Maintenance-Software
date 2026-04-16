-- Enforce: active vendor pipeline statuses require assigned_vendor_id.
-- `declined` / `unassigned` may legitimately have no assignee (e.g. after decline with no replacement).
-- Applied NOT VALID so existing legacy rows do not block migration; validate after data cleanup:
--   ALTER TABLE public.maintenance_requests VALIDATE CONSTRAINT require_vendor_for_progress;

alter table public.maintenance_requests
  drop constraint if exists require_vendor_for_progress;

alter table public.maintenance_requests
  add constraint require_vendor_for_progress
  check (
    assigned_vendor_id is not null
    or vendor_work_status not in (
      'pending_accept',
      'accepted',
      'in_progress',
      'completed'
    )
  )
  not valid;

comment on constraint require_vendor_for_progress on public.maintenance_requests is
  'Blocks pending_accept/accepted/in_progress/completed without assigned_vendor_id; use NOT VALID until backfilled.';
