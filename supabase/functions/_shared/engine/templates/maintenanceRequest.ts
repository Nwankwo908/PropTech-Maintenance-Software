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
  executeAutoVendorReassignment,
  findReplacementVendorForTicket,
  type FindReplacementStrategy,
  type NoVendorEscalationTrigger,
  type ReplacementVendor,
  type VendorReassignTrigger,
} from "../../vendor_reassignment.ts"
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

  let newVendor = input.newVendor ?? null

  if (!newVendor) {
    const findResult = await findReplacementVendorForTicket(supabase, {
      ticketId,
      assignedVendorId: input.assignedVendorId,
      issueCategory: input.issueCategory,
      landlordId: input.landlordId,
      excludeVendorIds: input.excludeVendorIds,
      strategy: input.findStrategy,
      preferNotRecentlyAssigned: input.preferNotRecentlyAssigned,
      preferNotVendorId: input.preferNotVendorId,
    })

    if (!findResult.ok) {
      return {
        templateId: "maintenance_request",
        route: workflowRouteForTemplate("maintenance_request"),
        metadata: {
          action: "auto_reassign",
          outcome: "skipped",
          reason: findResult.error,
          ticket_id: ticketId,
        },
      }
    }

    newVendor = findResult.vendor
  }

  if (!newVendor) {
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

  const result = await executeAutoVendorReassignment(supabase, {
    ticketId,
    newVendor,
    trigger: input.trigger,
    previousVendorId: input.previousVendorId,
    landlordId: input.landlordId,
    notifyResident: input.notifyResident,
    activityMetadataExtra: input.activityMetadataExtra,
    skipWorkflowAdvance: true,
  })

  if (result.outcome === "failed") {
    return {
      templateId: "maintenance_request",
      route: workflowRouteForTemplate("maintenance_request"),
      metadata: {
        action: "auto_reassign",
        outcome: "failed",
        reason: result.reason,
        ticket_id: ticketId,
      },
    }
  }

  const workflowMessage = workflowMessageForTrigger(input.trigger, newVendor.name)
  const runId = await advanceMaintenanceRequestVendorStep(supabase, {
    ticketId,
    step: "awaiting_vendor_accept",
    eventMessage: workflowMessage,
    eventStep: "vendor_reassigned",
    resumeFromEscalated: input.trigger !== "pending_accept_stale" &&
      input.trigger !== "noshow_rematch",
  })

  return {
    templateId: "maintenance_request",
    route: workflowRouteForTemplate("maintenance_request"),
    runId,
    metadata: {
      action: "auto_reassign",
      outcome: "reassigned",
      ticket_id: ticketId,
      trigger: input.trigger,
      new_vendor_id: newVendor.id,
      classified_reason: intent.reason,
    },
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

function workflowMessageForTrigger(
  trigger: VendorReassignTrigger,
  vendorName: string,
): string {
  switch (trigger) {
    case "vendor_declined":
      return `Auto-reassigned to ${vendorName} after vendor decline`
    case "sla_expired":
      return `Auto-reassigned to ${vendorName} after SLA expired`
    case "pending_accept_stale":
      return `Auto-reassigned to ${vendorName} after no response`
    case "noshow_rematch":
      return `No-show rematch to ${vendorName}`
  }
}
