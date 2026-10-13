/**
 * Builds one landlord SMS for every non-urgent ticket waiting on a pick.
 * Urgent tickets stay on the single-ticket ask.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  buildLandlordPickBatchSms,
  LANDLORD_PICK_BATCH_COOLDOWN_MS,
  LANDLORD_PICK_BATCH_LIMIT,
  landlordPickBatchShouldQueue,
  type LandlordPickBatchItem,
} from "../../../../shared/landlordDecisions/batchMessage.ts"
import { resolveUrgencyPolicy } from "../../../../shared/maintenance/urgencyPolicy.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { findActiveLandlordMainNumber } from "./landlordSmsOnboarding.ts"
import {
  findOrCreateConversation,
  normalizeSmsPhone,
  upsertSmsIdentityForPhone,
} from "./inbound_db.ts"
import { getSMSProviderForSend } from "./providerFactory.ts"
import { resolveLandlordOpsPhones } from "./tenantActivationAdminAlert.ts"
import { AWAITING_LANDLORD_VENDOR_CHOICE } from "./awaitingLandlordVendorChoice.ts"

export function isUrgentLandlordPick(text: string): boolean {
  return resolveUrgencyPolicy({ text }).band === "emergency"
}

export function ticketClassForLandlordPick(residentId?: string | null): "reactive" | "proactive" {
  return residentId?.trim() ? "reactive" : "proactive"
}

type ChoiceOption = {
  id: string
  name: string
  windowLabel?: string | null
  estimateNote?: string | null
}

function estimateBounds(note?: string | null): { low: number | null; high: number | null } {
  const amounts = (note ?? "").match(/\d+(?:\.\d+)?/g)?.map(Number) ?? []
  if (amounts.length === 0) return { low: null, high: null }
  if (amounts.length === 1) return { low: amounts[0]!, high: amounts[0]! }
  return { low: Math.min(...amounts), high: Math.max(...amounts) }
}

export async function routeNonUrgentTicketIntoPickBatch(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    unit?: string | null
    issue?: string | null
    options: ChoiceOption[]
  },
): Promise<"urgent" | "batched" | "queued" | "fallback"> {
  const primary = params.options[0]
  if (!primary?.id) return "fallback"

  const { data: ticket, error } = await supabase
    .from("maintenance_requests")
    .select("id, display_id, description, issue_headline, unit, resident_id, created_at, snoozed_until")
    .eq("id", params.ticketId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()
  if (error || !ticket?.id) return "fallback"

  const text = [ticket.issue_headline, ticket.description, params.issue].filter(Boolean).join("\n")
  if (isUrgentLandlordPick(text)) return "urgent"

  const { data: waiting, error: waitingError } = await supabase
    .from("maintenance_requests")
    .select("id, display_id, description, issue_headline, unit, resident_id, created_at, snoozed_until")
    .eq("landlord_id", params.landlordId)
    .eq("vendor_notify_error", AWAITING_LANDLORD_VENDOR_CHOICE)
    .order("created_at", { ascending: true })
    .limit(20)
  if (waitingError) return "fallback"

  const now = new Date()
  const rows = (waiting ?? []).filter((row) => {
    if (row.snoozed_until && new Date(String(row.snoozed_until)).getTime() > now.getTime()) {
      return false
    }
    const rowText = [row.issue_headline, row.description].filter(Boolean).join("\n")
    return !isUrgentLandlordPick(rowText)
  })
  if (!rows.some((row) => row.id === params.ticketId)) {
    rows.push(ticket)
  }
  rows.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))

  const items: BatchItemDraft[] = rows.slice(0, LANDLORD_PICK_BATCH_LIMIT).map((row) => {
    const own = row.id === params.ticketId
    const costs = estimateBounds(own ? primary.estimateNote : null)
    return {
      displayId: Number(row.display_id),
      unitLabel: typeof row.unit === "string" ? row.unit : params.unit,
      issue: (typeof row.issue_headline === "string" && row.issue_headline.trim()) ||
        (own ? params.issue?.trim() : "") ||
        "Repair",
      vendorName: own ? primary.name : "your vendor",
      windowLabel: own ? primary.windowLabel : null,
      costLow: costs.low,
      costHigh: costs.high,
      ticketId: row.id,
      vendorId: own ? primary.id : null,
      ticketClass: ticketClassForLandlordPick(
        typeof row.resident_id === "string" ? row.resident_id : null,
      ),
    }
  })
  const overflow = Math.max(0, rows.length - LANDLORD_PICK_BATCH_LIMIT)
  const body = buildLandlordPickBatchSms(items, overflow)

  const { phones } = await resolveLandlordOpsPhones(supabase, params.landlordId)
  if (phones.length === 0) return "fallback"
  let queued = false
  let sent = false
  for (const phone of phones) {
    const outcome = await sendOrQueueBatch(supabase, {
      landlordId: params.landlordId,
      phone,
      body,
      items,
      now,
    })
    if (outcome === "queued") queued = true
    if (outcome === "sent") sent = true
  }
  if (sent) {
    await recordActivityLog(supabase, {
      landlordId: params.landlordId,
      eventType: "maintenance.landlord_pick_batch_sent",
      source: "automation",
      actorType: "system",
      maintenanceRequestId: params.ticketId,
      metadata: {
        message: `Texted ${items.length} requests that need a decision.`,
      },
    })
    return "batched"
  }
  return queued ? "queued" : "fallback"
}

type BatchItemDraft = LandlordPickBatchItem & {
  ticketId: string
  vendorId: string | null
  ticketClass: "reactive" | "proactive"
}

async function sendOrQueueBatch(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    phone: string
    body: string
    items: BatchItemDraft[]
    now: Date
  },
): Promise<"sent" | "queued" | "fallback"> {
  const phone = normalizeSmsPhone(params.phone)
  const { data: recent } = await supabase
    .from("landlord_pick_batches")
    .select("id, created_at, status")
    .eq("landlord_id", params.landlordId)
    .eq("recipient_phone", phone)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const lastSentAt = recent?.created_at ? new Date(String(recent.created_at)) : null
  const queue = landlordPickBatchShouldQueue(lastSentAt, params.now)
  if (recent?.id && !queue) {
    await supabase
      .from("landlord_pick_batches")
      .update({ status: "superseded", superseded_at: params.now.toISOString() })
      .eq("id", recent.id)
  }

  const { data: batch, error } = await supabase
    .from("landlord_pick_batches")
    .insert({
      landlord_id: params.landlordId,
      recipient_phone: phone,
      status: queue ? "queued" : "open",
      send_after: queue
        ? new Date(params.now.getTime() + LANDLORD_PICK_BATCH_COOLDOWN_MS).toISOString()
        : null,
    })
    .select("id")
    .maybeSingle()
  if (error || !batch?.id) return "fallback"

  const itemRows = params.items.filter((item) => Number.isInteger(item.displayId) && item.displayId > 0).map((item, index) => ({
    batch_id: batch.id,
    ticket_id: item.ticketId,
    display_id: item.displayId,
    position: index,
    snapshot: {
      vendor_id: item.vendorId,
      vendor_name: item.vendorName,
      window: item.windowLabel ?? null,
      cost_low: item.costLow ?? null,
      cost_high: item.costHigh ?? null,
      ticket_class: item.ticketClass,
    },
  }))
  if (itemRows.length === 0) return "fallback"
  const { error: itemError } = await supabase.from("landlord_pick_batch_items").insert(itemRows)
  if (itemError) return "fallback"
  if (queue) return "queued"

  const main = await findActiveLandlordMainNumber(supabase, params.landlordId)
  const provider = getSMSProviderForSend({
    landlordId: params.landlordId,
    lineProvider: main?.provider,
  })
  const sendResult = await provider.sendMessage({
    to: phone,
    body: params.body,
    from: main?.phone_number,
  })
  if (sendResult.error) return "fallback"

  const identity = await upsertSmsIdentityForPhone(supabase, {
    landlordId: params.landlordId,
    phone,
    identityType: "landlord",
  })
  let conversationId: string | null = null
  let messageId: string | null = null
  if (identity && main?.id) {
    const conversation = await findOrCreateConversation(supabase, {
      landlordId: params.landlordId,
      smsNumberId: main.id,
      externalPhone: phone,
      identity,
      maintenanceRequestId: params.items[0]?.ticketId ?? null,
      conversationStatus: "open",
    })
    conversationId = conversation.conversationId
    const inserted = await supabase
      .from("sms_messages")
      .insert({
        conversation_id: conversationId,
        landlord_id: params.landlordId,
        direction: "outbound",
        from_number: normalizeSmsPhone(main.phone_number ?? "unknown"),
        to_number: phone,
        body: params.body,
        media_urls: [],
        provider: sendResult.provider ?? "twilio",
        provider_message_sid: sendResult.providerMessageSid ?? sendResult.messageId ??
          `landlord-pick-batch:${batch.id}`,
        provider_status: "sent",
        raw_payload: { source: "landlord_pick_batch" },
      })
      .select("id")
      .maybeSingle()
    messageId = inserted.data?.id ? String(inserted.data.id) : null
  }

  await supabase
    .from("landlord_pick_batches")
    .update({
      conversation_id: conversationId,
      outbound_message_id: messageId,
    })
    .eq("id", batch.id)
  return "sent"
}
