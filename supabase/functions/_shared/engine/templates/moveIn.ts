/**
 * Move-in workflow template — welcome → checklist → remind → escalate → complete.
 */
import { workflowRouteForTemplate } from "../logStage.ts"
import { escalateLifecycleRunById } from "../lifecycleEscalation.ts"
import {
  completeMoveInWorkflow,
  executeMoveInOutreach,
  executeMoveInRegisterAndOutreach,
  executeMoveInRegisterOccupancy,
  processMoveInResidentReply,
} from "../moveInProgress.ts"
import { ensureLifecycleWorkflowStartedLogged } from "../lifecycleStartLog.ts"
import { isLifecycleInitialActTrigger } from "../lifecyclePolicy.ts"
import type {
  ClassifiedIntent,
  EscalationResult,
  WorkflowActResult,
  WorkflowExecutionContext,
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
    if (runId) {
      await ensureLifecycleWorkflowStartedLogged(supabase, {
        landlordId: ctx.landlordId,
        runId,
        trigger: ctx.trigger,
      })
    }
    const moveIn = (ctx as WorkflowExecutionContext & {
      moveIn?: {
        action?: string
        register?: {
          tenantName?: string | null
          tenantPhone?: string | null
          tenantEmail?: string | null
          moveInDate?: string | null
          residentId?: string | null
        }
        smsBody?: string
      }
    }).moveIn

    if (runId && moveIn?.action === "register_occupancy" && moveIn.register) {
      const result = await executeMoveInRegisterOccupancy(supabase, {
        landlordId: ctx.landlordId,
        runId,
        register: moveIn.register,
      })
      return {
        templateId: "move_in",
        route: workflowRouteForTemplate("move_in"),
        runId,
        metadata: {
          action: "register_occupancy",
          ok: result.ok,
          error: result.error,
          residentId: result.activation?.residentId ?? null,
          occupancyId: result.activation?.occupancyId ?? null,
        },
      }
    }

    if (runId && moveIn?.action === "send_outreach") {
      const result = await executeMoveInOutreach(supabase, {
        landlordId: ctx.landlordId,
        runId,
      })
      return {
        templateId: "move_in",
        route: workflowRouteForTemplate("move_in"),
        runId,
        metadata: { action: "send_outreach", ...result },
      }
    }

    if (runId && moveIn?.action === "register_and_outreach") {
      const result = await executeMoveInRegisterAndOutreach(supabase, {
        landlordId: ctx.landlordId,
        runId,
        register: moveIn.register,
      })
      return {
        templateId: "move_in",
        route: workflowRouteForTemplate("move_in"),
        runId,
        metadata: { action: "register_and_outreach", ...result },
      }
    }

    if (runId && moveIn?.action === "complete") {
      await completeMoveInWorkflow(supabase, {
        landlordId: ctx.landlordId,
        runId,
      })
      return {
        templateId: "move_in",
        route: workflowRouteForTemplate("move_in"),
        runId,
        metadata: { action: "complete", step: "completed" },
      }
    }

    if (runId && moveIn?.action === "resident_replied") {
      const body = moveIn.smsBody ?? ctx.sms?.inbound.body ?? ""
      const result = await processMoveInResidentReply(supabase, {
        landlordId: ctx.landlordId,
        runId,
        body,
      })
      return {
        templateId: "move_in",
        route: workflowRouteForTemplate("move_in"),
        runId,
        replyHint: result.replyHint,
        metadata: {
          action: "resident_replied",
          step: result.step,
          completed: result.completed,
        },
      }
    }

    if (runId && isLifecycleInitialActTrigger(ctx.trigger)) {
      const result = await executeMoveInOutreach(supabase, {
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
      const body = ctx.sms?.inbound.body ?? ""
      const result = await processMoveInResidentReply(supabase, {
        landlordId: ctx.landlordId,
        runId,
        body,
      })
      return {
        templateId: "move_in",
        route: workflowRouteForTemplate("move_in"),
        runId,
        replyHint: result.replyHint,
        metadata: {
          action: "sms_inbound",
          step: result.step,
          completed: result.completed,
        },
      }
    }

    return {
      templateId: "move_in",
      route: workflowRouteForTemplate("move_in"),
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
        "stalled_move_in",
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
