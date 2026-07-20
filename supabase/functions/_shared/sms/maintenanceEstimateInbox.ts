/**
 * Mirror vendor estimate submit into the job SMS conversation so Communication
 * inbox / work-order threads show the estimate for admin take-over and approval.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { normalizeSmsPhone } from "./inbound_db.ts"
import { resolveOutboundLandlordSmsLine } from "./landlordSmsOnboarding.ts"
import { formatWorkOrderRef } from "../vendor_outreach_copy.ts"

export const MAINTENANCE_ESTIMATE_SUBMITTED_SOURCE = "maintenance_estimate_submitted"

export function isMaintenanceEstimateSubmittedBody(text: string): boolean {
  return /submitted an estimate for this job|estimate submitted for approval/i.test(
    text,
  )
}

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" })
}

export function buildMaintenanceEstimateSubmittedInboxBody(input: {
  workOrderRef: string
  unit: string
  partsCost: number
  laborCost: number
  totalCost: number
  notes?: string | null
}): string {
  const lines = [
    "I've submitted an estimate for this job.",
    "",
    `Work order: ${input.workOrderRef}`,
  ]
  if (input.unit.trim()) {
    lines.push(`Unit: ${input.unit.trim()}`)
  }
  lines.push(
    `Parts: ${money(input.partsCost)}`,
    `Labor: ${money(input.laborCost)}`,
    `Total: ${money(input.totalCost)}`,
  )
  if (input.notes?.trim()) {
    lines.push(`Notes: ${input.notes.trim()}`)
  }
  lines.push("", "Waiting for your approval.")
  return lines.join("\n")
}

export async function resolveVendorJobConversationId(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    vendorId: string
    vendorPhone?: string | null
  },
): Promise<string | null> {
  const { data: byTicket } = await supabase
    .from("sms_conversations")
    .select("id")
    .eq("landlord_id", params.landlordId)
    .eq("maintenance_request_id", params.ticketId)
    .eq("conversation_type", "vendor_alert")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (byTicket?.id) return byTicket.id as string

  const { data: byVendorTicket } = await supabase
    .from("sms_conversations")
    .select("id")
    .eq("landlord_id", params.landlordId)
    .eq("maintenance_request_id", params.ticketId)
    .eq("vendor_id", params.vendorId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (byVendorTicket?.id) return byVendorTicket.id as string

  const phone = normalizeSmsPhone(params.vendorPhone ?? "")
  if (phone) {
    const { data: byPhone } = await supabase
      .from("sms_conversations")
      .select("id")
      .eq("landlord_id", params.landlordId)
      .eq("external_phone_number", phone)
      .eq("conversation_type", "vendor_alert")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (byPhone?.id) return byPhone.id as string
  }

  return null
}

/**
 * Append an outbound admin decision status update to the vendor job thread.
 * Ensures Communication shows the update even if SMS routing lands elsewhere.
 * Idempotent per estimate id + decision.
 */
export async function appendEstimateDecisionStatusToVendorThread(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    vendorId: string
    vendorPhone?: string | null
    estimateId: string
    decision: "approved" | "rejected"
    body: string
  },
): Promise<{ conversationId: string | null; messageId: string | null }> {
  try {
    const conversationId = await resolveVendorJobConversationId(supabase, params)
    if (!conversationId) {
      console.warn("[maintenanceEstimateInbox] no vendor thread for decision status", {
        estimateId: params.estimateId,
        ticketId: params.ticketId,
      })
      return { conversationId: null, messageId: null }
    }

    const { data: conv } = await supabase
      .from("sms_conversations")
      .select("id, external_phone_number, vendor_id")
      .eq("id", conversationId)
      .eq("landlord_id", params.landlordId)
      .maybeSingle()

    if (!conv?.id) {
      return { conversationId: null, messageId: null }
    }

    const line = await resolveOutboundLandlordSmsLine(supabase, params.landlordId)
    const uloNumber = line?.phone ? normalizeSmsPhone(line.phone) : null
    const vendorPhone = normalizeSmsPhone(
      params.vendorPhone || (conv.external_phone_number as string) || "",
    )
    const sid = `maintenance-estimate-decision:${params.estimateId}:${params.decision}`
    const nowIso = new Date().toISOString()

    const { data: inserted, error } = await supabase
      .from("sms_messages")
      .insert({
        conversation_id: conversationId,
        landlord_id: params.landlordId,
        direction: "outbound",
        from_number: uloNumber || "unknown",
        to_number: vendorPhone || "unknown",
        body: params.body,
        media_urls: [],
        provider: line?.provider === "telnyx" ? "telnyx" : "twilio",
        provider_message_sid: sid,
        provider_status: "sent",
        raw_payload: {
          source: "maintenance_estimate_decision",
          estimate_id: params.estimateId,
          decision: params.decision,
          mirrored_for_inbox: true,
        },
      })
      .select("id")
      .single()

    if (error || !inserted?.id) {
      if (error && /duplicate|unique/i.test(error.message)) {
        const { data: existing } = await supabase
          .from("sms_messages")
          .select("id")
          .eq("provider_message_sid", sid)
          .maybeSingle()
        return {
          conversationId,
          messageId: (existing?.id as string | undefined) ?? null,
        }
      }
      console.error(
        "[maintenanceEstimateInbox] decision status insert",
        error?.message,
      )
      return { conversationId, messageId: null }
    }

    await supabase
      .from("sms_conversations")
      .update({
        updated_at: nowIso,
        status: "open",
        vendor_id: params.vendorId ?? conv.vendor_id ?? null,
        maintenance_request_id: params.ticketId,
      })
      .eq("id", conversationId)
      .eq("landlord_id", params.landlordId)

    return { conversationId, messageId: inserted.id as string }
  } catch (err) {
    console.error("[maintenanceEstimateInbox] decision status append failed", err)
    return { conversationId: null, messageId: null }
  }
}

/**
 * Append an inbound "estimate submitted" message to the vendor job thread.
 * Best-effort: never throws; idempotent per estimate id.
 */
export async function appendMaintenanceEstimateSubmittedToInbox(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    vendorId: string
    vendorPhone?: string | null
    estimateId: string
    partsCost: number
    laborCost: number
    totalCost: number
    notes?: string | null
    unit?: string | null
  },
): Promise<{ conversationId: string | null; messageId: string | null }> {
  try {
    const conversationId = await resolveVendorJobConversationId(supabase, params)
    if (!conversationId) {
      console.warn("[maintenanceEstimateInbox] no vendor job conversation", {
        estimateId: params.estimateId,
        ticketId: params.ticketId,
      })
      return { conversationId: null, messageId: null }
    }

    const { data: conv } = await supabase
      .from("sms_conversations")
      .select("id, external_phone_number, vendor_id, intake_state")
      .eq("id", conversationId)
      .eq("landlord_id", params.landlordId)
      .maybeSingle()

    if (!conv?.id) {
      return { conversationId: null, messageId: null }
    }

    const line = await resolveOutboundLandlordSmsLine(supabase, params.landlordId)
    const uloNumber = line?.phone ? normalizeSmsPhone(line.phone) : null
    const vendorPhone = normalizeSmsPhone(
      params.vendorPhone || (conv.external_phone_number as string) || "",
    )

    const body = buildMaintenanceEstimateSubmittedInboxBody({
      workOrderRef: formatWorkOrderRef(params.ticketId),
      unit: typeof params.unit === "string" ? params.unit : "",
      partsCost: params.partsCost,
      laborCost: params.laborCost,
      totalCost: params.totalCost,
      notes: params.notes,
    })

    const sid = `maintenance-estimate-submit:${params.estimateId}`
    const nowIso = new Date().toISOString()
    const { data: inserted, error } = await supabase
      .from("sms_messages")
      .insert({
        conversation_id: conversationId,
        landlord_id: params.landlordId,
        direction: "inbound",
        from_number: vendorPhone || "unknown",
        to_number: uloNumber || "unknown",
        body,
        media_urls: [],
        provider: line?.provider === "telnyx" ? "telnyx" : "twilio",
        provider_message_sid: sid,
        provider_status: "received",
        raw_payload: {
          source: MAINTENANCE_ESTIMATE_SUBMITTED_SOURCE,
          estimate_id: params.estimateId,
          maintenance_request_id: params.ticketId,
          simulated_inbound: true,
        },
      })
      .select("id")
      .single()

    if (error || !inserted?.id) {
      if (error && /duplicate|unique/i.test(error.message)) {
        const { data: existing } = await supabase
          .from("sms_messages")
          .select("id")
          .eq("provider_message_sid", sid)
          .maybeSingle()
        return {
          conversationId,
          messageId: (existing?.id as string | undefined) ?? null,
        }
      }
      console.error("[maintenanceEstimateInbox] sms_messages insert", error?.message)
      return { conversationId, messageId: null }
    }

    const priorIntake =
      conv.intake_state && typeof conv.intake_state === "object"
        ? (conv.intake_state as Record<string, unknown>)
        : {}

    await supabase
      .from("sms_conversations")
      .update({
        updated_at: nowIso,
        status: "open",
        vendor_id: params.vendorId ?? conv.vendor_id ?? null,
        maintenance_request_id: params.ticketId,
        intake_state: {
          ...priorIntake,
          awaiting_estimate_decision: {
            estimate_id: params.estimateId,
            ticket_id: params.ticketId,
          },
        },
      })
      .eq("id", conversationId)
      .eq("landlord_id", params.landlordId)

    return { conversationId, messageId: inserted.id as string }
  } catch (err) {
    console.error("[maintenanceEstimateInbox] append failed", err)
    return { conversationId: null, messageId: null }
  }
}
