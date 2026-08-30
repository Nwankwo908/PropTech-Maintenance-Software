/**
 * After landlord Override onboarding, dispatch open unassigned work orders
 * to the newly matchable vendor (same notify path as a new ticket).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import { assignVendorAndNotify } from "../submit-maintenance-request/vendor_notify.ts"
import { isTicketAwaitingVendorAssignment } from "./vendorOnboardingOverrideDispatchGate.ts"

export { isTicketAwaitingVendorAssignment } from "./vendorOnboardingOverrideDispatchGate.ts"

const MAX_UNASSIGNED_DISPATCH = 25

/**
 * Best-effort: assign waiting tickets, preferring the overridden vendor.
 * Never throws.
 */
export async function dispatchUnassignedTicketsAfterOverride(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string
  },
): Promise<{ assignedCount: number }> {
  try {
    const { data, error } = await supabase
      .from("maintenance_requests")
      .select(
        "id, priority, unit, description, due_at, estimated_minutes, resident_availability_text, assigned_vendor_id, vendor_work_status",
      )
      .eq("landlord_id", params.landlordId)
      .is("assigned_vendor_id", null)
      .order("created_at", { ascending: false })
      .limit(MAX_UNASSIGNED_DISPATCH)

    if (error) {
      console.error("[vendorOnboardingOverrideDispatch] list tickets", error)
      return { assignedCount: 0 }
    }

    const waiting = (data ?? []).filter((row) =>
      isTicketAwaitingVendorAssignment({
        assigned_vendor_id: typeof row.assigned_vendor_id === "string"
          ? row.assigned_vendor_id
          : null,
        vendor_work_status: typeof row.vendor_work_status === "string"
          ? row.vendor_work_status
          : null,
      })
    )

    let assignedCount = 0
    const assignedTicketIds: string[] = []
    for (const ticket of waiting) {
      const ticketId = typeof ticket.id === "string" ? ticket.id : ""
      if (!ticketId) continue
      const result = await assignVendorAndNotify(supabase, {
        ticketId,
        priority: typeof ticket.priority === "string" && ticket.priority.trim()
          ? ticket.priority
          : "normal",
        unit: typeof ticket.unit === "string" ? ticket.unit : "",
        description: typeof ticket.description === "string" ? ticket.description : "",
        dueAt: typeof ticket.due_at === "string" ? ticket.due_at : null,
        estimatedMinutes: typeof ticket.estimated_minutes === "number"
          ? ticket.estimated_minutes
          : null,
        landlordId: params.landlordId,
        preferVendorId: params.vendorId,
        residentAvailabilityText:
          typeof ticket.resident_availability_text === "string"
            ? ticket.resident_availability_text
            : null,
        retryIfUnassigned: true,
      })
      if (result.assigned) {
        assignedCount += 1
        assignedTicketIds.push(ticketId)
      }
    }

    if (assignedCount > 0) {
      try {
        await recordActivityLog(supabase, {
          landlordId: params.landlordId,
          eventType: "vendor.onboarding_override_jobs_assigned",
          source: "automation",
          actorType: "system",
          vendorId: params.vendorId,
          metadata: {
            message: assignedCount === 1
              ? "Assigned 1 open work order after the vendor was activated."
              : `Assigned ${assignedCount} open work orders after the vendor was activated.`,
            assigned_count: assignedCount,
            ticket_ids: assignedTicketIds,
          },
        })
      } catch (err) {
        console.warn("[vendorOnboardingOverrideDispatch] activity log", err)
      }
    }

    return { assignedCount }
  } catch (err) {
    console.error("[vendorOnboardingOverrideDispatch]", err)
    return { assignedCount: 0 }
  }
}
