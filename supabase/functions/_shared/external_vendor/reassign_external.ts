import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { reassignVendorByIdAndNotify } from "../../submit-maintenance-request/vendor_notify.ts"
import { resolveVendorIdForExternalReassign } from "./onboard.ts"
import type { ExternalVendorSource } from "./types.ts"

export type ReassignExternalVendorInput = {
  ticketId: string
  vendorName: string
  vendorCategory?: string | null
  sources?: ExternalVendorSource[]
  rating?: number | null
  reviewCount?: number | null
  priceLabel?: string | null
  rankScore?: number | null
}

export type ReassignExternalVendorOk = {
  ok: true
  ticketId: string
  assigned_vendor_id: string
  createdVendor: boolean
}

export { resolveVendorIdForExternalReassign } from "./onboard.ts"

/**
 * Onboard an external suggestion onto the landlord roster (if needed) and reassign
 * the ticket using the existing vendor notify pipeline.
 */
export async function reassignExternalVendorToTicket(
  supabase: SupabaseClient,
  input: ReassignExternalVendorInput,
): Promise<ReassignExternalVendorOk | { error: string; status?: number }> {
  const ticketId = input.ticketId.trim()
  const vendorName = input.vendorName.trim()
  if (!ticketId || !vendorName) {
    return { error: "ticketId and vendorName are required", status: 400 }
  }

  const { data: ticket, error: tErr } = await supabase
    .from("maintenance_requests")
    .select("id, landlord_id, issue_category, assigned_vendor_id")
    .eq("id", ticketId)
    .maybeSingle()

  if (tErr) {
    console.error("[reassign-external] load ticket", tErr)
    return { error: "Load ticket failed", status: 500 }
  }
  if (!ticket) return { error: "Ticket not found", status: 404 }

  const landlordId = ticket.landlord_id == null ? null : String(ticket.landlord_id).trim()
  if (!landlordId) {
    return { error: "Ticket missing landlord scope", status: 400 }
  }

  const category =
    input.vendorCategory?.trim() ||
    (ticket.issue_category == null ? null : String(ticket.issue_category).trim()) ||
    null

  const resolved = await resolveVendorIdForExternalReassign(
    supabase,
    landlordId,
    {
      vendorName: input.vendorName,
      vendorCategory: category,
      sources: input.sources,
      rating: input.rating,
      reviewCount: input.reviewCount,
      priceLabel: input.priceLabel,
      rankScore: input.rankScore,
    },
    category,
  )
  if ("error" in resolved) {
    return { error: resolved.error, status: 500 }
  }

  const vendorId = resolved.vendorId
  const createdVendor = resolved.createdVendor

  const result = await reassignVendorByIdAndNotify(supabase, ticketId, vendorId, {
    eventSource: "edge",
    notifyResident: true,
  })

  if ("error" in result) {
    const status =
      result.error === "Ticket not found" || result.error.includes("Vendor not")
        ? 404
        : 500
    return { error: result.error, status }
  }

  try {
    await logGraphEvent(supabase, {
      landlord_id: landlordId,
      event_type: "maintenance.external_vendor_reassigned",
      source: "dashboard",
      actor_type: "landlord",
      vendor_id: vendorId,
      maintenance_request_id: ticketId,
      metadata: {
        vendor_name: vendorName,
        created_vendor: createdVendor,
        external_sources: input.sources ?? [],
        previous_assigned_vendor_id: ticket.assigned_vendor_id ?? null,
      },
    })
  } catch (e) {
    console.error("[reassign-external] graph event", e)
  }

  return {
    ok: true,
    ticketId,
    assigned_vendor_id: vendorId,
    createdVendor,
  }
}
