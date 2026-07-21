import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  findActiveLandlordMainNumber,
  resolveLandlordId,
  type LandlordSmsNumberRow,
} from "./landlordSmsOnboarding.ts"
import {
  findOrCreateConversation,
  normalizeSmsPhone,
  upsertSmsIdentityForPhone,
  type SmsIdentityRow,
} from "./inbound_db.ts"
import { getSMSProvider } from "./providerFactory.ts"
import { logGraphEvent } from "../graph/logGraphEvent.ts"

export type VendorAlertSendResult =
  | {
      ok: true
      conversationId: string
      messageId: string
      providerMessageSid: string
      fromNumber: string
    }
  | { ok: false; error: string }

/**
 * When a new ticket is linked to an existing vendor conversation, clear
 * schedule / estimate wait flags that still point at an older ticket.
 */
export async function clearStaleVendorThreadStateForTicket(
  supabase: SupabaseClient,
  params: { conversationId: string; ticketId: string },
): Promise<void> {
  const { data: convo } = await supabase
    .from("sms_conversations")
    .select("intake_state, maintenance_request_id")
    .eq("id", params.conversationId)
    .maybeSingle()

  const intake =
    convo?.intake_state && typeof convo.intake_state === "object"
      ? { ...(convo.intake_state as Record<string, unknown>) }
      : {}

  let changed = false
  const schedule = intake.vendor_schedule
  if (schedule && typeof schedule === "object") {
    const scheduleTicket =
      typeof (schedule as { ticketId?: unknown }).ticketId === "string"
        ? (schedule as { ticketId: string }).ticketId.trim()
        : ""
    if (scheduleTicket && scheduleTicket !== params.ticketId) {
      delete intake.vendor_schedule
      changed = true
    }
  }

  const estimateWait = intake.awaiting_estimate_decision
  if (estimateWait && typeof estimateWait === "object") {
    const estimateTicket =
      typeof (estimateWait as { ticket_id?: unknown }).ticket_id === "string"
        ? (estimateWait as { ticket_id: string }).ticket_id.trim()
        : ""
    if (estimateTicket && estimateTicket !== params.ticketId) {
      delete intake.awaiting_estimate_decision
      changed = true
    }
  }

  const patch: Record<string, unknown> = {
    maintenance_request_id: params.ticketId,
    updated_at: new Date().toISOString(),
  }
  if (changed) patch.intake_state = intake

  const { error } = await supabase
    .from("sms_conversations")
    .update(patch)
    .eq("id", params.conversationId)
  if (error) {
    console.error("[vendorSms] clear stale thread state", error.message)
  }
}

/** MVP: all vendor SMS uses the landlord's main line (per-vendor proxy comes later). */
export async function resolveVendorAlertSenderNumber(
  supabase: SupabaseClient,
  landlordId?: string | null,
): Promise<LandlordSmsNumberRow | null> {
  const scopedLandlordId = landlordId?.trim() || resolveLandlordId()
  return findActiveLandlordMainNumber(supabase, scopedLandlordId)
}

async function ensureVendorSmsIdentity(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string
    vendorPhone: string
  },
): Promise<SmsIdentityRow | null> {
  return upsertSmsIdentityForPhone(supabase, {
    landlordId: params.landlordId,
    phone: params.vendorPhone,
    identityType: "vendor",
    vendorId: params.vendorId,
  })
}

/** Register or upgrade vendor SMS identity after admin/vendor onboarding. */
export async function syncVendorSmsIdentity(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string
    vendorPhone: string
  },
): Promise<SmsIdentityRow | null> {
  return ensureVendorSmsIdentity(supabase, params)
}

async function saveOutboundSmsMessage(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    landlordId: string
    fromNumber: string
    toNumber: string
    body: string
    provider: string
    providerMessageSid: string
  },
): Promise<string> {
  const { data, error } = await supabase
    .from("sms_messages")
    .insert({
      conversation_id: params.conversationId,
      landlord_id: params.landlordId,
      direction: "outbound",
      from_number: normalizeSmsPhone(params.fromNumber),
      to_number: normalizeSmsPhone(params.toNumber),
      body: params.body,
      media_urls: [],
      provider: params.provider,
      provider_message_sid: params.providerMessageSid,
      provider_status: "sent",
      raw_payload: { source: "vendor_alert" },
    })
    .select("id")
    .single()

  if (error || !data?.id) {
    console.error("[vendorSms] outbound message insert", error?.message)
    throw new Error("Failed to save outbound SMS message")
  }

  return data.id as string
}

async function recordVendorAlertSentEvent(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string
    ticketId: string
    conversationId: string
    messageId: string
    fromNumber: string
    toNumber: string
    providerMessageSid: string
  },
): Promise<void> {
  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "vendor.alert_sent",
    source: "edge_function",
    actor_type: "system",
    vendor_id: params.vendorId,
    maintenance_request_id: params.ticketId,
    conversation_id: params.conversationId,
    message_id: params.messageId,
    metadata: {
      from: normalizeSmsPhone(params.fromNumber),
      to: normalizeSmsPhone(params.toNumber),
      provider_message_sid: params.providerMessageSid,
    },
  })
}

/**
 * Send a vendor job alert through SMSProvider and persist conversation + graph event.
 * Vendor real phone (`vendors.phone`) is the destination; sender is always landlord_main.
 */
async function resolveLandlordIdForTicket(
  supabase: SupabaseClient,
  ticketId: string,
  explicit?: string | null,
): Promise<string> {
  const fromParam = explicit?.trim()
  if (fromParam) return resolveLandlordId(fromParam)

  const { data } = await supabase
    .from("maintenance_requests")
    .select("landlord_id")
    .eq("id", ticketId)
    .maybeSingle()
  const fromTicket =
    typeof data?.landlord_id === "string" ? data.landlord_id.trim() : ""
  if (fromTicket) return resolveLandlordId(fromTicket)

  return resolveLandlordId()
}

export async function sendVendorJobAlert(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    vendorId: string
    vendorPhone: string
    body: string
    landlordId?: string | null
  },
): Promise<VendorAlertSendResult> {
  const vendorPhone = params.vendorPhone.trim()
  if (!vendorPhone) {
    return { ok: false, error: "vendor has no phone" }
  }

  let landlordId: string
  try {
    landlordId = await resolveLandlordIdForTicket(
      supabase,
      params.ticketId,
      params.landlordId,
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: message }
  }

  const senderNumber = await resolveVendorAlertSenderNumber(supabase, landlordId)
  if (!senderNumber) {
    return {
      ok: false,
      error: "No landlord_main SMS number configured (assign from sms_numbers pool first)",
    }
  }

  const identity = await ensureVendorSmsIdentity(supabase, {
    landlordId,
    vendorId: params.vendorId,
    vendorPhone,
  })
  if (!identity) {
    return { ok: false, error: "Invalid vendor phone number for SMS identity" }
  }

  const { conversationId } = await findOrCreateConversation(supabase, {
    landlordId,
    smsNumberId: senderNumber.id,
    externalPhone: vendorPhone,
    identity,
    maintenanceRequestId: params.ticketId,
    conversationStatus: "open",
  })

  // New job alerts reuse the same vendor SMS thread — drop schedule / estimate
  // wait state from a prior ticket so YES isn't stolen by the old FSM.
  try {
    await clearStaleVendorThreadStateForTicket(supabase, {
      conversationId,
      ticketId: params.ticketId,
    })
  } catch (e) {
    console.error("[vendorSms] clear stale thread state", e)
  }

  const provider = getSMSProvider()
  const sendResult = await provider.sendMessage({
    to: vendorPhone,
    body: params.body,
    from: senderNumber.phone_number,
  })

  if (sendResult.error) {
    return { ok: false, error: sendResult.error }
  }

  const providerMessageSid =
    sendResult.providerMessageSid ?? sendResult.messageId ?? "sent"

  const messageId = await saveOutboundSmsMessage(supabase, {
    conversationId,
    landlordId,
    fromNumber: senderNumber.phone_number,
    toNumber: vendorPhone,
    body: params.body,
    provider: sendResult.provider,
    providerMessageSid,
  })

  await recordVendorAlertSentEvent(supabase, {
    landlordId,
    vendorId: params.vendorId,
    ticketId: params.ticketId,
    conversationId,
    messageId,
    fromNumber: senderNumber.phone_number,
    toNumber: vendorPhone,
    providerMessageSid,
  })

  console.info("[vendorSms] vendor alert sent", {
    ticketId: params.ticketId,
    vendorId: params.vendorId,
    conversationId,
    messageId,
    from: senderNumber.phone_number,
  })

  return {
    ok: true,
    conversationId,
    messageId,
    providerMessageSid,
    fromNumber: senderNumber.phone_number,
  }
}

export async function recordVendorRepliedEvent(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string
    conversationId: string
    messageId: string
    maintenanceRequestId: string | null
    bodyPreview: string
    parsedAction: string | null
    transition?: VendorStatusTransitionResultMeta
  },
): Promise<void> {
  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "vendor.replied",
    source: "sms",
    actor_type: "vendor",
    actor_id: params.vendorId,
    vendor_id: params.vendorId,
    maintenance_request_id: params.maintenanceRequestId,
    conversation_id: params.conversationId,
    message_id: params.messageId,
    metadata: {
      body_preview: params.bodyPreview.slice(0, 280),
      parsed_action: params.parsedAction,
      transition: params.transition ?? null,
    },
  })
}

export type VendorStatusTransitionResultMeta = {
  ok: boolean
  fromStatus?: string
  toStatus?: string
  reason?: string
}

async function ticketStillExists(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("maintenance_requests")
    .select("id")
    .eq("id", ticketId)
    .maybeSingle()
  return !!data?.id
}

/** Resolve open ticket for an inbound vendor reply. */
export async function resolveVendorMaintenanceRequestId(
  supabase: SupabaseClient,
  params: {
    vendorId: string
    conversationId?: string | null
    conversationMaintenanceRequestId?: string | null
  },
): Promise<string | null> {
  if (params.conversationMaintenanceRequestId) {
    const id = params.conversationMaintenanceRequestId.trim()
    if (id && (await ticketStillExists(supabase, id))) return id
  }

  if (params.conversationId) {
    const { data: convo } = await supabase
      .from("sms_conversations")
      .select("maintenance_request_id")
      .eq("id", params.conversationId)
      .maybeSingle()

    const linked = (convo as { maintenance_request_id?: string | null } | null)
      ?.maintenance_request_id
    if (linked && (await ticketStillExists(supabase, linked))) return linked
  }

  const { data: ticket } = await supabase
    .from("maintenance_requests")
    .select("id")
    .eq("assigned_vendor_id", params.vendorId)
    .in("vendor_work_status", ["pending_accept", "accepted", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  return (ticket?.id as string | undefined) ?? null
}
