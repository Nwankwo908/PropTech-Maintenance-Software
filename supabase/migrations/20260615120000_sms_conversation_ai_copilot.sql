-- Allow Ulo AI copilot threads in the unified Communication inbox.
-- Adds 'ai_copilot' to the sms_conversations.conversation_type check so AI
-- suggestion/draft conversations can live alongside tenant and vendor threads.

alter table public.sms_conversations
  drop constraint if exists sms_conversations_conversation_type_check;

alter table public.sms_conversations
  add constraint sms_conversations_conversation_type_check
  check (
    conversation_type in (
      'resident_intake',
      'vendor_alert',
      'vendor_tenant_proxy',
      'landlord_update',
      'ai_copilot'
    )
  );
