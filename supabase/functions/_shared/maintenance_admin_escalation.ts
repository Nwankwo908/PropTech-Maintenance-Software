/**
 * Escalate maintenance to admin when no roster vendor is available
 * (submit with empty roster, SLA expired, or vendor declined).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { updateWorkflowRun } from "./engine/workflowRuns.ts"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import {
  formatAttentionLocationLine,
  formatReportedAgo,
  notifyLandlordNeedsAttention,
  shortRepairLabel,
} from "./landlordAttentionNotify.ts"
import { discoverExternalVendorsForTicket } from "./external_vendor/discover.ts"
import { loadPropertyLocationFromTable } from "./properties/propertyLocation.ts"
import {
  choiceOptionsFromExternalSuggestions,
  formatExternalVendorSmsLine,
  landlordNumberedChoiceReplyHint,
  type AwaitingVendorChoice,
} from "./vendorLandlordChoice.ts"

export type MaintenanceAdminVendorEscalationReason =
  | "sla_expired_no_vendor"
  | "vendor_declined_no_vendor"
  | "no_vendor_available"

export const MAINTENANCE_ADMIN_VENDOR_ESCALATION_REASONS = new Set<
  MaintenanceAdminVendorEscalationReason
>([
  "sla_expired_no_vendor",
  "vendor_declined_no_vendor",
  "no_vendor_available",
])

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

export type EscalateMaintenanceNeedsVendorOpts = {
  escalationReason: MaintenanceAdminVendorEscalationReason
  eventMessage: string
  graphEventType: string
  graphMessage: string
}

export const SUBMITTED_NO_VENDOR_ESCALATION: EscalateMaintenanceNeedsVendorOpts = {
  escalationReason: "no_vendor_available",
  eventMessage: "No vendor available to assign this request",
  graphEventType: "maintenance.submitted_needs_vendor",
  graphMessage:
    "No vendor was available when this request was submitted. Assign or find a vendor to continue.",
}

export type EscalateNeedsVendorResult = {
  nearbyOptionCount: number
  attention: Awaited<ReturnType<typeof notifyLandlordNeedsAttention>> | null
}

export async function escalateMaintenanceNeedsVendor(
  supabase: SupabaseClient,
  ticket: MaintenanceTicketScope,
  opts: EscalateMaintenanceNeedsVendorOpts,
): Promise<EscalateNeedsVendorResult> {
  const landlordId = ticket.landlord_id?.trim()
  if (!landlordId) return { nearbyOptionCount: 0, attention: null }

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

  await recordActivityLog(supabase, {
    landlordId,
    eventType: opts.graphEventType,
    source: "automation",
    actorType: "system",
    maintenanceRequestId: ticket.id,
    workflowRunId: run?.id ?? null,
    workflowTemplateId: run?.template_id ?? null,
    metadata: { message: opts.graphMessage },
  })

  try {
    const { data: ticketRow } = await supabase
      .from("maintenance_requests")
      .select("unit, building, description, issue_category, created_at, urgency, priority")
      .eq("id", ticket.id)
      .maybeSingle()
    const unit =
      typeof ticketRow?.unit === "string" && ticketRow.unit.trim()
        ? ticketRow.unit.trim()
        : ""
    const building =
      typeof ticketRow?.building === "string" && ticketRow.building.trim()
        ? ticketRow.building.trim()
        : ""
    const description =
      typeof ticketRow?.description === "string" ? ticketRow.description : ""
    const issueCategory =
      typeof ticketRow?.issue_category === "string" ? ticketRow.issue_category : ""
    const createdAt =
      typeof ticketRow?.created_at === "string" ? ticketRow.created_at : ""
    const location = await loadPropertyLocationFromTable(supabase, landlordId, {
      building: building || null,
    })
    const repair = shortRepairLabel(description, issueCategory)
    const prefix =
      opts.escalationReason === "vendor_declined_no_vendor"
        ? "Vendor declined"
        : "No vendor found"
    const locationLine = formatAttentionLocationLine({
      street: location?.streetAddress,
      building,
      unit,
      reportedAgo: formatReportedAgo(createdAt),
    })
    let nextSteps: string[] = []
    let choiceReplyHint: string | null = null
    let vendorChoice: AwaitingVendorChoice | null = null
    try {
      const discovered = await discoverExternalVendorsForTicket(supabase, ticket.id, {
        limit: 3,
      })
      if (!("error" in discovered)) {
        const options = choiceOptionsFromExternalSuggestions(
          discovered.suggestions,
          3,
        )
        if (options.length > 0) {
          const named = discovered.suggestions.filter((row) => row.name.trim())
          nextSteps = named.slice(0, options.length).map(formatExternalVendorSmsLine)
          choiceReplyHint = landlordNumberedChoiceReplyHint(options.length)
          const urgency =
            typeof ticketRow?.urgency === "string" && ticketRow.urgency.trim()
              ? ticketRow.urgency.trim()
              : typeof ticketRow?.priority === "string" && ticketRow.priority.trim()
                ? ticketRow.priority.trim()
                : null
          vendorChoice = {
            ticketId: ticket.id,
            options,
            searchLocation:
              discovered.searchLocation || discovered.locationLabel || null,
            issueCategory: issueCategory || discovered.issueCategory || null,
            issueSummary: description.trim() || null,
            urgency,
          }
        }
      }
    } catch (e) {
      console.warn("[maintenance-admin-escalation] external vendor search", e)
    }
    const whyLine = nextSteps.length
      ? "No one on your preferred list can take this right now. Nearby vendors:"
      : "No one on your preferred list can take this right now."
    const attention = await notifyLandlordNeedsAttention(supabase, {
      landlordId,
      kind: "assign_vendor",
      headline: `${prefix} — ${repair}`,
      detail: locationLine,
      locationLine,
      whyLine,
      nextSteps,
      choiceReplyHint,
      vendorChoice,
      idempotencyKey: `assign_vendor:${ticket.id}:${opts.escalationReason}`,
      maintenanceRequestId: ticket.id,
      workflowRunId: run?.id ?? null,
    })
    return { nearbyOptionCount: nextSteps.length, attention }
  } catch (e) {
    console.error("[maintenance-admin-escalation] attention notify", e)
    return { nearbyOptionCount: 0, attention: null }
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

/** After the assigned vendor accepts, drop the "needs a vendor" escalation. */
export async function resumeMaintenanceWorkflowAfterVendorAccepted(
  supabase: SupabaseClient,
  ticketId: string,
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

  const metadata = (run.metadata ?? {}) as Record<string, unknown>
  const reason =
    typeof metadata.escalation_reason === "string"
      ? metadata.escalation_reason
      : null
  if (reason && !isMaintenanceAdminVendorEscalationReason(reason)) return

  await updateWorkflowRun(supabase, run.id, {
    status: "active",
    currentStep: "accepted",
    metadata: {
      vendor_accepted_at: new Date().toISOString(),
      escalation_reason: null,
    },
    pipelineStage: "act",
    eventMessage: "Vendor accepted the job",
    eventStep: "vendor_accepted",
  })
}
