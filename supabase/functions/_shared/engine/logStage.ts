import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { logWorkflowEvent, runMaintenanceRequestId } from "./workflowRuns.ts"
import type {
  ClassifiedIntent,
  WorkflowActResult,
  WorkflowExecutionContext,
  WorkflowStage,
  WorkflowTemplateId,
} from "./types.ts"
import type { SmsIdentityRow } from "../sms/inbound_db.ts"

export async function logWorkflowStage(
  supabase: SupabaseClient,
  params: {
    stage: WorkflowStage
    ctx: WorkflowExecutionContext
    intent?: ClassifiedIntent
    result?: WorkflowActResult
    identity?: SmsIdentityRow
    conversationId?: string | null
    messageId?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<string | null> {
  const sms = params.ctx.sms
  const templateId =
    params.intent?.templateId ??
    params.result?.templateId ??
    params.ctx.activeRun?.template_id ??
    null

  const runId = params.ctx.runId ?? params.result?.runId ?? null
  const activeRun = params.ctx.activeRun

  const graphEventId = await logGraphEvent(supabase, {
    landlord_id: params.ctx.landlordId,
    event_type: `workflow.${params.stage}`,
    source: params.ctx.trigger === "sms_inbound" ? "sms" : "automation",
    actor_type: params.identity
      ? identityActorType(params.identity.identity_type)
      : "system",
    actor_id: params.identity
      ? (params.identity.resident_id ??
        params.identity.vendor_id ??
        null)
      : null,
    unit_id: params.identity?.unit_id ?? params.ctx.activeRun?.unit_id ?? null,
    resident_id:
      params.identity?.resident_id ?? params.ctx.activeRun?.resident_id ?? null,
    vendor_id: params.identity?.vendor_id ?? null,
    maintenance_request_id:
      sms?.maintenanceRequestId ??
      (activeRun ? runMaintenanceRequestId(activeRun) : null) ??
      null,
    conversation_id: sms?.conversationId ?? params.conversationId ?? null,
    message_id: sms?.messageId ?? params.messageId ?? null,
    workflow_run_id: runId,
    workflow_template_id: templateId,
    metadata: {
      workflow_stage: params.stage,
      workflow_template_id: templateId,
      workflow_run_id: runId ?? null,
      trigger: params.ctx.trigger,
      ...(params.intent
        ? {
            classified_template: params.intent.templateId,
            classified_confidence: params.intent.confidence,
            classified_reason: params.intent.reason,
          }
        : {}),
      ...(params.result
        ? {
            workflow_route: params.result.route,
            ...params.result.metadata,
          }
        : {}),
      ...params.metadata,
    },
  })

  if (runId) {
    await logWorkflowEvent(supabase, {
      workflowRunId: runId,
      eventType: `workflow.${params.stage}`,
      step: params.result?.metadata?.intakeStep as string | undefined ??
        activeRun?.current_step ??
        undefined,
      actorType: params.identity
        ? identityActorType(params.identity.identity_type)
        : "system",
      actorId: params.identity
        ? (params.identity.resident_id ?? params.identity.vendor_id ?? null)
        : null,
      metadata: {
        trigger: params.ctx.trigger,
        ...(params.intent
          ? {
            classified_template: params.intent.templateId,
            classified_reason: params.intent.reason,
          }
          : {}),
        ...params.metadata,
      },
    })
  }

  return graphEventId
}

function identityActorType(
  identityType: string,
): "resident" | "vendor" | "landlord" | "system" | null {
  switch (identityType) {
    case "resident":
      return "resident"
    case "vendor":
      return "vendor"
    case "landlord":
      return "landlord"
    default:
      return null
  }
}

export function workflowRouteForTemplate(
  templateId: WorkflowTemplateId,
): string {
  switch (templateId) {
    case "maintenance_intake":
      return "resident_maintenance_intake"
    case "lease_renewal":
      return "lease_renewal"
    case "rent_collection":
      return "rent_collection"
    case "vendor_job_response":
      return "vendor_response"
    case "identity_onboarding":
      return "unknown_sender_onboarding"
    case "landlord_command":
      return "landlord_command"
  }
}
