/**
 * Escalate maintenance to admin when no roster vendor is available for auto-reassign
 * (SLA expired or vendor declined).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { updateWorkflowRun } from "./engine/workflowRuns.ts"
import { logGraphEvent } from "./graph/logGraphEvent.ts"
import { notifyLandlordNeedsAttention } from "./landlordAttentionNotify.ts"
import { formatWorkOrderRef } from "./vendor_outreach_copy.ts"

export type MaintenanceAdminVendorEscalationReason =
  | "sla_expired_no_vendor"
  | "vendor_declined_no_vendor"

export const MAINTENANCE_ADMIN_VENDOR_ESCALATION_REASONS = new Set<
  MaintenanceAdminVendorEscalationReason
>(["sla_expired_no_vendor", "vendor_declined_no_vendor"])

export type MaintenanceTicketScope = {
  id: string
  landlord_id: string | null
}

export function isMaintenanceAdminVendorEscalationReason(
  reason: string | null | undefined,
): reason is MaintenanceAdminVendorEscalationReason {
  if (!reason) return false
  return MAINTENANCE_ADMIN_VENDOR_ESCALATION_REASONS.has(
    reason as MaintenanceAdminVendorEscalationReason,
  )
}

/** True when an escalated workflow run is already waiting for admin vendor onboarding. */
export async function linkedWorkflowNeedsAdminVendor(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("workflow_runs")
    .select("id, status, metadata")
    .eq("entity_type", "maintenance_request")
    .eq("entity_id", ticketId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return false
  if (data.status !== "escalated") return false
  const metadata = data.metadata as Record<string, unknown> | null
  return isMaintenanceAdminVendorEscalationReason(
    typeof metadata?.escalation_reason === "string"
      ? metadata.escalation_reason
      : null,
  )
}

type EscalateMaintenanceNeedsVendorOpts = {
  escalationReason: MaintenanceAdminVendorEscalationReason
  eventMessage: string
  graphEventType: string
  graphMessage: string
}

export async function escalateMaintenanceNeedsVendor(
  supabase: SupabaseClient,
  ticket: MaintenanceTicketScope,
  opts: EscalateMaintenanceNeedsVendorOpts,
): Promise<void> {
  const landlordId = ticket.landlord_id?.trim()
  if (!landlordId) return

  const { data: run } = await supabase
    .from("workflow_runs")
    .select("id, status, template_id")
    .eq("entity_type", "maintenance_request")
    .eq("entity_id", ticket.id)
    .in("status", ["active", "escalated"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const now = new Date().toISOString()
  if (run?.id) {
    await updateWorkflowRun(supabase, run.id, {
      status: "escalated",
      currentStep: "escalated",
      metadata: {
        escalated_at: now,
        escalation_reason: opts.escalationReason,
      },
      pipelineStage: "escalate",
      eventMessage: opts.eventMessage,
      eventStep: "escalated",
    })
  }

  await logGraphEvent(supabase, {
    landlord_id: landlordId,
    event_type: opts.graphEventType,
    source: "automation",
    actor_type: "system",
    maintenance_request_id: ticket.id,
    workflow_run_id: run?.id ?? null,
    workflow_template_id: run?.template_id ?? null,
    metadata: { message: opts.graphMessage },
  })

  try {
    const { data: ticketRow } = await supabase
      .from("maintenance_requests")
      .select("unit, issue_category")
      .eq("id", ticket.id)
      .maybeSingle()
    const unit =
      typeof ticketRow?.unit === "string" && ticketRow.unit.trim()
        ? ticketRow.unit.trim()
        : ""
    const headline =
      opts.escalationReason === "vendor_declined_no_vendor"
        ? "Vendor declined — assign a vendor"
        : "SLA breached — assign a vendor"
    await notifyLandlordNeedsAttention(supabase, {
      landlordId,
      kind: "assign_vendor",
      headline,
      detail: `${formatWorkOrderRef(ticket.id)}${unit ? ` · Unit ${unit}` : ""}`,
      idempotencyKey: `assign_vendor:${ticket.id}:${opts.escalationReason}`,
      maintenanceRequestId: ticket.id,
      workflowRunId: run?.id ?? null,
    })
  } catch (e) {
    console.error("[maintenance-admin-escalation] attention notify", e)
  }
}

/** After successful auto-reassign, return escalated decline runs to active intake. */
export async function resumeMaintenanceWorkflowAfterAutoReassign(
  supabase: SupabaseClient,
  ticketId: string,
  eventMessage: string,
): Promise<void> {
  const { data: run } = await supabase
    .from("workflow_runs")
    .select("id, status, metadata")
    .eq("entity_type", "maintenance_request")
    .eq("entity_id", ticketId)
    .eq("status", "escalated")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!run?.id) return

  await updateWorkflowRun(supabase, run.id, {
    status: "active",
    currentStep: "awaiting_vendor_accept",
    metadata: {
      auto_reassigned_at: new Date().toISOString(),
    },
    pipelineStage: "act",
    eventMessage,
    eventStep: "vendor_reassigned",
  })
}
