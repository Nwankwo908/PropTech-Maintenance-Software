/**
 * Move-out workflow template — instructions → vacate → inspection → complete.
 */
import { workflowRouteForTemplate } from "../logStage.ts"
import { escalateLifecycleRunById } from "../lifecycleEscalation.ts"
import {
  executeLifecycleInitialAct,
  scheduleMoveOutInspection,
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

export const moveOutTemplate: WorkflowTemplate = {
  id: "move_out",
  name: "Move Out",
  supportedTriggers: ["dashboard", "automation", "cron", "sms_inbound", "webhook"],

  classify(ctx): ClassifiedIntent | null {
    if (ctx.cron?.templateId === "move_out") {
      return {
        templateId: "move_out",
        confidence: "high",
        reason: "cron_move_out",
        runId: ctx.runId ?? ctx.activeRun?.id ?? null,
      }
    }
    if (
      ctx.trigger === "dashboard" ||
      ctx.trigger === "automation" ||
      ctx.trigger === "webhook"
    ) {
      return {
        templateId: "move_out",
        confidence: "medium",
        reason: "lifecycle_move_out",
        runId: ctx.runId ?? ctx.activeRun?.id ?? null,
      }
    }
    if (ctx.trigger === "sms_inbound" && ctx.activeRun?.template_id === "move_out") {
      return {
        templateId: "move_out",
        confidence: "high",
        reason: "active_move_out_sms",
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

    if (runId && meta === "schedule_inspection") {
      const spawned = await scheduleMoveOutInspection(supabase, {
        landlordId: ctx.landlordId,
        moveOutRunId: runId,
      })
      return {
        templateId: "move_out",
        route: workflowRouteForTemplate("move_out"),
        runId,
        metadata: {
          action: "schedule_inspection",
          inspection_run_id: spawned.inspectionRunId,
        },
      }
    }

    if (runId && isLifecycleInitialActTrigger(ctx.trigger)) {
      const result = await executeLifecycleInitialAct(supabase, {
        landlordId: ctx.landlordId,
        runId,
      })
      return {
        templateId: "move_out",
        route: workflowRouteForTemplate("move_out"),
        runId,
        metadata: { action: "initial_act", ...result },
      }
    }

    if (ctx.trigger === "sms_inbound" && runId) {
      const run = ctx.activeRun ?? await getWorkflowRunById(supabase, runId)
      const step = run ? readLifecycleStepState(run).step : null
      return {
        templateId: "move_out",
        route: workflowRouteForTemplate("move_out"),
        runId,
        replyHint: step === "completed"
          ? "Your move-out is complete. Reply here anytime if you need help."
          : "Thanks — please finish your move-out steps (cleaning, keys, and inspection). Reply here if you have questions.",
        metadata: { action: "sms_ack", step },
      }
    }

    return {
      templateId: "move_out",
      route: workflowRouteForTemplate("move_out"),
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
      reason: result.escalationReason ?? "stalled_move_out",
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
