/**
 * Vendor SMS reschedule — registry intent specialist only.
 * Detects reschedule (or pending follow-up) and dispatches to vendor_job_response workflow.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { runWorkflowEngine } from "../engine/runner.ts"
import type { InboundSmsHandlerContext } from "./inboundHandlerTypes.ts"
import {
  buildWorkflowExecutionContextFromSmsHandler,
  loadVendorRescheduleGateContext,
  shouldAttemptVendorRescheduleInbound,
} from "./vendorRescheduleWorkflowAct.ts"

export {
  shouldAttemptVendorRescheduleInbound,
} from "./vendorRescheduleWorkflowAct.ts"

export type VendorRescheduleInboundResult =
  | { handled: false }
  | {
      handled: true
      replyBody: string
      ticketId: string | null
      metadata: Record<string, unknown>
    }

function maintenanceRequestIdFromMetadata(
  metadata: Record<string, unknown>,
): string | null {
  const id = metadata.maintenanceRequestId
  return typeof id === "string" && id.trim() ? id.trim() : null
}

/** Dispatch a gated reschedule message into vendor_job_response (registry path). */
export async function routeVendorRescheduleToWorkflow(
  supabase: SupabaseClient,
  ctx: InboundSmsHandlerContext,
): Promise<VendorRescheduleInboundResult> {
  const vendorId = ctx.identity.vendor_id?.trim()
  if (!vendorId) return { handled: false }

  const gate = await loadVendorRescheduleGateContext(supabase, {
    vendorId,
    conversationId: ctx.conversationId,
    body: ctx.inbound.body,
  })

  if (!shouldAttemptVendorRescheduleInbound(gate)) {
    return { handled: false }
  }

  const engineCtx = buildWorkflowExecutionContextFromSmsHandler({
    landlordId: ctx.landlordId,
    inbound: ctx.inbound,
    identity: ctx.identity,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    maintenanceRequestId: ctx.maintenanceRequestId,
    selfHealed: ctx.selfHealed,
    resolutionSource: ctx.resolutionSource,
    selfHealingPhase: ctx.selfHealingPhase,
  })

  const engineResult = await runWorkflowEngine(supabase, engineCtx, {
    classified: {
      templateId: "vendor_job_response",
      confidence: "high",
      reason: "vendor_reschedule_registry_dispatch",
    },
  })

  if (engineResult.metadata?.vendorReschedule !== true) {
    return { handled: false }
  }

  return {
    handled: true,
    replyBody: engineResult.replyHint ?? "",
    ticketId: maintenanceRequestIdFromMetadata(engineResult.metadata),
    metadata: {
      ...engineResult.metadata,
      workflow_template_id: engineResult.templateId,
      classified_reason: engineResult.classified.reason,
    },
  }
}

/** Registry adapter entry — intent gate + workflow dispatch only. */
export async function tryHandleVendorRescheduleInbound(
  supabase: SupabaseClient,
  ctx: InboundSmsHandlerContext,
): Promise<VendorRescheduleInboundResult> {
  return routeVendorRescheduleToWorkflow(supabase, ctx)
}
