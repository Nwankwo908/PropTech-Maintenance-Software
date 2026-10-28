/**
 * Tenant reported the repair fixed.
 * Completes the request and its tasks. Does not text a vendor.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { closeOpenAsksForTicket } from "../closeOpenAsksForTicket.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { runLinksCancelledTicket } from "./cancelResidentWorkOrderLink.ts"
import {
  isAlreadyTenantResolved,
  tenantResolvedTicketPatch,
} from "../../../../shared/maintenance/tenantReportedFix.ts"

const MAINTENANCE_TEMPLATES = [
  "maintenance_intake",
  "maintenance_request",
  "vendor_job_response",
] as const

export async function closeWorkOrderResolvedByResident(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    conversationId?: string | null
    residentId?: string | null
    completedAt?: string | null
    /**
     * The earlier close stored a cancellation even though the resident
     * reported the repair fixed. Correct that row. Leave real cancellations.
     */
    correctMisclassifiedCancel?: boolean
  },
): Promise<{ ok: boolean; alreadyClosed?: boolean; error?: string }> {
  const ticketId = params.ticketId.trim()
  const landlordId = params.landlordId.trim()
  if (!ticketId || !landlordId) {
    return { ok: false, error: "missing_ticket_or_landlord" }
  }

  const { data: ticket, error: loadError } = await supabase
    .from("maintenance_requests")
    .select("id, status, vendor_work_status, completed_at, landlord_id")
    .eq("id", ticketId)
    .eq("landlord_id", landlordId)
    .maybeSingle()

  if (loadError || !ticket) {
    return { ok: false, error: loadError?.message || "ticket_not_found" }
  }

  const status = typeof ticket.status === "string" ? ticket.status : ""
  const vendorWorkStatus = typeof ticket.vendor_work_status === "string"
    ? ticket.vendor_work_status
    : ""
  if (isAlreadyTenantResolved({ status, vendorWorkStatus })) {
    return { ok: true, alreadyClosed: true }
  }

  const vendor = vendorWorkStatus.trim().toLowerCase()
  const request = status.trim().toLowerCase()
  const misclassified = vendor === "cancelled" || vendor === "archived" ||
    request === "cancelled" || request === "archived"
  if (misclassified && !params.correctMisclassifiedCancel) {
    return { ok: true, alreadyClosed: true }
  }

  const now = params.completedAt?.trim() ||
    (typeof ticket.completed_at === "string" && ticket.completed_at.trim()) ||
    new Date().toISOString()
  const patch = tenantResolvedTicketPatch(now)
  const { data: updated, error: updateError } = await supabase
    .from("maintenance_requests")
    .update(patch)
    .eq("id", ticketId)
    .eq("landlord_id", landlordId)
    .neq("vendor_work_status", "completed")
    .select("id")

  if (updateError) return { ok: false, error: updateError.message }
  if (!updated?.length) return { ok: true, alreadyClosed: true }

  await completeLinkedRuns(supabase, {
    landlordId,
    ticketId,
    residentId: params.residentId,
    completedAt: now,
    includeCancelled: Boolean(params.correctMisclassifiedCancel),
  })

  await recordActivityLog(supabase, {
    landlordId,
    eventType: "maintenance.tenant_self_fix",
    source: "sms",
    actorType: "resident",
    actorId: params.residentId ?? null,
    residentId: params.residentId ?? null,
    maintenanceRequestId: ticketId,
    conversationId: params.conversationId ?? null,
    metadata: {
      message: params.correctMisclassifiedCancel
        ? "Corrected this request to completed. The resident had reported it fixed."
        : "The resident reported this repair fixed.",
      resolution: "tenant_self_fix",
    },
  })

  try {
    await closeOpenAsksForTicket(
      supabase,
      ticketId,
      "vendor_work_status → completed (resident reported it fixed)",
    )
  } catch (error) {
    console.warn("[tenant-resolved] close open asks", error)
  }

  return { ok: true, alreadyClosed: false }
}

async function completeLinkedRuns(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    residentId?: string | null
    completedAt: string
    includeCancelled: boolean
  },
): Promise<void> {
  const statuses = params.includeCancelled
    ? ["active", "escalated", "cancelled"]
    : ["active", "escalated"]
  const base = () =>
    supabase
      .from("workflow_runs")
      .select("id, entity_id, entity_type, metadata, resident_id, completed_at, status")
      .eq("landlord_id", params.landlordId)
      .in("status", statuses)
      .in("template_id", [...MAINTENANCE_TEMPLATES])

  const queries = [
    base().eq("entity_id", params.ticketId),
    base().eq("metadata->>draft_ticket_id", params.ticketId),
    base().eq("metadata->>maintenance_request_id", params.ticketId),
  ]
  const seen = new Set<string>()
  for (const query of queries) {
    const { data } = await query.limit(20)
    for (const row of data ?? []) {
      const id = typeof row?.id === "string" ? row.id : ""
      if (!id || seen.has(id)) continue
      const residentId = params.residentId?.trim() || ""
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
      const completedAt = typeof row.completed_at === "string" && row.completed_at.trim()
        ? row.completed_at
        : params.completedAt
      await supabase
        .from("workflow_runs")
        .update({
          status: "completed",
          current_step: "tenant_self_fix",
          current_stage: "log",
          completed_at: completedAt,
        })
        .eq("id", id)
        .eq("landlord_id", params.landlordId)
    }
  }
}
