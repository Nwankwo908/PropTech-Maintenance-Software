import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../_shared/graph/logGraphEvent.ts"
import { getSMSProvider } from "../_shared/sms/providerFactory.ts"
import type { SMSStatusUpdate } from "../_shared/sms/types.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

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

function emptyOk(): Response {
  return new Response("", { status: 200, headers: corsHeaders })
}

function isFailedDeliveryStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase()
  return normalized === "failed" || normalized === "undelivered"
}

function isDeliveredStatus(status: string): boolean {
  return status.trim().toLowerCase() === "delivered"
}

async function loadConversationContext(
  supabase: ReturnType<typeof createClient>,
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
  supabase: ReturnType<typeof createClient>,
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

async function processStatusUpdate(
  supabase: ReturnType<typeof createClient>,
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    console.error("[sms-status-callback] missing Supabase credentials")
    return new Response("Server misconfigured", { status: 500, headers: corsHeaders })
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const provider = getSMSProvider()
    const statusUpdate = await provider.normalizeStatusWebhook(req)

    const result = await processStatusUpdate(supabase, statusUpdate)

    console.info("[sms-status-callback] processed", {
      provider: statusUpdate.provider,
      providerMessageSid: statusUpdate.providerMessageSid,
      status: statusUpdate.status,
      messageId: result.messageId ?? null,
      graphEvent: result.graphEvent ?? null,
    })

    return emptyOk()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/Invalid Twilio webhook signature/i.test(message)) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders })
    }

    console.error("[sms-status-callback] unexpected error", err)
    return new Response(message, { status: 500, headers: corsHeaders })
  }
})
