import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  findActiveLandlordMainNumber,
  resolveLandlordId,
  resolveOutboundLandlordSmsLine,
  type LandlordSmsNumberRow,
} from "./landlordSmsOnboarding.ts"
import {
  findOrCreateConversation,
  normalizeSmsPhone,
  upsertSmsIdentityForPhone,
  type SmsIdentityRow,
} from "./inbound_db.ts"
import { getSMSProviderForSend } from "./providerFactory.ts"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import {
  extractWorkOrderRefFromSms,
  workOrderRefMatchesTicket,
  type VendorOpenJobSmsLine,
} from "../vendor_outreach_copy.ts"
import {
  listVendorActiveJobs,
  matchActiveJobsFromReply,
  withPendingVendorJobOffer,
  type VendorActiveJob,
} from "./vendorWorkOrderClarification.ts"

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
  params: { conversationId: string; ticketId: string; vendorId: string },
): Promise<void> {
  const { data: convo } = await supabase
    .from("sms_conversations")
    .select("intake_state, maintenance_request_id")
    .eq("id", params.conversationId)
    .maybeSingle()

  let intake =
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

  intake = withPendingVendorJobOffer(intake, {
    ticketId: params.ticketId,
    vendorId: params.vendorId,
    sentAt: new Date().toISOString(),
  })
  changed = true

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
  const line = await resolveOutboundLandlordSmsLine(supabase, scopedLandlordId)
  if (line) {
    return {
      id: line.id,
      landlord_id: scopedLandlordId,
      phone_number: line.phone,
      provider: line.provider,
      provider_number_sid: null,
      provider_messaging_service_sid: null,
      status: "active",
      purpose: "landlord_main",
    }
  }
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
      vendorId: params.vendorId,
    })
  } catch (e) {
    console.error("[vendorSms] clear stale thread state", e)
  }

  if (
    identity.identity_type !== "resident" &&
    identity.identity_type !== "landlord" &&
    identity.vendor_id !== params.vendorId
  ) {
    const { error: identityErr } = await supabase
      .from("sms_identities")
      .update({
        vendor_id: params.vendorId,
        identity_type: "vendor",
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", identity.id)
    if (identityErr) {
      console.warn(
        "[vendorSms] could not align SMS identity with assigned vendor",
        identityErr.message,
      )
    } else {
      identity.vendor_id = params.vendorId
    }
  }

  await ensureAssignedOfferRow(supabase, {
    ticketId: params.ticketId,
    vendorId: params.vendorId,
  })

  const provider = getSMSProviderForSend({
    landlordId,
    lineProvider: senderNumber.provider,
  })
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

const BINDABLE_OFFER_STATUSES = new Set([
  "pending_accept",
  "accepted",
  "in_progress",
  "unassigned",
])

async function loadBindableOfferTicket(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<{ ticketId: string; status: string } | null> {
  const { data } = await supabase
    .from("maintenance_requests")
    .select("id, assigned_vendor_id, vendor_work_status")
    .eq("id", ticketId)
    .maybeSingle()
  if (!data?.id) return null
  const assigned =
    typeof data.assigned_vendor_id === "string"
      ? data.assigned_vendor_id.trim()
      : ""
  const status = String(data.vendor_work_status ?? "").trim().toLowerCase()
  if (!assigned || !BINDABLE_OFFER_STATUSES.has(status)) return null
  return { ticketId: String(data.id), status }
}

/** Persist assigned_vendor_id + pending_accept together when the offer SMS goes out. */
async function ensureAssignedOfferRow(
  supabase: SupabaseClient,
  params: { ticketId: string; vendorId: string },
): Promise<void> {
  const { data: ticket, error } = await supabase
    .from("maintenance_requests")
    .select("id, assigned_vendor_id, vendor_work_status, vendor_action_token")
    .eq("id", params.ticketId)
    .maybeSingle()
  if (error || !ticket) {
    console.warn("[vendorSms] offer-row lookup failed", error?.message)
    return
  }

  const assigned =
    typeof ticket.assigned_vendor_id === "string"
      ? ticket.assigned_vendor_id.trim()
      : ""
  const status = String(ticket.vendor_work_status ?? "").trim().toLowerCase()
  const patch: Record<string, unknown> = {}
  const now = new Date().toISOString()

  if (!assigned) {
    patch.assigned_vendor_id = params.vendorId
    patch.assigned_at = now
    if (status === "unassigned" || status === "") {
      patch.vendor_work_status = "pending_accept"
    }
  } else if (
    assigned === params.vendorId &&
    (status === "unassigned" || status === "")
  ) {
    patch.vendor_work_status = "pending_accept"
  }

  const existingToken =
    typeof ticket.vendor_action_token === "string"
      ? ticket.vendor_action_token.trim()
      : ""
  if (!existingToken) {
    patch.vendor_action_token = crypto.randomUUID()
  }

  if (Object.keys(patch).length === 0) return

  const { error: upErr } = await supabase
    .from("maintenance_requests")
    .update(patch)
    .eq("id", params.ticketId)
  if (upErr) {
    console.error("[vendorSms] ensure assigned offer row", upErr.message)
  }
}

function toOpenJobSmsLines(jobs: VendorActiveJob[]): VendorOpenJobSmsLine[] {
  return jobs.map((j) => ({
    ticketId: j.ticketId,
    workOrderRef: j.workOrderRef,
    unit: j.unit,
    building: j.building,
    issueCategory: j.issueCategory,
    description: j.description,
  }))
}

export async function listVendorOpenJobs(
  supabase: SupabaseClient,
  vendorId: string,
): Promise<VendorOpenJobSmsLine[]> {
  return toOpenJobSmsLines(await listVendorActiveJobs(supabase, vendorId))
}

export type ResolveVendorTicketForInboundResult =
  | {
      ok: true
      ticketId: string
      boundBy: string
      openJobs: VendorActiveJob[]
    }
  | {
      ok: false
      reason: "need_work_order" | "unknown_work_order" | "no_open_jobs"
      openJobs: VendorActiveJob[]
    }

/**
 * Bind an inbound vendor SMS to a specific work order.
 * Never falls back to "most recent open job" when multiple are active.
 */
export async function resolveVendorTicketForInbound(
  supabase: SupabaseClient,
  params: {
    vendorId: string
    inboundBody: string
    /** Mid-flow schedule FSM already tied to a ticket. */
    scheduleTicketId?: string | null
    /** Ticket pinned on this SMS thread (assignment offer). */
    conversationTicketId?: string | null
    /** Last job-offer written on the thread intake_state. */
    pendingOfferTicketId?: string | null
    /** Optional preloaded jobs (avoids a second query). */
    openJobs?: VendorActiveJob[]
  },
): Promise<ResolveVendorTicketForInboundResult> {
  const openJobs = params.openJobs ??
    (await listVendorActiveJobs(supabase, params.vendorId))

  const scheduleTicketId = params.scheduleTicketId?.trim() || null
  if (scheduleTicketId) {
    const stillOpen = openJobs.some((j) => j.ticketId === scheduleTicketId)
    if (stillOpen || (await ticketStillExists(supabase, scheduleTicketId))) {
      return {
        ok: true,
        ticketId: scheduleTicketId,
        boundBy: "schedule_fsm",
        openJobs,
      }
    }
  }

  const threadTicketId =
    params.conversationTicketId?.trim() ||
    params.pendingOfferTicketId?.trim() ||
    null

  const match = openJobs.length > 0
    ? matchActiveJobsFromReply(params.inboundBody, openJobs)
    : { kind: "none" as const }

  if (match.kind === "unique") {
    return {
      ok: true,
      ticketId: match.job.ticketId,
      boundBy: match.boundBy,
      openJobs,
    }
  }

  if (match.kind === "ambiguous") {
    return { ok: false, reason: "need_work_order", openJobs: match.jobs }
  }

  if (openJobs.length === 1) {
    return {
      ok: true,
      ticketId: openJobs[0].ticketId,
      boundBy: "single_open_job",
      openJobs,
    }
  }

  if (threadTicketId) {
    const inOpen = openJobs.some((j) => j.ticketId === threadTicketId)
    const loaded = inOpen
      ? { ticketId: threadTicketId }
      : await loadBindableOfferTicket(supabase, threadTicketId)
    if (loaded) {
      return {
        ok: true,
        ticketId: loaded.ticketId,
        boundBy: "conversation_pin",
        openJobs,
      }
    }
  }

  if (openJobs.length === 0) {
    return { ok: false, reason: "no_open_jobs", openJobs }
  }

  const wo = extractWorkOrderRefFromSms(params.inboundBody)
  if (wo) {
    if (
      threadTicketId &&
      workOrderRefMatchesTicket(wo, threadTicketId)
    ) {
      const loaded = await loadBindableOfferTicket(supabase, threadTicketId)
      if (loaded) {
        return {
          ok: true,
          ticketId: loaded.ticketId,
          boundBy: "conversation_pin",
          openJobs,
        }
      }
    }
    return { ok: false, reason: "unknown_work_order", openJobs }
  }

  return { ok: false, reason: "need_work_order", openJobs }
}

/**
 * @deprecated Prefer resolveVendorTicketForInbound — does not guess among multiple jobs.
 * Kept for narrow callers that only need a single unambiguous open ticket.
 */
export async function resolveVendorMaintenanceRequestId(
  supabase: SupabaseClient,
  params: {
    vendorId: string
    conversationId?: string | null
    conversationMaintenanceRequestId?: string | null
    inboundBody?: string | null
    scheduleTicketId?: string | null
  },
): Promise<string | null> {
  const resolved = await resolveVendorTicketForInbound(supabase, {
    vendorId: params.vendorId,
    inboundBody: params.inboundBody ?? "",
    scheduleTicketId: params.scheduleTicketId,
    conversationTicketId: params.conversationMaintenanceRequestId,
  })
  return resolved.ok ? resolved.ticketId : null
}
