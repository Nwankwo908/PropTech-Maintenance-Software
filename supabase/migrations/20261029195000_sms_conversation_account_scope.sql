-- Portal membership is not permission to read every landlord's texts.
-- is_staff_admin() is true for any portal member, so the old conversation
-- policies exposed other accounts, including Limited Alpha.

drop policy if exists sms_conversations_select_scoped on public.sms_conversations;
create policy sms_conversations_select_scoped
  on public.sms_conversations
  for select
  to authenticated
  using (
    public.can_access_landlord(landlord_id)
    or public.is_platform_staff()
    or vendor_id in (select public.current_user_vendor_ids())
    or public.vendor_can_access_maintenance_request(maintenance_request_id)
  );

drop policy if exists sms_conversations_update_staff on public.sms_conversations;
create policy sms_conversations_update_owned
  on public.sms_conversations
  for update
  to authenticated
  using (public.can_access_landlord(landlord_id) or public.is_platform_staff())
  with check (public.can_access_landlord(landlord_id) or public.is_platform_staff());

drop policy if exists sms_messages_select_scoped on public.sms_messages;
create policy sms_messages_select_scoped
  on public.sms_messages
  for select
  to authenticated
  using (
    public.can_access_landlord(landlord_id)
    or public.is_platform_staff()
    or public.vendor_can_access_sms_conversation(conversation_id)
  );
