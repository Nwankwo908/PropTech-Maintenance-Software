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
    landlordId = resolveLandlordId(params.landlordId)
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
    return params.conversationMaintenanceRequestId
  }

  if (params.conversationId) {
    const { data: convo } = await supabase
      .from("sms_conversations")
      .select("maintenance_request_id")
      .eq("id", params.conversationId)
      .maybeSingle()

    const linked = (convo as { maintenance_request_id?: string | null } | null)
      ?.maintenance_request_id
    if (linked) return linked
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
