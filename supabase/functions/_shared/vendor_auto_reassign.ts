import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { runMaintenanceRequestViaEngine } from "./engine/maintenanceRequestEngine.ts"
import { linkedWorkflowNeedsAdminVendor } from "./maintenance_admin_escalation.ts"

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
      "id, landlord_id, assigned_vendor_id, vendor_work_status, issue_category",
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

  const issueCat =
    typeof ticket.issue_category === "string" && ticket.issue_category.trim()
      ? ticket.issue_category.trim()
      : null

  if (!landlordId) {
    return { outcome: "skipped", reason: "missing_landlord" }
  }

  const engineResult = await runMaintenanceRequestViaEngine(supabase, {
    landlordId,
    trigger: "automation",
    maintenanceRequest: {
      action: "auto_reassign",
      autoReassign: {
        ticketId,
        trigger: "vendor_declined",
        landlordId,
        assignedVendorId: decliningVendorId,
        issueCategory: issueCat,
        previousVendorId: decliningVendorId,
        excludeVendorIds: [decliningVendorId],
        findStrategy: "pick_only",
        preferNotRecentlyAssigned: true,
      },
    },
  })

  const meta = engineResult?.metadata ?? {}
  const outcome = meta.outcome as string | undefined

  if (outcome === "reassigned" && typeof meta.new_vendor_id === "string") {
    return { outcome: "reassigned", newVendorId: meta.new_vendor_id }
  }
  if (outcome === "needs_admin_vendor") {
    return { outcome: "needs_admin_vendor" }
  }
  if (outcome === "failed") {
    return { outcome: "skipped", reason: String(meta.reason ?? "reassign_failed") }
  }

  return { outcome: "skipped", reason: String(meta.reason ?? "engine_skipped") }
}
