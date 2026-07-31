/**
 * When maintenance_requests.due_at passes, auto-reassign to the next roster vendor.
 * Admin approval is only required when no vendor exists in the system (vendor API / onboarding).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { runMaintenanceRequestViaEngine } from "./engine/maintenanceRequestEngine.ts"
import { linkedWorkflowNeedsAdminVendor } from "./maintenance_admin_escalation.ts"
import { escalateWhenNoReplacementVendor } from "./vendor_reassignment.ts"

const TERMINAL_STATUSES = new Set(["completed", "cancelled"])
/** Only reassign before a vendor has actively committed to the job. */
const AUTO_REASSIGN_STATUSES = new Set([
  "pending_accept",
  "unassigned",
  "declined",
])
/** Vendor already accepted or on site — admin review only, never silent auto-reassign. */
const ADMIN_REVIEW_ONLY_STATUSES = new Set(["accepted", "in_progress"])

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

/** @deprecated Use escalateWhenNoReplacementVendor from vendor_reassignment.ts */
export async function escalateForNoVendor(
  supabase: SupabaseClient,
  ticket: SlaTicketRow,
): Promise<void> {
  await escalateWhenNoReplacementVendor(supabase, ticket, "sla_expired")
}

async function processSlaExpiredTicketRow(
  supabase: SupabaseClient,
  raw: Record<string, unknown>,
): Promise<SlaReassignResult> {
  const ticket: SlaTicketRow = {
    id: String(raw.id ?? ""),
    landlord_id: raw.landlord_id == null ? null : String(raw.landlord_id),
    assigned_vendor_id: raw.assigned_vendor_id == null
      ? null
      : String(raw.assigned_vendor_id),
    issue_category: raw.issue_category == null ? null : String(raw.issue_category),
    vendor_work_status: String(raw.vendor_work_status ?? "").toLowerCase(),
  }

  if (!ticket.id) {
    return { ticketId: "", outcome: "skipped", reason: "missing_id" }
  }

  if (TERMINAL_STATUSES.has(ticket.vendor_work_status)) {
    return { ticketId: ticket.id, outcome: "skipped", reason: "terminal" }
  }

  if (!AUTO_REASSIGN_STATUSES.has(ticket.vendor_work_status)) {
    return {
      ticketId: ticket.id,
      outcome: "skipped",
      reason: ADMIN_REVIEW_ONLY_STATUSES.has(ticket.vendor_work_status)
        ? "vendor_active_on_job"
        : "status_not_eligible",
    }
  }

  if (await linkedWorkflowNeedsAdminVendor(supabase, ticket.id)) {
    return {
      ticketId: ticket.id,
      outcome: "skipped",
      reason: "already_needs_admin_vendor",
    }
  }

  const landlordId = ticket.landlord_id?.trim()
  if (!landlordId) {
    return { ticketId: ticket.id, outcome: "skipped", reason: "missing_landlord" }
  }

  const engineResult = await runMaintenanceRequestViaEngine(supabase, {
    landlordId,
    trigger: "automation",
    maintenanceRequest: {
      action: "auto_reassign",
      autoReassign: {
        ticketId: ticket.id,
        trigger: "sla_expired",
        landlordId,
        assignedVendorId: ticket.assigned_vendor_id,
        issueCategory: ticket.issue_category,
        previousVendorId: ticket.assigned_vendor_id,
        findStrategy: "alternatives_then_pick",
      },
    },
  })

  const meta = engineResult?.metadata ?? {}
  const outcome = meta.outcome as string | undefined

  if (outcome === "reassigned" && typeof meta.new_vendor_id === "string") {
    return {
      ticketId: ticket.id,
      outcome: "reassigned",
      newVendorId: meta.new_vendor_id,
    }
  }
  if (outcome === "needs_admin_vendor") {
    return { ticketId: ticket.id, outcome: "needs_admin_vendor" }
  }
  if (outcome === "failed") {
    return {
      ticketId: ticket.id,
      outcome: "skipped",
      reason: String(meta.reason ?? "reassign_failed"),
    }
  }

  return {
    ticketId: ticket.id,
    outcome: "skipped",
    reason: String(meta.reason ?? "engine_skipped"),
  }
}

/** Auto-reassign one SLA-expired ticket when a roster vendor exists. */
export async function processSlaExpiredAutoReassignForTicket(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<SlaReassignResult | { error: string }> {
  const id = ticketId.trim()
  if (!id) return { error: "Missing ticketId" }

  const { data: raw, error } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, assigned_vendor_id, issue_category, vendor_work_status, due_at",
    )
    .eq("id", id)
    .maybeSingle()

  if (error) {
    console.error("[sla-expired-auto-reassign] load ticket", error.message)
    return { error: "Load ticket failed" }
  }
  if (!raw) return { error: "Ticket not found" }

  const dueRaw = raw.due_at
  if (dueRaw == null || String(dueRaw).trim() === "") {
    return { ticketId: id, outcome: "skipped", reason: "no_due_at" }
  }
  if (new Date(String(dueRaw)).getTime() >= Date.now()) {
    return { ticketId: id, outcome: "skipped", reason: "sla_not_expired" }
  }

  return processSlaExpiredTicketRow(supabase, raw as Record<string, unknown>)
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
    results.push(
      await processSlaExpiredTicketRow(supabase, raw as Record<string, unknown>),
    )
  }

  return results
}
