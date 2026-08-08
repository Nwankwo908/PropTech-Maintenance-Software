/**
 * Vendor reschedule conversation — owned by vendor_job_response workflow.
 * Registry detects intent and dispatches here via runWorkflowEngine.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { workflowRouteForTemplate } from "../engine/logStage.ts"
import type {
  ClassifiedIntent,
  WorkflowActResult,
  WorkflowExecutionContext,
} from "../engine/types.ts"
import { readVendorScheduleFsm } from "../vendor_schedule_fsm.ts"
import {
  buildVendorWorkOrderClarifySms,
  isVendorWorkOrderClarificationExpired,
  listVendorActiveJobs,
  persistVendorWorkOrderClarification,
  readVendorWorkOrderClarification,
  resolveClarificationSelection,
} from "./vendorWorkOrderClarification.ts"
import {
  detectVendorRescheduleIntent,
  readVendorReschedulePending,
  tryHandleVendorRescheduleSms,
} from "./vendorRescheduleSms.ts"
import { recordVendorRepliedEvent } from "./vendorSmsRouting.ts"
import type { WorkflowContext } from "./workflow_types.ts"

export type VendorRescheduleGateContext = {
  vendorId: string
  body: string
  pendingRescheduleVendorId: string | null
  clarificationOriginalIntent: string | null
  scheduleStep: string | undefined
}

export async function loadVendorRescheduleGateContext(
  supabase: SupabaseClient,
  params: {
    vendorId: string
    conversationId: string
    body: string
  },
): Promise<VendorRescheduleGateContext> {
  const vendorId = params.vendorId.trim()
  const { data: convo } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", params.conversationId)
    .maybeSingle()

  const intake = (convo?.intake_state as Record<string, unknown> | null) ?? null
  const prev = readVendorScheduleFsm(intake)
  const pendingClarify = readVendorWorkOrderClarification(intake)
  const pendingReschedule = readVendorReschedulePending(intake)

  let clarificationOriginalIntent: string | null = null
  if (
    pendingClarify &&
    pendingClarify.originalIntent === "reschedule" &&
    !isVendorWorkOrderClarificationExpired(pendingClarify)
  ) {
    clarificationOriginalIntent = pendingClarify.originalIntent
  }

  return {
    vendorId,
    body: params.body,
    pendingRescheduleVendorId: pendingReschedule?.vendorId ?? null,
    clarificationOriginalIntent,
    scheduleStep: prev?.step,
  }
}

export function shouldActVendorRescheduleInWorkflow(
  intent: ClassifiedIntent,
  gate: VendorRescheduleGateContext,
): boolean {
  if (intent.reason === "vendor_reschedule_registry_dispatch") return true
  return shouldAttemptVendorRescheduleInbound(gate)
}

/**
 * Full reschedule conversation turn (WO clarify, pending time, resident confirm).
 * Single owner of tryHandleVendorRescheduleSms — not called from the registry.
 */
export async function actVendorRescheduleInboundTurn(
  supabase: SupabaseClient,
  ctx: WorkflowExecutionContext,
): Promise<WorkflowActResult> {
  const sms = ctx.sms
  if (!sms?.identity.vendor_id?.trim()) {
    return {
      templateId: "vendor_job_response",
      route: workflowRouteForTemplate("vendor_job_response"),
      metadata: { vendorReschedule: false, error: "missing_vendor" },
    }
  }

  const vendorId = sms.identity.vendor_id.trim()
  const { data: convo } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", sms.conversationId)
    .maybeSingle()

  let intake = (convo?.intake_state as Record<string, unknown> | null) ?? null
  const openJobs = await listVendorActiveJobs(supabase, vendorId)

  let effectiveBody = sms.inbound.body
  let forcedTicketId: string | null = null
  let clarificationOriginalIntent: string | null = null

  const pendingClarify = readVendorWorkOrderClarification(intake)
  if (pendingClarify) {
    if (pendingClarify.originalIntent !== "reschedule") {
      return {
        templateId: "vendor_job_response",
        route: workflowRouteForTemplate("vendor_job_response"),
        metadata: { vendorReschedule: false, wrongClarificationIntent: true },
      }
    }

    if (isVendorWorkOrderClarificationExpired(pendingClarify)) {
      await persistVendorWorkOrderClarification(supabase, {
        conversationId: sms.conversationId,
        clarification: null,
      })
    } else {
      const selectedId = resolveClarificationSelection(
        sms.inbound.body,
        pendingClarify,
        openJobs,
      )
      if (selectedId) {
        forcedTicketId = selectedId
        effectiveBody = pendingClarify.originalMessage
        clarificationOriginalIntent = pendingClarify.originalIntent
        await persistVendorWorkOrderClarification(supabase, {
          conversationId: sms.conversationId,
          clarification: null,
        })
      } else {
        const candidates = openJobs.filter((j) =>
          pendingClarify.candidateWorkOrderIds.includes(j.ticketId)
        )
        await recordVendorRepliedEvent(supabase, {
          landlordId: ctx.landlordId,
          vendorId,
          conversationId: sms.conversationId,
          messageId: sms.messageId,
          maintenanceRequestId: null,
          bodyPreview: sms.inbound.body,
          parsedAction: null,
        })
        return {
          templateId: "vendor_job_response",
          route: workflowRouteForTemplate("vendor_job_response"),
          replyHint: buildVendorWorkOrderClarifySms(
            candidates.length > 0 ? candidates : openJobs,
            "need_work_order",
          ),
          metadata: {
            vendorReschedule: true,
            vendorId,
            maintenanceRequestId: null,
            awaitingWorkOrderClarification: true,
            bodyPreview: sms.inbound.body.slice(0, 160),
            skipGenericAutoReply: true,
          },
        }
      }
    }
  }

  const pendingReschedule = readVendorReschedulePending(intake)
  const rescheduleIntent = detectVendorRescheduleIntent(effectiveBody)
  const continueReschedulePending = Boolean(
    pendingReschedule &&
      pendingReschedule.vendorId === vendorId &&
      !rescheduleIntent.isReschedule,
  )

  const prev = readVendorScheduleFsm(intake)
  if (
    !shouldAttemptVendorRescheduleInbound({
      vendorId,
      body: effectiveBody,
      pendingRescheduleVendorId: pendingReschedule?.vendorId ?? null,
      clarificationOriginalIntent,
      scheduleStep: prev?.step,
    })
  ) {
    return {
      templateId: "vendor_job_response",
      route: workflowRouteForTemplate("vendor_job_response"),
      metadata: { vendorReschedule: false },
    }
  }

  const rescheduleBody = continueReschedulePending && pendingReschedule
    ? `${pendingReschedule.originalMessage}\n${sms.inbound.body}`
    : effectiveBody

  const rescheduleResult = await tryHandleVendorRescheduleSms(supabase, {
    landlordId: ctx.landlordId,
    vendorId,
    conversationId: sms.conversationId,
    messageId: sms.messageId,
    inboundBody: rescheduleBody,
    forcedTicketId: forcedTicketId || pendingReschedule?.ticketId || null,
    continuePending: continueReschedulePending ||
      clarificationOriginalIntent === "reschedule",
  })

  if (!rescheduleResult.handled) {
    return {
      templateId: "vendor_job_response",
      route: workflowRouteForTemplate("vendor_job_response"),
      metadata: { vendorReschedule: false },
    }
  }

  await recordVendorRepliedEvent(supabase, {
    landlordId: ctx.landlordId,
    vendorId,
    conversationId: sms.conversationId,
    messageId: sms.messageId,
    maintenanceRequestId: rescheduleResult.ticketId,
    bodyPreview: sms.inbound.body,
    parsedAction: "reschedule",
  })

  return {
    templateId: "vendor_job_response",
    route: workflowRouteForTemplate("vendor_job_response"),
    replyHint: rescheduleResult.replyHint,
    metadata: {
      vendorReschedule: true,
      vendorId,
      maintenanceRequestId: rescheduleResult.ticketId,
      ...rescheduleResult.metadata,
      bodyPreview: sms.inbound.body.slice(0, 160),
      skipGenericAutoReply: true,
    },
  }
}

/** Returns act result when this message is a reschedule turn; null → continue normal vendor job flow. */
export async function tryActVendorRescheduleTurn(
  supabase: SupabaseClient,
  ctx: WorkflowExecutionContext,
  intent: ClassifiedIntent,
): Promise<WorkflowActResult | null> {
  const sms = ctx.sms
  if (!sms?.identity.vendor_id?.trim()) return null

  const gate = await loadVendorRescheduleGateContext(supabase, {
    vendorId: sms.identity.vendor_id.trim(),
    conversationId: sms.conversationId,
    body: sms.inbound.body,
  })

  if (!shouldActVendorRescheduleInWorkflow(intent, gate)) return null

  const result = await actVendorRescheduleInboundTurn(supabase, ctx)
  if (result.metadata?.vendorReschedule !== true) return null
  return result
}

export function buildWorkflowExecutionContextFromSmsHandler(params: {
  landlordId: string
  inbound: WorkflowContext["inbound"]
  identity: WorkflowContext["identity"]
  conversationId: string
  messageId: string
  maintenanceRequestId: string | null
  selfHealed: boolean
  resolutionSource: WorkflowContext["resolutionSource"]
  selfHealingPhase: WorkflowContext["selfHealingPhase"]
}): WorkflowExecutionContext {
  return {
    trigger: "sms_inbound",
    landlordId: params.landlordId,
    sms: {
      inbound: params.inbound,
      landlordId: params.landlordId,
      identity: params.identity,
      conversationId: params.conversationId,
      messageId: params.messageId,
      maintenanceRequestId: params.maintenanceRequestId,
      selfHealed: params.selfHealed,
      continueIntake: false,
      resolutionSource: params.resolutionSource,
      selfHealingPhase: params.selfHealingPhase,
      suggestedUnit: null,
    },
  }
}

/**
 * Pure routing gate — exported for unit tests and registry dispatch.
 */
export function shouldAttemptVendorRescheduleInbound(input: {
  vendorId: string
  body: string
  pendingRescheduleVendorId: string | null
  clarificationOriginalIntent: string | null
  scheduleStep: string | undefined
}): boolean {
  const rescheduleIntent = detectVendorRescheduleIntent(input.body)
  const continueReschedulePending = Boolean(
    input.pendingRescheduleVendorId &&
      input.pendingRescheduleVendorId === input.vendorId &&
      !rescheduleIntent.isReschedule,
  )
  const treatAsReschedule =
    rescheduleIntent.isReschedule ||
    continueReschedulePending ||
    input.clarificationOriginalIntent === "reschedule"

  const blockingInitialSchedule =
    !!input.scheduleStep &&
    (input.scheduleStep === "awaiting_availability" ||
      input.scheduleStep === "awaiting_confirmation") &&
    !rescheduleIntent.isReschedule &&
    !continueReschedulePending &&
    input.clarificationOriginalIntent !== "reschedule"

  return treatAsReschedule && !blockingInitialSchedule
}
