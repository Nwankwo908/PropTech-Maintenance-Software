-- SMS number pool lifecycle: available pool rows + released_pending churn state.

alter table public.sms_numbers
  add column if not exists release_auto_reply text;

comment on column public.sms_numbers.release_auto_reply is
  'Optional auto-reply body for inbound SMS while status=released_pending.';

alter table public.sms_numbers
  drop constraint if exists sms_numbers_status_check;

alter table public.sms_numbers
  add constraint sms_numbers_status_check
    check (
      status in (
        'active',
        'available',
        'released',
        'released_pending',
        'porting',
        'pending',
        'failed'
      )
    );

-- Unassigned pool inventory uses status=available (legacy rows may still be active).
update public.sms_numbers
set status = 'available'
where purpose = 'pool'
  and landlord_id is null
  and status = 'active';

create index if not exists sms_numbers_pool_available_idx
  on public.sms_numbers (created_at)
  where purpose = 'pool' and status = 'available' and landlord_id is null;
