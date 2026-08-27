-- Live vendor_verifications.status check omitted `invited`, so Start onboarding
-- failed with 23514. Recreate the check from current row values plus invite statuses.
-- Overview dual-write also rejected vendor.* graph events.

alter table public.vendor_verifications
  drop constraint if exists vendor_verifications_status_check;

do $$
declare
  allowed text;
begin
  select string_agg(quote_literal(s), ', ' order by s)
  into allowed
  from (
    select distinct status as s
    from public.vendor_verifications
    where status is not null
    union
    select unnest(array[
      'invited',
      'in_progress',
      'submitted',
      'verified',
      'needs_review',
      'pending'
    ])
  ) q;

  execute format(
    'alter table public.vendor_verifications
       add constraint vendor_verifications_status_check
       check (status in (%s))',
    allowed
  );
end $$;

alter table public.property_operations_graph
  drop constraint if exists property_operations_graph_event_type_check;

alter table public.property_operations_graph
  add constraint property_operations_graph_event_type_check
  check (
    event_type ~ '^(maintenance|rent|move_in|move_out|inspection|workflow|vendor|lease|tenant|unit|sms|occupancy|landlord|broadcast)\.'
  );
