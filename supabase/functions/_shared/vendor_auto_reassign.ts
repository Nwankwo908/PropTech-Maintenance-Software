import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  escalateMaintenanceNeedsVendor,
  linkedWorkflowNeedsAdminVendor,
  resumeMaintenanceWorkflowAfterAutoReassign,
} from "./maintenance_admin_escalation.ts"
import { logGraphEvent } from "./graph/logGraphEvent.ts"
import {
  loadDeclinedVendorIdsForTicket,
  loadMostRecentlyAssignedVendorId,
  pickVendorForAssignment,
} from "./vendor_assignment.ts"
import { reassignVendorByIdAndNotify } from "../submit-maintenance-request/vendor_notify.ts"

export type AutoReassignResult =
  | { outcome: "reassigned"; newVendorId: string }
  | { outcome: "needs_admin_vendor" }
  | { outcome: "unassigned" }
  | { outcome: "skipped"; reason: string }

/**
 * After a vendor decline is persisted, assigns the next roster vendor automatically.
 * When no vendor exists in the system, escalates for admin approval (onboard/assign).
 */
export async function tryAutoReassignAfterDecline(
  supabase: SupabaseClient,
  ticketId: string,
  decliningVendorId: string,
): Promise<AutoReassignResult> {
  const { data: ticket, error: tErr } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, assigned_vendor_id, vendor_work_status, priority, unit, description, issue_category",
    )
    .eq("id", ticketId)
    .maybeSingle()

  if (tErr || !ticket) {
    console.error("[vendor-auto-reassign] load ticket", tErr)
    return { outcome: "skipped", reason: "load_ticket_failed" }
  }

  const status = ticket.vendor_work_status as string
  const assigned = ticket.assigned_vendor_id as string | null
  const landlordId =
    ticket.landlord_id == null ? null : String(ticket.landlord_id).trim()

  if (status === "accepted" || status === "completed" || status === "in_progress") {
    return { outcome: "skipped", reason: "terminal_or_active_workflow" }
  }

  if (status !== "declined") {
    return { outcome: "skipped", reason: "not_declined" }
  }

  if (assigned !== decliningVendorId) {
    return { outcome: "skipped", reason: "assignee_mismatch" }
  }

  if (await linkedWorkflowNeedsAdminVendor(supabase, ticketId)) {
    return { outcome: "skipped", reason: "already_needs_admin_vendor" }
  }

  const declinedIds = await loadDeclinedVendorIdsForTicket(supabase, ticketId)
  const excludeList = [...declinedIds, decliningVendorId]
  const issueCat =
    typeof ticket.issue_category === "string" && ticket.issue_category.trim()
      ? ticket.issue_category.trim()
      : null
  const preferNot = await loadMostRecentlyAssignedVendorId(supabase)

  const nextVendor = await pickVendorForAssignment(supabase, {
    issueCategory: issueCat,
    excludeVendorIds: excludeList,
    preferNotVendorId:
      preferNot && !excludeList.includes(preferNot) ? preferNot : null,
  })

  const previousVendorId = decliningVendorId

  if (!nextVendor) {
    const { error: upErr } = await supabase
      .from("maintenance_requests")
      .update({
        assigned_vendor_id: null,
        vendor_action_token: null,
        vendor_work_status: "unassigned",
        vendor_notified_at: null,
        vendor_notify_error: null,
      })
      .eq("id", ticketId)
      .eq("vendor_work_status", "declined")
      .eq("assigned_vendor_id", decliningVendorId)

    if (upErr) {
      console.error("[vendor-auto-reassign] set unassigned", upErr)
      return { outcome: "skipped", reason: "unassigned_update_failed" }
    }

    const { error: logErr } = await supabase.from("vendor_status_events").insert({
      ticket_id: ticketId,
      from_status: "declined",
      to_status: "unassigned",
      source: "auto_reassign",
      vendor_id: decliningVendorId,
    })
    if (logErr) console.error("[vendor-auto-reassign] audit no_vendor", logErr)

    if (landlordId) {
      await escalateMaintenanceNeedsVendor(
        supabase,
        { id: ticketId, landlord_id: landlordId },
        {
          escalationReason: "vendor_declined_no_vendor",
          eventMessage:
            "Vendor declined — no roster vendor available for reassignment",
          graphEventType: "maintenance.vendor_declined_needs_vendor",
          graphMessage:
            "Vendor declined with no vendor in roster — admin must assign or onboard a vendor.",
        },
      )
    }

    console.log(
      JSON.stringify({
        event: "no_vendor_available_after_decline",
        ticketId,
        previousVendorId,
        at: new Date().toISOString(),
      }),
    )

    return { outcome: "needs_admin_vendor" }
  }

  if (nextVendor.id === previousVendorId) {
    return { outcome: "skipped", reason: "would_repeat_vendor" }
  }

  const r = await reassignVendorByIdAndNotify(
    supabase,
    ticketId,
    nextVendor.id,
    { eventSource: "auto_reassign", notifyResident: false },
  )

  if ("error" in r) {
    console.error("[vendor-auto-reassign] reassign failed", r.error)
    return { outcome: "skipped", reason: "reassign_failed" }
  }

  try {
    await resumeMaintenanceWorkflowAfterAutoReassign(
      supabase,
      ticketId,
      `Auto-reassigned to ${nextVendor.name} after vendor decline`,
    )
  } catch (e) {
    console.error("[vendor-auto-reassign] resume workflow", e)
  }

  if (landlordId) {
    try {
      await logGraphEvent(supabase, {
        landlord_id: landlordId,
        event_type: "maintenance.vendor_declined_auto_reassigned",
        source: "automation",
        actor_type: "system",
        maintenance_request_id: ticketId,
        vendor_id: nextVendor.id,
        metadata: {
          message: `Vendor declined — auto-reassigned to ${nextVendor.name}.`,
          previous_vendor_id: previousVendorId,
        },
      })
    } catch (e) {
      console.error("[vendor-auto-reassign] graph event", e)
    }
  }

  console.log(
    JSON.stringify({
      event: "vendor_auto_reassigned",
      ticketId,
      previousVendorId,
      newVendorId: nextVendor.id,
      at: new Date().toISOString(),
    }),
  )

  return { outcome: "reassigned", newVendorId: nextVendor.id }
}
