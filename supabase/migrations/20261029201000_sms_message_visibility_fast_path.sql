-- Cross-account message checks were timing out. The select policy called a
-- security-invoker helper, so every row re-entered conversation and ticket
-- policies. Portal members with no vendor profile never need that lookup.

create or replace function public.sms_message_visible_to_current_user(
  p_landlord_id uuid,
  p_conversation_id uuid
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
      where exists (
        select 1
        from public.sms_conversations c
        where c.id = p_conversation_id
          and (
            c.vendor_id = vendor_id
            or exists (
              select 1
              from public.maintenance_requests mr
              where mr.id = c.maintenance_request_id
                and mr.assigned_vendor_id = vendor_id
            )
          )
      )
    );
$$;

comment on function public.sms_message_visible_to_current_user(uuid, uuid) is
  'True when the signed-in user may read this SMS: their landlord account, platform staff, or a vendor assigned to the thread or its work order.';

revoke all on function public.sms_message_visible_to_current_user(uuid, uuid) from public;
grant execute on function public.sms_message_visible_to_current_user(uuid, uuid) to authenticated;

drop policy if exists sms_messages_select_scoped on public.sms_messages;
create policy sms_messages_select_scoped
  on public.sms_messages
  for select
  to authenticated
  using (public.sms_message_visible_to_current_user(landlord_id, conversation_id));
