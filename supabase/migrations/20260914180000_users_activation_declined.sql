-- Tenant replied NO to the welcome SMS: stop YES/NO nudges without treating it as STOP.

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'users_activation_status_check'
  ) then
    alter table public.users drop constraint users_activation_status_check;
  end if;
end $$;

alter table public.users
  add constraint users_activation_status_check
  check (
    activation_status is null
    or activation_status in (
      'not_started',
      'waiting',
      'delivery_failed',
      'action_required',
      'activated',
      'opted_out',
      'declined'
    )
  );

comment on column public.users.activation_status is
  'Tenant onboarding SMS: not_started | waiting | delivery_failed | action_required | activated | opted_out | declined (replied NO to updates).';
