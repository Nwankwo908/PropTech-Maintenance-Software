/**
 * Move-in workflow template — welcome → checklist → remind → escalate → complete.
 */
import { workflowRouteForTemplate } from "../logStage.ts"
import { escalateLifecycleRunById } from "../lifecycleEscalation.ts"
import { executeLifecycleInitialAct } from "../lifecycleProgress.ts"
import { readLifecycleStepState, isLifecycleInitialActTrigger } from "../lifecyclePolicy.ts"
import { getWorkflowRunById } from "../workflowRuns.ts"
import type {
  ClassifiedIntent,
  EscalationResult,
  WorkflowActResult,
  WorkflowTemplate,
} from "../types.ts"

export const moveInTemplate: WorkflowTemplate = {
  id: "move_in",
  name: "Move In",
  supportedTriggers: ["dashboard", "automation", "cron", "sms_inbound", "webhook"],

  classify(ctx): ClassifiedIntent | null {
    if (ctx.cron?.templateId === "move_in") {
      return {
        templateId: "move_in",
        confidence: "high",
        reason: "cron_move_in",
        runId: ctx.runId ?? ctx.activeRun?.id ?? null,
      }
    }
    if (
      ctx.trigger === "dashboard" ||
      ctx.trigger === "automation" ||
      ctx.trigger === "webhook"
    ) {
      return {
        templateId: "move_in",
        confidence: "medium",
        reason: "lifecycle_move_in",
        runId: ctx.runId ?? ctx.activeRun?.id ?? null,
      }
    }
    if (ctx.trigger === "sms_inbound" && ctx.activeRun?.template_id === "move_in") {
      return {
        templateId: "move_in",
        confidence: "high",
        reason: "active_move_in_sms",
        runId: ctx.activeRun.id,
      }
    }
    return null
  },

  async act(supabase, ctx, intent): Promise<WorkflowActResult> {
    const runId = intent.runId ?? ctx.runId ?? ctx.activeRun?.id ?? null

    if (runId && isLifecycleInitialActTrigger(ctx.trigger)) {
      const result = await executeLifecycleInitialAct(supabase, {
        landlordId: ctx.landlordId,
        runId,
      })
      return {
        templateId: "move_in",
        route: workflowRouteForTemplate("move_in"),
        runId,
        metadata: { action: "initial_act", ...result },
      }
    }

    if (ctx.trigger === "sms_inbound" && runId) {
      const run = ctx.activeRun ?? await getWorkflowRunById(supabase, runId)
      const step = run ? readLifecycleStepState(run).step : null
      return {
        templateId: "move_in",
        route: workflowRouteForTemplate("move_in"),
        runId,
        replyHint: step === "completed"
          ? "Your move-in is complete. Reply here anytime if you need help."
          : "Thanks — please finish any remaining move-in checklist items. Reply here if you need help.",
        metadata: { action: "sms_ack", step },
      }
    }

    return {
      templateId: "move_in",
      route: workflowRouteForTemplate("move_in"),
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
      reason: result.escalationReason ?? "stalled_move_in",
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
