/**
 * Resident SMS cancel — close the work order and its Active Tasks runs.
 *
 * Ticket `vendor_work_status = cancelled` is not enough: intake runs are often
 * keyed to the SMS conversation, so Active Tasks keeps showing them unless
 * those workflow_runs are cancelled too.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { updateWorkflowRun } from "../engine/workflowRuns.ts"
import { releaseMaintenanceIntakePin } from "./residentIntake.ts"
import { runLinksCancelledTicket } from "./cancelResidentWorkOrderLink.ts"
import type { SmsIntakeState } from "./residentIntakeTypes.ts"

export { runLinksCancelledTicket } from "./cancelResidentWorkOrderLink.ts"

const MAINTENANCE_TEMPLATES = ["maintenance_intake", "maintenance_request"] as const

const RUN_SELECT = "id, entity_id, entity_type, metadata, template_id, resident_id"

async function loadLinkedActiveMaintenanceRuns(
  supabase: SupabaseClient,
  params: { landlordId: string; ticketId: string; residentId?: string | null },
): Promise<Array<{ id: string }>> {
  const base = () =>
    supabase
      .from("workflow_runs")
      .select(RUN_SELECT)
      .eq("landlord_id", params.landlordId)
      .in("status", ["active", "escalated"])
      .in("template_id", [...MAINTENANCE_TEMPLATES])

  const queries = [
    base().eq("entity_id", params.ticketId),
    base().eq("metadata->>draft_ticket_id", params.ticketId),
    base().eq("metadata->>maintenance_request_id", params.ticketId),
  ]

  const seen = new Set<string>()
  const out: Array<{ id: string }> = []
  for (const query of queries) {
    const { data } = await query.limit(20)
    const residentId = params.residentId?.trim() || ""
    for (const row of data ?? []) {
      const id = typeof row?.id === "string" ? row.id : ""
      if (!id || seen.has(id)) continue
      if (
        residentId &&
        typeof row.resident_id === "string" &&
        row.resident_id.trim() &&
        row.resident_id.trim() !== residentId
      ) {
        continue
      }
      if (
        !runLinksCancelledTicket(
          row as {
            entity_id?: string | null
            entity_type?: string | null
            metadata?: Record<string, unknown> | null
          },
          params.ticketId,
        )
      ) {
        continue
      }
      seen.add(id)
      out.push({ id })
    }
  }
  return out
}

export async function closeWorkOrderCancelledByResident(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    conversationId?: string | null
    residentId?: string | null
    intake?: SmsIntakeState | null
    descriptionNote?: string
    lastResidentMessage?: string | null
  },
): Promise<{ ok: boolean; alreadyClosed?: boolean; error?: string }> {
  const ticketId = params.ticketId.trim()
  if (!ticketId) return { ok: false, error: "missing_ticket" }

  const { data: current } = await supabase
    .from("maintenance_requests")
    .select("id, description, vendor_work_status")
    .eq("id", ticketId)
    .maybeSingle()

  const currentStatus = (current?.vendor_work_status ?? "").toString().toLowerCase()
  if (currentStatus === "cancelled" || currentStatus === "completed") {
    return { ok: true, alreadyClosed: true }
  }

  const closedAt = new Date().toISOString()
  const note = params.descriptionNote?.trim() ||
    `Resident closed this request over text on ${closedAt.slice(0, 10)}.`
  const nextDescription = [
    typeof current?.description === "string" ? current.description.trim() : "",
    note,
  ]
    .filter(Boolean)
    .join("\n\n")

  const { error } = await supabase
    .from("maintenance_requests")
    .update({
      description: nextDescription,
      vendor_work_status: "cancelled",
      assigned_vendor_id: null,
    })
    .eq("id", ticketId)

  if (error) {
    console.warn("[sms-cancel] ticket update failed", error.message)
    return { ok: false, error: error.message }
  }

  const runs = await loadLinkedActiveMaintenanceRuns(supabase, {
    landlordId: params.landlordId,
    ticketId,
    residentId: params.residentId,
  })
  const now = closedAt
  for (const run of runs) {
    await updateWorkflowRun(supabase, run.id, {
      status: "cancelled",
      currentStep: "cancelled_by_resident",
      completedAt: now,
      eventMessage: "Resident cancelled this repair over text.",
      eventStep: "cancelled_by_resident",
      metadata: {
        cancelled_reason: "resident_sms",
        closed_source: "tenant_sms",
        closed_at: now,
      },
    })
  }

  if (params.conversationId?.trim()) {
    await releaseMaintenanceIntakePin(supabase, {
      landlordId: params.landlordId,
      conversationId: params.conversationId,
      state: params.intake ?? null,
      runStatus: "cancelled",
      currentStep: "cancelled_by_resident",
      reason: "resident_sms_cancel",
      lastResidentMessage: params.lastResidentMessage ?? null,
      eventMessage: "Intake closed because the resident cancelled the repair.",
      clearDraftTicket: true,
    })
  }

  return { ok: true, alreadyClosed: false }
}
