/**
 * Detect and close open landlord vendor-choice asks for a ticket.
 * An open ask must not be contradicted by a "no vendor found" escalation.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import {
  abandonStaleLandlordVendorChoiceAsk,
  AWAITING_LANDLORD_VENDOR_CHOICE,
  readAwaitingVendorChoice,
  ticketIsAwaitingLandlordVendorChoice,
} from "./vendorLandlordChoice.ts"

export type OpenLandlordVendorAsk = {
  open: boolean
  previousVendorName: string | null
  sources: Array<"ticket_flag" | "pick_batch" | "intake">
}

export async function loadOpenLandlordVendorAsk(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<OpenLandlordVendorAsk> {
  const id = ticketId.trim()
  if (!id) return { open: false, previousVendorName: null, sources: [] }

  const sources: OpenLandlordVendorAsk["sources"] = []
  let previousVendorName: string | null = null

  const { data: ticket } = await supabase
    .from("maintenance_requests")
    .select("vendor_notify_error")
    .eq("id", id)
    .maybeSingle()
  if (
    ticketIsAwaitingLandlordVendorChoice(
      typeof ticket?.vendor_notify_error === "string"
        ? ticket.vendor_notify_error
        : null,
    )
  ) {
    sources.push("ticket_flag")
  }

  const { data: batchItems } = await supabase
    .from("landlord_pick_batch_items")
    .select("batch_id, snapshot")
    .eq("ticket_id", id)
    .limit(20)
  const batchIds = [
    ...new Set(
      (batchItems ?? [])
        .map((row) => (typeof row.batch_id === "string" ? row.batch_id : ""))
        .filter(Boolean),
    ),
  ]
  if (batchIds.length > 0) {
    const { data: openBatches } = await supabase
      .from("landlord_pick_batches")
      .select("id")
      .in("id", batchIds)
      .eq("status", "open")
    const openIds = new Set((openBatches ?? []).map((row) => String(row.id)))
    for (const row of batchItems ?? []) {
      if (!openIds.has(String(row.batch_id))) continue
      sources.push("pick_batch")
      const snap = row.snapshot as { vendor_name?: string | null } | null
      const name = typeof snap?.vendor_name === "string" ? snap.vendor_name.trim() : ""
      if (
        name &&
        name.toLowerCase() !== "needs a vendor" &&
        name.toLowerCase() !== "your vendor"
      ) {
        previousVendorName = previousVendorName || name
      }
    }
  }

  const { data: convos } = await supabase
    .from("sms_conversations")
    .select("id, intake_state")
    .eq("maintenance_request_id", id)
    .order("updated_at", { ascending: false })
    .limit(10)
  for (const row of convos ?? []) {
    const prior =
      row.intake_state && typeof row.intake_state === "object"
        ? (row.intake_state as Record<string, unknown>)
        : {}
    const awaiting = readAwaitingVendorChoice(prior)
    if (awaiting?.ticketId === id) {
      sources.push("intake")
      const first = awaiting.options?.[0]?.name?.trim()
      if (first) previousVendorName = previousVendorName || first
    }
  }

  // Deduplicate sources while preserving order
  const unique = [...new Set(sources)]
  return {
    open: unique.length > 0,
    previousVendorName,
    sources: unique,
  }
}

export async function ticketHasOpenLandlordVendorAsk(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<boolean> {
  const ask = await loadOpenLandlordVendorAsk(supabase, ticketId)
  return ask.open
}

/**
 * Close every open landlord ask for this ticket so a later YES cannot approve
 * a withdrawn vendor. Marks open pick-batches that include the ticket as
 * superseded and clears the ticket/intake awaiting flag.
 */
export async function supersedeOpenLandlordVendorAskForTicket(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    landlordId: string
    reason?: string
  },
): Promise<{ closed: boolean; previousVendorName: string | null }> {
  const ticketId = params.ticketId.trim()
  const landlordId = params.landlordId.trim()
  if (!ticketId || !landlordId) {
    return { closed: false, previousVendorName: null }
  }

  const before = await loadOpenLandlordVendorAsk(supabase, ticketId)
  if (!before.open) {
    return { closed: false, previousVendorName: null }
  }

  const now = new Date().toISOString()
  const { data: batchItems } = await supabase
    .from("landlord_pick_batch_items")
    .select("batch_id")
    .eq("ticket_id", ticketId)
    .limit(40)
  const candidateBatchIds = [
    ...new Set(
      (batchItems ?? [])
        .map((row) => (typeof row.batch_id === "string" ? row.batch_id : ""))
        .filter(Boolean),
    ),
  ]
  if (candidateBatchIds.length > 0) {
    await supabase
      .from("landlord_pick_batches")
      .update({ status: "superseded", superseded_at: now })
      .in("id", candidateBatchIds)
      .eq("status", "open")
  }

  await abandonStaleLandlordVendorChoiceAsk(supabase, ticketId)

  try {
    await recordActivityLog(supabase, {
      landlordId,
      eventType: "maintenance.landlord_vendor_ask_superseded",
      source: "automation",
      actorType: "system",
      maintenanceRequestId: ticketId,
      metadata: {
        message: params.reason?.trim() ||
          "Closed the open vendor approval ask before sending a new landlord message.",
        previous_vendor_name: before.previousVendorName,
        sources: before.sources,
        flag: AWAITING_LANDLORD_VENDOR_CHOICE,
      },
    })
  } catch (e) {
    console.warn("[open-landlord-ask] activity log", e)
  }

  return { closed: true, previousVendorName: before.previousVendorName }
}
