/**
 * Escalate maintenance to admin when no roster vendor is available
 * (submit with empty roster, SLA expired, or vendor declined).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { updateWorkflowRun } from "./engine/workflowRuns.ts"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import { closeNeedsVendorActivityEpisode } from "./graph/recordActivityLog.ts"
import {
  formatAttentionLocationLine,
  formatReportedAgo,
  notifyLandlordNeedsAttention,
  shortRepairLabel,
} from "./landlordAttentionNotify.ts"
import { discoverExternalVendorsForTicket } from "./external_vendor/discover.ts"
import {
  loadOpenLandlordVendorAsk,
  supersedeOpenLandlordVendorAskForTicket,
} from "./openLandlordVendorAsk.ts"
import { loadPropertyLocationFromTable } from "./properties/propertyLocation.ts"
import { ensureResidentRequestRef } from "./sms/residentRequestRef.ts"
import {
  choiceOptionsFromExternalSuggestions,
  formatExternalVendorSmsLine,
  landlordNumberedChoiceReplyHint,
  type AwaitingVendorChoice,
} from "./vendorLandlordChoice.ts"
import { shouldSkipSlaReassignForNeedsAdminVendor } from "./slaReassignEligibility.ts"

export { shouldSkipSlaReassignForNeedsAdminVendor }

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

/** @deprecated Prefer linkedWorkflowNeedsAdminVendor — kept for call-site compatibility. */
export const workflowEscalatedNeedsAdminVendor = linkedWorkflowNeedsAdminVendor

export type EscalateMaintenanceNeedsVendorOpts = {
  escalationReason: MaintenanceAdminVendorEscalationReason
  eventMessage: string
  graphEventType: string
  graphMessage: string
  /**
   * When true, close any open landlord ask first (vendor declined / ask expired /
   * landlord skip) then escalate with copy that explains the change.
   * Default false — open asks suppress escalation entirely.
   */
  closeOpenAskFirst?: boolean
  /** Prior vendor named on the open ask, when known by the caller. */
  previousVendorName?: string | null
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
  suppressed?: boolean
}

export async function escalateMaintenanceNeedsVendor(
  supabase: SupabaseClient,
  ticket: MaintenanceTicketScope,
  opts: EscalateMaintenanceNeedsVendorOpts,
): Promise<EscalateNeedsVendorResult> {
  const landlordId = ticket.landlord_id?.trim()
  if (!landlordId) return { nearbyOptionCount: 0, attention: null }

  const { shouldSuppressAutomationForManualOverride } = await import(
    "./workflowStageMove/manualStageOverride.ts"
  )
  if (
    await shouldSuppressAutomationForManualOverride(supabase, {
      ticketId: ticket.id,
      landlordId,
      reason: opts.escalationReason || "escalate_needs_vendor",
    })
  ) {
    return { nearbyOptionCount: 0, attention: null, suppressed: true }
  }

  let previousVendorName = opts.previousVendorName?.trim() || null
  let closedPriorAsk = false

  if (opts.closeOpenAskFirst === true) {
    const closed = await supersedeOpenLandlordVendorAskForTicket(supabase, {
      ticketId: ticket.id,
      landlordId,
      reason: opts.eventMessage,
    })
    closedPriorAsk = closed.closed
    previousVendorName = previousVendorName || closed.previousVendorName
  } else {
    const openAsk = await loadOpenLandlordVendorAsk(supabase, ticket.id)
    if (openAsk.open) {
      await recordActivityLog(supabase, {
        landlordId,
        eventType: "maintenance.escalation_suppressed_pending_landlord_ask",
        source: "automation",
        actorType: "system",
        maintenanceRequestId: ticket.id,
        metadata: {
          message:
            "Escalation suppressed because a landlord vendor ask is still open.",
          escalation_reason: opts.escalationReason,
          sources: openAsk.sources,
        },
      })
      return { nearbyOptionCount: 0, attention: null, suppressed: true }
    }
  }

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
      .select(
        "unit, building, description, issue_category, issue_headline, created_at, urgency, priority, property_id, resident_request_ref",
      )
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
    const issueHeadline =
      typeof ticketRow?.issue_headline === "string" ? ticketRow.issue_headline : ""
    const createdAt =
      typeof ticketRow?.created_at === "string" ? ticketRow.created_at : ""
    const propertyId =
      typeof ticketRow?.property_id === "string" ? ticketRow.property_id.trim() : ""
    let propertyType: string | null = null
    if (propertyId) {
      const { data: propertyRow } = await supabase
        .from("properties")
        .select("property_type")
        .eq("id", propertyId)
        .maybeSingle()
      propertyType =
        typeof propertyRow?.property_type === "string" ? propertyRow.property_type : null
    }
    const location = await loadPropertyLocationFromTable(supabase, landlordId, {
      propertyId: propertyId || null,
      building: building || null,
    })
    const street = location?.streetAddress?.trim() || building || ""
    const repair = shortRepairLabel(description, issueCategory, {
      issueHeadline,
      street,
    })
    const repairSentence = repair
      ? `${repair.charAt(0).toUpperCase()}${repair.slice(1)}.`
      : ""
    let requestRef =
      typeof ticketRow?.resident_request_ref === "string"
        ? ticketRow.resident_request_ref.trim()
        : ""
    if (!requestRef) {
      try {
        requestRef = await ensureResidentRequestRef(supabase, ticket.id)
      } catch {
        requestRef = ""
      }
    }
    const locationLine = formatAttentionLocationLine({
      street: location?.streetAddress,
      building,
      unit,
      propertyType,
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

    const vendorLabel = previousVendorName || "The vendor we asked about"
    let headline: string
    let whyLine: string
    if (closedPriorAsk || opts.closeOpenAskFirst === true) {
      const place = street || "this property"
      headline = previousVendorName
        ? `${previousVendorName} can't take this`
        : "Vendor unavailable"
      whyLine = `${vendorLabel} can't take the job at ${place} after all.`
    } else if (opts.escalationReason === "vendor_declined_no_vendor") {
      headline = "Vendor declined"
      whyLine = "No one on your preferred list can take this right now."
    } else {
      headline = "No vendor found"
      whyLine = "No one on your preferred list can take this right now."
    }

    const attention = await notifyLandlordNeedsAttention(supabase, {
      landlordId,
      kind: "assign_vendor",
      headline,
      detail: repairSentence,
      locationLine,
      whyLine,
      nextSteps,
      choiceReplyHint,
      vendorChoice,
      requestRef: requestRef || null,
      idempotencyKey: `assign_vendor:${ticket.id}:${opts.escalationReason}`,
      maintenanceRequestId: ticket.id,
      workflowRunId: run?.id ?? null,
      omitWorkOrderRef: true,
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

/**
 * After a vendor is assigned (initial dispatch or reassignment), clear
 * "needs a vendor" escalation so the run waits on accept.
 */
export async function resumeMaintenanceWorkflowAfterVendorAssigned(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    vendorId?: string | null
    eventMessage?: string | null
    eventStep?: string | null
    currentStep?: string | null
  },
): Promise<void> {
  const ticketId = params.ticketId.trim()
  if (!ticketId) return

  const { data: run } = await supabase
    .from("workflow_runs")
    .select("id, status, metadata")
    .eq("entity_type", "maintenance_request")
    .eq("entity_id", ticketId)
    .in("status", ["escalated", "active", "pending"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!run?.id) return

  const vendorId = params.vendorId?.trim() || null
  const metadata: Record<string, unknown> = {
    vendor_assigned_at: new Date().toISOString(),
    escalation_reason: null,
  }
  if (vendorId) metadata.assigned_vendor_id = vendorId

  await updateWorkflowRun(supabase, run.id, {
    status: "active",
    currentStep: params.currentStep?.trim() || "awaiting_vendor_accept",
    metadata,
    pipelineStage: "act",
    eventMessage: params.eventMessage?.trim() || "Vendor assigned",
    eventStep: params.eventStep?.trim() || "vendor_assigned",
  })

  // Clear sticky needs_admin hold + close activity episode so automation can resume.
  try {
    const { clearNeedsAdminVendorSticky } = await import(
      "./clearNeedsAdminVendorSticky.ts"
    )
    await clearNeedsAdminVendorSticky(supabase, ticketId)
  } catch (e) {
    console.warn("[maintenance-admin-escalation] clear sticky", e)
  }
  try {
    const { data: ticket } = await supabase
      .from("maintenance_requests")
      .select("landlord_id")
      .eq("id", ticketId)
      .maybeSingle()
    const landlordId =
      typeof ticket?.landlord_id === "string" ? ticket.landlord_id.trim() : ""
    if (landlordId) {
      await closeNeedsVendorActivityEpisode(supabase, {
        landlordId,
        maintenanceRequestId: ticketId,
      })
    }
  } catch (e) {
    console.warn("[maintenance-admin-escalation] close episode", e)
  }
}

/** After the assigned vendor accepts, drop the "needs a vendor" escalation. */
export async function resumeMaintenanceWorkflowAfterVendorAccepted(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<void> {
  try {
    const { clearManualStageOverrideForTicket } = await import(
      "./workflowStageMove/manualStageOverride.ts"
    )
    await clearManualStageOverrideForTicket(supabase, {
      ticketId,
      reason: "vendor_accepted",
    })
  } catch (e) {
    console.error("[maintenance-admin-escalation] clear manual override", e)
  }

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
