/**
 * Maintenance request lifecycle — ticket submit, vendor assign/reassign, SLA escalation.
 * trigger → classify → route → act → escalate → log
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  escalateMaintenanceNeedsVendor,
  SUBMITTED_NO_VENDOR_ESCALATION,
  type MaintenanceAdminVendorEscalationReason,
  type MaintenanceTicketScope,
} from "../../maintenance_admin_escalation.ts"
import {
  escalateWhenNoReplacementVendor,
  resolveReplacementVendorChoiceForTicket,
  type FindReplacementStrategy,
  type NoVendorEscalationTrigger,
  type ReplacementVendor,
  type VendorReassignTrigger,
} from "../../vendor_reassignment.ts"
import {
  AWAITING_LANDLORD_VENDOR_CHOICE,
  loadStoredAwaitingVendorChoiceForTicket,
  notifyLandlordVendorChoice,
  ticketIsAwaitingLandlordVendorChoice,
  vendorChoiceOptionIdsEqual,
} from "../../vendorLandlordChoice.ts"
import { workflowRouteForTemplate } from "../logStage.ts"
import {
  advanceMaintenanceRequestVendorStep,
  startMaintenanceRequestRun,
  type StartMaintenanceRequestRunParams,
} from "../maintenanceRequestProgress.ts"
import type {
  ClassifiedIntent,
  WorkflowActResult,
  WorkflowExecutionContext,
  WorkflowTemplate,
} from "../types.ts"

export type MaintenanceRequestEngineAction =
  | "ticket_submitted"
  | "auto_reassign"
  | "admin_reassigned"
  | "vendor_reassigned"
  | "escalate_no_vendor"

export type MaintenanceRequestEngineInput = {
  action: MaintenanceRequestEngineAction
  ticketSubmitted?: StartMaintenanceRequestRunParams
  autoReassign?: {
    ticketId: string
    trigger: VendorReassignTrigger
    landlordId?: string | null
    assignedVendorId?: string | null
    issueCategory?: string | null
    previousVendorId?: string | null
    findStrategy?: FindReplacementStrategy
    preferNotRecentlyAssigned?: boolean
    preferNotVendorId?: string | null
    excludeVendorIds?: string[]
    /** When set, skip find and reassign to this vendor directly. */
    newVendor?: ReplacementVendor | null
    notifyResident?: boolean
    activityMetadataExtra?: Record<string, unknown>
    clearSchedule?: boolean
  }
  adminReassigned?: {
    ticketId: string
    vendorId: string
    vendorName: string
  }
  vendorReassigned?: {
    ticketId: string
    trigger: VendorReassignTrigger
    vendorName: string
    vendorId?: string
    workflowMessage: string
    resumeFromEscalated?: boolean
  }
  escalateNoVendor?: {
    ticket: MaintenanceTicketScope
    trigger: NoVendorEscalationTrigger
    escalationReason: MaintenanceAdminVendorEscalationReason
    eventMessage: string
    graphEventType: string
    graphMessage: string
  }
}

type MaintenanceRequestContext = WorkflowExecutionContext & {
  maintenanceRequest?: MaintenanceRequestEngineInput
}

export const maintenanceRequestTemplate: WorkflowTemplate = {
  id: "maintenance_request",
  name: "Maintenance request",
  supportedTriggers: [
    "dashboard",
    "webhook",
    "sms_inbound",
    "automation",
    "cron",
  ],

  classify(ctx): ClassifiedIntent | null {
    if (ctx.cron?.templateId === "maintenance_request") {
      return {
        templateId: "maintenance_request",
        confidence: "high",
        reason: "cron_maintenance_request",
        runId: ctx.runId ?? ctx.activeRun?.id ?? null,
      }
    }

    const meta = (ctx as MaintenanceRequestContext).maintenanceRequest
    if (
      meta &&
      (ctx.trigger === "dashboard" ||
        ctx.trigger === "webhook" ||
        ctx.trigger === "sms_inbound" ||
        ctx.trigger === "automation")
    ) {
      return {
        templateId: "maintenance_request",
        confidence: "high",
        reason: `maintenance_request_${meta.action}`,
        runId: ctx.runId ?? ctx.activeRun?.id ?? null,
      }
    }

    return null
  },

  async act(
    supabase: SupabaseClient,
    ctx: WorkflowExecutionContext,
    intent: ClassifiedIntent,
  ): Promise<WorkflowActResult> {
    const meta = (ctx as MaintenanceRequestContext).maintenanceRequest
    if (!meta) {
      return {
        templateId: "maintenance_request",
        route: workflowRouteForTemplate("maintenance_request"),
        metadata: { error: "missing_maintenance_request_context" },
      }
    }

    if (meta.action === "ticket_submitted" && meta.ticketSubmitted) {
      const started = await startMaintenanceRequestRun(
        supabase,
        meta.ticketSubmitted,
      )
      const needsVendor = Boolean(meta.ticketSubmitted.needsVendorEscalation)
      if (needsVendor) {
        await escalateMaintenanceNeedsVendor(
          supabase,
          {
            id: meta.ticketSubmitted.ticketId,
            landlord_id: meta.ticketSubmitted.landlordId,
          },
          SUBMITTED_NO_VENDOR_ESCALATION,
        )
      }
      return {
        templateId: "maintenance_request",
        route: workflowRouteForTemplate("maintenance_request"),
        runId: started.workflowRunId,
        metadata: {
          action: "ticket_submitted",
          ticket_id: meta.ticketSubmitted.ticketId,
          vendor_assigned: Boolean(meta.ticketSubmitted.vendorAssigned),
          needs_vendor: needsVendor,
        },
        shouldEscalate: needsVendor,
      }
    }

    if (meta.action === "vendor_reassigned" && meta.vendorReassigned) {
      const p = meta.vendorReassigned
      const runId = await advanceMaintenanceRequestVendorStep(supabase, {
        ticketId: p.ticketId,
        step: "awaiting_vendor_accept",
        eventMessage: p.workflowMessage,
        eventStep: "vendor_reassigned",
        vendorId: p.vendorId,
        resumeFromEscalated: p.resumeFromEscalated ?? true,
      })
      return {
        templateId: "maintenance_request",
        route: workflowRouteForTemplate("maintenance_request"),
        runId,
        metadata: {
          action: "vendor_reassigned",
          trigger: p.trigger,
          vendor_name: p.vendorName,
        },
      }
    }

    if (meta.action === "admin_reassigned" && meta.adminReassigned) {
      const p = meta.adminReassigned
      const runId = await advanceMaintenanceRequestVendorStep(supabase, {
        ticketId: p.ticketId,
        step: "pending_accept",
        eventMessage: `Admin reassigned to ${p.vendorName}`,
        eventStep: "admin_reassigned",
        resumeFromEscalated: true,
        vendorId: p.vendorId,
      })
      return {
        templateId: "maintenance_request",
        route: workflowRouteForTemplate("maintenance_request"),
        runId,
        metadata: {
          action: "admin_reassigned",
          vendor_id: p.vendorId,
        },
      }
    }

    if (meta.action === "escalate_no_vendor" && meta.escalateNoVendor) {
      const p = meta.escalateNoVendor
      await escalateMaintenanceNeedsVendor(supabase, p.ticket, {
        escalationReason: p.escalationReason,
        eventMessage: p.eventMessage,
        graphEventType: p.graphEventType,
        graphMessage: p.graphMessage,
      })
      return {
        templateId: "maintenance_request",
        route: workflowRouteForTemplate("maintenance_request"),
        metadata: {
          action: "escalate_no_vendor",
          trigger: p.trigger,
          ticket_id: p.ticket.id,
        },
        shouldEscalate: true,
      }
    }

    if (meta.action === "auto_reassign" && meta.autoReassign) {
      return processMaintenanceAutoReassign(supabase, ctx, intent, meta.autoReassign)
    }

    return {
      templateId: "maintenance_request",
      route: workflowRouteForTemplate("maintenance_request"),
      metadata: {
        error: "unsupported_maintenance_request_action",
        action: meta.action,
        classified_reason: intent.reason,
      },
    }
  },
}

async function processMaintenanceAutoReassign(
  supabase: SupabaseClient,
  _ctx: WorkflowExecutionContext,
  intent: ClassifiedIntent,
  input: NonNullable<MaintenanceRequestEngineInput["autoReassign"]>,
): Promise<WorkflowActResult> {
  const ticketId = input.ticketId.trim()
  if (!ticketId) {
    return {
      templateId: "maintenance_request",
      route: workflowRouteForTemplate("maintenance_request"),
      metadata: { error: "missing_ticket_id" },
    }
  }

  if (input.clearSchedule) {
    await supabase
      .from("maintenance_requests")
      .update({
        scheduled_at: null,
        scheduled_window_text: null,
        schedule_confirmed_at: null,
      })
      .eq("id", ticketId)
  }

  const { data: ticketRow } = await supabase
    .from("maintenance_requests")
    .select("unit, vendor_notify_error")
    .eq("id", ticketId)
    .maybeSingle()

  if (
    ticketIsAwaitingLandlordVendorChoice(
      typeof ticketRow?.vendor_notify_error === "string"
        ? ticketRow.vendor_notify_error
        : null,
    )
  ) {
    return {
      templateId: "maintenance_request",
      route: workflowRouteForTemplate("maintenance_request"),
      metadata: {
        action: "auto_reassign",
        outcome: "awaiting_landlord_choice",
        ticket_id: ticketId,
        trigger: input.trigger,
      },
    }
  }

  const decision = await resolveReplacementVendorChoiceForTicket(supabase, {
    ticketId,
    assignedVendorId: input.assignedVendorId,
    issueCategory: input.issueCategory,
    landlordId: input.landlordId,
    excludeVendorIds: input.excludeVendorIds,
    preferNotVendorId: input.preferNotVendorId,
  })

  if (decision.kind === "landlord_choice" && decision.options.length > 0) {
    const landlordId = input.landlordId?.trim()
    if (!landlordId) {
      return {
        templateId: "maintenance_request",
        route: workflowRouteForTemplate("maintenance_request"),
        metadata: {
          action: "auto_reassign",
          outcome: "skipped",
          reason: "missing_landlord",
          ticket_id: ticketId,
        },
      }
    }
    const asked = await notifyLandlordVendorChoice(supabase, {
      landlordId,
      ticketId,
      unit: typeof ticketRow?.unit === "string" ? ticketRow.unit : "",
      issueCategory: input.issueCategory ?? null,
      options: decision.options,
      reason: landlordChoiceReasonForTrigger(input.trigger),
    })
    if (asked.sent < 1) {
      return {
        templateId: "maintenance_request",
        route: workflowRouteForTemplate("maintenance_request"),
        metadata: {
          action: "auto_reassign",
          outcome: "skipped",
          reason: "landlord_choice_sms_failed",
          ticket_id: ticketId,
        },
      }
    }
    await supabase
      .from("maintenance_requests")
      .update({ vendor_notify_error: AWAITING_LANDLORD_VENDOR_CHOICE })
      .eq("id", ticketId)
    return {
      templateId: "maintenance_request",
      route: workflowRouteForTemplate("maintenance_request"),
      metadata: {
        action: "auto_reassign",
        outcome: "awaiting_landlord_choice",
        ticket_id: ticketId,
        trigger: input.trigger,
        option_ids: decision.options.map((row) => row.vendor.id),
        classified_reason: intent.reason,
      },
    }
  }

  if (input.trigger === "vendor_declined" && input.previousVendorId) {
    await supabase
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
      .eq("assigned_vendor_id", input.previousVendorId)

    await supabase.from("vendor_status_events").insert({
      ticket_id: ticketId,
      from_status: "declined",
      to_status: "unassigned",
      source: "auto_reassign",
      vendor_id: input.previousVendorId,
    })
  }

  const escalationTrigger = mapReassignToEscalationTrigger(input.trigger)
  if (escalationTrigger && input.landlordId) {
    await escalateWhenNoReplacementVendor(
      supabase,
      { id: ticketId, landlord_id: input.landlordId },
      escalationTrigger,
    )
  }
  return {
    templateId: "maintenance_request",
    route: workflowRouteForTemplate("maintenance_request"),
    metadata: {
      action: "auto_reassign",
      outcome: "needs_admin_vendor",
      ticket_id: ticketId,
      trigger: input.trigger,
    },
    shouldEscalate: true,
  }
}

function landlordChoiceReasonForTrigger(
  trigger: VendorReassignTrigger,
): "assign" | "no_response" | "declined" | "noshow" {
  switch (trigger) {
    case "vendor_declined":
      return "declined"
    case "noshow_rematch":
      return "noshow"
    case "sla_expired":
    case "pending_accept_stale":
      return "no_response"
  }
}

function mapReassignToEscalationTrigger(
  trigger: VendorReassignTrigger,
): NoVendorEscalationTrigger | null {
  switch (trigger) {
    case "vendor_declined":
      return "vendor_declined"
    case "sla_expired":
      return "sla_expired"
    case "pending_accept_stale":
      return "pending_accept_stale"
    default:
      return null
  }
}
