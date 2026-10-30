-- Overview dual-write rejected ask_ulo.answered. The property graph allowlist
-- never included the Ask Ulo outcomes the activity writer already emits, while
-- operations_graph_events has no event-type check. Extend the allowlist.
-- Activity reads used is_staff_admin(), which is true for every portal member.
-- Scope them to the caller's account, platform staff, or an assigned vendor.

do $$ declare old_expr text; begin
  select pg_get_expr(conbin, conrelid) into old_expr
  from pg_constraint
  where conrelid = 'public.property_operations_graph'::regclass
    and conname = 'property_operations_graph_event_type_check';
  if old_expr is null then
    raise exception 'Expected property graph event constraint missing';
  end if;
  alter table public.property_operations_graph
    drop constraint property_operations_graph_event_type_check;
  execute 'alter table public.property_operations_graph add constraint property_operations_graph_event_type_check check (('
    || old_expr
    || ') or event_type in (''ask_ulo.answered'', ''ask_ulo.refused'', ''ask_ulo.clarified'', ''ask_ulo.support_notification_retried''))';
end $$;

create or replace function public.activity_event_visible_to_current_user(
  p_landlord_id uuid,
  p_vendor_id uuid,
  p_maintenance_request_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_access_landlord(p_landlord_id)
    or public.is_platform_staff()
    or exists (
      select 1
      from public.current_user_vendor_ids() as vendor_id
      where p_vendor_id = vendor_id
         or public.vendor_can_access_maintenance_request(p_maintenance_request_id)
    );
$$;

comment on function public.activity_event_visible_to_current_user(uuid, uuid, uuid) is
  'True when the signed-in user may read this activity row: their landlord account, platform staff, or a vendor on the row or its work order.';

revoke all on function public.activity_event_visible_to_current_user(uuid, uuid, uuid) from public;
grant execute on function public.activity_event_visible_to_current_user(uuid, uuid, uuid) to authenticated;

drop policy if exists property_operations_graph_select_staff on public.property_operations_graph;
drop policy if exists property_operations_graph_select_account on public.property_operations_graph;
create policy property_operations_graph_select_account
  on public.property_operations_graph
  for select
  to authenticated
  using (
    public.can_access_landlord(landlord_id)
    or public.is_platform_staff()
  );

drop policy if exists operations_graph_events_select_scoped on public.operations_graph_events;
create policy operations_graph_events_select_scoped
  on public.operations_graph_events
  for select
  to authenticated
  using (
    public.activity_event_visible_to_current_user(
      landlord_id,
      vendor_id,
      maintenance_request_id
    )
  );
