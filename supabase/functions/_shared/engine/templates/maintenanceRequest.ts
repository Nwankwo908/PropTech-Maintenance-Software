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
  abandonStaleLandlordVendorChoiceAsk,
  loadStoredAwaitingVendorChoiceForTicket,
  markAwaitingLandlordVendorChoice,
  notifyLandlordVendorChoice,
  ticketIsAwaitingLandlordVendorChoice,
  vendorChoiceOptionIdsEqual,
} from "../../vendorLandlordChoice.ts"
import { ticketIsAwaitingVendorAvailabilityProbe } from "../../vendorAvailabilityProbe.ts"
import {
  decideAutoReassignGuard,
  detectNeedsAdminCycle,
  type VendorReassignGuardTrigger,
} from "../../../../../shared/ops/vendorReassignGuards.ts"
import { recordActivityLog } from "../../graph/recordActivityLog.ts"
import { staffAlertRecipients } from "../../smsRecipients.ts"
import { getSMSProviderForSend } from "../../sms/providerFactory.ts"
import { findActiveLandlordMainNumber } from "../../sms/landlordSmsOnboarding.ts"
import {
  clearNeedsAdminVendorSticky,
  releaseNeedsAdminVendorToAutomation,
} from "../../clearNeedsAdminVendorSticky.ts"

export {
  clearNeedsAdminVendorSticky,
  releaseNeedsAdminVendorToAutomation,
}
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
    /** Decide only — no SMS, no ticket/workflow writes. */
    dryRun?: boolean
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

async function persistAutoReassignRepeatState(
  supabase: SupabaseClient,
  ticketId: string,
  repeat: { signature: string; count: number; sinceMs: number },
  extras?: { needsAdminEntries?: number },
): Promise<void> {
  const patch: Record<string, unknown> = {
    auto_reassign_last_outcome: repeat.signature,
    auto_reassign_same_outcome_count: repeat.count,
    auto_reassign_same_outcome_since: new Date(repeat.sinceMs).toISOString(),
  }
  if (typeof extras?.needsAdminEntries === "number") {
    patch.auto_reassign_needs_admin_entries = extras.needsAdminEntries
  }
  await supabase.from("maintenance_requests").update(patch).eq("id", ticketId)
}

async function alertStaffNeedsAdminCycle(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    reason: string
    entryCount: number
  },
): Promise<void> {
  const message =
    `Ulo cycle alert: work order re-entered "needs a vendor" (entry ${params.entryCount}, ${params.reason.replace(/_/g, " ")}). Staff review required.`
  try {
    await recordActivityLog(supabase, {
      landlordId: params.landlordId,
      eventType: "maintenance.needs_admin_cycle_detected",
      source: "automation",
      actorType: "system",
      maintenanceRequestId: params.ticketId,
      metadata: {
        message,
        reason: params.reason,
        entry_count: params.entryCount,
      },
    })
  } catch (e) {
    console.error("[maintenance_request] needs_admin cycle log", e)
  }

  const phones = staffAlertRecipients()
  if (phones.length === 0) {
    console.warn(
      "[maintenance_request] needs_admin cycle — staff SMS empty, logged only",
    )
    return
  }
  try {
    const sender = await findActiveLandlordMainNumber(supabase, params.landlordId)
    const from = sender?.phone_number?.trim()
    if (!from) return
    const provider = getSMSProviderForSend({
      landlordId: params.landlordId,
      lineProvider: sender.provider,
    })
    for (const to of phones) {
      await provider.sendMessage({ to, body: message, from })
    }
  } catch (e) {
    console.error("[maintenance_request] needs_admin cycle staff SMS", e)
  }
}

async function enterNeedsAdminVendorState(
  supabase: SupabaseClient,
  input: {
    ticketId: string
    landlordId: string | null
    trigger: VendorReassignTrigger
    lastOutcomeSignature: string | null
    priorNeedsAdminEntries: number
  },
): Promise<void> {
  const cycle = detectNeedsAdminCycle({
    lastOutcomeSignature: input.lastOutcomeSignature,
    priorNeedsAdminEntries: input.priorNeedsAdminEntries,
    enteringNeedsAdmin: true,
  })
  await persistAutoReassignRepeatState(
    supabase,
    input.ticketId,
    {
      signature: `needs_admin_vendor|${input.trigger}`,
      count: 1,
      sinceMs: Date.now(),
    },
    { needsAdminEntries: cycle.nextEntryCount },
  )
  if (cycle.alert && input.landlordId && cycle.reason) {
    await alertStaffNeedsAdminCycle(supabase, {
      landlordId: input.landlordId,
      ticketId: input.ticketId,
      reason: cycle.reason,
      entryCount: cycle.nextEntryCount,
    })
  }
}

async function escalateStuckAutoReassign(
  supabase: SupabaseClient,
  input: {
    ticketId: string
    landlordId: string | null | undefined
    trigger: VendorReassignTrigger
    reason:
      | "awaiting_choice_dwell_exceeded"
      | "awaiting_probe_dwell_exceeded"
      | "identical_outcome_loop"
    loopCount?: number
    signature?: string
    lastOutcomeSignature?: string | null
    priorNeedsAdminEntries?: number
  },
): Promise<WorkflowActResult> {
  const ticketId = input.ticketId
  await abandonStaleLandlordVendorChoiceAsk(supabase, ticketId)

  const landlordId = input.landlordId?.trim() || null
  if (landlordId) {
    const message =
      input.reason === "identical_outcome_loop"
        ? `Auto-reassign repeated the same outcome ${input.loopCount ?? "many"} times without progress — needs a staff decision.`
        : input.reason === "awaiting_probe_dwell_exceeded"
        ? "Vendor availability ask went unanswered past the wait window — needs a staff decision."
        : "Landlord vendor choice went unanswered past the wait window — needs a staff decision."
    try {
      await recordActivityLog(supabase, {
        landlordId,
        eventType:
          input.reason === "identical_outcome_loop"
            ? "maintenance.auto_reassign_loop_detected"
            : "maintenance.landlord_choice_unanswered",
        source: "automation",
        actorType: "system",
        maintenanceRequestId: ticketId,
        metadata: {
          message,
          trigger: input.trigger,
          outcome_signature: input.signature ?? null,
          repeat_count: input.loopCount ?? null,
        },
      })
    } catch (e) {
      console.error("[maintenance_request] stuck auto-reassign log", e)
    }
  }

  const escalationTrigger = mapReassignToEscalationTrigger(input.trigger)
  if (escalationTrigger && landlordId) {
    await escalateWhenNoReplacementVendor(
      supabase,
      { id: ticketId, landlord_id: landlordId },
      escalationTrigger,
    )
  }

  await enterNeedsAdminVendorState(supabase, {
    ticketId,
    landlordId,
    trigger: input.trigger,
    lastOutcomeSignature: input.lastOutcomeSignature ?? null,
    priorNeedsAdminEntries: input.priorNeedsAdminEntries ?? 0,
  })

  return {
    templateId: "maintenance_request",
    route: workflowRouteForTemplate("maintenance_request"),
    metadata: {
      action: "auto_reassign",
      outcome: "needs_admin_vendor",
      reason: input.reason,
      ticket_id: ticketId,
      trigger: input.trigger,
      loop_count: input.loopCount ?? null,
    },
    shouldEscalate: true,
  }
}

async function processMaintenanceAutoReassign(
  supabase: SupabaseClient,
  _ctx: WorkflowExecutionContext,
  intent: ClassifiedIntent,
  input: NonNullable<MaintenanceRequestEngineInput["autoReassign"]>,
): Promise<WorkflowActResult> {
  const ticketId = input.ticketId.trim()
  const dryRun = input.dryRun === true
  if (!ticketId) {
    return {
      templateId: "maintenance_request",
      route: workflowRouteForTemplate("maintenance_request"),
      metadata: { error: "missing_ticket_id" },
    }
  }

  if (input.clearSchedule && !dryRun) {
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
    .select(
      "unit, vendor_work_status, vendor_notify_error, due_at, assigned_at, assigned_vendor_id, vendor_notified_at, awaiting_landlord_choice_at, awaiting_vendor_availability_at, landlord_vendor_choice_resolved_at, auto_reassign_last_outcome, auto_reassign_same_outcome_count, auto_reassign_same_outcome_since, auto_reassign_needs_admin_entries",
    )
    .eq("id", ticketId)
    .maybeSingle()

  const workStatus = String(ticketRow?.vendor_work_status ?? "")
    .trim()
    .toLowerCase()
  if (workStatus === "accepted" || workStatus === "in_progress") {
    return {
      status: "ok",
      templateId: "maintenance_request",
      route: workflowRouteForTemplate("maintenance_request"),
      metadata: {
        outcome: "skipped",
        reason: "vendor_active_on_job",
        vendor_work_status: workStatus,
        dry_run: dryRun || undefined,
      },
    }
  }

  const awaitingChoice = ticketIsAwaitingLandlordVendorChoice(
    typeof ticketRow?.vendor_notify_error === "string"
      ? ticketRow.vendor_notify_error
      : null,
  )
  const awaitingProbe = ticketIsAwaitingVendorAvailabilityProbe(
    typeof ticketRow?.vendor_notify_error === "string"
      ? ticketRow.vendor_notify_error
      : null,
  )
  const lastOutcomeSignature =
    typeof ticketRow?.auto_reassign_last_outcome === "string"
      ? ticketRow.auto_reassign_last_outcome
      : null
  const priorNeedsAdminEntries =
    typeof ticketRow?.auto_reassign_needs_admin_entries === "number"
      ? ticketRow.auto_reassign_needs_admin_entries
      : 0
  const guardTrigger = input.trigger as VendorReassignGuardTrigger
  const guard = decideAutoReassignGuard({
    trigger: guardTrigger,
    nowMs: Date.now(),
    dueAt: typeof ticketRow?.due_at === "string" ? ticketRow.due_at : null,
    assignedAt:
      typeof ticketRow?.assigned_at === "string" ? ticketRow.assigned_at : null,
    awaitingLandlordChoice: awaitingChoice,
    awaitingLandlordChoiceAt:
      typeof ticketRow?.awaiting_landlord_choice_at === "string"
        ? ticketRow.awaiting_landlord_choice_at
        : null,
    awaitingVendorAvailabilityProbe: awaitingProbe,
    awaitingVendorAvailabilityAt:
      typeof ticketRow?.awaiting_vendor_availability_at === "string"
        ? ticketRow.awaiting_vendor_availability_at
        : null,
    landlordVendorChoiceResolvedAt:
      typeof ticketRow?.landlord_vendor_choice_resolved_at === "string"
        ? ticketRow.landlord_vendor_choice_resolved_at
        : null,
    vendorNotifiedAt:
      typeof ticketRow?.vendor_notified_at === "string"
        ? ticketRow.vendor_notified_at
        : null,
    assignedVendorId:
      typeof ticketRow?.assigned_vendor_id === "string"
        ? ticketRow.assigned_vendor_id
        : input.assignedVendorId ?? null,
    lastOutcomeSignature,
    sameOutcomeCount:
      typeof ticketRow?.auto_reassign_same_outcome_count === "number"
        ? ticketRow.auto_reassign_same_outcome_count
        : 0,
    sameOutcomeSince:
      typeof ticketRow?.auto_reassign_same_outcome_since === "string"
        ? ticketRow.auto_reassign_same_outcome_since
        : null,
  })

  if (guard.action === "escalate_awaiting_stale") {
    if (dryRun) {
      return {
        templateId: "maintenance_request",
        route: workflowRouteForTemplate("maintenance_request"),
        metadata: {
          action: "auto_reassign",
          outcome: "needs_admin_vendor",
          reason: guard.reason,
          ticket_id: ticketId,
          trigger: input.trigger,
          dry_run: true,
        },
        shouldEscalate: true,
      }
    }
    return escalateStuckAutoReassign(supabase, {
      ticketId,
      landlordId: input.landlordId,
      trigger: input.trigger,
      reason: guard.reason,
      lastOutcomeSignature,
      priorNeedsAdminEntries,
    })
  }

  if (guard.action === "escalate_loop") {
    if (dryRun) {
      return {
        templateId: "maintenance_request",
        route: workflowRouteForTemplate("maintenance_request"),
        metadata: {
          action: "auto_reassign",
          outcome: "needs_admin_vendor",
          reason: "identical_outcome_loop",
          ticket_id: ticketId,
          trigger: input.trigger,
          dry_run: true,
        },
        shouldEscalate: true,
      }
    }
    return escalateStuckAutoReassign(supabase, {
      ticketId,
      landlordId: input.landlordId,
      trigger: input.trigger,
      reason: "identical_outcome_loop",
      loopCount: guard.count,
      signature: guard.signature,
      lastOutcomeSignature,
      priorNeedsAdminEntries,
    })
  }

  if (guard.action === "short_circuit_awaiting") {
    if (!dryRun) {
      if (
        guard.reason === "awaiting_landlord_choice" &&
        guard.stampLandlordChoiceAt
      ) {
        const stamped = new Date().toISOString()
        await supabase
          .from("maintenance_requests")
          .update({ awaiting_landlord_choice_at: stamped })
          .eq("id", ticketId)
      }
      await persistAutoReassignRepeatState(supabase, ticketId, guard.repeat)
    }
    return {
      templateId: "maintenance_request",
      route: workflowRouteForTemplate("maintenance_request"),
      metadata: {
        action: "auto_reassign",
        outcome: guard.reason,
        ticket_id: ticketId,
        trigger: input.trigger,
        repeat_count: guard.repeat.count,
        stamped_landlord_choice_at: Boolean(guard.stampLandlordChoiceAt),
        dry_run: dryRun || undefined,
      },
    }
  }

  if (guard.action === "skip") {
    return {
      templateId: "maintenance_request",
      route: workflowRouteForTemplate("maintenance_request"),
      metadata: {
        action: "auto_reassign",
        outcome: "skipped",
        reason: guard.reason,
        ticket_id: ticketId,
        trigger: input.trigger,
        dry_run: dryRun || undefined,
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
          dry_run: dryRun || undefined,
        },
      }
    }
    if (dryRun) {
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
          dry_run: true,
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
    await markAwaitingLandlordVendorChoice(supabase, ticketId)
    await persistAutoReassignRepeatState(supabase, ticketId, {
      signature: `awaiting_landlord_choice|${input.trigger}`,
      count: 1,
      sinceMs: Date.now(),
    })
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

  if (input.trigger === "vendor_declined" && input.previousVendorId && !dryRun) {
    await supabase
      .from("maintenance_requests")
      .update({
        assigned_vendor_id: null,
        vendor_action_token: null,
        vendor_work_status: "unassigned",
        vendor_notified_at: null,
        vendor_notify_error: null,
        awaiting_landlord_choice_at: null,
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

  if (dryRun) {
    return {
      templateId: "maintenance_request",
      route: workflowRouteForTemplate("maintenance_request"),
      metadata: {
        action: "auto_reassign",
        outcome: "needs_admin_vendor",
        ticket_id: ticketId,
        trigger: input.trigger,
        dry_run: true,
      },
      shouldEscalate: true,
    }
  }

  const escalationTrigger = mapReassignToEscalationTrigger(input.trigger)
  if (escalationTrigger && input.landlordId) {
    await escalateWhenNoReplacementVendor(
      supabase,
      { id: ticketId, landlord_id: input.landlordId },
      escalationTrigger,
    )
  }
  await enterNeedsAdminVendorState(supabase, {
    ticketId,
    landlordId: input.landlordId?.trim() || null,
    trigger: input.trigger,
    lastOutcomeSignature,
    priorNeedsAdminEntries,
  })
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
