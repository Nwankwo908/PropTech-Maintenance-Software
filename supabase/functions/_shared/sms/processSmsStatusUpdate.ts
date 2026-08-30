import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { handleActivationSmsDeliveryFailure } from "./tenantActivation.ts"
import type { SMSStatusUpdate } from "./types.ts"

type SmsMessageRow = {
  id: string
  conversation_id: string
  landlord_id: string
  provider_status: string | null
  direction: string
}

type ConversationRow = {
  unit_id: string | null
  resident_id: string | null
  vendor_id: string | null
  maintenance_request_id: string | null
}

function isFailedDeliveryStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase()
  return normalized === "failed" || normalized === "undelivered"
}

function isDeliveredStatus(status: string): boolean {
  return status.trim().toLowerCase() === "delivered"
}

async function loadConversationContext(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<ConversationRow | null> {
  const { data, error } = await supabase
    .from("sms_conversations")
    .select("unit_id, resident_id, vendor_id, maintenance_request_id")
    .eq("id", conversationId)
    .maybeSingle()

  if (error) {
    console.error("[sms-status-callback] conversation lookup", error.message)
    return null
  }

  return (data as ConversationRow | null) ?? null
}

async function recordDeliveryGraphEvent(
  supabase: SupabaseClient,
  params: {
    message: SmsMessageRow
    statusUpdate: SMSStatusUpdate
    conversation: ConversationRow | null
    eventType: "sms.delivery_failed" | "sms.delivered"
  },
): Promise<void> {
  await logGraphEvent(supabase, {
    landlord_id: params.message.landlord_id,
    event_type: params.eventType,
    source: "sms",
    actor_type: "system",
    unit_id: params.conversation?.unit_id ?? null,
    resident_id: params.conversation?.resident_id ?? null,
    vendor_id: params.conversation?.vendor_id ?? null,
    maintenance_request_id: params.conversation?.maintenance_request_id ?? null,
    conversation_id: params.message.conversation_id,
    message_id: params.message.id,
    metadata: {
      provider: params.statusUpdate.provider,
      provider_message_sid: params.statusUpdate.providerMessageSid,
      provider_status: params.statusUpdate.status,
      previous_provider_status: params.message.provider_status,
      direction: params.message.direction,
      error_code: params.statusUpdate.errorCode ?? null,
      from: params.statusUpdate.from ?? null,
      to: params.statusUpdate.to ?? null,
    },
  })
}

export async function processSmsStatusUpdate(
  supabase: SupabaseClient,
  statusUpdate: SMSStatusUpdate,
): Promise<{ ok: true; messageId?: string; graphEvent?: string }> {
  const { data: message, error: lookupErr } = await supabase
    .from("sms_messages")
    .select("id, conversation_id, landlord_id, provider_status, direction")
    .eq("provider", statusUpdate.provider)
    .eq("provider_message_sid", statusUpdate.providerMessageSid)
    .maybeSingle()

  if (lookupErr) {
    console.error("[sms-status-callback] sms_messages lookup", lookupErr.message)
    throw new Error("Message lookup failed")
  }

  if (!message?.id) {
    console.warn("[sms-status-callback] unknown provider_message_sid", {
      provider: statusUpdate.provider,
      providerMessageSid: statusUpdate.providerMessageSid,
      status: statusUpdate.status,
    })
    return { ok: true }
  }

  const row = message as SmsMessageRow
  const previousStatus = row.provider_status

  const { error: updateErr } = await supabase
    .from("sms_messages")
    .update({ provider_status: statusUpdate.status })
    .eq("id", row.id)

  if (updateErr) {
    console.error("[sms-status-callback] sms_messages update", updateErr.message)
    throw new Error("Message update failed")
  }

  const failedNow = isFailedDeliveryStatus(statusUpdate.status)
  const deliveredNow = isDeliveredStatus(statusUpdate.status)
  const failedBefore = previousStatus
    ? isFailedDeliveryStatus(previousStatus)
    : false
  const deliveredBefore = previousStatus
    ? isDeliveredStatus(previousStatus)
    : false

  if (!failedNow && !deliveredNow) {
    return { ok: true, messageId: row.id }
  }

  const conversation = await loadConversationContext(supabase, row.conversation_id)

  if (failedNow && !failedBefore) {
    await recordDeliveryGraphEvent(supabase, {
      message: row,
      statusUpdate,
      conversation,
      eventType: "sms.delivery_failed",
    })

    if (row.direction === "outbound") {
      try {
        const activation = await handleActivationSmsDeliveryFailure(supabase, {
          landlordId: row.landlord_id,
          messageId: row.id,
          conversationId: row.conversation_id,
          residentId: conversation?.resident_id ?? null,
          providerStatus: statusUpdate.status,
          errorCode: statusUpdate.errorCode ?? null,
        })
        if (activation.handled) {
          console.info("[sms-status-callback] activation undeliverable handled", {
            messageId: row.id,
            actionRequired: activation.actionRequired ?? false,
            reason: activation.reason ?? null,
          })
        }
      } catch (e) {
        console.error("[sms-status-callback] activation undeliverable handler", e)
      }
    }

    return { ok: true, messageId: row.id, graphEvent: "sms.delivery_failed" }
  }

  if (deliveredNow && !deliveredBefore) {
    await recordDeliveryGraphEvent(supabase, {
      message: row,
      statusUpdate,
      conversation,
      eventType: "sms.delivered",
    })
    return { ok: true, messageId: row.id, graphEvent: "sms.delivered" }
  }

  return { ok: true, messageId: row.id }
}
