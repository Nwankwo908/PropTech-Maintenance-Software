/**
 * Inspection workflow template — notice → await access → remind → escalate → complete.
 */
import { workflowRouteForTemplate } from "../logStage.ts"
import { escalateLifecycleRunById } from "../lifecycleEscalation.ts"
import {
  completeLifecycleWorkflow,
  executeLifecycleInitialAct,
} from "../lifecycleProgress.ts"
import { readLifecycleStepState, isLifecycleInitialActTrigger } from "../lifecyclePolicy.ts"
import { getWorkflowRunById } from "../workflowRuns.ts"
import type {
  ClassifiedIntent,
  EscalationResult,
  WorkflowActResult,
  WorkflowExecutionContext,
  WorkflowTemplate,
} from "../types.ts"

export const inspectionTemplate: WorkflowTemplate = {
  id: "inspection",
  name: "Inspection",
  supportedTriggers: ["dashboard", "automation", "cron", "sms_inbound", "webhook"],

  classify(ctx): ClassifiedIntent | null {
    if (ctx.cron?.templateId === "inspection") {
      return {
        templateId: "inspection",
        confidence: "high",
        reason: "cron_inspection",
        runId: ctx.runId ?? ctx.activeRun?.id ?? null,
      }
    }
    if (
      ctx.trigger === "dashboard" ||
      ctx.trigger === "automation" ||
      ctx.trigger === "webhook"
    ) {
      return {
        templateId: "inspection",
        confidence: "medium",
        reason: "lifecycle_inspection",
        runId: ctx.runId ?? ctx.activeRun?.id ?? null,
      }
    }
    if (ctx.trigger === "sms_inbound" && ctx.activeRun?.template_id === "inspection") {
      return {
        templateId: "inspection",
        confidence: "high",
        reason: "active_inspection_sms",
        runId: ctx.activeRun.id,
      }
    }
    return null
  },

  async act(supabase, ctx, intent): Promise<WorkflowActResult> {
    const runId = intent.runId ?? ctx.runId ?? ctx.activeRun?.id ?? null
    const meta = (ctx as WorkflowExecutionContext & {
      lifecycleAction?: string
    }).lifecycleAction

    if (runId && meta === "complete") {
      await completeLifecycleWorkflow(supabase, {
        landlordId: ctx.landlordId,
        runId,
        message: "Inspection completed.",
      })
      return {
        templateId: "inspection",
        route: workflowRouteForTemplate("inspection"),
        runId,
        metadata: { action: "complete", step: "completed" },
      }
    }

    if (runId && isLifecycleInitialActTrigger(ctx.trigger)) {
      const result = await executeLifecycleInitialAct(supabase, {
        landlordId: ctx.landlordId,
        runId,
      })
      return {
        templateId: "inspection",
        route: workflowRouteForTemplate("inspection"),
        runId,
        metadata: { action: "initial_act", ...result },
      }
    }

    if (ctx.trigger === "sms_inbound" && runId) {
      const run = ctx.activeRun ?? await getWorkflowRunById(supabase, runId)
      const step = run ? readLifecycleStepState(run).step : null
      return {
        templateId: "inspection",
        route: workflowRouteForTemplate("inspection"),
        runId,
        replyHint: step === "completed"
          ? "Thanks — this inspection is complete."
          : "Thanks — please make sure we can access the unit for the inspection, or reply here to reschedule.",
        metadata: { action: "sms_ack", step },
      }
    }

    return {
      templateId: "inspection",
      route: workflowRouteForTemplate("inspection"),
      runId,
      metadata: { action: "noop" },
      shouldEscalate: ctx.trigger === "cron",
      escalationReason: ctx.trigger === "cron" ? "cron_sweep" : undefined,
    }
  },

  async escalate(supabase, ctx, result): Promise<EscalationResult | null> {
    const runId = result.runId ?? ctx.runId
    if (!runId) return null
    const out = await escalateLifecycleRunById(supabase, {
      landlordId: ctx.landlordId,
      runId,
      reason: result.escalationReason ?? "stalled_inspection",
    })
    if (!out || out.action === "skipped") {
      return { escalated: false, reason: out?.reason ?? "skipped" }
    }
    return {
      escalated: out.action === "escalated",
      reason: out.reason,
      metadata: { action: out.action, sms_sent: out.sms_sent },
    }
  },
}
