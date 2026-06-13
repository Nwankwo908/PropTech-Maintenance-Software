import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { SmsIdentityRow } from "./inbound_db.ts"
import { runWorkflowEngine } from "../engine/runner.ts"
import { workflowRouteForTemplate } from "../engine/logStage.ts"
import type {
  SmsWorkflowRoute,
  WorkflowContext,
  WorkflowResult,
} from "./workflow_types.ts"

export type { SmsWorkflowRoute, WorkflowContext, WorkflowResult } from "./workflow_types.ts"

/** @deprecated Use workflow engine classification instead. Kept for logging compatibility. */
export function resolveWorkflowRoute(
  identity: SmsIdentityRow,
  continueIntake: boolean,
): SmsWorkflowRoute {
  if (continueIntake) return "resident_maintenance_intake"
  if (identity.identity_type === "resident") return "resident_maintenance_intake"
  if (identity.identity_type === "vendor" && identity.vendor_id?.trim()) {
    return "vendor_response"
  }
  if (identity.identity_type === "landlord") return "landlord_command"
  return "unknown_sender_onboarding"
}

/** Routes inbound SMS through the shared workflow engine (trigger→classify→route→act→escalate→log). */
export async function routeInboundSmsWorkflow(
  supabase: SupabaseClient,
  ctx: WorkflowContext,
): Promise<WorkflowResult> {
  const legacyRoute = resolveWorkflowRoute(ctx.identity, ctx.continueIntake)

  console.info("[sms-workflow] routing via workflow engine", {
    legacy_route: legacyRoute,
    identity_type: ctx.identity.identity_type,
    continue_intake: ctx.continueIntake,
    conversation_id: ctx.conversationId,
  })

  const engineResult = await runWorkflowEngine(supabase, {
    trigger: "sms_inbound",
    landlordId: ctx.landlordId,
    sms: ctx,
  })

  const route = engineResult.route as SmsWorkflowRoute

  console.info("[sms-workflow] engine completed", {
    route,
    template_id: engineResult.templateId,
    run_id: engineResult.runId,
    stages: engineResult.stages,
    classified: engineResult.classified,
  })

  return {
    route,
    replyHint: engineResult.replyHint,
    metadata: {
      ...engineResult.metadata,
      workflow_template_id: engineResult.templateId,
      workflow_run_id: engineResult.runId,
      classified_reason: engineResult.classified.reason,
      pipeline_stages: engineResult.stages,
    },
  }
}

export function actorTypeForIdentity(
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

export function actorIdForIdentity(identity: SmsIdentityRow): string | null {
  if (identity.resident_id) return identity.resident_id
  if (identity.vendor_id) return identity.vendor_id
  return null
}

export { workflowRouteForTemplate }
