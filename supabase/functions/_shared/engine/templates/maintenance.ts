import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { processResidentMaintenanceIntake } from "../../sms/residentIntake.ts"
import {
  backfillPipelineStageEvents,
  createWorkflowRun,
  findActiveWorkflowRun,
  linkConversationToWorkflowRun,
  syncWorkflowRunIntakeState,
} from "../workflowRuns.ts"
import { workflowRouteForTemplate } from "../logStage.ts"
import type {
  ClassifiedIntent,
  WorkflowActResult,
  WorkflowExecutionContext,
  WorkflowTemplate,
} from "../types.ts"

export const maintenanceIntakeTemplate: WorkflowTemplate = {
  id: "maintenance_intake",
  name: "Maintenance intake",
  supportedTriggers: ["sms_inbound", "dashboard", "webhook"],

  classify(ctx): ClassifiedIntent | null {
    const sms = ctx.sms
    if (!sms) return null

    if (sms.continueIntake) {
      return {
        templateId: "maintenance_intake",
        confidence: "high",
        reason: "continue_intake",
        runId: ctx.runId,
      }
    }

    if (sms.identity.identity_type === "resident") {
      return {
        templateId: "maintenance_intake",
        confidence: "high",
        reason: "resident_sms",
        runId: ctx.runId,
      }
    }

    return null
  },

  async act(
    supabase: SupabaseClient,
    ctx: WorkflowExecutionContext,
    intent: ClassifiedIntent,
  ): Promise<WorkflowActResult> {
    const sms = ctx.sms
    if (!sms) {
      return {
        templateId: "maintenance_intake",
        route: workflowRouteForTemplate("maintenance_intake"),
        metadata: { error: "missing_sms_context" },
      }
    }

    let runId = intent.runId ?? ctx.runId ?? ctx.activeRun?.id ?? null
    let runCreated = false

    if (!runId) {
      const existing = await findActiveWorkflowRun(supabase, {
        landlordId: ctx.landlordId,
        conversationId: sms.conversationId,
        templateId: "maintenance_intake",
      })
      runId = existing?.id ?? null
    }

    if (!runId) {
      const linkedTicketId = sms.maintenanceRequestId?.trim() || null
      const run = await createWorkflowRun(supabase, {
        templateId: "maintenance_intake",
        landlordId: ctx.landlordId,
        triggerType: ctx.trigger,
        currentStep: "collecting",
        entityType: linkedTicketId ? "maintenance_request" : "sms_conversation",
        entityId: linkedTicketId ?? sms.conversationId,
        residentId: sms.identity.resident_id,
        unitId: sms.identity.unit_id,
        metadata: {
          intake_state: { step: "issue_type", phase: "intake_collecting" },
        },
      })
      if (run) {
        runId = run.id
        runCreated = true
        ctx.runId = run.id
        ctx.activeRun = run

        await backfillPipelineStageEvents(supabase, {
          runId: run.id,
          stages: ["classify", "route"],
          metadata: {
            template_id: "maintenance_intake",
            classified_reason: intent.reason,
          },
        })

        await linkConversationToWorkflowRun(supabase, {
          conversationId: sms.conversationId,
          runId: run.id,
          templateId: "maintenance_intake",
        })
      }
    } else {
      ctx.runId = runId
    }

    const intake = await processResidentMaintenanceIntake(supabase, sms)

    if (runId) {
      const { data: convo } = await supabase
        .from("sms_conversations")
        .select("intake_state")
        .eq("id", sms.conversationId)
        .maybeSingle()

      const intakeState = (convo as { intake_state?: Record<string, unknown> } | null)
        ?.intake_state
      if (intakeState && typeof intakeState === "object") {
        await syncWorkflowRunIntakeState(supabase, {
          runId,
          intakeState,
          currentStep:
            (intake.metadata?.intakeStep as string | undefined) ??
            (typeof intakeState.step === "string" ? intakeState.step : undefined),
        })
      }
    }

    return {
      templateId: "maintenance_intake",
      route: workflowRouteForTemplate("maintenance_intake"),
      runId,
      replyHint: intake.replyHint,
      metadata: {
        ...intake.metadata,
        workflow_route: intake.route,
        run_created: runCreated,
      },
    }
  },
}
