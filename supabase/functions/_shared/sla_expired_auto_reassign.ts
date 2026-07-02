/**
 * When maintenance_requests.due_at passes, auto-reassign to the next roster vendor.
 * Admin approval is only required when no vendor exists in the system (vendor API / onboarding).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  escalateMaintenanceNeedsVendor,
  linkedWorkflowNeedsAdminVendor,
  resumeMaintenanceWorkflowAfterAutoReassign,
} from "./maintenance_admin_escalation.ts"
import { logGraphEvent } from "./graph/logGraphEvent.ts"
import {
  loadAlternativeVendorCandidates,
  type AlternativeVendor,
} from "./recommend_vendor_alternatives.ts"
import {
  loadDeclinedVendorIdsForTicket,
  pickVendorForAssignment,
} from "./vendor_assignment.ts"
import { reassignVendorByIdAndNotify } from "../submit-maintenance-request/vendor_notify.ts"

const TERMINAL_STATUSES = new Set(["completed", "cancelled"])
const AUTO_REASSIGN_STATUSES = new Set([
  "pending_accept",
  "unassigned",
  "declined",
])

export type SlaReassignOutcome =
  | "reassigned"
  | "needs_admin_vendor"
  | "skipped"

export type SlaReassignResult = {
  ticketId: string
  outcome: SlaReassignOutcome
  reason?: string
  newVendorId?: string
}

type SlaTicketRow = {
  id: string
  landlord_id: string | null
  assigned_vendor_id: string | null
  issue_category: string | null
  vendor_work_status: string
}

async function findReplacementVendor(
  supabase: SupabaseClient,
  ticket: SlaTicketRow,
): Promise<AlternativeVendor | null> {
  const fromAlternatives = await loadAlternativeVendorCandidates(supabase, {
    assigned_vendor_id: ticket.assigned_vendor_id,
    issue_category: ticket.issue_category,
  })
  if (fromAlternatives[0]) return fromAlternatives[0]

  const declined = await loadDeclinedVendorIdsForTicket(supabase, ticket.id)
  const exclude = new Set(declined)
  if (ticket.assigned_vendor_id) exclude.add(ticket.assigned_vendor_id)

  const picked = await pickVendorForAssignment(supabase, {
    issueCategory: ticket.issue_category,
    excludeVendorIds: [...exclude],
  })
  if (!picked) return null
  return { id: picked.id, name: picked.name }
}

export async function escalateForNoVendor(
  supabase: SupabaseClient,
  ticket: SlaTicketRow,
): Promise<void> {
  await escalateMaintenanceNeedsVendor(supabase, ticket, {
    escalationReason: "sla_expired_no_vendor",
    eventMessage: "SLA expired — no roster vendor available for reassignment",
    graphEventType: "maintenance.sla_expired_needs_vendor",
    graphMessage:
      "SLA expired with no vendor in roster — admin must assign or onboard a vendor.",
  })
}

/** Process open tickets past due_at — reassign when a roster vendor exists. */
export async function processSlaExpiredAutoReassign(
  supabase: SupabaseClient,
  opts?: { limit?: number },
): Promise<SlaReassignResult[]> {
  const nowIso = new Date().toISOString()
  const limit = opts?.limit ?? 50

  const { data: rows, error } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, assigned_vendor_id, issue_category, vendor_work_status",
    )
    .not("due_at", "is", null)
    .lt("due_at", nowIso)
    .limit(limit)

  if (error) {
    console.error("[sla-expired-auto-reassign] query", error.message)
    return []
  }

  const results: SlaReassignResult[] = []

  for (const raw of rows ?? []) {
    const ticket: SlaTicketRow = {
      id: String(raw.id ?? ""),
      landlord_id: raw.landlord_id == null ? null : String(raw.landlord_id),
      assigned_vendor_id: raw.assigned_vendor_id == null
        ? null
        : String(raw.assigned_vendor_id),
      issue_category: raw.issue_category == null ? null : String(raw.issue_category),
      vendor_work_status: String(raw.vendor_work_status ?? "").toLowerCase(),
    }

    if (!ticket.id) continue

    if (TERMINAL_STATUSES.has(ticket.vendor_work_status)) {
      results.push({ ticketId: ticket.id, outcome: "skipped", reason: "terminal" })
      continue
    }

    if (!AUTO_REASSIGN_STATUSES.has(ticket.vendor_work_status)) {
      results.push({
        ticketId: ticket.id,
        outcome: "skipped",
        reason: "vendor_active_on_job",
      })
      continue
    }

    if (await linkedWorkflowNeedsAdminVendor(supabase, ticket.id)) {
      results.push({
        ticketId: ticket.id,
        outcome: "skipped",
        reason: "already_needs_admin_vendor",
      })
      continue
    }

    const replacement = await findReplacementVendor(supabase, ticket)
    if (!replacement) {
      await escalateForNoVendor(supabase, ticket)
      results.push({ ticketId: ticket.id, outcome: "needs_admin_vendor" })
      continue
    }

    const reassign = await reassignVendorByIdAndNotify(
      supabase,
      ticket.id,
      replacement.id,
      { eventSource: "auto_reassign", notifyResident: false },
    )

    if ("error" in reassign) {
      console.error(
        "[sla-expired-auto-reassign] reassign failed",
        ticket.id,
        reassign.error,
      )
      results.push({
        ticketId: ticket.id,
        outcome: "skipped",
        reason: reassign.error,
      })
      continue
    }

    try {
      await resumeMaintenanceWorkflowAfterAutoReassign(
        supabase,
        ticket.id,
        `Auto-reassigned to ${replacement.name} after SLA expired`,
      )
    } catch (e) {
      console.error("[sla-expired-auto-reassign] resume workflow", e)
    }

    if (ticket.landlord_id) {
      await logGraphEvent(supabase, {
        landlord_id: ticket.landlord_id,
        event_type: "maintenance.sla_auto_reassigned",
        source: "automation",
        actor_type: "system",
        maintenance_request_id: ticket.id,
        vendor_id: replacement.id,
        metadata: {
          message: `SLA expired — auto-reassigned to ${replacement.name}.`,
          previous_vendor_id: ticket.assigned_vendor_id,
        },
      })
    }

    results.push({
      ticketId: ticket.id,
      outcome: "reassigned",
      newVendorId: replacement.id,
    })
  }

  return results
}
