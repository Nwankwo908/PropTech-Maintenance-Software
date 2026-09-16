/**
 * Vendor dispatch after the resident confirms the request (SMS YES / web submit).
 *
 * Drafts must not assign, notify vendors, search Thumbtack, or text the landlord
 * about vendor choice. Confirmation is the only entry into this pipeline.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import {
  escalateMaintenanceNeedsVendor,
  SUBMITTED_NO_VENDOR_ESCALATION,
} from "./maintenance_admin_escalation.ts"
import {
  assignVendorAndNotify,
  type AssignVendorResult,
  type TicketNotifyPayload,
} from "../submit-maintenance-request/vendor_notify.ts"

export type ConfirmedDispatchKind =
  | "vendor_assigned"
  | "preferred_selection_underway"
  | "nearby_options_sent"
  | "landlord_manual"
  | "dispatch_error"

export type ConfirmedDispatchOutcome = {
  kind: ConfirmedDispatchKind
  vendorId: string | null
  vendorAssigned: boolean
  nearbyOptionCount: number
  error?: string
}

/**
 * Nearby search is based on the business condition, not skipReason === "no_vendor".
 * Confirmed ticket + no assigned vendor + no live preferred-vendor choice = search nearby.
 * Leftover notify flags are ignored; caller must pass residentConfirmed so assign refreshes.
 */
export function confirmedTicketNeedsNearbySearch(result: AssignVendorResult): boolean {
  if (result.assigned && result.vendorId) return false
  if (result.skipReason === "ticket_missing") return false
  if (result.skipReason === "awaiting_landlord_choice") return false
  return true
}

export function isCompleteConfirmedDispatch(kind: ConfirmedDispatchKind): boolean {
  return kind !== "dispatch_error"
}

export async function dispatchConfirmedMaintenanceTicket(
  supabase: SupabaseClient,
  payload: TicketNotifyPayload & { landlordId: string },
): Promise<ConfirmedDispatchOutcome> {
  const landlordId = payload.landlordId.trim()
  const ticketId = payload.ticketId

  let assign: AssignVendorResult
  try {
    assign = await assignVendorAndNotify(supabase, {
      ...payload,
      landlordId,
      residentConfirmed: true,
      retryIfUnassigned: true,
      refreshLandlordChoice: true,
    })
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error("[confirmed-dispatch] preferred vendor step failed", error)
    return finishIncomplete(supabase, {
      landlordId,
      ticketId,
      error,
    })
  }

  if (assign.assigned && assign.vendorId) {
    return {
      kind: "vendor_assigned",
      vendorId: assign.vendorId,
      vendorAssigned: true,
      nearbyOptionCount: 0,
    }
  }

  if (assign.skipReason === "ticket_missing") {
    return finishIncomplete(supabase, {
      landlordId,
      ticketId,
      error: "ticket_missing",
    })
  }

  if (assign.skipReason === "awaiting_landlord_choice") {
    return {
      kind: "preferred_selection_underway",
      vendorId: null,
      vendorAssigned: false,
      nearbyOptionCount: 0,
    }
  }

  if (!confirmedTicketNeedsNearbySearch(assign)) {
    return finishIncomplete(supabase, {
      landlordId,
      ticketId,
      error: assign.skipReason ?? "dispatch_incomplete",
    })
  }

  try {
    const nearby = await escalateMaintenanceNeedsVendor(
      supabase,
      { id: ticketId, landlord_id: landlordId },
      SUBMITTED_NO_VENDOR_ESCALATION,
    )
    const sent = Boolean(
      nearby?.attention &&
        (nearby.attention.smsSent.length > 0 ||
          nearby.attention.emailSent.length > 0 ||
          nearby.attention.reason === "already_sent"),
    )
    if ((nearby?.nearbyOptionCount ?? 0) > 0) {
      return {
        kind: "nearby_options_sent",
        vendorId: null,
        vendorAssigned: false,
        nearbyOptionCount: nearby.nearbyOptionCount,
      }
    }
    if (sent) {
      return {
        kind: "landlord_manual",
        vendorId: null,
        vendorAssigned: false,
        nearbyOptionCount: 0,
      }
    }
    if (
      nearby?.attention?.skipped &&
      nearby.attention.reason &&
      nearby.attention.reason !== "already_sent"
    ) {
      return finishIncomplete(supabase, {
        landlordId,
        ticketId,
        error: nearby.attention.reason,
        nearbyOptionCount: nearby.nearbyOptionCount,
      })
    }
    return {
      kind: "landlord_manual",
      vendorId: null,
      vendorAssigned: false,
      nearbyOptionCount: nearby?.nearbyOptionCount ?? 0,
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error("[confirmed-dispatch] nearby vendor step failed", error)
    return finishIncomplete(supabase, {
      landlordId,
      ticketId,
      error,
    })
  }
}

async function finishIncomplete(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    error: string
    nearbyOptionCount?: number
  },
): Promise<ConfirmedDispatchOutcome> {
  try {
    await recordActivityLog(supabase, {
      landlordId: params.landlordId,
      eventType: "maintenance.dispatch_incomplete",
      source: "automation",
      actorType: "system",
      maintenanceRequestId: params.ticketId,
      metadata: {
        message:
          "This confirmed request did not finish vendor selection. Ulo will keep it in Needs Your Attention.",
        error: params.error,
      },
    })
  } catch (e) {
    console.error("[confirmed-dispatch] incomplete log failed", e)
  }
  try {
    await escalateMaintenanceNeedsVendor(
      supabase,
      { id: params.ticketId, landlord_id: params.landlordId },
      SUBMITTED_NO_VENDOR_ESCALATION,
    )
  } catch (e) {
    console.error("[confirmed-dispatch] incomplete escalate failed", e)
  }
  return {
    kind: "dispatch_error",
    vendorId: null,
    vendorAssigned: false,
    nearbyOptionCount: params.nearbyOptionCount ?? 0,
    error: params.error,
  }
}
