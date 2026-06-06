import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  findActiveLandlordMainNumber,
  resolveLandlordId,
  type LandlordSmsNumberRow,
} from "./landlordSmsOnboarding.ts"
import { normalizeSmsPhone, phoneLookupVariants } from "./inbound_db.ts"
import { getSMSProvider } from "./providerFactory.ts"
import { logGraphEvent } from "../graph/logGraphEvent.ts"

export type ProxiedSenderType = "vendor" | "resident" | "landlord" | "system"
export type ProxiedRecipientType = "vendor" | "resident"

export type ProxiedTicketContext = {
  maintenanceRequestId: string
  landlordId: string
  unitId: string | null
  residentId: string | null
  vendorId: string
  unitLabel: string
  /** Private — never expose in API responses. */
  residentPhone: string | null
  /** Private — never expose in API responses. */
  vendorPhone: string | null
}

export type SendProxiedMessageInput = {
  maintenanceRequestId: string
  senderType: ProxiedSenderType
  senderId: string
  body: string
  mediaUrls?: string[]
  /** Required when senderType is landlord or system. */
  recipientType?: ProxiedRecipientType
}

export type SendProxiedMessageResult =
  | {
      ok: true
      conversationId: string
      messageId: string
      providerMessageSid: string
      fromNumber: string
      eventType: string
    }
  | { ok: false; error: string; status?: number }

const ACTIVE_VENDOR_STATUSES = [
  "pending_accept",
  "accepted",
  "in_progress",
] as const

function normalizeEmail(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase()
}

async function resolveResidentUserId(
  supabase: SupabaseClient,
  ticket: {
    resident_phone: string | null
    email: string | null
    unit: string | null
    resident_user_id: string | null
  },
): Promise<{ residentId: string | null; unitId: string | null; residentPhone: string | null }> {
  const variants = ticket.resident_phone
    ? phoneLookupVariants(ticket.resident_phone)
    : []

  if (variants.length > 0) {
    const { data: byPhone } = await supabase
      .from("users")
      .select("id, phone")
      .in("phone", variants)
      .eq("status", "active")
      .limit(1)
      .maybeSingle()

    if (byPhone?.id) {
      return {
        residentId: byPhone.id as string,
        unitId: null,
        residentPhone: ticket.resident_phone,
      }
    }
  }

  if (ticket.resident_user_id) {
    const { data: byAuth } = await supabase
      .from("users")
      .select("id, phone")
      .eq("supabase_user_id", ticket.resident_user_id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle()

    if (byAuth?.id) {
      return {
        residentId: byAuth.id as string,
        unitId: null,
        residentPhone:
          typeof byAuth.phone === "string" && byAuth.phone.trim()
            ? byAuth.phone.trim()
            : ticket.resident_phone,
      }
    }
  }

  const email = normalizeEmail(ticket.email)
  if (email) {
    const { data: byEmail } = await supabase
      .from("users")
      .select("id, phone, unit")
      .ilike("email", email)
      .eq("status", "active")
      .limit(5)

    const rows = (byEmail ?? []) as Array<{
      id: string
      phone: string | null
      unit: string | null
    }>
    const unitNorm = (ticket.unit ?? "").trim().toLowerCase()
    const match =
      rows.find((r) => (r.unit ?? "").trim().toLowerCase() === unitNorm) ??
      rows[0]

    if (match?.id) {
      return {
        residentId: match.id,
        unitId: null,
        residentPhone:
          typeof match.phone === "string" && match.phone.trim()
            ? match.phone.trim()
            : ticket.resident_phone,
      }
    }
  }

  return {
    residentId: null,
    unitId: null,
    residentPhone: ticket.resident_phone,
  }
}

/** Load ticket graph nodes and private phone numbers for proxy routing. */
export async function loadProxiedTicketContext(
  supabase: SupabaseClient,
  maintenanceRequestId: string,
  landlordId?: string | null,
): Promise<ProxiedTicketContext | { error: string }> {
  const { data: ticket, error } = await supabase
    .from("maintenance_requests")
    .select(
      "id, unit, resident_phone, resident_name, email, resident_user_id, assigned_vendor_id, vendor_work_status",
    )
    .eq("id", maintenanceRequestId)
    .maybeSingle()

  if (error) {
    console.error("[proxiedMessaging] load ticket", error.message)
    return { error: "Failed to load maintenance request" }
  }
  if (!ticket) {
    return { error: "Maintenance request not found" }
  }
  if (!ticket.assigned_vendor_id) {
    return { error: "No vendor assigned to this maintenance request" }
  }
  if (
    !ACTIVE_VENDOR_STATUSES.includes(
      String(ticket.vendor_work_status ?? "") as (typeof ACTIVE_VENDOR_STATUSES)[number],
    )
  ) {
    return {
      error: "Proxy messaging is only available for active assigned jobs",
    }
  }

  const { data: vendor, error: vendorErr } = await supabase
    .from("vendors")
    .select("id, phone")
    .eq("id", ticket.assigned_vendor_id as string)
    .eq("active", true)
    .maybeSingle()

  if (vendorErr) {
    console.error("[proxiedMessaging] load vendor", vendorErr.message)
    return { error: "Failed to load vendor" }
  }
  if (!vendor?.phone?.trim()) {
    return { error: "Assigned vendor has no phone on file" }
  }

  const resident = await resolveResidentUserId(supabase, {
    resident_phone:
      typeof ticket.resident_phone === "string" ? ticket.resident_phone : null,
    email: typeof ticket.email === "string" ? ticket.email : null,
    unit: typeof ticket.unit === "string" ? ticket.unit : null,
    resident_user_id:
      typeof ticket.resident_user_id === "string"
        ? ticket.resident_user_id
        : null,
  })

  if (!resident.residentPhone?.trim()) {
    return { error: "Tenant has no phone on file for SMS proxy" }
  }

  let scopedLandlordId: string
  try {
    scopedLandlordId = resolveLandlordId(landlordId)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { error: message }
  }

  if (resident.residentId && !resident.unitId) {
    const { data: identity } = await supabase
      .from("sms_identities")
      .select("unit_id")
      .eq("landlord_id", scopedLandlordId)
      .eq("resident_id", resident.residentId)
      .limit(1)
      .maybeSingle()
    if (identity?.unit_id) {
      resident.unitId = identity.unit_id as string
    }
  }

  return {
    maintenanceRequestId: ticket.id as string,
    landlordId: scopedLandlordId,
    unitId: resident.unitId,
    residentId: resident.residentId,
    vendorId: vendor.id as string,
    unitLabel: String(ticket.unit ?? ""),
    residentPhone: resident.residentPhone.trim(),
    vendorPhone: vendor.phone.trim(),
  }
}

function resolveRecipientType(
  senderType: ProxiedSenderType,
  recipientType?: ProxiedRecipientType,
): ProxiedRecipientType | { error: string } {
  if (senderType === "vendor") return "resident"
  if (senderType === "resident") return "vendor"
  if (senderType === "landlord" || senderType === "system") {
    if (recipientType === "vendor" || recipientType === "resident") {
      return recipientType
    }
    return { error: "recipient_type (vendor|resident) is required for landlord/system senders" }
  }
  return { error: "Invalid sender_type" }
}

function graphEventType(
  senderType: ProxiedSenderType,
  recipientType: ProxiedRecipientType,
): string {
  if (senderType === "vendor" && recipientType === "resident") {
    return "vendor.message_to_tenant"
  }
  if (senderType === "resident" && recipientType === "vendor") {
    return "tenant.message_to_vendor"
  }
  return "landlord.message_to_party"
}

function actorTypeForSender(
  senderType: ProxiedSenderType,
): "resident" | "vendor" | "landlord" | "system" {
  switch (senderType) {
    case "vendor":
      return "vendor"
    case "resident":
      return "resident"
    case "landlord":
      return "landlord"
    default:
      return "system"
  }
}

export function formatProxiedSmsBody(
  senderType: ProxiedSenderType,
  unitLabel: string,
  body: string,
): string {
  const trimmed = body.trim()
  if (!trimmed) return trimmed

  switch (senderType) {
    case "vendor":
      return `[Your assigned vendor]\n${trimmed}`
    case "resident":
      return unitLabel.trim()
        ? `[Tenant — ${unitLabel.trim()}]\n${trimmed}`
        : `[Tenant]\n${trimmed}`
    case "landlord":
      return `[Property manager]\n${trimmed}`
    case "system":
      return `[Ulo]\n${trimmed}`
  }
}

function recipientPhoneForType(
  ctx: ProxiedTicketContext,
  recipientType: ProxiedRecipientType,
): string | null {
  return recipientType === "vendor" ? ctx.vendorPhone : ctx.residentPhone
}

async function findOrCreateProxyConversation(
  supabase: SupabaseClient,
  params: {
    ctx: ProxiedTicketContext
    smsNumberId: string
    recipientPhone: string
  },
): Promise<string> {
  const external = normalizeSmsPhone(params.recipientPhone)
  const { data: existing, error: findErr } = await supabase
    .from("sms_conversations")
    .select("id")
    .eq("landlord_id", params.ctx.landlordId)
    .eq("sms_number_id", params.smsNumberId)
    .eq("external_phone_number", external)
    .eq("conversation_type", "vendor_tenant_proxy")
    .eq("maintenance_request_id", params.ctx.maintenanceRequestId)
    .eq("status", "open")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (findErr) {
    console.error("[proxiedMessaging] conversation lookup", findErr.message)
    throw new Error("Failed to look up proxy conversation")
  }

  if (existing?.id) {
    const { error: upErr } = await supabase
      .from("sms_conversations")
      .update({
        updated_at: new Date().toISOString(),
        unit_id: params.ctx.unitId,
        resident_id: params.ctx.residentId,
        vendor_id: params.ctx.vendorId,
        maintenance_request_id: params.ctx.maintenanceRequestId,
      })
      .eq("id", existing.id)
    if (upErr) {
      console.error("[proxiedMessaging] conversation update", upErr.message)
    }
    return existing.id as string
  }

  const { data: created, error: insErr } = await supabase
    .from("sms_conversations")
    .insert({
      landlord_id: params.ctx.landlordId,
      unit_id: params.ctx.unitId,
      resident_id: params.ctx.residentId,
      vendor_id: params.ctx.vendorId,
      maintenance_request_id: params.ctx.maintenanceRequestId,
      sms_number_id: params.smsNumberId,
      external_phone_number: external,
      conversation_type: "vendor_tenant_proxy",
      status: "open",
    })
    .select("id")
    .single()

  if (insErr || !created?.id) {
    console.error("[proxiedMessaging] conversation insert", insErr?.message)
    throw new Error("Failed to create proxy conversation")
  }

  return created.id as string
}

async function saveOutboundProxiedMessage(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    landlordId: string
    fromNumber: string
    toNumber: string
    body: string
    mediaUrls: string[]
    provider: string
    providerMessageSid: string
    senderType: ProxiedSenderType
    recipientType: ProxiedRecipientType
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
      media_urls: params.mediaUrls,
      provider: params.provider,
      provider_message_sid: params.providerMessageSid,
      provider_status: "sent",
      raw_payload: {
        source: "vendor_tenant_proxy",
        sender_type: params.senderType,
        recipient_type: params.recipientType,
      },
    })
    .select("id")
    .single()

  if (error || !data?.id) {
    console.error("[proxiedMessaging] sms_messages insert", error?.message)
    throw new Error("Failed to save proxied SMS message")
  }

  return data.id as string
}

async function recordProxiedGraphEvent(
  supabase: SupabaseClient,
  params: {
    ctx: ProxiedTicketContext
    eventType: string
    senderType: ProxiedSenderType
    senderId: string
    recipientType: ProxiedRecipientType
    conversationId: string
    messageId: string
  },
): Promise<void> {
  const actorType = actorTypeForSender(params.senderType)
  await logGraphEvent(supabase, {
    landlord_id: params.ctx.landlordId,
    event_type: params.eventType,
    source: "edge_function",
    actor_type: actorType,
    actor_id: params.senderType === "system" ? null : params.senderId,
    unit_id: params.ctx.unitId,
    resident_id: params.ctx.residentId,
    vendor_id: params.ctx.vendorId,
    maintenance_request_id: params.ctx.maintenanceRequestId,
    conversation_id: params.conversationId,
    message_id: params.messageId,
    metadata: {
      sender_type: params.senderType,
      recipient_type: params.recipientType,
      proxied: true,
    },
  })
}

async function resolveSenderNumber(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<LandlordSmsNumberRow | null> {
  return findActiveLandlordMainNumber(supabase, landlordId)
}

/**
 * Send a proxied SMS between vendor and tenant (or from landlord/system).
 * Real phone numbers are never returned to callers.
 */
export async function sendProxiedMessage(
  supabase: SupabaseClient,
  input: SendProxiedMessageInput,
): Promise<SendProxiedMessageResult> {
  const body = input.body?.trim() ?? ""
  if (!body && !(input.mediaUrls?.length ?? 0)) {
    return { ok: false, error: "body or media_urls is required", status: 400 }
  }

  const recipientResolved = resolveRecipientType(
    input.senderType,
    input.recipientType,
  )
  if ("error" in recipientResolved) {
    return { ok: false, error: recipientResolved.error, status: 400 }
  }
  const recipientType = recipientResolved

  const ctxResult = await loadProxiedTicketContext(
    supabase,
    input.maintenanceRequestId,
  )
  if ("error" in ctxResult) {
    return { ok: false, error: ctxResult.error, status: 404 }
  }
  const ctx = ctxResult

  if (input.senderType === "vendor" && input.senderId !== ctx.vendorId) {
    return { ok: false, error: "sender_id does not match assigned vendor", status: 403 }
  }
  if (
    input.senderType === "resident" &&
    ctx.residentId &&
    input.senderId !== ctx.residentId
  ) {
    return { ok: false, error: "sender_id does not match ticket resident", status: 403 }
  }
  if (input.senderType === "landlord" && input.senderId !== ctx.landlordId) {
    return { ok: false, error: "sender_id does not match landlord scope", status: 403 }
  }
  if (input.senderType === "system" && input.senderId !== ctx.landlordId) {
    return { ok: false, error: "sender_id must be landlord id for system sends", status: 403 }
  }

  const recipientPhone = recipientPhoneForType(ctx, recipientType)
  if (!recipientPhone?.trim()) {
    return {
      ok: false,
      error: `Recipient ${recipientType} has no phone on file`,
      status: 422,
    }
  }

  const senderNumber = await resolveSenderNumber(supabase, ctx.landlordId)
  if (!senderNumber) {
    return {
      ok: false,
      error: "No landlord_main SMS number configured",
      status: 422,
    }
  }

  const smsBody = formatProxiedSmsBody(
    input.senderType,
    ctx.unitLabel,
    body,
  )

  const conversationId = await findOrCreateProxyConversation(supabase, {
    ctx,
    smsNumberId: senderNumber.id,
    recipientPhone,
  })

  const provider = getSMSProvider()
  const sendResult = await provider.sendMessage({
    to: recipientPhone,
    body: smsBody || "(media)",
    from: senderNumber.phone_number,
    mediaUrls: input.mediaUrls,
  })

  if (sendResult.error) {
    return { ok: false, error: sendResult.error, status: 502 }
  }

  const providerMessageSid =
    sendResult.providerMessageSid ?? sendResult.messageId ?? "sent"

  const messageId = await saveOutboundProxiedMessage(supabase, {
    conversationId,
    landlordId: ctx.landlordId,
    fromNumber: senderNumber.phone_number,
    toNumber: recipientPhone,
    body: smsBody,
    mediaUrls: input.mediaUrls ?? [],
    provider: sendResult.provider,
    providerMessageSid,
    senderType: input.senderType,
    recipientType,
  })

  const eventType = graphEventType(input.senderType, recipientType)
  await recordProxiedGraphEvent(supabase, {
    ctx,
    eventType,
    senderType: input.senderType,
    senderId: input.senderId,
    recipientType,
    conversationId,
    messageId,
  })

  console.info("[proxiedMessaging] sent", {
    maintenanceRequestId: ctx.maintenanceRequestId,
    senderType: input.senderType,
    recipientType,
    conversationId,
    messageId,
    eventType,
  })

  return {
    ok: true,
    conversationId,
    messageId,
    providerMessageSid,
    fromNumber: senderNumber.phone_number,
    eventType,
  }
}

/** Infer proxied sender/recipient from an inbound thread's external phone. */
export function inferProxiedParties(
  ctx: ProxiedTicketContext,
  inboundFrom: string,
): {
  senderType: ProxiedSenderType
  recipientType: ProxiedRecipientType
  senderId: string
} | null {
  const fromVariants = new Set(phoneLookupVariants(inboundFrom))
  const vendorVariants = new Set(phoneLookupVariants(ctx.vendorPhone ?? ""))
  const residentVariants = new Set(phoneLookupVariants(ctx.residentPhone ?? ""))

  const matchesVendor = [...fromVariants].some((v) => vendorVariants.has(v))
  const matchesResident = [...fromVariants].some((v) => residentVariants.has(v))

  if (matchesVendor && !matchesResident) {
    return {
      senderType: "vendor",
      recipientType: "resident",
      senderId: ctx.vendorId,
    }
  }
  if (matchesResident && !matchesVendor) {
    return {
      senderType: "resident",
      recipientType: "vendor",
      senderId: ctx.residentId ?? ctx.maintenanceRequestId,
    }
  }
  return null
}

/**
 * Relay an inbound SMS on a vendor_tenant_proxy thread to the other party.
 * Called from the inbound pipeline when conversation_type is vendor_tenant_proxy.
 */
export async function relayInboundProxiedMessage(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    inboundMessageId: string
    inboundFrom: string
    body: string
    mediaUrls: string[]
  },
): Promise<SendProxiedMessageResult | { ok: false; skipped: true; reason: string }> {
  const { data: convo, error: convoErr } = await supabase
    .from("sms_conversations")
    .select(
      "id, landlord_id, unit_id, resident_id, vendor_id, maintenance_request_id, conversation_type",
    )
    .eq("id", params.conversationId)
    .maybeSingle()

  if (convoErr || !convo) {
    return { ok: false, skipped: true, reason: "conversation_not_found" }
  }
  if (convo.conversation_type !== "vendor_tenant_proxy") {
    return { ok: false, skipped: true, reason: "not_proxy_conversation" }
  }
  if (!convo.maintenance_request_id) {
    return { ok: false, skipped: true, reason: "missing_maintenance_request" }
  }

  const ctxResult = await loadProxiedTicketContext(
    supabase,
    convo.maintenance_request_id as string,
    convo.landlord_id as string,
  )
  if ("error" in ctxResult) {
    return { ok: false, skipped: true, reason: ctxResult.error }
  }

  const parties = inferProxiedParties(ctxResult, params.inboundFrom)
  if (!parties) {
    return { ok: false, skipped: true, reason: "unknown_inbound_party" }
  }

  return sendProxiedMessage(supabase, {
    maintenanceRequestId: ctxResult.maintenanceRequestId,
    senderType: parties.senderType,
    senderId: parties.senderId,
    body: params.body,
    mediaUrls: params.mediaUrls,
    recipientType: parties.recipientType,
  })
}
