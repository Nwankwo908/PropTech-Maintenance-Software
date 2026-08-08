/**
 * Move-out workflow template — instructions → vacate → inspection → complete.
 */
import { workflowRouteForTemplate } from "../logStage.ts"
import { escalateLifecycleRunById } from "../lifecycleEscalation.ts"
import {
  cancelMoveOutWorkflow,
  completeMoveOutWorkflow,
  executeMoveOutAdminAction,
  executeMoveOutMarkVacated,
  executeMoveOutOutreach,
  executeMoveOutScheduleInspection,
  processMoveOutResidentReply,
} from "../moveOutProgress.ts"
import { ensureLifecycleWorkflowStartedLogged } from "../lifecycleStartLog.ts"
import { isLifecycleInitialActTrigger } from "../lifecyclePolicy.ts"
import type {
  ClassifiedIntent,
  EscalationResult,
  WorkflowActResult,
  WorkflowExecutionContext,
  WorkflowTemplate,
} from "../types.ts"
import type { MoveOutEngineInput } from "../moveOutEngine.ts"

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
    if (runId) {
      await ensureLifecycleWorkflowStartedLogged(supabase, {
        landlordId: ctx.landlordId,
        runId,
        trigger: ctx.trigger,
      })
    }
    const moveOut = (ctx as WorkflowExecutionContext & {
      moveOut?: MoveOutEngineInput
    }).moveOut

    if (runId && moveOut?.action === "send_outreach") {
      const result = await executeMoveOutOutreach(supabase, {
        landlordId: ctx.landlordId,
        runId,
        sourceWorkflowRunId: moveOut.sourceWorkflowRunId ?? null,
      })
      return {
        templateId: "move_out",
        route: workflowRouteForTemplate("move_out"),
        runId,
        metadata: { action: "send_outreach", ...result },
      }
    }

    if (runId && moveOut?.action === "schedule_inspection") {
      const spawned = await executeMoveOutScheduleInspection(supabase, {
        landlordId: ctx.landlordId,
        runId,
        scheduledAt: moveOut.scheduledAt,
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

    if (runId && moveOut?.action === "mark_vacated") {
      const result = await executeMoveOutMarkVacated(supabase, {
        landlordId: ctx.landlordId,
        runId,
        unitId: moveOut.unitId,
        unitLabel: moveOut.unitLabel,
        building: moveOut.building,
      })
      return {
        templateId: "move_out",
        route: workflowRouteForTemplate("move_out"),
        runId,
        metadata: { action: "mark_vacated", ...result },
      }
    }

    if (runId && moveOut?.action === "complete") {
      await completeMoveOutWorkflow(supabase, {
        landlordId: ctx.landlordId,
        runId,
      })
      return {
        templateId: "move_out",
        route: workflowRouteForTemplate("move_out"),
        runId,
        metadata: { action: "complete", step: "completed" },
      }
    }

    if (runId && moveOut?.action === "cancel_move_out") {
      await cancelMoveOutWorkflow(supabase, {
        landlordId: ctx.landlordId,
        runId,
      })
      return {
        templateId: "move_out",
        route: workflowRouteForTemplate("move_out"),
        runId,
        metadata: { action: "cancel_move_out", step: "cancelled" },
      }
    }

    if (
      runId &&
      moveOut?.action &&
      [
        "send_reminder",
        "mark_keys_returned",
        "complete_cleaning",
        "complete_move_out",
      ].includes(moveOut.action)
    ) {
      const result = await executeMoveOutAdminAction(supabase, {
        landlordId: ctx.landlordId,
        runId,
        action: moveOut.action,
      })
      return {
        templateId: "move_out",
        route: workflowRouteForTemplate("move_out"),
        runId,
        metadata: {
          action: moveOut.action,
          ok: result.ok,
          error: result.error,
          inspection_run_id: result.inspectionRunId ?? null,
        },
      }
    }

    if (runId && moveOut?.action === "resident_replied") {
      const body = moveOut.smsBody ?? ctx.sms?.inbound.body ?? ""
      const result = await processMoveOutResidentReply(supabase, {
        landlordId: ctx.landlordId,
        runId,
        body,
      })
      return {
        templateId: "move_out",
        route: workflowRouteForTemplate("move_out"),
        runId,
        replyHint: result.replyHint,
        metadata: {
          action: "resident_replied",
          step: result.step,
        },
      }
    }

    if (runId && isLifecycleInitialActTrigger(ctx.trigger)) {
      const result = await executeMoveOutOutreach(supabase, {
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
      const body = ctx.sms?.inbound.body ?? ""
      const result = await processMoveOutResidentReply(supabase, {
        landlordId: ctx.landlordId,
        runId,
        body,
      })
      return {
        templateId: "move_out",
        route: workflowRouteForTemplate("move_out"),
        runId,
        replyHint: result.replyHint,
        metadata: {
          action: "sms_inbound",
          step: result.step,
        },
      }
    }

    return {
      templateId: "move_out",
      route: workflowRouteForTemplate("move_out"),
      runId,
      metadata: { action: "noop" },
      shouldEscalate: ctx.trigger === "cron",
      escalationReason: ctx.cron?.escalationReason ??
        (ctx.trigger === "cron" ? "cron_sweep" : undefined),
    }
  },

  async escalate(supabase, ctx, result): Promise<EscalationResult | null> {
    const runId = result.runId ?? ctx.runId
    if (!runId) return null
    const out = await escalateLifecycleRunById(supabase, {
      landlordId: ctx.landlordId,
      runId,
      reason: result.escalationReason ?? ctx.cron?.escalationReason ??
        "stalled_move_out",
      escalationConfig: ctx.cron?.escalationConfig,
    })
    if (!out || out.action === "skipped") {
      return {
        escalated: false,
        reason: out?.reason ?? "skipped",
        metadata: { action: "skipped" },
      }
    }
    return {
      escalated: out.action === "escalated",
      reason: out.reason,
      metadata: {
        action: out.action,
        sms_sent: out.sms_sent,
        admin_notified: out.admin_notified,
        admin_notify_errors: out.admin_notify_errors,
      },
    }
  },
}
